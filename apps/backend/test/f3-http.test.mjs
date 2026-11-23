import assert from 'node:assert/strict';import test from 'node:test';import {once} from 'node:events';
import {request as rawRequest} from 'node:http';
import {readFile} from 'node:fs/promises';import {harness} from './f2-harness.mjs';
import {handleHttp} from '../dist/transport/http-handler.js';import {createNodeServer} from '../dist/infrastructure/node-server.js';
import {encodeWire,commandFields,queryFields,methodRoutes} from '@helpy/contracts';
import {DomainCore} from '../dist/application/domain-core.js';import {D1AtomicRepository} from '../dist/infrastructure/d1/d1-atomic-repository.js';
import {LocalDatabase} from './f3-d1-harness.mjs';
import {serveRequest} from '../dist/infrastructure/cloudflare/http-runtime.js';
const ok=value=>({ok:true,value});
const request=(path,value,session='client:client')=>({method:'POST',path,headers:{authorization:`Bearer ${session}`,'content-type':'application/json'},body:new TextEncoder().encode(JSON.stringify(value))});
test('F3 all 55 commands and five methods reach their application entry with no internals exported',async()=>{
 const h=harness(),calls=[];
 const fixture=JSON.parse(await readFile(new URL('../../../packages/contracts/fixtures/f3-api.json',import.meta.url),'utf8'));
 const app={ports:h.ports,photos:{},core:{
  async execute(session,id,command){calls.push(command.type);assert.equal(session,'client:client');return ok({outcome:{kind:'recorded',id:'synthetic'},events:[{proof:'must not leak'}]});},
  async authenticate(...args){calls.push(args[3]?'recover':'login');return ok({...h.repository.state.users.client,identities:[{subject:'must not leak'}]});},
  async translateMessage(){calls.push('translateMessage');return ok({original:'synthetic',translation:'synthetic'});},
  async draftTranslation(){calls.push('draftTranslation');return ok({candidate:'synthetic',approved:false});},
  async dispatchNotification(){calls.push('dispatchNotification');return ok('delivered');},
 }};
 app.accountAccess=(proof,operationId,recovery)=>app.core.authenticate(proof,'server-selected-user',operationId,recovery);
 for(const input of fixture.commands){
   const command={...input};if(command.type==='publish_policy')command.policy=encodeWire(h.config);
   const r=await handleHttp(request('/api/v1/commands',{operationId:`wire:${command.type}`,command}),app);
   assert.equal(r.status,200,JSON.stringify({command,r}));assert.deepEqual(r.body,{ok:true,value:{kind:'recorded',id:'synthetic'}});
 }
 for(const method of ['login','recover']){
   const r=await handleHttp(request('/api/v1/account/access',{method,proof:'opaque',operationId:method}),app);assert.equal(r.status,200);assert.ok(!JSON.stringify(r.body).includes('identities'));assert.ok(!JSON.stringify(r.body).includes('@'));
 }
 for(const [path,body] of [['/api/v1/translations/message',{messageId:'m',target:'ru'}],['/api/v1/translations/draft',{original:'synthetic',source:'en',target:'ru'}],['/api/v1/notifications/dispatch',{eventId:'e',recipientId:'u',channel:'c',operationId:'o'}]])assert.equal((await handleHttp(request(path,body),app)).status,200);
 assert.equal(calls.length,60);assert.equal(new Set(calls).size,60);assert.equal(Object.keys(commandFields).length+Object.keys(queryFields).length+Object.keys(methodRoutes).length,75);
});
test('F3 all 15 queries execute accepted Application views over materialized D1; privacy follows F2',async()=>{
 const h=harness();await h.completed('card');await h.completed('cash','cash-job');
 await h.ok('master:master',{type:'request_repayment',id:'request',amount:100n,confirmed:true});
 await h.ok('admin',{type:'inbox',id:'inbox',recipientId:'client',original:'Synthetic inbox'});await h.published('feed-job');
 const db=new LocalDatabase(),repo=new D1AtomicRepository(db);assert.equal((await repo.transact('seed','fixture','seed','return',s=>{Object.assign(s,h.repository.state);return ok(null);})).ok,true);
 const ports={...h.ports,repository:repo},app={ports,core:new DomainCore(ports),photos:{}};
 const inputs={feed:[{type:'feed'},'master:master'],job:[{type:'job',jobId:'job'}],payment:[{type:'payment',jobId:'job'}],debt:[{type:'debt',masterId:'master'},'master:master'],
 cash_availability:[{type:'cash_availability',masterId:'master'}],information:[{type:'information',catalogKey:'test-catalog:1',targets:[],locale:'en'}],
 published_text:[{type:'published_text',catalogKey:'test-catalog:1',textId:'category:appliance',locale:'en'}],chat_history:[{type:'chat_history',chatId:'chat:job:master'}],history:[{type:'history'}],
 reputation:[{type:'reputation',masterId:'master'}],contacts:[{type:'contacts',userId:'client'}],role_counts:[{type:'role_counts'},'admin'],repayment:[{type:'repayment',requestId:'request'},'master:master'],payout:[{type:'payout',jobId:'job'},'master:master'],inbox:[{type:'inbox'}]};
 for(const [name,[query,session='client:client']] of Object.entries(inputs)){
   const r=await handleHttp(request('/api/v1/queries',{query},session),app);assert.equal(r.status,200,`${name}: ${JSON.stringify(r)}`);assert.equal(r.body.value.type,name);
   assert.ok(!JSON.stringify(r.body).includes('proof'));if(name==='feed')assert.ok(!JSON.stringify(r.body).includes('PRIVATE EXACT ADDRESS'));
 }
 const forbidden=await handleHttp(request('/api/v1/queries',{query:{type:'contacts',userId:'master'}}),app);assert.equal(forbidden.status,401);
});
test('F3 transport status mapping and security envelopes never expose stack/detail/provider body',async()=>{
 const h=harness(),app={ports:h.ports,core:{},photos:{}};
 for(const [code,status] of [['Unauthorized',401],['NotFound',404],['Conflict',409],['IdentityOccupied',409],['ClaimConsumed',409],['StaleRevision',409],['InvalidMoney',422],['RepositoryUnavailable',503],['RepositoryOutcomeUnknown',503]]){
   app.core.execute=async()=>({ok:false,error:{code,detail:'private-provider-secret'}});
   const r=await handleHttp(request('/api/v1/commands',{operationId:'o',command:{type:'complete',jobId:'j'}}),app);assert.equal(r.status,status);assert.deepEqual(r.body,{ok:false,error:{code}});
 }
 app.core.execute=async()=>{throw new Error('private-stack');};assert.equal((await handleHttp(request('/api/v1/commands',{operationId:'o',command:{type:'complete',jobId:'j'}}),app)).status,500);
 const bad=request('/api/v1/commands',{operationId:'o',command:{type:'complete',jobId:'j'},admin:true});assert.equal((await handleHttp(bad,app)).status,400);
 bad.body=new TextEncoder().encode('{');assert.equal((await handleHttp(bad,app)).status,400);
 bad.headers['content-type']='text/plain';assert.equal((await handleHttp(bad,app)).status,415);
 delete bad.headers.authorization;assert.equal((await handleHttp(bad,app)).status,401);
 assert.equal((await handleHttp({method:'DELETE',path:'/api/v1/commands'},app)).status,405);
 assert.equal((await handleHttp({method:'GET',path:'/missing'},app)).status,404);
});
test('F3 real Node HTTP and Worker request adapter preserve the same wire contract',async t=>{
 const h=harness(),app={core:h.core,ports:h.ports,photos:{}};const server=createNodeServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`;
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 for(const [path,body,method] of [['/health',undefined,'GET'],['/api/v1/queries',{query:{type:'role_counts'}},'POST'],['/api/v1/commands',{operationId:'locale',command:{type:'locale',locale:'ru'}},'POST'],['/missing',undefined,'GET']]){
   const init={method,headers:{authorization:'Bearer client:client','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})};
   const node=await fetch(`${base}${path}`,init),worker=await serveRequest(new Request(`https://fixture.invalid${path}`,init),app);
   assert.equal(node.status,worker.status);assert.deepEqual(await node.json(),await worker.json());
 }
 const body=JSON.stringify({operationId:'duplicate-auth',command:{type:'locale',locale:'en'}});
 const response=await new Promise((resolve,reject)=>{
  const request=rawRequest(`${base}/api/v1/commands`,{method:'POST',headers:{authorization:['Bearer client:client','Bearer stranger:client'],'content-type':'application/json'}},response=>{
   const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())}));
  });request.on('error',reject);request.end(body);
 });
 assert.equal(response.status,401);assert.deepEqual(response.body,{ok:false,error:{code:'Unauthorized'}});
});
