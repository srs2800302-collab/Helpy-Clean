import { createServer } from 'node:http';
import { handleHttp, maxHttpBodyBytes } from '../transport/http-handler.js';
import type { HttpApplication } from '../transport/http-handler.js';

export function createNodeServer(app?:HttpApplication) {
  return createServer((request, response) => {
    void (async()=>{
    const chunks:Buffer[]=[];let size=0,bodyTooLarge=false;
    // Returning the iterator must not destroy the socket before the error is sent.
    for await(const chunk of request.iterator({destroyOnReturn:false})){
      size+=chunk.byteLength;
      if(size>maxHttpBodyBytes){bodyTooLarge=true;chunks.length=0;request.pause();break;}
      chunks.push(chunk);
    }
    const headers:Record<string,string>={};
    for(const [key,values] of Object.entries(request.headersDistinct))if(values)headers[key]=values.join(', ');
    const result = await handleHttp({
      method: request.method ?? '',
      path: (request.url ?? '').split('?')[0] ?? '',
      headers,body:bodyTooLarge?new Uint8Array():new Uint8Array(Buffer.concat(chunks)),bodyTooLarge,
    },app);
    if(bodyTooLarge)response.shouldKeepAlive=false;
    response.writeHead(result.status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...result.headers,
    });
    response.end(result.body instanceof Uint8Array?result.body:JSON.stringify(result.body));
    })().catch(()=>{response.destroy();});
  });
}
