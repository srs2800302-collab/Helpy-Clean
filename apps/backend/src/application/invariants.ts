import { own, portion, put, requireDifferentJobParties, requireThat, unwrap } from '../domain/core.js';
import { compoundId, sameFact } from '../domain/provenance.js';
import type { TimerFact } from '../domain/provenance.js';
import type { Job } from '../domain/marketplace.js';
import { allocation, confirmedPayment, requireOperation, requirePaymentOperation, requirePayoutCalculation, requireTransferState, validateFinancialSnapshot } from '../domain/finance.js';
import type { FailureReason, PaymentOperation, ProviderStatus, TransferAttempt } from '../domain/finance.js';
import { retentionFact } from '../domain/policy.js';
import type { RetentionFact } from '../domain/policy.js';
import type { Clock, NotificationPreference, Role } from '../domain/core.js';
import { messageRecords, requireSupportContext } from '../domain/messaging.js';
import { requireAcceptance, requireFunding, requireWorkEvidence } from '../domain/work.js';
import type { CoreState } from './ports.js';
import { catalogKey } from '../domain/catalog.js';
import type { CatalogRevision, TextRevision } from '../domain/catalog.js';
import { validateCatalog } from '../domain/catalog.js';
import { debtView as financialDebtView } from '../domain/finance.js';
import type { Policy } from '../domain/policy.js';
import * as Validate from './validation.js';

export function catalogByKey(state: CoreState, key: string, collection: 'drafts' | 'published'): CatalogRevision {
  requireCatalogInventory(state);
  const catalog = own(state[collection], key); requireThat(catalog && catalogKey(catalog) === key, 'InvalidReference');
  Validate.catalog(catalog);
  requireThat(catalog.status === (collection === 'published' ? 'published' : 'draft'), 'InvalidReference');
  unwrap(validateCatalog(catalog, collection === 'published'));
  const records = state.events.filter(record => record.proof?.kind === 'catalog' && record.proof.key === key);
  // A preexisting Published revision is canonical configuration supplied by the
  // repository port. Drafts and revisions managed here retain their atomic audit.
  if (records.length === 0) {
    requireThat(collection === 'published', 'InvalidReference');
    const first = state.events.find(record => record.proof?.kind === 'catalog')?.proof;
    if (first?.kind === 'catalog') requireThat(first.initial?.some(original => sameFact(original, catalog)), 'InvalidReference');
    return catalog;
  }
  let structure: Omit<CatalogRevision, 'texts' | 'sequence' | 'status'> | null = null;
  const texts = new Map<string, TextRevision>(); let sequence = 0; let status: CatalogRevision['status'] = 'draft';
  for (const record of records) {
    const proof = record.proof; requireThat(proof?.kind === 'catalog' && record.actorRole === 'admin', 'InvalidReference');
    if (record.type === 'operation:save_catalog') {
      requireThat(status === 'draft' && proof.sequence === sequence + 1 && proof.structure && proof.status === 'draft', 'InvalidReference');
      structure = proof.structure; texts.clear(); for (const text of proof.texts) texts.set(text.id, text);
      sequence = proof.sequence;
    } else if (record.type === 'operation:approve_text' || record.type === 'operation:approve_content_set') {
      requireThat(structure && status === 'draft' && proof.status === 'draft' && proof.sequence === sequence + 1, 'InvalidReference');
      for (const text of proof.texts) { requireThat(texts.has(text.id), 'InvalidReference'); texts.set(text.id, text); }
      sequence = proof.sequence;
    } else {
      requireThat(record.type === 'operation:publish_catalog' && structure && status === 'draft' && proof.status === 'published' && proof.sequence === sequence, 'InvalidReference');
      status = 'published';
    }
  }
  requireThat(structure && sameFact(catalog, { ...structure, texts: [...texts.values()], sequence, status }), 'InvalidReference');
  return catalog;
}

function requireCatalogInventory(state: CoreState): void {
  const records = state.events.filter(record => ['operation:save_catalog', 'operation:approve_text', 'operation:approve_content_set', 'operation:publish_catalog'].includes(record.type));
  if (!records.length) return;
  const first = records[0]!.proof; requireThat(first?.kind === 'catalog' && first.initial, 'InvalidReference');
  const published = new Set(first.initial.map(catalog => catalogKey(catalog)));
  for (const record of records) {
    requireThat(record.proof?.kind === 'catalog' && record.actorRole === 'admin', 'InvalidReference');
    if (record.type === 'operation:publish_catalog') requireThat(!published.has(record.proof.key), 'InvalidReference');
    if (record.proof.status === 'published') published.add(record.proof.key);
  }
  requireThat(published.size === Object.keys(state.published).length && [...published].every(key => Object.hasOwn(state.published, key)), 'InvalidReference');
}

export function currentCatalog(state: CoreState): CatalogRevision {
  requireCatalogInventory(state);
  requireThat(state.current && own(state.published, state.current), 'InvalidConfiguration', 'Published catalog missing');
  const publications = state.events.filter(record => record.type === 'operation:publish_catalog');
  for (const record of publications) requireThat(record.actorRole === 'admin' && record.proof?.kind === 'catalog' && record.proof.status === 'published', 'InvalidReference');
  const latest = publications.at(-1)?.proof;
  if (latest?.kind === 'catalog') requireThat(state.current === latest.key, 'InvalidReference');
  else {
    const initial = state.events.find(record => record.proof?.kind === 'catalog')?.proof;
    if (initial?.kind === 'catalog') requireThat(state.current === initial.initialCurrent, 'InvalidReference');
  }
  return catalogByKey(state, state.current, 'published');
}

export function correctionKey(state: CoreState, oldCatalogKey: string, textId: string): string {
  const decisions = state.events.filter(record => record.type === 'operation:translation_correction');
  for (const record of decisions) requireThat(record.actorRole === 'admin' && record.proof?.kind === 'translation_correction', 'InvalidReference');
  const original = decisions.filter(record => record.proof?.kind === 'translation_correction' && record.proof.oldCatalogKey === oldCatalogKey && record.proof.textId === textId).at(-1)?.proof;
  const saved = own(state.corrections, compoundId(oldCatalogKey, textId));
  requireThat(saved === (original?.kind === 'translation_correction' ? original.newCatalogKey : undefined), 'InvalidReference');
  return saved ?? oldCatalogKey;
}

export function notificationPreference(state: CoreState, userId: string, role: Role): NotificationPreference | undefined {
  const source = state.events.filter(record => record.type === 'operation:preferences' && record.actorId === userId && record.actorRole === role).at(-1);
  const current = own(state.preferences, `${userId}:${role}`);
  if (source) requireThat(source.proof?.kind === 'preferences' && sameFact(current, source.proof.preference), 'InvalidReference');
  return current;
}

export function completedJobs(state: CoreState, belongs: (clientId: string, masterId: string | null) => boolean): readonly Job[] {
  const records = state.events.filter(record => record.type === 'completed' && record.context.kind === 'job' &&
    record.context.clientId !== record.context.masterId && belongs(record.context.clientId, record.context.masterId)).filter(record => {
      const job = record.context.kind === 'job' ? own(state.jobs, record.context.jobId) : undefined;
      return !job || job.clientId !== job.selectedMasterId;
    });
  const ids = records.map(record => { requireThat(record.context.kind === 'job', 'InvalidReference'); return record.context.jobId; });
  const saved = Object.values(state.jobs).filter(job => { Validate.repositoryRecord(job);
    return job.state === 'completed' && job.clientId !== job.selectedMasterId && belongs(job.clientId, job.selectedMasterId); });
  requireThat(new Set(ids).size === ids.length && saved.length === ids.length && saved.every(job => ids.includes(job.id)), 'InvalidReference');
  return ids.map(id => jobById(state, id));
}

