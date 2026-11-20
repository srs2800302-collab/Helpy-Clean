import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './f2-harness.mjs';

const A = 'admin', C = 'client:client', M = 'master:master';
const cases = [
  ['claim', 'ContactUnverified'], ['profile-photo', 'InvalidPhoto'], ['incoming-route', 'RouteUnavailable'],
  ['provider-outcome', 'ProviderConflict'], ['payout-destination', 'DestinationUnverified'],
  ['refund-destination', 'DestinationUnverified'], ['admin-directory', 'Unauthorized'],
  ['support-attachments', 'InvalidPhoto'], ['legal-policy', 'RetentionBlocked'], ['legal-restrictions', 'RetentionBlocked'],
  ['repository-replay', 'RepositoryUnavailable'], ['repository-transaction', 'RepositoryOutcomeUnknown'],
];
async function repayment(h) {
  await h.completed(); await h.ok(M, { type: 'request_repayment', id: 'request', amount: 100n, confirmed: true });
  await h.ok(A, { type: 'support', id: 'support', userId: 'master', userRole: 'master', basis: 'repayment', basisId: 'request' });
}

for (const [name, code] of cases) for (const mode of ['outage', 'malformed']) test(`R6 PORT ${name} ${mode} preserves all business facts and receipts`, async () => {
  const h = harness(); let port, method, action;
  switch (name) {
    case 'claim': port = h.ports.auth; method = 'verifyClaim'; action = () => h.core.authenticate('proof', 'new-user', 'claim-operation'); break;
    case 'profile-photo': port = h.ports.photos; method = 'lookup'; action = () => h.execute(C, { type: 'profile', displayName: 'Client', photoId: 'client-photo', specialization: { categoryIds: [], entityIds: [] } }); break;
    case 'incoming-route': await h.reserved(); port = h.ports.payments; method = 'incomingRoute'; action = () => h.execute(C, { type: 'initiate_payment', jobId: 'job', id: 'payment', route: 'card' }); break;
    case 'provider-outcome': await h.reserved(); await h.ok(C, { type: 'initiate_payment', jobId: 'job', id: 'payment', route: 'card' });
      port = h.ports.payments; method = 'verifyOutcome'; action = () => h.execute(A, { type: 'payment_outcome', jobId: 'job', proof: 'proof' }); break;
    case 'payout-destination': await h.completed('card'); port = h.ports.payments; method = 'payoutDestination'; action = () => h.execute(A, { type: 'start_payout', jobId: 'job', attemptId: 'transfer' }); break;
    case 'refund-destination': {
      await h.assigned('card');
      await h.ok(C, { type: 'cancel', jobId: 'job', id: 'request', reason: 'Changed plans', explanation: 'Before arrival', evidence: [], confirmed: true, classification: 'ordinary', remainingWork: '' });
      await h.ok(M, { type: 'cancellation_response', jobId: 'job', workStopped: true, financialConsent: true, explanation: '' });
      await h.ok(A, { type: 'decide_resolution', caseId: 'case:request', decision: { id: 'decision', type: 'mutual', reason: 'Reviewed before arrival', evidence: ['request'],
        facts: { arrived: false, partialWork: false, voluntaryRefusalProven: false, acceptanceReviewed: false, historyReviewed: true } } });
      port = h.ports.payments; method = 'settlementDestination'; action = () => h.execute(A, { type: 'start_settlement', obligationId: 'decision:refund', attemptId: 'refund' }); break;
    }
    case 'admin-directory': await h.completed(); port = h.ports.directory; method = 'admins'; action = () => h.execute(M, { type: 'request_repayment', id: 'request', amount: 100n, confirmed: true }); break;
    case 'support-attachments': await repayment(h); port = h.ports.supportAttachments; method = 'photosAllowed'; action = () => h.execute(M, { type: 'message', id: 'attachment', chatId: 'support', original: 'Work explanation', photoIds: ['master-photo'], sender: 'user' }); break;
    case 'legal-policy': port = h.ports.legalRetention; method = 'validate'; action = () => h.execute(A, { type: 'publish_policy', policy: { ...h.config, version: 'next', effectiveAt: 200 } }); break;
    case 'legal-restrictions': await h.completed(); port = h.ports.legalRetention; method = 'restrictions'; action = () => h.execute(A, { type: 'evaluate_retention', factId: 'communication:job' }); break;
    case 'repository-replay': await h.published(); await h.offer(); port = h.repository; method = 'replay'; action = () => h.execute(C, { type: 'message', chatId: 'chat:job:master', id: 'message', original: 'Work discussion', photoIds: [], sender: 'user' }); break;
    case 'repository-transaction': port = h.repository; method = 'transact'; action = () => h.execute(C, { type: 'locale', locale: 'ru' }); break;
    default: assert.fail(name);
  }
  port[method] = () => { if (mode === 'outage') throw new Error('Operational outage'); return name === 'admin-directory' ? Promise.resolve(null) : { ok: true, value: null }; };
  const state = structuredClone(h.repository.state), receipts = structuredClone(h.repository.receipts);
  const result = await action(); assert.equal(result.ok, false);
  assert.equal(result.error.code, name === 'repository-replay' && mode === 'malformed' ? 'RepositoryOutcomeUnknown' : code);
  assert.deepEqual(h.repository.state, state); assert.deepEqual(h.repository.receipts, receipts);
});

