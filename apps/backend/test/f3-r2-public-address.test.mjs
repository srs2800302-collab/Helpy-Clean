import assert from 'node:assert/strict';
import test from 'node:test';
import { newJob, editDraft, publishJob, feed } from '../dist/domain/marketplace.js';

const client = { userId: 'client', role: 'client' };
const mkDraft = (publicAddress, address = 'Bangkok Main Road house 22 condo Name floor 5 room 9') =>
  ({ items: [], cep: 1000n, publicAddress, address });
const mkState = () => ({ jobs: Object.create(null), refusalStreak: Object.create(null), refusals: Object.create(null) });

const denied = [
  'Bangkok, Main Road, house 22, condo Name, floor 5, apartment 9',
  'Bangkok, Main Road house 22',
  'Bangkok, Main Road 22',
  'Bangkok, Main Road 22/7',
  'Bangkok, Main Road no. 22',
  'Bangkok, Main Road No 22/7',
  'Bangkok, ถนน สุขุมวิท 22',
  'Bangkok, ถนน สุขุมวิท 22/7',
  'Bangkok, Main Road 22, Sukhumvit',
  'Bangkok, Main Street 22',
  'Bangkok, Main Rd. 22/7',
  'Bangkok, Main Road condo Name',
  'Bangkok, Main Road floor 5',
  'Bangkok, Main Road apartment 9',
  'Bangkok, Main Road комната 9',
  'Bangkok, Main Road เลขที่ 22',
  'Bangkok, 22 Main Road',
  'Bangkok; Main Road; Floor 9',
  'Bangkok Main Road house 22 condo Name floor 5 room 9',
];
for (const [i, publicAddress] of denied.entries()) {
  test(`F3 R9.4 invalid publicAddress newJob case ${i + 1}`, () => {
    const state = mkState();
    assert.throws(() => newJob(state, client, 'job', mkDraft(publicAddress)), /InvalidScope/);
    assert.equal(Object.keys(state.jobs).length, 0);
  });
  test(`F3 R9.4 invalid publicAddress editDraft case ${i + 1}`, () => {
    const state = mkState();
    const job = newJob(state, client, 'job', mkDraft('Bangkok, Main Road'));
    assert.throws(() => editDraft(job, client, mkDraft(publicAddress)), /InvalidScope/);
    assert.equal(job.draft.publicAddress, 'Bangkok, Main Road');
  });
}
for (const publicAddress of ['Bangkok, Main Road', 'Public district street', 'Soi 22, Sukhumvit Road', 'Bangkok, ถนน สุขุมวิท']) {
  test(`F3 R9.4 district/street address accepted: ${publicAddress}`, () => {
    const state = mkState();
    const job = newJob(state, client, 'job', mkDraft(publicAddress));
    assert.equal(job.draft.publicAddress, publicAddress);
    assert.ok(job.draft.address.includes('house 22'));
  });
}
