import worker from '../../src/infrastructure/cloudflare/worker.ts';
import {CloudflareImageProcessor} from '../../src/infrastructure/media/cloudflare-image-processor.ts';
import {R2PhotoStore} from '../../src/infrastructure/media/r2-photo-store.ts';
const sourcePng='iVBORw0KGgoAAAANSUhEUgAAAAQAAAAICAYAAADeM14FAAAAU0lEQVR4nBXIQQEAIQzEwFWCkirhHRFVghKUYCh3neckwRSmMRezgqtwNa6JClZhNdbEDu7C3bgnOtiF3dgTJ3gKT+OZuMFbeBvvxAu+wtf4/vgAs4hEwSRf8RcAAAAASUVORK5CYII=';
const stream=bytes=>new ReadableStream({start(c){c.enqueue(bytes);c.close();}});
const check=(condition,message)=>{if(!condition)throw new Error(message);};
export default {
 async fetch(request,env) {
  if(request.method==='GET'&&new URL(request.url).pathname==='/health')return worker.fetch(request,env);
  if(!env.F3_PROBE_TOKEN||request.headers.get('authorization')!==`Bearer ${env.F3_PROBE_TOKEN}`)return new Response(null,{status:401});
  const id=`f3-provider-probe:${crypto.randomUUID()}`,key=`photos/${encodeURIComponent(id)}`;
  try {
   const tables=(await env.DB.prepare('PRAGMA table_list').all()).results.filter(t=>!t.name.startsWith('sqlite_')&&!t.name.startsWith('_cf_')&&t.name!=='d1_migrations');
   check(tables.length===35&&tables.every(t=>t.strict===1),'D1 schema');
   check((await env.DB.prepare('PRAGMA foreign_key_check').all()).results.length===0,'D1 foreign keys');
   const png=Uint8Array.from(atob(sourcePng),c=>c.charCodeAt(0));
   const jpeg=await env.IMAGES.input(stream(png)).output({format:'image/jpeg',quality:95});
   const original=new Uint8Array(await new Response(jpeg.image()).arrayBuffer());
   // Synthetic EXIF orientation=6; no real personal/location information.
   const exif=Uint8Array.from([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
   const oriented=new Uint8Array(original.length+exif.length);oriented.set(original.slice(0,2));oriented.set(exif,2);oriented.set(original.slice(2),2+exif.length);
   const processed=await new CloudflareImageProcessor(env.IMAGES).process(oriented,'image/jpeg',1572864);
   check(processed.ok,'Images processing');const metadata=await env.IMAGES.info(stream(processed.value));
   check(metadata.format==='image/webp'&&metadata.width===8&&metadata.height===4,'Images orientation');
   const text=new TextDecoder().decode(processed.value);check(!text.includes('EXIF')&&!text.includes('XMP '),'Images metadata');
   const objects=new R2PhotoStore(env.PHOTO_BUCKET);
   check((await objects.create(id,processed.value,'synthetic probe signature')).ok,'R2 create');
   check((await objects.create(id,processed.value,'synthetic probe signature')).ok,'R2 repeat');
   check(!(await objects.create(id,processed.value,'different synthetic signature')).ok,'R2 conflict');
   check(await objects.head(id),'R2 head');
   const read=await objects.read(id);check(read?.length===processed.value.length&&read.every((b,i)=>b===processed.value[i]),'R2 bytes');
   return Response.json({worker:'PASS',d1:'PASS',r2:'PASS',images:'PASS',tableCount:35,format:metadata.format,width:metadata.width,height:metadata.height,storedBytes:read.length});
  }catch {return Response.json({error:'ProviderProbeFailed'},{status:503});}
  finally {await env.PHOTO_BUCKET.delete(key);}
 },
};
