import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { harness, FakeRepository, user } from './f2-harness.mjs';
import { scope } from './f2-fixtures.mjs';
import { DomainCore } from '../dist/application/domain-core.js';
import { query } from '../dist/application/queries.js';
import { checked, own, put, success } from '../dist/domain/core.js';
import { requestCancellation } from '../dist/domain/work.js';
import { initiatePayout, initiateSettlement } from '../dist/domain/finance.js';
import { validateCatalog, validateScope } from '../dist/domain/catalog.js';

const client = 'client:client', master = 'master:master';
const facts = { arrived: false, partialWork: false, voluntaryRefusalProven: false, acceptanceReviewed: false, historyReviewed: false };
const cancel = (classification = 'ordinary', evidence = []) => ({ type: 'cancel', jobId: 'job', id: 'cancel', reason: 'Stop',
  explanation: 'Reviewed circumstances', remainingWork: '', classification, evidence, confirmed: true });
const read = (h, input, session = 'admin') => query(h.repository, h.ports.auth, h.clock, session, input);
const records = [];
function scenario(id, norms, body) {
  test(`R4 REGRESSION ${id}`, async () => {
    const observations = await body();
    records.push({ id, norms, test: `R4 REGRESSION ${id}`, file: 'apps/backend/test/f2-r4-regressions.test.mjs', status: 'PASS', observations });
  });
}
async function deny(h, command, session = 'admin') {
  const before = await h.repository.read(), receipts = structuredClone(h.repository.receipts);
  const result = await h.execute(session, command);
  assert.equal(result.ok, false); assert.equal(typeof result.error.code, 'string');
  assert.deepEqual(await h.repository.read(), before); assert.deepEqual(h.repository.receipts, receipts);
  return result.error.code;
}

for (const method of ['cash', 'card']) scenario(`D01 ${method} False Call belongs only to assigned Master`, ['RES.1', 'RES.4', 'RES.6'], async () => {
  const h = harness(); await h.assigned(method);
  let photos = 0; const lookup = h.ports.photos.lookup;
  h.ports.photos.lookup = async ids => { photos++; return lookup(ids); };
  const command = cancel('false_call', ['client-photo']);
  const failure = await deny(h, command, client); assert.equal(photos, 0);
  const job = structuredClone(h.repository.state.jobs.job);
  const direct = checked(() => requestCancellation(job, { actor: { userId: 'client', role: 'client', permissions: [] }, now: h.clock.now(), operationId: 'direct' }, h.config, command));
  assert.equal(direct.ok, false); assert.equal(job.cancellation, null);
  await h.ok(client, cancel());
  h.clock.value = h.repository.state.jobs.job.cancellation.reminder.deadline;
  await h.ok('admin', { type: 'reminders', jobId: 'job' });
  assert.deepEqual(h.repository.state.events.find(e => e.type === 'cancellation_reminder').recipients, ['master']);
  h.clock.value = h.repository.state.jobs.job.cancellation.responseTimer.deadline;
  await h.ok('admin', { type: 'reminders', jobId: 'job' });
  assert.equal(h.repository.state.cases['case:cancel'].status, 'admin_resolution_pending');
  const m = harness(); await m.assigned(method);
  await m.ok(master, cancel('false_call', ['master-photo']));
  m.clock.value = m.repository.state.jobs.job.cancellation.responseTimer.deadline;
  await m.ok('admin', { type: 'reminders', jobId: 'job' });
  assert.equal(m.repository.state.events.filter(e => e.type === 'cancellation_reminder').length, 0);
  await m.ok('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: { id: 'decision', type: 'false_call', reason: 'Arrival and photo reviewed',
    evidence: ['master-photo'], facts: { ...facts, arrived: true } } });
  assert.equal(m.repository.state.jobs.job.state, 'cancelled');
  assert.equal(m.repository.state.cases['case:cancel'].decision.allocation?.masterCompensation ?? 0n, method === 'card' ? 150n : 0n);
  return { failure, photoCallsBeforeRefusal: 0, ordinaryEscalation: true, masterFalseCall: true, method };
});

