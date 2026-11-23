import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, admin } from './f2-harness.mjs';
import { success } from '../dist/domain/core.js';
import { query } from '../dist/application/queries.js';
import { scope } from './f2-fixtures.mjs';

const A = 'admin', C = 'client:client', M = 'master:master';
const read = (h, session, input) => query(h.repository, h.ports.auth, h.clock, session, input);
async function denied(h, action, codes) {
  const before = await h.repository.read(), receipts = structuredClone(h.repository.receipts);
  const result = await action();
  assert.equal(result.ok, false);
  assert.ok(codes.includes(result.error.code), result.error.code);
  assert.deepEqual(await h.repository.read(), before); assert.deepEqual(h.repository.receipts, receipts);
}
function claim(id, purpose, ownerId = 'client') {
  return { id, purpose, identity: { method: 'email', subject: 'client-identity' }, email: 'client@test.invalid', phone: null, expiresAt: 1000, ownerId };
}

test('AUDIT accounts login cannot choose an arbitrary owner of a duplicated saved identity', async () => {
  const h = harness(), verified = claim('login-unique', 'login');
  h.repository.state.users.client.identities = [verified.identity]; h.claims.set('proof', verified);
  assert.equal((await h.core.authenticate('proof', 'unused', 'login-control')).value.id, 'client');
  h.repository.state.users.stranger.identities = [verified.identity];
  h.claims.set('duplicate', { ...verified, id: 'duplicate-claim' });
  await denied(h, () => h.core.authenticate('duplicate', 'unused', 'duplicate-login'), ['IdentityOccupied', 'InvalidReference']);
});

for (const operation of ['login', 'recover', 'locale', 'bind']) test(`AUDIT accounts ${operation} rejects a saved owner/key mismatch`, async () => {
  const h = harness(), verified = claim(`claim:${operation}`, operation === 'bind' ? 'bind' : operation);
  h.repository.state.users.client.identities = [verified.identity]; h.claims.set('proof', verified);
  h.repository.state.users.client.id = 'stranger';
  const action = operation === 'login' ? () => h.core.authenticate('proof', 'unused', 'owner-login') :
    operation === 'recover' ? () => h.core.authenticate('proof', 'client', 'owner-recover', true) :
    operation === 'locale' ? () => h.execute(C, { type: 'locale', locale: 'ru' }) :
    () => h.execute(C, { type: 'bind_contact', proof: 'proof' });
  await denied(h, action, ['InvalidReference', 'Unauthorized', 'ContactUnverified']);
});

for (const [field, value] of [['initialAutoClose', 'false'], ['initialDuration', 0], ['commission', { numerator: 101n, denominator: 100n }],
  ['locales', ['en', 'en']], ['clientPaymentRoutes', ['cash', 'unapproved-route']]]) test(`AUDIT policy rejects invalid saved ${field} before a dependent read or command`, async () => {
  const h = harness(); await h.published();
  h.repository.state.policies[0][field] = value;
  await denied(h, () => read(h, M, { type: 'feed' }), ['InvalidConfiguration', 'InvalidRate', 'InvalidLocale']);
  await denied(h, () => h.execute(C, { type: 'new_job', id: 'invalid-policy-job', draft: { items: [scope(h.fixture)], cep: 1000n, publicAddress: 'Public district street', address: 'Exact address' } }), ['InvalidConfiguration', 'InvalidRate', 'InvalidLocale']);
});

test('AUDIT policy does not resolve duplicate saved versions or effective instants arbitrarily', async () => {
  for (const sameVersion of [true, false]) {
    const h = harness();
    h.repository.state.policies.push({ ...h.config, version: sameVersion ? h.config.version : 'duplicate-time', effectiveAt: sameVersion ? 1 : h.config.effectiveAt });
    await denied(h, () => read(h, M, { type: 'feed' }), ['Conflict', 'InvalidConfiguration']);
  }
});

test('AUDIT a managed policy remains bound to the original Admin publication', async () => {
  const h = harness();
  await h.ok(A, { type: 'publish_policy', policy: { ...h.config, version: 'managed-policy', effectiveAt: 100 } });
  await h.published('legitimate-policy-control');
  h.repository.state.policies.find(value => value.version === 'managed-policy').initialAutoClose = false;
  await denied(h, () => h.execute(C, { type: 'new_job', id: 'corrupt-policy', draft: { items: [scope(h.fixture)], cep: 1000n, publicAddress: 'Public district street', address: 'Exact address' } }), ['InvalidReference', 'InvalidConfiguration']);
});

