import {D1AtomicRepository} from '../../dist/infrastructure/d1/d1-atomic-repository.js';
import {d1ValueMaxBytes,d1RowMaxBytes,d1PlatformMaxBytes} from '../../dist/infrastructure/d1/d1-limits.js';
import {pack} from '../../dist/infrastructure/d1/d1-codec.js';

export const capacityCases=['value-near-platform','value-over-platform','row-near-platform','row-over-platform','app-utf8','app-row','app-receipt'];
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const ok=value=>({ok:true,value});

export async function runD1CapacityCase(db,name,{observePlatform=false}={}){
 check(capacityCases.includes(name),'Unknown capacity scenario');
 const marker=`f3-capacity-probe:${crypto.randomUUID()}`;
 if(name.startsWith('app-')){
  let writes=0,updates=0;
  const proxy={prepare(sql){return {sql,statement:db.prepare(sql),bind(...values){return {...this,statement:this.statement.bind(...values)};}};},
   async batch(statements){
    if(statements.some(statement=>!/^\s*SELECT\b/i.test(statement.sql))){writes++;throw new Error('Preflight reached write batch');}
    return db.batch(statements.map(statement=>statement.statement));
   }};
  const repository=new D1AtomicRepository(proxy),signature=name==='app-receipt'?'s'.repeat(d1ValueMaxBytes+1):'synthetic-signature';
  const result=await repository.transact(marker,'synthetic-probe',signature,'return',state=>{
   updates++;
   if(name!=='app-receipt')state.feedback[marker]={id:marker,authorId:name==='app-row'?'a'.repeat(800000):'synthetic-probe',
    original:name==='app-utf8'?'\u0e01'.repeat(Math.floor(d1ValueMaxBytes/3)+1):'x'.repeat(800000),at:0};
   return ok(null);
  });
  check(updates===1,'The Domain callback was not exercised');
  check(!result.ok&&result.error.code==='RepositoryUnavailable','Expected typed capacity rejection');
  check(writes===0,'Write batch reached on capacity refusal');
  const receipts=await db.prepare('SELECT count(*) AS n FROM operation_receipts WHERE operation_id=?').bind(marker).all();
  check(receipts.results[0].n===0,'Capacity refusal created a receipt');
  return {scenario:name,status:'PASS',writeBatches:writes,updates,valueLimit:d1ValueMaxBytes,rowLimit:d1RowMaxBytes};
 }
 const row=name.startsWith('row-'),expected=!name.includes('-over-');
 const keyBytes=row?900000:marker.length,valueBytes=row?(expected?1099000:1100100):(expected?1999000:2000001);
 const key=marker+'k'.repeat(keyBytes-marker.length),empty=pack(''),payload=pack('x'.repeat(valueBytes-empty.length));
 check(new TextEncoder().encode(payload).byteLength===valueBytes,'Probe byte count');
 let accepted=false;
 try {
  try{await db.prepare('INSERT INTO infrastructure_settings (setting_key,value_payload,revision) VALUES (?,?,1)').bind(key,payload).run();accepted=true;}catch{}
  if(!observePlatform)check(accepted===expected,`${name}: platform accepted=${accepted}, expected=${expected}, keyBytes=${keyBytes}, valueBytes=${valueBytes}`);
  if(accepted){const stored=await db.prepare('SELECT length(CAST(value_payload AS BLOB)) AS n FROM infrastructure_settings WHERE setting_key=?').bind(key).first();check(stored.n===valueBytes,'Stored byte count');}
  return {scenario:name,status:accepted===expected?'PASS':'LOCAL_PLATFORM_DIFFERENCE',accepted,expected,keyBytes,valueBytes,platformLimit:d1PlatformMaxBytes};
 }finally{await db.prepare('DELETE FROM infrastructure_settings WHERE setting_key=?').bind(key).run();}
}