export function jobTimers(state: CoreState, job: Job): readonly TimerFact[] {
  Validate.job(job);
  const values: TimerFact[] = [];
  const add = (kind: TimerFact['kind'], ownerId: string, value: TimerFact['value'], index: number | null = null) =>
    values.push({ id: compoundId(kind, job.id, ownerId), kind, value, index });
  for (const cycle of job.cycles) add('publication', String(cycle.index), cycle.countdown, cycle.index);
  if (job.reservation) {
    add('reservation', job.id, job.reservation.countdown);
    for (const operation of job.reservation.operations) add('provider', operation.id, operation.providerTimer);
  }
  for (const offer of Object.values(job.offers)) {
    const thread = own(state.threads, offer.chatId); requireThat(thread, 'InvalidReference');
    add('negotiation_reminder', thread.id, job.state === 'published' && offer.state === 'open' ? thread.reminder : null);
  }
  // An anomalous post-acceptance request remains inspectable evidence, never an
  // ordinary cancellation countdown or authority for exceptional completion.
  if (job.cancellation && job.state !== 'client_accepted') {
    add('cancellation_response', job.cancellation.id, job.cancellation.responseTimer);
    add('cancellation_reminder', job.cancellation.id, job.cancellation.reminder);
  }
  add('inactivity_reminder', job.id, job.inactivityReminder);
  add('inactivity_threshold', job.id, job.inactivityThreshold);
  const transfers = [...(own(state.payouts, job.id)?.attempts ?? []), ...Object.values(state.obligations).filter(value => value.jobId === job.id).flatMap(value => value.attempts)];
  for (const attempt of transfers) add('provider', attempt.id, attempt.providerTimer);
  return values;
}

function requireJobTimers(state: CoreState, job: Job): void {
  const origins = new Map<string, { fact: TimerFact; event: CoreState['events'][number] }>();
  for (const event of state.events) if (event.context.kind === 'job' && event.context.jobId === job.id)
    for (const fact of event.timers) origins.set(fact.id, { fact, event });
  const current = jobTimers(state, job);
  requireThat(origins.size === current.length, 'InvalidReference');
  for (const fact of current) {
    const origin = origins.get(fact.id);
    requireThat(origin && sameFact(fact, origin.fact), 'InvalidReference');
    const policy = state.policies.find(policy => policy.version === origin.event.policyVersion);
    requireThat(policy && policy.effectiveAt <= origin.event.at, 'InvalidReference');
    if (fact.value === null) {
      requireThat(fact.kind !== 'publication' || fact.index === 0 && !policy.initialAutoClose, 'InvalidReference');
      continue;
    }
    const value = fact.value;
    const repeat = origin.event.type === 'operation:reminders';
    const duration = fact.kind === 'publication' ? fact.index === 0 ? policy.initialDuration : policy.repeatDurations[fact.index! - 1] ?? policy.repeatFloor :
      fact.kind === 'reservation' ? policy.paymentSelectionTimeout : fact.kind === 'provider' ? policy.providerConfirmation :
      fact.kind === 'cancellation_response' ? policy.cancellationResponse : fact.kind === 'cancellation_reminder' ? policy.cancellationReminder :
      fact.kind === 'negotiation_reminder' ? repeat ? policy.negotiationRepeatReminder : policy.negotiationFirstReminder :
      fact.kind === 'inactivity_reminder' ? repeat ? policy.inactivityRepeatReminder : policy.inactivityFirstReminder : policy.inactivityThreshold;
    requireThat(value.startedAt === origin.event.at && value.policyVersion === policy.version && Number.isSafeInteger(value.duration) && value.duration > 0 &&
      value.duration === duration && Number.isSafeInteger(value.deadline) && value.deadline === value.startedAt + value.duration, 'InvalidReference');
  }
}

