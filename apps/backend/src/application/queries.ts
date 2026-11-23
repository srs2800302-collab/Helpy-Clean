import { authorize, checked, own, requireThat } from '../domain/core.js';
import type { Clock, Principal, Result } from '../domain/core.js';
import { accountById, accountList, requireActive, privateContacts } from '../domain/accounts.js';
import { information, publishedText } from '../domain/catalog.js';
import type { RouteTarget, ScopeItem } from '../domain/catalog.js';
import { paymentView, repaymentView, transferView } from '../domain/finance.js';
import { debtView } from './invariants.js';
import type { TransferView } from '../domain/finance.js';
import { address, feed } from '../domain/marketplace.js';
import type { Job } from '../domain/marketplace.js';
import { history, participant } from '../domain/messaging.js';
import type { ChatMessage } from '../domain/messaging.js';
import { effectivePolicy } from '../domain/policy.js';
import { orderHistory, reputation } from '../domain/reputation.js';
import type { AtomicRepository, AuthenticationPort, CoreState } from './ports.js';
import * as Integrity from './invariants.js';
import * as Validate from './validation.js';
import { sameFact, snapshotFact } from '../domain/provenance.js';

export type Query = { type: 'feed' } | { type: 'job'; jobId: string } | { type: 'payment'; jobId: string } |
  { type: 'debt'; masterId: string } | { type: 'cash_availability'; masterId: string } |
  { type: 'information'; catalogKey: string; targets: readonly RouteTarget[]; locale: string; jobId?: string } |
  { type: 'published_text'; catalogKey: string; textId: string; locale: string; corrected?: boolean; jobId?: string } |
  { type: 'chat_history'; chatId: string } | { type: 'history' } | { type: 'reputation'; masterId: string } |
  { type: 'contacts'; userId: string } | { type: 'role_counts' } | { type: 'repayment'; requestId: string } |
  { type: 'payout'; jobId: string } | { type: 'inbox' };
export interface JobView {
  readonly id: string; readonly state: Job['state']; readonly items: readonly ScopeItem[]; readonly cep: bigint;
  readonly fap: bigint | null; readonly publicAddress: string; readonly address: string | null; readonly chatId: string | null;
  readonly completedAt: number | null; readonly acceptedAt: number | null;
}
export type QueryValue = { type: 'feed'; jobs: ReturnType<typeof feed> } | { type: 'job'; job: JobView } |
  { type: 'payment'; view: ReturnType<typeof paymentView> } | { type: 'debt'; view: ReturnType<typeof debtView> } |
  { type: 'cash_availability'; mode: 'cash_and_noncash' | 'noncash_only' } |
  { type: 'information'; blocks: ReturnType<typeof information> } | { type: 'published_text'; text: string } |
  { type: 'chat_history'; messages: readonly ChatMessage[] } | { type: 'history'; jobs: readonly JobView[] } |
  { type: 'reputation'; summary: ReturnType<typeof reputation> } | { type: 'contacts'; contacts: ReturnType<typeof privateContacts> } |
  { type: 'role_counts'; clientProfiles: number; masterProfiles: number } |
  { type: 'repayment'; request: ReturnType<typeof repaymentView> } |
  ({ type: 'payout'; amount: bigint; settled: boolean } & TransferView) |
  { type: 'inbox'; messages: readonly CoreState['inbox'][string][] };
