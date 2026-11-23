import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './f2-harness.mjs';
import { scope } from './f2-fixtures.mjs';
import { query } from '../dist/application/queries.js';

// Acceptance expectations come from R35, not the candidate's Domain calculators.
// Only port wiring and input data are reused; journeys use public Application calls.
const A = 'admin', C = 'client:client', M = 'master:master';
function customer() {
  const h = harness(); let sequence = 0;
  const send = async (session, command, operationId = `customer:${++sequence}`) => {
    const result = await h.execute(session, command, operationId);
    assert.equal(result.ok, true, result.ok ? '' : result.error.code); return result.value;
  };
  const read = async (session, input) => {
    const result = await query(h.repository, h.ports.auth, h.clock, session, input);
    assert.equal(result.ok, true, result.ok ? '' : result.error.code); return result.value;
  };
  const refuse = async (session, command, codes, operationId = `customer-refusal:${++sequence}`) => {
    const before = structuredClone({ state: h.repository.state, receipts: h.repository.receipts });
    const result = await h.execute(session, command, operationId);
    assert.equal(result.ok, false); assert.ok(codes.includes(result.error.code), result.error.code);
    assert.deepEqual({ state: h.repository.state, receipts: h.repository.receipts }, before); return result;
  };
  const publish = async (id, amount = 1000n) => {
    const draft = { items: [scope(h.fixture)], cep: amount, publicAddress: `PUBLIC DISTRICT STREET ${id}`, address: `PRIVATE CUSTOMER SITE ${id}` };
    await send(C, { type: 'new_job', id, draft }); await send(C, { type: 'publish_job', jobId: id });
  };
  const reserve = async (id, amount = 1000n, chatId = `dialogue:${id}`) => {
    await send(M, { type: 'initial_offer', jobId: id, id: `offer:${id}`, chatId });
    await send(M, { type: 'final_application', jobId: id, masterId: 'master', amount, recipientId: 'client', confirmed: true });
    await send(C, { type: 'select_master', jobId: id, masterId: 'master', amount, confirmed: true });
  };
  const assign = async (id, amount = 1000n, method = 'cash') => {
    await publish(id, amount); await reserve(id, amount);
    if (method === 'cash') await send(C, { type: 'cash', jobId: id });
    else {
      await send(C, { type: 'initiate_payment', jobId: id, id: `payment:${id}`, route: method });
      h.outcomes.set(`paid:${id}`, { operationId: `payment:${id}`, amount, currency: 'THB', status: 'success' });
      await send(A, { type: 'payment_outcome', jobId: id, proof: `paid:${id}` });
    }
  };
  const finish = async (id, amount = 1000n, method = 'cash') => {
    await assign(id, amount, method);
    await send(C, { type: 'accept_work', jobId: id, accepted: true, explanation: '' });
    await send(M, { type: 'complete', jobId: id });
  };
  return { h, send, read, refuse, publish, reserve, assign, finish };
}

test('CUSTOMER money: 207 Cash then 103 noncash yields debt 12, frozen transfer 22 and one recovery', async () => {
  const { h, send, read, refuse, finish } = customer();
  await finish('cash', 207n); assert.equal((await read(M, { type: 'debt', masterId: 'master' })).view.outstandingDebt, 62n);
  await send(A, { type: 'threshold', masterId: 'master', amount: 13n });
  assert.equal((await read(C, { type: 'cash_availability', masterId: 'master' })).mode, 'noncash_only');
  await finish('card', 103n, 'card');
  const payout = h.repository.state.payouts.card;
  assert.deepEqual([payout.commission, payout.netBeforeDebt, payout.debtBefore, payout.debtRecovery, payout.amount], [31n, 72n, 62n, 50n, 22n]);
  assert.equal((await read(M, { type: 'debt', masterId: 'master' })).view.outstandingDebt, 12n);
  assert.equal((await read(C, { type: 'cash_availability', masterId: 'master' })).mode, 'cash_and_noncash');
  await send(A, { type: 'start_payout', jobId: 'card', attemptId: 'first-transfer' });
  h.outcomes.set('failed-transfer', { operationId: 'first-transfer', amount: 22n, currency: 'THB', status: 'failed', reason: 'declined' });
  await send(A, { type: 'payout_outcome', jobId: 'card', proof: 'failed-transfer' });
  h.clock.value++;
  await send(A, { type: 'publish_policy', policy: { ...h.config, version: 'later-commission', effectiveAt: h.clock.value, commission: { numerator: 80n, denominator: 100n } } });
  await refuse(A, { type: 'start_payout', jobId: 'card', attemptId: 'override', amount: 23n }, ['InvalidConfiguration']);
  await send(A, { type: 'start_payout', jobId: 'card', attemptId: 'retry-transfer' });
  h.outcomes.set('paid-transfer', { operationId: 'retry-transfer', amount: 22n, currency: 'THB', status: 'success' });
  await send(A, { type: 'payout_outcome', jobId: 'card', proof: 'paid-transfer' });
  const ledger = structuredClone(h.repository.state.ledger);
  await send(A, { type: 'payout_outcome', jobId: 'card', proof: 'paid-transfer' });
  assert.deepEqual(h.repository.state.ledger, ledger); assert.equal(Object.keys(ledger).length, 2);
  assert.equal((await read(M, { type: 'payout', jobId: 'card' })).amount, 22n);
  assert.equal((await read(M, { type: 'debt', masterId: 'master' })).view.outstandingDebt, 12n);
});

