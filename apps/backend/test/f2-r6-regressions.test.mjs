import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './f2-harness.mjs';
import { catalog, scope } from './f2-fixtures.mjs';
import { query } from '../dist/application/queries.js';

const A = 'admin', C = 'client:client', M = 'master:master';
const read = (h, input, session = M) => query(h.repository, h.ports.auth, h.clock, session, input);
async function deny(h, action, code) {
  const state = structuredClone(h.repository.state), receipts = structuredClone(h.repository.receipts);
  const result = await action(); assert.equal(result.ok, false); assert.equal(result.error.code, code);
  assert.deepEqual(h.repository.state, state); assert.deepEqual(h.repository.receipts, receipts);
}
async function configure(h, version) {
  await h.ok(A, { type: 'save_catalog', draft: catalog({ approved: false, version }), expectedSequence: null });
  const key = `test-catalog:${version}`;
  await h.ok(A, { type: 'approve_content_set', key, sequence: 1,
    revisions: h.repository.state.drafts[key].texts.map(text => ({ textId: text.id, revision: text.revision })), confirmed: true });
  await h.ok(A, { type: 'publish_catalog', key, sequence: 2 });
}

for (const repayment of [false, true]) test(`R6 DEEP debt requires its paired original financial event repayment=${repayment}`, async () => {
  const h = harness(); await h.completed();
  if (repayment) {
    await h.ok(M, { type: 'request_repayment', id: 'request', amount: 200n, confirmed: true });
    await h.ok(A, { type: 'support', id: 'support', userId: 'master', userRole: 'master', basis: 'repayment', basisId: 'request' });
    await h.ok(A, { type: 'agree_repayment', requestId: 'request', amount: 200n, method: 'cash', agreementId: 'agreement' });
    await h.ok(A, { type: 'receive_repayment', requestId: 'request', masterId: 'master', amount: 200n, receiptId: 'receipt', agreementId: 'agreement', actuallyReceived: true, evidence: 'Actual received funds' });
  }
  assert.equal((await read(h, { type: 'debt', masterId: 'master' })).value.view.outstandingDebt, repayment ? 100n : 300n);
  h.repository.state.events = h.repository.state.events.filter(record => record.type !== (repayment ? 'debt_repayment_received' : 'completed'));
  delete h.repository.state.ledger[repayment ? 'receipt' : 'commission:job'];
  h.repository.state.debt.master = repayment ? 300n : 0n;
  await deny(h, () => read(h, { type: 'debt', masterId: 'master' }), 'InvalidReference');
});

test('R6 DEEP current catalog cannot silently lose a confirmed historical publication', async () => {
  const h = harness(); await configure(h, 2);
  delete h.repository.state.published['test-catalog:1'];
  await deny(h, () => h.execute(C, { type: 'new_job', id: 'job', draft: { items: [scope(h.fixture)], cep: 1000n, publicAddress: 'Public district street', address: 'Exact site' } }), 'InvalidReference');
});

test('R6 DEEP refusal history cannot lose its paired event and matching projection while the command remains', async () => {
  const h = harness(); await h.published('first'); await h.offer('first');
  await h.ok(M, { type: 'terminate_negotiation', jobId: 'first', masterId: 'master', confirmed: true, reason: 'Withdraw' });
  await h.published('second'); await h.offer('second');
  h.repository.state.events = h.repository.state.events.filter(record => !['master_voluntary_refusal', 'refusal_recorded_warning'].includes(record.type));
  h.repository.state.refusals = {}; h.repository.state.refusalStreak.master = 0;
  await deny(h, () => h.execute(M, { type: 'terminate_negotiation', jobId: 'second', masterId: 'master', confirmed: true, reason: 'Withdraw again' }), 'InvalidReference');
});

test('R6 DEEP threshold configuration and a frozen payout do not consume an unconfirmed current debt projection', async () => {
  const h = harness(); await h.completed('card');
  const payout = structuredClone(h.repository.state.payouts.job), ledger = structuredClone(h.repository.state.ledger);
  h.repository.state.debt.master = 900n;
  const result = await h.ok(A, { type: 'threshold', masterId: 'master', amount: 3000n });
  assert.deepEqual(result.outcome, { kind: 'threshold', masterId: 'master', amount: 3000n, effectiveMasterDebtThreshold: 3000n, currency: 'THB' });
  await deny(h, () => read(h, { type: 'debt', masterId: 'master' }), 'InvalidReference');
  await h.ok(A, { type: 'start_payout', jobId: 'job', attemptId: 'frozen-transfer' });
  assert.equal(h.repository.state.payouts.job.attempts[0].amount, payout.amount); assert.deepEqual(h.repository.state.ledger, ledger);
});

