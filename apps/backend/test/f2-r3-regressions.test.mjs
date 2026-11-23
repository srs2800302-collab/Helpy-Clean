import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { harness, FakeRepository } from './f2-harness.mjs';
import { DomainCore } from '../dist/application/domain-core.js';
import { query } from '../dist/application/queries.js';
import { checked, failure, success } from '../dist/domain/core.js';

const client = 'client:client', master = 'master:master', chatId = 'chat:job:master';
const facts = { arrived: false, partialWork: false, voluntaryRefusalProven: false, acceptanceReviewed: false, historyReviewed: false };
const records = [];
function scenario(id, defects, norms, body) {
  test(`R3 REGRESSION ${id}`, async () => {
    const observations = await body();
    assert.ok(observations && Object.keys(observations).length);
    records.push({ id, defects, norms, test: `R3 REGRESSION ${id}`, testFile: 'apps/backend/test/f2-r3-regressions.test.mjs', status: 'PASS', observations });
  });
}
async function deny(h, session, command, operationId) {
  const before = await h.repository.read(), receipts = structuredClone(h.repository.receipts);
  const result = await h.execute(session, command, operationId);
  assert.equal(result.ok, false); assert.equal(typeof result.error.code, 'string'); assert.equal(typeof result.error.detail, 'string');
  assert.deepEqual(await h.repository.read(), before); assert.deepEqual(h.repository.receipts, receipts);
  return { failure: result.error.code, unchanged: true, receiptsUnchanged: true };
}
const cancelCommand = (classification = 'ordinary', extra = {}) => ({ type: 'cancel', jobId: 'job', id: 'cancel', reason: 'Stop',
  explanation: 'Cannot continue', remainingWork: classification === 'partial' ? 'Mount the remaining cabinet doors' : '',
  classification, evidence: classification === 'partial' ? ['client-photo'] : [], confirmed: true, ...extra });
async function partial(h, method = 'card', remainingWork, initiator = 'client') {
  await h.assigned(method);
  await h.ok(initiator === 'client' ? client : master, cancelCommand(initiator === 'client' ? 'ordinary' : 'partial',
    initiator === 'master' ? { remainingWork, evidence: ['master-photo'] } : {}));
  const message = await h.message(master, 'Access caused a delay', 'job', 'master', { photoIds: ['master-photo'] });
  if (initiator === 'client') await h.ok(master, { type: 'cancellation_response', jobId: 'job', workStopped: true, financialConsent: false,
    explanation: 'Access caused a delay', ...(remainingWork === undefined ? {} : { remainingWork }), evidence: [message.outcome.message.id] });
  return { type: 'decide_resolution', caseId: 'case:cancel', decision: { id: 'decision', type: 'partial', reason: 'Reviewed actual master evidence',
    evidence: [message.outcome.message.id], facts: { ...facts, partialWork: true }, shares: { clientRefund: 400n, masterCompensation: 300n } } };
}
async function outgoing(h, kind) {
  if (kind === 'payout') { await h.completed('card'); return { type: 'start_payout', jobId: 'job', attemptId: 'attempt' }; }
  await h.assigned('card');
  if (kind === 'refund') {
    await h.ok(client, cancelCommand());
    await h.ok(master, { type: 'cancellation_response', jobId: 'job', workStopped: true, financialConsent: true, explanation: '' });
  } else await h.ok(master, cancelCommand('false_call', { evidence: ['master-photo'] }));
  await h.ok('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: { id: 'decision',
    type: kind === 'refund' ? 'mutual' : 'false_call', reason: 'Reviewed original evidence',
    evidence: kind === 'refund' ? ['cancel'] : ['master-photo'], facts: { ...facts, arrived: kind === 'compensation' } } });
  return { type: 'start_settlement', obligationId: `decision:${kind}`, attemptId: 'attempt' };
}
const attempts = (h, kind) => kind === 'payout' ? h.repository.state.payouts.job.attempts : h.repository.state.obligations[`decision:${kind}`].attempts;

