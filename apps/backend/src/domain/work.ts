import { authorize, event, identifier, own, owner, portion, put, requireThat, timer } from './core.js';
import type { DomainEvent, Role, TransactionContext } from './core.js';
import type { Job, MarketplaceState } from './marketplace.js';
import { activity, registerRefusal, requireRefusalStreak } from './marketplace.js';
import type { ChatState } from './messaging.js';
import type { Allocation, FinanceState, SettlementObligation } from './finance.js';
import { allocation, calculatePayout, confirmedPayment, debtBalance, ledger } from './finance.js';
import { messageAuthorRole, messageById, resolutionThreads } from './messaging.js';
import type { Policy } from './policy.js';
import { sameFact } from './provenance.js';

export interface ResolutionCase {
  readonly id: string; readonly jobId: string; requestId: string | null;
  readonly openedAt: number; readonly snapshotPolicy: string; readonly evidence: readonly string[];
  status: 'admin_resolution_pending' | 'decided' | 'closed_by_master_completion'; decision: ResolutionDecision | null;
}
export interface ResolutionDecision {
  readonly id: string; readonly caseId: string; readonly type: 'mutual' | 'false_call' | 'partial' | 'master_refusal' | 'exceptional_completion';
  readonly reason: string; readonly actorId: string; readonly at: number; readonly evidence: readonly string[];
  readonly acceptanceOperationId: string | null; readonly allocation: Allocation | null;
  readonly basis: readonly ResolutionEvidence[];
}
export type FinancialObligation = SettlementObligation;
export interface WorkState { cases: Record<string, ResolutionCase>; obligations: Record<string, FinancialObligation> }
export function submitResult(job: Job, context: TransactionContext, policy: Policy, explanation: string, photoIds: readonly string[]): DomainEvent {
  requireThat(job.selectedMasterId, 'InvalidTransition'); owner(context.actor, job.selectedMasterId, 'master');
  requireThat(['assigned', 'working'].includes(job.state) && !job.cancellation, 'InvalidTransition');
  requireThat(explanation.trim() || photoIds.length > 0, 'EvidenceRequired');
  job.evidence.push({ id: context.operationId, actorId: context.actor.userId, at: context.now, explanation, photoIds });
  job.state = 'working'; activity(job, policy, context.now); return event(context, 'evidence_submitted', job.id, [job.clientId]);
}
export function acceptWork(job: Job, context: TransactionContext, policy: Policy, accepted: boolean, explanation: string): DomainEvent {
  owner(context.actor, job.clientId, 'client'); requireThat(['assigned', 'working'].includes(job.state), 'InvalidTransition');
  requireThat(!job.cancellation, 'ResolutionRequired');
  requireThat(typeof accepted === 'boolean', 'ConfirmationRequired');
  if (accepted) { job.state = 'client_accepted'; job.acceptedAt = context.now; job.acceptanceOperationId = context.operationId; }
  else requireThat(explanation.trim(), 'EvidenceRequired');
  activity(job, policy, context.now);
  return event(context, accepted ? 'completion_confirmed_by_client' : 'correction_requested', job.id, [job.selectedMasterId!], { explanation });
}
export function requireFunding(job: Job, history: readonly DomainEvent[]): void {
  requireThat(job.reservation?.state === 'assigned' && job.financial, 'FundsMismatch');
  if (job.reservation.method === 'cash') {
    requireThat(job.funds === 'none' && job.reservation.operations.every(operation => operation.status === 'failed') &&
      history.some(record => record.type === 'operation:cash' && record.facts.jobId === job.id && record.actorId === job.clientId), 'FundsMismatch'); return;
  }
  const received = confirmedPayment(job.reservation, job.financial, job.id);
  requireThat(history.some(record => record.type === 'operation:payment_outcome' && record.facts.operationId === received.id &&
    record.facts.jobId === job.id && record.facts.kind === 'payment' && record.facts.amount === job.financial!.fap &&
    record.facts.currency === 'THB' && record.facts.status === 'success' && record.facts.obligationId === job.id &&
    record.facts.beneficiaryId === 'helpy' && record.facts.destinationId === null), 'FundsMismatch');
}
export function requireAcceptance(job: Job, history: readonly DomainEvent[]): void {
  requireThat(job.acceptanceOperationId && job.acceptedAt !== null && history.some(record =>
    record.type === 'completion_confirmed_by_client' && record.subjectId === job.id && record.actorId === job.clientId &&
    record.operationId === job.acceptanceOperationId && record.at === job.acceptedAt), 'EvidenceRequired');
  requireThat(history.some(record => record.type === 'operation:accept_work' && record.operationId === job.acceptanceOperationId &&
    record.actorId === job.clientId && record.actorRole === 'client' && record.at === job.acceptedAt && record.context.kind === 'job' &&
    record.context.jobId === job.id && record.proof?.kind === 'acceptance' && record.proof.accepted), 'EvidenceRequired');
}
export function completeJob(job: Job, marketplace: MarketplaceState, chats: ChatState, finance: FinanceState, work: WorkState, context: TransactionContext, history: readonly DomainEvent[], exceptional = false): DomainEvent[] {
  requireThat(job.state === 'client_accepted' && job.acceptedAt !== null && job.acceptanceOperationId && job.selectedMasterId && job.financial && job.chatId, 'InvalidTransition');
  requireFunding(job, history); requireAcceptance(job, history);
  if (!exceptional) {
    owner(context.actor, job.selectedMasterId, 'master'); requireThat(!job.cancellation, 'ResolutionRequired');
    if (job.resolutionId) {
      const resolution = own(work.cases, job.resolutionId);
      requireThat(resolution?.status === 'admin_resolution_pending' && resolution.requestId === null && resolution.jobId === job.id, 'ResolutionRequired');
      resolution.status = 'closed_by_master_completion';
    }
  }
  requireRefusalStreak(marketplace, job.selectedMasterId, history);
  job.state = 'completed'; job.completedAt = context.now;
  const chat = own(chats.threads, job.chatId); requireThat(chat, 'InvalidReference'); chat.mode = 'closed';
  put(marketplace.refusalStreak, job.selectedMasterId, 0);
  let facts: DomainEvent['facts'] = {};
  if (job.reservation?.method === 'cash') {
    const fee = portion(job.financial.fap, job.financial.commission);
    const debtBefore = debtBalance(finance, job.selectedMasterId);
    ledger(finance, { id: `commission:${job.id}`, masterId: job.selectedMasterId, basis: `commission:${job.id}`, change: fee, at: context.now, actorId: context.actor.userId });
    facts = { commission: fee, debtBefore };
  } else {
    requireThat(job.funds === 'held', 'FundsMismatch'); job.funds = 'releasable';
    const payout = calculatePayout(finance, job.id, job.selectedMasterId, job.financial, context.now, context.actor.userId);
    facts = { payoutId: payout.id, commission: payout.commission, debtBefore: payout.debtBefore,
      netBeforeDebt: payout.netBeforeDebt, debtRecovery: payout.debtRecovery, payoutAmount: payout.amount };
  }
  return [event(context, 'completed', job.id, [job.clientId, job.selectedMasterId], facts), event(context, 'refusal_streak_reset', job.selectedMasterId, [job.selectedMasterId])];
}
export function requestCancellation(job: Job, context: TransactionContext, policy: Policy, input: { id: string; reason: string; explanation: string; remainingWork: string; classification: 'ordinary' | 'unclassified' | 'false_call' | 'partial'; evidence: readonly string[]; confirmed: boolean }): void {
  identifier(input.id);
  requireThat(['assigned', 'working'].includes(job.state) && !job.cancellation, 'InvalidTransition');
  requireThat(context.actor.role === 'client' && context.actor.userId === job.clientId || context.actor.role === 'master' && context.actor.userId === job.selectedMasterId, 'Unauthorized');
  requireThat(input.confirmed === true, 'ConfirmationRequired'); requireThat(input.reason.trim() && input.explanation.trim(), 'EvidenceRequired');
  requireThat(['ordinary', 'unclassified', 'false_call', 'partial'].includes(input.classification), 'InvalidTransition');
  requireThat(input.classification !== 'false_call' || context.actor.role === 'master' && context.actor.userId === job.selectedMasterId, 'Unauthorized');
  job.cancellation = { id: input.id, initiator: context.actor.userId, reason: input.reason, explanation: input.explanation,
    remainingWork: input.remainingWork, classification: input.classification,
    evidence: input.evidence, requestedAt: context.now, responseTimer: timer(context.now, policy.cancellationResponse, policy.version),
     reminder: timer(context.now, policy.cancellationReminder, policy.version), workStopped: null, financialConsent: null, responseExplanation: null, response: null };
}
export interface ResolutionEvidence {
  readonly id: string; readonly jobId: string; readonly actorId: string; readonly at: number;
  readonly actorRole: Role;
  readonly kind: 'message' | 'photo' | 'work' | 'cancellation' | 'response' | 'acceptance' | 'history';
  readonly explanation: string; readonly photoIds: readonly string[];
}
export function requireWorkEvidence(job: Job, events: readonly DomainEvent[]): void {
  const originals = events.filter(record => record.type === 'operation:submit_result' && record.context.kind === 'job' && record.context.jobId === job.id);
  const materials = originals.map(record => {
    requireThat(record.proof?.kind === 'work' && record.actorRole === 'master' && record.actorId === job.selectedMasterId &&
      record.proof.evidence.id === record.operationId && record.proof.evidence.actorId === record.actorId && record.proof.evidence.at === record.at, 'InvalidReference');
    return record.proof.evidence;
  });
  requireThat(new Set(materials.map(material => material.id)).size === materials.length && sameFact(job.evidence, materials), 'InvalidReference');
}
export function resolutionEvidence(job: Job, chats: ChatState, events: readonly DomainEvent[], references: readonly string[], resolutionId: string | null): readonly ResolutionEvidence[] {
  requireWorkEvidence(job, events);
  requireThat(new Set(references).size === references.length, 'EvidenceRequired');
  const records: ResolutionEvidence[] = [];
  const add = (id: string, actorId: string, actorRole: Role, at: number, kind: ResolutionEvidence['kind'], explanation: string, photoIds: readonly string[]) => {
    records.push({ id, jobId: job.id, actorId, actorRole, at, kind, explanation, photoIds });
    for (const photo of photoIds) records.push({ id: photo, jobId: job.id, actorId, actorRole, at, kind: 'photo', explanation, photoIds: [photo] });
  };
  for (const material of job.evidence) {
    requireThat(material.actorId === job.selectedMasterId, 'InvalidReference');
    add(material.id, material.actorId, 'master', material.at, 'work', material.explanation, material.photoIds);
  }
  if (job.cancellation) {
    const request = job.cancellation;
    requireThat(request.initiator === job.clientId || request.initiator === job.selectedMasterId, 'InvalidReference');
    add(request.id, request.initiator, request.initiator === job.clientId ? 'client' : 'master', request.requestedAt, 'cancellation', request.explanation, request.evidence);
    if (request.response) {
      requireThat(request.response.actorId === (request.initiator === job.clientId ? job.selectedMasterId : job.clientId), 'InvalidReference');
      add(request.response.id, request.response.actorId, request.response.actorId === job.clientId ? 'client' : 'master', request.response.at, 'response', request.response.explanation, []);
    }
  }
  let messageCount = 0;
  for (const thread of resolutionThreads(chats, job, resolutionId, events)) {
    messageCount += thread.messageIds.length;
    for (const id of thread.messageIds) {
      const message = messageById(chats, thread, id, events);
      add(message.id, message.authorId, messageAuthorRole(thread, message), message.at, 'message', message.original, message.photoIds);
    }
  }
  for (const recorded of events) {
    if (recorded.type === 'completion_confirmed_by_client' && recorded.subjectId === job.id && recorded.actorId === job.clientId && recorded.operationId === job.acceptanceOperationId && recorded.at === job.acceptedAt) {
      add(recorded.operationId, recorded.actorId, 'client', recorded.at, 'acceptance', recorded.type, []);
      add(recorded.id, recorded.actorId, 'client', recorded.at, 'acceptance', recorded.type, []);
    }
    if (recorded.type === 'resolution_inspected' && recorded.subjectId === resolutionId && recorded.facts.jobId === job.id &&
      recorded.facts.acceptanceOperationId === job.acceptanceOperationId && recorded.facts.lastActivityAt === job.lastActivityAt &&
      recorded.facts.messageCount === messageCount && recorded.facts.evidenceCount === job.evidence.length &&
      recorded.facts.cancellationRequestId === (job.cancellation?.id ?? null) && recorded.facts.cancellationResponseId === (job.cancellation?.response?.id ?? null)) {
      add(recorded.id, recorded.actorId, 'admin', recorded.at, 'history', recorded.type, []);
    }
  }
  return references.map(reference => { const record = records.find(record => record.id === reference); requireThat(record, 'EvidenceRequired', reference); return record; });
}
export function openResolution(state: WorkState, job: Job, id: string, context: TransactionContext, evidence: readonly string[], source: 'request' | 'cancellation_timeout'): ResolutionCase {
  identifier(id);
  requireThat(job.financial && ['assigned', 'working', 'client_accepted'].includes(job.state) && !job.resolutionId && !own(state.cases, id), 'InvalidTransition');
  if (source === 'cancellation_timeout') {
    authorize(context.actor, 'scheduler'); requireThat(job.cancellation && context.now >= job.cancellation.responseTimer.deadline && job.cancellation.workStopped === null, 'InvalidTransition');
  } else if (context.actor.role === 'admin') authorize(context.actor, 'resolution');
  else requireThat(context.actor.userId === job.clientId && context.actor.role === 'client' || context.actor.userId === job.selectedMasterId && context.actor.role === 'master', 'Unauthorized');
  const resolution: ResolutionCase = { id, jobId: job.id, requestId: job.cancellation?.id ?? null, openedAt: context.now,
    snapshotPolicy: job.financial.policyVersion, evidence, status: 'admin_resolution_pending', decision: null };
  put(state.cases, id, resolution); job.resolutionId = id; return resolution;
}
export interface DecisionInput {
  readonly id: string; readonly type: ResolutionDecision['type']; readonly reason: string; readonly evidence: readonly string[];
  readonly facts: { readonly arrived: boolean; readonly partialWork: boolean; readonly voluntaryRefusalProven: boolean; readonly acceptanceReviewed: boolean; readonly historyReviewed: boolean };
  readonly shares?: { readonly clientRefund: bigint; readonly masterCompensation: bigint };
}
export function decideResolution(state: WorkState, market: MarketplaceState, chats: ChatState, finance: FinanceState, job: Job, resolution: ResolutionCase, context: TransactionContext, input: DecisionInput, history: readonly DomainEvent[]): DomainEvent[] {
  authorize(context.actor, 'resolution');
  requireThat(input && Object.keys(input).every(key => ['id', 'type', 'reason', 'evidence', 'facts', 'shares'].includes(key)), 'ResolutionRequired');
  requireThat(typeof input.reason === 'string' && input.reason.trim() && Array.isArray(input.evidence) && input.evidence.length > 0 && input.evidence.every(id => typeof id === 'string' && id.trim()), 'EvidenceRequired');
  const factKeys = ['arrived', 'partialWork', 'voluntaryRefusalProven', 'acceptanceReviewed', 'historyReviewed'] as const;
  requireThat(input.facts && factKeys.every(key => typeof input.facts[key] === 'boolean') && Object.keys(input.facts).every(key => (factKeys as readonly string[]).includes(key)), 'ResolutionRequired');
  requireThat(input.shares === undefined || input.type === 'partial' && input.shares && Object.keys(input.shares).every(key => ['clientRefund', 'masterCompensation'].includes(key)), 'FundsMismatch');
  requireThat(['mutual', 'false_call', 'partial', 'master_refusal', 'exceptional_completion'].includes(input.type), 'ResolutionRequired');
  requireThat(resolution.status === 'admin_resolution_pending' && job.resolutionId === resolution.id && resolution.jobId === job.id && job.financial && resolution.snapshotPolicy === job.financial.policyVersion, 'InvalidTransition');
  requireFunding(job, history);
  requireThat(!Object.values(state.cases).some(value => value.decision?.id === input.id), 'Conflict');
  identifier(input.id);
  let events: DomainEvent[] = []; let split: Allocation | null = null;
  if (input.type === 'exceptional_completion') {
    requireThat(job.state === 'client_accepted' && !job.cancellation && resolution.requestId === null && job.inactivityThreshold && context.now >= job.inactivityThreshold.deadline &&
      input.facts.acceptanceReviewed && input.facts.historyReviewed && job.acceptanceOperationId, 'ResolutionRequired');
    const basis = resolutionEvidence(job, chats, history, input.evidence, resolution.id);
    requireThat(basis.some(record => record.kind === 'acceptance') && basis.some(record => record.kind === 'history' && record.actorId === context.actor.userId), 'EvidenceRequired');
    events = completeJob(job, market, chats, finance, state, context, history, true);
  } else {
    requireThat(['assigned', 'working'].includes(job.state) && job.cancellation && job.selectedMasterId, 'InvalidTransition');
    if (input.type === 'mutual') requireThat(job.cancellation.initiator === job.clientId && job.cancellation.workStopped === true &&
      job.cancellation.financialConsent === true && job.cancellation.classification !== 'partial' && !input.facts.arrived && !input.facts.partialWork, 'ResolutionRequired');
    if (input.type === 'false_call') requireThat(input.facts.arrived && !input.facts.partialWork && job.cancellation.initiator === job.selectedMasterId &&
      job.cancellation.classification === 'false_call' && job.cancellation.evidence.length > 0 &&
      job.cancellation.evidence.some(id => input.evidence.includes(id)), 'EvidenceRequired');
    if (input.type === 'master_refusal') requireThat(input.facts.voluntaryRefusalProven, 'ResolutionRequired');
    const basis = resolutionEvidence(job, chats, history, input.evidence, resolution.id);
    if (input.type === 'partial') requireThat(input.facts.partialWork &&
      (job.cancellation.initiator === job.selectedMasterId && job.cancellation.remainingWork.trim() ||
        job.cancellation.response?.actorId === job.selectedMasterId && job.cancellation.response.remainingWork.trim()) &&
      basis.some(record => record.actorRole === 'master' && record.actorId === job.selectedMasterId && record.photoIds.length > 0 && record.explanation.trim()), 'EvidenceRequired');
    if (input.type === 'master_refusal') {
      requireThat(basis.some(record => record.actorRole === 'master' && record.actorId === job.selectedMasterId && record.explanation.trim()), 'EvidenceRequired');
      events.push(...registerRefusal(market, context, job, job.selectedMasterId, { resolutionId: input.id }, history));
    }
    if (job.reservation?.method !== 'cash') {
      requireThat(job.funds === 'held', 'FundsMismatch'); split = allocation(job.financial, input.type, input.shares); job.funds = 'allocated';
      for (const [kind, beneficiary, amount] of [['refund', job.clientId, split.clientRefund], ['compensation', job.selectedMasterId, split.masterCompensation]] as const) {
        if (amount > 0n) { const id = `${input.id}:${kind}`; requireThat(!own(state.obligations, id), 'Conflict');
          const received = job.reservation?.operations.find(operation => operation.status === 'success'); requireThat(received, 'FundsMismatch');
          put(state.obligations, id, { id, jobId: job.id, decisionId: input.id, beneficiaryId: beneficiary, kind, amount, currency: 'THB', sourcePaymentId: received.id, createdAt: context.now, attempts: [], settled: false }); }
      }
    }
    job.state = 'cancelled'; if (job.chatId) { const chat = own(chats.threads, job.chatId); requireThat(chat, 'InvalidReference'); chat.mode = 'closed'; }
  }
  resolution.decision = { id: input.id, caseId: resolution.id, type: input.type, reason: input.reason, actorId: context.actor.userId,
    at: context.now, evidence: input.evidence, acceptanceOperationId: job.acceptanceOperationId, allocation: split,
    basis: resolutionEvidence(job, chats, history, input.evidence, resolution.id) };
  resolution.status = 'decided'; events.push(event(context, 'resolution_decided', resolution.id, [job.clientId, job.selectedMasterId!], { outcome: input.type })); return events;
}