async function outgoing(kind) {
  const h = harness();
  if (kind === 'payout') await h.completed('card');
  else {
    await h.assigned('card');
    if (kind === 'refund') {
      await h.ok(client, cancel());
      await h.ok(master, { type: 'cancellation_response', jobId: 'job', workStopped: true, financialConsent: true, explanation: '' });
    } else await h.ok(master, cancel('false_call', ['master-photo']));
    await h.ok('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: { id: 'decision', type: kind === 'refund' ? 'mutual' : 'false_call',
      reason: 'Reviewed', evidence: kind === 'refund' ? ['cancel'] : ['master-photo'], facts: { ...facts, arrived: kind !== 'refund' } } });
  }
  const value = () => kind === 'payout' ? h.repository.state.payouts.job : h.repository.state.obligations[`decision:${kind}`];
  const start = attemptId => kind === 'payout' ? { type: 'start_payout', jobId: 'job', attemptId } : { type: 'start_settlement', obligationId: `decision:${kind}`, attemptId };
  const callback = () => kind === 'payout' ? { type: 'payout_outcome', jobId: 'job', proof: 'outcome' } : { type: 'settlement_outcome', obligationId: `decision:${kind}`, proof: 'outcome' };
  const outcome = async status => { const attempt = value().attempts.at(-1); h.outcomes.set('outcome', { operationId: attempt.id, amount: attempt.amount, currency: 'THB', status }); await h.ok('admin', callback()); };
  return { h, value, start, callback, outcome };
}
for (const kind of ['payout', 'refund', 'compensation']) {
  scenario(`D02 ${kind} confirmed success cannot be erased by flags or attempts`, ['MON.11', 'MON.18', 'RES.20'], async () => {
    const { h, value, start, callback, outcome } = await outgoing(kind);
    await h.ok('admin', start('first')); await outcome('success');
    const saved = structuredClone(value());
    for (const corruption of ['flag', 'attempt-status', 'attempts-removed', 'success-removed']) {
      Object.assign(value(), structuredClone(saved)); value().settled = false;
      if (corruption === 'attempt-status') value().attempts[0].status = 'failed';
      if (corruption === 'attempts-removed') value().attempts = [];
      if (corruption === 'success-removed') { value().attempts[0].status = 'failed'; value().settled = true; }
      await deny(h, start(`second:${corruption}`)); await deny(h, callback());
    }
    Object.assign(value(), saved);
    const repo = new FakeRepository(await h.repository.read(), structuredClone(h.repository.receipts));
    const core = new DomainCore({ ...h.ports, repository: repo });
    const before = await repo.read();
    assert.equal((await core.execute('admin', 'restart-retry', start('second'))).ok, false);
    assert.deepEqual(await repo.read(), before);
    await h.ok('admin', callback()); assert.equal(value().attempts.length, 1);
    // Domain guards do not trust a contradictory settled flag either.
    const corrupt = structuredClone(saved); corrupt.settled = false;
    const direct = checked(() => kind === 'payout' ? initiatePayout(corrupt, h.config, null, h.clock.now(), 'direct') :
      initiateSettlement(corrupt, h.config, null, h.clock.now(), 'direct'));
    assert.equal(direct.ok, false); assert.equal(corrupt.attempts.length, 1);
    return { kind, confirmedAmount: saved.amount, corruptionsRejected: 4, restart: true, directDomain: true, duplicateSuccess: 'no second transfer' };
  });
  scenario(`D02 ${kind} failed retry is immutable and pending unknown never retry`, ['MON.16', 'MON.19', 'RES.20'], async () => {
    const { h, value, start, outcome } = await outgoing(kind);
    await h.ok('admin', start('first')); const amount = value().amount;
    await deny(h, start('second')); await outcome('unknown'); await deny(h, start('second'));
    await outcome('failed'); h.repository.failNextCommit = true;
    assert.equal(await deny(h, start('second')), 'Conflict');
    const results = await Promise.all([h.execute('admin', start('second')), h.execute('admin', start('third'))]);
    assert.equal(results.filter(r => r.ok).length, 1);
    assert.equal(value().attempts.length, 2); assert.equal(value().attempts[1].amount, amount);
    await outcome('success'); await deny(h, start('fourth'));
    assert.equal(value().settled, true);
    return { kind, amount, atomicFailedCommit: true, retryAttempts: 2, concurrentWinners: 1 };
  });
}