for (const initiator of ['client', 'master']) for (const method of ['cash', 'card']) {
  scenario(`D01 ${initiator} ${method} awaiting reply boundaries`, ['R3-D01'], ['CFG.cancellationReminder', 'CFG.cancellationResponse', 'RES.4'], async () => {
    const h = harness(); await h.assigned(method);
    await h.ok(initiator === 'client' ? client : master, cancelCommand(initiator === 'client' ? 'partial' : 'unclassified'));
    const request = structuredClone(h.repository.state.jobs.job.cancellation), expected = initiator === 'client' ? 'master' : 'client';
    h.clock.value = request.reminder.deadline - 1; await h.ok('admin', { type: 'reminders', jobId: 'job' });
    assert.equal(h.repository.state.events.filter(e => e.type === 'cancellation_reminder').length, 0);
    h.clock.value++; const command = { type: 'reminders', jobId: 'job' };
    const results = await Promise.all([h.execute('admin', command, 'reminder-once'), h.execute('admin', command, 'reminder-once')]);
    assert.ok(results.every(r => r.ok));
    assert.deepEqual(h.repository.state.events.filter(e => e.type === 'cancellation_reminder').map(e => e.recipients), [[expected]]);
    h.clock.value = h.repository.state.jobs.job.cancellation.reminder.deadline; await h.ok('admin', command);
    assert.equal(h.repository.state.events.filter(e => e.type === 'cancellation_reminder').length, 2);
    h.clock.value = request.responseTimer.deadline; await h.ok('admin', command);
    assert.equal(h.repository.state.events.filter(e => e.type === 'cancellation_reminder').length, 2);
    assert.equal(Object.keys(h.repository.state.cases).length, 1);
    assert.equal(h.repository.state.jobs.job.cancellation.financialConsent, null);
    assert.deepEqual(h.repository.state.ledger, {}); assert.deepEqual(h.repository.state.obligations, {});
    return { expected, reminders: 2, cases: 1, deadlineNoConsent: true, ledger: 0 };
  });
}
scenario('D01 response and fixed False Call stop cancellation reminders', ['R3-D01'], ['RES.4', 'RES.6'], async () => {
  for (const classification of ['ordinary', 'false_call']) {
    const h = harness(); await h.assigned('card');
    await h.ok(classification === 'ordinary' ? client : master, cancelCommand(classification, classification === 'false_call' ? { evidence: ['master-photo'] } : {}));
    if (classification === 'ordinary') await h.ok(master, { type: 'cancellation_response', jobId: 'job', workStopped: true, financialConsent: true, explanation: '' });
    h.clock.value = h.repository.state.jobs.job.cancellation.responseTimer.deadline;
    await h.ok('admin', { type: 'reminders', jobId: 'job' });
    assert.equal(h.repository.state.events.filter(e => e.type === 'cancellation_reminder').length, 0);
    assert.equal(Object.keys(h.repository.state.cases).length, 1); assert.equal(h.repository.state.jobs.job.funds, 'held');
  }
  return { replied: true, fixedFalseCall: true, reminders: 0, held: true };
});

for (const state of ['reserved', 'pending', 'unknown', 'cash', 'card', 'released']) {
  scenario(`D02 negotiation timers retired at selection ${state}`, ['R3-D02'], ['OFR.17', 'CFG.negotiationFirstReminder', 'CFG.negotiationRepeatReminder'], async () => {
    const h = harness({ paymentSelectionTimeout: 7200 }); await h.published(); await h.offer(); await h.offer('job', 'master2'); await h.bilateral();
    const old = structuredClone(h.repository.state.threads[chatId].reminder); await h.reserved();
    assert.equal(h.repository.state.jobs.job.chatId, chatId);
    assert.equal(h.repository.state.threads[chatId].reminder, null); assert.equal(h.repository.state.threads[chatId].waitingFor, null);
    assert.equal(h.repository.state.threads['chat:job:master2'].mode, 'closed');
    if (state === 'pending' || state === 'unknown' || state === 'card') {
      await h.ok(client, { type: 'initiate_payment', jobId: 'job', id: 'incoming', route: 'card' });
      if (state !== 'pending') {
        h.outcomes.set('provider', { operationId: 'incoming', amount: 1000n, currency: 'THB', status: state === 'card' ? 'success' : 'unknown' });
        await h.ok('admin', { type: 'payment_outcome', jobId: 'job', proof: 'provider' });
      }
    }
    if (state === 'cash') await h.ok(client, { type: 'cash', jobId: 'job' });
    if (state === 'released') await h.ok(client, { type: 'decline_reservation', jobId: 'job', confirmed: true });
    // Simulate a stale persisted reminder as well: scheduler must reject its mode.
    if (state === 'reserved') { h.repository.state.threads[chatId].reminder = old; h.repository.state.threads[chatId].waitingFor = 'client'; }
    h.clock.value = old.deadline; await h.ok('admin', { type: 'reminders', jobId: 'job' }, 'scheduler');
    await h.ok('admin', { type: 'reminders', jobId: 'job' }, 'scheduler');
    assert.equal(h.repository.state.events.filter(e => e.type === 'negotiation_reminder').length, 0);
    return { state, negotiationReminders: 0, sameChatId: true };
  });
}

scenario('D03 retention replay recomputes legal hold minimum and Clock after restart', ['R3-D03'], ['RET.5', 'RET.6', 'RET.8'], async () => {
  const h = harness(); await h.completed('card'); const factId = 'communication:job', original = structuredClone(h.repository.state.retention[factId]);
  h.clock.value = original.deadline; const command = { type: 'evaluate_retention', factId };
  assert.equal((await h.ok('admin', command, 'assessment')).outcome.assessment.eligibleForRetentionAction, true);
  const events = h.repository.state.events.length;
  let legal = { hold: true, notBefore: null }; h.ports.legalRetention.restrictions = () => success(legal);
  assert.equal((await h.ok('admin', command, 'assessment')).outcome.assessment.eligibleForRetentionAction, false);
  legal = { hold: false, notBefore: h.clock.now() + 10 };
  assert.equal((await h.ok('admin', command, 'assessment')).outcome.assessment.eligibleForRetentionAction, false);
  const repo = new FakeRepository(await h.repository.read(), structuredClone(h.repository.receipts));
  const core = new DomainCore({ ...h.ports, repository: repo });
  h.clock.value += 10;
  assert.equal((await core.execute('admin', 'assessment', command)).value.outcome.assessment.eligibleForRetentionAction, true);
  h.clock.value = original.deadline - 1;
  assert.equal((await core.execute('admin', 'assessment', command)).value.outcome.assessment.eligibleForRetentionAction, false);
  assert.equal(repo.state.events.length, events); assert.deepEqual(repo.state.retention[factId], original);
  h.repository.state.retention[factId].deadline--;
  const denied = await deny(h, 'admin', command, 'assessment');
  return { ...denied, refreshedHoldAndMinimum: true, clockBoundary: true, restart: true, duplicateAudit: 0 };
});
for (const legal of [null, {}, { hold: 'false', notBefore: null }, { hold: false, notBefore: NaN }]) {
  scenario(`D03 malformed restriction ${JSON.stringify(legal)}`, ['R3-D03', 'R3-D07'], ['RET.6', 'APP.1'], async () => {
    const h = harness(); await h.completed(); h.ports.legalRetention.restrictions = () => success(legal);
    return deny(h, 'admin', { type: 'evaluate_retention', factId: 'communication:job' });
  });
}

