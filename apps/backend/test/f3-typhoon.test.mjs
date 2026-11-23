import assert from 'node:assert/strict';import test from 'node:test';
import {createServer} from 'node:http';import {once} from 'node:events';
import { TyphoonTranslation } from '../dist/infrastructure/translation/typhoon-translation.js';
const terminology={en:'Install 3 sockets for 1200 THB',ru:'\u0423\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c 3 \u0440\u043e\u0437\u0435\u0442\u043a\u0438 \u0437\u0430 1200 THB',th:'\u0e15\u0e34\u0e14\u0e15\u0e31\u0e49\u0e07\u0e1b\u0e25\u0e31\u0e4a\u0e01\u0e44\u0e1f 3 \u0e08\u0e38\u0e14 1200 THB'};
for(const [source,target] of [['th','ru'],['ru','th'],['th','en'],['en','th'],['ru','en'],['en','ru']])test(`F3 Typhoon protocol ${source}->${target}`,async()=>{
 const original=terminology[source];let calls=0;
 const adapter=new TyphoonTranslation('fixture-placeholder',async(url,request)=>{calls++;assert.equal(url,'https://api.opentyphoon.ai/v1/chat/completions');const body=JSON.parse(request.body);assert.equal(body.stream,false);assert.equal(body.model,'typhoon-v2.5-30b-a3b-instruct');assert.equal(body.messages[1].content,original);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({translation:terminology[target]})}}]});});
 assert.deepEqual(await adapter.translate(original,source,target),{ok:true,value:terminology[target]});assert.equal(calls,1);assert.equal(original,terminology[source]);
 for(const text of ['email x@example.invalid','abc\u200bdef'])assert.equal((await adapter.translate(text,source,target)).ok,false);
 assert.equal(calls,1);
});
test('F3 Typhoon local guard blocks contacts and unknown text for every external method',async()=>{
 let calls=0;const adapter=new TyphoonTranslation('fixture-placeholder',async()=>{calls++;throw new Error('must not call');});
 for(const text of ['Phone +66 812345678','email x@example.invalid','LINE ID: somchai','https://t.me/helper','abc\u200bdef']){
  assert.equal((await adapter.translate(text,'en','ru')).ok,false);assert.equal((await adapter.detect(text)).ok,false);
 }
 assert.equal(calls,0);
});
test('F3 Typhoon independent contact guard permits an address to reach translation',async()=>{
 let calls=0;const adapter=new TyphoonTranslation('fixture-placeholder',async()=>{calls++;return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({translation:'Address 12 Test Road'})}}]});});
 assert.deepEqual(await adapter.translate('Address 12 Test Road','en','ru'),{ok:true,value:'Address 12 Test Road'});assert.equal(calls,1);
});
for(const mode of ['timeout','malformed','rate','numbers','commentary'])test(`F3 Typhoon fails closed ${mode}`,async()=>{
 const adapter=new TyphoonTranslation('fixture-placeholder',async()=>{if(mode==='timeout')throw new Error('timeout');if(mode==='rate')return new Response(null,{status:429});return Response.json({choices:[{finish_reason:'stop',message:{content:mode==='malformed'?'not json':JSON.stringify({translation:mode==='numbers'?'123':'Translation: 1200'})}}]});});
 assert.equal((await adapter.translate('1200','en','ru')).ok,false);
});
test('F3 Typhoon timeout aborts an actual controlled HTTP request without exposing provider data',async t=>{
 const server=createServer(()=>{});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const adapter=new TyphoonTranslation('fixture-placeholder',(_url,init)=>fetch(`http://127.0.0.1:${server.address().port}`,init),30);
 const started=Date.now(),r=await adapter.translate('Work 1200 THB','en','ru');assert.equal(r.ok,false);assert.ok(Date.now()-started<2000);
 assert.deepEqual(r,{ok:false,error:{code:'TranslationUnavailable',detail:'TranslationUnavailable'}});
});


test('F3 Typhoon adapter applies contact guard only to Client–Master job-chat purpose', async () => {
  let calls = 0;
  const adapter = new TyphoonTranslation('fixture-placeholder', async (_url, request) => {
    calls++;
    const body = JSON.parse(request.body);
    const content = body.messages[1].content;
    if (body.messages[0].content.startsWith('Detect')) {
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ language: 'en', reliable: true }) } }] });
    }
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translation: content }) } }] });
  });

  const contact = 'Phone +66 812345678';
  assert.equal((await adapter.detectWithPurpose(contact, 'job_chat')).ok, false);
  assert.equal((await adapter.translateWithPurpose(contact, 'en', 'ru', 'job_chat')).ok, false);
  assert.equal(calls, 0);

  assert.equal((await adapter.detectWithPurpose(contact, 'external_translation')).ok, true);
  assert.equal((await adapter.translateWithPurpose(contact, 'en', 'ru', 'external_translation')).ok, true);
  assert.equal(calls, 2);
});
