import assert from 'node:assert/strict';import test from 'node:test';
import { WorkerClock } from '../dist/infrastructure/clock/worker-clock.js';
test('F3 Clock uses integer Unix seconds, exact days, UTC calendar years including leap day',()=>{
 const c=new WorkerClock(),now=c.now();assert.ok(Number.isSafeInteger(now));assert.ok(Math.abs(now-Date.now()/1000)<2);
 assert.equal(c.add(100,{value:2,unit:'seconds'}),102);assert.equal(c.add(100,{value:2,unit:'days'}),172900);
 const anchor=Date.UTC(2024,1,29,12)/1000;assert.equal(c.add(anchor,{value:1,unit:'years'}),Date.UTC(2025,2,1,12)/1000);
 assert.throws(()=>c.add(Number.MAX_SAFE_INTEGER,{value:1,unit:'days'}));
});