test('R6 DEEP command confirmation is detached before the first asynchronous authentication', async () => {
  const h = harness(); await h.published(); await h.offer();
  const command = { type: 'final_application', jobId: 'job', masterId: 'master', amount: 1000n, recipientId: 'client', confirmed: true };
  const authenticate = h.ports.auth.authenticate;
  h.ports.auth.authenticate = async session => { command.amount = 2000n; command.confirmed = false; return authenticate(session); };
  await h.ok(M, command);
  assert.deepEqual(h.repository.state.jobs.job.offers.master.final, { amount: 1000n, sentAt: h.clock.now() });
});

test('R6 DEEP verified provider output cannot change during later authentication', async () => {
  const h = harness(); await h.reserved(); await h.ok(C, { type: 'initiate_payment', jobId: 'job', id: 'payment', route: 'card' });
  const verified = { operationId: 'payment', binding: structuredClone(h.repository.state.jobs.job.reservation.operations[0].binding), amount: 1000n, currency: 'THB', status: 'success' };
  h.ports.payments.verifyOutcome = async () => ({ ok: true, value: verified });
  const authenticate = h.ports.auth.authenticate; let calls = 0;
  h.ports.auth.authenticate = async session => { if (++calls === 3) { verified.status = 'failed'; verified.reason = 'declined'; } return authenticate(session); };
  await h.ok(A, { type: 'payment_outcome', jobId: 'job', proof: 'verified' });
  assert.equal(h.repository.state.jobs.job.state, 'assigned'); assert.equal(h.repository.state.jobs.job.reservation.operations[0].status, 'success');
  assert.equal(h.repository.state.jobs.job.reservation.resetUsed, false);
});

test('R6 DEEP a completed profile does not activate a newly authenticated role without its command', async () => {
  const h = harness(); h.claims.set('login', { id: 'new-login', purpose: 'login', identity: { method: 'email', subject: 'new' }, email: 'new@test.invalid', phone: null, ownerId: null, expiresAt: 1000 });
  assert.equal((await h.core.authenticate('login', 'new', 'new-account')).ok, true);
  await h.ok('new:client', { type: 'profile', displayName: 'New client', photoId: null, specialization: { categoryIds: [], entityIds: [] } });
  assert.equal(h.repository.state.users.new.clientActive, false);
  h.repository.state.users.new.clientActive = true;
  await deny(h, () => read(h, { type: 'contacts', userId: 'new' }, 'new:client'), 'InvalidReference');
  h.repository.state.users.new.clientActive = false;
  await h.ok('new:client', { type: 'activate', role: 'client' });
  assert.equal((await read(h, { type: 'contacts', userId: 'new' }, 'new:client')).value.contacts.email, 'new@test.invalid');
});

test('R6 DEEP deleting a consumed-claim projection cannot grant recovery a second time', async () => {
  const h = harness(); h.claims.set('recover', { id: 'single-claim', purpose: 'recover', identity: { method: 'email', subject: 'client' }, email: 'client@test.invalid', phone: null, ownerId: 'client', expiresAt: 1000 });
  assert.equal((await h.core.authenticate('recover', 'client', 'first-recovery', true)).ok, true);
  delete h.repository.state.consumedClaims['single-claim'];
  await deny(h, () => h.core.authenticate('recover', 'client', 'second-recovery', true), 'ClaimConsumed');
});

test('R6 DEEP valid-looking preference changes require the original user setting', async () => {
  const h = harness(); await h.published(); await h.offer();
  await h.ok(C, { type: 'preferences', preference: { userId: 'client', role: 'client', channels: [], eventTypes: ['initial_offer_sent'], soundRequested: false } });
  const event = h.repository.state.events.find(record => record.type === 'initial_offer_sent');
  h.repository.state.preferences['client:client'].channels = ['test-channel'];
  let deliveries = 0; h.ports.notifications.deliver = async () => { deliveries++; return { ok: true, value: 'delivered' }; };
  await deny(h, () => h.core.dispatchNotification(A, event.id, 'client', 'test-channel', 'unconfirmed-preference'), 'InvalidReference');
  assert.equal(deliveries, 0);
});

test('R6 DEEP history cannot disappear through an unconfirmed visibility projection', async () => {
  const h = harness(); await h.completed(); assert.equal((await read(h, { type: 'history' }, C)).value.jobs.length, 1);
  h.repository.state.hiddenHistory['client:client'] = ['job'];
  await deny(h, () => read(h, { type: 'history' }, C), 'InvalidReference');
});

