import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, admin } from './f2-harness.mjs';
import { catalog, policy, ratio, scope } from './f2-fixtures.mjs';
import { success } from '../dist/domain/core.js';
import { query } from '../dist/application/queries.js';
import { validateCatalog, validateScope } from '../dist/domain/catalog.js';

const read = (h, session, input) => query(h.repository, h.ports.auth, h.clock, session, input);
const cancel = (h, id = 'cancel', jobId = 'job') => h.ok('master:master', { type: 'cancel', jobId, id, reason: 'refusal', explanation: 'I cannot continue this order', remainingWork: '', classification: 'unclassified', confirmed: true, evidence: [] });
const facts = { arrived: false, partialWork: false, voluntaryRefusalProven: true, acceptanceReviewed: false, historyReviewed: false };

test('CORRECTION D01 provider proof binds direction, job, obligation, beneficiary and destination independently', async () => {
  const h = harness({ commission: ratio(0n) }); await h.completed('card');
  await h.ok('admin', { type: 'start_payout', jobId: 'job', attemptId: 'out' });
  const binding = structuredClone(h.repository.state.payouts.job.attempts[0].binding);
  for (const [key, wrong] of Object.entries({ kind: 'payment', jobId: 'another', obligationId: 'another', beneficiaryId: 'client', destinationId: 'another' })) {
    h.outcomes.set('forged', { operationId: 'out', amount: 1000n, currency: 'THB', status: 'success', binding: { ...binding, [key]: wrong } });
    await h.reject('admin', { type: 'payout_outcome', jobId: 'job', proof: 'forged' }, 'ProviderConflict');
  }
  h.ports.payments.verifyOutcome = async () => success({ operationId: 'out', amount: 1000n, currency: 'THB', status: 'success' });
  await h.reject('admin', { type: 'payout_outcome', jobId: 'job', proof: 'unbound' }, 'ProviderConflict');
  h.ports.payments.verifyOutcome = async () => success({ operationId: 'out', binding, amount: 1000n, currency: 'THB', status: 'success' });
  h.repository.failNextCommit = true;
  await h.reject('admin', { type: 'payout_outcome', jobId: 'job', proof: 'correct' }, 'Conflict');
  const results = await Promise.all([h.execute('admin', { type: 'payout_outcome', jobId: 'job', proof: 'correct' }), h.execute('admin', { type: 'payout_outcome', jobId: 'job', proof: 'correct' })]);
  assert.ok(results.every(result => result.ok)); assert.equal(h.repository.state.payouts.job.settled, true);
  assert.equal(h.repository.state.payouts.job.attempts.length, 1);
});

test('CORRECTION D01 incoming ID collision also rejected when persisted outgoing attempt is corrupt', async () => {
  const h = harness({ commission: ratio(0n) }); await h.completed('card'); await h.ok('admin', { type: 'start_payout', jobId: 'job', attemptId: 'out' });
  h.repository.state.payouts.job.attempts[0].id = 'payment:job';
  await h.reject('admin', { type: 'payout_outcome', jobId: 'job', proof: 'success:job' }, 'ProviderConflict');
});

test('CORRECTION D01/D17 concurrent duplicate payment callbacks emit one assignment and one status', async () => {
  const h = harness(); await h.reserved(); await h.ok('client:client', { type: 'initiate_payment', jobId: 'job', id: 'incoming', route: 'card' });
  h.outcomes.set('paid', { operationId: 'incoming', amount: 1000n, currency: 'THB', status: 'success' });
  const command = { type: 'payment_outcome', jobId: 'job', proof: 'paid' };
  assert.ok((await Promise.all([h.execute('admin', command), h.execute('admin', command), h.execute('admin', command)])).every(result => result.ok));
  assert.equal(h.repository.state.events.filter(event => event.type === 'master_assigned').length, 1);
  assert.equal(h.repository.state.events.filter(event => event.type === 'payment_status').length, 1);
});

