import assert from 'node:assert/strict';import test from 'node:test';import {readFile} from 'node:fs/promises';
import {commandFields,queryFields,queryViewFields,methodRoutes,publicJobFields,isApiCommand,isApiQuery,isApiQueryValue,decimalMoney,decodeCommandMoney} from '../dist/src/index.js';
test('F3 shared wire maps all 55+15+5 operations and fixture variants',async()=>{
 const fixture=JSON.parse(await readFile(new URL('../fixtures/f3-api.json',import.meta.url),'utf8'));
 assert.deepEqual(fixture.commandFields,commandFields);assert.deepEqual(fixture.queryFields,queryFields);assert.deepEqual(fixture.methodRoutes,methodRoutes);
 assert.equal(Object.keys(commandFields).length,55);assert.equal(Object.keys(queryFields).length,15);assert.equal(Object.keys(methodRoutes).length,5);
 assert.ok(fixture.commands.every(isApiCommand));assert.ok(fixture.queries.every(isApiQuery));
  assert.deepEqual(fixture.queryViewFields,queryViewFields);assert.ok(fixture.queryViews.every(isApiQueryValue));
  assert.deepEqual(publicJobFields,{id:'string',state:'string',items:'array',cep:'money',fap:'money?',publicAddress:'string',address:'string?',chatId:'string?',completedAt:'number?',acceptedAt:'number?'});
 assert.equal(isApiCommand({type:'complete',jobId:'j',admin:true}),false);
 assert.equal(isApiCommand({type:'threshold',masterId:'m',amount:0}),false);
 assert.equal(decodeCommandMoney({type:'threshold',masterId:'m',amount:decimalMoney('0')}).amount,0n);
 for(const input of [0,'01','1e3','-1','1.5',null])assert.throws(()=>decimalMoney(input));
});