export function jobById(state: CoreState, id: string) {
  const job = own(state.jobs, id); requireThat(job && job.id === id, 'NotFound');
  if (job.selectedMasterId === job.clientId) requireDifferentJobParties(job.clientId, job.selectedMasterId!);
  Validate.job(job);
  requireThat(['draft', 'published', 'reserved', 'assigned', 'working', 'client_accepted', 'completed', 'expired', 'cancelled'].includes(job.state), 'InvalidReference');
  requireThat(own(state.users, job.clientId)?.id === job.clientId, 'InvalidReference');
  const births = state.events.filter(record => record.type === 'operation:new_job' && record.context.kind === 'job' && record.context.jobId === id);
  requireThat(births.length === 1 && births[0]!.actorRole === 'client' && births[0]!.actorId === job.clientId, 'InvalidReference');
  const links = state.events.filter(record => record.type === 'operation:link_jobs');
  for (const record of links) requireThat(record.proof?.kind === 'link', 'InvalidReference');
  const linked = links.filter(record => record.proof?.kind === 'link' && [record.proof.jobId, record.proof.linkedJobId].includes(id));
  requireThat(linked.length <= 1, 'InvalidReference');
  const link = linked[0];
  if (link?.proof?.kind === 'link') {
    const otherId = link.proof.jobId === id ? link.proof.linkedJobId : link.proof.jobId, other = own(state.jobs, otherId);
    requireThat(otherId !== id && other?.id === otherId && other.clientId === job.clientId && link.actorId === job.clientId && link.actorRole === 'client' &&
      job.linkedJobId === otherId && other.linkedJobId === id, 'InvalidReference');
  } else requireThat(job.linkedJobId === null, 'InvalidReference');
  const openings = state.events.filter(record => record.type === 'resolution_opened' && record.context.kind === 'job' && record.context.jobId === id);
  requireThat(openings.length === (job.resolutionId === null ? 0 : 1), 'InvalidReference');
  const publications = state.events.filter(record => record.type === 'operation:publish_job' && record.context.kind === 'job' && record.context.jobId === id);
  requireThat(job.state === 'draft' ? job.snapshot === null && publications.length === 0 && job.draft !== null && job.cycles.length === 0 :
    job.snapshot !== null && job.draft === null && publications.length === 1, 'InvalidReference');
  if (job.snapshot) {
    requireThat(publications.length === 1 && publications[0]?.proof?.kind === 'publication' && publications[0].actorId === job.clientId &&
      sameFact(publications[0].proof.snapshot, job.snapshot), 'InvalidReference');
  }
  if (['reserved', 'assigned', 'working', 'client_accepted', 'completed', 'cancelled'].includes(job.state)) requireThat(job.selectedMasterId && job.reservation && job.financial && job.chatId, 'InvalidReference');
  for (const [masterId, offer] of Object.entries(job.offers)) {
    requireDifferentJobParties(job.clientId, masterId);
    const thread = own(state.threads, offer.chatId);
    requireThat(offer.masterId === masterId && offer.jobId === job.id && offer.catalogKey === job.snapshot?.catalogKey && own(state.users, masterId)?.id === masterId &&
      thread?.id === offer.chatId && thread.context.type === 'job' && thread.context.jobId === job.id &&
      thread.context.clientId === job.clientId && thread.context.masterId === masterId, 'InvalidReference');
  }
  if (job.selectedMasterId !== null || job.reservation !== null || job.chatId !== null || job.financial !== null) {
    requireThat(job.selectedMasterId && job.reservation && job.financial, 'InvalidReference');
    requireDifferentJobParties(job.clientId, job.selectedMasterId);
    const selected = own(job.offers, job.selectedMasterId);
    requireThat(selected?.state === 'selected' && selected.chatId === job.chatId && job.reservation.masterId === job.selectedMasterId, 'InvalidReference');
    requireThat(selected.final && job.financial.fap === selected.final.amount && job.financial.currency === 'THB', 'ProviderConflict');
    validateFinancialSnapshot(job.financial);
    const selection = state.events.filter(record => record.type === 'master_selected' && record.subjectId === job.id);
    requireThat(selection.length === 1 && selection[0]!.at === job.reservation.selectedAt &&
      selection[0]!.actorId === job.clientId && selection[0]!.recipients.includes(job.selectedMasterId), 'InvalidReference');
    const originalPolicy = state.policies.find(policy => policy.version === selection[0]!.facts.policyVersion);
    requireThat(originalPolicy && originalPolicy.effectiveAt <= selection[0]!.at && job.financial.policyVersion === originalPolicy.version &&
      selection[0]!.facts.fap === job.financial.fap && selection[0]!.facts.currency === 'THB' &&
      selection[0]!.facts.masterId === job.selectedMasterId, 'InvalidReference');
    for (const key of ['commission', 'mutualCancellationFee', 'falseCallFee', 'falseCallMasterShare'] as const) requireThat(
      job.financial[key].numerator === originalPolicy[key].numerator && job.financial[key].denominator === originalPolicy[key].denominator, 'InvalidReference');
    const selectedSource = state.events.filter(record => record.type === 'operation:select_master' && record.operationId === selection[0]!.operationId);
    requireThat(selectedSource.length === 1 && selectedSource[0]?.proof?.kind === 'offer' &&
      sameFact(selectedSource[0].proof.financial, job.financial) && selectedSource[0].proof.offer.id === selected.id, 'InvalidReference');
    requireThat(['reserved', 'assigned', 'working', 'client_accepted', 'completed', 'cancelled', 'expired'].includes(job.state), 'InvalidReference');
    const mode = own(state.threads, selected.chatId)!.mode;
    requireThat(job.state === 'reserved' ? job.reservation.state === 'reserved' && mode === 'temporary' :
      job.state === 'expired' ? job.reservation.state === 'released' && mode === 'closed' : job.reservation.state === 'assigned' &&
      (['completed', 'cancelled'].includes(job.state) ? mode === 'closed' : mode === 'working'), 'InvalidReference');
    for (const operation of job.reservation.operations) requirePaymentOperation(operation, job.financial, job.id);
    // A mutable status cannot undo a previously confirmed financial fact.
    for (const record of state.events.filter(record => record.type === 'operation:payment_outcome' && record.facts.jobId === id &&
      (record.facts.status === 'success' || record.facts.status === 'failed'))) {
      const operation = job.reservation.operations.find(operation => operation.id === record.facts.operationId);
      requireThat(operation && operation.status === record.facts.status && record.facts.amount === operation.amount &&
        record.facts.currency === 'THB' && record.facts.kind === 'payment' && record.facts.obligationId === id &&
        record.facts.beneficiaryId === 'helpy' && record.facts.destinationId === null, 'ProviderConflict');
    }
    if (job.reservation.state === 'reserved') {
      requireThat(!job.reservation.operations.some(operation => operation.status === 'success'), 'FundsMismatch');
      for (const operation of job.reservation.operations.filter(operation => operation.status === 'pending' || operation.status === 'unknown'))
        requireThat(job.reservation.method === operation.route, 'ProviderConflict');
    }
    if (['assigned', 'working', 'client_accepted', 'completed', 'cancelled'].includes(job.state)) {
      requireFunding(job, state.events);
      requireThat(job.reservation.method === 'cash' ? job.funds === 'none' : job.funds ===
        (job.state === 'completed' ? 'releasable' : job.state === 'cancelled' ? 'allocated' : 'held'), 'FundsMismatch');
    }
    if (job.state === 'client_accepted' || job.state === 'completed') requireAcceptance(job, state.events);
    requireFinancialHistory(state, job.reservation.operations, 'payment', job.id, job.id);
    const failures = state.events.filter(record => record.type === 'operation:payment_outcome' && record.context.kind === 'job' &&
      record.context.jobId === id && record.facts.status === 'failed');
    requireThat(job.reservation.resetUsed === (failures.length > 0), 'InvalidReference');
  }
  const payout = own(state.payouts, id);
  if (payout) {
    Validate.transfer(payout); Validate.repositoryRecord(payout.snapshot);
    requireThat(payout.jobId === id && payout.masterId === job.selectedMasterId && job.state === 'completed' && job.reservation?.method !== 'cash' && job.funds === 'releasable' && job.financial &&
      payout.snapshot.fap === job.financial.fap && payout.snapshot.policyVersion === job.financial.policyVersion &&
      payout.snapshot.currency === job.financial.currency, 'InvalidReference');
    for (const key of ['commission', 'mutualCancellationFee', 'falseCallFee', 'falseCallMasterShare'] as const) requireThat(
      payout.snapshot[key].numerator === job.financial[key].numerator && payout.snapshot[key].denominator === job.financial[key].denominator, 'InvalidReference');
    requirePayoutCalculation(payout);
    const completions = state.events.filter(record => record.type === 'completed' && record.subjectId === id);
    const completion = completions[0];
    requireThat(completions.length === 1 && completion && completion.at === job.completedAt && payout.createdAt === completion.at &&
      completion.facts.payoutId === payout.id && completion.facts.commission === payout.commission &&
      completion.facts.debtBefore === payout.debtBefore && completion.facts.netBeforeDebt === payout.netBeforeDebt &&
      completion.facts.debtRecovery === payout.debtRecovery && completion.facts.payoutAmount === payout.amount, 'InvalidReference');
    const recoveryId = `recovery:${id}`;
    const recoveries = Object.values(state.ledger).filter(entry => entry.id === recoveryId || entry.basis === recoveryId);
    requireThat(payout.debtRecovery === 0n ? recoveries.length === 0 : recoveries.length === 1 &&
      own(state.ledger, recoveryId) === recoveries[0] && recoveries[0]?.id === recoveryId && recoveries[0].basis === recoveryId &&
      recoveries[0].masterId === payout.masterId && recoveries[0].change === -payout.debtRecovery &&
      recoveries[0].at === payout.createdAt && recoveries[0].actorId === completion.actorId, 'InvalidReference');
    for (const attempt of payout.attempts) requireOperation(attempt, payout.amount, {
      kind: 'payout', jobId: id, obligationId: payout.id, beneficiaryId: payout.masterId, destinationId: attempt.destinationId,
    });
    requireTransferHistory(state, payout, 'operation:payout_outcome', payout.id);
  }
  requireThat(job.state !== 'cancelled' || job.resolutionId && own(state.cases, job.resolutionId)?.status === 'decided', 'InvalidReference');
  if (job.resolutionId) {
    const resolution = own(state.cases, job.resolutionId);
    requireThat(resolution?.jobId === id && resolution.id === job.resolutionId && resolution.requestId === (job.cancellation?.id ?? null), 'InvalidReference');
    const opened = openings[0];
    requireThat(opened?.subjectId === resolution.id && opened.proof?.kind === 'resolution' &&
      ['id', 'jobId', 'openedAt', 'snapshotPolicy', 'evidence'].every(key => sameFact(resolution[key as keyof typeof resolution],
        opened.proof?.kind === 'resolution' ? opened.proof.resolution[key as keyof typeof resolution] : null)), 'InvalidReference');
    const decisions = state.events.filter(record => record.type === 'operation:decide_resolution' && record.context.kind === 'job' && record.context.jobId === id);
    requireThat(resolution.status === 'decided' ? decisions.length === 1 && resolution.decision !== null :
      decisions.length === 0 && resolution.decision === null && (resolution.status === 'admin_resolution_pending' ||
        resolution.status === 'closed_by_master_completion' && job.state === 'completed'), 'InvalidReference');
    if (resolution.status === 'decided') requireResolution(state, job);
  }
  if (job.cancellation && job.state !== 'client_accepted') requireCancellation(state, job);
  requireWorkEvidence(job, state.events);
  requireOffers(state, job);
  requireJobTimers(state, job);
  const closures = state.events.filter(record => ['publication_closed', 'reservation_released'].includes(record.type) &&
    record.context.kind === 'job' && record.context.jobId === id);
  requireThat(job.state === 'expired' ? closures.length === 1 : closures.length === 0, 'InvalidReference');
  if (job.state === 'expired') {
    const closure = closures[0]!;
    requireThat(closure.type === (job.reservation ? 'reservation_released' : 'publication_closed') &&
      state.events.some(record => record.operationId === closure.operationId && record.context.kind === 'job' && record.context.jobId === id &&
        (job.reservation ? ['operation:reservation_deadline', 'operation:decline_reservation'] :
          ['operation:publication_deadline', 'operation:terminate_negotiation']).includes(record.type)), 'InvalidReference');
  }
  if (job.state === 'completed') requireCompletion(state, job);
  else requireThat(job.completedAt === null && !state.events.some(record => record.type === 'completed' && record.context.kind === 'job' && record.context.jobId === id), 'InvalidReference');
  return job;
}

