import assert from 'node:assert/strict';
import test from 'node:test';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {LocalTextSafety} from '../dist/infrastructure/text-safety/local-text-safety.js';
import {TyphoonTranslation} from '../dist/infrastructure/translation/typhoon-translation.js';
import {handleHttp} from '../dist/transport/http-handler.js';
import {createNodeServer} from '../dist/infrastructure/node-server.js';
import {D1AtomicRepository} from '../dist/infrastructure/d1/d1-atomic-repository.js';
import {LocalDatabase} from './f3-d1-harness.mjs';
import {harness} from './f2-harness.mjs';
import {accountCandidateId,createAccountAccess} from '../dist/infrastructure/cloudflare/account-access.js';
import {DomainCore} from '../dist/application/domain-core.js';
const ok=value=>({ok:true,value});

test('F3R1 O-D01 rejects national phones and Unicode LINE handles',async()=>{
 const safety=new LocalTextSafety();
 for(const text of ['0812345678','LINE @\u0e0a\u0e37\u0e48\u0e2d']){
  const result=await safety.inspect({text,purpose:'job_chat'});
  assert.equal(result.value.status,'rejected',text);assert.equal(result.value.reason,'contact');
 }
});
test('F3R1 Client–Master job-chat contact is rejected before persistence and language detection',async()=>{
 const h=harness(),safety=new LocalTextSafety();
 await h.published('job');await h.offer('job');
 h.ports.textSafety=safety;
 let detectionCalls=0;
 h.ports.translation.detect=async()=>{detectionCalls++;return ok({language:'en',reliable:true});};
 const before=await h.repository.read();
 const result=await h.execute('client:client',{type:'message',chatId:'chat:job:master',id:'blocked-contact',
  original:'LINE ID: somchai',photoIds:[],sender:'user'},'blocked-contact-operation');
 assert.equal(result.ok,false);assert.equal(result.error.code,'TextRejected');
 assert.deepEqual(await h.repository.read(),before);
 assert.equal(detectionCalls,0);
});

test('F3R1 O-D01 rejects over-budget text before normalization or pattern scanning',async()=>{
 const normalize=String.prototype.normalize;let calls=0;
 String.prototype.normalize=function(...args){calls++;return normalize.apply(this,args);};
 try {const r=await new LocalTextSafety().inspect({text:'x'.repeat(16001),purpose:'external_translation'});assert.equal(r.value.status,'unknown');assert.equal(calls,0);}
 finally {String.prototype.normalize=normalize;}
});
test('F3R1 O-D02 operation keys never choose the account candidate identity',async()=>{
 const h=harness(),candidates=[];
 const claim={id:'verified-claim',purpose:'login',identity:{method:'email',subject:'synthetic-subject'},email:'synthetic@test.invalid',phone:null,ownerId:null,expiresAt:1000};
 h.ports.auth.verifyClaim=async()=>ok(claim);
 const app={ports:h.ports,photos:{},core:h.core,accountAccess:createAccountAccess(h.ports)},original=DomainCore.prototype.authenticate;
 DomainCore.prototype.authenticate=async function(proof,id,...args){candidates.push(id);return original.call(this,proof,id,...args);};
 try {for(const [operationId,status] of [['client-chosen-A',200],['client-chosen-B',409]]){
  const response=await handleHttp({method:'POST',path:'/api/v1/account/access',headers:{'content-type':'application/json'},body:new TextEncoder().encode(JSON.stringify({method:'login',proof:'opaque',operationId}))},app);
  assert.equal(response.status,status);
 }}finally{DomainCore.prototype.authenticate=original;}
 const chosen=await accountCandidateId(claim);assert.deepEqual(candidates,[chosen,chosen]);assert.ok(!chosen.includes('client-chosen'));
});
for(const [original,translation] of [['-1200 THB','1200 THB'],['+1200 THB','1200 THB'],['\u0e51\u0e52\u0e53 \u0e1a\u0e32\u0e17','\u0e54\u0e55\u0e56 \u0e1a\u0e32\u0e17']])
test(`F3R1 O-D03 refuses numeric mutation ${JSON.stringify(original)}`,async()=>{
 let calls=0;const adapter=new TyphoonTranslation('synthetic-fixture',async()=>{calls++;return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({translation})}}]});});
 const result=await adapter.translate(original,'en','ru');assert.equal(calls,1);assert.equal(result.ok,false);assert.equal(result.error.code,'TranslationUnavailable');
});
test('F3R1 O-D04 actual Node server stops an over-budget chunked request before EOF',async t=>{
 const limit=12582912,total=limit+1000000;let received=0,responded=false;
 const server=createNodeServer();server.on('request',request=>request.on('data',chunk=>{received+=chunk.length;}));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const request=httpRequest({hostname:'127.0.0.1',port:server.address().port,path:'/api/v1/commands',method:'POST',headers:{authorization:'Bearer opaque','content-type':'application/json'}});
 t.after(()=>request.destroy());request.on('error',()=>{});
 const response=new Promise((resolve,reject)=>{request.once('response',message=>{responded=true;const chunks=[];message.on('data',chunk=>chunks.push(chunk));message.on('end',()=>resolve({status:message.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())}));message.on('error',reject);});});
 const block=Buffer.alloc(32768,97);let sent=0;
 while(sent<total&&!responded){const chunk=block.subarray(0,Math.min(block.length,total-sent));sent+=chunk.length;if(!request.write(chunk))await Promise.race([once(request,'drain').catch(()=>{}),response]);await delay(1);}
 await Promise.race([response,delay(250)]);const beforeEOF=responded;if(!request.destroyed)request.end();
 const result=await Promise.race([response,delay(3000).then(()=>{throw new Error('No transport response');})]);
 assert.equal(result.status,400);assert.deepEqual(result.body,{ok:false,error:{code:'BadRequest'}});
 assert.equal(beforeEOF,true,'The size error must not wait for client EOF');assert.ok(received<total);assert.ok(received<=limit+65536);
});
test('F3R1 O-D05 rejects oversized UTF-8 storage before any D1 write batch',async()=>{
 const db=new LocalDatabase(),repository=new D1AtomicRepository(db),h=harness();
 assert.equal((await repository.transact('seed','fixture','seed','return',s=>{Object.assign(s,h.repository.state);return ok(null);})).ok,true);
 const batch=db.batch.bind(db);let writes=0;db.batch=async statements=>{if(statements.some(s=>s.sql.startsWith('UPDATE repository_meta')))writes++;return batch(statements);};
 const result=await repository.transact('too-large','actor','signature','return',s=>{s.users.client.displayName='\u0e01'.repeat(700000);return ok(null);});
 assert.equal(result.ok,false);assert.equal(result.error.code,'RepositoryUnavailable');assert.equal(writes,0);
 assert.equal((await repository.read()).users.client.displayName,'client');assert.equal(await repository.replay('too-large','actor','signature',()=>ok()),null);
});
