import assert from 'node:assert/strict';import test from 'node:test';import {readFile} from 'node:fs/promises';
import {getPlatformProxy,unstable_splitSqlQuery} from 'wrangler';
import {capacityCases,runD1CapacityCase} from './probes/d1-capacity-contract.mjs';
test('F3R1 actual workerd D1 UTF-8/row boundaries and zero-write preflight near platform capacity',async t=>{
 const platform=await getPlatformProxy({configPath:new URL('../wrangler.jsonc',import.meta.url).pathname,persist:false,remoteBindings:false,envFiles:[]});t.after(()=>platform.dispose());
 const db=platform.env.DB,migration=await readFile(new URL('../migrations/0001_f3_base.sql',import.meta.url),'utf8');
 await db.batch(unstable_splitSqlQuery(migration).map(sql=>db.prepare(sql)));
 const observations=[];
 for(const name of capacityCases){
  const result=await runD1CapacityCase(db,name,{observePlatform:true});
  if(name.startsWith('app-')){assert.equal(result.status,'PASS');assert.equal(result.writeBatches,0);}
  else {
   // This pinned local implementation accepts >2,000,000 bytes. Record that
   // difference explicitly; only the strict authorized probe certifies remote D1.
   assert.equal(result.accepted,true);assert.equal(result.status,name.includes('-over-')?'LOCAL_PLATFORM_DIFFERENCE':'PASS');observations.push(result);
  }
 }
 console.log(JSON.stringify({localWorkerdCapacity:observations,remoteD1Certified:false}));
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM infrastructure_settings').first()).n,1);
 assert.equal((await db.prepare('SELECT revision FROM repository_meta').first()).revision,0);
});