export function threadById(state: CoreState, id: string) {
  const thread = own(state.threads, id); requireThat(thread && thread.id === id, 'NotFound');
  Validate.thread(thread);
  if (thread.context.type === 'job') {
    const job = jobById(state, thread.context.jobId); const offer = own(job.offers, thread.context.masterId);
    requireThat(offer?.chatId === id && thread.context.clientId === job.clientId, 'InvalidReference');
    if (thread.mode === 'working') requireThat(job.chatId === id && job.selectedMasterId === thread.context.masterId, 'InvalidReference');
  } else {
    requireSupportContext(thread, state.events);
    if (thread.context.basis === 'repayment') {
      const request = own(state.repayments, thread.context.basisId);
      requireThat(request?.masterId === thread.context.userId && request.supportChatId === id && thread.context.userRole === 'master', 'InvalidReference');
    } else {
      requireThat(thread.context.basis === 'resolution', 'InvalidReference');
      const resolution = own(state.cases, thread.context.basisId); requireThat(resolution, 'InvalidReference');
      const job = jobById(state, resolution.jobId);
      requireThat(thread.context.userId === (thread.context.userRole === 'client' ? job.clientId : job.selectedMasterId), 'InvalidReference');
    }
  }
  return thread;
}

export function settlementById(state: CoreState, id: string) {
  const obligation = own(state.obligations, id); requireThat(obligation && obligation.id === id, 'NotFound');
  Validate.transfer(obligation);
  const job = jobById(state, obligation.jobId); const resolution = job.resolutionId ? own(state.cases, job.resolutionId) : null;
  requireThat(['refund', 'compensation'].includes(obligation.kind) && resolution?.status === 'decided' && resolution.decision?.id === obligation.decisionId && job.state === 'cancelled' &&
    job.reservation?.method !== 'cash' && job.funds === 'allocated' &&
    obligation.beneficiaryId === (obligation.kind === 'refund' ? job.clientId : job.selectedMasterId) &&
    obligation.currency === 'THB' && obligation.amount > 0n && obligation.amount === (obligation.kind === 'refund' ? resolution.decision.allocation?.clientRefund : resolution.decision.allocation?.masterCompensation) &&
    job.reservation && job.financial && confirmedPayment(job.reservation, job.financial, job.id).id === obligation.sourcePaymentId, 'InvalidReference');
  for (const attempt of obligation.attempts) requireOperation(attempt, obligation.amount, {
    kind: obligation.kind, jobId: job.id, obligationId: obligation.id, beneficiaryId: obligation.beneficiaryId, destinationId: attempt.destinationId,
  });
  requireTransferHistory(state, obligation, 'operation:settlement_outcome', id);
  return obligation;
}

function requireTransferHistory(state: CoreState, transfer: { readonly attempts: readonly TransferAttempt[]; readonly settled: boolean }, type: 'operation:payout_outcome' | 'operation:settlement_outcome', obligationId: string): void {
  requireTransferState(transfer);
  const confirmed = state.events.filter(record => record.type === type && record.facts.obligationId === obligationId && record.facts.status === 'success');
  const successful = transfer.attempts.find(attempt => attempt.status === 'success');
  requireThat(successful ? confirmed.length > 0 && confirmed.every(record => record.facts.operationId === successful.id &&
    record.facts.amount === successful.amount && record.facts.currency === successful.currency && record.facts.kind === successful.binding.kind &&
    record.facts.jobId === successful.binding.jobId && record.facts.beneficiaryId === successful.binding.beneficiaryId &&
    record.facts.destinationId === successful.destinationId) : confirmed.length === 0, 'ProviderConflict');
  const attempt = transfer.attempts[0];
  const origin = state.events.find(record => record.proof?.kind === 'instruction' && record.proof.operation.binding.obligationId === obligationId &&
    (type === 'operation:payout_outcome' ? record.proof.operation.binding.kind === 'payout' : record.proof.operation.binding.kind !== 'payout' && record.proof.operation.binding.kind !== 'payment'));
  const binding = attempt?.binding ?? (origin?.proof?.kind === 'instruction' ? origin.proof.operation.binding : null);
  if (binding) requireFinancialHistory(state, transfer.attempts, binding.kind, binding.jobId, obligationId);
}

