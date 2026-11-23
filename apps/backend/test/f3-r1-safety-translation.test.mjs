import assert from 'node:assert/strict';
import test from 'node:test';
import {LocalTextSafety,maxInspectedTextBytes} from '../dist/infrastructure/text-safety/local-text-safety.js';
import {TyphoonTranslation} from '../dist/infrastructure/translation/typhoon-translation.js';
import {foldDecimalDigits} from '../dist/infrastructure/text-safety/unicode-decimal.js';
import {spawnSync} from 'node:child_process';
const safety=new LocalTextSafety();
const contact=[
 ['0812345678','phone_number'],['02 123 4567','phone_number'],['081-234-5678','phone_number'],['8 (999) 123-45-67','phone_number'],['89991234567','phone_number'],['202-555-0100','phone_number'],['(202) 555-0100','phone_number'],
 ['LINE @\u0e0a\u0e37\u0e48\u0e2d','messenger_contact'],['LINE ID: \u0e0a\u0e37\u0e48\u0e2d','messenger_contact'],['@\u043f\u0440\u0438\u043c\u0435\u0440','social_network_contact'],
 ['\u0438\u0432\u0430\u043d@\u043f\u0440\u0438\u043c\u0435\u0440.\u0440\u0444','email_address'],['\u0e50\u0e58\u0e51\u0e52\u0e53\u0e54\u0e55\u0e56\u0e57\u0e58','phone_number'],['\uff10\uff18\uff11\uff12\uff13\uff14\uff15\uff16\uff17\uff18','phone_number']
];
for(const [text,reason] of contact)test(`F3R1 contact blocks detect and translate: ${JSON.stringify(text)}`,async()=>{
 const inspected=await safety.inspect({text,purpose:'job_chat'});assert.equal(inspected.value.status,'rejected');assert.equal(inspected.value.reason,'contact');
 let calls=0;const adapter=new TyphoonTranslation('fixture-placeholder',async()=>{calls++;throw new Error('unchecked export');});
 assert.equal((await adapter.detect(text)).ok,false);assert.equal((await adapter.translate(text,'th','ru')).ok,false);assert.equal(calls,0);
});
for(const text of ['12345','1200 THB','1000000000 THB','9007199254740993123456789 THB','3 items','60x80 cm','2026-11-21 14:30','2026/11/21 14:30','12.5 mm','1,200 THB','+1200 THB','-1200 THB'])
test(`F3R1 numeric text remains admissible: ${JSON.stringify(text)}`,async()=>{assert.equal((await safety.inspect({text,purpose:'job_chat'})).value.status,'allowed');});
test('F3R1 raw type/UTF-8 budget precedes normalization, including multibyte and expansion cases',async()=>{
 const original=String.prototype.normalize;let calls=0;String.prototype.normalize=function(...args){calls++;return original.apply(this,args);};
 try {
  for(const text of ['x'.repeat(maxInspectedTextBytes+1),'\u0e01'.repeat(5334)]){
   calls=0;assert.equal((await safety.inspect({text,purpose:'external_translation'})).value.status,'unknown');assert.equal(calls,0);
  }
  calls=0;assert.equal((await safety.inspect({text:42,purpose:'external_translation'})).value.status,'unknown');assert.equal(calls,0);
  assert.equal((await safety.inspect({text:'\ufdfa'.repeat(1000),purpose:'external_translation'})).value.status,'unknown');
 }finally{String.prototype.normalize=original;}
});
test('F3R1 all Unicode decimal digits fold by value, without whole-number floating conversion',()=>{
 assert.equal(foldDecimalDigits('0123456789 \u0e50\u0e51\u0e52\u0e53\u0e54\u0e55\u0e56\u0e57\u0e58\u0e59 \u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669'),'0123456789 0123456789 0123456789');
});
const cases=[
 ['-1200 THB','1200 THB',false],['+1200 THB','1200 THB',false],['- 1200 THB','1200 THB',false],['+ 1200 THB','1200 THB',false],['-0 THB','0 THB',false],
 ['\u0e51\u0e52\u0e53 \u0e1a\u0e32\u0e17','\u0e54\u0e55\u0e56 \u0e1a\u0e32\u0e17',false],['\u0e51\u0e52\u0e53 \u0e1a\u0e32\u0e17','123 THB',true],
 ['\uff0b\uff11\uff12\uff10\uff10 THB','+1200 THB',true],['\u22121200 THB','-1200 THB',true],
 ['\u20131200 THB','1200 THB',false],['\u20131200 THB','-1200 THB',true],['1200 THB','+1200 THB',false],['+1200 THB','-1200 THB',false],
 ['1,200 THB','1200 THB',false],['1.200 THB','1,200 THB',false],['1,200.50 THB','1.200,50 THB',false],['1 200 THB','1200 THB',false],
 ["1'200 THB",'1 200 THB',false],['.50 THB','50 THB',false],['1e-3 THB','1e3 THB',false],['1e3 THB','1 3 THB',false],
 ['1e3 THB','1E3 THB',true],['1,200.50 THB','1,200.50 THB',true],['9007199254740993123456789 THB','9007199254740993123456788 THB',false],
 ['9007199254740993123456789 THB','9007199254740993123456789 THB',true],
];
for(const [original,translation,accepted] of cases)test(`F3R1 exact numerical policy ${JSON.stringify(original)} -> ${JSON.stringify(translation)}`,async()=>{
 let calls=0;const adapter=new TyphoonTranslation('fixture-placeholder',async(_url,request)=>{calls++;assert.equal(JSON.parse(request.body).messages[1].content,original);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({translation})}}]});});
 const result=await adapter.translate(original,'th','ru');assert.equal(calls,1);assert.equal(result.ok,accepted);if(!accepted)assert.equal(result.error.code,'TranslationUnavailable');
});
test('F3R1 excessive provider body is cancelled and never parsed/exported',async()=>{
 let cancelled=false;const adapter=new TyphoonTranslation('fixture-placeholder',async()=>new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(262145));},cancel(){cancelled=true;}})));
 assert.equal((await adapter.translate('1200 THB','en','ru')).ok,false);assert.equal(cancelled,true);
});
test('F3R1 within-budget regex work stays bounded for long letter/whitespace suffixes',()=>{
 const module=new URL('../dist/infrastructure/text-safety/local-text-safety.js',import.meta.url).href;
  const source=`import {LocalTextSafety} from ${JSON.stringify(module)};const safety=new LocalTextSafety();for(const text of ['x'.repeat(16000),'12 '+' '.repeat(15980)+'xy','12 Main St','x @ example.invalid']){const result=await safety.inspect({text,purpose:'job_chat'});console.log(result.value.status);}`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',timeout:2000});
  assert.equal(child.status,0,child.error?.message??child.stderr);assert.deepEqual(child.stdout.trim().split('\n'),['allowed','allowed','allowed','rejected']);
});
