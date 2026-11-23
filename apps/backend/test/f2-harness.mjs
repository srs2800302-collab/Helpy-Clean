import assert from 'node:assert/strict';
import { DomainCore } from '../dist/application/domain-core.js';
import { checked, failure, success } from '../dist/domain/core.js';
import { catalog, policy, scope } from './f2-fixtures.mjs';

export const admin = { userId: 'admin', role: 'admin', permissions: ['policy', 'catalog', 'content_approval', 'finance', 'support', 'scheduler', 'provider', 'resolution', 'reviews', 'accounts', 'negotiation', 'retention'] };
export class FakeRepository {
  constructor(state, receipts = new Map()) { this.state = structuredClone(state); this.receipts = receipts; this.queue = Promise.resolve(); this.failNextCommit = false; }
  async read() { return structuredClone(this.state); }
  replay(operationId, actorId, signature, access) {
    const run = this.queue.then(() => {
      const allowed = access(structuredClone(this.state)); if (!allowed.ok) return structuredClone(allowed);
      const old = this.receipts.get(operationId); if (!old) return null;
      return old.actorId === actorId && old.signature === signature ? structuredClone(old.result) : failure('Conflict');
    });
    this.queue = run.then(() => undefined, () => undefined); return run;
  }
  claimDelivery(id) {
    const run = this.queue.then(() => { const delivery = this.state.deliveries[id]; if (!delivery || delivery.status !== 'requested') return success(false); delivery.status = 'pending'; return success(true); });
    this.queue = run.then(() => undefined, () => undefined); return run;
  }
  transact(operationId, actorId, signature, replay, update, access) {
    const run = this.queue.then(() => {
      // Authorization is evaluated even when update would be bypassed by replay.
      if (access) { const allowed = access(structuredClone(this.state)); if (!allowed.ok) return structuredClone(allowed); }
      const old = this.receipts.get(operationId);
      if (old) return replay === 'return' && old.actorId === actorId && old.signature === signature ? structuredClone(old.result) : failure('Conflict');
      const next = structuredClone(this.state); const result = update(next);
      if (result.ok) {
        if (this.failNextCommit) { this.failNextCommit = false; return failure('Conflict', 'Injected atomic commit failure'); }
        this.state = structuredClone(next); this.receipts.set(operationId, { actorId, signature, result: structuredClone(result) });
      }
      return structuredClone(result);
    });
    this.queue = run.then(() => undefined, () => undefined); return run;
  }
}
export function user(id, role, categoryIds = ['appliance']) {
  return { id, createdAt: 0, identities: [], email: `${id}@test.invalid`, phone: role === 'master' ? '+66000' + id : null, displayName: id, photoId: role === 'master' ? `photo:${id}` : null,
    locale: 'en', clientActive: role === 'client', masterActive: role === 'master', specialization: { categoryIds, entityIds: [] }, contacts: {} };
}
export function harness(changes = {}) {
  const fixture = catalog(); const config = policy({ providerConfirmation: 900, ...changes });
  const state = { users: { client: user('client', 'client'), master: user('master', 'master'), master2: user('master2', 'master'), stranger: user('stranger', 'client') },
    consumedClaims: {}, drafts: {}, published: { 'test-catalog:1': fixture }, current: 'test-catalog:1', policies: [config], jobs: {}, refusalStreak: {}, refusals: {},
    threads: {}, messages: {}, debt: {}, thresholds: {}, ledger: {}, payouts: {}, repayments: {}, receipts: {}, cases: {}, obligations: {}, reviews: {}, hiddenHistory: {}, events: [], preferences: {}, deliveries: {}, inbox: {}, feedback: {}, retention: {}, retentionOrigins: {}, corrections: {}, thresholdHistory: [] };
  const repository = new FakeRepository(state); const claims = new Map(), outcomes = new Map(), instructions = new Map(), photoMetadata = new Map();
  const clock = { value: 100, now() { return this.value; }, add(anchor, period) {
    if (period.unit === 'seconds') return anchor + period.value;
    if (period.unit === 'days') return anchor + period.value * 86400;
    const date = new Date(anchor * 1000); date.setUTCFullYear(date.getUTCFullYear() + period.value); return date.getTime() / 1000;
  } };
  let translatorFails = false, translationCalls = 0;
  const ports = { repository, clock,
    auth: { async authenticate(session) { if (session === 'admin') return success(admin); const [id, role] = session.split(':'); return repository.state.users[id] && ['client', 'master'].includes(role) ? success({ userId: id, role, permissions: [] }) : failure('Unauthorized'); }, async verifyClaim(proof) { return claims.has(proof) ? success(claims.get(proof)) : failure('ContactUnverified'); } },
    photos: { async lookup(ids) { return success(ids.map(id => photoMetadata.get(id) ?? ({ id, present: !id.startsWith('missing'),
      ownerId: id.startsWith('master') || id === 'photo:master' ? 'master' : id === 'photo:master2' ? 'master2' : 'client', format: 'image/jpeg' }))); } },
    translation: { async translate(original, source, target) { translationCalls++; return translatorFails ? failure('TranslationUnavailable') : success(`${target}:${original}`); }, async detect(original) { return success({ language: original.startsWith('RU:') ? 'ru' : 'en', reliable: !original.startsWith('?') }); } },
    // Deliberately synthetic classification, not a production recognizer.
    textSafety: { async inspect({ text, purpose }) {
      const rejected = /\[CONTACT\]|\[ADDRESS\]|\[IDENTITY\]|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i.test(text);
      return success({ text, purpose, status: rejected ? 'rejected' : 'allowed', reason: rejected ? 'contact' : null });
    } },
    payments: { async incomingRoute(route) { return success({ route, status: 'supported' }); }, async verifyOutcome(proof) {
      const value = outcomes.get(proof); if (!value) return failure('ProviderConflict');
      const instruction = instructions.get(value.operationId); if (!instruction) return failure('ProviderConflict');
      return success({ binding: structuredClone(instruction.binding), ...value });
    }, async payoutDestination(masterId) { return success({ id: 'bank', masterId, route: 'bank_transfer', verified: true, available: true }); },
      async settlementDestination(obligation) { return success({ id: 'original-route', beneficiaryId: obligation.beneficiaryId, route: 'bank_transfer', verified: true, available: true, sourcePaymentId: obligation.sourcePaymentId }); } },
    notifications: { supportedChannels: ['test-channel'], async deliver() { return success('delivered'); } },
    directory: { async admins() { return ['admin']; } }, supportAttachments: { photosAllowed() { return false; } },
    legalRetention: { validate() { return success(undefined); }, restrictions() { return success({ hold: false, notBefore: null }); } },
  };
  let sequence = 0; const core = new DomainCore(ports);
  const execute = async (session, command, id = `op${++sequence}`) => {
    const result = await core.execute(session, id, command);
    if (result.ok) {
      // Provider metadata is independent of later repository corruption.
      const operations = [...Object.values(repository.state.jobs).flatMap(job => job.reservation?.operations ?? []),
        ...Object.values(repository.state.payouts).flatMap(payout => payout.attempts), ...Object.values(repository.state.obligations).flatMap(obligation => obligation.attempts)];
      for (const operation of operations) if (!instructions.has(operation.id)) instructions.set(operation.id, structuredClone(operation));
    }
    return result;
  };
  const ok = async (session, command, id) => { const result = await execute(session, command, id); assert.equal(result.ok, true, JSON.stringify(result, (_, value) => typeof value === 'bigint' ? `${value}n` : value)); return result.value; };
  const reject = async (session, command, code, id) => {
    const before = await repository.read(); const result = structuredClone(await execute(session, command, id));
    assert.equal(result.ok, false); assert.equal(result.error.code, code); assert.deepEqual(await repository.read(), before, 'Rejected command must roll back all facts');
    const input = JSON.stringify(command, (key, value) => /proof|token|otp/i.test(key) ? '[proof redacted]' : typeof value === 'bigint' ? `${value}n` : typeof value === 'number' && !Number.isFinite(value) ? String(value) : value);
    Object.defineProperty(result, 'rollbackVerified', { value: { command: command.type, subjectId: command.jobId ?? command.chatId ?? command.caseId ?? command.obligationId ?? command.id ?? null, input, unchanged: true } });
    return result;
  };
  async function published(id = 'job', entity = 'washer', action = 'install_connect', items = null) {
    const draft = { items: items ?? [scope(fixture, entity, action)], cep: 1000n, publicAddress: 'PUBLIC DISTRICT STREET', address: 'PRIVATE EXACT ADDRESS' };
    await ok('client:client', { type: 'new_job', id, draft }); await ok('client:client', { type: 'publish_job', jobId: id }); return repository.state.jobs[id];
  }
  async function offer(jobId = 'job', masterId = 'master') { return ok(`${masterId}:master`, { type: 'initial_offer', jobId, id: `offer:${jobId}:${masterId}`, chatId: `chat:${jobId}:${masterId}` }); }
  async function message(session, original = 'hello', jobId = 'job', masterId = 'master', extra = {}) { return ok(session, { type: 'message', id: `msg${++sequence}`, chatId: `chat:${jobId}:${masterId}`, original, photoIds: [], sender: 'user', ...extra }); }
  async function bilateral(jobId = 'job', masterId = 'master') { await message('client:client', 'RU:hello', jobId, masterId); await message(`${masterId}:master`, 'hello', jobId, masterId); }
  async function reserved(jobId = 'job', masterId = 'master') {
    if (!repository.state.jobs[jobId]) await published(jobId); if (!repository.state.jobs[jobId].offers[masterId]) await offer(jobId, masterId);
    const amount = repository.state.jobs[jobId].offers[masterId].revised?.amount ?? repository.state.jobs[jobId].offers[masterId].initialPrice;
    await ok(`${masterId}:master`, { type: 'final_application', jobId, masterId, confirmed: true, amount, recipientId: 'client' });
    await ok('client:client', { type: 'select_master', jobId, masterId, confirmed: true, amount }); return repository.state.jobs[jobId];
  }
  async function assigned(method = 'cash', jobId = 'job') {
    await reserved(jobId);
    if (method === 'cash') await ok('client:client', { type: 'cash', jobId });
    else { await ok('client:client', { type: 'initiate_payment', jobId, id: `payment:${jobId}`, route: 'card' }); outcomes.set(`success:${jobId}`, { operationId: `payment:${jobId}`, amount: repository.state.jobs[jobId].financial.fap, currency: 'THB', status: 'success' }); await ok('admin', { type: 'payment_outcome', jobId, proof: `success:${jobId}` }); }
    return repository.state.jobs[jobId];
  }
  async function completed(method = 'cash', jobId = 'job') { await assigned(method, jobId); await ok('client:client', { type: 'accept_work', jobId, accepted: true, explanation: '' }); await ok('master:master', { type: 'complete', jobId }); return repository.state.jobs[jobId]; }
  async function reviewedCompletion(caseId) {
    const inspection = await ok('admin', { type: 'inspect_resolution', caseId });
    const job = repository.state.jobs[inspection.outcome.resolution.jobId];
    return [job.acceptanceOperationId, inspection.events.find(event => event.type === 'resolution_inspected').id];
  }
  return { core, ports, repository, clock, claims, outcomes, photoMetadata, fixture, config, execute, ok, reject, published, offer, message, bilateral, reserved, assigned, completed, reviewedCompletion,
    setTranslatorFailure(value) { translatorFails = value; }, get translationCalls() { return translationCalls; }, checked };
}