function requireFinancialHistory(state: CoreState, operations: readonly (PaymentOperation | TransferAttempt)[], kind: 'payment' | 'payout' | 'refund' | 'compensation', jobId: string, obligationId: string): void {
  const starts = state.events.filter(record => record.proof?.kind === 'instruction' && record.proof.operation.binding.kind === kind &&
    record.proof.operation.binding.jobId === jobId && record.proof.operation.binding.obligationId === obligationId);
  requireThat(starts.length === operations.length && new Set(operations.map(operation => operation.id)).size === operations.length, 'ProviderConflict');
  const callbacks = state.events.filter(record => record.proof?.kind === 'provider' && record.proof.outcome.binding.kind === kind &&
    record.proof.outcome.binding.jobId === jobId && record.proof.outcome.binding.obligationId === obligationId);
  for (const callback of callbacks) {
    const proof = callback.proof; requireThat(proof?.kind === 'provider' && operations.some(operation => operation.id === proof.outcome.operationId), 'ProviderConflict');
  }
  for (const [index, operation] of operations.entries()) {
    const source = starts[index]; requireThat(source?.proof?.kind === 'instruction', 'ProviderConflict');
    const original = source.proof.operation;
    requireThat(source.context.kind === 'job' && source.context.jobId === jobId && source.at === operation.initiatedAt &&
      original.status === 'pending' && original.reason === null && sameFact(original, { ...operation, status: 'pending', reason: null }) &&
      source.type === (kind === 'payment' ? 'operation:initiate_payment' : kind === 'payout' ? 'operation:start_payout' : 'operation:start_settlement'), 'ProviderConflict');
    const requested = state.events.filter(record => record.type === (kind === 'payment' ? 'payment_requested' : 'payout_requested') &&
      record.operationId === source.operationId && record.subjectId === operation.id && record.context.kind === 'job' && record.context.jobId === jobId);
    requireThat(requested.length === 1 && operation.providerDeadline === operation.providerTimer.deadline, 'ProviderConflict');
    let status: ProviderStatus = 'pending'; let reason: FailureReason | null = null;
    for (const record of callbacks) {
      const result = record.proof; requireThat(result?.kind === 'provider', 'ProviderConflict');
      const value = result.outcome; if (value.operationId !== operation.id) continue;
      requireThat(state.events.indexOf(record) > state.events.indexOf(source) && sameFact(value.binding, original.binding) &&
        value.amount === original.amount && value.currency === 'THB' && ['pending', 'unknown', 'failed', 'success'].includes(value.status) &&
        (!(status === 'success' || status === 'failed') || value.status === status) && record.facts.operationId === value.operationId &&
        record.facts.status === value.status && record.facts.amount === value.amount, 'ProviderConflict');
      status = value.status; reason = value.status === 'failed' ? value.reason ?? 'unspecified' : null;
    }
    requireThat(operation.status === status && operation.reason === reason && (index === operations.length - 1 || status === 'failed'), 'ProviderConflict');
  }
}

function requireOffers(state: CoreState, job: Job): void {
  const history = state.events.filter(record => record.context.kind === 'job' && record.context.jobId === job.id);
  const bilateralCycles = new Set<number>();
  for (const offer of Object.values(job.offers)) {
    const records = history.filter(record => record.proof?.kind === 'offer' && record.proof.offer.id === offer.id);
    const originals = records.filter(record => record.type === 'operation:initial_offer');
    const source = originals[0]; requireThat(originals.length === 1 && source?.proof?.kind === 'offer', 'InvalidReference');
    const original = source.proof.offer;
    requireThat(source.actorId === offer.masterId && source.actorRole === 'master' && source.at === offer.initialAt &&
      ['id', 'jobId', 'masterId', 'chatId', 'catalogKey', 'initialPrice', 'initialAt'].every(key =>
        sameFact(offer[key as keyof typeof offer], original[key as keyof typeof original])), 'InvalidReference');
    const thread = own(state.threads, offer.chatId)!;
    messageRecords(thread, history);
    const messages = thread.messageIds.map(id => {
      const message = own(state.messages, id); requireThat(message, 'InvalidReference');
      const sent = history.filter(record => record.type === 'operation:message' && record.proof?.kind === 'message' && record.proof.message.id === id);
      requireThat(sent.length === 1 && sent[0]?.proof?.kind === 'message' && sameFact(sent[0].proof.message, message) &&
        sent[0].actorId === message.authorId && message.chatId === thread.id, 'InvalidReference');
      return sent[0];
    });
    const spoke = (role: 'client' | 'master', before = state.events.length, temporary = false) => messages.some(record =>
      state.events.indexOf(record) < before && record.actorRole === role && record.actorId === (role === 'client' ? job.clientId : offer.masterId) &&
      (!temporary || record.proof?.kind === 'message' && record.proof.mode === 'temporary'));
    requireThat(thread.clientSpoke === spoke('client') && thread.masterSpoke === spoke('master') &&
      thread.protected === (spoke('client', state.events.length, true) && spoke('master', state.events.length, true)), 'InvalidReference');
    const temporary = messages.filter(record => record.proof?.kind === 'message' && record.proof.mode === 'temporary');
    const last = temporary.at(-1);
    const waitingFor = job.state === 'published' && offer.state === 'open' && last ?
      last.actorRole === 'client' ? offer.masterId : job.clientId : null;
    const notice: { language: string | null; pending: boolean } = { language: null, pending: false };
    for (const record of temporary) {
      requireThat(record.proof?.kind === 'message', 'InvalidReference');
      const language = record.proof.message.originalLanguage;
      if (record.actorRole === 'client' && language && notice.language !== language) { notice.language = language; notice.pending = true; }
      else if (record.actorRole === 'master' && notice.language !== null) notice.pending = false;
    }
    if (job.state === 'published' && offer.state === 'open') requireThat(thread.waitingFor === waitingFor, 'InvalidReference');
    requireThat(sameFact(thread.languageNotice, notice.language === null ? null : notice), 'InvalidReference');
    if (thread.protected) bilateralCycles.add(source.proof.cycleIndex);
    if (offer.state === 'closed') {
      const terminated = records.find(record => record.type === 'operation:terminate_negotiation');
      const selected = history.find(record => record.type === 'master_selected' && record.facts.masterId !== offer.masterId);
      const originCycle = job.cycles[source.proof.cycleIndex];
      requireThat(offer.closedReason === 'not_selected' ? selected && history.some(record => record.type === 'chat_closed' &&
        record.subjectId === thread.id && record.operationId === selected.operationId) : offer.closedReason === 'expired' ?
        !thread.protected && originCycle?.countdown && history.some(record => ['operation:publication_deadline', 'operation:terminate_negotiation'].includes(record.type) &&
          record.at >= originCycle.countdown!.deadline) : terminated?.proof?.kind === 'offer' && terminated.proof.offer.state === 'closed' &&
          terminated.proof.offer.closedReason === offer.closedReason, 'InvalidReference');
      if (terminated) requireThat(history.filter(record => record.type === 'negotiations_closed' && record.operationId === terminated.operationId &&
        record.subjectId === offer.id).length === 1, 'InvalidReference');
      requireThat(thread.mode === 'closed', 'InvalidReference');
    } else requireThat(offer.state === 'open' ? offer.closedReason === null && thread.mode === 'temporary' :
      offer.state === 'selected' && job.selectedMasterId === offer.masterId, 'InvalidReference');
    for (const [command, eventType, actorId] of [['initial_offer', 'initial_offer_sent', offer.masterId], ['revise_price', 'price_adjustment_requested', offer.masterId],
      ['approve_price', offer.revised?.approvedAt !== null ? 'price_adjustment_approved' : 'price_adjustment_rejected', job.clientId], ['final_application', 'final_application_sent', offer.masterId]] as const) {
      const steps = records.filter(record => record.type === `operation:${command}`);
      const needed = command === 'initial_offer' || command === 'revise_price' && offer.revised !== null ||
        command === 'approve_price' && offer.revised !== null && (offer.revised.approvedAt !== null || offer.revised.rejectedAt !== null) || command === 'final_application' && offer.final !== null;
      requireThat(steps.length === (needed ? 1 : 0), 'InvalidReference');
      if (!needed) continue;
      const step = steps[0]!; requireThat(step.proof?.kind === 'offer' && step.actorId === actorId, 'InvalidReference');
      requireThat(history.filter(record => record.type === eventType && record.operationId === step.operationId && record.subjectId === offer.id).length === 1, 'InvalidReference');
      if (command === 'revise_price') {
        const index = state.events.indexOf(step);
        requireThat(spoke('client', index, true) && spoke('master', index, true) && offer.revised && step.proof.offer.revised &&
          offer.revised.amount === step.proof.offer.revised.amount && offer.revised.reason === step.proof.offer.revised.reason &&
          offer.revised.requestedAt === step.at && step.at === step.proof.offer.revised.requestedAt, 'InvalidReference');
      }
      if (command === 'approve_price') requireThat(sameFact(offer.revised, step.proof.offer.revised) &&
        (offer.revised?.approvedAt ?? offer.revised?.rejectedAt) === step.at, 'InvalidReference');
      if (command === 'final_application') requireThat(sameFact(offer.final, step.proof.offer.final) && offer.final?.sentAt === step.at &&
        offer.final.amount === (offer.revised?.amount ?? offer.initialPrice) && (!offer.revised || offer.revised.approvedAt !== null), 'InvalidReference');
    }
  }
  requireThat(new Set(job.excludedMasters).size === job.excludedMasters.length && sameFact([...job.excludedMasters].sort(),
    Object.values(job.offers).filter(offer => offer.state === 'closed').map(offer => offer.masterId).sort()), 'InvalidReference');
  for (const [index, cycle] of job.cycles.entries()) {
    requireThat(cycle.index === index && cycle.hadBilateral === bilateralCycles.has(index), 'InvalidReference');
    const started = history.find(record => record.timers.some(fact => fact.kind === 'publication' && fact.index === index));
    requireThat(started?.at === cycle.publishedAt, 'InvalidReference');
    const selected = history.find(record => record.type === 'master_selected');
    const closed = history.find(record => record.type === 'publication_closed');
    const endedAt = job.cycles[index + 1]?.publishedAt ?? selected?.at ?? closed?.at ?? null;
    requireThat(cycle.endedAt === endedAt, 'InvalidReference');
  }
}

