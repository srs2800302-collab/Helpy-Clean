import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {randomUUID,randomBytes} from 'node:crypto';
import {capacityCases} from './d1-capacity-contract.mjs';
const require=createRequire(import.meta.url),cli=path.join(path.dirname(require.resolve('wrangler/package.json')),'bin/wrangler.js'),plan=process.argv.includes('--plan');
const available=['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','F3_PROBE_D1_ID'].every(key=>process.env[key]);
const summary={remoteD1Capacity:'OWNER_ACCEPTANCE_PENDING',syntheticOnly:true};
if(plan||available){
 const directory=await mkdtemp(path.join(tmpdir(),'helpy-f3r1-capacity-')),config=path.join(directory,'wrangler.jsonc'),name=`helpy-f3-capacity-${randomUUID().slice(0,8)}`;
 const token=randomBytes(32).toString('hex');let deployed=false;
 const run=(args,input)=>execFileSync(process.execPath,[cli,...args,'--config',config],{cwd:directory,env:{...process.env,WRANGLER_SEND_METRICS:'false'},encoding:'utf8',input,stdio:['pipe','pipe','pipe'],timeout:120000});
 try {
  await writeFile(config,JSON.stringify({name,main:new URL('./d1-capacity-worker.mjs',import.meta.url).pathname,compatibility_date:'2026-11-19',workers_dev:true,
   ...(available?{account_id:process.env.CLOUDFLARE_ACCOUNT_ID}:{}),d1_databases:[{binding:'DB',database_name:'helpy',database_id:process.env.F3_PROBE_D1_ID??'00000000-0000-0000-0000-000000000000'}]}));
  if(plan){run(['deploy','--dry-run']);summary.preparedCapacityBundle='PASS';}
  else {
   run(['deploy']);deployed=true;run(['secret','put','F3_PROBE_TOKEN'],token);
   const account=await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers/subdomain`,{headers:{authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`},signal:AbortSignal.timeout(30000)});
   assert.equal(account.status,200,'Cloudflare account lookup failed');const value=await account.json();assert.equal(value.success,true);assert.equal(typeof value.result?.subdomain,'string');
   const base=`https://${name}.${value.result.subdomain}.workers.dev`,reports=[];
   for(const scenario of capacityCases){
    let response;for(let attempt=0;attempt<10;attempt++){try{response=await fetch(`${base}/${scenario}`,{method:'POST',headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(90000)});if(response.status!==404)break;}catch{}await new Promise(resolve=>setTimeout(resolve,2000));}
    assert.equal(response?.status,200,`D1 capacity ${scenario} failed`);const report=await response.json();assert.equal(report.status,'PASS');reports.push(report);
   }
   summary.remoteD1Capacity='PASS';summary.scenarios=reports;
  }
 }finally{try{if(deployed)run(['delete','--force']);}finally{await rm(directory,{recursive:true,force:true});}}
}
console.log(JSON.stringify(summary,null,2));
