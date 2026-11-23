import assert from 'node:assert/strict';import test from 'node:test';
import { PhotoApplicationService } from '../dist/application/photo-service.js';
import { D1AtomicRepository } from '../dist/infrastructure/d1/d1-atomic-repository.js';
import { D1PhotoMetadataStore } from '../dist/infrastructure/d1/d1-photo-metadata-store.js';
import { R2PhotoStore,photoMetadataLookup } from '../dist/infrastructure/media/r2-photo-store.js';
import { CloudflareImageProcessor } from '../dist/infrastructure/media/cloudflare-image-processor.js';
import { LocalDatabase } from './f3-d1-harness.mjs';import {harness} from './f2-harness.mjs';
import {bucket} from './f3-media-harness.mjs';
import {query} from '../dist/application/queries.js';
const ok=value=>({ok:true,value});
const digest=async bytes=>Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
async function fixture(h=harness()) {
 const db=new LocalDatabase(),repo=new D1AtomicRepository(db);await repo.transact('seed','fixture','seed','return',s=>{Object.assign(s,h.repository.state);return ok(null);});
 const metadata=new D1PhotoMetadataStore(repo),b=bucket(),objects=new R2PhotoStore(b),images={async process(){return ok(new Uint8Array([1,2,3]));}};
 const service=new PhotoApplicationService(repo,h.ports.auth,metadata,objects,images,digest);return {h,db,repo,metadata,b,objects,images,service};
}
test('F3 photo registration/replay/content conflict/privacy and actual R2 head',async()=>{
 const f=await fixture(),ref={kind:'profile',id:'client'},source=new Uint8Array([1]);
 const store=()=>f.service.store('client:client','photo-op','photo',ref,'image/png',source);
 assert.equal((await store()).ok,true);assert.equal((await store()).ok,true);assert.equal(f.b.puts,1);
 assert.equal((await f.service.store('client:client','photo-op','photo',ref,'image/png',new Uint8Array([2]))).error.code,'Conflict');
 assert.equal((await f.service.read('stranger:client','photo')).error.code,'Unauthorized');
 assert.equal((await f.service.read('client:client','photo')).ok,true);
 f.b.data.clear();assert.equal((await photoMetadataLookup(f.metadata,f.objects).lookup(['photo'])).value[0].present,false);
 assert.equal((await f.service.read('client:client','photo')).error.code,'NotFound');
});
test('F3 photo orphan recovery uses same R2 object and no false registration',async()=>{
 const f=await fixture(),original=f.metadata.register.bind(f.metadata);let fail=true;
 f.metadata.register=async(...args)=>fail?{ok:false,error:{code:'RepositoryUnavailable',detail:'fixture'}}:original(...args);
 const store=()=>f.service.store('client:client','photo-op','photo',{kind:'profile',id:'client'},'image/png',new Uint8Array([1]));
 assert.equal((await store()).ok,false);assert.equal(await f.metadata.find('photo'),null);assert.equal(f.b.puts,1);
 fail=false;assert.equal((await store()).ok,true);assert.equal(f.b.puts,1);
});
test('F3 photo rejects future job, changed access, processor overflow and wrong owner',async()=>{
 const f=await fixture();let calls=0;f.images.process=async()=>{calls++;return ok(new Uint8Array(1572865));};
 assert.equal((await f.service.store('client:client','x','x',{kind:'job',id:'future'},'image/png',new Uint8Array([1]))).error.code,'NotFound');
 assert.equal(calls,0);
 assert.equal((await f.service.store('stranger:client','x','x',{kind:'profile',id:'client'},'image/png',new Uint8Array([1]))).error.code,'Unauthorized');
 assert.equal((await f.service.store('client:client','x','x',{kind:'profile',id:'client'},'image/png',new Uint8Array([1]))).error.code,'InvalidPhoto');
 assert.equal(f.b.puts,0);
});
test('F3 photo rechecks authentication after R2 I/O and before returning read bytes',async()=>{
 const f=await fixture(),authenticate=f.h.ports.auth.authenticate,put=f.b.put.bind(f.b);
 const revoked=async()=>({ok:false,error:{code:'Unauthorized',detail:'revoked'}});
 f.b.put=async(...args)=>{const result=await put(...args);f.h.ports.auth.authenticate=revoked;return result;};
 const store=()=>f.service.store('client:client','race-photo','race-photo',{kind:'profile',id:'client'},'image/png',new Uint8Array([1]));
 assert.equal((await store()).error.code,'Unauthorized');assert.equal(await f.metadata.find('race-photo'),null);assert.equal(f.b.puts,1);
 f.h.ports.auth.authenticate=authenticate;assert.equal((await store()).ok,true);assert.equal(f.b.puts,1);
 const read=f.objects.read.bind(f.objects);f.objects.read=async(...args)=>{const value=await read(...args);f.h.ports.auth.authenticate=revoked;return value;};
 assert.equal((await f.service.read('client:client','race-photo')).error.code,'Unauthorized');
});
test('F3 photo detaches source bytes before authentication and content hashing awaits',async()=>{
 const f=await fixture(),source=new Uint8Array([1]);f.images.process=async bytes=>{assert.equal(bytes[0],1);return ok(new Uint8Array([2]));};
 const pending=f.service.store('client:client','detached','detached',{kind:'profile',id:'client'},'image/png',source);source[0]=9;
 assert.equal((await pending).ok,true);
});
for(const role of ['client','master'])test(`F3 photo ${role} activation revocation follows accepted F2 job/chat access before replay or object I/O`,async()=>{
 const h=harness();await h.published();await h.offer();const f=await fixture(h),session=`${role}:${role}`,bytes=new Uint8Array([1]);
 const jobRef={kind:'job',id:'job'},chatRef={kind:'chat',id:'chat:job:master'};
 const store=()=>f.service.store(session,'role-job-photo','role-job-photo',jobRef,'image/png',bytes);
 assert.equal((await store()).ok,true);assert.equal((await f.service.store(session,'role-chat-photo','role-chat-photo',chatRef,'image/png',bytes)).ok,true);
 assert.equal((await f.repo.transact('revoke','fixture','revoke','return',s=>{s.users[role][`${role}Active`]=false;return ok(null);})).ok,true);
 const accepted=await query(f.repo,h.ports.auth,h.clock,session,{type:'job',jobId:'job'});assert.equal(accepted.error.code,'RoleInactive');
 let reads=0,processed=0;const read=f.objects.read.bind(f.objects);f.objects.read=async(...args)=>{reads++;return read(...args);};
 f.images.process=async()=>{processed++;return ok(new Uint8Array([2]));};
 const denied=result=>{assert.equal(result.ok,false,'A revoked role must not receive photo access');assert.equal(result.error.code,accepted.error.code);};
 for(const id of ['role-job-photo','role-chat-photo'])denied(await f.service.read(session,id));
 denied(await store());
 denied(await f.service.store(session,'new-photo','new-photo',jobRef,'image/png',bytes));
 assert.equal(reads,0);assert.equal(processed,0);assert.equal(f.b.puts,2);
 assert.equal((await f.service.store(session,'inactive-profile','inactive-profile',{kind:'profile',id:role},'image/png',bytes)).ok,true,'Profile preparation remains available before activation');
});
test('F3 photo validates opaque authentication results and rejects malformed authority before processing',async()=>{
 const f=await fixture();let processed=0;f.images.process=async()=>{processed++;return ok(new Uint8Array([2]));};
 for(const value of [null,{ok:'true',value:{}},ok({userId:'client',role:'client'}),ok({userId:'client',role:'scheduler',permissions:[]}),ok({userId:'client',role:'admin',permissions:'accounts'})]){
  f.h.ports.auth.authenticate=async()=>value;
  const result=await f.service.store('opaque-session','bad-auth','bad-auth',{kind:'profile',id:'client'},'image/png',new Uint8Array([1]));
  assert.equal(result.ok,false);assert.equal(result.error.code,'Unauthorized');
 }
 assert.equal(processed,0);assert.equal(f.b.puts,0);assert.equal(await f.metadata.find('bad-auth'),null);
});
function webp(chunks) {
 const body=Buffer.concat(chunks.map(([kind,data])=>{const h=Buffer.alloc(8);h.write(kind);h.writeUInt32LE(data.length,4);return Buffer.concat([h,data,data.length%2?Buffer.alloc(1):Buffer.alloc(0)]);}));
 const head=Buffer.alloc(12);head.write('RIFF');head.writeUInt32LE(body.length+4,4);head.write('WEBP',8);return new Uint8Array(Buffer.concat([head,body]));
}
test('F3 Images actual capability/MIME guard, bounded single WebP output, explicit EXIF/GPS/XMP removal',async()=>{
 let calls=0;const encoded=webp([['VP8X',Buffer.alloc(10,12)],['EXIF',Buffer.from('GPS synthetic')],['XMP ',Buffer.from('private')],['VP8 ',Buffer.from('encoded pixels')]]);
 const binding={
   async info(){return {format:'image/jpeg',width:600,height:800};},
   input(){return {
     transform(options){assert.deepEqual(options,{width:1920,height:1920,fit:'scale-down'});return this;},
     async output(options){
       calls++;assert.deepEqual(options,{format:'image/webp',quality:80});
       return {image(){return new ReadableStream({start(c){c.enqueue(encoded);c.close();}});}};
     },
   };},
 };
 const adapter=new CloudflareImageProcessor(binding),r=await adapter.process(new Uint8Array([1]),'image/jpeg',1572864);
 assert.equal(r.ok,true);const text=Buffer.from(r.value).toString();for(const marker of ['EXIF','GPS','XMP ','private'])assert.ok(!text.includes(marker));assert.equal(calls,1);
 assert.equal((await adapter.process(new Uint8Array([1]),'image/png',1572864)).ok,false);
 assert.equal((await adapter.process(new Uint8Array([1]),'image/svg+xml',1572864)).ok,false);
 assert.equal((await adapter.process(new Uint8Array([1]),'image/jpeg',4)).ok,false);
 binding.info=async()=>{throw Object.assign(new Error('invalid image'),{code:9412});};assert.equal((await adapter.process(new Uint8Array([1]),'image/jpeg',1572864)).error.code,'InvalidPhoto');
 binding.info=async()=>{throw new Error('provider unavailable');};assert.equal((await adapter.process(new Uint8Array([1]),'image/jpeg',1572864)).error.code,'InfrastructureUnavailable');
});
