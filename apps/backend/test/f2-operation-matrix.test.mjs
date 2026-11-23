import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './f2-harness.mjs';
import { catalog, scope } from './f2-fixtures.mjs';
import { query } from '../dist/application/queries.js';
import { DomainCore } from '../dist/application/domain-core.js';
import { failure } from '../dist/domain/core.js';
import { paymentView } from '../dist/domain/finance.js';
import { compoundId } from '../dist/domain/provenance.js';

const A = 'admin', C = 'client:client', M = 'master:master';
const commands = ['publish_policy', 'threshold', 'save_catalog', 'approve_text', 'approve_content_set', 'publish_catalog', 'translation_correction',
  'profile', 'activate', 'switch_role', 'locale', 'bind_contact', 'new_job', 'edit_draft', 'publish_job', 'link_jobs', 'initial_offer', 'message',
  'revise_price', 'approve_price', 'final_application', 'select_master', 'terminate_negotiation', 'publication_deadline', 'cash', 'initiate_payment',
  'payment_outcome', 'reservation_deadline', 'decline_reservation', 'accept_work', 'submit_result', 'complete', 'cancel', 'cancellation_response',
  'open_resolution', 'decide_resolution', 'inspect_resolution', 'reminders', 'start_payout', 'payout_outcome', 'start_settlement', 'settlement_outcome',
  'request_repayment', 'agree_repayment', 'receive_repayment', 'close_repayment', 'support', 'close_support', 'review', 'hide_review', 'hide_history',
  'preferences', 'inbox', 'feedback', 'evaluate_retention'];
const queries = ['feed', 'job', 'payment', 'debt', 'cash_availability', 'information', 'published_text', 'chat_history', 'history', 'reputation', 'contacts', 'role_counts', 'repayment', 'payout', 'inbox'];
const methods = ['login', 'recover', 'translateMessage', 'draftTranslation', 'dispatchNotification'];
assert.equal(commands.length + queries.length + methods.length, 75);
const cancellation = { type: 'cancel', jobId: 'job', id: 'request', reason: 'Client request', explanation: 'Before arrival',
  evidence: [], confirmed: true, classification: 'ordinary', remainingWork: '' };
const decision = { id: 'decision', type: 'mutual', reason: 'Verified mutual cancellation before arrival', evidence: ['request'],
  facts: { arrived: false, partialWork: false, voluntaryRefusalProven: false, acceptanceReviewed: false, historyReviewed: true } };

