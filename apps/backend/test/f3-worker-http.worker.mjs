import assert from 'node:assert/strict';import test from 'node:test';import {unstable_dev} from 'wrangler';
test('F3 bundled production Worker runs actual local HTTP and fails closed without future providers',async t=>{
 const server=await unstable_dev(new URL('../src/infrastructure/cloudflare/worker.ts',import.meta.url).pathname,{
  config:new URL('../wrangler.jsonc',import.meta.url).pathname,envFiles:[],local:true,port:0,persist:false,inspect:false,logLevel:'error',
  experimental:{disableExperimentalWarning:true,disableDevRegistry:true,watch:false,forceLocal:true},
 });
 t.after(()=>server.stop());
 const health=await server.fetch('/health');assert.equal(health.status,200);assert.deepEqual(await health.json(),{status:'ok',contractVersion:1});
 assert.equal((await server.fetch('/missing')).status,404);assert.equal((await server.fetch('/health',{method:'POST'})).status,405);
 const rejected=await server.fetch('/api/v1/commands',{method:'POST',headers:{authorization:'Bearer opaque-synthetic','content-type':'application/json'},body:JSON.stringify({operationId:'no-authority',command:{type:'locale',locale:'en'}})});
 assert.equal(rejected.status,401);assert.deepEqual(await rejected.json(),{ok:false,error:{code:'Unauthorized'}});
});
