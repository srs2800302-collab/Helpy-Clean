// GENERATED from unchanged F2 operation preparation only; no test assertions are copied or weakened.
// Source SHA256: 7ad343e27ce5004b09ee9bf32e5076ad80bd6873ee6c32d716088979a660041a
import { harness } from './f2-harness.mjs';
import { catalog, scope } from './f2-fixtures.mjs';
import { query } from '../dist/application/queries.js';
import assert from 'node:assert/strict';
const A = 'admin', C = 'client:client', M = 'master:master';
const cancellation = { type: 'cancel', jobId: 'job', id: 'request', reason: 'Client request', explanation: 'Before arrival',
  evidence: [], confirmed: true, classification: 'ordinary', remainingWork: '' };
const decision = { id: 'decision', type: 'mutual', reason: 'Verified mutual cancellation before arrival', evidence: ['request'],
  facts: { arrived: false, partialWork: false, voluntaryRefusalProven: false, acceptanceReviewed: false, historyReviewed: true } };
export async function prepare(kind, name) {
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
