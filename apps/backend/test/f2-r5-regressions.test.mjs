import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { harness, FakeRepository, admin } from './f2-harness.mjs';
import { DomainCore } from '../dist/application/domain-core.js';
import { query } from '../dist/application/queries.js';
import { failure, success } from '../dist/domain/core.js';
import { compoundId } from '../dist/domain/provenance.js';
import { catalog } from './f2-fixtures.mjs';

const C = 'client:client', M = 'master:master', A = 'admin';
const facts = { arrived: false, partialWork: false, voluntaryRefusalProven: false, acceptanceReviewed: false, historyReviewed: false };
const records = [];
function scenario(id, norms, body) {
  test(`R5 REGRESSION ${id}`, async () => {
    const observations = await body();
    records.push({ id, norms, test: `R5 REGRESSION ${id}`, file: 'apps/backend/test/f2-r5-regressions.test.mjs', status: 'PASS', observations });
  });
}
const read = (h, input, session = A) => query(h.repository, h.ports.auth, h.clock, session, input);
async function deny(h, session, command, noPorts = false) {
  const state = await h.repository.read(), receipts = structuredClone(h.repository.receipts);
  const methods = ['incomingRoute', 'verifyOutcome', 'payoutDestination', 'settlementDestination'];
  const originals = Object.fromEntries(methods.map(name => [name, h.ports.payments[name]]));
  let calls = 0;
  if (noPorts) for (const name of methods) h.ports.payments[name] = async (...args) => { calls++; return originals[name](...args); };
  const result = await h.execute(session, command);
  for (const name of methods) h.ports.payments[name] = originals[name];
  assert.equal(result.ok, false); assert.equal(typeof result.error.code, 'string'); assert.equal(typeof result.error.detail, 'string');
  assert.deepEqual(await h.repository.read(), state); assert.deepEqual(h.repository.receipts, receipts);
  if (noPorts) assert.equal(calls, 0, 'Inconsistent facts must fail before financial ports');
  return result.error.code;
}
async function controlThenAlter(h, session, command, alter, noPorts = false) {
  const state = await h.repository.read(), receipts = structuredClone(h.repository.receipts);
  await h.ok(session, command);
  h.repository.state = structuredClone(state); h.repository.receipts = structuredClone(receipts);
  alter(h.repository.state);
  return deny(h, session, command, noPorts);
}
async function incoming() {
  const h = harness(); await h.reserved();
  await h.ok(C, { type: 'initiate_payment', jobId: 'job', id: 'first', route: 'card' });
  return h;
}
const cancel = (classification = 'ordinary', extra = {}) => ({ type: 'cancel', jobId: 'job', id: 'cancel', reason: 'Stop', explanation: 'Reviewed facts',
  classification, evidence: [], remainingWork: '', confirmed: true, ...extra });
async function outgoing(kind, partial = false) {
  const h = harness();
  if (kind === 'payout') await h.completed('card');
  else {
    await h.assigned('card'); await h.ok(M, cancel(partial ? 'partial' : 'false_call', { evidence: ['master-photo'], remainingWork: partial ? 'Finish mounting doors' : '' }));
    await h.ok(A, { type: 'decide_resolution', caseId: 'case:cancel', decision: { id: 'decision', type: partial ? 'partial' : 'false_call', reason: 'Evidence reviewed',
      evidence: ['master-photo'], facts: { ...facts, arrived: !partial, partialWork: partial }, ...(partial ? { shares: { clientRefund: 400n, masterCompensation: 300n } } : {}) } });
  }
  const value = () => kind === 'payout' ? h.repository.state.payouts.job : h.repository.state.obligations[`decision:${kind}`];
  const start = attemptId => kind === 'payout' ? { type: 'start_payout', jobId: 'job', attemptId } : { type: 'start_settlement', obligationId: `decision:${kind}`, attemptId };
  const callback = () => kind === 'payout' ? { type: 'payout_outcome', jobId: 'job', proof: 'outcome' } : { type: 'settlement_outcome', obligationId: `decision:${kind}`, proof: 'outcome' };
  return { h, value, start, callback };
}

scenario('D01 incoming history is bidirectional for pending unknown failed success and release', ['PAY.6', 'PAY.8', 'PAY.10', 'PAY.13'], async () => {
  const failures = [];
  for (const change of ['failed', 'missing', 'missing-origin', 'missing-request']) for (const action of ['cash', 'initiate_payment', 'decline_reservation', 'reservation_deadline']) {
    const h = await incoming();
    if (change === 'failed') h.repository.state.jobs.job.reservation.operations[0].status = 'failed';
    if (change === 'missing') h.repository.state.jobs.job.reservation.operations = [];
    if (change === 'missing-origin') h.repository.state.events = h.repository.state.events.filter(e => e.type !== 'operation:initiate_payment');
    if (change === 'missing-request') h.repository.state.events = h.repository.state.events.filter(e => e.type !== 'payment_requested');
    if (action === 'reservation_deadline') h.clock.value = h.repository.state.jobs.job.reservation.countdown.deadline;
    const command = { type: action, jobId: 'job', ...(action === 'initiate_payment' ? { id: 'next', route: 'card' } : action === 'decline_reservation' ? { confirmed: true } : {}) };
    failures.push(await deny(h, action === 'reservation_deadline' ? A : C, command, true));
  }
  for (const method of ['cash', 'card']) {
    const h = await incoming(); h.outcomes.set('failed', { operationId: 'first', amount: 1000n, currency: 'THB', status: 'failed' });
    await h.ok(A, { type: 'payment_outcome', jobId: 'job', proof: 'failed' });
    await h.ok(C, method === 'cash' ? { type: 'cash', jobId: 'job' } : { type: 'initiate_payment', jobId: 'job', id: 'next', route: 'card' });
    assert.equal(h.repository.state.jobs.job.reservation.resetUsed, true);
  }
  return { typedAtomicDenials: failures.length, allowedConfirmedRetries: 2, financialPortCallsOnRejection: 0 };
});

