import assert from 'node:assert/strict';import test from 'node:test';
import {harness} from './f2-harness.mjs';
import {handleHttp} from '../dist/transport/http-handler.js';
import {createAccountAccess,accountCandidateId} from '../dist/infrastructure/cloudflare/account-access.js';
const ok=value=>({ok:true,value});
function setup(){
 const h=harness(),claims=new Map();let verifications=0;
 h.ports.auth.verifyClaim=async proof=>{verifications++;return claims.has(proof)?ok(claims.get(proof)):{ok:false,error:{code:'ContactUnverified',detail:'fixture'}};};
 const app={core:h.core,ports:h.ports,photos:{},accountAccess:createAccountAccess(h.ports)};
 const claim=(id,extra={})=>({id,purpose:'login',identity:{method:'fixture-provider',subject:'synthetic-account-subject'},email:'new@test.invalid',phone:null,ownerId:null,expiresAt:1000,...extra});
 const post=body=>handleHttp({method:'POST',path:'/api/v1/account/access',headers:{'content-type':'application/json'},body:new TextEncoder().encode(JSON.stringify(body))},app);
 return {h,claims,claim,post,verifications:()=>verifications};
}
test('F3R1 account identity is server-selected, repeatable and independent of operation keys',async()=>{
 const f=setup(),one=f.claim('claim-one');f.claims.set('opaque-one',one);
 const first=await f.post({method:'login',proof:'opaque-one',operationId:'client-selected-A'});assert.equal(first.status,200);
 const id=first.body.value.id;assert.equal(id,await accountCandidateId(one));assert.notEqual(id,'user:client-selected-A');assert.equal(f.verifications(),1);
 assert.deepEqual(await f.post({method:'login',proof:'opaque-one',operationId:'client-selected-A'}),first);assert.equal(f.verifications(),2);
 const reused=await f.post({method:'login',proof:'opaque-one',operationId:'client-selected-B'});assert.equal(reused.status,409);assert.equal(reused.body.error.code,'ClaimConsumed');
 f.claims.set('opaque-two',f.claim('claim-two'));
 const changed=await f.post({method:'login',proof:'opaque-two',operationId:'entirely-different-key'});assert.equal(changed.status,200);assert.equal(changed.body.value.id,id);
 assert.equal(Object.values(f.h.repository.state.users).filter(user=>user.identities.some(i=>i.subject===one.identity.subject)).length,1);
 assert.ok(!JSON.stringify([...f.h.repository.receipts.values()]).includes('opaque-one'));
});
test('F3R1 existing identity IDs remain owned by the existing account, not the new candidate',async()=>{
 const f=setup(),claim=f.claim('claim-existing',{email:'client@test.invalid'});f.h.repository.state.users.client.identities=[claim.identity];f.claims.set('existing',claim);
 const r=await f.post({method:'login',proof:'existing',operationId:'chosen'});assert.equal(r.status,200);assert.equal(r.body.value.id,'client');
 assert.equal(Object.keys(f.h.repository.state.users).length,4);
});
test('F3R1 recovery uses verified owner only and retains single-use rejection',async()=>{
 const f=setup();f.claims.set('recover',f.claim('recover-claim',{purpose:'recover',ownerId:'client',email:'client@test.invalid'}));
 const request={method:'recover',proof:'recover',operationId:'recover-key'};
 assert.equal((await f.post({...request,userId:'master'})).status,400);assert.equal(f.verifications(),0);
 const first=await f.post(request);assert.equal(first.status,200);assert.equal(first.body.value.id,'client');
 assert.equal((await f.post(request)).status,409);assert.equal(f.verifications(),2);
});
test('F3R1 invalid, expired, wrong-purpose and occupied claims cannot allocate accounts or receipts',async()=>{
 for(const change of [{expiresAt:100},{purpose:'bind'},{email:'client@test.invalid'}]){
  const f=setup();f.claims.set('claim',f.claim('invalid',change));const before=await f.h.repository.read();
  const result=await f.post({method:'login',proof:'claim',operationId:'key'});assert.equal(result.body.ok,false);assert.deepEqual(await f.h.repository.read(),before);assert.equal(f.h.repository.receipts.size,0);
 }
 const f=setup();for(const field of ['userId','role','permissions','admin','providerIdentity'])assert.equal((await f.post({method:'login',proof:'claim',operationId:'key',[field]:'forged'})).status,400);
 assert.equal(f.verifications(),0);
});
test('F3R1 a redeem-once provider proof is verified once, not twice, for one HTTP request',async()=>{
 const f=setup();let redeemed=false;
 f.h.ports.auth.verifyClaim=async()=>{assert.equal(redeemed,false,'The transport must not redeem a one-time proof twice');redeemed=true;return ok(f.claim('one-time'));};
 const r=await f.post({method:'login',proof:'one-time-opaque',operationId:'key'});assert.equal(r.status,200);assert.equal(redeemed,true);
});