test('R6 DEEP query identity is detached before the first asynchronous authentication', async () => {
  const h = harness(); await h.published('original'); await h.published('replacement');
  const input = { type: 'job', jobId: 'original' }, authenticate = h.ports.auth.authenticate;
  h.ports.auth.authenticate = async session => { input.jobId = 'replacement'; return authenticate(session); };
  const result = await read(h, input, C);
  assert.equal(result.ok, true); assert.equal(result.value.job.id, 'original');
});

for (const mode of ['outage', 'malformed']) test(`R6 DEEP repository read ${mode} returns a typed refusal without mutation`, async () => {
  const h = harness();
  h.repository.read = async () => { if (mode === 'outage') throw new Error('Offline'); return { users: {} }; };
  await deny(h, () => read(h, { type: 'contacts', userId: 'client' }, C), mode === 'outage' ? 'RepositoryUnavailable' : 'InvalidReference');
});

test('R6 DEEP repository outage before commit is typed and does not reserve an operation', async () => {
  const h = harness(); h.repository.transact = async () => { throw new Error('Offline'); };
  await deny(h, () => h.execute(C, { type: 'locale', locale: 'ru' }, 'uncommitted'), 'RepositoryOutcomeUnknown');
});

test('R6 DEEP lost commit acknowledgement returns uncertainty and retry has one effect', async () => {
  const h = harness(); await h.completed();
  await h.ok(M, { type: 'request_repayment', id: 'request', amount: 200n, confirmed: true });
  await h.ok(A, { type: 'support', id: 'support', userId: 'master', userRole: 'master', basis: 'repayment', basisId: 'request' });
  await h.ok(A, { type: 'agree_repayment', requestId: 'request', amount: 200n, method: 'cash', agreementId: 'agreement' });
  const command = { type: 'receive_repayment', requestId: 'request', masterId: 'master', amount: 200n, receiptId: 'receipt', agreementId: 'agreement', actuallyReceived: true, evidence: 'Actual received funds' };
  const transact = h.repository.transact.bind(h.repository); let lost = false;
  h.repository.transact = async (...args) => { const result = await transact(...args); if (!lost) { lost = true; throw new Error('Acknowledgement lost'); } return result; };
  const uncertain = await h.execute(A, command, 'one-receipt');
  assert.equal(uncertain.ok, false); assert.equal(uncertain.error.code, 'RepositoryOutcomeUnknown');
  assert.equal(h.repository.state.debt.master, 100n);
  const state = structuredClone(h.repository.state), receipts = structuredClone(h.repository.receipts);
  await h.ok(A, command, 'one-receipt');
  assert.deepEqual(h.repository.state, state); assert.deepEqual(h.repository.receipts, receipts);
  assert.equal(h.repository.state.events.filter(event => event.type === 'debt_repayment_received').length, 1);
});

test('R6 DEEP a programming exception inside a repository callback is not an infrastructure refusal', async () => {
  const h = harness(), expected = new Error('Broken domain callback');
  const transact = h.repository.transact.bind(h.repository);
  h.repository.transact = (...args) => {
    const update = args[4]; args[4] = state => { Object.defineProperty(state.policies, 'push', { value() { throw expected; } }); return update(state); };
    return transact(...args);
  };
  const state = structuredClone(h.repository.state), receipts = structuredClone(h.repository.receipts);
  await assert.rejects(() => h.execute(A, { type: 'publish_policy', policy: { ...h.config, version: 'callback-error', effectiveAt: 200 } }), error => error === expected);
  assert.deepEqual(h.repository.state, state); assert.deepEqual(h.repository.receipts, receipts);
});

for (const method of ['now', 'add']) test(`R6 DEEP Clock ${method} outage is typed and atomic`, async () => {
  const h = harness(); await h.published(); await h.offer();
  h.clock[method] = () => { throw new Error('Clock unavailable'); };
  await deny(h, () => h.execute(M, { type: 'final_application', jobId: 'job', masterId: 'master', amount: 1000n, recipientId: 'client', confirmed: true }), 'InvalidConfiguration');
});

test('R6 DEEP job text never consults an unavailable Support attachment policy', async () => {
  const h = harness(); await h.published(); await h.offer();
  h.ports.supportAttachments.photosAllowed = () => { throw new Error('Unavailable unrelated policy'); };
  await h.message(C, 'A lawful job message');
  assert.equal(h.repository.state.threads['chat:job:master'].messageIds.length, 1);
});