for (const kind of ['payout', 'refund', 'compensation']) scenario(`D01 ${kind} exact instruction survives uncertainty failure restart and concurrency`, ['MON.11', 'MON.16', 'MON.19', 'RES.20'], async () => {
  const { h, value, start, callback } = await outgoing(kind); await h.ok(A, start('first'));
  const initial = await h.repository.read(), receipts = structuredClone(h.repository.receipts), amount = value().amount;
  for (const alteration of ['failed', 'missing', 'unknown-without-callback', 'origin', 'requested']) {
    h.repository.state = structuredClone(initial); h.repository.receipts = structuredClone(receipts);
    if (alteration === 'failed') value().attempts[0].status = 'failed';
    if (alteration === 'missing') value().attempts = [];
    if (alteration === 'unknown-without-callback') value().attempts[0].status = 'unknown';
    if (alteration === 'origin') h.repository.state.events = h.repository.state.events.filter(e => !(e.proof?.kind === 'instruction' && e.proof.operation.id === 'first'));
    if (alteration === 'requested') h.repository.state.events = h.repository.state.events.filter(e => !(e.type === 'payout_requested' && e.subjectId === 'first'));
    await deny(h, A, start('next'), true);
  }
  h.repository.state = structuredClone(initial); h.repository.receipts = structuredClone(receipts);
  h.outcomes.set('outcome', { operationId: 'first', amount, currency: 'THB', status: 'unknown' }); await h.ok(A, callback()); await deny(h, A, start('next'));
  h.outcomes.set('outcome', { operationId: 'first', amount, currency: 'THB', status: 'failed' }); await h.ok(A, callback());
  const repository = new FakeRepository(await h.repository.read(), structuredClone(h.repository.receipts));
  const core = new DomainCore({ ...h.ports, repository });
  const results = await Promise.all(['one', 'two'].map(id => core.execute(A, `restart:${id}`, start(id))));
  assert.equal(results.filter(r => r.ok).length, 1);
  const target = kind === 'payout' ? repository.state.payouts.job : repository.state.obligations[`decision:${kind}`];
  assert.equal(target.attempts.length, 2); assert.equal(target.attempts[1].amount, amount);
  return { kind, corruptedFormsRejected: 5, retryAmount: amount, restart: true, concurrentWinners: 1 };
});

for (const partial of [false, true]) scenario(`D02 ${partial ? 'partial' : 'False Call'} original allocation and complete obligation set are immutable`, ['MON.5', 'RES.7', 'RES.12', 'RES.19', 'RES.22'], async () => {
  const { h, start } = await outgoing('refund', partial);
  const state = await h.repository.read(), receipts = structuredClone(h.repository.receipts);
  await h.ok(A, start('control'));
  for (const change of ['conserved', 'unbalanced', 'missing-compensation', 'created-at', 'decision-proof']) {
    h.repository.state = structuredClone(state); h.repository.receipts = structuredClone(receipts);
    const s = h.repository.state, split = s.cases['case:cancel'].decision.allocation;
    if (change === 'conserved' || change === 'unbalanced') { split.clientRefund++; s.obligations['decision:refund'].amount++; }
    if (change === 'conserved') { split.masterCompensation--; s.obligations['decision:compensation'].amount--; }
    if (change === 'missing-compensation') delete s.obligations['decision:compensation'];
    if (change === 'created-at') s.obligations['decision:refund'].createdAt++;
    if (change === 'decision-proof') s.events = s.events.filter(e => e.type !== 'operation:decide_resolution');
    await deny(h, A, start('tamper'), true);
  }
  return { partial, positiveTransfer: true, simultaneousChangesAndMissingFactsRejected: 5 };
});

scenario('D03 typed event context handles overlapping job offer chat message and case IDs', ['NTF.3', 'NTF.8', 'SUP.12', 'APP.4'], async () => {
  const h = harness(); h.repository.state.users.client.masterActive = true;
  for (const role of ['client', 'master']) await h.ok(`client:${role}`, { type: 'preferences', preference: { userId: 'client', channels: ['test-channel'],
    eventTypes: role === 'client' ? ['initial_offer_sent', 'chat_message', 'support_opened'] : ['job_published'], soundRequested: false } });
  await h.published('overlap');
  const sent = await h.ok(M, { type: 'initial_offer', jobId: 'overlap', id: 'overlap', chatId: 'overlap' });
  const notification = sent.events.find(e => e.type === 'initial_offer_sent'); assert.equal(notification.context.jobId, 'overlap'); assert.equal(notification.recipientRoles.client, 'client');
  assert.equal((await h.core.dispatchNotification(A, notification.id, 'client', 'test-channel', 'delivery')).value, 'delivered');
  for (const [operation, id] of [['x', 'y:chat_message:z'], ['x:chat_message:y', 'z']]) await h.ok(C, { type: 'message', id, chatId: 'overlap', original: id, photoIds: [], sender: 'user' }, operation);
  assert.equal(new Set(h.repository.state.events.map(e => e.id)).size, h.repository.state.events.length);
  assert.notEqual(compoundId('a:1', 'b'), compoundId('a', '1:b'));
  return { overlappingTypes: 4, correctClientPreference: true, eventIdentitiesUnique: true };
});

