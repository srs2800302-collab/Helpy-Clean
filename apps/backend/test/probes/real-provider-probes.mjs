import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {randomUUID,randomBytes} from 'node:crypto';
import {TyphoonTranslation} from '../../dist/infrastructure/translation/typhoon-translation.js';
const require=createRequire(import.meta.url),cli=path.join(path.dirname(require.resolve('wrangler/package.json')),'bin/wrangler.js');
const plan=process.argv.includes('--plan');
const directions=[['th','ru','\u0e07\u0e32\u0e19 1200 THB 3 \u0e0a\u0e34\u0e49\u0e19'],['ru','th','\u0420\u0430\u0431\u043e\u0442\u0430 1200 THB, 3 \u043f\u0440\u0435\u0434\u043c\u0435\u0442\u0430'],['th','en','\u0e07\u0e32\u0e19 1200 THB 3 \u0e0a\u0e34\u0e49\u0e19'],['en','th','Work 1200 THB, 3 items'],['ru','en','\u0420\u0430\u0431\u043e\u0442\u0430 1200 THB, 3 \u043f\u0440\u0435\u0434\u043c\u0435\u0442\u0430'],['en','ru','Work 1200 THB, 3 items']];
const summary={realTyphoon:'OWNER_ACCEPTANCE_PENDING',realCloudflare:'OWNER_ACCEPTANCE_PENDING'};
if(!plan&&process.env.TYPHOON_API_KEY){
 const adapter=new TyphoonTranslation(process.env.TYPHOON_API_KEY);
 for(const [source,target,text] of directions){const r=await adapter.translate(text,source,target);assert.equal(r.ok,true,`Typhoon ${source}->${target} failed`);assert.ok(r.value.trim());}
 summary.realTyphoon='PASS';
}
const available=['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','F3_PROBE_D1_ID','F3_PROBE_BUCKET'].every(k=>process.env[k]);
if(plan||available){
 const directory=await mkdtemp(path.join(tmpdir(),'helpy-f3-probe-')),name=`helpy-f3-probe-${randomUUID().slice(0,8)}`;
 const config=path.join(directory,'wrangler.jsonc'),token=randomBytes(32).toString('hex');let deployed=false;
 const run=args=>execFileSync(process.execPath,[cli,...args,'--config',config],{cwd:directory,env:{...process.env,WRANGLER_SEND_METRICS:'false'},encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:120000});
 const api=async(endpoint,init={})=>{const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/${endpoint}`,{...init,headers:{authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,'content-type':'application/json'},signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(`Cloudflare API HTTP ${r.status}`);const value=await r.json();if(!value.success)throw new Error('Cloudflare API unsuccessful');return value.result;};
 try {
  await writeFile(config,JSON.stringify({name,main:new URL('./cloudflare-probe-worker.mjs',import.meta.url).pathname,compatibility_date:'2026-11-19',workers_dev:true,
   d1_databases:[{binding:'DB',database_name:'helpy',database_id:process.env.F3_PROBE_D1_ID??'00000000-0000-0000-0000-000000000000'}],
   r2_buckets:[{binding:'PHOTO_BUCKET',bucket_name:process.env.F3_PROBE_BUCKET??'helpy-photos'}],images:{binding:'IMAGES'},
   vars:{TYPHOON_BASE_URL:'https://api.opentyphoon.ai/v1',TYPHOON_MODEL:'typhoon-v2.5-30b-a3b-instruct'}}));
  if(plan){run(['deploy','--dry-run']);summary.preparedCloudflareBundle='PASS';}
  else {
   const privacy=await api(`r2/buckets/${encodeURIComponent(process.env.F3_PROBE_BUCKET)}/domains/managed`);assert.equal(privacy.enabled,false,'R2 bucket must remain private');
   const custom=await api(`r2/buckets/${encodeURIComponent(process.env.F3_PROBE_BUCKET)}/domains/custom`);assert.ok(Array.isArray(custom.domains)&&custom.domains.every(domain=>domain.enabled===false),'R2 custom domains must not expose objects');
   run(['deploy']);deployed=true;
   execFileSync(process.execPath,[cli,'secret','put','F3_PROBE_TOKEN','--config',config],{cwd:directory,env:{...process.env,WRANGLER_SEND_METRICS:'false'},input:token,stdio:['pipe','pipe','pipe'],timeout:120000});
   const subdomain=await api('workers/subdomain'),url=`https://${name}.${subdomain.subdomain}.workers.dev`;
   let health;for(let attempt=0;attempt<10;attempt++){try{health=await fetch(`${url}/health`,{signal:AbortSignal.timeout(15000)});if(health.ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,2000));}
   assert.equal(health?.status,200,'Probe Worker health');
   const response=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)});assert.equal(response.status,200,'Cloudflare binding probe');
   const report=await response.json();for(const field of ['worker','d1','r2','images'])assert.equal(report[field],'PASS');summary.realCloudflare='PASS';summary.bindings=report;
  }
 }finally {if(deployed)run(['delete','--force']);await rm(directory,{recursive:true,force:true});}
}
console.log(JSON.stringify(summary,null,2));
