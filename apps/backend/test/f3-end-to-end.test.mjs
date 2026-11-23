import assert from 'node:assert/strict';import test from 'node:test';import {once} from 'node:events';
import {harness} from './f2-harness.mjs';import {scope} from './f2-fixtures.mjs';import {LocalDatabase} from './f3-d1-harness.mjs';import {bucket} from './f3-media-harness.mjs';
import {DomainCore} from '../dist/application/domain-core.js';import {D1AtomicRepository} from '../dist/infrastructure/d1/d1-atomic-repository.js';
import {D1PhotoMetadataStore} from '../dist/infrastructure/d1/d1-photo-metadata-store.js';import {R2PhotoStore,photoMetadataLookup} from '../dist/infrastructure/media/r2-photo-store.js';
import {PhotoApplicationService} from '../dist/application/photo-service.js';import {LocalTextSafety} from '../dist/infrastructure/text-safety/local-text-safety.js';
import {createNodeServer} from '../dist/infrastructure/node-server.js';import {serveRequest} from '../dist/infrastructure/cloudflare/http-runtime.js';import {encodeWire} from '@helpy/contracts';
const ok=value=>({ok:true,value});
for(const runtime of ['node','worker'])test(`F3 full foundation flow ${runtime}: draft -> images/R2/D1 -> publish -> negotiation -> cash -> completion -> reputation/restart`,async t=>{
 const h=harness(),db=new LocalDatabase(),repository=new D1AtomicRepository(db),b=bucket(),objects=new R2PhotoStore(b),metadata=new D1PhotoMetadataStore(repository);
 // F3 fixtures configure their format as data; accepted F2 fixtures/source remain unchanged.
 const fixture=h.repository.state.published[h.repository.state.current];for(const scenario of fixture.scenarios)for(const photo of scenario.form.photos)photo.formats=['image/webp'];
 assert.equal((await repository.transact('seed','fixture','seed','return',s=>{Object.assign(s,h.repository.state);return ok(null);})).ok,true);
 const ports={...h.ports,repository,photos:photoMetadataLookup(metadata,objects),textSafety:new LocalTextSafety()};
 const digest=async bytes=>Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 const optimized=new Uint8Array([82,73,70,70,4,0,0,0,87,69,66,80]);
 const photos=new PhotoApplicationService(repository,ports.auth,metadata,objects,{async process(){return ok(optimized.slice());}},digest);
 const app={ports,core:new DomainCore(ports),photos};let base='https://fixture.invalid';
 if(runtime==='node'){const server=createNodeServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));}
 const fetchRuntime=(path,init={})=>runtime==='node'?fetch(base+path,init):serveRequest(new Request(base+path,init),app);
 let sequence=0;
 const post=async(path,body,session='client:client')=>{
  const response=await fetchRuntime(path,{method:'POST',headers:{authorization:`Bearer ${session}`,'content-type':'application/json'},body:JSON.stringify(encodeWire(body))});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value.value;
 };
 const command=(command,session,id=`flow-${++sequence}`)=>post('/api/v1/commands',{operationId:id,command},session);
 const query=(query,session)=>post('/api/v1/queries',{query},session);
 assert.equal((await fetchRuntime('/health')).status,200);
 const item=scope(h.fixture);await command({type:'new_job',id:'job',draft:{items:[item],cep:1000n,publicAddress:'SYNTHETIC PUBLIC DISTRICT STREET',address:'SYNTHETIC PRIVATE ADDRESS'}});
 const ids=Object.values(item.photos).flat();
 for(const id of ids){const response=await fetchRuntime(`/api/v1/photos/${encodeURIComponent(id)}`,{method:'PUT',headers:{authorization:'Bearer client:client','content-type':'image/jpeg','idempotency-key':`upload:${id}`,'x-business-ref-kind':'job','x-business-ref-id':'job'},body:new Uint8Array([1,2,3])});assert.equal(response.status,200,JSON.stringify(await response.json()));}
 assert.equal(b.puts,ids.length);await command({type:'publish_job',jobId:'job'});
 const feed=await query({type:'feed'},'master:master');assert.equal(feed.jobs.length,1);assert.ok(!JSON.stringify(feed).includes('SYNTHETIC PRIVATE ADDRESS'));
 await command({type:'initial_offer',jobId:'job',id:'offer',chatId:'chat'},'master:master');
 for(const [session,id] of [['client:client','client-message'],['master:master','master-message']])await command({type:'message',chatId:'chat',id,original:'Work discussion 1200 THB',photoIds:[],sender:'user'},session);
 await command({type:'final_application',jobId:'job',masterId:'master',amount:1000n,recipientId:'client',confirmed:true},'master:master');
 await command({type:'select_master',jobId:'job',masterId:'master',amount:1000n,confirmed:true});await command({type:'cash',jobId:'job'});
 await command({type:'accept_work',jobId:'job',accepted:true,explanation:''});await command({type:'complete',jobId:'job'},'master:master','complete');
 await command({type:'review',jobId:'job',id:'review',stars:5,marks:['agreements_kept'],comment:'Synthetic review'});
 await command({type:'hide_history',jobId:'job'});assert.deepEqual((await query({type:'history'})).jobs,[]);
 assert.equal((await query({type:'debt',masterId:'master'},'master:master')).view.outstandingDebt,'300');
 const reputation=await query({type:'reputation',masterId:'master'});assert.equal(reputation.summary.experience,1);assert.equal(reputation.summary.reviewsCount,1);
 const image=await fetchRuntime(`/api/v1/photos/${encodeURIComponent(ids[0])}`,{headers:{authorization:'Bearer client:client'}});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/webp');assert.deepEqual(new Uint8Array(await image.arrayBuffer()),optimized);
 const restart=new D1AtomicRepository(db);assert.equal((await restart.read()).jobs.job.state,'completed');
 await command({type:'complete',jobId:'job'},'master:master','complete');assert.equal((await restart.read()).debt.master,300n);
 assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});