for (const mutation of ['offer-job', 'chat-job', 'reservation-master', 'payout-master']) test(`CORRECTION D02 corrupt ${mutation} rejected by direct read and callbacks; unrelated order unaffected`, async () => {
  const h = harness(); await h.completed('card'); await h.ok('admin', { type: 'start_payout', jobId: 'job', attemptId: 'out' }); await h.assigned('cash', 'other');
  const state = h.repository.state;
  if (mutation === 'offer-job') state.jobs.job.offers.master.jobId = 'other';
  if (mutation === 'chat-job') state.threads['chat:job:master'].context.jobId = 'other';
  if (mutation === 'reservation-master') state.jobs.job.reservation.masterId = 'master2';
  if (mutation === 'payout-master') state.payouts.job.masterId = 'client';
  h.outcomes.set('paid', { operationId: 'out', amount: 700n, currency: 'THB', status: 'success' });
  await h.reject('admin', { type: 'payout_outcome', jobId: 'job', proof: 'paid' }, 'InvalidReference');
  assert.equal((await read(h, 'master:master', { type: 'job', jobId: 'job' })).ok, false);
  assert.equal((await read(h, 'master:master', { type: 'chat_history', chatId: 'chat:job:master' })).ok, false);
  assert.equal((await read(h, 'master:master', { type: 'job', jobId: 'other' })).ok, true);
});

test('CORRECTION D03/D08 foreign evidence rejected while actual master evidence remains usable', async () => {
  const h = harness(); await h.assigned('card'); await h.assigned('cash', 'other'); const message = await h.message('master:master', 'Foreign evidence', 'other'); await cancel(h);
  const decision = { id: 'decision', type: 'master_refusal', reason: 'Reviewed actual statement', evidence: [message.outcome.message.id], facts };
  await h.reject('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision }, 'EvidenceRequired');
  await h.ok('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: { ...decision, evidence: ['cancel'] } });
  const basis = h.repository.state.cases['case:cancel'].decision.basis;
  assert.equal(basis[0].jobId, 'job'); assert.equal(basis[0].actorId, 'master'); assert.equal(basis[0].kind, 'cancellation');
});

test('CORRECTION D03 inactivity case does not deadlock legitimate corrections, acceptance or normal completion', async () => {
  const h = harness(); await h.assigned('card'); await h.ok('client:client', { type: 'open_resolution', jobId: 'job', id: 'inactive', evidence: [] });
  await h.ok('master:master', { type: 'submit_result', jobId: 'job', explanation: 'Completed work', photoIds: [] });
  await h.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: false, explanation: 'Please correct' });
  await h.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' });
  await h.ok('master:master', { type: 'complete', jobId: 'job' });
  assert.equal(h.repository.state.cases.inactive.status, 'closed_by_master_completion'); assert.equal(h.repository.state.jobs.job.state, 'completed');
});

test('CORRECTION D03 exceptional completion needs actual acceptance and same-Admin history inspection', async () => {
  const h = harness(); await h.assigned('card'); await h.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' });
  await h.ok('client:client', { type: 'open_resolution', jobId: 'job', id: 'inactive', evidence: [] }); h.clock.value = h.repository.state.jobs.job.inactivityThreshold.deadline;
  const decision = { id: 'decision', type: 'exceptional_completion', reason: 'Acceptance and history reviewed', evidence: [h.repository.state.jobs.job.acceptanceOperationId], facts: { ...facts, voluntaryRefusalProven: false, acceptanceReviewed: true, historyReviewed: true } };
  await h.reject('admin', { type: 'decide_resolution', caseId: 'inactive', decision }, 'EvidenceRequired');
  const evidence = await h.reviewedCompletion('inactive');
  const original = h.ports.auth.authenticate;
  h.ports.auth.authenticate = async session => session === 'other-admin' ? success({ ...admin, userId: 'other-admin' }) : original(session);
  await h.reject('other-admin', { type: 'decide_resolution', caseId: 'inactive', decision: { ...decision, evidence } }, 'EvidenceRequired');
  await h.ok('admin', { type: 'decide_resolution', caseId: 'inactive', decision: { ...decision, evidence } });
  assert.equal(h.repository.state.cases.inactive.decision.basis.length, 2);
});

