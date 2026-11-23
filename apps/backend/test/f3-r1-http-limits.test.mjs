import assert from 'node:assert/strict';import test from 'node:test';import {once} from 'node:events';
import {createNodeServer} from '../dist/infrastructure/node-server.js';
import {serveRequest} from '../dist/infrastructure/cloudflare/http-runtime.js';
import {handleHttp,maxHttpBodyBytes} from '../dist/transport/http-handler.js';
const error={ok:false,error:{code:'BadRequest'}};
test('F3R1 Worker cancellation is immediate, bounded and does not wait for hostile EOF/cancel completion',async()=>{
 let pulls=0,cancelled=false;
 const source=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(65536));},cancel(){cancelled=true;return new Promise(()=>{});}},{highWaterMark:0});
 const request={method:'POST',url:'https://fixture.invalid/api/v1/commands',headers:new Headers({'content-type':'application/json'}),body:source};
 const response=await Promise.race([serveRequest(request,undefined),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Waited for cancel/EOF')),2000))]);
 assert.equal(response.status,400);assert.deepEqual(await response.json(),error);assert.equal(cancelled,true);assert.equal(pulls,Math.floor(maxHttpBodyBytes/65536)+1);
});
for(const [path,method] of [['/health','GET'],['/missing','POST'],['/api/v1/commands','POST']])test(`F3R1 body-size error is a transport boundary before route/auth: ${method} ${path}`,async()=>{
 const response=await handleHttp({method,path,bodyTooLarge:true,body:new Uint8Array()},undefined);assert.equal(response.status,400);assert.deepEqual(response.body,error);
});
test('F3R1 exact HTTP byte limit remains accepted by both mappings; over-limit never reaches Application',async t=>{
 let calls=0;const app={core:{async execute(){calls++;return {ok:true,value:{outcome:{kind:'recorded',id:'f'},events:[]}};}},ports:{},photos:{}};
 const prefix='{"operationId":"f","command":{"type":"feedback","id":"f","original":"',suffix='"}}';
 const text=prefix+'x'.repeat(maxHttpBodyBytes-prefix.length-suffix.length)+suffix,body=new TextEncoder().encode(text);assert.equal(body.byteLength,maxHttpBodyBytes);
 const server=createNodeServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const init={method:'POST',headers:{authorization:'Bearer opaque','content-type':'application/json'},body};
 const node=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/commands`,init),worker=await serveRequest(new Request('https://fixture.invalid/api/v1/commands',init),app);
 assert.equal(node.status,200);assert.equal(worker.status,200);assert.deepEqual(await node.json(),await worker.json());assert.equal(calls,2);
 const tooLarge=new Uint8Array(maxHttpBodyBytes+1),denied=await handleHttp({method:'POST',path:'/api/v1/commands',headers:init.headers,body:tooLarge},app);
 assert.equal(denied.status,400);assert.deepEqual(denied.body,error);assert.equal(calls,2);
});
