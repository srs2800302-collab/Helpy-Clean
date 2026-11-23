import { handleHttp, maxHttpBodyBytes } from '../../transport/http-handler.js';
import type { HttpApplication } from '../../transport/http-handler.js';

export async function serveRequest(request:Request,app:HttpApplication):Promise<Response> {
  const headers:Record<string,string>={};request.headers.forEach((value,key)=>{headers[key]=value;});
  const chunks:Uint8Array[]=[];let size=0,bodyTooLarge=false;
  if(request.body){const reader=request.body.getReader();for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxHttpBodyBytes){bodyTooLarge=true;chunks.length=0;void reader.cancel().catch(()=>{});break;}chunks.push(value);}}
  const body=new Uint8Array(bodyTooLarge?0:size);let offset=0;for(const chunk of chunks){if(bodyTooLarge)break;body.set(chunk,offset);offset+=chunk.length;}
  const response = await handleHttp({method:request.method,path:new URL(request.url).pathname,headers,body,bodyTooLarge},app);
  const responseHeaders={'content-type':'application/json; charset=utf-8','cache-control':'no-store',...response.headers};
  return new Response(response.body instanceof Uint8Array?new Uint8Array(response.body):JSON.stringify(response.body),{status:response.status,headers:responseHeaders});
}