test('CUSTOMER payment: late unknown protects reservation and only first failed grants the new 37-second countdown', async () => {
  const { h, send, read, refuse, publish, reserve } = customer();
  await publish('timed', 101n); await reserve('timed', 101n);
  assert.equal((await read(C, { type: 'payment', jobId: 'timed' })).view.deadline, 700);
  h.clock.value = 699; await send(C, { type: 'initiate_payment', jobId: 'timed', id: 'first', route: 'card' });
  h.clock.value = 800;
  await send(A, { type: 'publish_policy', policy: { ...h.config, version: 'new-countdown', effectiveAt: 800, paymentSelectionTimeout: 37 } });
  h.outcomes.set('unknown', { operationId: 'first', amount: 101n, currency: 'THB', status: 'unknown' });
  await send(A, { type: 'payment_outcome', jobId: 'timed', proof: 'unknown' });
  assert.equal((await read(C, { type: 'payment', jobId: 'timed' })).view.providerStatus, 'unknown');
  await refuse(A, { type: 'reservation_deadline', jobId: 'timed' }, ['PaymentOutcomeUnknown']);
  await refuse(C, { type: 'cash', jobId: 'timed' }, ['PaymentOutcomeUnknown']);
  h.outcomes.set('failed', { operationId: 'first', amount: 101n, currency: 'THB', status: 'failed', reason: 'insufficient_funds' });
  await send(A, { type: 'payment_outcome', jobId: 'timed', proof: 'failed' });
  assert.equal((await read(C, { type: 'payment', jobId: 'timed' })).view.deadline, 837);
  await send(C, { type: 'initiate_payment', jobId: 'timed', id: 'second', route: 'card' });
  h.clock.value = 820; h.outcomes.set('second-failed', { operationId: 'second', amount: 101n, currency: 'THB', status: 'failed' });
  await send(A, { type: 'payment_outcome', jobId: 'timed', proof: 'second-failed' });
  assert.equal((await read(C, { type: 'payment', jobId: 'timed' })).view.deadline, 837);
  await send(C, { type: 'initiate_payment', jobId: 'timed', id: 'third', route: 'card' });
  h.clock.value = 1000; h.outcomes.set('late-success', { operationId: 'third', amount: 101n, currency: 'THB', status: 'success' });
  await send(A, { type: 'payment_outcome', jobId: 'timed', proof: 'late-success' });
  assert.equal((await read(C, { type: 'job', jobId: 'timed' })).job.state, 'assigned');
  assert.equal((await read(M, { type: 'job', jobId: 'timed' })).job.address, 'PRIVATE CUSTOMER SITE timed');
});

test('CUSTOMER address projection keeps full address private until assignment and in assigned history', async () => {
  const { send, read, publish, reserve } = customer();
  await publish('address');
  const feed = await read(M, { type: 'feed' });
  assert.equal(feed.jobs.find(job => job.id === 'address').publicAddress, 'PUBLIC DISTRICT STREET address');
  assert.ok(feed.jobs.every(job => !Object.hasOwn(job, 'address')));
  await reserve('address');
  const reservedMaster = await read(M, { type: 'job', jobId: 'address' });
  assert.equal(reservedMaster.job.publicAddress, 'PUBLIC DISTRICT STREET address');
  assert.equal(reservedMaster.job.address, null);
  assert.equal((await read(C, { type: 'job', jobId: 'address' })).job.address, 'PRIVATE CUSTOMER SITE address');
  await send(C, { type: 'cash', jobId: 'address' });
  assert.equal((await read(M, { type: 'job', jobId: 'address' })).job.address, 'PRIVATE CUSTOMER SITE address');
  await send(C, { type: 'accept_work', jobId: 'address', accepted: true, explanation: '' });
  await send(M, { type: 'complete', jobId: 'address' });
  const history = await read(M, { type: 'history' });
  assert.equal(history.jobs.find(job => job.id === 'address').address, 'PRIVATE CUSTOMER SITE address');
});