async function prepare(kind, name) {
  const h = harness();
  await h.ok(A, { type: 'publish_policy', policy: { ...h.config, version: 'matrix-policy', effectiveAt: h.clock.now() } });
  const draft = () => ({ items: [scope(h.fixture)], cep: 1000n, publicAddress: 'Public district street', address: 'Exact private address' });
  const newDraft = () => h.ok(C, { type: 'new_job', id: 'job', draft: draft() });
  const offered = async () => { await h.published(); await h.offer(); };
  const revised = async () => { await offered(); await h.bilateral(); await h.ok(M, { type: 'revise_price', jobId: 'job', masterId: 'master', amount: 1100n, reason: 'Discussed scope', confirmed: true }); };
  const final = async () => { await offered(); await h.ok(M, { type: 'final_application', jobId: 'job', masterId: 'master', amount: 1000n, recipientId: 'client', confirmed: true }); };
  const cancelled = async () => { await h.assigned('card'); await h.ok(C, cancellation); await h.ok(M, { type: 'cancellation_response', jobId: 'job', workStopped: true, financialConsent: true, explanation: '' }); };
  const settled = async () => { await cancelled(); await h.ok(A, { type: 'decide_resolution', caseId: 'case:request', decision }); };
  const repayment = async () => { await h.completed(); await h.ok(M, { type: 'request_repayment', id: 'request', amount: 100n, confirmed: true }); };
  const support = async () => { await repayment(); await h.ok(A, { type: 'support', id: 'support', userId: 'master', userRole: 'master', basis: 'repayment', basisId: 'request' }); };
  const agreed = async () => { await support(); await h.ok(A, { type: 'agree_repayment', requestId: 'request', amount: 100n, method: 'cash', agreementId: 'agreement' }); };
  const savedCatalog = async (publish = false) => {
    await h.ok(A, { type: 'save_catalog', draft: catalog({ approved: false, version: 2 }), expectedSequence: null });
    if (publish) await h.ok(A, { type: 'approve_content_set', key: 'test-catalog:2', sequence: 1, revisions: h.repository.state.drafts['test-catalog:2'].texts.map(text => ({ textId: text.id, revision: text.revision })), confirmed: true });
  };
  let session = C, input, args;
  if (kind === 'command') {
    switch (name) {
      case 'publish_policy': session = A; input = { policy: { ...h.config, version: 'matrix-next', effectiveAt: 101 } }; break;
      case 'threshold': session = A; input = { masterId: 'master', amount: 1000n }; break;
      case 'save_catalog': session = A; input = { draft: catalog({ approved: false, version: 2 }), expectedSequence: null }; break;
      case 'approve_text': await savedCatalog(); session = A; input = { key: 'test-catalog:2', textId: 'category:air', locale: 'ru', sequence: 1, revision: 1 }; break;
      case 'approve_content_set': await savedCatalog(); session = A; input = { key: 'test-catalog:2', sequence: 1, revisions: h.repository.state.drafts['test-catalog:2'].texts.map(text => ({ textId: text.id, revision: text.revision })), confirmed: true }; break;
      case 'publish_catalog': await savedCatalog(true); session = A; input = { key: 'test-catalog:2', sequence: 2 }; break;
      case 'translation_correction': await savedCatalog(true); await h.ok(A, { type: 'publish_catalog', key: 'test-catalog:2', sequence: 2 }); session = A; input = { oldCatalogKey: 'test-catalog:1', newCatalogKey: 'test-catalog:2', textId: 'category:air', sameMeaningConfirmed: true }; break;
      case 'profile': input = { displayName: 'Client display', photoId: null, specialization: { categoryIds: ['appliance'], entityIds: [] } }; break;
      case 'activate': h.repository.state.users.client.clientActive = false; input = { role: 'client' }; break;
      case 'switch_role': input = { role: 'client' }; break;
      case 'locale': input = { locale: 'ru' }; break;
      case 'bind_contact': h.claims.set('claim', { id: 'bind', purpose: 'bind', identity: { method: 'email', subject: 'new-email' }, ownerId: 'client', email: 'new@test.invalid', phone: null, expiresAt: 1000 }); input = { proof: 'claim' }; break;
      case 'new_job': input = { id: 'created-job', draft: draft() }; break;
      case 'edit_draft': await newDraft(); input = { jobId: 'job', draft: { ...draft(), cep: 1100n } }; break;
      case 'publish_job': await newDraft(); input = { jobId: 'job' }; break;
      case 'link_jobs': await h.published('job', 'kitchen', 'assemble'); await h.published('linked', 'bi-oven'); input = { jobId: 'job', linkedJobId: 'linked' }; break;
      case 'initial_offer': await h.published(); session = M; input = { jobId: 'job', id: 'offer', chatId: 'chat' }; break;
      case 'message': await offered(); input = { chatId: 'chat:job:master', id: 'message', original: 'Work discussion 1200 THB', photoIds: [], sender: 'user' }; break;
      case 'revise_price': await offered(); await h.bilateral(); session = M; input = { jobId: 'job', masterId: 'master', amount: 1100n, reason: 'Discussed scope', confirmed: true }; break;
      case 'approve_price': await revised(); input = { jobId: 'job', masterId: 'master', approved: true, confirmed: true }; break;
      case 'final_application': await offered(); session = M; input = { jobId: 'job', masterId: 'master', amount: 1000n, recipientId: 'client', confirmed: true }; break;
      case 'select_master': await final(); input = { jobId: 'job', masterId: 'master', amount: 1000n, confirmed: true }; break;
      case 'terminate_negotiation': await offered(); session = M; input = { jobId: 'job', masterId: 'master', confirmed: true, reason: 'Withdraw offer' }; break;
      case 'publication_deadline': await h.published(); h.clock.value = h.repository.state.jobs.job.cycles[0].countdown.deadline; session = A; input = { jobId: 'job', cycleIndex: 0 }; break;
      case 'cash': case 'initiate_payment': case 'reservation_deadline': case 'decline_reservation': await h.reserved(); input = { jobId: 'job' };
        if (name === 'initiate_payment') Object.assign(input, { id: 'payment', route: 'card' });
        if (name === 'decline_reservation') input.confirmed = true;
        if (name === 'reservation_deadline') { session = A; h.clock.value = h.repository.state.jobs.job.reservation.countdown.deadline; } break;
      case 'payment_outcome': await h.reserved(); await h.ok(C, { type: 'initiate_payment', jobId: 'job', id: 'payment', route: 'card' }); h.outcomes.set('outcome', { operationId: 'payment', amount: 1000n, currency: 'THB', status: 'success' }); session = A; input = { jobId: 'job', proof: 'outcome' }; break;
      case 'accept_work': await h.assigned(); input = { jobId: 'job', accepted: true, explanation: '' }; break;
      case 'submit_result': await h.assigned(); session = M; input = { jobId: 'job', explanation: 'Work result', photoIds: ['master-photo'] }; break;
      case 'complete': await h.assigned(); await h.ok(C, { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' }); session = M; input = { jobId: 'job' }; break;
      case 'cancel': await h.assigned('card'); input = { ...cancellation }; break;
      case 'cancellation_response': await h.assigned('card'); await h.ok(C, cancellation); session = M; input = { jobId: 'job', workStopped: true, financialConsent: true, explanation: '' }; break;
      case 'open_resolution': await h.assigned('card'); input = { jobId: 'job', id: 'case', evidence: [] }; break;
      case 'decide_resolution': await cancelled(); session = A; input = { caseId: 'case:request', decision }; break;
      case 'inspect_resolution': await h.assigned('card'); await h.ok(C, { type: 'open_resolution', jobId: 'job', id: 'case', evidence: [] }); session = A; input = { caseId: 'case' }; break;
      case 'reminders': await offered(); await h.message(C); h.clock.value += 3600; session = A; input = { jobId: 'job' }; break;
      case 'start_payout': await h.completed('card'); session = A; input = { jobId: 'job', attemptId: 'payout-attempt' }; break;
      case 'payout_outcome': await h.completed('card'); await h.ok(A, { type: 'start_payout', jobId: 'job', attemptId: 'payout-attempt' }); h.outcomes.set('outcome', { operationId: 'payout-attempt', amount: 700n, currency: 'THB', status: 'success' }); session = A; input = { jobId: 'job', proof: 'outcome' }; break;
      case 'start_settlement': await settled(); session = A; input = { obligationId: 'decision:refund', attemptId: 'refund-attempt' }; break;
      case 'settlement_outcome': await settled(); await h.ok(A, { type: 'start_settlement', obligationId: 'decision:refund', attemptId: 'refund-attempt' }); h.outcomes.set('outcome', { operationId: 'refund-attempt', amount: 850n, currency: 'THB', status: 'success' }); session = A; input = { obligationId: 'decision:refund', proof: 'outcome' }; break;
      case 'request_repayment': await h.completed(); session = M; input = { id: 'request', amount: 100n, confirmed: true }; break;
      case 'agree_repayment': await support(); session = A; input = { requestId: 'request', amount: 100n, method: 'cash', agreementId: 'agreement' }; break;
      case 'receive_repayment': await agreed(); session = A; input = { requestId: 'request', masterId: 'master', amount: 100n, receiptId: 'receipt', agreementId: 'agreement', actuallyReceived: true, evidence: 'Actual received funds' }; break;
      case 'close_repayment': await repayment(); session = A; input = { requestId: 'request', reason: 'No confirmed receipt' }; break;
      case 'support': await repayment(); session = A; input = { id: 'support', userId: 'master', userRole: 'master', basis: 'repayment', basisId: 'request' }; break;
      case 'close_support': await support(); session = A; input = { chatId: 'support' }; break;
      case 'review': await h.completed(); input = { jobId: 'job', id: 'review', stars: 5, marks: [], comment: '' }; break;
      case 'hide_review': await h.completed(); await h.ok(C, { type: 'review', jobId: 'job', id: 'review', stars: 5, marks: [], comment: '' }); session = A; input = { reviewId: 'review', reason: 'Reviewed platform violation' }; break;
      case 'hide_history': await h.completed(); input = { jobId: 'job' }; break;
      case 'preferences': input = { preference: { userId: 'client', role: 'client', eventTypes: ['initial_offer_sent'], channels: ['test-channel'], soundRequested: false } }; break;
      case 'inbox': session = A; input = { id: 'inbox', recipientId: 'client', original: 'Official information' }; break;
      case 'feedback': input = { id: 'feedback', original: 'Client feedback' }; break;
      case 'evaluate_retention': await h.completed(); session = A; input = { factId: 'communication:job' }; break;
      default: assert.fail(name);
    }
    input = { type: name, ...input };
  } else if (kind === 'query') {
    switch (name) {
      case 'feed': await h.published(); session = M; input = {}; break;
      case 'job': await h.published(); input = { jobId: 'job' }; break;
      case 'payment': await h.reserved(); input = { jobId: 'job' }; break;
      case 'debt': await h.completed(); session = M; input = { masterId: 'master' }; break;
      case 'cash_availability': input = { masterId: 'master' }; break;
      case 'information': input = { catalogKey: 'test-catalog:1', targets: [scope(h.fixture)], locale: 'ru' }; break;
      case 'published_text': input = { catalogKey: 'test-catalog:1', textId: 'category:appliance', locale: 'ru' }; break;
      case 'chat_history': await offered(); await h.message(C); session = M; input = { chatId: 'chat:job:master' }; break;
      case 'history': await h.completed(); input = {}; break;
      case 'reputation': await h.completed(); input = { masterId: 'master' }; break;
      case 'contacts': input = { userId: 'client' }; break;
      case 'role_counts': session = A; input = {}; break;
      case 'repayment': await repayment(); session = M; input = { requestId: 'request' }; break;
      case 'payout': await h.completed('card'); session = M; input = { jobId: 'job' }; break;
      case 'inbox': await h.ok(A, { type: 'inbox', id: 'inbox', recipientId: 'client', original: 'Official information' }); input = {}; break;
      default: assert.fail(name);
    }
    input = { type: name, ...input };
  } else {
    if (name === 'login' || name === 'recover') {
      h.claims.set('claim', { id: 'claim', purpose: name === 'login' ? 'login' : 'recover', identity: { method: 'email', subject: 'matrix-identity' },
        ownerId: name === 'login' ? null : 'client', email: name === 'login' ? 'new@test.invalid' : 'client@test.invalid', phone: null, expiresAt: 1000 });
      args = ['claim', name === 'login' ? 'new-user' : 'client', 'matrix-operation', name === 'recover'];
    } else if (name === 'translateMessage') { await offered(); await h.message(C, 'Original 1200 THB', 'job', 'master', { id: 'source' }); session = M; args = [session, 'source', 'ru']; }
    else if (name === 'draftTranslation') { session = A; args = [A, 'Candidate 1200 THB', 'en', 'ru']; }
    else {
      await offered(); await h.ok(C, { type: 'preferences', preference: { userId: 'client', role: 'client', eventTypes: ['initial_offer_sent'], channels: ['test-channel'], soundRequested: false } });
      args = [A, h.repository.state.events.find(event => event.type === 'initial_offer_sent').id, 'client', 'test-channel', 'delivery']; session = A;
    }
  }
  const invoke = (core = h.core, value = input, activeSession = session) => kind === 'command' ? core.execute(activeSession, 'matrix-operation', value) :
    kind === 'query' ? query(h.repository, h.ports.auth, h.clock, activeSession, value) :
    name === 'login' || name === 'recover' ? core.authenticate(...args) : core[name](...args);
  const exports = [];
  for (const [port, method] of [['translation', 'detect'], ['translation', 'translate'], ['notifications', 'deliver']]) {
    const original = h.ports[port][method];
    h.ports[port][method] = async (...values) => { exports.push({ port, method, values: structuredClone(values) }); return original(...values); };
  }
  return { h, input, args, session, invoke, exports };
}

async function rejection(fixture, invoke = fixture.invoke) {
  const { h } = fixture, state = await h.repository.read(), receipts = structuredClone(h.repository.receipts);
  const result = await invoke(); assert.equal(result.ok, false); assert.equal(typeof result.error.code, 'string');
  assert.deepEqual(await h.repository.read(), state); assert.deepEqual(h.repository.receipts, receipts);
  assert.deepEqual(fixture.exports, [], 'Rejected preflight must not export text or deliver a notification');
}
async function positive(fixture, kind, name) {
  const { h } = fixture, state = await h.repository.read(), receipts = structuredClone(h.repository.receipts);
  const result = await fixture.invoke(); assert.equal(result.ok, true, result.ok ? '' : result.error.code);
  const saved = await h.repository.read();
  if (kind === 'query' || name === 'translateMessage' || name === 'draftTranslation') {
    assert.deepEqual(saved, state); assert.deepEqual(h.repository.receipts, receipts);
    if (kind === 'query') {
      const value = result.value; assert.equal(value.type, name);
      if (name === 'feed') { assert.equal(value.jobs.length, 1); assert.equal(value.jobs[0].cep, 1000n); }
      if (name === 'job') { assert.equal(value.job.state, 'published'); assert.equal(value.job.cep, 1000n); assert.equal(value.job.fap, null); }
      if (name === 'payment') { assert.equal(value.view.status, 'reserved'); assert.equal(value.view.remaining, 600); assert.equal(value.view.retryBlocked, false); }
      if (name === 'debt') { assert.equal(value.view.outstandingDebt, 300n); assert.equal(value.view.effectiveMasterDebtThreshold, 1000n); }
      if (name === 'cash_availability') assert.equal(value.mode, 'cash_and_noncash');
      if (name === 'information') { assert.ok(value.blocks.length > 0); assert.equal(new Set(value.blocks.map(block => block.id)).size, value.blocks.length); }
      if (name === 'published_text') assert.match(value.text, /^TEST ONLY ru:/);
      if (name === 'chat_history') { assert.equal(value.messages.length, 1); assert.equal(value.messages[0].original, 'hello'); }
      if (name === 'history') { assert.equal(value.jobs.length, 1); assert.equal(value.jobs[0].state, 'completed'); }
      if (name === 'reputation') assert.deepEqual(value.summary, { workQuality: null, reliability: null, reviewsCount: 0, experience: 1, reviews: [] });
      if (name === 'contacts') assert.equal(value.contacts.email, 'client@test.invalid');
      if (name === 'role_counts') { assert.equal(value.clientProfiles, 2); assert.equal(value.masterProfiles, 2); }
      if (name === 'repayment') { assert.equal(value.request.status, 'requested'); assert.equal(value.request.amount, 100n); }
      if (name === 'payout') { assert.equal(value.amount, 700n); assert.equal(value.state, 'ready'); assert.equal(value.settled, false); }
      if (name === 'inbox') { assert.equal(value.messages.length, 1); assert.equal(value.messages[0].original, 'Official information'); }
    }
    if (name === 'translateMessage') assert.equal(result.value.original, 'Original 1200 THB');
    if (name === 'draftTranslation') assert.equal(result.value.approved, false);
  } else if (kind === 'command') {
    assert.equal(result.value.events.at(-1).type, `operation:${name}`);
    assert.deepEqual(saved.events.slice(state.events.length), result.value.events);
    const value = result.value.outcome;
    if (value.kind === 'job') assert.deepEqual(saved.jobs[value.job.id], value.job);
    if (value.kind === 'user') assert.deepEqual(saved.users[value.user.id], value.user);
    if (value.kind === 'role') { assert.equal(value.principal.userId, 'client'); assert.equal(value.principal.role, fixture.input.role); }
    if (value.kind === 'offer') assert.deepEqual(saved.jobs[value.offer.jobId].offers[value.offer.masterId], value.offer);
    if (value.kind === 'catalog') assert.deepEqual(saved[value.catalog.status === 'published' ? 'published' : 'drafts'][`${value.catalog.id}:${value.catalog.version}`], value.catalog);
    if (value.kind === 'policy') assert.deepEqual(saved.policies.find(policy => policy.version === value.policy.version), value.policy);
    if (name === 'threshold') assert.deepEqual(value, { kind: 'threshold', masterId: fixture.input.masterId, amount: fixture.input.amount,
      effectiveMasterDebtThreshold: fixture.input.amount, currency: 'THB' });
    if (value.kind === 'payment') assert.deepEqual(value.view, paymentView(saved.jobs.job.reservation, h.clock.now()));
    if (value.kind === 'message') assert.deepEqual(saved.messages[value.message.id], value.message);
    if (value.kind === 'chat') assert.deepEqual(saved.threads[value.chat.id], value.chat);
    if (value.kind === 'repayment') assert.deepEqual(saved.repayments[value.request.id], value.request);
    if (value.kind === 'review') assert.deepEqual(saved.reviews[value.review.id], value.review);
    if (value.kind === 'payout') assert.deepEqual(saved.payouts[value.payout.jobId], value.payout);
    if (value.kind === 'settlement') assert.deepEqual(saved.obligations[value.obligation.id], value.obligation);
    if (value.kind === 'resolution') assert.deepEqual(saved.cases[value.resolution.id], value.resolution);
    if (value.kind === 'resolution_evidence') { assert.deepEqual(value.snapshot, saved.jobs.job.snapshot); assert.deepEqual(value.financial, saved.jobs.job.financial); assert.equal(value.funds, 'held'); }
    if (value.kind === 'retention') { assert.deepEqual(value.fact, saved.retention[fixture.input.factId]); assert.equal(value.assessment.eligibleForRetentionAction, false); }
    if (name === 'complete') { assert.equal(saved.jobs.job.state, 'completed'); assert.equal(saved.debt.master, 300n); assert.equal(saved.ledger['commission:job'].change, 300n); }
    if (name === 'receive_repayment') { assert.equal(saved.debt.master, 200n); assert.equal(saved.ledger.receipt.change, -100n); assert.equal(saved.receipts.receipt.amount, 100n); }
    if (['request_repayment', 'support', 'agree_repayment', 'close_repayment', 'close_support', 'review', 'hide_review'].includes(name)) {
      assert.deepEqual(saved.debt, state.debt); assert.deepEqual(saved.ledger, state.ledger);
    }
    if (name === 'decide_resolution') assert.deepEqual(saved.cases['case:request'].decision.allocation, { clientRefund: 850n, masterCompensation: 0n, helpyShare: 150n });
    if (name === 'preferences') assert.deepEqual(saved.preferences['client:client'], fixture.input.preference);
    if (name === 'inbox') assert.equal(saved.inbox.inbox.original, fixture.input.original);
    if (name === 'feedback') assert.equal(saved.feedback.feedback.original, fixture.input.original);
    if (name === 'hide_history') assert.deepEqual(saved.hiddenHistory['client:client'], ['job']);
  } else if (name === 'login' || name === 'recover') assert.equal(result.value.id, name === 'login' ? 'new-user' : 'client');
  else { assert.equal(result.value, 'delivered'); assert.equal(saved.deliveries.delivery.status, 'delivered'); }
}

for (const [kind, names] of [['command', commands], ['query', queries], ['method', methods]]) for (const name of names) {
  test(`OPERATION ${kind}/${name}: direct success, prerequisite, saved config, original basis, boundary, replay, identity, access and port outcomes`, async t => {
    await positive(await prepare(kind, name), kind, name);
    const missing = await prepare(kind, name);
    if (kind === 'command') await rejection(missing, () => missing.invoke(missing.h.core, { type: name }));
    else if (kind === 'query') await rejection(missing, () => missing.invoke(missing.h.core, missing.input, ''));
    else { if (name === 'login' || name === 'recover') missing.args[0] = 'unverified'; else missing.args[0] = ''; await rejection(missing); }
    for (const originalBasis of [false, true]) {
      const f = await prepare(kind, name);
      if (name === 'dispatchNotification') {
        if (originalBasis) { t.diagnostic('Original-basis config probe N/A: delivery uses the addressed immutable business event, not Admin policy. Event identity/rebinding is independently covered by R5-D03.'); continue; }
        f.h.repository.state.preferences['client:client'].userId = 'foreign';
      } else {
        const policy = f.h.repository.state.policies.find(value => value.version === 'matrix-policy');
        if (originalBasis) { policy.initialDuration *= 2; policy.initialAutoClose = false; } else policy.initialDuration = 0;
      }
      await rejection(f);
    }
    const boundary = await prepare(kind, name);
    if (kind === 'command') {
      const input = structuredClone(boundary.input);
      if (input.amount !== undefined) input.amount = -1n;
      else if (input.draft) input.draft.cep !== undefined ? input.draft.cep = 0n : input.draft.version = 0;
      else if (input.sequence !== undefined) input.sequence = 0;
      else if (input.policy) input.policy.initialDuration = 0;
      else if (input.confirmed !== undefined) input.confirmed = false;
      else if (input.role !== undefined) input.role = 'not-a-role';
      else if (input.locale !== undefined) input.locale = 'not-a-locale';
      else if (input.original !== undefined) input.original = '';
      else if (input.displayName !== undefined) input.displayName = '';
      else if (input.preference) input.preference.channels = ['unknown-channel'];
      else {
        const id = Object.keys(input).find(key => key.endsWith('Id') || key === 'id' || key === 'key' || key === 'proof' || key === 'oldCatalogKey');
        if (id) input[id] = ''; else input.type = 'invalid-boundary';
      }
      await rejection(boundary, () => boundary.invoke(boundary.h.core, input));
    } else if (kind === 'method') {
      if (name === 'login' || name === 'recover') boundary.h.clock.value = 1000;
      else boundary.args[boundary.args.length - 1] = '';
      await rejection(boundary);
    } else {
      const id = Object.keys(boundary.input).find(key => key.endsWith('Id') || key === 'catalogKey');
      if (id) await rejection(boundary, () => boundary.invoke(boundary.h.core, { ...boundary.input, [id]: '' }));
      else { const before = await boundary.h.repository.read(); assert.equal((await boundary.invoke()).ok, true); assert.deepEqual(await boundary.h.repository.read(), before); t.diagnostic('Query has no independent numeric/time/input limit; empty legitimate read is not a fabricated Failure. Domain limits/deadlines have separate normative witnesses.'); }
    }
    const repeated = await prepare(kind, name);
    let deliveries = 0;
    if (name === 'dispatchNotification') repeated.h.ports.notifications.deliver = async () => { deliveries++; return { ok: true, value: 'delivered' }; };
    const results = await Promise.all([repeated.invoke(), repeated.invoke()]);
    if (name === 'recover') assert.equal(results.filter(value => value.ok).length, 1); else assert.ok(results.every(value => value.ok));
    const after = await repeated.h.repository.read(), receipts = structuredClone(repeated.h.repository.receipts);
    const replay = await repeated.invoke(new DomainCore(repeated.h.ports));
    assert.equal(replay.ok, name !== 'recover'); assert.deepEqual(await repeated.h.repository.read(), after); assert.deepEqual(repeated.h.repository.receipts, receipts);
    if (name === 'dispatchNotification') assert.equal(deliveries, 1);
    const foreign = await prepare(kind, name);
    const reference = kind !== 'method' && Object.keys(foreign.input).find(key => ['jobId', 'chatId', 'caseId', 'obligationId', 'requestId', 'reviewId', 'userId', 'masterId', 'catalogKey', 'key', 'factId', 'oldCatalogKey'].includes(key));
    if (reference) await rejection(foreign, () => foreign.invoke(foreign.h.core, { ...foreign.input, [reference]: 'foreign-missing-identity' }));
    else if (kind === 'method' && ['translateMessage', 'dispatchNotification'].includes(name)) { foreign.args[1] = 'foreign-missing-identity'; await rejection(foreign); }
    else t.diagnostic('Foreign aggregate reference N/A for this create/global/read operation; current principal and replay-actor binding are still exercised, not replaced by a fictitious owner restriction.');
    for (const malformed of [false, true]) {
      const f = await prepare(kind, name);
      const method = name === 'login' || name === 'recover' ? 'verifyClaim' : 'authenticate';
      f.h.ports.auth[method] = async () => malformed ? { ok: 'unknown', value: null } : failure(method === 'verifyClaim' ? 'ContactUnverified' : 'Unauthorized');
      await rejection(f);
    }
  });
}

async function subjectBasis(f, kind, name) {
  const { h } = f, state = h.repository.state;
  const accountOrigin = async (id = 'client', role = 'client') => {
    await h.ok(`${id}:${role}`, { type: 'locale', locale: 'en' }); h.repository.state.users[id].email = 'unconfirmed@test.invalid';
  };
  const catalogOrigin = async () => {
    const draft = catalog({ approved: false, version: 3 });
    await h.ok(A, { type: 'save_catalog', draft, expectedSequence: null });
    await h.ok(A, { type: 'approve_content_set', key: 'test-catalog:3', sequence: 1,
      revisions: draft.texts.map(text => ({ textId: text.id, revision: text.revision })), confirmed: true });
    await h.ok(A, { type: 'publish_catalog', key: 'test-catalog:3', sequence: 2 });
  };
  // FakeRepository commits replace the state object, so retrieve it after setup.
  const saved = () => h.repository.state;
  const job = () => saved().jobs.job;
  const debtOrigin = async () => { await h.completed('cash', 'debt-origin'); saved().debt.master = 0n; };
  if (kind === 'command') switch (name) {
    case 'publish_policy': state.policies.find(policy => policy.version === 'matrix-policy').effectiveAt--; return 'InvalidReference';
    case 'threshold': await h.ok(A, { type: 'threshold', masterId: 'master', amount: 100n });
      saved().thresholds.master = 200n; saved().thresholdHistory.at(-1).amount = 200n; return 'InvalidReference';
    case 'save_catalog': await h.ok(A, f.input); saved().drafts['test-catalog:2'].categories[0].order++; return 'InvalidReference';
    case 'approve_text': case 'approve_content_set': case 'publish_catalog':
      saved().drafts[f.input.key].texts[0].editions.ru.text = 'Unconfirmed replacement'; return 'InvalidReference';
    case 'translation_correction': saved().corrections[compoundId(f.input.oldCatalogKey, f.input.textId)] = f.input.newCatalogKey; return 'InvalidReference';
    case 'profile': case 'activate': case 'switch_role': case 'locale': case 'bind_contact':
      await accountOrigin(); return 'InvalidReference';
    case 'new_job': await catalogOrigin(); saved().current = 'test-catalog:1'; return 'InvalidReference';
    case 'edit_draft': case 'publish_job': job().clientId = 'stranger'; return 'InvalidReference';
    case 'link_jobs': await h.ok(C, f.input); saved().jobs.job.linkedJobId = null; saved().jobs.linked.linkedJobId = null; return 'InvalidReference';
    case 'initial_offer': job().snapshot.cep++; return 'InvalidReference';
    case 'message': saved().threads[f.input.chatId].context.masterId = 'master2'; return 'InvalidReference';
    case 'revise_price': case 'approve_price': case 'final_application': case 'select_master': case 'terminate_negotiation':
      job().offers.master.initialPrice++; return 'InvalidReference';
    case 'publication_deadline': job().cycles.at(-1).countdown.duration++; job().cycles.at(-1).countdown.deadline++; return 'InvalidReference';
    case 'cash': case 'request_repayment': await debtOrigin(); return 'InvalidReference';
    case 'initiate_payment': job().financial.fap++; job().offers.master.final.amount++; return 'InvalidReference';
    case 'payment_outcome': job().reservation.operations[0].amount--; return 'ProviderConflict';
    case 'reservation_deadline': case 'decline_reservation': job().reservation.countdown.duration++; job().reservation.countdown.deadline++; return 'InvalidReference';
    case 'accept_work': case 'submit_result': case 'complete': job().funds = 'held'; return 'FundsMismatch';
    case 'cancel': job().funds = 'allocated'; return 'FundsMismatch';
    case 'cancellation_response': job().cancellation.financialConsent = true; return 'InvalidReference';
    case 'open_resolution': await h.ok(M, { type: 'submit_result', jobId: 'job', explanation: 'Original material', photoIds: [] });
      saved().jobs.job.evidence = []; return 'InvalidReference';
    case 'decide_resolution': job().cancellation.financialConsent = false; return 'InvalidReference';
    case 'inspect_resolution': saved().cases[f.input.caseId].evidence = ['unconfirmed']; return 'InvalidReference';
    case 'reminders': saved().threads['chat:job:master'].waitingFor = 'stranger'; return 'InvalidReference';
    case 'start_payout': saved().payouts.job.amount--; return 'InvalidReference';
    case 'payout_outcome': saved().payouts.job.attempts[0].status = 'failed'; return 'ProviderConflict';
    case 'start_settlement': saved().obligations[f.input.obligationId].amount--; return 'InvalidReference';
    case 'settlement_outcome': saved().obligations[f.input.obligationId].attempts[0].amount--; return 'ProviderConflict';
    case 'agree_repayment': case 'receive_repayment': case 'close_repayment': case 'support': saved().repayments.request.amount++; return 'InvalidRepayment';
    case 'close_support': saved().threads.support.context.basisId = 'unconfirmed'; return 'InvalidReference';
    case 'review': case 'hide_history': job().completedAt++; return 'InvalidReference';
    case 'hide_review': saved().reviews.review.comment = 'Unconfirmed replacement'; return 'InvalidReference';
    case 'preferences': {
      await h.ok(C, { type: 'preferences', preference: { ...f.input.preference, channels: [] } });
      const original = structuredClone(saved().events.at(-1));
      saved().preferences['client:client'].channels = ['unconfirmed'];
      return { original, type: 'replace-own-preference' };
    }
    case 'inbox': case 'feedback': await accountOrigin(); return 'InvalidReference';
    case 'evaluate_retention': saved().retention[f.input.factId].deadline++; saved().retentionOrigins[f.input.factId].deadline++; return 'RetentionBlocked';
    default: assert.fail(name);
  }
  if (kind === 'query') switch (name) {
    case 'feed': case 'job': job().snapshot.cep++; return 'InvalidReference';
    case 'payment': job().financial.fap++; job().offers.master.final.amount++; return 'InvalidReference';
    case 'debt': saved().debt.master = 0n; return 'InvalidReference';
    case 'cash_availability': await debtOrigin(); return 'InvalidReference';
    case 'information': case 'published_text': await catalogOrigin(); saved().published['test-catalog:1'].texts[0].editions.ru.text = 'Unconfirmed original'; return 'InvalidReference';
    case 'chat_history': saved().messages[saved().threads[f.input.chatId].messageIds[0]].original = 'Unconfirmed original'; return 'InvalidReference';
    case 'history': case 'reputation': delete saved().jobs.job; return 'InvalidReference';
    case 'contacts': await accountOrigin(); return 'InvalidReference';
    case 'role_counts': {
      h.claims.set('inactive', { id: 'inactive-claim', purpose: 'login', identity: { method: 'email', subject: 'inactive' }, email: 'inactive@test.invalid', phone: null, expiresAt: 1000, ownerId: null });
      assert.equal((await h.core.authenticate('inactive', 'inactive', 'inactive-login')).ok, true);
      saved().users.inactive.masterActive = true; return 'InvalidReference';
    }
    case 'repayment': saved().repayments.request.amount++; return 'InvalidRepayment';
    case 'payout': saved().payouts.job.amount--; return 'InvalidReference';
    case 'inbox': saved().inbox.inbox.original = 'Unconfirmed original'; return 'InvalidReference';
    default: assert.fail(name);
  }
  switch (name) {
    case 'login': {
      const identity = h.claims.get('claim').identity;
      saved().users.client.identities.push(identity); saved().users.stranger.identities.push(identity); return 'IdentityOccupied';
    }
    case 'recover': {
      h.claims.set('prior', { ...h.claims.get('claim'), id: 'prior-claim' });
      assert.equal((await h.core.authenticate('prior', 'client', 'prior-recovery', true)).ok, true);
      saved().users.client.email = 'unconfirmed@test.invalid'; h.claims.get('claim').email = 'unconfirmed@test.invalid'; return 'InvalidReference';
    }
    case 'translateMessage': saved().messages.source.original = 'Unconfirmed original'; return 'InvalidReference';
    case 'draftTranslation': saved().policies.find(policy => policy.version === 'matrix-policy').locales = ['en', 'th']; return 'InvalidReference';
    case 'dispatchNotification': saved().preferences['client:client'].soundRequested = true; return 'InvalidReference';
    default: assert.fail(name);
  }
}

for (const [kind, names] of [['command', commands], ['query', queries], ['method', methods]]) for (const name of names) {
  test(`SUBJECT ${kind}/${name}: persisted subject and original operands, not a generic configuration probe`, async () => {
    const f = await prepare(kind, name), expected = await subjectBasis(f, kind, name);
    const before = structuredClone(f.h.repository.state), receipts = structuredClone(f.h.repository.receipts);
    const result = await f.invoke();
    if (typeof expected === 'string') {
      assert.equal(result.ok, false); assert.equal(result.error.code, expected);
      assert.deepEqual(f.h.repository.state, before); assert.deepEqual(f.h.repository.receipts, receipts);
      assert.deepEqual(f.exports, []);
    } else {
      // An authorized setting replaces its own current projection; old immutable
      // settings are not prerequisites for choosing a new notification setting.
      assert.equal(result.ok, true);
      assert.deepEqual(f.h.repository.state.preferences['client:client'], f.input.preference);
      assert.deepEqual(f.h.repository.state.events[before.events.length - 1], expected.original);
      assert.deepEqual(f.h.repository.state.jobs, before.jobs); assert.deepEqual(f.h.repository.state.ledger, before.ledger);
    }
  });
}
