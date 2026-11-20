import { authorize, identifier, immutable, own, owner, put, requireDifferentJobParties, requireThat, timer } from './core.js';
import type { DomainEvent, Principal, Timer, TransactionContext } from './core.js';
import { event } from './core.js';
import type { CatalogRevision, ScopeItem } from './catalog.js';
import type { Specialization } from './accounts.js';
import { matches } from './accounts.js';
import type { ChatState, ChatThread } from './messaging.js';
import { createJobChat } from './messaging.js';
import type { FinancialSnapshot, PaymentReservation } from './finance.js';
import { financialSnapshot } from './finance.js';
import type { Policy } from './policy.js';
import { sameFact } from './provenance.js';

export interface JobScopeSnapshot { readonly catalogKey: string; readonly items: readonly ScopeItem[]; readonly rules: readonly { id: string; revision: number }[]; readonly cep: bigint; readonly address: string; readonly photoIds: readonly string[] }
export interface PublicationCycle { readonly index: number; readonly publishedAt: number; readonly countdown: Timer | null; hadBilateral: boolean; endedAt: number | null }
export interface PriceProposal { readonly amount: bigint; readonly reason: string; readonly requestedAt: number; approvedAt: number | null; rejectedAt: number | null }
export interface Offer { readonly id: string; readonly jobId: string; readonly masterId: string; readonly chatId: string; readonly catalogKey: string; readonly initialPrice: bigint; readonly initialAt: number; state: 'open' | 'selected' | 'closed'; revised: PriceProposal | null; final: { readonly amount: bigint; readonly sentAt: number } | null; closedReason: string | null }
export interface CancellationResponse {
  readonly id: string; readonly actorId: string; readonly at: number; readonly explanation: string;
  readonly remainingWork: string; readonly evidence: readonly string[];
}
export interface CancellationRequest { readonly id: string; readonly initiator: string; readonly reason: string; readonly explanation: string; readonly remainingWork: string; readonly classification: 'ordinary' | 'unclassified' | 'false_call' | 'partial'; readonly evidence: readonly string[]; readonly requestedAt: number; readonly responseTimer: Timer; reminder: Timer; workStopped: boolean | null; financialConsent: boolean | null; responseExplanation: string | null; response: CancellationResponse | null }
export interface Job {
  readonly id: string; readonly clientId: string; draft: { items: readonly ScopeItem[]; cep: bigint; address: string } | null;
  snapshot: JobScopeSnapshot | null; state: 'draft' | 'published' | 'reserved' | 'assigned' | 'working' | 'client_accepted' | 'completed' | 'expired' | 'cancelled';
  cycles: PublicationCycle[]; offers: Record<string, Offer>; excludedMasters: string[]; selectedMasterId: string | null; chatId: string | null;
  financial: FinancialSnapshot | null; reservation: PaymentReservation | null; funds: 'none' | 'held' | 'releasable' | 'allocated';
  acceptedAt: number | null; acceptanceOperationId: string | null; completedAt: number | null;
  lastActivityAt: number | null; inactivityReminder: Timer | null; inactivityThreshold: Timer | null;
  cancellation: CancellationRequest | null; resolutionId: string | null; linkedJobId: string | null;
  evidence: { readonly id: string; readonly actorId: string; readonly at: number; readonly explanation: string; readonly photoIds: readonly string[] }[];
}
export interface RefusalRecord { readonly id: string; readonly masterId: string; readonly jobId: string; readonly offerId: string | null; readonly resolutionId: string | null; readonly at: number; readonly operationId: string }
export interface MarketplaceState { jobs: Record<string, Job>; refusalStreak: Record<string, number>; refusals: Record<string, RefusalRecord> }
export function newJob(state: MarketplaceState, actor: Principal, id: string, input: NonNullable<Job['draft']>): Job {
  requireThat(actor.role === 'client', 'Unauthorized'); identifier(id); requireThat(!own(state.jobs, id) && typeof input.cep === 'bigint' && input.cep > 0n && input.address.trim(), 'InvalidScope');
  const job: Job = { id, clientId: actor.userId, draft: input, snapshot: null, state: 'draft', cycles: [], offers: {}, excludedMasters: [],
    selectedMasterId: null, chatId: null, financial: null, reservation: null, funds: 'none', acceptedAt: null, acceptanceOperationId: null,
    completedAt: null, lastActivityAt: null, inactivityReminder: null, inactivityThreshold: null, cancellation: null, resolutionId: null, linkedJobId: null, evidence: [] };
  put(state.jobs, id, job); return job;
}
export function editDraft(job: Job, actor: Principal, draft: NonNullable<Job['draft']>): void {
  owner(actor, job.clientId, 'client'); requireThat(job.state === 'draft', 'PublishedSnapshotImmutable');
  requireThat(typeof draft.cep === 'bigint' && draft.cep > 0n && draft.address.trim(), 'InvalidScope'); job.draft = draft;
}
export function publishJob(job: Job, actor: Principal, snapshot: JobScopeSnapshot, policy: Policy, now: number): void {
  owner(actor, job.clientId, 'client'); requireThat(job.state === 'draft', 'PublishedSnapshotImmutable');
  job.snapshot = immutable(snapshot); job.draft = null; job.state = 'published';
  job.cycles.push({ index: 0, publishedAt: now, countdown: policy.initialAutoClose ? timer(now, policy.initialDuration, policy.version) : null, hadBilateral: false, endedAt: null });
}
export function cycle(job: Job): PublicationCycle { const current = job.cycles[job.cycles.length - 1]; requireThat(current, 'InvalidTransition'); return current; }
export function acceptingOffers(job: Job, now: number): boolean { return job.state === 'published' && (cycle(job).countdown === null || now < cycle(job).countdown!.deadline); }
export interface FeedPolicy { includes(specialization: Specialization, items: readonly ScopeItem[]): boolean }
export const specializationOnly: FeedPolicy = { includes: matches };
export function feed(state: MarketplaceState, masterId: string, specialization: Specialization, now: number, policy: FeedPolicy = specializationOnly): readonly { id: string; publishedAt: number; cep: bigint; items: readonly ScopeItem[] }[] {
  return Object.values(state.jobs).filter(job => job.clientId !== masterId && acceptingOffers(job, now) && !job.excludedMasters.includes(masterId) && job.snapshot && policy.includes(specialization, job.snapshot.items))
    .sort((a, b) => cycle(b).publishedAt - cycle(a).publishedAt).map(job => ({ id: job.id, publishedAt: cycle(job).publishedAt, cep: job.snapshot!.cep, items: job.snapshot!.items }));
}
export function initialOffer(job: Job, chats: ChatState, actor: Principal, specialization: Specialization, id: string, chatId: string, now: number): Offer {
  requireThat(actor.role === 'master', 'Unauthorized'); requireThat(acceptingOffers(job, now), 'PublicationExpired');
  requireDifferentJobParties(job.clientId, actor.userId);
  requireThat(job.snapshot && matches(specialization, job.snapshot.items), 'SpecializationMismatch');
  requireThat(!job.excludedMasters.includes(actor.userId) && !own(job.offers, actor.userId), 'Conflict');
  identifier(id); const offer: Offer = { id, jobId: job.id, masterId: actor.userId, chatId, catalogKey: job.snapshot.catalogKey,
    initialPrice: job.snapshot.cep, initialAt: now, state: 'open', revised: null, final: null, closedReason: null };
  createJobChat(chats, chatId, job.id, job.clientId, actor.userId, now); put(job.offers, actor.userId, offer); return offer;
}
export function offerAvailable(job: Job, offer: Offer, thread: ChatThread, now: number): void {
  requireDifferentJobParties(job.clientId, offer.masterId);
  requireThat(thread.context.type === 'job' && thread.context.jobId === job.id && thread.context.clientId === job.clientId &&
    thread.context.masterId === offer.masterId && thread.id === offer.chatId && offer.jobId === job.id && offer.catalogKey === job.snapshot?.catalogKey, 'InvalidReference');
  requireThat(job.state === 'published' && offer.state === 'open' && thread.mode === 'temporary', 'InvalidTransition');
  requireThat(acceptingOffers(job, now) || thread.protected, 'PublicationExpired');
}
export function revisePrice(job: Job, offer: Offer, thread: ChatThread, actor: Principal, amount: bigint, reason: string, confirmed: boolean, now: number): void {
  owner(actor, offer.masterId, 'master'); offerAvailable(job, offer, thread, now); requireThat(confirmed === true, 'ConfirmationRequired');
  requireThat(thread.protected, 'DiscussionRequired'); requireThat(!offer.revised && !offer.final, 'PriceAlreadyRevised');
  requireThat(typeof amount === 'bigint' && amount > 0n && amount !== offer.initialPrice && reason.trim(), 'InvalidMoney');
  offer.revised = { amount, reason, requestedAt: now, approvedAt: null, rejectedAt: null };
}
export function approvePrice(job: Job, offer: Offer, thread: ChatThread, actor: Principal, approved: boolean, confirmed: boolean, now: number): void {
  owner(actor, job.clientId, 'client'); offerAvailable(job, offer, thread, now); requireThat(confirmed === true, 'ConfirmationRequired');
  requireThat(typeof approved === 'boolean', 'ConfirmationRequired');
  requireThat(offer.revised && offer.revised.approvedAt === null && offer.revised.rejectedAt === null, 'InvalidTransition');
  if (approved) offer.revised.approvedAt = now; else offer.revised.rejectedAt = now;
}
export function finalApplication(job: Job, offer: Offer, thread: ChatThread, actor: Principal, confirmation: { confirmed: boolean; amount: bigint; recipientId: string }, now: number): void {
  owner(actor, offer.masterId, 'master'); offerAvailable(job, offer, thread, now); requireThat(confirmation.confirmed === true, 'ConfirmationRequired');
  requireThat(!offer.final, 'Conflict');
  requireThat(!offer.revised || offer.revised.approvedAt !== null, 'ApprovalRequired');
  const amount = offer.revised?.amount ?? offer.initialPrice;
  requireThat(confirmation.amount === amount && confirmation.recipientId === job.clientId, 'ConfirmationRequired'); offer.final = { amount, sentAt: now };
}
export function selectMaster(job: Job, chats: ChatState, offer: Offer, actor: Principal, confirmation: { confirmed: boolean; amount: bigint; masterId: string }, policy: Policy, now: number): void {
  owner(actor, job.clientId, 'client'); const thread = own(chats.threads, offer.chatId); requireThat(thread, 'NotFound'); offerAvailable(job, offer, thread, now);
  requireThat(confirmation.confirmed === true && confirmation.masterId === offer.masterId, 'ConfirmationRequired');
  requireThat(offer.final && offer.final.amount === confirmation.amount, 'FinalApplicationRequired');
  job.financial = immutable(financialSnapshot(offer.final.amount, policy)); job.selectedMasterId = offer.masterId; job.chatId = offer.chatId; job.state = 'reserved';
  job.reservation = { masterId: offer.masterId, selectedAt: now, countdown: timer(now, policy.paymentSelectionTimeout, policy.version), resetUsed: false, operations: [], state: 'reserved', method: null };
  cycle(job).endedAt = now; offer.state = 'selected';
  thread.reminder = null; thread.waitingFor = null;
  for (const other of Object.values(job.offers)) if (other.id !== offer.id && other.state === 'open') closeOffer(job, other, chats, 'not_selected');
}
export function closeOffer(job: Job, offer: Offer, chats: ChatState, reason: string): void {
  requireThat(offer.state !== 'selected', 'InvalidTransition');
  if (offer.state === 'closed') return;
  offer.state = 'closed'; offer.closedReason = reason;
  const thread = own(chats.threads, offer.chatId); requireThat(thread, 'InvalidReference'); thread.mode = 'closed'; thread.reminder = null; thread.waitingFor = null;
  if (!job.excludedMasters.includes(offer.masterId)) job.excludedMasters.push(offer.masterId);
}
export function requireRefusalStreak(state: MarketplaceState, masterId: string, history: readonly DomainEvent[]): number {
  const streak = own(state.refusalStreak, masterId) ?? 0;
  requireThat(Number.isSafeInteger(streak) && streak >= 0, 'InvalidReference');
  const authorities = history.filter(source => (source.proof?.kind === 'offer' || source.proof?.kind === 'resolution') && source.proof.refusal?.record.masterId === masterId);
  const originals = history.filter(record => record.type === 'master_voluntary_refusal' && record.recipients.includes(masterId));
  const saved = Object.values(state.refusals).filter(record => record.masterId === masterId);
  requireThat(saved.length === authorities.length && originals.length === authorities.length && new Set(originals.map(record => record.subjectId)).size === originals.length, 'InvalidReference');
  for (const source of authorities) {
    requireThat((source.proof?.kind === 'offer' || source.proof?.kind === 'resolution') && source.proof.refusal, 'InvalidReference');
    const original = source.proof.refusal;
    requireThat(sameFact(own(state.refusals, original.record.id), original.record) && originals.filter(record => record.subjectId === original.record.id &&
      record.operationId === source.operationId && record.at === source.at && record.facts.streak === original.streak && sameFact(record.context, source.context)).length === 1, 'InvalidReference');
  }
  const anchors = history.filter(source => authorities.includes(source) || source.context.kind === 'job' && source.context.masterId === masterId &&
    (source.type === 'operation:complete' || source.type === 'operation:decide_resolution' && source.proof?.kind === 'resolution' && source.proof.resolution.decision?.type === 'exceptional_completion'));
  const latest = anchors.at(-1);
  if (latest) {
    const refusal = (latest.proof?.kind === 'offer' || latest.proof?.kind === 'resolution') ? latest.proof.refusal : null;
    if (!refusal) requireThat(history.filter(record => record.type === 'refusal_streak_reset' && record.operationId === latest.operationId && record.subjectId === masterId).length === 1 &&
      history.filter(record => record.type === 'completed' && record.operationId === latest.operationId).length === 1, 'InvalidReference');
    requireThat(streak === (refusal?.streak ?? 0), 'InvalidReference');
  }
  return streak;
}
export function registerRefusal(state: MarketplaceState, context: TransactionContext, job: Job, masterId: string, basis: { offerId: string; resolutionId?: never } | { offerId?: never; resolutionId: string }, history: readonly DomainEvent[] = []): DomainEvent[] {
  const id = basis.offerId ? `withdraw:${basis.offerId}` : `resolution:${basis.resolutionId}`;
  const streak = requireRefusalStreak(state, masterId, history) + 1;
  requireThat(Number.isSafeInteger(streak), 'InvalidReference');
  requireThat(!own(state.refusals, id), 'Conflict');
  put(state.refusals, id, { id, masterId, jobId: job.id, offerId: basis.offerId ?? null, resolutionId: basis.resolutionId ?? null, at: context.now, operationId: context.operationId });
  put(state.refusalStreak, masterId, streak);
  return [event(context, 'master_voluntary_refusal', id, [masterId], { jobId: job.id, streak }),
    event(context, streak === 1 ? 'refusal_recorded_warning' : 'repeated_refusal_warning', id, [masterId], { streak })];
}
export function terminateNegotiation(state: MarketplaceState, chats: ChatState, job: Job, offer: Offer, context: TransactionContext, confirmed: boolean, reason: string, history: readonly DomainEvent[] = []): DomainEvent[] {
  requireDifferentJobParties(job.clientId, offer.masterId);
  requireThat(confirmed === true, 'ConfirmationRequired'); requireThat(job.state === 'published' && offer.state === 'open', 'InvalidTransition');
  if (context.actor.role === 'admin') { authorize(context.actor, 'negotiation'); requireThat(reason.trim(), 'EvidenceRequired'); }
  else requireThat((context.actor.role === 'client' && context.actor.userId === job.clientId) || (context.actor.role === 'master' && context.actor.userId === offer.masterId), 'Unauthorized');
  const thread = own(chats.threads, offer.chatId); requireThat(thread, 'InvalidReference');
  const live = acceptingOffers(job, context.now) || thread.protected;
  const events = context.actor.role === 'master' && live ? registerRefusal(state, context, job, offer.masterId, { offerId: offer.id }, history) : [];
  closeOffer(job, offer, chats, context.actor.role === 'admin' ? 'admin_closed' : 'terminated');
  return [...events, event(context, 'negotiations_closed', offer.id, [job.clientId, offer.masterId], { reason })];
}
export function evaluatePublication(job: Job, chats: ChatState, policy: Policy, now: number): 'unchanged' | 'expired' | 'republished' {
  if (job.state !== 'published') return 'unchanged'; const current = cycle(job);
  if (current.countdown === null || now < current.countdown.deadline) return 'unchanged';
  for (const offer of Object.values(job.offers)) if (offer.state === 'open' && !own(chats.threads, offer.chatId)?.protected) closeOffer(job, offer, chats, 'expired');
  if (Object.values(job.offers).some(offer => offer.state === 'open' && own(chats.threads, offer.chatId)?.protected)) return 'unchanged';
  current.endedAt = now;
  if (!current.hadBilateral) { job.state = 'expired'; return 'expired'; }
  const duration = policy.repeatDurations[current.index] ?? policy.repeatFloor;
  job.cycles.push({ index: current.index + 1, publishedAt: now, countdown: timer(now, duration, policy.version), hadBilateral: false, endedAt: null }); return 'republished';
}
export function assignment(job: Job, chats: ChatState, policy: Policy, now: number): void {
  requireThat(job.state === 'reserved' && job.reservation?.state === 'assigned' && job.chatId, 'InvalidTransition');
  requireThat(job.selectedMasterId, 'InvalidReference'); requireDifferentJobParties(job.clientId, job.selectedMasterId); requireDifferentJobParties(job.clientId, job.reservation.masterId);
  const thread = own(chats.threads, job.chatId); requireThat(thread?.context.type === 'job' && thread.context.jobId === job.id && thread.context.clientId === job.clientId &&
    thread.context.masterId === job.selectedMasterId && job.reservation.masterId === job.selectedMasterId, 'InvalidReference');
  job.state = 'assigned'; thread.mode = 'working'; thread.reminder = null; thread.waitingFor = null;
  job.funds = job.reservation.method === 'cash' ? 'none' : 'held'; activity(job, policy, now);
}
export function activity(job: Job, policy: Policy, now: number): void {
  job.lastActivityAt = now; job.inactivityReminder = timer(now, policy.inactivityFirstReminder, policy.version);
  job.inactivityThreshold = timer(now, policy.inactivityThreshold, policy.version);
}
export function address(job: Job, actor: Principal): string {
  requireThat(actor.userId === job.clientId && actor.role === 'client' || actor.userId === job.selectedMasterId && actor.role === 'master' && ['assigned', 'working', 'client_accepted', 'completed'].includes(job.state), 'Unauthorized');
  requireThat(job.snapshot, 'NotFound'); return job.snapshot.address;
}
export function linkJobs(job: Job, linked: Job, catalog: CatalogRevision, actor: Principal): void {
  owner(actor, job.clientId, 'client'); owner(actor, linked.clientId, 'client'); requireThat(job.id !== linked.id && job.snapshot && linked.snapshot, 'InvalidReference');
  requireThat(job.snapshot.items.some(item => catalog.scenarios.find(scenario => scenario.id === item.scenarioId)?.form.linkedCategories.includes(linked.snapshot!.items[0]!.categoryId)), 'InvalidReference');
  requireThat(!job.linkedJobId && !linked.linkedJobId, 'Conflict'); job.linkedJobId = linked.id; linked.linkedJobId = job.id;
}