test('CUSTOMER cancellation: 103 THB False Call keeps original 72/15/16 allocation after Admin changes rates', async () => {
  const { h, send, assign, read } = customer(); await assign('false-call', 103n, 'card');
  await send(M, { type: 'cancel', jobId: 'false-call', id: 'request', confirmed: true, classification: 'false_call', reason: 'Arrived at site', explanation: 'Cannot perform the agreed work at this site', evidence: ['master-photo'], remainingWork: '' });
  h.clock.value++;
  await send(A, { type: 'publish_policy', policy: { ...h.config, version: 'other-fees', effectiveAt: h.clock.value,
    falseCallFee: { numerator: 80n, denominator: 100n }, falseCallMasterShare: { numerator: 20n, denominator: 100n } } });
  const caseId = h.repository.state.jobs['false-call'].resolutionId;
  const result = await send(A, { type: 'decide_resolution', caseId, decision: { id: 'decision', type: 'false_call', reason: 'Arrival and evidence verified', evidence: ['master-photo'],
    facts: { arrived: true, partialWork: false, voluntaryRefusalProven: false, acceptanceReviewed: false, historyReviewed: true } } });
  assert.deepEqual(result.outcome.resolution.decision.allocation, { clientRefund: 72n, masterCompensation: 15n, helpyShare: 16n });
  assert.deepEqual(h.repository.state.ledger, {});
  assert.equal((await read(M, { type: 'debt', masterId: 'master' })).view.outstandingDebt, 0n);
});

test('CUSTOMER partial work: 101 THB distributes exactly 71 THB after the 30 THB commission', async () => {
  const { h, send, refuse, assign } = customer(); await assign('partial', 101n, 'card');
  await send(M, { type: 'cancel', jobId: 'partial', id: 'partial-request', confirmed: true, classification: 'partial', reason: 'Partial result', explanation: 'Some agreed installation is completed', evidence: ['master-photo'], remainingWork: 'Finish mounting and testing' });
  const caseId = h.repository.state.jobs.partial.resolutionId;
  const decision = { id: 'partial-decision', type: 'partial', reason: 'Both positions and original work evidence reviewed', evidence: ['master-photo'],
    facts: { arrived: true, partialWork: true, voluntaryRefusalProven: false, acceptanceReviewed: false, historyReviewed: true }, shares: { clientRefund: 29n, masterCompensation: 43n } };
  await refuse(A, { type: 'decide_resolution', caseId, decision }, ['FundsMismatch']);
  decision.shares.masterCompensation = 42n;
  const result = await send(A, { type: 'decide_resolution', caseId, decision });
  assert.deepEqual(result.outcome.resolution.decision.allocation, { clientRefund: 29n, masterCompensation: 42n, helpyShare: 30n });
  assert.deepEqual(Object.values(h.repository.state.obligations).map(value => value.amount).sort((a, b) => a < b ? -1 : 1), [29n, 42n]);
});

test('CUSTOMER catalog: disabling a current service does not rewrite an already published customer obligation', async () => {
  const { h, send, refuse, publish, read } = customer(); await publish('old', 105n);
  const original = structuredClone(h.repository.state.jobs.old.snapshot), draft = structuredClone(h.fixture);
  draft.version = 2; draft.sequence = 1; draft.status = 'draft'; draft.entities.find(entity => entity.id === 'washer').enabled = false;
  for (const text of draft.texts) for (const edition of Object.values(text.editions)) edition.approvedBy = null;
  await send(A, { type: 'save_catalog', draft, expectedSequence: null });
  await send(A, { type: 'approve_content_set', key: 'test-catalog:2', sequence: 1, confirmed: true, revisions: draft.texts.map(text => ({ textId: text.id, revision: text.revision })) });
  await send(A, { type: 'publish_catalog', key: 'test-catalog:2', sequence: 2 });
  await refuse(C, { type: 'new_job', id: 'new', draft: { items: [scope(h.fixture)], cep: 105n, publicAddress: 'Public district street', address: 'New site' } }, ['InactiveEntity']);
  assert.equal((await read(C, { type: 'job', jobId: 'old' })).job.cep, 105n);
  assert.deepEqual(h.repository.state.jobs.old.snapshot, original);
});

