import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './f2-harness.mjs';
import { query } from '../dist/application/queries.js';

const C = 'client:client', M = 'master:master', A = 'admin';
async function refuses(h, input, session = C) {
  const state = structuredClone(h.repository.state), receipts = structuredClone(h.repository.receipts);
  const result = await query(h.repository, h.ports.auth, h.clock, session, input);
  assert.equal(result.ok, false); assert.equal(result.error.code, 'InvalidReference');
  assert.deepEqual(h.repository.state, state); assert.deepEqual(h.repository.receipts, receipts);
}

for (const [name, mutate, input, session] of [
  ['job offers', state => { state.jobs.job.offers = null; }, { type: 'job', jobId: 'job' }, C],
  ['job cycles', state => { state.jobs.job.cycles = {}; }, { type: 'job', jobId: 'job' }, C],
  ['payment operations', state => { state.jobs.job.reservation.operations = null; }, { type: 'payment', jobId: 'job' }, C],
  ['payout attempts', state => { state.payouts.job.attempts = null; }, { type: 'payout', jobId: 'job' }, M],
  ['thread context', state => { state.threads['chat:job:master'].context = null; }, { type: 'chat_history', chatId: 'chat:job:master' }, C],
  ['ledger entry', state => { state.ledger.broken = null; }, { type: 'debt', masterId: 'master' }, M],
  ['review entry', state => { state.reviews.broken = null; }, { type: 'reputation', masterId: 'master' }, C],
  ['inbox entry', state => { state.inbox.broken = null; }, { type: 'inbox' }, C],
  ['feed job', state => { state.jobs.broken = null; }, { type: 'feed' }, M],
  ['history job', state => { state.jobs.broken = null; }, { type: 'history' }, C],
  ['reputation job', state => { state.jobs.broken = null; }, { type: 'reputation', masterId: 'master' }, C],
]) test(`R6 AGGREGATE malformed ${name} is a typed read refusal, not a programming exception`, async () => {
  const h = harness(); await h.completed('card'); mutate(h.repository.state);
  await refuses(h, input, session);
});

test('R6 AGGREGATE job reads require the complete original offer set', async () => {
  const h = harness(); await h.published(); await h.offer();
  h.repository.state.jobs.job.offers = {};
  await refuses(h, { type: 'job', jobId: 'job' });
});

for (const change of ['erase', 'rebind', 'one-sided']) test(`R6 AGGREGATE linked orders retain their confirmed symmetric relationship: ${change}`, async () => {
  const h = harness(); await h.published('job', 'kitchen', 'assemble'); await h.published('linked', 'bi-oven');
  await h.published('unrelated', 'bi-oven');
  await h.ok(C, { type: 'link_jobs', jobId: 'job', linkedJobId: 'linked' });
  if (change === 'erase') { h.repository.state.jobs.job.linkedJobId = null; h.repository.state.jobs.linked.linkedJobId = null; }
  else if (change === 'rebind') { h.repository.state.jobs.job.linkedJobId = 'unrelated'; h.repository.state.jobs.linked.linkedJobId = null; h.repository.state.jobs.unrelated.linkedJobId = 'job'; }
  else h.repository.state.jobs.linked.linkedJobId = null;
  await refuses(h, { type: 'job', jobId: 'job' });
});

test('R6 AGGREGATE a lawful linked-order pair remains readable from both orders', async () => {
  const h = harness(); await h.published('job', 'kitchen', 'assemble'); await h.published('linked', 'bi-oven');
  await h.ok(C, { type: 'link_jobs', jobId: 'job', linkedJobId: 'linked' });
  for (const jobId of ['job', 'linked']) {
    const result = await query(h.repository, h.ports.auth, h.clock, C, { type: 'job', jobId });
    assert.equal(result.ok, true); assert.equal(result.value.job.id, jobId);
  }
});

test('R6 AGGREGATE invalid unrelated job terms do not block an ordinary locale command', async () => {
  const h = harness(); await h.published(); h.repository.state.jobs.job.snapshot.address = 'Unconfirmed address';
  await h.ok(C, { type: 'locale', locale: 'ru' });
  assert.equal(h.repository.state.users.client.locale, 'ru');
});

test('R6 AGGREGATE an unrelated financial projection is not consumed by a locale command', async () => {
  const h = harness(); h.repository.state.ledger.unrelated = null;
  await h.ok(C, { type: 'locale', locale: 'ru' });
  assert.equal(h.repository.state.users.client.locale, 'ru');
  assert.equal(h.repository.state.ledger.unrelated, null);
});

for (const kind of ['provider', 'instruction', 'offer', 'message', 'work']) test(`R6 AGGREGATE malformed ${kind} source proof is rejected at the repository boundary`, async () => {
  const h = harness(); await h.assigned('card'); await h.message(C, 'Original work discussion');
  await h.ok(M, { type: 'submit_result', jobId: 'job', explanation: 'Original evidence', photoIds: [] });
  await h.ok(C, { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' }); await h.ok(M, { type: 'complete', jobId: 'job' });
  const proof = h.repository.state.events.find(event => event.proof?.kind === kind).proof;
  if (kind === 'provider') proof.outcome.binding = null;
  else if (kind === 'instruction') proof.operation.binding = null;
  else proof[kind === 'work' ? 'evidence' : kind] = null;
  await refuses(h, { type: 'job', jobId: 'job' });
});

for (const change of ['foreign-recipient', 'missing-recipient', 'language', 'pending']) test(`R6 AGGREGATE negotiation ${change} is derived from the original messages`, async () => {
  const h = harness(); await h.published(); await h.offer(); await h.message(C, 'RU:original');
  const thread = h.repository.state.threads['chat:job:master'];
  if (change === 'foreign-recipient') thread.waitingFor = 'stranger';
  else if (change === 'missing-recipient') thread.waitingFor = null;
  else if (change === 'language') thread.languageNotice.language = 'th';
  else thread.languageNotice.pending = false;
  h.clock.value = thread.reminder.deadline;
  const state = structuredClone(h.repository.state), receipts = structuredClone(h.repository.receipts);
  const result = await h.execute(A, { type: 'reminders', jobId: 'job' });
  assert.equal(result.ok, false); assert.equal(result.error.code, 'InvalidReference');
  assert.deepEqual(h.repository.state, state); assert.deepEqual(h.repository.receipts, receipts);
});

test('R6 AGGREGATE legitimate negotiation reminders address only the actual waiting party', async () => {
  const h = harness(); await h.published(); await h.offer(); await h.message(C, 'RU:original');
  h.clock.value = h.repository.state.threads['chat:job:master'].reminder.deadline;
  const result = await h.ok(A, { type: 'reminders', jobId: 'job' });
  assert.deepEqual(result.events.find(event => event.type === 'negotiation_reminder').recipients, ['master']);
  await h.message(M, 'Reply');
  assert.equal(h.repository.state.threads['chat:job:master'].waitingFor, 'client');
  assert.deepEqual(h.repository.state.threads['chat:job:master'].languageNotice, { language: 'ru', pending: false });
});