for (const corruption of ['status', 'enabled', 'questions']) test(`AUDIT canonical published catalog validates saved ${corruption} before use`, async () => {
  const h = harness(); await h.published('catalog-control');
  const catalog = h.repository.state.published['test-catalog:1'];
  if (corruption === 'status') catalog.status = 'draft';
  if (corruption === 'enabled') catalog.categories[0].enabled = 'false';
  if (corruption === 'questions') catalog.scenarios[0].form.questions = null;
  await denied(h, () => h.execute(C, { type: 'new_job', id: 'invalid-catalog', draft: { items: [scope(h.fixture)], cep: 1000n, publicAddress: 'Public district street', address: 'Exact address' } }),
    ['InvalidReference', 'InvalidConfiguration', 'ApprovalRequired']);
});

test('AUDIT personal Cash threshold is bound to the confirmed Admin command rather than mutable history', async () => {
  const h = harness(); await h.ok(A, { type: 'threshold', masterId: 'master', amount: 100n });
  h.repository.state.debt.master = 100n;
  const control = await read(h, C, { type: 'cash_availability', masterId: 'master' }); assert.equal(control.value.mode, 'noncash_only');
  h.repository.state.thresholds.master = 1000n; h.repository.state.thresholdHistory[0].amount = 1000n;
  await denied(h, () => read(h, C, { type: 'cash_availability', masterId: 'master' }), ['InvalidReference', 'InvalidConfiguration']);
});

for (const mutation of ['erase', 'rewrite', 'closed']) test(`AUDIT pending Resolution ${mutation} cannot replace its original opening`, async () => {
  const h = harness(); await h.assigned('card');
  await h.ok(A, { type: 'open_resolution', jobId: 'job', id: 'case-original', evidence: [] });
  const inspected = await h.ok(A, { type: 'inspect_resolution', caseId: 'case-original' });
  assert.equal(inspected.outcome.resolution.status, 'admin_resolution_pending');
  const job = h.repository.state.jobs.job, resolution = h.repository.state.cases['case-original'];
  if (mutation === 'erase') { job.resolutionId = null; delete h.repository.state.cases['case-original']; }
  if (mutation === 'rewrite') { resolution.openedAt++; resolution.evidence = ['invented-original-evidence']; }
  if (mutation === 'closed') resolution.status = 'closed_by_master_completion';
  await denied(h, () => read(h, C, { type: 'job', jobId: 'job' }), ['InvalidReference', 'EvidenceRequired', 'ResolutionRequired']);
});

test('AUDIT case cannot be invented for a genuine cancellation without its original opening', async () => {
  const h = harness(); await h.assigned('card');
  await h.ok(C, { type: 'cancel', jobId: 'job', id: 'request-origin', classification: 'ordinary', confirmed: true,
    reason: 'changed plans', explanation: 'Client request before arrival', remainingWork: '', evidence: [] });
  const job = h.repository.state.jobs.job;
  h.repository.state.cases.invented = { id: 'invented', jobId: job.id, requestId: job.cancellation.id, openedAt: h.clock.now(),
    snapshotPolicy: job.financial.policyVersion, evidence: [], status: 'admin_resolution_pending', decision: null };
  job.resolutionId = 'invented';
  await denied(h, () => h.execute(A, { type: 'inspect_resolution', caseId: 'invented' }), ['InvalidReference', 'ResolutionRequired']);
});

test('AUDIT official Support uses the author role, not a disjoint user ID namespace', async () => {
  const h = harness(); await h.completed();
  await h.ok(M, { type: 'request_repayment', id: 'role-repayment', amount: 100n, confirmed: true });
  await h.ok(A, { type: 'support', id: 'role-support', userId: 'master', userRole: 'master', basis: 'repayment', basisId: 'role-repayment' });
  const authenticate = h.ports.auth.authenticate;
  h.ports.auth.authenticate = session => session === 'staff-master' ? Promise.resolve(success({ ...admin, userId: 'master' })) : authenticate(session);
  await h.ok('staff-master', { type: 'message', id: 'official-same-user', chatId: 'role-support', original: 'Official support reply', photoIds: [], sender: 'helpy' });
  const result = await read(h, M, { type: 'chat_history', chatId: 'role-support' });
  assert.equal(result.ok, true); assert.equal(result.value.messages[0].authorId, 'helpy');
  assert.equal(result.value.messages[0].original, 'Official support reply');
  assert.equal((await h.core.translateMessage(M, 'official-same-user', 'ru')).ok, true);
});