test('CUSTOMER privacy: uncertain external detection retains a lawful original without exporting it', async () => {
  const { h, send, publish, read } = customer(); await publish('privacy');
  await send(M, { type: 'initial_offer', jobId: 'privacy', id: 'privacy-offer', chatId: 'privacy-chat' });
  let exports = 0, checks = 0;
  h.ports.textSafety.inspect = async ({ text, purpose }) => ({ ok: true, value: { text, purpose, status: ++checks === 1 ? 'allowed' : 'unknown', reason: null } });
  h.ports.translation.detect = async () => { exports++; return { ok: true, value: { language: 'en', reliable: true } }; };
  await send(C, { type: 'message', chatId: 'privacy-chat', id: 'original', original: '60 x 40 x 80, 103 THB, 20:30', photoIds: [], sender: 'user' });
  assert.equal(exports, 0);
  const messages = (await read(M, { type: 'chat_history', chatId: 'privacy-chat' })).messages;
  assert.equal(messages[0].original, '60 x 40 x 80, 103 THB, 20:30'); assert.equal(messages[0].originalLanguage, null);
  assert.equal(h.repository.state.threads['privacy-chat'].protected, false);
});

for (const entity of ['job', 'repayment', 'inbox', 'feedback', 'draft', 'support', 'job-chat', 'review', 'offer', 'cancellation', 'resolution', 'decision', 'financial-operation']) test(`CUSTOMER identity: missing ${entity} projection never permits creating the same recorded business identity again`, async () => {
  const { h, send, refuse, publish, reserve, finish, assign } = customer(); let command, session = C;
  if (entity === 'job') {
    await finish('permanent', 105n); delete h.repository.state.jobs.permanent;
    command = { type: 'new_job', id: 'permanent', draft: { items: [scope(h.fixture)], cep: 999n, publicAddress: 'Public district street', address: 'Replacement obligation' } };
  } else if (entity === 'repayment') {
    await finish('cash', 1000n); await send(M, { type: 'request_repayment', id: 'request', amount: 100n, confirmed: true });
    delete h.repository.state.repayments.request; session = M; command = { type: 'request_repayment', id: 'request', amount: 100n, confirmed: true };
  } else if (entity === 'inbox') {
    await send(A, { type: 'inbox', id: 'notice', recipientId: 'client', original: 'Original official notice' }); delete h.repository.state.inbox.notice;
    session = A; command = { type: 'inbox', id: 'notice', recipientId: 'stranger', original: 'Replacement notice' };
  } else if (entity === 'feedback') {
    await send(C, { type: 'feedback', id: 'feedback', original: 'Original request' }); delete h.repository.state.feedback.feedback;
    command = { type: 'feedback', id: 'feedback', original: 'Replacement request' };
  } else if (entity === 'draft') {
    const draft = structuredClone(h.fixture); draft.version = 2; draft.sequence = 1; draft.status = 'draft';
    for (const text of draft.texts) for (const edition of Object.values(text.editions)) edition.approvedBy = null;
    await send(A, { type: 'save_catalog', draft, expectedSequence: null }); delete h.repository.state.drafts['test-catalog:2'];
    session = A; command = { type: 'save_catalog', draft, expectedSequence: null };
  } else if (entity === 'support') {
    await assign('working'); await send(C, { type: 'open_resolution', jobId: 'working', id: 'case', evidence: [] });
    await send(A, { type: 'support', id: 'support', userId: 'client', userRole: 'client', basis: 'resolution', basisId: 'case' }); delete h.repository.state.threads.support;
    session = A; command = { type: 'support', id: 'support', userId: 'client', userRole: 'client', basis: 'resolution', basisId: 'case' };
  } else if (entity === 'job-chat') {
    await publish('old-chat'); await send(M, { type: 'initial_offer', jobId: 'old-chat', id: 'old-offer', chatId: 'permanent-chat' });
    delete h.repository.state.threads['permanent-chat']; await publish('other-job');
    session = M; command = { type: 'initial_offer', jobId: 'other-job', id: 'new-offer', chatId: 'permanent-chat' };
  } else if (entity === 'review') {
    await finish('old-review'); await send(C, { type: 'review', jobId: 'old-review', id: 'permanent-review', stars: 5, marks: [], comment: 'Original' });
    delete h.repository.state.reviews['permanent-review']; await finish('new-review');
    command = { type: 'review', jobId: 'new-review', id: 'permanent-review', stars: 1, marks: [], comment: 'Replacement' };
  } else if (entity === 'offer') {
    await publish('old-offer'); await send(M, { type: 'initial_offer', jobId: 'old-offer', id: 'permanent-offer', chatId: 'original-chat' });
    delete h.repository.state.jobs['old-offer'].offers.master; await publish('new-offer');
    session = M; command = { type: 'initial_offer', jobId: 'new-offer', id: 'permanent-offer', chatId: 'new-chat' };
  } else if (entity === 'cancellation') {
    await assign('old-cancellation');
    const cancellation = { type: 'cancel', jobId: 'old-cancellation', id: 'permanent-request', reason: 'Original request', explanation: 'Before arrival', confirmed: true, classification: 'ordinary', evidence: [], remainingWork: '' };
    await send(C, cancellation); h.repository.state.jobs['old-cancellation'].cancellation = null; await assign('new-cancellation');
    command = { ...cancellation, jobId: 'new-cancellation' };
  } else if (entity === 'resolution') {
    await assign('old-case'); await send(C, { type: 'open_resolution', jobId: 'old-case', id: 'permanent-case', evidence: [] });
    delete h.repository.state.cases['permanent-case']; await assign('new-case');
    command = { type: 'open_resolution', jobId: 'new-case', id: 'permanent-case', evidence: [] };
  } else if (entity === 'decision') {
    const decision = { id: 'permanent-decision', type: 'false_call', reason: 'Arrival and photos reviewed', evidence: ['master-photo'],
      facts: { arrived: true, partialWork: false, voluntaryRefusalProven: false, acceptanceReviewed: false, historyReviewed: true } };
    for (const id of ['old-decision', 'new-decision']) {
      await assign(id); await send(M, { type: 'cancel', jobId: id, id: `request:${id}`, reason: 'Arrived', explanation: 'Cannot perform the agreed work here', confirmed: true, classification: 'false_call', evidence: ['master-photo'], remainingWork: '' });
      if (id === 'old-decision') {
        await send(A, { type: 'decide_resolution', caseId: h.repository.state.jobs[id].resolutionId, decision });
        delete h.repository.state.cases[h.repository.state.jobs[id].resolutionId];
      }
    }
    session = A; command = { type: 'decide_resolution', caseId: h.repository.state.jobs['new-decision'].resolutionId, decision };
  } else {
    await publish('old-payment'); await reserve('old-payment');
    await send(C, { type: 'initiate_payment', jobId: 'old-payment', id: 'permanent-payment', route: 'card' });
    h.repository.state.jobs['old-payment'].reservation.operations = [];
    delete h.repository.state.retention['financial:payment:permanent-payment'];
    delete h.repository.state.retentionOrigins['financial:payment:permanent-payment'];
    await publish('new-payment'); await reserve('new-payment');
    command = { type: 'initiate_payment', jobId: 'new-payment', id: 'permanent-payment', route: 'card' };
  }
  await refuse(session, command, ['Conflict', 'InvalidReference']);
  if (['job', 'repayment', 'support'].includes(entity)) {
    const birthType = { job: 'operation:new_job', repayment: 'operation:request_repayment', support: 'support_opened' }[entity];
    h.repository.state.events = h.repository.state.events.filter(record => !(record.type === birthType &&
      (entity === 'job' ? record.context.kind === 'job' && record.context.jobId === 'permanent' :
        entity === 'repayment' ? record.context.kind === 'repayment' && record.context.requestId === 'request' : record.subjectId === 'support')));
    await refuse(session, command, ['Conflict', 'InvalidReference']);
  }
  if (entity === 'draft') {
    h.repository.state.drafts['test-catalog:2'] = structuredClone(command.draft);
    await send(A, { type: 'approve_content_set', key: 'test-catalog:2', sequence: 1, confirmed: true,
      revisions: command.draft.texts.map(text => ({ textId: text.id, revision: text.revision })) });
    h.repository.state.events = h.repository.state.events.filter(record => !(record.type === 'operation:save_catalog' && record.proof?.kind === 'catalog' && record.proof.key === 'test-catalog:2'));
    await refuse(A, { type: 'save_catalog', draft: { ...command.draft, version: 3 }, expectedSequence: null }, ['InvalidReference']);
  }
});