function requireCancellation(state: CoreState, job: Job): void {
  const request = job.cancellation!;
  const history = state.events.filter(record => record.context.kind === 'job' && record.context.jobId === job.id);
  const requested = history.filter(record => record.type === 'operation:cancel' && record.proof?.kind === 'cancellation' && record.proof.request.id === request.id);
  const source = requested[0];
  requireThat(requested.length === 1 && source?.proof?.kind === 'cancellation' && source.actorId === request.initiator && source.at === request.requestedAt, 'InvalidReference');
  const original = source.proof.request;
  for (const key of ['id', 'initiator', 'reason', 'explanation', 'remainingWork', 'classification', 'evidence', 'requestedAt', 'responseTimer'] as const)
    requireThat(sameFact(request[key], original[key]), 'InvalidReference');
  const responses = history.filter(record => record.type === 'operation:cancellation_response' && record.proof?.kind === 'cancellation' && record.proof.request.id === request.id);
  requireThat(responses.length === (request.response ? 1 : 0), 'InvalidReference');
  if (request.response) {
    const response = responses[0]; requireThat(response?.proof?.kind === 'cancellation' && response.actorId === request.response.actorId &&
      response.at === request.response.at && response.actorId === (request.initiator === job.clientId ? job.selectedMasterId : job.clientId) &&
      sameFact(request.response, response.proof.request.response) && request.workStopped === response.proof.request.workStopped &&
      request.financialConsent === response.proof.request.financialConsent && request.responseExplanation === response.proof.request.responseExplanation &&
      history.filter(record => record.type === 'cancellation_response' && record.operationId === response.operationId).length === 1, 'InvalidReference');
  } else requireThat(request.workStopped === null && request.financialConsent === null && request.responseExplanation === null, 'InvalidReference');
}

function requireResolution(state: CoreState, job: Job): void {
  const resolution = own(state.cases, job.resolutionId!)!;
  const decision = resolution.decision; requireThat(decision && job.financial, 'InvalidReference');
  const sources = state.events.filter(record => record.type === 'operation:decide_resolution' && record.proof?.kind === 'resolution' &&
    record.proof.resolution.id === resolution.id && record.context.kind === 'job' && record.context.jobId === job.id);
  const source = sources[0];
  requireThat(sources.length === 1 && source?.proof?.kind === 'resolution' && sameFact(source.proof.resolution.decision, decision) &&
    source.actorRole === 'admin' && source.actorId === decision.actorId && source.at === decision.at && decision.caseId === resolution.id &&
    state.events.filter(record => record.type === 'resolution_decided' && record.operationId === source.operationId && record.subjectId === resolution.id).length === 1, 'InvalidReference');
  if (decision.type === 'exceptional_completion') { requireThat(job.state === 'completed' && decision.allocation === null, 'InvalidReference'); return; }
  requireThat(job.state === 'cancelled', 'InvalidReference');
  if (job.reservation?.method === 'cash') {
    requireThat(decision.allocation === null && !Object.values(state.obligations).some(value => value.jobId === job.id), 'InvalidReference'); return;
  }
  requireThat(decision.allocation && sameFact(decision.allocation, allocation(job.financial, decision.type, decision.allocation)), 'InvalidReference');
  const expected = [['refund', job.clientId, decision.allocation.clientRefund], ['compensation', job.selectedMasterId, decision.allocation.masterCompensation]] as const;
  const obligations = Object.values(state.obligations).filter(value => value.jobId === job.id);
  requireThat(obligations.length === expected.filter(([, , amount]) => amount > 0n).length, 'InvalidReference');
  for (const [kind, beneficiaryId, amount] of expected) {
    const id = `${decision.id}:${kind}`, obligation = own(state.obligations, id);
    requireThat(amount === 0n ? !obligation : obligation && obligation.id === id && obligation.kind === kind && obligation.jobId === job.id &&
      obligation.decisionId === decision.id && obligation.beneficiaryId === beneficiaryId && obligation.amount === amount && obligation.createdAt === decision.at &&
      obligation.currency === 'THB' && job.reservation && confirmedPayment(job.reservation, job.financial, job.id).id === obligation.sourcePaymentId, 'InvalidReference');
  }
}

export function requireCompletion(state: CoreState, job: Job): void {
  const records = state.events.filter(record => record.type === 'completed' && record.context.kind === 'job' && record.context.jobId === job.id);
  const completed = records[0];
  requireThat(job.state === 'completed' && records.length === 1 && completed && completed.at === job.completedAt && job.financial && job.selectedMasterId &&
    (completed.actorRole === 'master' && completed.actorId === job.selectedMasterId || completed.actorRole === 'admin') &&
    state.events.some(record => record.operationId === completed.operationId && (record.type === 'operation:complete' || record.type === 'operation:decide_resolution')), 'InvalidReference');
  const source = state.events.find(record => record.operationId === completed.operationId && record.type.startsWith('operation:'));
  requireThat(source && source.actorId === completed.actorId && source.actorRole === completed.actorRole &&
    (completed.actorRole === 'master' ? source.type === 'operation:complete' : source.type === 'operation:decide_resolution' &&
      source.proof?.kind === 'resolution' && source.proof.resolution.decision?.type === 'exceptional_completion'), 'InvalidReference');
  requireAcceptance(job, state.events); requireFunding(job, state.events);
  if (job.reservation?.method === 'cash') {
    const id = `commission:${job.id}`, entry = own(state.ledger, id), fee = portion(job.financial.fap, job.financial.commission);
    requireThat(entry && entry.id === id && entry.basis === id && entry.masterId === job.selectedMasterId && entry.change === fee &&
      entry.at === job.completedAt && entry.actorId === completed.actorId && completed.facts.commission === fee, 'InvalidReference');
  } else requireThat(own(state.payouts, job.id), 'InvalidReference');
}