for (const photoId of ['missing-master-photo', 'client-photo', ' ', '', null]) {
  scenario(`D04 invalid Master photo ${String(photoId)}`, ['R3-D04'], ['ACC.8'], async () => {
    const h = harness(); const command = { type: 'profile', displayName: 'Master', photoId, specialization: { categoryIds: ['appliance'], entityIds: [] } };
    const denied = await deny(h, master, command); assert.equal(h.repository.state.users.master.photoId, 'photo:master');
    h.repository.state.users.master.masterActive = false; h.repository.state.users.master.photoId = photoId;
    await deny(h, master, { type: 'activate', role: 'master' });
    assert.equal(h.repository.state.users.master.masterActive, false);
    return { ...denied, activation: false, originalPhotoPreserved: true };
  });
}
scenario('D04 valid owned photo and optional Client photo; activation rechecks current metadata', ['R3-D04'], ['ACC.7', 'ACC.8'], async () => {
  const h = harness(); await h.ok(client, { type: 'profile', displayName: 'Client', photoId: null, specialization: { categoryIds: [], entityIds: [] } });
  await h.ok(client, { type: 'activate', role: 'client' });
  await h.ok(master, { type: 'profile', displayName: 'Master', photoId: 'master-portrait', specialization: { categoryIds: ['appliance'], entityIds: [] } });
  h.repository.state.users.master.masterActive = false;
  h.photoMetadata.set('master-portrait', { id: 'master-portrait', ownerId: 'master', present: false, format: 'image/jpeg' });
  await deny(h, master, { type: 'activate', role: 'master' });
  h.photoMetadata.get('master-portrait').present = true; await h.ok(master, { type: 'activate', role: 'master' });
  assert.equal(h.repository.state.users.master.masterActive, true);
  return { ownPhoto: true, clientNoPhoto: true, missingAtActivationDenied: true };
});
for (const metadata of [null, {}, { present: 'true' }, { format: 'application/pdf' }, { ownerId: 'client' }]) {
  scenario(`D04 malformed metadata ${JSON.stringify(metadata)}`, ['R3-D04', 'R3-D07'], ['ACC.8', 'APP.1'], async () => {
    const h = harness(); h.ports.photos.lookup = async () => success([metadata === null ? null : Object.keys(metadata).length === 0 ? {} :
      { id: 'master-photo', ownerId: 'master', present: true, format: 'image/jpeg', ...metadata }]);
    return deny(h, master, { type: 'profile', displayName: 'Master', photoId: 'master-photo', specialization: { categoryIds: ['appliance'], entityIds: [] } });
  });
}

for (const mode of ['closed', 'expired', 'spoofed', 'temporary-photo', 'too-many-working-photos', 'reserved']) {
  scenario(`D05 ${mode} rejected before content ports`, ['R3-D05'], ['APP.3', 'CHT.11', 'SUP.2'], async () => {
    const h = harness(); await h.published(); await h.offer();
    let sender = 'user', photoIds = [];
    if (mode === 'closed') await h.ok(master, { type: 'terminate_negotiation', jobId: 'job', masterId: 'master', confirmed: true, reason: 'Stop' });
    if (mode === 'expired') h.clock.value = h.repository.state.jobs.job.cycles[0].countdown.deadline;
    if (mode === 'spoofed') sender = 'helpy';
    if (mode === 'temporary-photo') photoIds = ['client-photo'];
    if (mode === 'reserved' || mode === 'too-many-working-photos') await h.reserved();
    if (mode === 'too-many-working-photos') { await h.ok(client, { type: 'cash', jobId: 'job' }); photoIds = ['client-photo', 'client-photo2']; }
    let detector = 0, photos = 0;
    h.ports.translation.detect = async () => { detector++; return success({ language: 'en', reliable: true }); };
    h.ports.photos.lookup = async () => { photos++; return success([]); };
    const denied = await deny(h, client, { type: 'message', chatId, id: 'forbidden', original: 'Private content', photoIds, sender });
    assert.equal(detector, 0); assert.equal(photos, 0);
    return { ...denied, detector, photos };
  });
}
scenario('D05 lawful replay after closure exports nothing; altered payload conflicts', ['R3-D05', 'R3-D06'], ['APP.3', 'SUP.13'], async () => {
  const h = harness(); await h.published(); await h.offer();
  const command = { type: 'message', chatId, id: 'saved', original: 'Original private text', photoIds: [], sender: 'user' };
  const saved = await h.ok(client, command, 'saved-message');
  await h.ok(master, { type: 'terminate_negotiation', jobId: 'job', masterId: 'master', confirmed: true, reason: 'Stop' });
  h.ports.translation.detect = async () => { throw new Error('Replay must not export text'); };
  h.ports.photos.lookup = async () => { throw new Error('Replay must not query files'); };
  const before = await h.repository.read(); assert.deepEqual(await h.ok(client, command, 'saved-message'), saved); assert.deepEqual(await h.repository.read(), before);
  const denied = await deny(h, client, { ...command, original: 'New forbidden private text' }, 'saved-message');
  return { ...denied, legalReplay: true, externalCalls: 0, messageCount: 1 };
});
scenario('D05 closing between metadata and detection prevents text export', ['R3-D05'], ['APP.3'], async () => {
  const h = harness(); await h.assigned(); let detector = 0;
  const lookup = h.ports.photos.lookup;
  h.ports.photos.lookup = async ids => { h.repository.state.users.client.clientActive = false; return lookup(ids); };
  h.ports.translation.detect = async () => { detector++; return success({ language: 'en', reliable: true }); };
  const result = await h.execute(client, { type: 'message', chatId, id: 'raced', original: 'Private', photoIds: ['client-photo'], sender: 'user' });
  assert.equal(result.ok, false); assert.equal(detector, 0); assert.equal(h.repository.state.messages.raced, undefined);
  return { failure: result.error.code, detector, noMessage: true };
});
scenario('D05 closing during detector is rechecked atomically', ['R3-D05'], ['APP.3'], async () => {
  const h = harness(); await h.published(); await h.offer();
  h.ports.translation.detect = async () => {
    await h.ok(master, { type: 'terminate_negotiation', jobId: 'job', masterId: 'master', confirmed: true, reason: 'Stop' });
    return success({ language: 'en', reliable: true });
  };
  const result = await h.execute(client, { type: 'message', chatId, id: 'raced', original: 'Private', photoIds: [], sender: 'user' });
  assert.equal(result.ok, false); assert.equal(h.repository.state.messages.raced, undefined);
  assert.equal(h.repository.state.threads[chatId].mode, 'closed');
  return { failure: result.error.code, closurePreserved: true, noMessage: true };
});