async function missingMessageProof() {
  const s = customer(), { h, send, publish } = s;
  await publish('message-origin');
  await send(M, { type: 'initial_offer', jobId: 'message-origin', id: 'message-offer', chatId: 'message-chat' });
  await send(C, { type: 'message', chatId: 'message-chat', id: 'original-message', original: 'Original work instructions', photoIds: [], sender: 'user' });
  delete h.repository.state.messages['original-message'];
  Object.assign(h.repository.state.threads['message-chat'], { messageIds: [], clientSpoke: false, masterSpoke: false,
    protected: false, waitingFor: null, reminder: null, languageNotice: null });
  h.repository.state.events = h.repository.state.events.filter(record => !(record.type === 'operation:message' && record.proof?.kind === 'message' && record.proof.message.id === 'original-message'));
  return s;
}

test('CUSTOMER message history: a remaining business fact cannot silently become an empty dialogue', async () => {
  const { h } = await missingMessageProof();
  const before = structuredClone({ state: h.repository.state, receipts: h.repository.receipts });
  const result = await query(h.repository, h.ports.auth, h.clock, M, { type: 'chat_history', chatId: 'message-chat' });
  assert.equal(result.ok, false); assert.equal(result.error.code, 'InvalidReference');
  assert.deepEqual({ state: h.repository.state, receipts: h.repository.receipts }, before);
});