test('CORRECTION D03 inactivity review also permits a subsequent structured cancellation without inventing an outcome', async () => {
  const h = harness(); await h.assigned('card'); await h.ok('client:client', { type: 'open_resolution', jobId: 'job', id: 'inactive', evidence: [] });
  await cancel(h);
  assert.equal(h.repository.state.jobs.job.resolutionId, 'inactive'); assert.equal(h.repository.state.cases.inactive.requestId, 'cancel');
  assert.equal(h.repository.state.cases.inactive.status, 'admin_resolution_pending'); assert.equal(h.repository.state.jobs.job.funds, 'held');
  await h.reject('client:client', { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' }, 'ResolutionRequired');
});

test('CORRECTION D03 missing or null decision facts are typed rejections, not vacuously valid flags', async () => {
  const h = harness(); await h.assigned('card');
  await h.ok('client:client', { type: 'cancel', jobId: 'job', id: 'cancel', reason: 'Stop', explanation: 'Before arrival', remainingWork: '', classification: 'ordinary', evidence: [], confirmed: true });
  await h.ok('master:master', { type: 'cancellation_response', jobId: 'job', workStopped: true, financialConsent: true, explanation: '' });
  const decision = { id: 'mutual', type: 'mutual', reason: 'Both positions reviewed', evidence: ['cancel'], facts: {} };
  for (const missing of [{}, null, { arrived: false, partialWork: false }]) await h.reject('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: { ...decision, facts: missing } }, 'ResolutionRequired');
  await h.ok('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: { ...decision, facts: { ...facts, voluntaryRefusalProven: false } } });
  assert.equal(h.repository.state.cases['case:cancel'].decision.allocation.clientRefund, 850n);
});

test('CORRECTION D03 a same-second message invalidates the old exceptional history inspection', async () => {
  const h = harness(); await h.assigned('card'); await h.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' });
  await h.ok('client:client', { type: 'open_resolution', jobId: 'job', id: 'inactive', evidence: [] });
  const evidence = await h.reviewedCompletion('inactive');
  await h.message('master:master', 'New facts after the inspection, in the same clock second');
  h.clock.value = h.repository.state.jobs.job.inactivityThreshold.deadline;
  const decision = { id: 'exceptional', type: 'exceptional_completion', reason: 'Reviewed acceptance and history', evidence, facts: { ...facts, voluntaryRefusalProven: false, acceptanceReviewed: true, historyReviewed: true } };
  await h.reject('admin', { type: 'decide_resolution', caseId: 'inactive', decision }, 'EvidenceRequired');
  const current = await h.reviewedCompletion('inactive');
  await h.ok('admin', { type: 'decide_resolution', caseId: 'inactive', decision: { ...decision, evidence: current } });
  assert.equal(h.repository.state.cases.inactive.decision.type, 'exceptional_completion');
});

test('CORRECTION D03 case-bound support history is inspectable and invalidates an older review', async () => {
  const h = harness(); await h.assigned('card'); await h.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' });
  await h.ok('client:client', { type: 'open_resolution', jobId: 'job', id: 'inactive', evidence: [] });
  await h.ok('admin', { type: 'support', id: 'case-support', userId: 'master', userRole: 'master', basis: 'resolution', basisId: 'inactive' });
  const evidence = await h.reviewedCompletion('inactive');
  await h.ok('master:master', { type: 'message', id: 'support-evidence', chatId: 'case-support', original: 'Relevant case facts', photoIds: [], sender: 'user' });
  h.clock.value = h.repository.state.jobs.job.inactivityThreshold.deadline;
  const decision = { id: 'exceptional', type: 'exceptional_completion', reason: 'Reviewed all history', evidence, facts: { ...facts, voluntaryRefusalProven: false, acceptanceReviewed: true, historyReviewed: true } };
  await h.reject('admin', { type: 'decide_resolution', caseId: 'inactive', decision }, 'EvidenceRequired');
  const inspected = await h.ok('admin', { type: 'inspect_resolution', caseId: 'inactive' });
  assert.ok(inspected.outcome.messages.some(message => message.id === 'support-evidence'));
  const current = [h.repository.state.jobs.job.acceptanceOperationId, inspected.events.find(event => event.type === 'resolution_inspected').id];
  await h.ok('admin', { type: 'decide_resolution', caseId: 'inactive', decision: { ...decision, evidence: current } });
});

test('CORRECTION D03 accepted-state cancellation corruption cannot gain the exceptional-completion outcome', async () => {
  const h = harness(); await h.assigned('card'); await h.assigned('cash', 'cancelling');
  await h.ok('client:client', { type: 'cancel', jobId: 'cancelling', id: 'other-cancel', reason: 'Stop', explanation: 'Before acceptance', remainingWork: '', classification: 'ordinary', evidence: [], confirmed: true });
  await h.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' });
  await h.ok('client:client', { type: 'open_resolution', jobId: 'job', id: 'inactive', evidence: [] });
  const inconsistent = structuredClone(h.repository.state.jobs.cancelling.cancellation); inconsistent.id = 'corrupt-cancel';
  h.repository.state.jobs.job.cancellation = inconsistent; h.repository.state.cases.inactive.requestId = inconsistent.id;
  const evidence = await h.reviewedCompletion('inactive'); h.clock.value = h.repository.state.jobs.job.inactivityThreshold.deadline;
  await h.reject('admin', { type: 'decide_resolution', caseId: 'inactive', decision: { id: 'exceptional', type: 'exceptional_completion', reason: 'Reviewed history', evidence, facts: { ...facts, voluntaryRefusalProven: false, acceptanceReviewed: true, historyReviewed: true } } }, 'ResolutionRequired');
  assert.equal(h.repository.state.jobs.job.funds, 'held'); assert.deepEqual(h.repository.state.payouts, {});
});

test('CORRECTION D07/D22 scheduler-only escalation notifies Resolution admins, cannot choose outcome', async () => {
  const h = harness({ cancellationResponse: 60, cancellationReminder: 10 }); await h.assigned('card');
  const original = h.ports.auth.authenticate;
  h.ports.auth.authenticate = async session => session === 'scheduler' ? success({ userId: 'scheduler', role: 'admin', permissions: ['scheduler'] }) : original(session);
  const permissions = []; h.ports.directory.admins = async permission => { permissions.push(permission); return ['resolution-admin']; };
  await h.ok('client:client', { type: 'cancel', jobId: 'job', id: 'cancel', reason: 'Stop', explanation: 'Before arrival', remainingWork: '', evidence: [], classification: 'ordinary', confirmed: true });
  h.clock.value = 160; await h.ok('scheduler', { type: 'reminders', jobId: 'job' });
  assert.ok(permissions.every(permission => permission === 'resolution'));
  const notification = h.repository.state.events.find(event => event.type === 'resolution_opened');
  assert.deepEqual(notification.recipients, ['resolution-admin']); assert.equal(notification.recipientRoles['resolution-admin'], 'admin');
  await h.reject('scheduler', { type: 'decide_resolution', caseId: 'case:cancel', decision: { id: 'bad', type: 'mutual', reason: 'No authority', evidence: ['cancel'], facts } }, 'Unauthorized');
  assert.equal(h.repository.state.jobs.job.funds, 'held');
});

test('CORRECTION D13 role preferences route the same account independently, without changing feed', async () => {
  const h = harness(); h.repository.state.users.client.masterActive = true; h.repository.state.users.master.clientActive = true;
  for (const role of ['client', 'master']) await h.ok(`client:${role}`, { type: 'preferences', preference: { userId: 'client', eventTypes: role === 'client' ? ['initial_offer_sent'] : ['job_published'], channels: ['test-channel'], soundRequested: role === 'client' } });
  await h.published(); await h.offer();
  const event = h.repository.state.events.find(event => event.type === 'initial_offer_sent');
  assert.equal(event.recipientRoles.client, 'client');
  assert.equal((await h.core.dispatchNotification('admin', event.id, 'client', 'test-channel', 'client-delivery')).ok, true);
  assert.equal(h.repository.state.deliveries['client-delivery'].recipientRole, 'client');
  assert.equal((await read(h, 'client:master', { type: 'feed' })).value.jobs.length, 0);
});

test('CORRECTION D14/D23 authorization precedes photo lookup, detection, translation and directory', async () => {
  const h = harness(); await h.assigned(); const message = await h.message('client:client', 'Private');
  let calls = 0;
  h.ports.photos.lookup = h.ports.translation.detect = h.ports.translation.translate = h.ports.directory.admins = async () => { calls++; throw new Error('Must not be called'); };
  await h.reject('stranger:client', { type: 'message', id: 'forbidden', chatId: 'chat:job:master', original: 'Private unauthorized content', photoIds: ['photo'], sender: 'user' }, 'Unauthorized');
  assert.equal((await h.core.translateMessage('stranger:client', message.outcome.message.id, 'ru')).ok, false);
  await h.reject('stranger:client', { type: 'open_resolution', jobId: 'job', id: 'foreign', evidence: [] }, 'Unauthorized');
  await h.reject('client:client', { type: 'reminders', jobId: 'job' }, 'Unauthorized');
  await h.ok('client:client', { type: 'locale', locale: 'ru' });
  assert.equal(calls, 0);
});

test('CORRECTION D10 direct text respects role and job snapshot even after current entities are disabled', async () => {
  const h = harness(); await h.published('disposer-job', 'disposer', 'install_connect'); await h.offer('disposer-job');
  const request = { type: 'published_text', catalogKey: 'test-catalog:1', jobId: 'disposer-job', textId: 'rule-text:disposer', locale: 'ru' };
  assert.equal((await read(h, 'client:client', request)).error.code, 'Unauthorized');
  assert.equal((await read(h, 'stranger:client', { ...request, textId: 'rule-text:ownership' })).error.code, 'Unauthorized');
  const draft = catalog({ approved: false, version: 2 }); draft.categories.find(category => category.id === 'appliance').enabled = false;
  await h.ok('admin', { type: 'save_catalog', draft, expectedSequence: null });
  await h.ok('admin', { type: 'approve_content_set', key: 'test-catalog:2', sequence: 1, revisions: draft.texts.map(text => ({ textId: text.id, revision: text.revision })), confirmed: true });
  await h.ok('admin', { type: 'publish_catalog', key: 'test-catalog:2', sequence: 2 });
  assert.equal((await read(h, 'master:master', request)).ok, true);
  assert.equal((await read(h, 'master:master', { ...request, catalogKey: 'test-catalog:2' })).ok, false);
});

test('CORRECTION D02 foreign saved message cannot be read or inspected through another thread', async () => {
  const h = harness(); await h.assigned(); await h.assigned('cash', 'other');
  const message = await h.message('master:master', 'Other job content', 'other');
  await h.ok('client:client', { type: 'open_resolution', jobId: 'job', id: 'case', evidence: [] });
  h.repository.state.threads['chat:job:master'].messageIds.push(message.outcome.message.id);
  assert.equal((await read(h, 'client:client', { type: 'chat_history', chatId: 'chat:job:master' })).ok, false);
  await h.reject('admin', { type: 'inspect_resolution', caseId: 'case' }, 'InvalidReference');
});

test('CORRECTION D18 actual payment/payout retention has record anchors, saved policy and legal hold', async () => {
  const h = harness({ commission: ratio(0n) }); await h.completed('card');
  const keys = ['financial:payment:payment:job', 'financial:payout:payout:job'];
  const saved = structuredClone(h.repository.state.retention);
  await h.ok('admin', { type: 'publish_policy', policy: policy({ version: 'later', effectiveAt: 101, financialRetention: { value: 2, unit: 'years' } }) });
  for (const factId of keys) {
    await h.reject('client:client', { type: 'evaluate_retention', factId }, 'Unauthorized');
    const fact = saved[factId]; assert.ok(fact); assert.equal(fact.anchor, 100);
    h.clock.value = fact.deadline - 1; assert.equal((await h.ok('admin', { type: 'evaluate_retention', factId })).outcome.assessment.reason, 'before_deadline');
    h.clock.value = fact.deadline; assert.equal((await h.ok('admin', { type: 'evaluate_retention', factId })).outcome.assessment.eligibleForRetentionAction, true);
    h.ports.legalRetention.restrictions = () => success({ hold: true, notBefore: null });
    assert.equal((await h.ok('admin', { type: 'evaluate_retention', factId })).outcome.assessment.reason, 'legal_restriction');
    h.ports.legalRetention.restrictions = () => success({ hold: false, notBefore: null });
    assert.deepEqual(h.repository.state.retention[factId], fact);
  }
});

test('CORRECTION D18 missing completion anchor and tampered financial anchor cannot authorize retention', async () => {
  const h = harness(); await h.assigned('card'); await cancel(h);
  h.clock.value += 400 * 86400;
  assert.equal((await h.ok('admin', { type: 'evaluate_retention', factId: 'communication:job' })).outcome.assessment.reason, 'anchor_missing');
  h.repository.state.retention['financial:payment:payment:job'].anchor++;
  await h.reject('admin', { type: 'evaluate_retention', factId: 'financial:payment:payment:job' }, 'RetentionBlocked');
  assert.equal(h.repository.state.jobs.job.funds, 'held');
});

test('CORRECTION D18 recorded financial year cannot be replaced by an unrelated 90-day deadline', async () => {
  const h = harness(); await h.assigned('card');
  const record = h.repository.state.retention['financial:payment:payment:job'];
  record.deadline = record.anchor + 90 * 86400; h.clock.value = record.deadline;
  await h.reject('admin', { type: 'evaluate_retention', factId: 'financial:payment:payment:job' }, 'RetentionBlocked');
});

for (const variant of ['wrong-id', 'extra', 'duplicate']) test(`CORRECTION D19 ${variant} metadata rejected without photo/content effects`, async () => {
  const h = harness(); await h.assigned();
  const photo = { id: 'master-photo', ownerId: 'master', present: true, format: 'image/jpeg' };
  h.ports.photos.lookup = async () => success(variant === 'wrong-id' ? [{ ...photo, id: 'other' }] : variant === 'extra' ? [photo, { ...photo, id: 'extra' }] : [photo, photo]);
  await h.reject('master:master', { type: 'message', id: 'bad-photo', chatId: 'chat:job:master', original: 'Photo', photoIds: ['master-photo'], sender: 'user' }, 'InvalidPhoto');
});

test('CORRECTION D19 metadata batches are unique without inventing a cross-request photo-reuse ban', async () => {
  const h = harness(); const item = scope(h.fixture);
  item.photos['photo:location'] = [item.photos['photo:equipment'][0]];
  const lookup = h.ports.photos.lookup; let requested = [];
  h.ports.photos.lookup = async ids => { requested = [...ids]; return lookup(ids); };
  await h.published('shared-photo', 'washer', 'install_connect', [item]);
  assert.equal(new Set(requested).size, requested.length);
  assert.deepEqual(h.repository.state.jobs['shared-photo'].snapshot.items[0].photos, item.photos);
  const duplicateWithinRequest = structuredClone(item); duplicateWithinRequest.photos['photo:technical'] = ['same', 'same'];
  await h.ok('client:client', { type: 'new_job', id: 'duplicate-request', draft: { items: [duplicateWithinRequest], cep: 1000n, address: 'private' } });
  await h.reject('client:client', { type: 'publish_job', jobId: 'duplicate-request' }, 'InvalidReference');
});

test('CORRECTION D25 exact optional AC and kitchen fields, distinct shower branches and photo dependencies', () => {
  const c = catalog(); assert.equal(validateCatalog(c, true).ok, true);
  const validate = item => validateScope(c, [item], Object.values(item.photos).flat().map(id => ({ id, ownerId: 'client', present: true, format: 'image/jpeg' })), 'client');
  const air = scope(c, 'air-service', 'service'); assert.equal(validate(air).ok, true);
  air.answers['outdoor-access'] = true; air.photos['photo:outdoor'] = ['outdoor']; assert.equal(validate(air).ok, true);
  air.answers['outdoor-access'] = false; assert.equal(validate(air).ok, false);
  const kitchen = scope(c, 'kitchen', 'assemble'); assert.equal(validate(kitchen).ok, true);
  kitchen.photos['photo:supplier-specification'] = ['supplier']; kitchen.photos['photo:air-duct'] = ['duct']; assert.equal(validate(kitchen).ok, true);
  kitchen.photos['photo:supplier-specification'].push('second-supplier'); assert.equal(validate(kitchen).ok, false);
  for (const [action, question] of [['install_connect', 'hose-purchased'], ['replace', 'new-hose-needed']]) {
    const shower = scope(c, 'shower', action); assert.ok(question in shower.answers);
    for (const answer of [true, false]) { shower.answers[question] = answer; assert.equal(validate(shower).ok, true); }
    delete shower.answers[question]; assert.equal(validate(shower).ok, false);
  }
});