for (const amount of [NaN, Infinity, -Infinity, '100', undefined, {}]) {
  scenario(`D06 malformed threshold ${String(amount)} never replays null`, ['R3-D06'], ['DBT.3', 'CFG.masterDebtThreshold', 'APP.1'], async () => {
    const h = harness(); await h.ok('admin', { type: 'threshold', masterId: 'master', amount: 100n });
    const command = { type: 'threshold', masterId: 'master', amount: null }; await h.ok('admin', command, 'threshold');
    const denied = await deny(h, 'admin', { ...command, amount }, 'threshold'); await deny(h, 'admin', { ...command, amount });
    await h.ok('admin', { amount: null, masterId: 'master', type: 'threshold' }, 'threshold');
    assert.equal(h.repository.state.thresholdHistory.length, 2); assert.deepEqual(h.repository.state.ledger, {});
    return { ...denied, validReorderedReplay: true, history: 2, ledger: 0 };
  });
}
scenario('D06 valid bigint changes conflict and typed string cannot collide', ['R3-D06'], ['APP.1'], async () => {
  const h = harness(); const command = { type: 'threshold', masterId: 'master', amount: 100n }; await h.ok('admin', command, 'typed');
  await h.ok('admin', { amount: 100n, type: 'threshold', masterId: 'master' }, 'typed');
  const denied = await deny(h, 'admin', { ...command, amount: 101n }, 'typed'); await deny(h, 'admin', { ...command, amount: 'bigint:100' }, 'typed');
  assert.equal(h.repository.state.thresholds.master, 100n); return { ...denied, threshold: 100n, reorderedReplay: true };
});