for (const debt of [0n, 300n, 1000n]) scenario(`D03 immutable calculation and ledger, original debt ${debt}`, ['MON.12', 'MON.15', 'MON.16', 'MON.22'], async () => {
  const h = harness(); h.repository.state.debt.master = debt; await h.completed('card');
  const saved = structuredClone(h.repository.state.payouts.job), ledger = structuredClone(h.repository.state.ledger);
  const original = h.repository.state.events.find(e => e.type === 'completed');
  assert.equal(original.facts.debtBefore, debt); assert.equal(original.facts.debtRecovery, saved.debtRecovery);
  const changedDebt = debt === 0n ? 300n : 0n;
  const p = h.repository.state.payouts.job;
  p.debtBefore = changedDebt; p.debtRecovery = changedDebt; p.amount = p.netBeforeDebt - changedDebt;
  await deny(h, { type: 'start_payout', jobId: 'job', attemptId: 'tampered' });
  assert.equal((await read(h, { type: 'payout', jobId: 'job' })).ok, false);
  Object.assign(p, saved);
  if (debt > 0n) {
    delete h.repository.state.ledger['recovery:job'];
    await deny(h, { type: 'start_payout', jobId: 'job', attemptId: 'missing-ledger' });
    h.repository.state.ledger = structuredClone(ledger); h.repository.state.ledger['recovery:job'].change = -1n;
    await deny(h, { type: 'start_payout', jobId: 'job', attemptId: 'changed-ledger' });
    h.repository.state.ledger = structuredClone(ledger);
  }
  // Later debt/threshold/policy changes must not become the old calculation's input.
  h.repository.state.debt.master = 900n;
  await h.ok('admin', { type: 'threshold', masterId: 'master', amount: 3000n });
  await h.ok('admin', { type: 'start_payout', jobId: 'job', attemptId: 'valid' });
  assert.equal(h.repository.state.payouts.job.attempts[0].amount, saved.amount);
  assert.deepEqual(h.repository.state.ledger, ledger);
  return { originalDebt: debt, amount: saved.amount, recovery: saved.debtRecovery, laterDebt: 900n, noRecalculation: true };
});
scenario('D03 debtBefore corruption cannot hide behind the capped recovery', ['MON.12', 'MON.16'], async () => {
  const h = harness(); h.repository.state.debt.master = 1000n; await h.completed('card');
  h.repository.state.payouts.job.debtBefore = 2000n; // same recovery490 and payout210, still a different source fact.
  return { failure: await deny(h, { type: 'start_payout', jobId: 'job', attemptId: 'changed-input' }), noInstruction: true };
});