const timerCases = [
  ['publication', async h => { await h.published(); return [M, { type: 'initial_offer', jobId: 'job', id: 'next', chatId: 'next-chat' }, s => s.jobs.job.cycles[0].countdown]; }],
  ['reservation', async h => { await h.reserved(); return [C, { type: 'cash', jobId: 'job' }, s => s.jobs.job.reservation.countdown]; }],
  ['provider', async h => { await h.completed('card'); await h.ok(A, { type: 'start_payout', jobId: 'job', attemptId: 'first' });
    h.outcomes.set('success', { operationId: 'first', amount: 700n, currency: 'THB', status: 'success' }); return [A, { type: 'payout_outcome', jobId: 'job', proof: 'success' }, s => s.payouts.job.attempts[0].providerTimer]; }],
  ['cancellation_response', async h => { await h.assigned(); await h.ok(C, cancel()); return [M, { type: 'cancellation_response', jobId: 'job', workStopped: true, financialConsent: true, explanation: '' }, s => s.jobs.job.cancellation.responseTimer]; }],
  ['cancellation_reminder', async h => { await h.assigned(); await h.ok(C, cancel()); h.clock.value = h.repository.state.jobs.job.cancellation.reminder.deadline;
    return [A, { type: 'reminders', jobId: 'job' }, s => s.jobs.job.cancellation.reminder]; }],
  ['negotiation_reminder', async h => { await h.published(); await h.offer(); await h.message(C); h.clock.value = h.repository.state.threads['chat:job:master'].reminder.deadline;
    return [A, { type: 'reminders', jobId: 'job' }, s => s.threads['chat:job:master'].reminder]; }],
  ['inactivity_reminder', async h => { await h.assigned(); h.clock.value = h.repository.state.jobs.job.inactivityReminder.deadline;
    return [A, { type: 'reminders', jobId: 'job' }, s => s.jobs.job.inactivityReminder]; }],
  ['inactivity_threshold', async h => { await h.assigned(); await h.ok(C, { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' });
    await h.ok(C, { type: 'open_resolution', jobId: 'job', id: 'case', evidence: [] }); h.clock.value = h.repository.state.jobs.job.inactivityThreshold.deadline;
    const evidence = await h.reviewedCompletion('case'); return [A, { type: 'decide_resolution', caseId: 'case', decision: { id: 'decision', type: 'exceptional_completion', reason: 'Reviewed', evidence,
      facts: { ...facts, acceptanceReviewed: true, historyReviewed: true } } }, s => s.jobs.job.inactivityThreshold]; }],
];
for (const [kind, prepare] of timerCases) scenario(`D04 ${kind} source duration deadline and policy agree`, ['POL.4', 'POL.5', 'APP.4'], async () => {
  const failures = [];
  for (const change of ['deadline', 'coordinated', 'version', 'anchor']) {
    const h = harness(), [session, command, get] = await prepare(h);
    failures.push(await controlThenAlter(h, session, command, s => {
      const timer = get(s);
      if (change === 'deadline') timer.deadline++;
      if (change === 'coordinated') { timer.duration++; timer.deadline++; }
      if (change === 'version') timer.policyVersion = 'not-a-policy';
      if (change === 'anchor') { timer.startedAt++; timer.deadline++; }
    }));
  }
  return { kind, positiveControls: 4, atomicTypedRejections: failures.length };
});

async function repayment() {
  const h = harness(); await h.completed(); await h.ok(M, { type: 'request_repayment', id: 'r', amount: 100n, confirmed: true });
  await h.ok(A, { type: 'support', id: 'support', userId: 'master', userRole: 'master', basis: 'repayment', basisId: 'r' });
  return h;
}
scenario('D05 real support current agreement receipt and exact ledger are required', ['DBT.10', 'DBT.13', 'DBT.16', 'DBT.17'], async () => {
  const agree = { type: 'agree_repayment', requestId: 'r', amount: 100n, method: 'cash', agreementId: 'a' };
  const receipt = { type: 'receive_repayment', requestId: 'r', masterId: 'master', amount: 100n, receiptId: 'received', agreementId: 'a', actuallyReceived: true, evidence: 'Actual receipt' };
  for (const change of ['support', 'amount', 'method', 'agreement-event', 'agreement-proof']) {
    const h = await repayment(); await h.ok(A, agree);
    await controlThenAlter(h, A, receipt, s => {
      if (change === 'support') s.threads.support.context.basisId = 'foreign';
      if (change === 'amount') s.repayments.r.agreedAmount = 101n;
      if (change === 'method') s.repayments.r.method = 'bank_transfer';
      if (change === 'agreement-event') s.events = s.events.filter(e => e.type !== 'debt_repayment_agreed');
      if (change === 'agreement-proof') s.events = s.events.filter(e => e.type !== 'operation:agree_repayment');
    });
  }
  const h = await repayment(); await h.ok(A, agree);
  await h.ok(A, { ...agree, amount: 80n, method: 'bank_transfer', agreementId: 'b' });
  await h.ok(A, { ...receipt, amount: 80n, agreementId: 'b' }); assert.equal(h.repository.state.debt.master, 220n);
  await deny(h, A, { ...receipt, amount: 80n, agreementId: 'b', receiptId: 'duplicate' });
  return { originalBasisRequired: 5, explicitReagreement: true, debt: 220n, receiptOnce: true };
});

for (const method of ['cash', 'card']) scenario(`D06 ${method} completion authority reaches reads reviews history and retention`, ['WRK.6', 'MON.7', 'REP.1', 'REP.14', 'RET.1'], async () => {
  const h = harness(); await h.completed(method); const state = await h.repository.read(), receipts = structuredClone(h.repository.receipts);
  const review = { type: 'review', jobId: 'job', id: 'review', stars: 5, marks: [], comment: '' };
  await h.ok(C, review); await h.ok(C, { type: 'hide_history', jobId: 'job' });
  for (const change of ['completion-event', 'completion-command', 'financial-fact']) {
    h.repository.state = structuredClone(state); h.repository.receipts = structuredClone(receipts);
    if (change === 'completion-event') h.repository.state.events = h.repository.state.events.filter(e => e.type !== 'completed');
    if (change === 'completion-command') h.repository.state.events = h.repository.state.events.filter(e => e.type !== 'operation:complete');
    if (change === 'financial-fact') { if (method === 'cash') delete h.repository.state.ledger['commission:job']; else delete h.repository.state.payouts.job; }
    await deny(h, C, review); await deny(h, C, { type: 'hide_history', jobId: 'job' });
    for (const input of [{ type: 'history' }, { type: 'reputation', masterId: 'master' }, { type: 'job', jobId: 'job' }]) {
      const result = await read(h, input, C); assert.equal(result.ok, false); assert.equal(typeof result.error.code, 'string');
    }
  }
  return { method, documentedControls: true, unsupportedDerivedFactsRejected: 15 };
});

scenario('D07 offer phases and discussion rely on structured original facts', ['OFR.6', 'OFR.10', 'OFR.18'], async () => {
  for (const change of ['initial', 'revision', 'approval', 'final', 'messages']) {
    const h = harness(); await h.published(); await h.offer(); await h.bilateral();
    await h.ok(M, { type: 'revise_price', jobId: 'job', masterId: 'master', amount: 1200n, reason: 'Real discussion', confirmed: true });
    await h.ok(C, { type: 'approve_price', jobId: 'job', masterId: 'master', approved: true, confirmed: true });
    await h.ok(M, { type: 'final_application', jobId: 'job', masterId: 'master', amount: 1200n, recipientId: 'client', confirmed: true });
    const command = { type: 'select_master', jobId: 'job', masterId: 'master', amount: 1200n, confirmed: true };
    await controlThenAlter(h, C, command, s => {
      const type = { initial: 'initial_offer_sent', revision: 'price_adjustment_requested', approval: 'price_adjustment_approved', final: 'final_application_sent' }[change];
      if (type) s.events = s.events.filter(e => e.type !== type);
      if (change === 'messages') { const thread = s.threads['chat:job:master']; const id = thread.messageIds.find(id => s.messages[id].authorId === 'client');
        delete s.messages[id]; thread.messageIds = thread.messageIds.filter(other => other !== id); thread.clientSpoke = false; thread.protected = false; }
    });
  }
  return { positiveSelections: 5, absentOriginalPhasesRejected: 5 };
});

scenario('D08 authorization is current at translation detection and delivery boundaries', ['APP.3', 'CHT.2', 'SUP.6'], async () => {
  for (const mode of ['message', 'draft', 'detect']) for (const revoke of ['session', 'active-role']) {
    if (mode === 'draft' && revoke === 'active-role') continue;
    const h = harness(); await h.published(); await h.offer(); const sent = await h.message(C, 'Private source');
    const auth = h.ports.auth.authenticate; let revoked = false;
    h.ports.auth.authenticate = async session => revoked && revoke === 'session' ? failure('Unauthorized') : auth(session);
    const originalRead = h.repository.read.bind(h.repository);
    h.repository.read = async () => { const state = await originalRead(); revoked = true; if (revoke === 'active-role') h.repository.state.users.master.masterActive = false; return state; };
    let calls = 0; h.ports.translation.translate = h.ports.translation.detect = async () => { calls++; return success('Must not export'); };
    const action = mode === 'draft' ? () => h.core.draftTranslation(A, 'Private draft', 'en', 'ru') : mode === 'message' ?
      () => h.core.translateMessage(M, sent.outcome.message.id, 'ru') : () => h.execute(M, { type: 'message', id: 'new', chatId: 'chat:job:master', original: 'Private', photoIds: [], sender: 'user' });
    const result = await action(); assert.equal(result.ok, false); assert.equal(calls, 0);
  }
  const h = harness(); await h.published(); await h.offer(); const message = await h.message(C, 'Original');
  const before = await h.repository.read(); h.setTranslatorFailure(true);
  const result = await h.core.translateMessage(M, message.outcome.message.id, 'ru'); assert.equal(result.error.code, 'TranslationUnavailable');
  assert.deepEqual(await h.repository.read(), before);
  h.setTranslatorFailure(false); assert.equal((await h.core.translateMessage(M, message.outcome.message.id, 'ru')).ok, true);
  return { revocationForms: 5, forbiddenExports: 0, providerFailureTypedAndIsolated: true, authorizedControl: true };
});

scenario('AUDIT immutable scope is checked before creating any new obligation', ['PUB.2', 'OFR.1', 'APP.4'], async () => {
  const h = harness(); await h.published();
  const command = { type: 'initial_offer', jobId: 'job', id: 'offer', chatId: 'chat' };
  return { failure: await controlThenAlter(h, M, command, s => { s.jobs.job.snapshot.cep = 2000n; s.jobs.job.snapshot.address = 'Rewritten'; }), noOfferOrChat: true };
});
scenario('AUDIT bilateral cycle history cannot be invented to republish an empty order', ['PUB.8', 'PUB.10', 'PUB.17'], async () => {
  const h = harness(); await h.published(); h.clock.value = h.repository.state.jobs.job.cycles[0].countdown.deadline;
  return { failure: await controlThenAlter(h, A, { type: 'publication_deadline', jobId: 'job', cycleIndex: 0 }, s => { s.jobs.job.cycles[0].hadBilateral = true; }), noInventedCycle: true };
});
scenario('AUDIT unanswered cancellation cannot acquire mutual financial consent from saved flags', ['RES.2', 'RES.3', 'RES.17'], async () => {
  const h = harness(); await h.assigned('card'); await h.ok(C, cancel());
  await h.ok(M, { type: 'cancellation_response', jobId: 'job', workStopped: true, financialConsent: true, explanation: '' });
  const command = { type: 'decide_resolution', caseId: 'case:cancel', decision: { id: 'decision', type: 'mutual', reason: 'Reviewed', evidence: ['cancel'], facts } };
  return { failure: await controlThenAlter(h, A, command, s => { s.events = s.events.filter(e => e.type !== 'operation:cancellation_response'); }), unsupportedConsent: true };
});
scenario('AUDIT correlated policy and financial snapshot edits cannot replace selected terms', ['MON.6', 'PAY.1', 'APP.4'], async () => {
  const h = harness(); await h.assigned('card');
  return { failure: await controlThenAlter(h, C, { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' }, s => {
    s.policies[0].commission = { numerator: 0n, denominator: 100n }; s.jobs.job.financial.commission = { numerator: 0n, denominator: 100n };
  }), originalSelectionAuthoritative: true };
});
scenario('AUDIT support message source is immutable at the common translation boundary', ['CHT.3', 'SUP.6', 'APP.3'], async () => {
  const h = await repayment();
  await h.ok(A, { type: 'message', chatId: 'support', id: 'original', original: 'Original support text', photoIds: [], sender: 'helpy' });
  assert.equal((await h.core.translateMessage(M, 'original', 'ru')).ok, true);
  h.repository.state.messages.original.original = 'Rewritten support text';
  const before = await h.repository.read(), calls = h.translationCalls;
  const result = await h.core.translateMessage(M, 'original', 'ru');
  assert.equal(result.ok, false); assert.equal(typeof result.error.code, 'string'); assert.equal(h.translationCalls, calls);
  assert.deepEqual(await h.repository.read(), before);
  return { originalTranslationAllowed: true, changedOriginalRejected: true, exports: 0 };
});
scenario('AUDIT closed offer and exclusion need their original terminal cause', ['REF.2', 'FED.8', 'APP.4'], async () => {
  const h = harness(); await h.published(); await h.offer();
  assert.equal((await read(h, { type: 'job', jobId: 'job' }, C)).ok, true);
  const s = h.repository.state; s.jobs.job.offers.master.state = 'closed'; s.jobs.job.offers.master.closedReason = 'terminated';
  s.threads['chat:job:master'].mode = 'closed'; s.jobs.job.excludedMasters.push('master');
  const result = await read(h, { type: 'job', jobId: 'job' }, C);
  assert.equal(result.ok, false); assert.equal(typeof result.error.code, 'string');
  return { actualReadControl: true, unsupportedTerminalCauseRejected: true };
});
scenario('AUDIT work evidence cannot outlive its confirmed submission fact', ['RES.17', 'RES.21', 'APP.6'], async () => {
  const h = harness(); await h.assigned('card');
  const sent = await h.ok(M, { type: 'submit_result', jobId: 'job', explanation: 'Work actually performed', photoIds: ['master-photo'] });
  const evidenceId = sent.events.find(e => e.type === 'evidence_submitted').operationId;
  await h.ok(M, cancel('partial', { evidence: ['master-photo'], remainingWork: 'Finish installation' }));
  const command = { type: 'decide_resolution', caseId: 'case:cancel', decision: { id: 'decision', type: 'partial', reason: 'Reviewed actual evidence',
    evidence: [evidenceId], facts: { ...facts, partialWork: true }, shares: { clientRefund: 400n, masterCompensation: 300n } } };
  return { failure: await controlThenAlter(h, A, command, s => { s.events = s.events.filter(e => e.type !== 'operation:submit_result'); }), noInventedEvidence: true };
});
scenario('AUDIT saved language approval flags cannot replace actual Admin approval', ['TXT.4', 'TXT.5', 'TXT.6', 'APP.4'], async () => {
  const h = harness(), draft = catalog({ approved: false, version: 2 });
  await h.ok(A, { type: 'save_catalog', draft, expectedSequence: null });
  const before = await h.repository.read(), receipts = structuredClone(h.repository.receipts);
  await h.ok(A, { type: 'approve_content_set', key: 'test-catalog:2', sequence: 1, revisions: draft.texts.map(text => ({ textId: text.id, revision: text.revision })), confirmed: true });
  await h.ok(A, { type: 'publish_catalog', key: 'test-catalog:2', sequence: 2 });
  h.repository.state = before; h.repository.receipts = receipts;
  for (const text of h.repository.state.drafts['test-catalog:2'].texts) for (const edition of Object.values(text.editions)) edition.approvedBy = 'admin';
  return { failure: await deny(h, A, { type: 'publish_catalog', key: 'test-catalog:2', sequence: 1 }), approvedPublicationControl: true };
});
scenario('AUDIT malformed Failure codes from ports are not accepted as domain Failures', ['APP.1', 'PAY.18'], async () => {
  const h = harness(); await h.reserved();
  const command = { type: 'initiate_payment', jobId: 'job', id: 'incoming', route: 'card' };
  h.ports.payments.incomingRoute = async () => ({ ok: false, error: { code: 'not-a-domain-failure', detail: 'Malformed port result' } });
  assert.equal(await deny(h, C, command), 'RouteUnavailable');
  h.ports.payments.incomingRoute = async () => failure('RouteUnavailable', 'Declared capability failure');
  assert.equal(await deny(h, C, command), 'RouteUnavailable');
  h.ports.payments.incomingRoute = async route => success({ route, status: 'supported' }); await h.ok(C, command);
  return { malformedFailureRejected: true, declaredFailurePreserved: true, positiveOperation: true };
});
scenario('AUDIT query identity is current after awaiting the repository snapshot', ['ACC.13', 'APP.2', 'APP.3'], async () => {
  const h = harness(); assert.equal((await read(h, { type: 'contacts', userId: 'master' }, M)).ok, true);
  const authenticate = h.ports.auth.authenticate; let revoked = false;
  h.ports.auth.authenticate = async session => revoked ? failure('Unauthorized') : authenticate(session);
  const original = h.repository.read.bind(h.repository);
  h.repository.read = async () => { const state = await original(); revoked = true; return state; };
  const result = await read(h, { type: 'contacts', userId: 'master' }, M);
  assert.equal(result.ok, false); assert.equal(result.error.code, 'Unauthorized');
  return { authorizedRead: true, revokedResponseDenied: true };
});

scenario('AUDIT published status cannot be rolled back to reopen draft editing', ['PUB.1', 'PUB.2', 'PUB.4', 'APP.4'], async () => {
  const h = harness(); await h.published(); const snapshot = h.repository.state.jobs.job.snapshot;
  const draft = { items: snapshot.items, cep: 2000n, address: 'A different address' };
  await h.ok(C, { type: 'new_job', id: 'legal-draft', draft });
  await h.ok(C, { type: 'edit_draft', jobId: 'legal-draft', draft: { ...draft, cep: 2100n } });
  await h.ok(C, { type: 'publish_job', jobId: 'legal-draft' });
  assert.equal(h.repository.state.jobs['legal-draft'].snapshot.cep, 2100n);
  h.repository.state.jobs.job.state = 'draft';
  await deny(h, C, { type: 'edit_draft', jobId: 'job', draft });
  return { legitimateDraftEditsPreserved: true, immutablePublishedJobNotReopened: true };
});
scenario('AUDIT publication cannot lose its original snapshot before deadline processing', ['PUB.2', 'PUB.10', 'APP.4'], async () => {
  const h = harness(); await h.published(); h.clock.value = h.repository.state.jobs.job.cycles[0].countdown.deadline;
  return { failure: await controlThenAlter(h, A, { type: 'publication_deadline', jobId: 'job', cycleIndex: 0 }, s => { s.jobs.job.snapshot = null; }), realDeadlineControl: true };
});
scenario('AUDIT terminal expiry and financial state require their actual source transition', ['PUB.10', 'PAY.13', 'PAY.14', 'APP.4'], async () => {
  for (const reserved of [false, true]) {
    const h = harness(); if (reserved) await h.reserved(); else await h.published();
    const state = await h.repository.read(), receipts = structuredClone(h.repository.receipts);
    h.clock.value = reserved ? state.jobs.job.reservation.countdown.deadline : state.jobs.job.cycles[0].countdown.deadline;
    await h.ok(A, { type: reserved ? 'reservation_deadline' : 'publication_deadline', jobId: 'job', ...(reserved ? {} : { cycleIndex: 0 }) });
    assert.equal((await read(h, { type: 'job', jobId: 'job' }, C)).ok, true);
    h.repository.state = state; h.repository.receipts = receipts; const job = state.jobs.job; job.state = 'expired';
    if (reserved) { job.reservation.state = 'released'; state.threads[job.chatId].mode = 'closed'; }
    const before = await h.repository.read(), result = await read(h, { type: 'job', jobId: 'job' }, C);
    assert.equal(result.ok, false); assert.equal(typeof result.error.code, 'string'); assert.deepEqual(await h.repository.read(), before);
  }
  const h = harness(); await h.published();
  h.repository.state.jobs.job.financial = { fap: 1000n, currency: 'THB', policyVersion: h.config.version, commission: h.config.commission,
    mutualCancellationFee: h.config.mutualCancellationFee, falseCallFee: h.config.falseCallFee, falseCallMasterShare: h.config.falseCallMasterShare };
  assert.equal((await read(h, { type: 'job', jobId: 'job' }, C)).ok, false);
  return { lawfulExpiryControls: 2, unprovedExpiryRefusals: 2, unselectedFinancialSnapshotRejected: true };
});
scenario('AUDIT cancelled state cannot replace the pending Resolution decision', ['RES.17', 'RES.19', 'RES.21', 'APP.4'], async () => {
  const h = harness(); await h.assigned('card'); await h.ok(C, cancel());
  await h.ok(M, { type: 'cancellation_response', jobId: 'job', workStopped: true, financialConsent: true, explanation: '' });
  const state = await h.repository.read(), receipts = structuredClone(h.repository.receipts);
  await h.ok(A, { type: 'decide_resolution', caseId: 'case:cancel', decision: { id: 'decision', type: 'mutual', reason: 'Reviewed', evidence: ['cancel'], facts } });
  assert.equal((await read(h, { type: 'job', jobId: 'job' }, C)).ok, true);
  h.repository.state = state; h.repository.receipts = receipts; state.jobs.job.state = 'cancelled'; state.jobs.job.funds = 'allocated';
  state.threads[state.jobs.job.chatId].mode = 'closed'; const before = await h.repository.read();
  const result = await read(h, { type: 'job', jobId: 'job' }, C);
  assert.equal(result.ok, false); assert.equal(typeof result.error.code, 'string'); assert.deepEqual(await h.repository.read(), before);
  return { actualCancellationControl: true, pendingDecisionNotTerminal: true };
});

scenario('AUDIT original review content remains authoritative for reputation and moderation', ['REP.6', 'REP.11', 'REP.12', 'APP.4'], async () => {
  const h = harness(); await h.completed();
  await h.ok(C, { type: 'review', jobId: 'job', id: 'review', stars: 2, marks: [], comment: 'Original review' });
  const state = await h.repository.read(), receipts = structuredClone(h.repository.receipts);
  assert.equal((await read(h, { type: 'reputation', masterId: 'master' }, C)).value.summary.workQuality, 2);
  await h.ok(A, { type: 'hide_review', reviewId: 'review', reason: 'Authorized moderation' });
  assert.equal((await read(h, { type: 'reputation', masterId: 'master' }, C)).value.summary.workQuality, null);
  for (const change of ['stars', 'marks', 'comment', 'author', 'master', 'created-at']) {
    h.repository.state = structuredClone(state); h.repository.receipts = structuredClone(receipts); const review = h.repository.state.reviews.review;
    if (change === 'stars') review.stars = 5;
    if (change === 'marks') review.marks = ['agreements_kept'];
    if (change === 'comment') review.comment = 'Rewritten review';
    if (change === 'author') review.clientId = 'stranger';
    if (change === 'master') review.masterId = 'master2';
    if (change === 'created-at') review.createdAt++;
    const before = await h.repository.read(), result = await read(h, { type: 'reputation', masterId: 'master' }, C);
    assert.equal(result.ok, false); assert.equal(typeof result.error.code, 'string'); assert.deepEqual(await h.repository.read(), before);
    await deny(h, A, { type: 'hide_review', reviewId: 'review', reason: 'Cannot launder altered content' });
  }
  return { lawfulRatingAndModeration: true, originalContentAlterationsRejected: 6, adminCannotLaunderAlteration: true };
});
scenario('AUDIT public reputation requires an actual review source and complete persisted set', ['REP.1', 'REP.6', 'REP.12', 'APP.4'], async () => {
  const h = harness(); await h.completed(); await h.ok(C, { type: 'review', jobId: 'job', id: 'review', stars: 4, marks: [], comment: '' });
  const state = await h.repository.read();
  assert.equal((await read(h, { type: 'reputation', masterId: 'master' }, C)).value.summary.reviewsCount, 1);
  for (const change of ['source', 'missing-row', 'invented-row']) {
    h.repository.state = structuredClone(state);
    if (change === 'source') h.repository.state.events = h.repository.state.events.filter(event => event.type !== 'operation:review');
    if (change === 'missing-row') delete h.repository.state.reviews.review;
    if (change === 'invented-row') h.repository.state.reviews.invented = { ...state.reviews.review, id: 'invented' };
    const before = await h.repository.read(), result = await read(h, { type: 'reputation', masterId: 'master' }, C);
    assert.equal(result.ok, false); assert.equal(typeof result.error.code, 'string'); assert.deepEqual(await h.repository.read(), before);
    if (change === 'missing-row') await deny(h, C, { type: 'review', jobId: 'job', id: 'replacement', stars: 5, marks: [], comment: 'Cannot replace the original' });
  }
  return { originalPublicationControl: true, absentOrInventedReviewRejected: 3 };
});
scenario('AUDIT review visibility requires the actual Admin moderation decision', ['REP.6', 'REP.11', 'REP.12', 'REP.13', 'APP.4'], async () => {
  const h = harness(); await h.completed(); await h.ok(C, { type: 'review', jobId: 'job', id: 'review', stars: 1, marks: [], comment: 'Original' });
  const visible = await h.repository.read(), receipts = structuredClone(h.repository.receipts);
  await h.ok(A, { type: 'hide_review', reviewId: 'review', reason: 'Actual decision' }); const hidden = await h.repository.read();
  const control = await read(h, { type: 'reputation', masterId: 'master' }, C);
  assert.equal(control.value.summary.reviewsCount, 0); assert.equal(control.value.summary.experience, 1);
  for (const change of ['invented-hide', 'erased-hide', 'missing-decision', 'changed-reason']) {
    h.repository.state = structuredClone(change === 'invented-hide' ? visible : hidden); h.repository.receipts = structuredClone(receipts);
    const review = h.repository.state.reviews.review;
    if (change === 'invented-hide') { review.hidden = true; review.moderation = { actorId: 'admin', reason: 'Invented', at: h.clock.now() }; }
    if (change === 'erased-hide') { review.hidden = false; review.moderation = null; }
    if (change === 'missing-decision') h.repository.state.events = h.repository.state.events.filter(event => event.type !== 'operation:hide_review');
    if (change === 'changed-reason') review.moderation.reason = 'Changed reason';
    const before = await h.repository.read(), result = await read(h, { type: 'reputation', masterId: 'master' }, C);
    assert.equal(result.ok, false); assert.equal(typeof result.error.code, 'string'); assert.deepEqual(await h.repository.read(), before);
  }
  return { actualHideControl: true, originalExperiencePreserved: true, unsupportedModerationRejected: 4 };
});

scenario('AUDIT saved debt and threshold values cannot be coerced into Cash eligibility', ['MON.1', 'MON.9', 'DBT.4', 'DBT.5', 'APP.4'], async () => {
  const h = harness(); await h.reserved();
  const state = await h.repository.read(), receipts = structuredClone(h.repository.receipts);
  await h.ok(C, { type: 'cash', jobId: 'job' });
  for (const collection of ['debt', 'thresholds']) for (const value of [-1n, -1, 1.5, '0', NaN, null, undefined, {}]) {
    h.repository.state = structuredClone(state); h.repository.receipts = structuredClone(receipts); h.repository.state[collection].master = value;
    const before = await h.repository.read();
    for (const [input, session] of [[{ type: 'debt', masterId: 'master' }, M], [{ type: 'cash_availability', masterId: 'master' }, C]]) {
      const result = await read(h, input, session); assert.equal(result.ok, false); assert.equal(result.error.code, 'InvalidMoney');
    }
    assert.deepEqual(await h.repository.read(), before);
    await deny(h, C, { type: 'cash', jobId: 'job' }, true);
  }
  h.repository.state = state; h.repository.receipts = receipts; state.thresholds.master = 0n;
  assert.equal((await read(h, { type: 'cash_availability', masterId: 'master' }, C)).value.mode, 'noncash_only');
  await h.ok(C, { type: 'initiate_payment', jobId: 'job', id: 'noncash-control', route: 'card' });
  return { invalidPersistedValues: 16, queryAndCommandAtomicRefusal: true, missingDebtMeansZero: true, zeroThresholdAndNoncashPreserved: true };
});
scenario('AUDIT completion and debt ledger reject invalid persisted balances atomically', ['MON.1', 'MON.7', 'MON.9', 'MON.12', 'APP.4'], async () => {
  for (const method of ['cash', 'card']) {
    const h = harness(); await h.assigned(method); await h.ok(C, { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' });
    const state = await h.repository.read(), receipts = structuredClone(h.repository.receipts);
    await h.ok(M, { type: 'complete', jobId: 'job' }); assert.equal(h.repository.state.jobs.job.state, 'completed');
    for (const value of [-1n, -1, 1.5, '1000', NaN, null, undefined, {}]) {
      h.repository.state = structuredClone(state); h.repository.receipts = structuredClone(receipts); h.repository.state.debt.master = value;
      await deny(h, M, { type: 'complete', jobId: 'job' });
    }
  }
  return { lawfulCompletionControls: 2, invalidBalanceRefusals: 16, noPartialCommissionPayoutOrCompletion: true };
});
scenario('AUDIT role activation requires actual boolean true across commands queries and counts', ['ACC.4', 'ACC.5', 'ACC.19', 'APP.2', 'APP.3'], async () => {
  for (const [session, userId, field, role] of [[C, 'client', 'clientActive', 'client'], [M, 'master', 'masterActive', 'master']]) {
    const h = harness(); await h.published(); await h.offer();
    assert.equal((await read(h, { type: 'contacts', userId }, session)).ok, true);
    await h.ok(session, { type: 'switch_role', role });
    let exports = 0; h.ports.translation.detect = async () => { exports++; return success({ language: 'en', reliable: true }); };
    for (const value of ['false', 1, {}, [], null, undefined]) {
      h.repository.state.users[userId][field] = value;
      const result = await read(h, { type: 'contacts', userId }, session); assert.equal(result.ok, false); assert.equal(result.error.code, 'RoleInactive');
      await deny(h, session, { type: 'switch_role', role });
      await deny(h, session, { type: 'message', chatId: 'chat:job:master', id: 'denied', original: 'Work text', photoIds: [], sender: 'user' });
      const counts = await read(h, { type: 'role_counts' }, A); assert.equal(counts.ok, true);
      assert.equal(counts.value[role === 'client' ? 'clientProfiles' : 'masterProfiles'], 1);
    }
    assert.equal(exports, 0); h.repository.state.users[userId][field] = true;
    await h.message(session); assert.equal(exports, 1);
  }
  return { activeRoleControls: 2, invalidActivationForms: 12, forbiddenExports: 0, validRoleRestored: true };
});

after(async () => {
  await writeFile(new URL('../../../docs/f2/evidence/r5-native-proofs.json', import.meta.url), JSON.stringify(records, (_, value) => typeof value === 'bigint' ? `${value}n` : value, 2) + '\n');
});