const malformedCommands = [
  null, [], {}, { type: 'unknown' },
  { type: 'profile', displayName: null, photoId: null, specialization: {} },
  { type: 'profile', displayName: 12, photoId: null, specialization: { categoryIds: [], entityIds: [] } },
  { type: 'profile', displayName: 'Name', photoId: {}, specialization: { categoryIds: [], entityIds: [] } },
  { type: 'profile', displayName: 'Name', photoId: null, specialization: { categoryIds: null, entityIds: [] } },
  { type: 'new_job', id: 'x', draft: null }, { type: 'edit_draft', jobId: 'x', draft: {} },
  { type: 'new_job', id: 'x', draft: { items: [null], publicAddress: 'Public district street', address: 'Private', cep: 10n } },
  { type: 'new_job', id: 'x', draft: { items: [], publicAddress: 'Public district street', address: null, cep: 10n } },
  { type: 'save_catalog', draft: null, expectedSequence: null },
  { type: 'save_catalog', draft: { texts: [null], categories: [], entities: [], scenarios: [], blocks: [], bindings: [] }, expectedSequence: null },
  { type: 'approve_content_set', key: 'x', sequence: 1, revisions: [null], confirmed: true },
  { type: 'message', chatId, id: 'x', original: null, photoIds: [], sender: 'user' },
  { type: 'message', chatId, id: 'x', original: 'x', photoIds: [null], sender: 'user' },
  { type: 'cancel', jobId: 'x', id: 'x', reason: null },
  { type: 'decide_resolution', caseId: 'x', decision: null },
  { type: 'decide_resolution', caseId: 'x', decision: { id: 'x', type: 'partial', reason: 'x', evidence: [], facts: null } },
  { type: 'preferences', preference: null },
  { type: 'preferences', preference: { userId: 'client', channels: null, eventTypes: [], soundRequested: false } },
  { type: 'review', jobId: 'x', id: 'x', stars: 5, marks: null, comment: '' },
  { type: 'feedback', id: 'x', original: null }, { type: 'inbox', id: 'x', recipientId: 'client', original: [] },
  { type: 'publish_policy', policy: null }, { type: 'publish_policy', policy: {} },
];
for (const [index, command] of malformedCommands.entries()) {
  scenario(`D07 malformed command ${index} ${command?.type ?? 'no-type'}`, ['R3-D07'], ['APP.1'], async () => {
    const h = harness(); h.ports.photos.lookup = async () => { throw new Error('Invalid command reached photo port'); };
    h.ports.translation.detect = async () => { throw new Error('Invalid command reached detection port'); };
    return deny(h, 'admin', command);
  });
}
for (const [index, input] of [null, [], {}, { type: 'unknown' }, { type: 'information', targets: null },
  { type: 'information', targets: [null], catalogKey: 'test-catalog:1', locale: 'en' }, { type: 'job', jobId: null },
  { type: 'published_text', catalogKey: 'x', textId: 'x', locale: null }, { type: 'debt', masterId: {} }].entries()) {
  scenario(`D07 malformed query ${index}`, ['R3-D07'], ['APP.2'], async () => {
    const h = harness(), before = await h.repository.read(); const result = await query(h.repository, h.ports.auth, h.clock, 'admin', input);
    assert.equal(result.ok, false); assert.equal(typeof result.error.code, 'string'); assert.deepEqual(await h.repository.read(), before);
    return { failure: result.error.code, unchanged: true };
  });
}
scenario('D07 cycles accessors invalid auth and programming errors are distinct', ['R3-D07'], ['APP.1', 'APP.2'], async () => {
  const h = harness(); const cyclic = { type: 'feedback', id: 'x', original: 'x' }; cyclic.self = cyclic;
  await deny(h, client, cyclic);
  await deny(h, client, { get type() { throw new Error('Accessor evaluated'); } });
  h.ports.auth.authenticate = async () => success(null); await deny(h, client, { type: 'feedback', id: 'x', original: 'x' });
  assert.throws(() => checked(() => { throw new TypeError('Programming defect'); }), /Programming defect/);
  h.ports.auth.authenticate = async () => { throw new TypeError('Broken adapter implementation'); };
  await assert.rejects(h.execute(client, { type: 'feedback', id: 'x', original: 'x' }), /Broken adapter implementation/);
  return { cyclicAndAccessorRejected: true, malformedAuthTyped: true, programmerErrorsNotSwallowed: true };
});

for (const kind of ['payout', 'refund', 'compensation']) for (const flag of ['verified', 'available']) for (const value of [false, null, 'false', undefined]) {
  scenario(`D08 ${kind} ${flag}=${typeof value}:${String(value)}`, ['R3-D08'], ['MON.21', 'RES.22'], async () => {
    const h = harness(), command = await outgoing(h, kind);
    if (kind === 'payout') h.ports.payments.payoutDestination = async masterId => success({ id: 'bank', masterId, route: 'bank_transfer', verified: true, available: true, [flag]: value });
    else h.ports.payments.settlementDestination = async obligation => success({ id: 'bank', beneficiaryId: obligation.beneficiaryId, route: 'bank_transfer', verified: true, available: true, sourcePaymentId: obligation.sourcePaymentId, [flag]: value });
    const denied = await deny(h, 'admin', command); assert.equal(attempts(h, kind).length, 0);
    return { ...denied, kind, attempts: 0, terminalDecisionPreserved: true };
  });
}
for (const kind of ['payout', 'refund', 'compensation']) {
  scenario(`D08 ${kind} affirmative destination retry preserves instruction`, ['R3-D08'], ['MON.16', 'MON.21', 'RES.20'], async () => {
    const h = harness(), command = await outgoing(h, kind); await h.ok('admin', command, 'send');
    const first = structuredClone(attempts(h, kind)[0]);
    await h.ok('admin', command, 'send'); await deny(h, 'admin', { ...command, attemptId: 'duplicate' });
    h.ports.payments.verifyOutcome = async () => success({ operationId: first.id, binding: first.binding, amount: first.amount, currency: 'THB', status: 'failed' });
    await h.ok('admin', kind === 'payout' ? { type: 'payout_outcome', jobId: 'job', proof: 'failed' } : { type: 'settlement_outcome', obligationId: command.obligationId, proof: 'failed' });
    await h.ok('admin', { ...command, attemptId: 'retry' });
    assert.equal(attempts(h, kind).length, 2); assert.equal(attempts(h, kind)[1].amount, first.amount);
    assert.equal(h.repository.state.jobs.job.state, kind === 'payout' ? 'completed' : 'cancelled');
    return { affirmative: true, sameKeyReplay: true, unknownDuplicateBlocked: true, retryAmount: first.amount, attempts: 2 };
  });
}