test('R6 PORT malformed acknowledgement after commit reports uncertainty and replays only the committed effect', async () => {
  const h = harness(), transact = h.repository.transact.bind(h.repository);
  h.repository.transact = async (...args) => { await transact(...args); return { ok: true, value: null }; };
  const command = { type: 'locale', locale: 'ru' }, result = await h.execute(C, command, 'committed-locale');
  assert.equal(result.ok, false); assert.equal(result.error.code, 'RepositoryOutcomeUnknown');
  assert.equal(h.repository.state.users.client.locale, 'ru');
  const state = structuredClone(h.repository.state), receipts = structuredClone(h.repository.receipts);
  h.repository.transact = transact; await h.ok(C, command, 'committed-locale');
  assert.deepEqual(h.repository.state, state); assert.deepEqual(h.repository.receipts, receipts);
});

for (const mode of ['outage', 'malformed']) test(`R6 PORT notification delivery ${mode} never becomes a retryable failed send`, async () => {
  const h = harness(); await h.published(); await h.offer();
  await h.ok(C, { type: 'preferences', preference: { userId: 'client', role: 'client', eventTypes: ['initial_offer_sent'], channels: ['test-channel'], soundRequested: false } });
  const event = h.repository.state.events.find(record => record.type === 'initial_offer_sent'), events = structuredClone(h.repository.state.events);
  let calls = 0;
  h.ports.notifications.deliver = async () => { calls++; if (mode === 'outage') throw new Error('Acknowledgement unavailable'); return { ok: true, value: 'unknown' }; };
  const first = await h.core.dispatchNotification(A, event.id, 'client', 'test-channel', 'uncertain-send');
  assert.equal(first.ok, false); assert.equal(first.error.code, 'InvalidTransition'); assert.equal(calls, 1);
  assert.equal(h.repository.state.deliveries['uncertain-send'].status, 'pending');
  assert.equal(h.repository.receipts.has('delivery-result:uncertain-send'), false);
  assert.deepEqual(h.repository.state.events, events);
  const repeated = await h.core.dispatchNotification(A, event.id, 'client', 'test-channel', 'uncertain-send');
  assert.equal(repeated.ok, true); assert.equal(repeated.value, 'requested'); assert.equal(calls, 1);
});

test('R6 PORT Support photo policy receives the final authenticated principal, including changed capabilities', async () => {
  const h = harness(); await repayment(h);
  const authenticate = h.ports.auth.authenticate, lookup = h.ports.photos.lookup; let enabled = true;
  h.ports.auth.authenticate = async session => {
    const result = await authenticate(session);
    return result.ok && session === M ? { ok: true, value: { ...result.value, permissions: enabled ? ['test-media-capability'] : [] } } : result;
  };
  h.ports.supportAttachments.photosAllowed = actor => actor.permissions.includes('test-media-capability');
  h.ports.photos.lookup = async ids => { const result = await lookup(ids); enabled = false; return result; };
  const state = structuredClone(h.repository.state), receipts = structuredClone(h.repository.receipts);
  const result = await h.execute(M, { type: 'message', id: 'photo-only', chatId: 'support', original: '', photoIds: ['master-photo'], sender: 'user' });
  assert.equal(result.ok, false); assert.equal(result.error.code, 'InvalidPhoto');
  assert.deepEqual(h.repository.state, state); assert.deepEqual(h.repository.receipts, receipts);
});