export function reviewById(state: CoreState, id: string) {
  const review = own(state.reviews, id); requireThat(review && review.id === id, 'NotFound');
  const job = jobById(state, review.jobId);
  requireThat(job.state === 'completed' && review.clientId === job.clientId && review.masterId === job.selectedMasterId, 'InvalidReference');
  const records = state.events.filter(record => record.proof?.kind === 'review' && record.proof.review.id === id);
  const originals = records.filter(record => record.type === 'operation:review'), original = originals[0];
  requireThat(originals.length === 1 && original?.proof?.kind === 'review' && original.actorRole === 'client' &&
    original.actorId === review.clientId && original.at === review.createdAt && original.context.kind === 'job' &&
    original.context.jobId === job.id && sameFact(original.proof.review, { ...review, hidden: false, moderation: null }), 'InvalidReference');
  const decisions = records.filter(record => record.type === 'operation:hide_review'), decision = decisions[0];
  requireThat(records.length === 1 + decisions.length && (review.hidden === false ? decisions.length === 0 && review.moderation === null :
    review.hidden === true && decisions.length === 1 && decision?.proof?.kind === 'review' && review.moderation &&
    decision.actorRole === 'admin' && decision.actorId === review.moderation.actorId && decision.at === review.moderation.at &&
    decision.context.kind === 'job' && decision.context.jobId === job.id && sameFact(decision.proof.review, review) &&
    state.events.indexOf(decision) > state.events.indexOf(original) && state.events.filter(record => record.type === 'review_hidden' &&
      record.operationId === decision.operationId && record.subjectId === id && record.actorId === decision.actorId &&
      record.facts.jobId === job.id && record.facts.reason === review.moderation!.reason).length === 1), 'InvalidReference');
  return review;
}

export function repaymentById(state: CoreState, id: string) {
  const request = own(state.repayments, id); requireThat(request && request.id === id, 'NotFound');
  const records = state.events.filter(record => record.context.kind === 'repayment' && record.context.requestId === id && record.proof?.kind === 'repayment');
  const initial = records.find(record => record.type === 'operation:request_repayment');
  requireThat(initial?.proof?.kind === 'repayment' && initial.actorRole === 'master' && initial.actorId === request.masterId &&
    initial.at === request.requestedAt && initial.proof.request.amount === request.amount && initial.proof.request.masterId === request.masterId, 'InvalidRepayment');
  const opened = state.events.filter(record => record.type === 'support_opened' && record.context.kind === 'support' &&
    record.context.basis === 'repayment' && record.context.basisId === id);
  requireThat(opened.length === (request.supportChatId === null ? 0 : 1) &&
    opened.every(record => record.subjectId === request.supportChatId), 'InvalidReference');
  if (request.supportChatId) {
    const thread = own(state.threads, request.supportChatId);
    requireThat(thread?.context.type === 'support' && thread.context.basis === 'repayment' && thread.context.basisId === id &&
      thread.context.userId === request.masterId && thread.context.userRole === 'master', 'InvalidReference');
    requireSupportContext(thread, state.events);
  }
  const agreements = records.filter(record => record.type === 'operation:agree_repayment');
  const agreement = agreements.at(-1);
  for (const record of agreements) {
    requireThat(record.proof?.kind === 'repayment', 'InvalidRepayment'); const agreed = record.proof.request;
    requireThat(state.events.filter(event => event.type === 'debt_repayment_agreed' && event.operationId === record.operationId &&
      event.context.kind === 'repayment' && event.context.requestId === id && event.facts.amount === agreed.agreedAmount &&
      event.facts.method === agreed.method && event.facts.agreementId === agreed.agreementId).length === 1, 'InvalidRepayment');
  }
  if (request.agreedAmount !== null || request.method !== null || request.agreementId !== null || request.status === 'agreed' || request.status === 'received') {
    requireThat(request.supportChatId && agreement?.proof?.kind === 'repayment' && agreement.actorRole === 'admin' &&
      request.agreementId === agreement.proof.request.agreementId && request.agreedAmount === agreement.proof.request.agreedAmount &&
      request.method === agreement.proof.request.method && request.supportChatId === agreement.proof.request.supportChatId, 'InvalidRepayment');
  } else requireThat(!agreement, 'InvalidRepayment');
  const received = records.filter(record => record.type === 'operation:receive_repayment');
  if (request.status === 'received') {
    const source = received[0], receipt = request.receiptId ? own(state.receipts, request.receiptId) : null;
    requireThat(received.length === 1 && source?.proof?.kind === 'repayment' && source.actorRole === 'admin' && receipt &&
      sameFact(receipt, source.proof.receipt) && receipt.requestId === id && receipt.masterId === request.masterId &&
      receipt.amount === request.agreedAmount && receipt.method === request.method, 'InvalidRepayment');
    const entry = own(state.ledger, receipt.id);
    requireThat(entry && entry.id === receipt.id && entry.basis === `repayment:${id}` && entry.masterId === request.masterId &&
      entry.change === -receipt.amount && entry.at === receipt.receivedAt && entry.actorId === receipt.actorId, 'InvalidRepayment');
  } else requireThat(received.length === 0 && request.receiptId === null, 'InvalidRepayment');
  if (request.status === 'closed') requireThat(records.some(record => record.type === 'operation:close_repayment' && record.actorRole === 'admin'), 'InvalidRepayment');
  const latest = records.at(-1);
  // Support creation is the only transition recorded in the chat context rather
  // than the repayment context. All other saved fields follow the last command.
  requireThat(latest?.proof?.kind === 'repayment' &&
    sameFact(request, { ...latest.proof.request, supportChatId: request.supportChatId }), 'InvalidRepayment');
  return request;
}

