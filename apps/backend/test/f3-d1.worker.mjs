import assert from 'node:assert/strict';import test from 'node:test';import {readFile,mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {getPlatformProxy,unstable_splitSqlQuery} from 'wrangler';import {harness} from './f2-harness.mjs';
import {scope} from './f2-fixtures.mjs';
import {D1AtomicRepository} from '../dist/infrastructure/d1/d1-atomic-repository.js';
import {DomainCore} from '../dist/application/domain-core.js';import {sameFact} from '../dist/domain/provenance.js';
import {R2PhotoStore,photoMetadataLookup} from '../dist/infrastructure/media/r2-photo-store.js';import {D1PhotoMetadataStore} from '../dist/infrastructure/d1/d1-photo-metadata-store.js';
test('F3 real local workerd/D1 binding: schema, atomic state, receipt, restart, concurrency and Application command',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'helpy-f3-restart-'));
 const options={configPath:new URL('../wrangler.jsonc',import.meta.url).pathname,persist:{path:directory},remoteBindings:false,envFiles:[]};
 let platform=await getPlatformProxy(options);
 t.after(async()=>{await platform.dispose();await rm(directory,{recursive:true,force:true});});const db=platform.env.DB;
 const migration=await readFile(new URL('../migrations/0001_f3_base.sql',import.meta.url),'utf8');
 const statements=unstable_splitSqlQuery(migration);
 await db.batch(statements.map(sql=>db.prepare(sql)));
 const tables=await db.prepare('PRAGMA table_list').all();assert.equal(tables.results.filter(t=>!t.name.startsWith('sqlite_')&&!t.name.startsWith('_cf_')).length,35);
 const h=harness(),repo=new D1AtomicRepository(db);const seed=await repo.transact('seed','fixture','seed','return',s=>{Object.assign(s,h.repository.state);return {ok:true,value:null};});assert.equal(seed.ok,true,JSON.stringify(seed));
 assert.ok(sameFact(await repo.read(),h.repository.state));
 const objects=new R2PhotoStore(platform.env.PHOTO_BUCKET),bytes=new Uint8Array([1,2,3]);
 const created=await Promise.all(Array.from({length:8},()=>objects.create('native-r2-photo',bytes,'same synthetic signature')));assert.ok(created.every(r=>r.ok));
 assert.equal((await objects.create('native-r2-photo',bytes,'different signature')).error.code,'Conflict');
 assert.deepEqual(await objects.read('native-r2-photo'),bytes);
 const metadata=new D1PhotoMetadataStore(repo),photo={id:'native-r2-photo',ownerId:'client',format:'image/webp',businessRef:{kind:'profile',id:'client'},present:true};
 assert.equal((await metadata.register('native-r2-registration','client','same synthetic signature',photo,()=>({ok:true,value:undefined}))).ok,true);
 assert.equal((await photoMetadataLookup(metadata,objects).lookup(['native-r2-photo'])).value[0].present,true);
 const ports={...h.ports,repository:repo},core=new DomainCore(ports);
 const command={type:'locale',locale:'ru'};const r=await core.execute('client:client','locale',command);assert.equal(r.ok,true,JSON.stringify(r));
 assert.equal((await new D1AtomicRepository(db).read()).users.client.locale,'ru');
 assert.deepEqual(await core.execute('client:client','locale',command),r);
 const workflow=[
  ['client:client',{type:'new_job',id:'native-job',draft:{items:[scope(h.fixture)],cep:1000n,publicAddress:'SYNTHETIC PUBLIC DISTRICT STREET',address:'SYNTHETIC PRIVATE ADDRESS'}}],
  ['client:client',{type:'publish_job',jobId:'native-job'}],
  ['master:master',{type:'initial_offer',jobId:'native-job',id:'native-offer',chatId:'native-chat'}],
  ['master:master',{type:'final_application',jobId:'native-job',masterId:'master',amount:1000n,recipientId:'client',confirmed:true}],
  ['client:client',{type:'select_master',jobId:'native-job',masterId:'master',amount:1000n,confirmed:true}],
  ['client:client',{type:'cash',jobId:'native-job'}],
  ['client:client',{type:'accept_work',jobId:'native-job',accepted:true,explanation:''}],
  ['master:master',{type:'complete',jobId:'native-job'}],
 ];
 let sequence=0;for(const [session,input] of workflow){const result=await core.execute(session,`native-flow-${++sequence}`,input);assert.equal(result.ok,true,result.ok?'':result.error.code);}
 assert.equal((await repo.read()).debt.master,300n);assert.equal((await repo.read()).jobs['native-job'].state,'completed');
 const concurrent=await Promise.all(Array.from({length:8},(_,i)=>new D1AtomicRepository(db).transact(`race${i}`,'fixture',`sig${i}`,'return',s=>{s.users.client.displayName+='x';return {ok:true,value:i};})));
 assert.ok(concurrent.every(r=>r.ok));assert.equal((await repo.read()).users.client.displayName,'client'+'x'.repeat(8));
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 const before=await repo.read();await platform.dispose();platform=await getPlatformProxy(options);
 const restarted=new D1AtomicRepository(platform.env.DB);assert.ok(sameFact(await restarted.read(),before));
 assert.deepEqual(await new R2PhotoStore(platform.env.PHOTO_BUCKET).read('native-r2-photo'),bytes);
 const replay=await new DomainCore({...ports,repository:restarted}).execute('client:client','locale',command);assert.deepEqual(replay,r);
});