function view(job: Job, actor: Principal): JobView {
  requireThat(job.snapshot, 'InvalidTransition');
  const ownClient = actor.userId === job.clientId && actor.role === 'client';
  const assignedMaster = actor.userId === job.selectedMasterId && actor.role === 'master' && ['assigned', 'working', 'client_accepted', 'completed'].includes(job.state);
  return { id: job.id, state: job.state, items: job.snapshot.items, cep: job.snapshot.cep, fap: job.financial?.fap ?? null,
    publicAddress: job.snapshot.publicAddress, address: ownClient || assignedMaster ? address(job, actor) : null,
    chatId: ownClient || actor.userId === job.selectedMasterId ? job.chatId : own(job.offers, actor.userId)?.chatId ?? null,
    completedAt: job.completedAt, acceptedAt: job.acceptedAt };
}
export async function query(repository: AtomicRepository, auth: AuthenticationPort, clock: Clock, session: string, input: Query): Promise<Result<QueryValue>> {
  clock = Validate.guardedClock(clock);
  const sessionShape = checked(() => { Validate.text('Unauthorized')(session); Validate.query(input); }); if (!sessionShape.ok) return sessionShape;
  input = snapshotFact(input);
  const authenticated = await Validate.callPort(() => auth.authenticate(session), Validate.principal, 'Unauthorized'); if (!authenticated.ok) return authenticated;
  const loaded = await Validate.readRepository(repository); if (!loaded.ok) return loaded; const initial = loaded.value;
  const preflight = checked(() => {
    if (authenticated.value.role !== 'admin') { requireActive(own(initial.users, authenticated.value.userId), authenticated.value, authenticated.value.role); accountById(initial, authenticated.value.userId); }
  });
  if (!preflight.ok) return preflight;
  const current = await Validate.callPort(() => auth.authenticate(session), Validate.principal, 'Unauthorized'); if (!current.ok) return current;
  const refreshed = await Validate.readRepository(repository); if (!refreshed.ok) return refreshed; const state = refreshed.value;
  const identity = checked(() => requireThat(current.value.userId === authenticated.value.userId && current.value.role === authenticated.value.role, 'Unauthorized'));
  if (!identity.ok) return identity; const actor = current.value;
  return checked(() => {
    Validate.query(input);
    requireThat(input && typeof input.type === 'string' && ['client', 'master', 'admin'].includes(actor.role), 'InvalidTransition');
    if (actor.role !== 'admin') { requireActive(own(state.users, actor.userId), actor, actor.role); accountById(state, actor.userId); }
    const policy = effectivePolicy(state.policies, clock.now(), state.events);
    const availableFeed = () => {
      for (const job of Object.values(state.jobs)) Validate.job(job);
      return feed(state, actor.userId, own(state.users, actor.userId)!.specialization, clock.now());
    };
    const jobForParticipant = (id: string) => {
      const job = Integrity.jobById(state, id);
      if (actor.role === 'admin') authorize(actor, 'resolution');
      else requireThat(actor.role === 'client' && actor.userId === job.clientId || actor.role === 'master' && (own(job.offers, actor.userId) ||
        job.state === 'published' && availableFeed().some(item => item.id === id)), 'Unauthorized');
      return job;
    };
    switch (input.type) {
      case 'feed': {
        requireThat(actor.role === 'master', 'Unauthorized');
        const jobs = availableFeed();
        for (const job of jobs) Integrity.jobById(state, job.id);
        return { type: 'feed', jobs };
      }
      case 'job': return { type: 'job', job: view(jobForParticipant(input.jobId), actor) };
      case 'payment': { const job = jobForParticipant(input.jobId); requireThat(actor.userId === job.clientId && job.reservation, 'Unauthorized'); return { type: 'payment', view: paymentView(job.reservation, clock.now()) }; }
      case 'debt': if (actor.role === 'admin') authorize(actor, 'finance'); else requireThat(actor.userId === input.masterId && actor.role === 'master', 'Unauthorized');
        requireThat(own(state.users, input.masterId)?.masterActive === true, 'NotFound'); accountById(state, input.masterId); return { type: 'debt', view: debtView(state, input.masterId, policy) };
      case 'cash_availability': requireThat(actor.role === 'client' && own(state.users, input.masterId)?.masterActive === true, 'Unauthorized'); accountById(state, input.masterId); return { type: 'cash_availability', mode: debtView(state, input.masterId, policy).mode };
       case 'information': {
         const job = input.jobId ? jobForParticipant(input.jobId) : null;
         requireThat(!job || job.snapshot?.catalogKey === input.catalogKey, 'InvalidReference');
          const catalog = Integrity.catalogByKey(state, input.catalogKey, 'published');
         return { type: 'information', blocks: information(catalog, job?.snapshot?.items ?? input.targets, actor.role, input.locale) };
       }
      case 'published_text': {
        // A translation is a presentation of the original obligation, not a new
        // authority for its visibility, version or contextual ownership.
        const original = Integrity.catalogByKey(state, input.catalogKey, 'published');
        const blocks = original.blocks.filter(block => block.textId === input.textId);
        if (blocks.length) requireThat(actor.role === 'admin' ? actor.permissions.includes('content_approval') : blocks.some(block => block.enabled && block.roles.includes(actor.role as 'client' | 'master')), 'Unauthorized');
        if (input.jobId) {
          const job = jobForParticipant(input.jobId); requireThat(job.snapshot?.catalogKey === input.catalogKey, 'InvalidReference');
          if (blocks.length) {
            const applicable = actor.role === 'admin' ? job.snapshot.rules : information(original, job.snapshot.items, actor.role, input.locale);
            requireThat(blocks.some(block => applicable.some(rule => rule.id === block.id && rule.revision === block.revision) &&
              job.snapshot!.rules.some(rule => rule.id === block.id && rule.revision === block.revision)), 'InvalidReference');
          }
        }
        const key = input.corrected ? Integrity.correctionKey(state, input.catalogKey, input.textId) : input.catalogKey;
        const catalog = Integrity.catalogByKey(state, key, 'published'); requireThat(original.texts.some(text => text.id === input.textId &&
          catalog.texts.some(corrected => corrected.id === text.id && corrected.meaning === text.meaning)), 'InvalidReference');
        return { type: 'published_text', text: publishedText(catalog, input.textId, input.locale) }; }
      case 'chat_history': { const thread = Integrity.threadById(state, input.chatId); participant(thread, actor); return { type: 'chat_history', messages: history(state, thread, actor, state.events) }; }
      case 'history': {
        const jobs = Integrity.completedJobs(state, (clientId, masterId) => actor.role === 'client' ? clientId === actor.userId : masterId === actor.userId);
        return { type: 'history', jobs: orderHistory(state, jobs, actor, policy.historyLimit, state.events).map(job => view(jobForParticipant(job.id), actor)) };
      }
      case 'reputation': {
        requireThat(own(state.users, input.masterId)?.masterActive === true, 'NotFound');
        accountById(state, input.masterId);
        // Forbidden self-orders stay excluded without discarding lawful experience.
        const selfJobs = new Set(Object.values(state.jobs).filter(job => { Validate.repositoryRecord(job); return job.clientId === job.selectedMasterId; }).map(job => job.id));
        const reviewIds = new Set([...Object.values(state.reviews).filter(review => { Validate.repositoryRecord(review);
          return review.masterId === input.masterId && !selfJobs.has(review.jobId); }).map(review => review.id),
          ...state.events.flatMap(record => record.proof?.kind === 'review' && record.proof.review.masterId === input.masterId &&
            !selfJobs.has(record.proof.review.jobId) ? [record.proof.review.id] : [])]);
        for (const id of reviewIds) Integrity.reviewById(state, id);
        return { type: 'reputation', summary: reputation(state, Integrity.completedJobs(state, (_, masterId) => masterId === input.masterId), input.masterId) };
      }
      case 'contacts': return { type: 'contacts', contacts: privateContacts(accountById(state, input.userId), actor) };
      case 'role_counts': { authorize(actor, 'accounts'); const users = accountList(state);
        return { type: 'role_counts', clientProfiles: users.filter(user => user.clientActive === true).length, masterProfiles: users.filter(user => user.masterActive === true).length }; }
      case 'repayment': { const request = Integrity.repaymentById(state, input.requestId); return { type: 'repayment', request: repaymentView(request, actor) }; }
      case 'payout': {
        const job = jobForParticipant(input.jobId); const payout = own(state.payouts, job.id); requireThat(payout && (actor.role === 'admin' || actor.role === 'master' && actor.userId === job.selectedMasterId), 'Unauthorized');
        return { type: 'payout', amount: payout.amount, settled: payout.settled, ...transferView(payout) };
      }
      case 'inbox': {
        const sources = state.events.filter(record => record.type === 'operation:inbox');
        for (const source of sources) requireThat(source.actorRole === 'admin' && source.proof?.kind === 'inbox', 'InvalidReference');
        const originals = sources.flatMap(source => source.proof?.kind === 'inbox' && source.proof.message.recipientId === actor.userId ? [source] : []);
        const saved = Object.entries(state.inbox).filter(([, message]) => { Validate.repositoryRecord(message); return message.recipientId === actor.userId; });
        requireThat(saved.length === originals.length && new Set(originals.map(source => source.proof?.kind === 'inbox' ? source.proof.message.id : null)).size === originals.length, 'InvalidReference');
        const messages = originals.map(source => {
          requireThat(source.proof?.kind === 'inbox', 'InvalidReference'); const message = source.proof.message;
          requireThat(message.at === source.at && sameFact(own(state.inbox, message.id), message) && state.events.filter(record =>
            record.type === 'inbox_message' && record.operationId === source.operationId && record.subjectId === message.id && record.at === source.at &&
            record.actorId === source.actorId && record.actorRole === 'admin' && sameFact(record.recipients, [message.recipientId])).length === 1, 'InvalidReference');
          return message;
        });
        return { type: 'inbox', messages };
      }
      default: requireThat(false, 'InvalidTransition', 'Unsupported query');
    }
  });
}