for (const id of ['constructor', '__proto__', 'toString']) {
  scenario(`D04 missing own records ${id} reject queries and commands`, ['APP.1', 'APP.2', 'ACC.13', 'DBT.19', 'TXT.15'], async () => {
    const h = harness(); const before = await h.repository.read();
    for (const input of [{ type: 'contacts', userId: id }, { type: 'repayment', requestId: id },
      { type: 'published_text', catalogKey: id, textId: 'x', locale: 'en' },
      { type: 'information', catalogKey: id, targets: [], locale: 'en' }, { type: 'job', jobId: id },
      { type: 'chat_history', chatId: id }, { type: 'payout', jobId: id }, { type: 'debt', masterId: id }, { type: 'reputation', masterId: id }]) {
      const result = await read(h, input); assert.equal(result.ok, false); assert.equal(typeof result.error.code, 'string');
    }
    for (const command of [{ type: 'close_repayment', requestId: id, reason: 'Close' },
      { type: 'agree_repayment', requestId: id, amount: 1n, method: 'cash', agreementId: 'a' },
      { type: 'inspect_resolution', caseId: id }, { type: 'hide_review', reviewId: id, reason: 'Hide' },
      { type: 'close_support', chatId: id }, { type: 'start_settlement', obligationId: id, attemptId: 'a' },
      { type: 'translation_correction', oldCatalogKey: id, newCatalogKey: 'test-catalog:1', textId: 'x', sameMeaningConfirmed: true }]) await deny(h, command);
    assert.equal((await h.core.translateMessage('admin', id, 'en')).ok, false);
    assert.deepEqual(await h.repository.read(), before);
    return { id, missingQueries: 9, missingCommands: 7, translationDenied: true, unchanged: true };
  });
  scenario(`D04 legal stable IDs ${id} retain their own identity through workflows`, ['APP.1', 'ACC.2', 'OFR.17', 'DBT.9', 'REP.1'], async () => {
    const h = harness();
    h.claims.set('login', { id, purpose: 'login', identity: { method: 'email_otp', subject: `${id}@test.invalid` },
      email: `${id}@test.invalid`, phone: null, expiresAt: 10000, ownerId: null });
    assert.equal((await h.core.authenticate('login', id, 'login')).ok, true);
    assert.equal(Object.hasOwn(h.repository.state.users, id), true);
    assert.equal((await read(h, { type: 'contacts', userId: id })).value.contacts.email, `${id}@test.invalid`);
    await h.ok(client, { type: 'new_job', id, draft: { items: [scope(h.fixture)], cep: 1000n, publicAddress: 'Public district street', address: 'Private' } });
    await h.ok(client, { type: 'publish_job', jobId: id });
    await h.ok(master, { type: 'initial_offer', jobId: id, id, chatId: id });
    await h.ok(client, { type: 'message', chatId: id, id, original: 'Original', photoIds: [], sender: 'user' });
    assert.equal((await read(h, { type: 'chat_history', chatId: id }, client)).value.messages[0].original, 'Original');
    await h.ok(master, { type: 'final_application', jobId: id, masterId: 'master', amount: 1000n, recipientId: 'client', confirmed: true });
    await h.ok(client, { type: 'select_master', jobId: id, masterId: 'master', amount: 1000n, confirmed: true });
    await h.ok(client, { type: 'cash', jobId: id });
    await h.ok(client, { type: 'accept_work', jobId: id, accepted: true, explanation: '' });
    await h.ok(master, { type: 'complete', jobId: id });
    await h.ok(client, { type: 'review', jobId: id, id, stars: 5, marks: [], comment: '' });
    await h.ok('admin', { type: 'hide_review', reviewId: id, reason: 'Reviewed violation' });
    await h.ok(master, { type: 'request_repayment', id, amount: 1n, confirmed: true });
    assert.equal((await read(h, { type: 'repayment', requestId: id })).value.request.id, id);
    await h.ok('admin', { type: 'feedback', id, original: 'Feedback' });
    await h.ok('admin', { type: 'inbox', id, recipientId: 'client', original: 'Official' });
    for (const name of ['jobs', 'threads', 'messages', 'reviews', 'repayments', 'feedback', 'inbox']) {
      assert.equal(Object.hasOwn(h.repository.state[name], id), true);
      assert.equal(Object.getPrototypeOf(h.repository.state[name]), Object.prototype);
    }
    return { id, ownRecords: 8, completed: true, noPrototypeMutation: true };
  });
  scenario(`D04 Master ID ${id} remains a filter not an inherited offer`, ['APP.4', 'ACC.2', 'MON.7'], async () => {
    const h = harness(); put(h.repository.state.users, id, user(id, 'master'));
    h.ports.auth.authenticate = async session => success(session === 'admin' ? { userId: 'admin', role: 'admin', permissions: ['policy', 'scheduler', 'resolution', 'finance'] } :
      { userId: session === client ? 'client' : id, role: session === client ? 'client' : 'master', permissions: [] });
    await h.published();
    await h.ok('special-master', { type: 'initial_offer', jobId: 'job', id: 'offer', chatId: 'chat' });
    await h.ok('special-master', { type: 'final_application', jobId: 'job', masterId: id, amount: 1000n, recipientId: 'client', confirmed: true });
    await h.ok(client, { type: 'select_master', jobId: 'job', masterId: id, amount: 1000n, confirmed: true });
    await h.ok(client, { type: 'cash', jobId: 'job' });
    await h.ok(client, { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' });
    await h.ok('special-master', { type: 'complete', jobId: 'job' });
    assert.equal(own(h.repository.state.debt, id), 300n);
    assert.equal(own(h.repository.state.refusalStreak, id), 0);
    await h.ok('admin', { type: 'threshold', masterId: id, amount: 500n });
    assert.equal((await read(h, { type: 'debt', masterId: id })).value.view.cashAvailable, true);
    return { id, ownAccount: own(h.repository.state.users, id).id, ownOffer: true, cashDebt: 300n, streak: 0 };
  });
}

scenario('D04 form field IDs include prototype names without phantom answers or files', ['FRM.2', 'FRM.6', 'FRM.12'], async () => {
  const h = harness(); const catalog = structuredClone(h.fixture), item = scope(catalog);
  const scenario = catalog.scenarios.find(s => s.id === item.scenarioId), textId = scenario.title;
  scenario.form.questions = [{ id: '__proto__', textId, kind: 'text', required: true }];
  scenario.form.photos = [{ id: 'constructor', textId, minimum: 1, formats: ['image/jpeg'] }];
  scenario.form.tables = [{ id: 'toString', textId, minimumRows: 1, initialRows: 1, columns: [{ id: '__proto__', textId, required: true, kind: 'integer' }] }];
  scenario.form.routes = []; scenario.form.stops = [];
  assert.equal(validateCatalog(catalog, true).ok, true);
  item.answers = {}; item.photos = {}; item.tables = {};
  assert.equal(validateScope(catalog, [item], [], 'client').ok, false);
  put(item.answers, '__proto__', 'Actual answer');
  assert.equal(validateScope(catalog, [item], [], 'client').ok, false);
  put(item.photos, 'constructor', ['photo']); put(item.tables, 'toString', [Object.fromEntries([['__proto__', 2]])]);
  assert.equal(validateScope(catalog, [item], [{ id: 'photo', ownerId: 'client', present: true, format: 'image/jpeg' }], 'client').ok, true);
  return { ownAnswer: true, ownPhoto: true, ownTableCell: true, missingRejected: true };
});

scenario('AUDIT incoming confirmed success cannot be rolled back into a new payment', ['PAY.9', 'PAY.11', 'APP.4'], async () => {
  const h = harness(); await h.assigned('card');
  const job = h.repository.state.jobs.job;
  job.state = 'reserved'; job.reservation.state = 'reserved'; job.funds = 'none';
  job.reservation.operations[0].status = 'failed';
  h.repository.state.threads[job.chatId].mode = 'temporary';
  const failure = await deny(h, { type: 'initiate_payment', jobId: 'job', id: 'second-payment', route: 'card' }, client);
  await deny(h, { type: 'cash', jobId: 'job' }, client);
  assert.equal(job.reservation.operations.length, 1);
  return { failure, noSecondInstruction: true, originalSuccessAuditRetained: true };
});

after(async () => {
  await writeFile(new URL('../../../docs/f2/evidence/r4-native-proofs.json', import.meta.url), JSON.stringify(records, (_, value) => typeof value === 'bigint' ? `${value}n` : value, 2) + '\n');
});
