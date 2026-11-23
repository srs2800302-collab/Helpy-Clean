import assert from 'node:assert/strict';import test from 'node:test';
import {prepare} from './f3-operation-fixtures.generated.mjs';import {LocalDatabase} from './f3-d1-harness.mjs';
import {D1AtomicRepository} from '../dist/infrastructure/d1/d1-atomic-repository.js';import {DomainCore} from '../dist/application/domain-core.js';
import {sameFact} from '../dist/domain/provenance.js';import {handleHttp} from '../dist/transport/http-handler.js';
import {commandFields,queryFields,methodRoutes,encodeWire} from '@helpy/contracts';
import {accountCandidateId,createAccountAccess} from '../dist/infrastructure/cloudflare/account-access.js';
const ok=value=>({ok:true,value});
const post=(path,body,session)=>({method:'POST',path,headers:{authorization:`Bearer ${session}`,'content-type':'application/json'},body:new TextEncoder().encode(JSON.stringify(encodeWire(body)))});
for(const [kind,names] of [['command',Object.keys(commandFields)],['query',Object.keys(queryFields)],['method',Object.keys(methodRoutes)]])for(const name of names)
test(`F3 E2E operation ${kind}/${name}: shared wire -> Application -> Domain -> D1 -> replay`,async()=>{
 const f=await prepare(kind,name),db=new LocalDatabase(),repo=new D1AtomicRepository(db);
 assert.equal((await repo.transact('fixture-seed','fixture','seed','return',s=>{Object.assign(s,f.h.repository.state);return ok(null);})).ok,true);
 const ports={...f.h.ports,repository:repo},core=new DomainCore(ports),app={ports,core,photos:{},accountAccess:createAccountAccess(ports)};
 let path,body;
 if(kind==='command'){path='/api/v1/commands';body={operationId:'matrix-operation',command:f.input};}
 else if(kind==='query'){path='/api/v1/queries';body={query:f.input};}
 else {
   path=methodRoutes[name];
   if(name==='login'||name==='recover')body={method:name,proof:f.args[0],operationId:f.args[2]};
   else if(name==='translateMessage')body={messageId:f.args[1],target:f.args[2]};
   else if(name==='draftTranslation')body={original:f.args[1],source:f.args[2],target:f.args[3]};
   else body={eventId:f.args[1],recipientId:f.args[2],channel:f.args[3],operationId:f.args[4]};
 }
 const candidate=name==='login'&&kind==='method'?await accountCandidateId(f.h.claims.get(f.args[0])):null;
 const expectedInvoke=()=>candidate?f.h.core.authenticate(f.args[0],candidate,f.args[2],false):f.invoke();
 const expected=await expectedInvoke();assert.equal(expected.ok,true,JSON.stringify(encodeWire(expected)));
 const actual=await handleHttp(post(path,body,f.session),app);assert.equal(actual.status,200,JSON.stringify(actual));assert.equal(actual.body.ok,true);
 assert.ok(sameFact(await repo.read(),await f.h.repository.read()),'D1 result must preserve every accepted F2 fact');
 if(kind==='query')assert.deepEqual(actual.body.value,encodeWire(expected.value));
 if(kind==='command')assert.equal(actual.body.value.kind,expected.value.outcome.kind);
 const expectedReplay=await expectedInvoke(),replay=await handleHttp(post(path,body,f.session),app);
 assert.equal(replay.body.ok,expectedReplay.ok,JSON.stringify({replay,expectedReplay:encodeWire(expectedReplay)}));
 if(!expectedReplay.ok)assert.equal(replay.body.error.code,expectedReplay.error.code);
 assert.ok(sameFact(await new D1AtomicRepository(db).read(),await f.h.repository.read()),'Restart/replay must retain the same accepted facts');
 assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 for(const exported of f.exports.filter(e=>e.port==='translation')) {
   const text=JSON.stringify(exported.values);
   for(const privateValue of ['PRIVATE EXACT ADDRESS','Exact private address','@test.invalid'])assert.ok(!text.includes(privateValue),'Addresses and contacts are never translation input');
 }
 if(kind!=='method'||!['login','recover'].includes(name)){
   const unauthorized=post(path,body,f.session);delete unauthorized.headers.authorization;assert.equal((await handleHttp(unauthorized,app)).status,401);
 }
});
