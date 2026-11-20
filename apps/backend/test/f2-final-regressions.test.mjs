import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './f2-harness.mjs';
import { query } from '../dist/application/queries.js';
import { DomainCore } from '../dist/application/domain-core.js';

const A = 'admin', M = 'master:master';
async function support() {
  const h = harness(); await h.completed();
  await h.ok(M, { type: 'request_repayment', id: 'repayment-final', amount: 100n, confirmed: true });
  await h.ok(A, { type: 'support', id: 'support-final', userId: 'master', userRole: 'master', basis: 'repayment', basisId: 'repayment-final' });
  h.query = (session, input) => query(h.repository, h.ports.auth, h.clock, session, input);
  return h;
}
const message = id => ({ type: 'message', chatId: 'support-final', id, original: 'Official repayment discussion', photoIds: [], sender: 'user' });
async function refused(h, action) {
  const before = await h.repository.read(), receipts = structuredClone(h.repository.receipts);
  const result = await action();
  assert.equal(result.ok, false);
  assert.ok(['InvalidReference', 'InvalidRepayment'].includes(result.error.code), result.error.code);
  assert.deepEqual(await h.repository.read(), before); assert.deepEqual(h.repository.receipts, receipts);
}

test('FINAL support closure cannot be undone by a saved mode change', async () => {
  const h = await support(); await h.ok(M, message('before-close'));
  await h.ok(A, { type: 'close_support', chatId: 'support-final' });
  const history = await h.query(M, { type: 'chat_history', chatId: 'support-final' });
  assert.equal(history.ok, true); assert.equal(history.value.messages.length, 1);
  h.repository.state.threads['support-final'].mode = 'support';
  let exports = 0; h.ports.translation.detect = async () => { exports++; throw new Error('must not export'); };
  await refused(h, () => h.execute(M, message('after-forged-reopen')));
  assert.equal(exports, 0);
});

for (const change of ['remove', 'duplicate', 'reorder']) test(`FINAL support history rejects ${change} of original message references`, async () => {
  const h = await support(); await h.ok(M, message('first')); await h.ok(M, message('second'));
  const valid = await h.query(M, { type: 'chat_history', chatId: 'support-final' });
  assert.equal(valid.ok, true); assert.deepEqual(valid.value.messages.map(value => value.id), ['first', 'second']);
  const ids = h.repository.state.threads['support-final'].messageIds;
  if (change === 'remove') ids.pop(); else if (change === 'duplicate') ids.push('second'); else ids.reverse();
  await refused(h, () => h.query(M, { type: 'chat_history', chatId: 'support-final' }));
  await refused(h, () => h.execute(M, message('cannot-append')));
});

test('FINAL closed repayment cannot be reopened through saved status', async () => {
  const h = await support();
  await h.ok(A, { type: 'agree_repayment', requestId: 'repayment-final', amount: 100n, method: 'cash', agreementId: 'agreement-final' });
  await h.ok(A, { type: 'close_repayment', requestId: 'repayment-final', reason: 'No confirmed receipt' });
  assert.equal((await h.query(M, { type: 'repayment', requestId: 'repayment-final' })).value.request.status, 'closed');
  h.repository.state.repayments['repayment-final'].status = 'agreed';
  await refused(h, () => h.execute(A, { type: 'receive_repayment', requestId: 'repayment-final', masterId: 'master', amount: 100n,
    receiptId: 'forged-receipt', agreementId: 'agreement-final', actuallyReceived: true, evidence: 'receipt' }));
});

test('FINAL repayment support identity cannot be erased to open a second conversation', async () => {
  const h = await support(); h.repository.state.repayments['repayment-final'].supportChatId = null;
  await refused(h, () => h.execute(A, { type: 'support', id: 'second-support', userId: 'master', userRole: 'master', basis: 'repayment', basisId: 'repayment-final' }));
});

test('FINAL support retains lawful replay and translation after explicit closure and restart', async () => {
  const h = await support(), input = message('replay-original');
  const sent = await h.ok(M, input, 'final-message-once');
  await h.ok(A, { type: 'close_support', chatId: 'support-final' }, 'final-close-once');
  const before = await h.repository.read(), receipts = structuredClone(h.repository.receipts);
  const restarted = new DomainCore(h.ports); let detections = 0;
  h.ports.translation.detect = async () => { detections++; throw new Error('replay must not export'); };
  const replay = await restarted.execute(M, 'final-message-once', input);
  assert.equal(replay.ok, true); assert.deepEqual(replay.value, sent); assert.equal(detections, 0);
  assert.equal((await restarted.execute(A, 'final-close-once', { type: 'close_support', chatId: 'support-final' })).ok, true);
  const translated = await restarted.translateMessage(M, input.id, 'ru');
  assert.equal(translated.ok, true); assert.equal(translated.value.original, input.original);
  assert.deepEqual(await h.repository.read(), before); assert.deepEqual(h.repository.receipts, receipts);
});

test('FINAL request closure preserves independent support conversation and does not change debt', async () => {
  const h = await support(), debt = h.repository.state.debt.master, ledger = structuredClone(h.repository.state.ledger);
  await h.ok(A, { type: 'close_repayment', requestId: 'repayment-final', reason: 'No confirmed receipt' });
  await h.ok(M, message('still-open'));
  await h.ok(A, { ...message('official-reply'), sender: 'helpy' });
  const result = await h.query(M, { type: 'chat_history', chatId: 'support-final' });
  assert.equal(result.ok, true); assert.deepEqual(result.value.messages.map(value => value.id), ['still-open', 'official-reply']);
  assert.equal(result.value.messages[1].authorId, 'helpy');
  assert.equal(h.repository.state.debt.master, debt); assert.deepEqual(h.repository.state.ledger, ledger);
});

test('FINAL support close and pending message serialize without reopening or duplicate history', async () => {
  for (const closeFirst of [true, false]) {
    const h = await support(), state = h.repository.state;
    const close = () => h.execute(A, { type: 'close_support', chatId: 'support-final' }, 'race-close');
    const send = () => h.execute(M, message('race-message'), 'race-message');
    const results = await Promise.all(closeFirst ? [close(), send()] : [send(), close()]);
    assert.equal(results[closeFirst ? 0 : 1].ok, true);
    const history = await h.query(M, { type: 'chat_history', chatId: 'support-final' });
    assert.equal(history.ok, true); assert.ok(history.value.messages.length <= 1);
    assert.equal(h.repository.state.threads['support-final'].mode, 'closed');
    assert.deepEqual(h.repository.state.ledger, state.ledger); assert.deepEqual(h.repository.state.debt, state.debt);
  }
});