test('AUDIT official employee evidence cannot impersonate the Master through an equal user ID', async () => {
  const h = harness(); await h.assigned('card');
  await h.ok(M, { type: 'cancel', jobId: 'job', id: 'request', reason: 'External circumstances', explanation: 'Requires review, not a voluntary refusal',
    evidence: [], confirmed: true, classification: 'unclassified', remainingWork: '' });
  await h.ok(A, { type: 'support', id: 'case-support', userId: 'master', userRole: 'master', basis: 'resolution', basisId: 'case:request' });
  const authenticate = h.ports.auth.authenticate;
  h.ports.auth.authenticate = session => session === 'staff-master' ? Promise.resolve(success({ ...admin, userId: 'master' })) : authenticate(session);
  await h.ok('staff-master', { type: 'message', id: 'employee-evidence', chatId: 'case-support', original: 'Official employee explanation', photoIds: [], sender: 'helpy' });
  await denied(h, () => h.execute(A, { type: 'decide_resolution', caseId: 'case:request', decision: { id: 'wrong-attribution', type: 'master_refusal',
    reason: 'Review', evidence: ['employee-evidence'], facts: { arrived: false, partialWork: false, voluntaryRefusalProven: true, acceptanceReviewed: false, historyReviewed: true } } }), ['EvidenceRequired']);
});

test('AUDIT delivery rejects another user or role stored under a recipient preference key', async () => {
  for (const change of ['userId', 'role']) {
    const h = harness(); await h.published(); await h.offer();
    await h.ok(C, { type: 'preferences', preference: { userId: 'client', role: 'client', eventTypes: ['initial_offer_sent'], channels: ['test-channel'], soundRequested: false } });
    const event = h.repository.state.events.find(record => record.type === 'initial_offer_sent');
    h.repository.state.preferences['client:client'][change] = change === 'userId' ? 'stranger' : 'master';
    let calls = 0; h.ports.notifications.deliver = async () => { calls++; return success('delivered'); };
    await denied(h, () => h.core.dispatchNotification(A, event.id, 'client', 'test-channel', 'mismatched-preference'), ['InvalidReference', 'Unauthorized', 'InvalidConfiguration']);
    assert.equal(calls, 0);
  }
});

for (const operation of ['counts', 'cash-view', 'debt-view', 'reputation', 'threshold', 'publication']) test(`AUDIT ${operation} validates the addressed profile identity`, async () => {
  const h = harness();
  if (operation === 'publication') await h.ok(C, { type: 'new_job', id: 'identity-publication', draft: { items: [scope(h.fixture)], cep: 1000n, publicAddress: 'Public district street', address: 'Exact address' } });
  h.repository.state.users.master.id = 'stranger';
  const action = operation === 'counts' ? () => read(h, A, { type: 'role_counts' }) :
    operation === 'cash-view' ? () => read(h, C, { type: 'cash_availability', masterId: 'master' }) :
    operation === 'debt-view' ? () => read(h, A, { type: 'debt', masterId: 'master' }) :
    operation === 'reputation' ? () => read(h, C, { type: 'reputation', masterId: 'master' }) :
    operation === 'threshold' ? () => h.execute(A, { type: 'threshold', masterId: 'master', amount: 1000n }) :
    () => h.execute(C, { type: 'publish_job', jobId: 'identity-publication' });
  await denied(h, action, ['InvalidReference', 'Unauthorized']);
});

test('AUDIT refusal accounting rejects nonnumeric saved counters atomically', async () => {
  const h = harness(); await h.published(); await h.offer(); h.repository.state.refusalStreak.master = '2';
  await denied(h, () => h.execute(M, { type: 'terminate_negotiation', jobId: 'job', masterId: 'master', confirmed: true, reason: 'Withdraw offer' }), ['InvalidReference']);
});

test('AUDIT a recorded refusal counter cannot be reset without its completed transition', async () => {
  const h = harness(); await h.published('withdrawn'); await h.offer('withdrawn');
  await h.ok(M, { type: 'terminate_negotiation', jobId: 'withdrawn', masterId: 'master', confirmed: true, reason: 'Withdraw offer' });
  assert.equal(h.repository.state.refusalStreak.master, 1);
  await h.published(); await h.offer();
  h.repository.state.refusalStreak.master = 0;
  await denied(h, () => h.execute(M, { type: 'terminate_negotiation', jobId: 'job', masterId: 'master', confirmed: true, reason: 'Second withdrawal' }), ['InvalidReference']);
});