export function requireNewIdentity(state: CoreState, kind: 'job' | 'catalog' | 'repayment' | 'chat' | 'message' | 'inbox' | 'feedback' | 'offer' | 'cancellation' | 'resolution' | 'decision' | 'review', id: string): void {
  // Losing a mutable projection does not retire its original business identity.
  if (kind === 'catalog') requireCatalogInventory(state);
  const used = state.events.some(record => {
    const proof = record.proof;
    switch (kind) {
      case 'job': return record.context.kind === 'job' && record.context.jobId === id;
      case 'catalog': return proof?.kind === 'catalog' && (proof.key === id || proof.initial?.some(catalog => catalogKey(catalog) === id));
      case 'repayment': return record.context.kind === 'repayment' && record.context.requestId === id ||
        record.context.kind === 'support' && record.context.basis === 'repayment' && record.context.basisId === id || proof?.kind === 'repayment' && proof.request.id === id;
      case 'chat': return record.context.kind === 'support' && record.context.chatId === id ||
        record.type === 'support_opened' && record.subjectId === id || record.type === 'chat_message' && record.facts.chatId === id ||
        proof?.kind === 'offer' && proof.offer.chatId === id || proof?.kind === 'message' && proof.message.chatId === id;
      case 'message': return record.type === 'chat_message' && record.subjectId === id || proof?.kind === 'message' && proof.message.id === id;
      case 'inbox': return record.type === 'inbox_message' && record.subjectId === id || proof?.kind === 'inbox' && proof.message.id === id;
      case 'feedback': return record.type === 'feedback_received' && record.subjectId === id;
      case 'offer': return record.type === 'initial_offer_sent' && record.subjectId === id || proof?.kind === 'offer' && proof.offer.id === id;
      case 'cancellation': return proof?.kind === 'cancellation' && proof.request.id === id || proof?.kind === 'resolution' && proof.resolution.requestId === id;
      case 'resolution': return ['resolution_opened', 'resolution_decided', 'resolution_inspected'].includes(record.type) && record.subjectId === id ||
        record.context.kind === 'support' && record.context.basis === 'resolution' && record.context.basisId === id || proof?.kind === 'resolution' && proof.resolution.id === id;
      case 'decision': return proof?.kind === 'resolution' && proof.resolution.decision?.id === id;
      case 'review': return record.type === 'review_hidden' && record.subjectId === id || proof?.kind === 'review' && proof.review.id === id;
    }
  });
  requireThat(!used, 'Conflict');
}

export function requireOperationIdentity(state: CoreState, id: string, callback = false): void {
  const operations = [...Object.values(state.jobs).flatMap(job => job.reservation?.operations ?? []),
    ...Object.values(state.payouts).flatMap(payout => payout.attempts), ...Object.values(state.obligations).flatMap(obligation => obligation.attempts)];
  requireThat(operations.filter(operation => operation.id === id).length === (callback ? 1 : 0), callback ? 'ProviderConflict' : 'Conflict');
  requireThat(state.events.filter(record => record.proof?.kind === 'instruction' && record.proof.operation.id === id).length === (callback ? 1 : 0), callback ? 'ProviderConflict' : 'Conflict');
}

export function requireThreshold(state: CoreState, masterId: string): void {
  const origins = state.events.filter(record => record.type === 'operation:threshold');
  for (const record of origins) requireThat(record.actorRole === 'admin' && record.proof?.kind === 'threshold', 'InvalidReference');
  const updates = origins.filter(record => record.proof?.kind === 'threshold' && record.proof.masterId === masterId);
  const expected = updates.map(record => ({ masterId, amount: record.proof?.kind === 'threshold' ? record.proof.amount : null, version: record.operationId, effectiveAt: record.at }));
  requireThat(sameFact(state.thresholdHistory.filter(record => record.masterId === masterId), expected), 'InvalidReference');
  const latest = updates.at(-1);
  if (latest?.proof?.kind === 'threshold') requireThat(latest.proof.amount === null ? !Object.hasOwn(state.thresholds, masterId) :
    own(state.thresholds, masterId) === latest.proof.amount, 'InvalidReference');
}
export function debtView(state: CoreState, masterId: string, policy: Policy) {
  requireThreshold(state, masterId);
  return financialDebtView(state, masterId, policy);
}

export function financialRecords(state: CoreState): readonly { readonly id: string; readonly at: number }[] {
  const paymentRecords = Validate.object({ reservation: Validate.nullable(Validate.object({ operations: Validate.list(Validate.repositoryRecord, 'InvalidReference') }, 'InvalidReference')) }, 'InvalidReference');
  for (const job of Object.values(state.jobs)) paymentRecords(job);
  for (const entry of Object.values(state.ledger)) Validate.repositoryRecord(entry);
  for (const transfer of [...Object.values(state.payouts), ...Object.values(state.obligations)]) Validate.transfer(transfer);
  return [...Object.values(state.ledger).map(entry => ({ id: `ledger:${entry.id}`, at: entry.at })),
    ...Object.values(state.jobs).flatMap(job => job.reservation?.operations.map(operation => ({ id: `payment:${operation.id}`, at: operation.initiatedAt })) ?? []),
    ...Object.values(state.payouts).map(payout => ({ id: `payout:${payout.id}`, at: payout.createdAt })),
    ...Object.values(state.obligations).map(obligation => ({ id: `obligation:${obligation.id}`, at: obligation.createdAt })),
    ...Object.values(state.payouts).flatMap(payout => payout.attempts.map(attempt => ({ id: `transfer:${attempt.id}`, at: attempt.initiatedAt }))),
    ...Object.values(state.obligations).flatMap(obligation => obligation.attempts.map(attempt => ({ id: `transfer:${attempt.id}`, at: attempt.initiatedAt })))];
}

export function registerRetention(state: CoreState, id: string, fact: RetentionFact): void {
  const previous = own(state.retentionOrigins, id);
  requireThat(!previous || previous.anchor === null && fact.anchor !== null &&
    ['communication', 'evidence'].includes(previous.kind) && previous.kind === fact.kind, 'RetentionBlocked');
  put(state.retention, id, fact);
  put(state.retentionOrigins, id, { ...fact });
}
export function retentionById(state: CoreState, id: string, clock: Clock): RetentionFact {
  const fact = own(state.retention, id); requireThat(fact, 'NotFound');
  const origin = own(state.retentionOrigins, id);
  requireThat(origin && ['kind', 'anchor', 'anchorKind', 'deadline', 'policyVersion'].every(key =>
    fact[key as keyof RetentionFact] === origin[key as keyof RetentionFact]), 'RetentionBlocked');
  const registrations = state.events.flatMap(record => record.retentions.filter(registration => registration.id === id));
  const original = registrations.at(-1);
  requireThat(original && sameFact(original.fact, fact), 'RetentionBlocked');
  const policy = state.policies.find(policy => policy.version === origin.policyVersion);
  requireThat(policy && (origin.anchor === null || policy.effectiveAt <= origin.anchor) &&
    retentionFact(origin.kind, origin.anchor, origin.anchorKind, policy, clock).deadline === origin.deadline, 'RetentionBlocked');
  if (fact.kind === 'financial') {
    const record = financialRecords(state).find(record => `financial:${record.id}` === id);
    requireThat(record && record.at === origin.anchor && origin.anchorKind === 'recorded', 'RetentionBlocked');
  } else if (fact.kind === 'audit') {
    const record = state.events.find(record => `audit:${record.id}` === id);
    requireThat(record && record.at === origin.anchor && origin.anchorKind === 'recorded', 'RetentionBlocked');
  } else if (fact.kind === 'account') {
    const record = Object.values(state.users).find(record => `account:${record.id}` === id);
    requireThat(record && record.createdAt === origin.anchor && origin.anchorKind === 'recorded', 'RetentionBlocked');
  } else {
    requireThat(['communication', 'evidence'].includes(fact.kind), 'RetentionBlocked');
    const job = Object.values(state.jobs).find(job => `${fact.kind}:${job.id}` === id);
    requireThat(job && origin.anchor === (job.state === 'completed' ? job.completedAt : null) && origin.anchorKind === 'completed', 'RetentionBlocked');
    if (job.state === 'completed') jobById(state, job.id);
  }
  return fact;
}