test('CUSTOMER message identity: a remaining original business fact prevents replacement in another dialogue', async () => {
  const { send, refuse, publish } = await missingMessageProof();
  await publish('other-dialogue'); await send(M, { type: 'initial_offer', jobId: 'other-dialogue', id: 'other-offer', chatId: 'other-chat' });
  await refuse(C, { type: 'message', chatId: 'other-chat', id: 'original-message', original: 'Replacement body', photoIds: [], sender: 'user' }, ['Conflict', 'InvalidReference']);
});

test('CUSTOMER replay: the same authorized operation returns its receipt without recreating a missing projection', async () => {
  const { h, send } = customer();
  const command = { type: 'new_job', id: 'stable', draft: { items: [scope(h.fixture)], cep: 105n, publicAddress: 'Public district street', address: 'Original site' } };
  const first = await send(C, command, 'original-operation'); delete h.repository.state.jobs.stable;
  const before = structuredClone({ state: h.repository.state, receipts: h.repository.receipts });
  assert.deepEqual(await send(C, command, 'original-operation'), first);
  assert.deepEqual({ state: h.repository.state, receipts: h.repository.receipts }, before);
});

test('CUSTOMER identity namespaces: equal job, offer, chat, message, review, Inbox and Feedback IDs remain lawful', async () => {
  const { h, send, publish, read } = customer();
  await send(A, { type: 'inbox', id: 'shared', recipientId: 'client', original: 'Official notice' });
  await send(C, { type: 'feedback', id: 'shared', original: 'Customer feedback' });
  await publish('shared', 105n);
  await send(M, { type: 'initial_offer', jobId: 'shared', id: 'shared', chatId: 'shared' });
  await send(C, { type: 'message', chatId: 'shared', id: 'shared', original: '105 THB, 20:30', photoIds: [], sender: 'user' });
  await send(M, { type: 'final_application', jobId: 'shared', masterId: 'master', amount: 105n, recipientId: 'client', confirmed: true });
  await send(C, { type: 'select_master', jobId: 'shared', masterId: 'master', amount: 105n, confirmed: true });
  await send(C, { type: 'cash', jobId: 'shared' });
  await send(C, { type: 'accept_work', jobId: 'shared', accepted: true, explanation: '' });
  await send(M, { type: 'complete', jobId: 'shared' });
  await send(C, { type: 'review', jobId: 'shared', id: 'shared', stars: 5, marks: [], comment: '' });
  assert.equal((await read(C, { type: 'inbox' })).messages[0].original, 'Official notice');
  assert.equal((await read(M, { type: 'chat_history', chatId: 'shared' })).messages[0].original, '105 THB, 20:30');
  assert.equal((await read(C, { type: 'reputation', masterId: 'master' })).summary.experience, 1);
  assert.equal((await read(M, { type: 'debt', masterId: 'master' })).view.outstandingDebt, 32n);
});