for (const method of ['cash', 'card']) for (const remainingWork of [undefined, '', '   ']) {
  scenario(`D09 ${method} missing explicit remainingWork ${String(remainingWork)}`, ['R3-D09'], ['RES.11', 'RES.17'], async () => {
    const h = harness(), command = await partial(h, method, remainingWork);
    assert.equal(h.repository.state.jobs.job.cancellation.response.remainingWork, remainingWork ?? '');
    const denied = await deny(h, 'admin', command); await deny(h, 'admin', command);
    assert.deepEqual(h.repository.state.obligations, {}); assert.deepEqual(h.repository.state.ledger, {});
    assert.equal(h.repository.state.jobs.job.state, 'assigned');
    return { ...denied, noExplanationFallback: true, financialEffects: 0, method };
  });
}
for (const method of ['cash', 'card']) for (const initiator of ['client', 'master']) {
  scenario(`D09 ${method} ${initiator} explicit master remainingWork`, ['R3-D09'], ['RES.11', 'RES.12', 'RES.14'], async () => {
    const h = harness(), command = await partial(h, method, 'Finish mounting the cabinet doors', initiator);
    await h.ok('admin', command, 'decision'); const before = await h.repository.read(); await h.ok('admin', command, 'decision');
    assert.deepEqual(await h.repository.read(), before); assert.equal(h.repository.state.jobs.job.state, 'cancelled');
    const obligations = Object.values(h.repository.state.obligations);
    assert.equal(obligations.length, method === 'cash' ? 0 : 2);
    if (method === 'card') assert.equal(obligations.reduce((sum, value) => sum + value.amount, 0n), 700n);
    assert.deepEqual(h.repository.state.ledger, {}); return { method, initiator, obligations: obligations.length, replayUnchanged: true };
  });
}
for (const remainingWork of [undefined, '', '  ']) {
  scenario(`D09 master partial request rejects ${String(remainingWork)}`, ['R3-D09'], ['RES.11'], async () => {
    const h = harness(); await h.assigned('card');
    return deny(h, master, cancelCommand('partial', { remainingWork, evidence: ['master-photo'] }));
  });
}

for (const capability of [{ route: 'card', status: 'unsupported' }, { route: 'card', status: 'unknown' },
  { route: 'wallet', status: 'supported' }, { route: 'card', status: true }, null, {}]) {
  scenario(`D10 incoming capability fails closed ${JSON.stringify(capability)}`, ['R3-D10'], ['CFG.clientPaymentRoutes'], async () => {
    const h = harness(); await h.reserved(); let calls = 0;
    h.ports.payments.incomingRoute = async route => { calls++; assert.equal(route, 'card'); return success(capability); };
    const denied = await deny(h, client, { type: 'initiate_payment', jobId: 'job', id: 'payment', route: 'card' });
    assert.equal(calls, 1); assert.equal(h.repository.state.jobs.job.reservation.operations.length, 0);
    assert.equal(h.repository.state.jobs.job.reservation.method, null); await h.ok(client, { type: 'cash', jobId: 'job' });
    assert.equal(calls, 1); return { ...denied, calls, operations: 0, cashIndependent: true };
  });
}
scenario('D10 policy forbidden supported adapter creates no instruction', ['R3-D10'], ['CFG.clientPaymentRoutes'], async () => {
  const h = harness({ clientPaymentRoutes: ['cash'] }); await h.reserved(); let calls = 0;
  h.ports.payments.incomingRoute = async route => { calls++; return success({ route, status: 'supported' }); };
  const denied = await deny(h, client, { type: 'initiate_payment', jobId: 'job', id: 'payment', route: 'card' });
  assert.equal(h.repository.state.jobs.job.reservation.operations.length, 0); return { ...denied, operations: 0, adapterCalls: calls };
});
scenario('D10 adapter failure is not success or fallback', ['R3-D10'], ['CFG.clientPaymentRoutes'], async () => {
  const h = harness(); await h.reserved(); h.ports.payments.incomingRoute = async () => failure('RouteUnavailable', 'Capability unknown');
  return deny(h, client, { type: 'initiate_payment', jobId: 'job', id: 'payment', route: 'card' });
});
scenario('D10 supported incoming route concurrency and replay create exactly one operation', ['R3-D10'], ['CFG.clientPaymentRoutes', 'PAY.8', 'PAY.12'], async () => {
  const h = harness(); await h.reserved(); let calls = 0;
  h.ports.payments.incomingRoute = async route => { calls++; return success({ route, status: 'supported' }); };
  const command = { type: 'initiate_payment', jobId: 'job', id: 'incoming', route: 'card' };
  const results = await Promise.all([h.execute(client, command, 'initiate'), h.execute(client, command, 'initiate')]);
  assert.ok(results.every(result => result.ok)); assert.equal(h.repository.state.jobs.job.reservation.operations.length, 1);
  h.ports.payments.incomingRoute = async () => { throw new Error('Receipt replay must not recheck capability or send again'); };
  await h.ok(client, command, 'initiate');
  assert.equal(h.repository.state.jobs.job.reservation.operations[0].amount, 1000n);
  return { supported: true, concurrentSuccesses: 2, operations: 1, replayNoPortCalls: true, firstChecks: calls };
});

