import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { harness, admin, FakeRepository } from './f2-harness.mjs';
import { catalog, policy } from './f2-fixtures.mjs';
import { failure, success } from '../dist/domain/core.js';
import { DomainCore } from '../dist/application/domain-core.js';
import { query } from '../dist/application/queries.js';

const client = 'client:client', master = 'master:master';
const records = [];
const read = (h, session, input) => query(h.repository, h.ports.auth, h.clock, session, input);
const facts = { arrived: false, partialWork: false, voluntaryRefusalProven: false, acceptanceReviewed: false, historyReviewed: false };
function scenario(id, groups, norms, body) {
  test(`R2 REGRESSION ${id}`, async () => {
    const observations = await body();
    assert.ok(observations && Object.keys(observations).length > 0);
    records.push({ id, groups, norms, test: `R2 REGRESSION ${id}`, testFile: 'apps/backend/test/f2-r2-regressions.test.mjs',
      status: 'PASS', observations });
  });
}
async function deny(h, session, command, id) {
  const before = await h.repository.read();
  const result = await h.execute(session, command, id);
  assert.equal(result.ok, false);
  assert.equal(typeof result.error.code, 'string');
  assert.deepEqual(await h.repository.read(), before);
  return { command: command.type, failure: result.error.code, rollback: true };
}
function proof(h, operation, status, changes = {}) {
  const value = { operationId: operation.id, binding: structuredClone(operation.binding),
    amount: operation.amount, currency: operation.currency, status, ...changes };
  h.ports.payments.verifyOutcome = async () => success(structuredClone(value));
}
async function cancel(h, jobId = 'job', id = 'cancel') {
  await h.ok(client, { type: 'cancel', jobId, id, reason: 'Stop', explanation: 'Before arrival', remainingWork: '',
    classification: 'ordinary', evidence: [], confirmed: true });
  await h.ok(master, { type: 'cancellation_response', jobId, workStopped: true, financialConsent: true, explanation: '' });
}
async function financial(h, kind) {
  if (kind === 'incoming') {
    await h.reserved();
    await h.ok(client, { type: 'initiate_payment', jobId: 'job', id: 'incoming', route: 'card' });
    return { operation: h.repository.state.jobs.job.reservation.operations[0],
      command: { type: 'payment_outcome', jobId: 'job', proof: 'verified' } };
  }
  if (kind === 'payout') {
    h.repository.state.debt.master = 300n;
    await h.completed('card');
    await h.ok('admin', { type: 'start_payout', jobId: 'job', attemptId: 'outgoing' });
    return { operation: h.repository.state.payouts.job.attempts[0],
      command: { type: 'payout_outcome', jobId: 'job', proof: 'verified' } };
  }
  await h.assigned('card');
  if (kind === 'refund') await cancel(h);
  else await h.ok(master, { type: 'cancel', jobId: 'job', id: 'cancel', reason: 'False call',
    explanation: 'Arrived but could not perform the work', remainingWork: '', classification: 'false_call',
    evidence: ['master-photo'], confirmed: true });
  await h.ok('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: { id: 'decision',
    type: kind === 'refund' ? 'mutual' : 'false_call', reason: 'Reviewed the applicable evidence',
    evidence: kind === 'compensation' ? ['cancel', 'master-photo'] : ['cancel'], facts: { ...facts, arrived: kind === 'compensation' } } });
  const obligationId = `decision:${kind}`;
  await h.ok('admin', { type: 'start_settlement', obligationId, attemptId: 'outgoing' });
  return { operation: h.repository.state.obligations[obligationId].attempts[0],
    command: { type: 'settlement_outcome', obligationId, proof: 'verified' } };
}
for (const kind of ['incoming', 'payout', 'refund', 'compensation']) {
  for (const field of ['amount', 'currency', 'binding', 'route']) {
    scenario(`D01 ${kind} canonical ${field}`, ['R2-D01'], ['PAY.9', 'PAY.10', 'PAY.11', 'MON.6', 'RES.20', 'APP.5'], async () => {
      const h = harness(); const { operation, command } = await financial(h, kind);
      if (field === 'amount') operation.amount = 1n;
      if (field === 'currency') operation.currency = 'USD';
      if (field === 'binding') operation.binding.beneficiaryId = 'unrelated-beneficiary';
      if (field === 'route') operation.route = 'cash';
      // This independent proof deliberately agrees with the inconsistent attempt.
      // Agreement with that attempt must not replace the actual obligation.
      proof(h, operation, 'success');
      const rejected = await deny(h, 'admin', command);
      assert.notEqual(h.repository.state.jobs.job.state, 'assigned', kind === 'incoming' ? undefined : 'not an incoming assignment');
      return { kind, field, ...rejected };
    });
  }
  scenario(`D01 ${kind} retry concurrent exact obligation`, ['R2-D01', 'R2-D02'], ['PAY.9', 'PAY.10', 'MON.16', 'MON.18', 'RES.20', 'APP.5'], async () => {
    const h = harness(); const first = await financial(h, kind);
    const originalAmount = first.operation.amount;
    const ledger = structuredClone(h.repository.state.ledger);
    proof(h, first.operation, 'failed');
    await h.ok('admin', first.command);
    if (kind === 'incoming') await h.ok(client, { type: 'initiate_payment', jobId: 'job', id: 'retry', route: 'bank_transfer' });
    else if (kind === 'payout') await h.ok('admin', { type: 'start_payout', jobId: 'job', attemptId: 'retry' });
    else await h.ok('admin', { type: 'start_settlement', obligationId: first.command.obligationId, attemptId: 'retry' });
    const collection = kind === 'incoming' ? h.repository.state.jobs.job.reservation.operations :
      kind === 'payout' ? h.repository.state.payouts.job.attempts : h.repository.state.obligations[first.command.obligationId].attempts;
    const retry = collection.at(-1); assert.equal(retry.amount, originalAmount);
    proof(h, retry, 'unknown'); await h.ok('admin', first.command);
    const start = kind === 'incoming' ? { type: 'initiate_payment', jobId: 'job', id: 'third', route: 'card' } :
      kind === 'payout' ? { type: 'start_payout', jobId: 'job', attemptId: 'third' } :
        { type: 'start_settlement', obligationId: first.command.obligationId, attemptId: 'third' };
    const blocked = await deny(h, kind === 'incoming' ? client : 'admin', start);
    proof(h, retry, 'success');
    const results = await Promise.all([h.execute('admin', first.command), h.execute('admin', first.command)]);
    assert.ok(results.every(result => result.ok)); assert.deepEqual(h.repository.state.ledger, ledger);
    if (kind === 'incoming') {
      assert.equal(h.repository.state.jobs.job.state, 'assigned');
      assert.equal(h.repository.state.events.filter(event => event.type === 'master_assigned').length, 1);
    } else assert.equal(kind === 'payout' ? h.repository.state.payouts.job.settled : h.repository.state.obligations[first.command.obligationId].settled, true);
    assert.equal(kind === 'incoming' ? h.repository.state.jobs.job.reservation.operations.length :
      kind === 'payout' ? h.repository.state.payouts.job.attempts.length : h.repository.state.obligations[first.command.obligationId].attempts.length, 2);
    return { kind, exactAmount: originalAmount, attempts: 2, concurrentCallbacks: 2, financialEffects: 1, blocked };
  });
}
scenario('D01 mismatched payout calculation rejected before destination lookup', ['R2-D01'], ['MON.6', 'MON.21', 'APP.5'], async () => {
  const h = harness(); await h.completed('card'); h.repository.state.payouts.job.amount = 1n;
  let lookups = 0; h.ports.payments.payoutDestination = async () => { lookups++; throw new Error('Unreachable'); };
  const rejected = await deny(h, 'admin', { type: 'start_payout', jobId: 'job', attemptId: 'bad' });
  assert.equal(lookups, 0); return { ...rejected, lookups };
});
scenario('D01 mismatched decision obligation rejected before instruction', ['R2-D01'], ['RES.20', 'APP.5'], async () => {
  const h = harness(); await financial(h, 'refund');
  h.repository.state.obligations['decision:refund'].amount = 1n;
  let lookups = 0; h.ports.payments.settlementDestination = async () => { lookups++; throw new Error('Unreachable'); };
  const rejected = await deny(h, 'admin', { type: 'start_settlement', obligationId: 'decision:refund', attemptId: 'bad' });
  assert.equal(lookups, 0); return { ...rejected, lookups };
});
for (const mode of ['normal', 'exceptional']) for (const damaged of ['payment', 'payment-event', 'acceptance-event', 'acceptance-time']) {
  scenario(`D02 ${mode} requires ${damaged}`, ['R2-D02'], ['WRK.1', 'WRK.6', 'WRK.7', 'MON.12', 'RES.21', 'APP.4'], async () => {
    const h = harness(); await h.assigned('card');
    await h.ok(client, { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' });
    let command = { type: 'complete', jobId: 'job' };
    if (mode === 'exceptional') {
      await h.ok(client, { type: 'open_resolution', jobId: 'job', id: 'case', evidence: [] });
      h.clock.value = h.repository.state.jobs.job.inactivityThreshold.deadline;
      const evidence = await h.reviewedCompletion('case');
      command = { type: 'decide_resolution', caseId: 'case', decision: { id: 'exceptional', type: 'exceptional_completion',
        reason: 'Reviewed history and acceptance', evidence, facts: { ...facts, acceptanceReviewed: true, historyReviewed: true } } };
    }
    h.repository.state.refusalStreak.master = 2;
    if (damaged === 'payment') h.repository.state.jobs.job.reservation.operations[0].status = 'failed';
    if (damaged === 'payment-event') h.repository.state.events = h.repository.state.events.filter(event => event.type !== 'operation:payment_outcome');
    if (damaged === 'acceptance-event') h.repository.state.events = h.repository.state.events.filter(event => event.type !== 'completion_confirmed_by_client');
    if (damaged === 'acceptance-time') h.repository.state.jobs.job.acceptedAt++;
    const rejected = await deny(h, mode === 'normal' ? master : 'admin', command);
    assert.equal(h.repository.state.jobs.job.state, 'client_accepted');
    assert.equal(h.repository.state.jobs.job.funds, 'held');
    assert.deepEqual(h.repository.state.payouts, {}); assert.deepEqual(h.repository.state.ledger, {});
    assert.equal(h.repository.state.refusalStreak.master, 2);
    return { ...rejected, mode, damaged, completed: false, financialEffects: 0, refusalStreak: 2 };
  });
}
for (const method of ['cash', 'card']) scenario(`D02 legitimate ${method} completion after restart`, ['R2-D02'], ['WRK.1', 'WRK.6', 'WRK.9', 'RES.27'], async () => {
  const h = harness(); await h.assigned(method); await h.ok(client, { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' });
  h.repository.state.refusalStreak.master = 2;
  const repository = new FakeRepository(await h.repository.read(), h.repository.receipts);
  const core = new DomainCore({ ...h.ports, repository });
  const result = await core.execute(master, 'complete-restarted', { type: 'complete', jobId: 'job' });
  assert.equal(result.ok, true); assert.equal(repository.state.jobs.job.state, 'completed');
  assert.equal(repository.state.refusalStreak.master, 0);
  assert.equal((await core.execute(master, 'complete-restarted', { type: 'complete', jobId: 'job' })).ok, true);
  assert.equal(repository.state.events.filter(event => event.type === 'completed').length, 1);
  return { method, completed: true, completions: 1, persistedReplay: true, refusalStreak: 0 };
});
scenario('D03 support evidence uses the same case participant checks on every path', ['R2-D03', 'R2-D05'], ['RES.17', 'RES.21', 'APP.4', 'APP.6', 'SUP.4'], async () => {
  const h = harness(); await h.assigned('card'); await cancel(h);
  await h.reserved('other', 'master2'); await h.ok(client, { type: 'cash', jobId: 'other' });
  await h.ok('master2:master', { type: 'cancel', jobId: 'other', id: 'other-cancel', reason: 'Stop',
    explanation: 'Other order', remainingWork: '', classification: 'ordinary', evidence: [], confirmed: true });
  await h.ok('admin', { type: 'support', id: 'support', userId: 'master2', userRole: 'master', basis: 'resolution', basisId: 'case:other-cancel' });
  await h.ok('master2:master', { type: 'message', id: 'foreign', chatId: 'support', original: 'Other case facts', photoIds: [], sender: 'user' });
  h.repository.state.threads.support.context.basisId = 'case:cancel';
  const inspection = await deny(h, 'admin', { type: 'inspect_resolution', caseId: 'case:cancel' });
  const decision = await deny(h, 'admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: { id: 'decision',
    type: 'mutual', reason: 'Wrong context', evidence: ['foreign'], facts } });
  assert.equal((await read(h, 'master2:master', { type: 'chat_history', chatId: 'support' })).ok, false);
  let translations = 0; h.ports.translation.translate = async () => { translations++; throw new Error('Unreachable'); };
  assert.equal((await h.core.translateMessage('master2:master', 'foreign', 'ru')).ok, false);
  assert.equal(translations, 0); assert.deepEqual(h.repository.state.obligations, {});
  return { inspection, decision, translations, financialEffects: 0 };
});
scenario('D03 valid official and user support evidence decision replays once', ['R2-D03', 'R2-D05'], ['RES.17', 'RES.20', 'APP.6', 'SUP.4'], async () => {
  const h = harness(); await h.assigned('card'); await cancel(h);
  await h.ok('admin', { type: 'support', id: 'support', userId: 'master', userRole: 'master', basis: 'resolution', basisId: 'case:cancel' });
  await h.ok(master, { type: 'message', id: 'position', chatId: 'support', original: 'My position', photoIds: [], sender: 'user' });
  await h.ok('admin', { type: 'message', id: 'official', chatId: 'support', original: 'History checked', photoIds: [], sender: 'helpy' });
  const inspected = await h.ok('admin', { type: 'inspect_resolution', caseId: 'case:cancel' });
  assert.equal(inspected.outcome.messages.length, 2);
  const command = { type: 'decide_resolution', caseId: 'case:cancel', decision: { id: 'decision', type: 'mutual',
    reason: 'Both positions and history checked', evidence: ['cancel', 'position', 'official'], facts } };
  const results = await Promise.all([h.execute('admin', command, 'same-decision'), h.execute('admin', command, 'same-decision')]);
  assert.ok(results.every(result => result.ok)); assert.equal(Object.keys(h.repository.state.obligations).length, 1);
  assert.equal(h.repository.state.cases['case:cancel'].decision.allocation.clientRefund, 850n);
  assert.ok(h.repository.state.cases['case:cancel'].decision.basis.every(record => record.jobId === 'job'));
  return { actualCase: 'case:cancel', evidence: ['cancel', 'position', 'official'], concurrentReplays: 2, obligations: 1 };
});
scenario('D03 support cannot be rebound even to another case of the same participants', ['R2-D03'], ['RES.17', 'APP.6', 'SUP.4'], async () => {
  const h = harness(); await h.assigned('card'); await cancel(h);
  await h.assigned('card', 'other'); await cancel(h, 'other', 'other-cancel');
  await h.ok('admin', { type: 'support', id: 'support', userId: 'master', userRole: 'master', basis: 'resolution', basisId: 'case:other-cancel' });
  await h.ok(master, { type: 'message', id: 'other-position', chatId: 'support', original: 'Only the other order', photoIds: [], sender: 'user' });
  h.repository.state.threads.support.context.basisId = 'case:cancel';
  const rejected = await deny(h, 'admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: { id: 'bad',
    type: 'mutual', reason: 'Wrong original binding', evidence: ['other-position'], facts } });
  assert.deepEqual(h.repository.state.obligations, {});
  return { ...rejected, identicalParticipants: true, originalBasis: 'case:other-cancel', financialEffects: 0 };
});
scenario('D01 inconsistent incoming method cannot turn noncash success into Cash assignment', ['R2-D01', 'R2-D02'], ['PAY.9', 'WRK.1', 'APP.5'], async () => {
  const h = harness(); const { operation, command } = await financial(h, 'incoming');
  proof(h, operation, 'success'); h.repository.state.jobs.job.reservation.method = 'cash';
  const rejected = await deny(h, 'admin', command);
  assert.equal(h.repository.state.jobs.job.state, 'reserved'); return { ...rejected, assignment: false };
});
for (const value of ['false', 0, 1, null, undefined, []]) {
  scenario(`D04 nonboolean acceptance ${JSON.stringify(value)}`, ['R2-D04'], ['WRK.6', 'APP.1'], async () => {
    const h = harness(); await h.assigned();
    return deny(h, client, { type: 'accept_work', jobId: 'job', accepted: value, explanation: 'Not a boolean confirmation' });
  });
  scenario(`D04 nonboolean price approval ${JSON.stringify(value)}`, ['R2-D04'], ['OFR.10', 'APP.1'], async () => {
    const h = harness(); await h.published(); await h.offer(); await h.bilateral();
    await h.ok(master, { type: 'revise_price', jobId: 'job', masterId: 'master', amount: 1200n, reason: 'Agreed extra effort', confirmed: true });
    return deny(h, client, { type: 'approve_price', jobId: 'job', masterId: 'master', approved: value, confirmed: true });
  });
}
for (const approved of [true, false]) scenario(`D04 actual boolean price and acceptance ${approved}`, ['R2-D04'], ['OFR.10', 'WRK.6', 'APP.1'], async () => {
  const h = harness(); await h.published(); await h.offer(); await h.bilateral();
  await h.ok(master, { type: 'revise_price', jobId: 'job', masterId: 'master', amount: 1200n, reason: 'Discussed effort', confirmed: true });
  await h.ok(client, { type: 'approve_price', jobId: 'job', masterId: 'master', approved, confirmed: true });
  assert.equal(h.repository.state.jobs.job.offers.master.revised[approved ? 'approvedAt' : 'rejectedAt'], h.clock.now());
  const work = harness(); await work.assigned();
  await work.ok(client, { type: 'accept_work', jobId: 'job', accepted: approved, explanation: approved ? '' : 'Please correct the result' });
  assert.equal(work.repository.state.jobs.job.state, approved ? 'client_accepted' : 'assigned');
  return { approved, priceFact: approved ? 'approved' : 'rejected', workState: work.repository.state.jobs.job.state };
});
for (const changed of [{ basis: 'not-a-basis' }, { userRole: 'unknown' }]) scenario(`D04 support variant ${JSON.stringify(changed)}`, ['R2-D04'], ['SUP.4', 'APP.1'], async () => {
  const h = harness(); await h.assigned(); await h.ok(client, { type: 'open_resolution', jobId: 'job', id: 'case', evidence: [] });
  return deny(h, 'admin', { type: 'support', id: 'invalid', userId: 'client', userRole: 'client', basis: 'resolution', basisId: 'case', ...changed });
});
for (const changed of [{ authorId: 'stranger' }, { sender: 'helpy' }, { chatId: 'other' }]) scenario(`D05 message attribution ${JSON.stringify(changed)}`, ['R2-D05', 'R2-D03'], ['CHT.2', 'APP.4', 'APP.6'], async () => {
  const h = harness(); await h.assigned('card'); const sent = await h.message(master, 'Actual work evidence');
  await h.ok(client, { type: 'open_resolution', jobId: 'job', id: 'case', evidence: [] });
  Object.assign(h.repository.state.messages[sent.outcome.message.id], changed);
  const before = await h.repository.read();
  const result = await read(h, client, { type: 'chat_history', chatId: 'chat:job:master' });
  assert.equal(result.ok, false);
  let exports = 0; h.ports.translation.translate = async () => { exports++; throw new Error('Unreachable'); };
  assert.equal((await h.core.translateMessage(client, sent.outcome.message.id, 'ru')).ok, false);
  assert.equal(exports, 0); assert.deepEqual(await h.repository.read(), before);
  const inspection = await deny(h, 'admin', { type: 'inspect_resolution', caseId: 'case' });
  return { readFailure: result.error.code, inspection, exports };
});
scenario('D05 invalid self completion and review excluded without losing lawful experience', ['R2-D05'], ['REP.6', 'REP.7', 'REP.14', 'OWN.6'], async () => {
  const h = harness(); await h.completed('cash', 'valid'); await h.completed('cash', 'invalid');
  for (const jobId of ['valid', 'invalid']) await h.ok(client, { type: 'review', jobId, id: jobId, stars: 5, marks: [], comment: 'Original' });
  h.repository.state.jobs.invalid.clientId = 'master';
  const result = await read(h, 'stranger:client', { type: 'reputation', masterId: 'master' });
  assert.equal(result.ok, true); assert.equal(result.value.summary.experience, 1);
  assert.equal(result.value.summary.reviewsCount, 1); assert.equal(result.value.summary.reviews[0].jobId, 'valid');
  const history = await read(h, master, { type: 'history' });
  assert.equal(history.ok, true); assert.deepEqual(history.value.jobs.map(job => job.id), ['valid']);
  assert.equal(h.repository.state.reviews.invalid.comment, 'Original');
  return { experience: 1, reviewsCount: 1, history: ['valid'], canonicalInvalidReviewPreserved: true };
});
async function publish(h, draft) {
  await h.ok('admin', { type: 'save_catalog', draft, expectedSequence: null });
  await h.ok('admin', { type: 'approve_content_set', key: `test-catalog:${draft.version}`, sequence: 1,
    revisions: draft.texts.map(text => ({ textId: text.id, revision: text.revision })), confirmed: true });
  await h.ok('admin', { type: 'publish_catalog', key: `test-catalog:${draft.version}`, sequence: 2 });
}
for (const variant of ['removed', 'widened']) scenario(`D06 ${variant} current block never grants historical access`, ['R2-D06'], ['INF.6', 'INF.7', 'INF.12', 'TXT.14'], async () => {
  const h = harness(); await h.published('job', 'disposer'); await h.offer();
  const input = { type: 'published_text', catalogKey: 'test-catalog:1', textId: 'rule-text:disposer', locale: 'ru', jobId: 'job' };
  const old = (await read(h, master, input)).value.text;
  assert.equal((await read(h, client, input)).ok, false);
  const snapshot = structuredClone(h.repository.state.jobs.job.snapshot);
  const draft = catalog({ approved: false, version: 2 });
  const text = draft.texts.find(text => text.id === input.textId); text.revision++;
  for (const edition of Object.values(text.editions)) edition.revision = text.revision;
  text.editions.ru.text = 'TEST ONLY ru: corrected, same contractual meaning';
  if (variant === 'removed') {
    draft.blocks = draft.blocks.filter(block => block.id !== 'rule:disposer');
    draft.bindings = draft.bindings.filter(binding => binding.blockId !== 'rule:disposer');
  } else draft.blocks.find(block => block.id === 'rule:disposer').roles.push('client');
  await publish(h, draft);
  await h.ok('admin', { type: 'translation_correction', oldCatalogKey: input.catalogKey, newCatalogKey: 'test-catalog:2',
    textId: input.textId, sameMeaningConfirmed: true });
  const denied = await read(h, client, { ...input, corrected: true }); assert.equal(denied.ok, false);
  const permitted = await read(h, master, { ...input, corrected: true }); assert.equal(permitted.ok, true);
  assert.equal(permitted.value.text, text.editions.ru.text);
  assert.equal((await read(h, master, input)).value.text, old);
  assert.equal((await read(h, 'admin', input)).value.text, old);
  assert.equal((await read(h, 'stranger:client', { ...input, corrected: true })).ok, false);
  assert.deepEqual(h.repository.state.jobs.job.snapshot, snapshot);
  return { variant, denial: denied.error.code, permittedMasterCorrection: true, originalAndSnapshotPreserved: true };
});
async function account(h) {
  h.claims.set('login', { id: 'claim', purpose: 'login', identity: { method: 'email_otp', subject: 'new@test.invalid' },
    email: 'new@test.invalid', phone: null, expiresAt: h.clock.now() + 1000, ownerId: null });
  assert.equal((await h.core.authenticate('login', 'new', 'account-created')).ok, true);
}
for (const kind of ['audit', 'account', 'financial', 'communication', 'evidence']) scenario(`D07 ${kind} original anchor and policy`, ['R2-D07'], ['RET.2', 'RET.3', 'RET.5', 'RET.8', `CFG.${kind}Retention`], async () => {
  const h = harness(); h.clock.value = 200;
  await h.ok('admin', { type: 'publish_policy', policy: policy({ version: 'long', effectiveAt: 200, providerConfirmation: 900,
    auditRetention: { value: 3, unit: 'years' }, accountRetention: { value: 3, unit: 'years' },
    financialRetention: { value: 3, unit: 'years' }, communicationRetention: { value: 120, unit: 'days' }, evidenceRetention: { value: 120, unit: 'days' } }) });
  await h.completed('card'); await account(h);
  const event = h.repository.state.events.find(event => event.type === 'operation:publish_job');
  const id = kind === 'audit' ? `audit:${event.id}` : kind === 'account' ? 'account:new' :
    kind === 'financial' ? 'financial:payment:payment:job' : `${kind}:job`;
  const original = structuredClone(h.repository.state.retention[id]); assert.equal(original.policyVersion, 'long');
  const rejected = [];
  for (const change of ['anchor', 'policy']) {
    const forged = { ...original, ...(change === 'anchor' ? { anchor: 0 } : { policyVersion: h.config.version }) };
    forged.deadline = h.clock.add(forged.anchor, (change === 'anchor' ? h.repository.state.policies.find(policy => policy.version === 'long') : h.config)[`${kind}Retention`]);
    h.repository.state.retention[id] = forged; h.clock.value = forged.deadline;
    rejected.push(await deny(h, 'admin', { type: 'evaluate_retention', factId: id }));
  }
  h.repository.state.retention[id] = original;
  h.clock.value = original.deadline - 1;
  assert.equal((await h.ok('admin', { type: 'evaluate_retention', factId: id })).outcome.assessment.eligibleForRetentionAction, false);
  h.clock.value++;
  assert.equal((await h.ok('admin', { type: 'evaluate_retention', factId: id })).outcome.assessment.eligibleForRetentionAction, true);
  h.ports.legalRetention.restrictions = () => success({ hold: true, notBefore: null });
  assert.equal((await h.ok('admin', { type: 'evaluate_retention', factId: id })).outcome.assessment.eligibleForRetentionAction, false);
  assert.deepEqual(h.repository.state.retention[id], original);
  return { kind, rejected, boundaryBefore: false, boundaryAt: true, held: false, initialPolicy: original.policyVersion };
});
scenario('D07 later published backdated policy cannot rewrite original record basis after restart', ['R2-D07'], ['RET.8', 'CFG.accountRetention', 'CFG.auditRetention'], async () => {
  const h = harness(); await account(h); const original = structuredClone(h.repository.state.retention['account:new']);
  h.clock.value = 200;
  await h.ok('admin', { type: 'publish_policy', policy: policy({ version: 'backdated', effectiveAt: 50, accountRetention: { value: 3, unit: 'years' } }) });
  const repository = new FakeRepository(await h.repository.read(), h.repository.receipts);
  h.clock.value = original.deadline;
  const core = new DomainCore({ ...h.ports, repository });
  const result = await core.execute('admin', 'evaluate-restarted', { type: 'evaluate_retention', factId: 'account:new' });
  assert.equal(result.ok, true); assert.equal(result.value.outcome.assessment.eligibleForRetentionAction, true);
  assert.deepEqual(result.value.outcome.fact, original);
  return { originalPolicy: original.policyVersion, laterPolicy: 'backdated', persistedBasisPreserved: true, eligible: true };
});
async function delivery(h) {
  await h.ok(master, { type: 'preferences', preference: { userId: 'master', eventTypes: ['job_published'], channels: ['test-channel'], soundRequested: true } });
  await h.published(); return h.repository.state.events.find(event => event.type === 'job_published');
}
scenario('D08 revoked scheduler blocks prepared delivery replay and sends nothing', ['R2-D08'], ['NTF.8', 'NTF.9', 'APP.3', 'APP.4'], async () => {
  const h = harness(), event = await delivery(h), claim = h.repository.claimDelivery.bind(h.repository);
  h.repository.claimDelivery = async () => failure('Conflict');
  assert.equal((await h.core.dispatchNotification('admin', event.id, 'master', 'test-channel', 'delivery')).ok, false);
  h.repository.claimDelivery = claim; let calls = 0;
  h.ports.auth.authenticate = async () => success({ ...admin, permissions: [] });
  h.ports.notifications.deliver = async () => { calls++; return success('delivered'); };
  const before = await h.repository.read();
  const result = await h.core.dispatchNotification('admin', event.id, 'master', 'test-channel', 'delivery');
  assert.equal(result.ok, false); assert.equal(calls, 0); assert.deepEqual(await h.repository.read(), before);
  return { failure: result.error.code, externalDeliveries: 0, preparedStatus: 'requested', rollback: true };
});
scenario('D08 concurrent authorized delivery replay is sent only once', ['R2-D08'], ['NTF.8', 'NTF.9', 'APP.3'], async () => {
  const h = harness(), event = await delivery(h); let calls = 0;
  h.ports.notifications.deliver = async () => { calls++; return success('delivered'); };
  const send = () => h.core.dispatchNotification('admin', event.id, 'master', 'test-channel', 'delivery');
  assert.ok((await Promise.all([send(), send(), send()])).every(result => result.ok));
  assert.equal((await send()).ok, true); assert.equal(calls, 1);
  return { authorizedCalls: 4, externalDeliveries: 1 };
});
scenario('D08 permission is rechecked after claim before external delivery', ['R2-D08'], ['NTF.8', 'APP.3'], async () => {
  const h = harness(), event = await delivery(h), claim = h.repository.claimDelivery.bind(h.repository);
  h.repository.claimDelivery = async id => {
    const result = await claim(id); h.ports.auth.authenticate = async () => success({ ...admin, permissions: [] }); return result;
  };
  let calls = 0; h.ports.notifications.deliver = async () => { calls++; return success('delivered'); };
  const result = await h.core.dispatchNotification('admin', event.id, 'master', 'test-channel', 'delivery');
  assert.equal(result.ok, false); assert.equal(calls, 0);
  assert.equal(h.repository.state.deliveries.delivery.status, 'pending');
  return { failure: result.error.code, externalDeliveries: 0, safeUnsentClaim: 'pending' };
});
scenario('D08 finance receipt replay requires current permission without second debt effect', ['R2-D08'], ['DBT.19', 'APP.3', 'APP.4'], async () => {
  const h = harness(); h.repository.state.debt.master = 300n;
  await h.ok(master, { type: 'request_repayment', id: 'request', amount: 200n, confirmed: true });
  await h.ok('admin', { type: 'support', id: 'support', userId: 'master', userRole: 'master', basis: 'repayment', basisId: 'request' });
  const command = { type: 'agree_repayment', requestId: 'request', amount: 200n, method: 'cash', agreementId: 'agreement' };
  await h.ok('admin', command, 'agreement-command'); await h.ok('admin', command, 'agreement-command');
  h.ports.auth.authenticate = async () => success({ ...admin, permissions: [] });
  const rejected = await deny(h, 'admin', command, 'agreement-command');
  assert.equal(h.repository.state.debt.master, 300n);
  return { authorizedReplays: 2, ...rejected, disclosure: false, debt: 300n };
});
scenario('D08 atomic access guard runs before a cached receipt with a changed active role', ['R2-D08'], ['ACC.5', 'APP.3', 'APP.4'], async () => {
  const h = harness(); const command = { type: 'request_repayment', id: 'request', amount: 200n, confirmed: true };
  h.repository.state.debt.master = 300n; await h.ok(master, command, 'request-once');
  const transact = h.repository.transact.bind(h.repository);
  h.repository.transact = (...args) => { h.repository.state.users.master.masterActive = false; return transact(...args); };
  const result = await h.execute(master, command, 'request-once');
  assert.equal(result.ok, false); assert.equal(result.error.code, 'RoleInactive');
  assert.equal(Object.keys(h.repository.state.repayments).length, 1);
  return { failure: 'RoleInactive', cachedReceiptDisclosed: false, requests: 1 };
});
scenario('D08 permission revoked during provider I/O cannot commit payment outcome', ['R2-D08'], ['APP.3', 'APP.4', 'PAY.9'], async () => {
  const h = harness(); const { operation, command } = await financial(h, 'incoming');
  const value = { operationId: operation.id, binding: structuredClone(operation.binding), amount: operation.amount, currency: 'THB', status: 'success' };
  h.ports.payments.verifyOutcome = async () => {
    h.ports.auth.authenticate = async () => success({ ...admin, permissions: [] }); return success(value);
  };
  const rejected = await deny(h, 'admin', command);
  assert.equal(h.repository.state.jobs.job.state, 'reserved'); return { ...rejected, assignment: false };
});
after(async () => {
  const directory = new URL('../../../docs/f2/evidence/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('r2-native-proofs.json', directory), JSON.stringify(records, (_, value) => typeof value === 'bigint' ? `${value}n` : value, 2) + '\n');
});
