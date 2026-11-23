import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalDatabase } from './f3-d1-harness.mjs';
import { harness,user } from './f2-harness.mjs';
import { D1AtomicRepository } from '../dist/infrastructure/d1/d1-atomic-repository.js';
import { project, materialize, stateTables } from '../dist/infrastructure/d1/d1-projection.js';
import { pack, unpack } from '../dist/infrastructure/d1/d1-codec.js';
import { sameFact } from '../dist/domain/provenance.js';
import { DomainCore } from '../dist/application/domain-core.js';
const ok=value=>({ok:true,value});
const deny=()=>({ok:false,error:{code:'Unauthorized',detail:'private'}});
async function seeded(state) {const db=new LocalDatabase(),repo=new D1AtomicRepository(db);assert.equal((await repo.transact('seed','fixture','seed','return',s=>{Object.assign(s,state);return ok(null);})).ok,true);return {db,repo};}
test('F3 codec rejects malformed/version/unknown tags and preserves bigint/NULL/absence/prototype IDs',()=>{
  const value={amount:9007199254740993123456789n,null:null,missing:undefined,zero:0n,array:[3,2,1],...Object.fromEntries([['__proto__',{x:true}]])};
  assert.ok(sameFact(unpack(pack(value)),value));
  for(const input of ['{}','{"version":2,"value":["null"]}','{"version":1,"value":["unknown"]}','{"version":1,"value":["bigint","01"]}'])assert.throws(()=>unpack(input));
});
test('F3 projection round trips complete cash/card workflows and 68-category fixture through 31 tables',async()=>{
  assert.equal(stateTables.length,31);
  for(const method of ['cash','card']) {
    const h=harness();await h.completed(method);await h.ok('client:client',{type:'review',jobId:'job',id:'review',stars:5,marks:[],comment:'Test'});
    await h.ok('admin',{type:'threshold',masterId:'master2',amount:0n});
    await h.ok('admin',{type:'threshold',masterId:'master',amount:1000n});
    await h.ok('admin',{type:'threshold',masterId:'master',amount:null});
    const state=await h.repository.read();
    assert.ok(sameFact(materialize(project(state)),state));
    const {db,repo}=await seeded(state);assert.ok(sameFact(await repo.read(),state));
    assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.ok(sameFact(await new D1AtomicRepository(db).read(),state));
  }
  const h=harness();for(let i=0;i<60;i++)h.repository.state.published[h.repository.state.current].categories.push({...h.fixture.categories[0],id:`extra${i}`});
  const {repo}=await seeded(h.repository.state);assert.equal((await repo.read()).published[h.repository.state.current].categories.length,68);
});
test('F3 AtomicRepository access-first replay, conflicts, detached results, success-only receipt, lost ack',async()=>{
  const {db,repo}=await seeded(harness().repository.state);
  const run=()=>repo.transact('locale','client','sig','return',s=>{s.users.client.locale='ru';return ok(s.users.client);});
  const first=await run();assert.equal(first.ok,true);first.value.locale='changed';assert.equal((await repo.read()).users.client.locale,'ru');
  assert.deepEqual(await repo.replay('locale','client','sig',deny),deny());
  assert.equal((await repo.transact('locale','client','sig','reject',()=>ok(null))).error.code,'Conflict');
  assert.equal((await repo.replay('locale','other','sig',()=>ok())).error.code,'Conflict');
  const before=await repo.read();await repo.transact('failed','client','sig','return',s=>{s.users.client.locale='no';return deny();});
  assert.ok(sameFact(await repo.read(),before));assert.equal(await repo.replay('failed','client','sig',()=>ok()),null);
  db.loseAck=true;
  assert.equal((await repo.transact('ack','client','ack','return',s=>{s.users.client.locale='th';return ok('saved');})).value,'saved');
  assert.equal((await new D1AtomicRepository(db).replay('ack','client','ack',()=>ok())).value,'saved');
});
test('F3 global revision serializes concurrent callers with no lost updates and finite exhaustion',async()=>{
  const {db,repo}=await seeded(harness().repository.state);
  const results=await Promise.all(Array.from({length:16},(_,i)=>new D1AtomicRepository(db).transact(`op${i}`,'actor',`sig${i}`,'return',s=>{s.users.client.displayName+='x';return ok(i);})));assert.ok(results.every(r=>r.ok));
  assert.equal((await repo.read()).users.client.displayName,'client'+'x'.repeat(16));
  assert.equal(db.sqlite.prepare('SELECT revision FROM repository_meta').get().revision,17);
  assert.equal(db.sqlite.prepare('SELECT commit_token FROM repository_meta').get().commit_token,null);
  db.fail=true;assert.equal((await repo.transact('out','a','s','return',()=>ok())).error.code,'RepositoryUnavailable');
});
test('F3 claimDelivery has exactly one concurrent winner, increments revision once and never resends unknown',async()=>{
  const h=harness();await h.published();await h.offer();const event=h.repository.state.events.find(e=>e.type==='initial_offer_sent');
  h.repository.state.deliveries.delivery={id:'delivery',eventId:event.id,recipientId:'client',recipientRole:'client',channel:'test-channel',attempt:1,status:'requested'};
  const {db,repo}=await seeded(h.repository.state);
  const results=await Promise.all(Array.from({length:12},()=>new D1AtomicRepository(db).claimDelivery('delivery')));
  assert.equal(results.filter(r=>r.ok&&r.value===true).length,1);assert.equal(results.filter(r=>r.ok&&r.value===false).length,11);
  assert.equal(db.sqlite.prepare('SELECT revision FROM repository_meta').get().revision,2);
  assert.equal((await repo.read()).deliveries.delivery.status,'pending');assert.deepEqual(await repo.claimDelivery('missing'),ok(false));
  db.sqlite.exec("UPDATE deliveries SET status='requested' WHERE delivery_id='delivery'");db.loseAck=true;
  assert.equal((await repo.claimDelivery('delivery')).error.code,'RepositoryOutcomeUnknown');assert.deepEqual(await repo.claimDelivery('delivery'),ok(false));
});
test('F3 large Unicode receipt survives SQL chunk storage and restart without splitting surrogate pairs',async()=>{
 const {db,repo}=await seeded(harness().repository.state),value='\ud83d\ude00'.repeat(20000);
 assert.equal((await repo.transact('large','actor','signature','return',()=>ok(value))).value,value);
 assert.ok(db.sqlite.prepare("SELECT count(*) AS n FROM operation_receipts WHERE operation_id='large'").get().n>1);
 assert.equal((await new D1AtomicRepository(db).replay('large','actor','signature',()=>ok())).value,value);
 db.sqlite.exec("UPDATE operation_receipts SET payload_chunk='broken' WHERE operation_id='large' AND chunk_index=0");
 await assert.rejects(()=>repo.replay('large','actor','signature',()=>ok()),e=>e.code==='RepositoryUnavailable');
});
test('F3 physical batch failure rolls back revision, row changes and all receipt chunks',async()=>{
 const {db,repo}=await seeded(harness().repository.state),before=await repo.read(),revision=db.sqlite.prepare('SELECT revision FROM repository_meta').get().revision;
 const result=await repo.transact('broken','actor','signature','return',s=>{s.users.client.email=s.users.master.email;return ok('never saved');});
 assert.equal(result.error.code,'RepositoryUnavailable');assert.ok(sameFact(await repo.read(),before));
 assert.equal(db.sqlite.prepare('SELECT revision FROM repository_meta').get().revision,revision);
 assert.equal(await repo.replay('broken','actor','signature',()=>ok()),null);
});
test('F3 finite contention exhaustion is repository-level, never a public F2 StaleRevision or partial write',async()=>{
 const {db,repo}=await seeded(harness().repository.state),batch=db.batch.bind(db);let conflicts=0;
 db.batch=async statements=>{
  if(statements.some(s=>s.sql.startsWith('INSERT INTO operation_receipts')&&s.values[0]==='starved')) {
   conflicts++;assert.equal((await new D1AtomicRepository(db).transact(`contender-${conflicts}`,'other','sig','return',()=>ok(null))).ok,true);
  }
  return batch(statements);
 };
 const result=await new D1AtomicRepository(db,2).transact('starved','actor','sig','return',s=>{s.users.client.locale='ru';return ok(null);});
 assert.equal(result.error.code,'RepositoryUnavailable');assert.equal(conflicts,2);assert.equal((await repo.read()).users.client.locale,'en');
 assert.equal(await repo.replay('starved','actor','sig',()=>ok()),null);
});
test('F3 updates retain observable F2 offer ordering when later transitions emit multiple immutable events',async()=>{
 const h=harness();h.repository.state.users.master3=user('master3','master');await h.published();
 const {repo}=await seeded(h.repository.state),core=new DomainCore({...h.ports,repository:repo});
 const steps=[];
 for(const master of ['master','master2','master3'])steps.push([`${master}:master`,{type:'initial_offer',jobId:'job',id:`offer:${master}`,chatId:`chat:${master}`}]);
 steps.push(['client:client',{type:'message',chatId:'chat:master',id:'message:c',original:'work',photoIds:[],sender:'user'}]);
 steps.push(['master:master',{type:'message',chatId:'chat:master',id:'message:m',original:'work',photoIds:[],sender:'user'}]);
 steps.push(['master:master',{type:'revise_price',jobId:'job',masterId:'master',amount:1100n,reason:'Discussed',confirmed:true}]);
 steps.push(['master2:master',{type:'final_application',jobId:'job',masterId:'master2',amount:1000n,recipientId:'client',confirmed:true}]);
 steps.push(['client:client',{type:'select_master',jobId:'job',masterId:'master2',amount:1000n,confirmed:true}]);
 let index=0;
 for(const [session,command] of steps){const id=`ordering:${++index}`,expected=await h.execute(session,command,id),actual=await core.execute(session,id,command);assert.equal(expected.ok,true);assert.ok(sameFact(actual,expected));assert.ok(sameFact(await repo.read(),await h.repository.read()));}
});