for (const method of ['cash', 'card']) for (const field of ['commission', 'mutualCancellationFee', 'falseCallFee', 'falseCallMasterShare', 'policyVersion']) {
  scenario(`D11 ${method} tampered historical ${field}`, ['R3-D11'], ['MON.6', 'MON.12', 'APP.4'], async () => {
    const h = harness(); await h.assigned(method);
    h.clock.value++; await h.ok('admin', { type: 'publish_policy', policy: { ...h.config, version: 'later', effectiveAt: h.clock.now(), commission: { numerator: 0n, denominator: 100n } } });
    await h.ok(client, { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' });
    h.repository.state.jobs.job.financial[field] = field === 'policyVersion' ? 'later' : { numerator: 0n, denominator: 100n };
    const denied = await deny(h, master, { type: 'complete', jobId: 'job' }); assert.deepEqual(h.repository.state.payouts, {}); assert.deepEqual(h.repository.state.ledger, {});
    const value = await query(h.repository, h.ports.auth, h.clock, client, { type: 'job', jobId: 'job' }); assert.equal(value.ok, false);
    return { ...denied, method, field, noFinancialEffects: true, inconsistentReadDenied: true };
  });
}
scenario('D11 lawful later policy preserves old commission and cancellation snapshots', ['R3-D11'], ['MON.6', 'RES.7'], async () => {
  for (const method of ['cash', 'card']) {
    const h = harness(); await h.assigned(method); const original = structuredClone(h.repository.state.jobs.job.financial);
    h.clock.value++; await h.ok('admin', { type: 'publish_policy', policy: { ...h.config, version: 'later', effectiveAt: h.clock.now(),
      commission: { numerator: 0n, denominator: 100n }, mutualCancellationFee: { numerator: 0n, denominator: 100n } } });
    await h.ok(client, { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' }); await h.ok(master, { type: 'complete', jobId: 'job' }, 'complete');
    await h.ok(master, { type: 'complete', jobId: 'job' }, 'complete'); assert.deepEqual(h.repository.state.jobs.job.financial, original);
    assert.equal(method === 'cash' ? h.repository.state.debt.master : h.repository.state.payouts.job.commission, 300n);
  }
  return { methods: ['cash', 'card'], commission: 300n, replayPreserved: true };
});
scenario('D11 tampered cancellation rate rejects decision without obligations', ['R3-D11'], ['MON.6', 'RES.7', 'RES.20'], async () => {
  const h = harness(); await h.assigned('card'); await h.ok(client, cancelCommand());
  await h.ok(master, { type: 'cancellation_response', jobId: 'job', workStopped: true, financialConsent: true, explanation: '' });
  h.repository.state.jobs.job.financial.mutualCancellationFee = { numerator: 0n, denominator: 100n };
  const denied = await deny(h, 'admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: {
    id: 'decision', type: 'mutual', reason: 'Agreed', evidence: ['cancel'], facts } });
  assert.deepEqual(h.repository.state.obligations, {}); assert.equal(h.repository.state.jobs.job.funds, 'held');
  return { ...denied, obligations: 0, held: true };
});

scenario('D11 later backdated policy cannot replace the policy actually used at selection', ['R3-D11'], ['MON.6', 'POL.5', 'APP.4'], async () => {
  const h = harness(); await h.assigned('card'); const original = structuredClone(h.repository.state.jobs.job.financial);
  h.clock.value += 100;
  await h.ok('admin', { type: 'publish_policy', policy: { ...h.config, version: 'later-backdated', effectiveAt: 99,
    commission: { numerator: 0n, denominator: 100n } } });
  await h.ok(client, { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' }); await h.ok(master, { type: 'complete', jobId: 'job' });
  assert.deepEqual(h.repository.state.jobs.job.financial, original); assert.equal(h.repository.state.payouts.job.commission, 300n);
  assert.equal(h.repository.state.events.find(e => e.type === 'master_selected').facts.policyVersion, original.policyVersion);
  return { originalPolicy: original.policyVersion, newBackdatedPolicy: 'later-backdated', commission: 300n, selectionAuditBound: true };
});
scenario('D10 policy revocation during capability check is atomic', ['R3-D10'], ['CFG.clientPaymentRoutes', 'APP.3'], async () => {
  const h = harness(); await h.reserved();
  h.ports.payments.incomingRoute = async route => {
    h.clock.value++; await h.ok('admin', { type: 'publish_policy', policy: { ...h.config, version: 'revoked', effectiveAt: h.clock.now(), clientPaymentRoutes: ['cash'] } });
    return success({ route, status: 'supported' });
  };
  const result = await h.execute(client, { type: 'initiate_payment', jobId: 'job', id: 'incoming', route: 'card' });
  assert.equal(result.ok, false); assert.equal(h.repository.state.jobs.job.reservation.operations.length, 0);
  assert.ok(h.repository.state.policies.some(p => p.version === 'revoked'));
  return { failure: result.error.code, policyChangePreserved: true, operations: 0 };
});
scenario('D04 activation rejects photo reference changed during metadata lookup', ['R3-D04'], ['ACC.8', 'APP.3'], async () => {
  const h = harness(); h.repository.state.users.master.masterActive = false;
  const lookup = h.ports.photos.lookup;
  h.ports.photos.lookup = async ids => { h.repository.state.users.master.photoId = 'client-photo'; return lookup(ids); };
  const result = await h.execute(master, { type: 'activate', role: 'master' });
  assert.equal(result.ok, false); assert.equal(h.repository.state.users.master.masterActive, false);
  return { failure: result.error.code, activation: false, changedPhotoNotTrusted: true };
});
scenario('D04 photo validation does not invent an active Master specialization restriction', ['R3-D04'], ['ACC.8', 'FED.3'], async () => {
  const h = harness(); await h.published();
  await h.ok(master, { type: 'profile', displayName: 'Master', photoId: 'master-photo', specialization: { categoryIds: [], entityIds: [] } });
  const result = await query(h.repository, h.ports.auth, h.clock, master, { type: 'feed' });
  assert.equal(result.ok, true); assert.deepEqual(result.value.jobs, []); assert.equal(h.repository.state.users.master.masterActive, true);
  return { photoValidated: true, emptySelection: true, feed: [], active: true };
});
scenario('D05 support sender permission revoked during metadata lookup blocks detector', ['R3-D05'], ['SUP.2', 'APP.3'], async () => {
  const h = harness(); h.repository.state.debt.master = 100n;
  await h.ok(master, { type: 'request_repayment', id: 'request', amount: 100n, confirmed: true });
  await h.ok('admin', { type: 'support', id: 'support', userId: 'master', userRole: 'master', basis: 'repayment', basisId: 'request' });
  h.ports.supportAttachments.photosAllowed = () => true;
  const auth = h.ports.auth.authenticate, lookup = h.ports.photos.lookup; let detector = 0;
  h.ports.photos.lookup = async ids => {
    h.ports.auth.authenticate = async session => session === 'admin' ? success({ userId: 'admin', role: 'admin', permissions: [] }) : auth(session);
    return lookup(ids);
  };
  h.ports.translation.detect = async () => { detector++; return success({ language: 'en', reliable: true }); };
  const result = await h.execute('admin', { type: 'message', chatId: 'support', id: 'support-private', original: 'Private support text', photoIds: ['client-photo'], sender: 'helpy' });
  assert.equal(result.ok, false); assert.equal(detector, 0); assert.equal(h.repository.state.messages['support-private'], undefined);
  return { failure: result.error.code, detector, noMessage: true };
});
for (const kind of ['detection', 'photos', 'incoming']) for (const payload of [null, { ok: 'true', value: {} }, { ok: true, value: null }]) {
  scenario(`D07 malformed port envelope ${kind} ${JSON.stringify(payload)}`, ['R3-D07'], ['APP.1', 'APP.3'], async () => {
    const h = harness(); let command;
    if (kind === 'incoming') {
      await h.reserved(); h.ports.payments.incomingRoute = async () => payload;
      command = { type: 'initiate_payment', jobId: 'job', id: 'incoming', route: 'card' };
    } else {
      await h.assigned();
      if (kind === 'detection') h.ports.translation.detect = async () => payload;
      else h.ports.photos.lookup = async () => payload;
      command = { type: 'message', chatId, id: 'malformed-port', original: 'Private text', photoIds: kind === 'photos' ? ['client-photo'] : [], sender: 'user' };
    }
    return deny(h, client, command);
  });
}
const requiredFieldVariants = [
  'publish_policy', 'threshold', 'save_catalog', 'approve_text', 'approve_content_set', 'publish_catalog', 'translation_correction',
  'profile', 'activate', 'switch_role', 'locale', 'bind_contact', 'new_job', 'edit_draft', 'publish_job', 'link_jobs', 'initial_offer',
  'message', 'revise_price', 'approve_price', 'final_application', 'select_master', 'terminate_negotiation', 'publication_deadline',
  'cash', 'initiate_payment', 'payment_outcome', 'reservation_deadline', 'decline_reservation', 'accept_work', 'submit_result', 'complete',
  'cancel', 'cancellation_response', 'open_resolution', 'decide_resolution', 'inspect_resolution', 'reminders', 'start_payout', 'payout_outcome',
  'start_settlement', 'settlement_outcome', 'request_repayment', 'agree_repayment', 'receive_repayment', 'close_repayment', 'support',
  'close_support', 'review', 'hide_review', 'hide_history', 'preferences', 'inbox', 'feedback', 'evaluate_retention',
];
for (const type of requiredFieldVariants) {
  scenario(`D07 every command rejects absent required representation ${type}`, ['R3-D07'], ['APP.1'], async () => {
    const h = harness(); return deny(h, 'admin', { type });
  });
}
for (const channels of [null, 'test-channel', [null]]) {
  scenario(`D07 malformed notification capabilities ${JSON.stringify(channels)}`, ['R3-D07'], ['NTF.8', 'APP.1'], async () => {
    const h = harness(); h.ports.notifications.supportedChannels = channels;
    const denied = await deny(h, client, { type: 'preferences', preference: { userId: 'client', channels: [], eventTypes: [], soundRequested: false } });
    const before = await h.repository.read(); const delivered = await h.core.dispatchNotification('admin', 'event', 'client', 'test-channel', 'delivery');
    assert.equal(delivered.ok, false); assert.deepEqual(await h.repository.read(), before);
    return { ...denied, noDelivery: true, malformedCapabilitiesTyped: true };
  });
}

for (const type of ['review', 'inbox', 'feedback']) for (const id of ['', '   ']) {
  scenario(`AUDIT empty identity ${type} ${JSON.stringify(id)}`, ['R3-A01'], ['APP.1', type === 'review' ? 'REP.1' : type === 'inbox' ? 'NTF.11' : 'NTF.12'], async () => {
    const h = harness();
    if (type === 'review') await h.completed();
    const session = type === 'inbox' ? 'admin' : client;
    const fields = type === 'review' ? { jobId: 'job', stars: 5, marks: [], comment: '' } :
      type === 'inbox' ? { recipientId: 'client', original: 'Official message' } : { original: 'Feedback' };
    const denied = await deny(h, session, { type, id, ...fields }, 'identity-check');
    assert.equal(denied.failure, 'InvalidIdentity');
    const command = { type, id: 'audit:valid-identity', ...fields };
    await h.ok(session, command, 'identity-check');
    const saved = await h.repository.read();
    await h.ok(session, command, 'identity-check');
    assert.deepEqual(await h.repository.read(), saved);
    return { ...denied, validIdentity: true, replayUnchanged: true };
  });
}

after(async () => {
  const directory = new URL('../../../docs/f2/evidence/', import.meta.url);
  const filename = process.env.F2_R3_PROOF_FILE ?? 'r3-native-proofs.json';
  assert.match(filename, /^[a-z0-9-]+\.json$/);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL(filename, directory), JSON.stringify(records, (_, value) => typeof value === 'bigint' ? `${value}n` : value, 2) + '\n');
});