for (const changed of ['delivery', 'event', 'status']) test(`R6 DEEP notification ${changed} binding is current after claiming delivery`, async () => {
  const h = harness(); await h.published(); await h.offer();
  await h.ok(C, { type: 'preferences', preference: { userId: 'client', role: 'client', channels: ['test-channel'], eventTypes: ['initial_offer_sent'], soundRequested: false } });
  const notification = h.repository.state.events.find(event => event.type === 'initial_offer_sent'), claim = h.repository.claimDelivery.bind(h.repository);
  let calls = 0;
  h.repository.claimDelivery = async id => {
    const result = await claim(id);
    if (changed === 'delivery') h.repository.state.deliveries[id].recipientId = 'stranger';
    else if (changed === 'event') h.repository.state.events.find(event => event.id === notification.id).subjectId = 'another-offer';
    else h.repository.state.deliveries[id].status = 'delivered';
    return result;
  };
  h.ports.notifications.deliver = async () => { calls++; return { ok: true, value: 'delivered' }; };
  const result = await h.core.dispatchNotification(A, notification.id, 'client', 'test-channel', 'bound-delivery');
  assert.equal(result.ok, false); assert.equal(result.error.code, changed === 'status' ? 'InvalidTransition' : 'InvalidReference'); assert.equal(calls, 0);
});

test('R6 DEEP a delivery acknowledgement cannot settle a rebound attempt', async () => {
  const h = harness(); await h.published(); await h.offer();
  await h.ok(C, { type: 'preferences', preference: { userId: 'client', role: 'client', channels: ['test-channel'], eventTypes: ['initial_offer_sent'], soundRequested: false } });
  const event = h.repository.state.events.find(event => event.type === 'initial_offer_sent'); let calls = 0;
  h.ports.notifications.deliver = async () => { calls++; h.repository.state.deliveries.rebound.eventId = 'unrelated'; return { ok: true, value: 'delivered' }; };
  const result = await h.core.dispatchNotification(A, event.id, 'client', 'test-channel', 'rebound');
  assert.equal(result.ok, false); assert.equal(result.error.code, 'InvalidReference'); assert.equal(calls, 1);
  assert.equal(h.repository.state.deliveries.rebound.status, 'pending');
  assert.equal(h.repository.receipts.has('delivery-result:rebound'), false);
});

for (const mode of ['outage', 'malformed', 'lost-ack']) test(`R6 DEEP notification claim ${mode} never permits an uncertain resend`, async () => {
  const h = harness(); await h.published(); await h.offer();
  await h.ok(C, { type: 'preferences', preference: { userId: 'client', role: 'client', channels: ['test-channel'], eventTypes: ['initial_offer_sent'], soundRequested: false } });
  const event = h.repository.state.events.find(event => event.type === 'initial_offer_sent'), claim = h.repository.claimDelivery.bind(h.repository); let calls = 0;
  h.repository.claimDelivery = async id => {
    if (mode === 'outage') throw new Error('Unavailable');
    if (mode === 'malformed') return { ok: true, value: 'true' };
    await claim(id); throw new Error('Acknowledgement lost');
  };
  h.ports.notifications.deliver = async () => { calls++; return { ok: true, value: 'delivered' }; };
  const result = await h.core.dispatchNotification(A, event.id, 'client', 'test-channel', 'claim');
  assert.equal(result.ok, false); assert.equal(calls, 0);
  if (mode === 'lost-ack') {
    h.repository.claimDelivery = claim;
    const repeated = await h.core.dispatchNotification(A, event.id, 'client', 'test-channel', 'claim');
    assert.equal(repeated.ok, true); assert.equal(repeated.value, 'requested'); assert.equal(calls, 0);
    assert.equal(h.repository.state.deliveries.claim.status, 'pending');
  }
});

for (const changed of ['original', 'recipient', 'missing']) test(`R6 DEEP Platform Inbox ${changed} requires the original addressed message`, async () => {
  const h = harness(); await h.ok(A, { type: 'inbox', id: 'private-message', recipientId: 'client', original: 'Private platform message' });
  if (changed === 'original') h.repository.state.inbox['private-message'].original = 'Replacement message';
  else if (changed === 'recipient') h.repository.state.inbox['private-message'].recipientId = 'stranger';
  else delete h.repository.state.inbox['private-message'];
  await deny(h, () => read(h, { type: 'inbox' }, changed === 'recipient' ? 'stranger:client' : C), 'InvalidReference');
});

test('R6 DEEP Admin contact access still validates the original account identity', async () => {
  const h = harness(); h.claims.set('login', { id: 'contact-claim', purpose: 'login', identity: { method: 'email', subject: 'new' }, email: 'new@test.invalid', phone: null, ownerId: null, expiresAt: 1000 });
  assert.equal((await h.core.authenticate('login', 'new', 'new-account')).ok, true);
  h.repository.state.users.new.email = 'replacement@test.invalid';
  await deny(h, () => read(h, { type: 'contacts', userId: 'new' }, A), 'InvalidReference');
});
