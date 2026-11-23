import assert from 'node:assert/strict';import test from 'node:test';
import {assertD1Values,assertD1Row,D1CapacityError,d1ValueMaxBytes,d1RowMaxBytes,d1PlatformMaxBytes} from '../dist/infrastructure/d1/d1-limits.js';
import {D1AtomicRepository} from '../dist/infrastructure/d1/d1-atomic-repository.js';
import {D1PhotoMetadataStore} from '../dist/infrastructure/d1/d1-photo-metadata-store.js';
import {stateTables,project} from '../dist/infrastructure/d1/d1-projection.js';
import {LocalDatabase} from './f3-d1-harness.mjs';import {harness} from './f2-harness.mjs';
import {prepare} from './f3-operation-fixtures.generated.mjs';
import {runD1CapacityCase} from './probes/d1-capacity-contract.mjs';
const ok=value=>({ok:true,value});
async function fixture(){const db=new LocalDatabase(),repo=new D1AtomicRepository(db),h=harness();assert.equal((await repo.transact('seed','fixture','seed','return',s=>{Object.assign(s,h.repository.state);return ok(null);})).ok,true);return {db,repo,h};}
test('F3R1 D1 bounds use UTF-8 bytes and BLOB view length, with explicit headroom',()=>{
 assert.ok(d1ValueMaxBytes<d1RowMaxBytes&&d1RowMaxBytes<d1PlatformMaxBytes);
 assert.doesNotThrow(()=>assertD1Values(['x'.repeat(d1ValueMaxBytes),'\u0e01'.repeat(333333),'\ud83d\ude00'.repeat(250000),new Uint8Array(d1ValueMaxBytes),new Uint8Array(d1ValueMaxBytes+10).subarray(5,d1ValueMaxBytes+5)]));
 for(const value of ['x'.repeat(d1ValueMaxBytes+1),'\u0e01'.repeat(333334),'\ud83d\ude00'.repeat(250001),'\ud800','\udc00','a\ud800b',new Uint8Array(d1ValueMaxBytes+1),new ArrayBuffer(d1ValueMaxBytes+1),NaN,Infinity,1.5])assert.throws(()=>assertD1Values([value]),D1CapacityError);
});
test('F3R1 D1 complete-row budget includes unchanged fields and conservative physical overhead',()=>{
 const half=(d1RowMaxBytes-96)/2,row={one:'a'.repeat(half),two:'b'.repeat(half)};
 assert.equal(assertD1Row(row),d1RowMaxBytes);assert.throws(()=>assertD1Row({...row,two:row.two+'x'}),D1CapacityError);
});
test('F3R1 D1 validates every TEXT column in all 31 state table write paths, including serialized payloads',async()=>{
 const samples={};
 const cases=['threshold','bind_contact','translation_correction','complete','message','terminate_negotiation','receive_repayment','decide_resolution','start_settlement','review','hide_history','preferences','inbox','feedback'].map(name=>['command',name]);
 cases.push(['method','dispatchNotification']);
 for(const [kind,name] of cases){
  const f=await prepare(kind,name);assert.equal((await f.invoke()).ok,true);const rows=project(await f.h.repository.read());
  for(const table of stateTables)if(rows[table].length&&!samples[table])samples[table]=rows[table][0];
 }
 assert.deepEqual(Object.keys(samples).sort(),[...stateTables].sort());
 const db=new LocalDatabase(),repo=new D1AtomicRepository(db),empty=Object.fromEntries(stateTables.map(table=>[table,[]])),large='\u0e01'.repeat(333334);let columns=0;
 for(const table of stateTables){
  for(const column of db.sqlite.prepare(`PRAGMA table_info(${table})`).all().filter(c=>c.type==='TEXT')){
   const after={...empty,[table]:[{...samples[table],[column.name]:large}]};assert.throws(()=>repo.diff(empty,after),D1CapacityError,`${table}.${column.name}`);columns++;
  }
 }
 assert.ok(columns>100);assert.equal(db.sqlite.prepare('SELECT revision FROM repository_meta').get().revision,0);
});
test('F3R1 D1 oversized fields, serialized expansion and aggregate rows leave revision/state/receipts unchanged',async()=>{
 const {db,repo}=await fixture(),before=await repo.read(),revision=db.sqlite.prepare('SELECT revision FROM repository_meta').get().revision,batch=db.batch.bind(db);let writes=0;
 db.batch=async statements=>{if(statements.some(s=>s.sql.startsWith('UPDATE repository_meta')))writes++;return batch(statements);};
 const changes=[s=>{s.users.client.displayName='\u0e01'.repeat(333334);},s=>{s.users.client.displayName='a'.repeat(800000);s.users.client.contacts={x:'b'.repeat(800000)};},s=>{s.users.client.contacts={x:'\u0000'.repeat(200000)};}];
 for(let i=0;i<changes.length;i++){const r=await repo.transact(`large-${i}`,'actor','sig','return',s=>{changes[i](s);return ok(null);});assert.equal(r.error.code,'RepositoryUnavailable');assert.equal(await repo.replay(`large-${i}`,'actor','sig',()=>ok()),null);}
 assert.equal(writes,0);assert.deepEqual(await repo.read(),before);assert.equal(db.sqlite.prepare('SELECT revision FROM repository_meta').get().revision,revision);
});
test('F3R1 D1 success receipts validate all repeated metadata and complete chunk rows',async()=>{
 const {db,repo}=await fixture(),batch=db.batch.bind(db);let writes=0;db.batch=async s=>{if(s.some(x=>x.sql.startsWith('UPDATE repository_meta')))writes++;return batch(s);};
 for(const [actor,signature] of [['actor','x'.repeat(d1ValueMaxBytes+1)],['a'.repeat(800000),'s'.repeat(800000)]]){
  const r=await repo.transact('oversized-receipt',actor,signature,'return',s=>{s.users.client.locale='ru';return ok('success');});assert.equal(r.error.code,'RepositoryUnavailable');
 }
 assert.equal(writes,0);assert.equal((await repo.read()).users.client.locale,'en');assert.equal(await repo.replay('oversized-receipt','actor','sig',()=>ok()),null);
 const large='\u0e01'.repeat(800000);assert.equal((await repo.transact('chunked','actor','sig','return',()=>ok(large))).value,large);
 assert.equal((await new D1AtomicRepository(db).replay('chunked','actor','sig',()=>ok())).value,large);
});
test('F3R1 D1 photo rows and receipts share the same physical preflight and never produce false registration',async()=>{
 const {db,repo}=await fixture(),store=new D1PhotoMetadataStore(repo),batch=db.batch.bind(db);let writes=0;db.batch=async s=>{if(s.some(x=>x.sql.startsWith('UPDATE repository_meta')))writes++;return batch(s);};
 const photo={id:'p'.repeat(800000),ownerId:'client',format:'image/webp',businessRef:{kind:'profile',id:'r'.repeat(800000)},present:true};
 const r=await store.register('photo','actor','sig',photo,()=>ok());assert.equal(r.error.code,'RepositoryUnavailable');assert.equal(writes,0);
 assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM photo_metadata').get().n,0);assert.equal(await repo.replay('photo','actor','sig',()=>ok()),null);
});
test('F3R1 D1 capacity contract exercises Domain callbacks but submits no write batch',async()=>{
 for(const name of ['app-utf8','app-row','app-receipt']){const {db}=await fixture();const driver={prepare(sql){const statement=db.prepare(sql);return {...statement,bind(...v){return {...statement,values:v,all:async()=>({success:true,results:db.sqlite.prepare(sql).all(...v)}),run:async()=>db.sqlite.prepare(sql).run(...v)};}};},batch:s=>db.batch(s)};
  const r=await runD1CapacityCase(driver,name);assert.equal(r.status,'PASS');assert.equal(r.writeBatches,0);
 }
});
test('F3R1 D1 malformed raw UTF-16 cannot silently become a different persisted fact',async()=>{
 const {db,repo}=await fixture(),batch=db.batch.bind(db);let writes=0;db.batch=async statements=>{if(statements.some(s=>s.sql.startsWith('UPDATE repository_meta')))writes++;return batch(statements);};
 const r=await repo.transact('ill-formed','actor','sig','return',s=>{s.users.client.displayName='\ud800';return ok(null);});
 assert.equal(r.ok,false);assert.equal(r.error.code,'RepositoryUnavailable');assert.equal(writes,0);assert.equal((await repo.read()).users.client.displayName,'client');assert.equal(await repo.replay('ill-formed','actor','sig',()=>ok()),null);
 // JSON payloads can represent the same code unit losslessly as an escape.
 assert.equal((await repo.transact('escaped','actor','sig','return',s=>{s.users.client.contacts={synthetic:'\ud800'};return ok(null);})).ok,true);
 assert.equal((await repo.read()).users.client.contacts.synthetic,'\ud800');
});
