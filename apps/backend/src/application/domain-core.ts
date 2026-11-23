import { authorize, checked, event, identifier, notificationTypes, own, owner, put, requiredLocales, requireThat, success, timer, unwrap } from '../domain/core.js';
import type { Clock, DomainEvent, EventType, Principal, Result, TransactionContext } from '../domain/core.js';
import * as Accounts from '../domain/accounts.js';
import * as Catalog from '../domain/catalog.js';
import * as Finance from '../domain/finance.js';
import * as Market from '../domain/marketplace.js';
import * as Chat from '../domain/messaging.js';
import * as Work from '../domain/work.js';
import * as Reputation from '../domain/reputation.js';
import { effectivePolicy, evaluateRetention, publishPolicy, retentionFact } from '../domain/policy.js';
import type { PaymentRoute, Policy, RetentionFact } from '../domain/policy.js';
import type { AtomicRepository, AuthenticationPort, AuthorizationDirectoryPort, LegalRetentionPolicyPort, NotificationPort, NotificationPreference, PaymentProviderPort, PhotoMetadataPort, SupportAttachmentPolicyPort, TextSafetyPort, TranslationPort } from './ports.js';
import * as Integrity from './invariants.js';
import { authorizeCommand } from './authorization.js';
import * as Validate from './validation.js';
import { compoundId, sameFact, snapshotFact } from '../domain/provenance.js';
import type { EventContext, OperationProof } from '../domain/provenance.js';
import type { TextSafetyDecision } from '../domain/text-safety.js';
import { inspectText, ProtectedTranslation } from './text-safety.js';

export type Command =
  | { type: 'publish_policy'; policy: Policy }
  | { type: 'threshold'; masterId: string; amount: bigint | null }
  | { type: 'save_catalog'; draft: Catalog.CatalogRevision; expectedSequence: number | null }
  | { type: 'approve_text'; key: string; textId: string; locale: string; sequence: number; revision: number }
  | { type: 'approve_content_set'; key: string; sequence: number; revisions: readonly { textId: string; revision: number }[]; confirmed: boolean }
  | { type: 'publish_catalog'; key: string; sequence: number }
  | { type: 'translation_correction'; oldCatalogKey: string; newCatalogKey: string; textId: string; sameMeaningConfirmed: boolean }
  | { type: 'profile'; displayName: string; photoId: string | null; specialization: Accounts.Specialization }
  | { type: 'activate'; role: 'client' | 'master' }
  | { type: 'switch_role'; role: 'client' | 'master' }
  | { type: 'locale'; locale: string }
  | { type: 'bind_contact'; proof: string }
  | { type: 'new_job'; id: string; draft: NonNullable<Market.Job['draft']> }
  | { type: 'edit_draft'; jobId: string; draft: NonNullable<Market.Job['draft']> }
  | { type: 'publish_job'; jobId: string }
  | { type: 'link_jobs'; jobId: string; linkedJobId: string }
  | { type: 'initial_offer'; jobId: string; id: string; chatId: string }
  | { type: 'message'; chatId: string; id: string; original: string; photoIds: readonly string[]; sender: 'user' | 'helpy' }
  | { type: 'revise_price'; jobId: string; masterId: string; amount: bigint; reason: string; confirmed: boolean }
  | { type: 'approve_price'; jobId: string; masterId: string; approved: boolean; confirmed: boolean }
  | { type: 'final_application'; jobId: string; masterId: string; confirmed: boolean; amount: bigint; recipientId: string }
  | { type: 'select_master'; jobId: string; masterId: string; confirmed: boolean; amount: bigint }
  | { type: 'terminate_negotiation'; jobId: string; masterId: string; confirmed: boolean; reason: string }
  | { type: 'publication_deadline'; jobId: string; cycleIndex: number }
  | { type: 'cash'; jobId: string }
  | { type: 'initiate_payment'; jobId: string; id: string; route: Exclude<PaymentRoute, 'cash'> }
  | { type: 'payment_outcome'; jobId: string; proof: string }
  | { type: 'reservation_deadline'; jobId: string }
  | { type: 'decline_reservation'; jobId: string; confirmed: boolean }
  | { type: 'accept_work'; jobId: string; accepted: boolean; explanation: string }
  | { type: 'submit_result'; jobId: string; explanation: string; photoIds: readonly string[] }
  | { type: 'complete'; jobId: string }
  | { type: 'cancel'; jobId: string; id: string; reason: string; explanation: string; evidence: readonly string[]; confirmed: boolean; classification: 'ordinary' | 'unclassified' | 'false_call' | 'partial'; remainingWork: string }
  | { type: 'cancellation_response'; jobId: string; workStopped: boolean; financialConsent: boolean; explanation: string; remainingWork?: string; evidence?: readonly string[] }
  | { type: 'open_resolution'; jobId: string; id: string; evidence: readonly string[] }
  | { type: 'decide_resolution'; caseId: string; decision: Work.DecisionInput }
  | { type: 'inspect_resolution'; caseId: string }
  | { type: 'reminders'; jobId: string }
  | { type: 'start_payout'; jobId: string; attemptId: string }
  | { type: 'payout_outcome'; jobId: string; proof: string }
  | { type: 'start_settlement'; obligationId: string; attemptId: string }
  | { type: 'settlement_outcome'; obligationId: string; proof: string }
  | { type: 'request_repayment'; id: string; amount: bigint; confirmed: boolean }
  | { type: 'agree_repayment'; requestId: string; amount: bigint; method: string; agreementId: string }
  | { type: 'receive_repayment'; requestId: string; masterId: string; amount: bigint; receiptId: string; agreementId: string; actuallyReceived: boolean; evidence: string }
  | { type: 'close_repayment'; requestId: string; reason: string }
  | { type: 'support'; id: string; userId: string; userRole: 'client' | 'master'; basis: 'repayment' | 'resolution'; basisId: string }
  | { type: 'close_support'; chatId: string }
  | { type: 'review'; jobId: string; id: string; stars: number; marks: readonly typeof Reputation.reviewMarks[number][]; comment: string }
  | { type: 'hide_review'; reviewId: string; reason: string }
  | { type: 'hide_history'; jobId: string }
  | { type: 'preferences'; preference: NotificationPreference }
  | { type: 'inbox'; id: string; recipientId: string; original: string }
  | { type: 'feedback'; id: string; original: string }
  | { type: 'evaluate_retention'; factId: string };

export type Outcome =
  | { kind: 'policy'; policy: Policy }
  | { kind: 'catalog'; catalog: Catalog.CatalogRevision }
  | { kind: 'user'; user: Accounts.User }
  | { kind: 'role'; principal: Principal }
  | { kind: 'job'; job: Market.Job }
  | { kind: 'offer'; offer: Market.Offer }
  | { kind: 'message'; message: Chat.ChatMessage }
  | { kind: 'chat'; chat: Chat.ChatThread }
  | { kind: 'repayment'; request: Finance.DebtRepaymentRequest }
  | { kind: 'payout'; payout: Finance.MasterPayout; execution: Finance.TransferView }
  | { kind: 'settlement'; obligation: Finance.SettlementObligation; execution: Finance.TransferView }
  | { kind: 'resolution'; resolution: Work.ResolutionCase }
  | { kind: 'resolution_evidence'; resolution: Work.ResolutionCase; snapshot: Market.JobScopeSnapshot; messages: readonly Chat.ChatMessage[]; evidence: Market.Job['evidence']; cancellation: Market.Job['cancellation']; financial: Market.Job['financial']; funds: Market.Job['funds']; reservation: Market.Job['reservation']; events: readonly DomainEvent[] }
  | { kind: 'review'; review: Reputation.Review }
  | { kind: 'payment'; view: ReturnType<typeof Finance.paymentView> }
  | { kind: 'threshold'; masterId: string; amount: bigint | null; effectiveMasterDebtThreshold: bigint; currency: 'THB' }
  | { kind: 'retention'; factId: string; fact: RetentionFact; assessment: ReturnType<typeof evaluateRetention> }
  | { kind: 'recorded'; id: string };
export interface Execution { readonly outcome: Outcome; readonly events: readonly DomainEvent[] }
function signature(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'bigint') return `bigint:${value}`;
  if (typeof value === 'number') return `number:${Object.is(value, -0) ? '-0' : String(value)}`;
  if (Array.isArray(value)) return `array:[${Array.from(value, signature).join(',')}]`;
  if (typeof value === 'object') return `object:{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => `${JSON.stringify(key)}:${signature(child)}`).join(',')}}`;
  return `${typeof value}:${JSON.stringify(value) ?? 'undefined'}`;
}
export interface CorePorts { readonly repository: AtomicRepository; readonly clock: Clock; readonly auth: AuthenticationPort; readonly photos: PhotoMetadataPort; readonly translation: TranslationPort; readonly textSafety: TextSafetyPort; readonly payments: PaymentProviderPort; readonly notifications: NotificationPort; readonly directory: AuthorizationDirectoryPort; readonly supportAttachments: SupportAttachmentPolicyPort; readonly legalRetention: LegalRetentionPolicyPort }
export class DomainCore {
  constructor(private readonly ports: CorePorts) {}
  private get translator(): ProtectedTranslation { return new ProtectedTranslation(this.ports.textSafety, this.ports.translation); }
  private get clock(): Clock { return Validate.guardedClock(this.ports.clock); }
  private supportPhotos(actor: Principal, thread: Chat.ChatThread, photoIds: readonly string[]): boolean {
    if (thread.context.type !== 'support' || photoIds.length === 0) return false;
    return unwrap(Validate.syncPort(() => success(this.ports.supportAttachments.photosAllowed(actor)), Validate.boolean('InvalidPhoto'), 'InvalidPhoto'));
  }

  private async messageAccess(session: string, actor: Principal, command: Extract<Command, { type: 'message' }>, conversation: Chat.ConversationContext): Promise<Result<void>> {
    const auth = await Validate.callPort(() => this.ports.auth.authenticate(session), Validate.principal, 'Unauthorized'); if (!auth.ok) return auth;
    const loaded = await Validate.readRepository(this.ports.repository); if (!loaded.ok) return loaded; const state = loaded.value;
    return checked(() => {
      requireThat(auth.value.userId === actor.userId && auth.value.role === actor.role, 'Unauthorized'); authorizeCommand(state, auth.value, command);
      const thread = Integrity.threadById(state, command.chatId); requireThat(sameFact(thread.context, conversation), 'InvalidReference');
      Chat.validateMessage(state, thread, auth.value, command, this.supportPhotos(auth.value, thread, command.photoIds));
      if (thread.context.type === 'job' && thread.mode === 'temporary') {
        const job = Integrity.jobById(state, thread.context.jobId), offer = own(job.offers, thread.context.masterId); requireThat(offer, 'InvalidReference');
        Market.offerAvailable(job, offer, thread, this.clock.now());
      }
    });
  }

  async authenticate(proof: string, userId: string, operationId: string, recovery = false): Promise<Result<Accounts.User>> {
    const input = checked(() => { Validate.text('ContactUnverified')(proof); identifier(userId); identifier(operationId); Validate.boolean('ContactUnverified')(recovery); });
    if (!input.ok) return input;
    const verified = await Validate.callPort(() => this.ports.auth.verifyClaim(proof), Validate.claim, 'ContactUnverified'); if (!verified.ok) return verified;
    const valid = checked(() => requireThat(verified.value.expiresAt > this.clock.now(), 'ContactUnverified')); if (!valid.ok) return valid;
    return Validate.callPort(() => this.ports.repository.transact(operationId, `claim:${verified.value.id}`, signature({ claimId: verified.value.id, userId, recovery }), recovery ? 'reject' : 'return', Validate.domainCallback(state => checked(() => {
      identifier(operationId);
      const now = this.clock.now(); const user = recovery ? Accounts.recover(state, verified.value, userId, now) : Accounts.login(state, verified.value, userId, now);
      const accountId = `account:${user.id}`, registrations: DomainEvent['retentions'][number][] = [];
      if (own(state.retention, accountId)) Integrity.retentionById(state, accountId, this.clock);
      else {
        const fact = retentionFact('account', user.createdAt, 'recorded', effectivePolicy(state.policies, user.createdAt, state.events), this.clock);
        Integrity.registerRetention(state, accountId, fact); registrations.push({ id: accountId, fact });
      }
      const policy = effectivePolicy(state.policies, now, state.events);
      const audit = event({ actor: { userId: user.id, role: null }, now, operationId }, recovery ? 'operation:recover' : 'operation:login', user.id);
      const auditId = `audit:${audit.id}`, auditFact = retentionFact('audit', now, 'recorded', policy, this.clock);
      Integrity.registerRetention(state, auditId, auditFact); registrations.push({ id: auditId, fact: auditFact });
      state.events.push({ ...audit, context: { kind: 'account', userId: user.id }, policyVersion: policy.version, retentions: snapshotFact(registrations),
        proof: snapshotFact({ kind: 'account', user, claimId: verified.value.id, claimPurpose: verified.value.purpose }) });
      return user;
    }))), Validate.account, 'RepositoryOutcomeUnknown');
  }

  async execute(session: string, operationId: string, command: Command): Promise<Result<Execution>> {
    const input = checked(() => { Validate.text('Unauthorized')(session); identifier(operationId); Validate.command(command); }); if (!input.ok) return input;
    command = snapshotFact(command);
    const auth = await Validate.callPort(() => this.ports.auth.authenticate(session), Validate.principal, 'Unauthorized'); if (!auth.ok) return auth;
    let actor = auth.value;
    const shape = checked(() => { requireThat(['client', 'master', 'admin'].includes(actor.role), 'Unauthorized'); });
    if (!shape.ok) return shape;
    const fixedFormula = checked(() => Finance.assertFixedRecovery(Object.fromEntries(Object.entries(command).filter(([key]) => /recovery|withhold/i.test(key)))));
    if (!fixedFormula.ok) return fixedFormula;
    if (command.type === 'start_payout' || command.type === 'start_settlement') {
      const permitted = command.type === 'start_payout' ? ['type', 'jobId', 'attemptId'] : ['type', 'obligationId', 'attemptId'];
      const shape = checked(() => requireThat(Object.keys(command).every(key => permitted.includes(key)), 'InvalidConfiguration')); if (!shape.ok) return shape;
    }
    const permission = ['start_payout', 'start_settlement'].includes(command.type) ? 'finance' :
      ['payment_outcome', 'payout_outcome', 'settlement_outcome'].includes(command.type) ? 'provider' : null;
    if (permission) { const allowed = checked(() => authorize(actor, permission)); if (!allowed.ok) return allowed; }
    const preflightAuth = await Validate.callPort(() => this.ports.auth.authenticate(session), Validate.principal, 'Unauthorized'); if (!preflightAuth.ok) return preflightAuth;
    const loaded = await Validate.readRepository(this.ports.repository); if (!loaded.ok) return loaded; const before = loaded.value;
    const sameIdentity = checked(() => requireThat(preflightAuth.value.userId === actor.userId && preflightAuth.value.role === actor.role, 'Unauthorized'));
    if (!sameIdentity.ok) return sameIdentity; actor = preflightAuth.value;
    if (['message', 'profile', 'activate', 'publish_job', 'submit_result', 'cancel', 'initiate_payment', 'start_payout', 'start_settlement'].includes(command.type)) {
      const replayAuth = await Validate.callPort(() => this.ports.auth.authenticate(session), Validate.principal, 'Unauthorized'); if (!replayAuth.ok) return replayAuth;
      const sameActor = checked(() => requireThat(replayAuth.value.userId === actor.userId && replayAuth.value.role === actor.role, 'Unauthorized')); if (!sameActor.ok) return sameActor;
      const replay = await Validate.callPort(async () => success(await this.ports.repository.replay<Execution>(operationId, `${actor.userId}:${actor.role}`, signature(command),
        Validate.domainCallback(state => checked(() => authorizeCommand(state, replayAuth.value, command))))), Validate.nullable(Validate.resultShape(Validate.execution, 'RepositoryOutcomeUnknown')), 'RepositoryUnavailable');
      if (!replay.ok) return replay; if (replay.value !== null) return replay.value;
    }
    const preflight = checked(() => {
      authorizeCommand(before, actor, command);
      if (actor.role !== 'admin') {
        if (['profile', 'activate', 'switch_role', 'locale', 'bind_contact'].includes(command.type)) requireThat(own(before.users, actor.userId), 'NotFound');
        else Accounts.requireActive(own(before.users, actor.userId), actor, actor.role);
      }
      if (['reminders', 'publication_deadline', 'reservation_deadline'].includes(command.type)) authorize(actor, 'scheduler');
      if (command.type === 'message') {
        const thread = Integrity.threadById(before, command.chatId);
        Chat.validateMessage(before, thread, actor, command, this.supportPhotos(actor, thread, command.photoIds));
        Integrity.requireNewIdentity(before, 'message', command.id);
        if (thread.context.type === 'job' && thread.mode === 'temporary') {
          const job = Integrity.jobById(before, thread.context.jobId); const offer = own(job.offers, thread.context.masterId); requireThat(offer, 'InvalidReference');
          Market.offerAvailable(job, offer, thread, this.clock.now());
        }
      }
      if (command.type === 'profile') requireThat(command.photoId === null || command.photoId.trim(), 'InvalidPhoto');
      if (command.type === 'activate' && command.role === 'master') {
        const user = own(before.users, actor.userId); requireThat(user && before.current && own(before.published, before.current), 'NotFound');
        Accounts.activate({ ...user }, actor, command.role, Integrity.currentCatalog(before));
      }
      if (command.type === 'initiate_payment') requireThat(effectivePolicy(before.policies, this.clock.now(), before.events).clientPaymentRoutes.includes(command.route) &&
        command.route !== ('cash' as PaymentRoute), 'RouteUnavailable');
      if (command.type === 'preferences') Validate.list(Validate.text('InvalidConfiguration'), 'InvalidConfiguration')(this.ports.notifications.supportedChannels);
      if (command.type === 'publish_job') { const job = Integrity.jobById(before, command.jobId); owner(actor, job.clientId, 'client'); }
      if (command.type === 'cancel' || command.type === 'submit_result') {
        const job = Integrity.jobById(before, command.jobId);
        if (command.type === 'submit_result') { requireThat(job.selectedMasterId, 'InvalidTransition'); owner(actor, job.selectedMasterId, 'master'); }
        else requireThat(actor.role === 'client' && actor.userId === job.clientId || actor.role === 'master' && actor.userId === job.selectedMasterId, 'Unauthorized');
        if (command.type === 'cancel') requireThat(command.classification !== 'false_call' || actor.role === 'master' && actor.userId === job.selectedMasterId, 'Unauthorized');
      }
      if (command.type === 'start_payout' || command.type === 'payout_outcome' || command.type === 'payment_outcome') Integrity.jobById(before, command.jobId);
      if (command.type === 'start_payout') requireThat(own(before.payouts, command.jobId) && own(before.jobs, command.jobId)?.state === 'completed', 'InvalidTransition');
      if (command.type === 'start_settlement' || command.type === 'settlement_outcome') Integrity.settlementById(before, command.obligationId);
      if (command.type === 'open_resolution' || command.type === 'decide_resolution' || command.type === 'inspect_resolution') {
        if (actor.role === 'admin') authorize(actor, 'resolution');
        else if (command.type !== 'open_resolution') requireThat(false, 'Unauthorized');
        else { const job = Integrity.jobById(before, command.jobId); requireThat(actor.role === 'client' && actor.userId === job.clientId || actor.role === 'master' && actor.userId === job.selectedMasterId, 'Unauthorized'); }
      }
      if (command.type === 'message' || command.type === 'submit_result') requireThat(Array.isArray(command.photoIds), 'InvalidPhoto');
      if (command.type === 'cancel') requireThat(Array.isArray(command.evidence), 'InvalidPhoto');
    });
    if (!preflight.ok) return preflight;
    const messageCommand = command.type === 'message' ? command : null;
    const conversation = messageCommand ? own(before.threads, messageCommand.chatId)!.context : null;
    let admission: TextSafetyDecision | null = null;
    if (messageCommand && conversation?.type === 'job' && messageCommand.original.trim()) {
      const inspected = await inspectText(this.ports.textSafety, messageCommand.original, 'job_chat'); if (!inspected.ok) return inspected;
      admission = inspected.value;
    }
    if (messageCommand && conversation) {
      const permitted = await this.messageAccess(session, actor, messageCommand, conversation); if (!permitted.ok) return permitted;
    }
    const photoIds = command.type === 'profile' ? command.photoId === null ? [] : [command.photoId] :
      command.type === 'activate' && command.role === 'master' ? [own(before.users, actor.userId)!.photoId!] :
      command.type === 'message' || command.type === 'submit_result' ? command.photoIds : command.type === 'cancel' ? command.evidence :
      command.type === 'publish_job' ? own(before.jobs, command.jobId)!.draft?.items.flatMap(item => Object.values(item.photos).flat()) ?? own(before.jobs, command.jobId)!.snapshot?.photoIds ?? [] : [];
    const lookupIds = command.type === 'publish_job' ? [...new Set(photoIds)] : photoIds;
    const photos = lookupIds.length ? await Validate.callPort(() => this.ports.photos.lookup(lookupIds), Validate.photoMetadata, 'InvalidPhoto') : success<readonly Catalog.PhotoMetadata[]>([]); if (!photos.ok) return photos;
    const claimCommand = command.type === 'bind_contact' ? command : null;
    const claim = claimCommand ? await Validate.callPort(() => this.ports.auth.verifyClaim(claimCommand.proof), Validate.claim, 'ContactUnverified') : null;
    if (claim && !claim.ok) return claim;
    const providerCommand = command.type === 'payment_outcome' || command.type === 'payout_outcome' || command.type === 'settlement_outcome' ? command : null;
    const provider = providerCommand ? await Validate.callPort(() => this.ports.payments.verifyOutcome(providerCommand.proof), Validate.providerOutcome, 'ProviderConflict') : null;
    if (provider && !provider.ok) return provider;
    const detection = messageCommand && conversation && messageCommand.original.trim() ? await this.translator.detect(messageCommand.original,
      conversation.type === 'job' ? 'job_chat' : 'external_translation',
      () => this.messageAccess(session, actor, messageCommand, conversation)) : null;
    if (detection?.fatal && !detection.result.ok) return detection.result;
    const detected = detection?.result ?? null;
    const incomingCommand = command.type === 'initiate_payment' ? command : null;
    const incomingRoute = incomingCommand ?
      await Validate.callPort(() => this.ports.payments.incomingRoute(incomingCommand.route), Validate.capability, 'RouteUnavailable') : null;
    if (incomingRoute && !incomingRoute.ok) return incomingRoute;
    const payoutForDestination = command.type === 'start_payout' ? own(before.payouts, command.jobId) : null;
    const destination = command.type === 'start_payout' ? payoutForDestination?.amount === 0n ? success(null) :
      await Validate.callPort(() => this.ports.payments.payoutDestination(payoutForDestination?.masterId ?? ''), Validate.payoutDestination, 'DestinationUnverified') : null;
    if (destination && !destination.ok) return destination;
    let settlementDestination: Finance.SettlementDestination | null = null;
    if (command.type === 'start_settlement') {
      const obligation = own(before.obligations, command.obligationId);
      if (!obligation) return { ok: false, error: { code: 'NotFound', detail: command.obligationId } };
      const resolved = await Validate.callPort(() => this.ports.payments.settlementDestination(obligation), Validate.settlementDestination, 'DestinationUnverified'); if (!resolved.ok) return resolved; settlementDestination = resolved.value;
    }
    const resolutionNotification = ['cancel', 'cancellation_response', 'open_resolution', 'reminders'].includes(command.type);
    const supportNotification = command.type === 'request_repayment' || command.type === 'feedback' || command.type === 'message' && own(before.threads, command.chatId)?.context.type === 'support' && actor.role !== 'admin';
    const directory = resolutionNotification || supportNotification ? await Validate.callPort(async () => success(await this.ports.directory.admins(resolutionNotification ? 'resolution' : 'support')),
      Validate.list(Validate.text('Unauthorized'), 'Unauthorized'), 'Unauthorized') : success<readonly string[]>([]);
    if (!directory.ok) return directory; const admins = directory.value;
    const commandIdentity = claim?.ok ? { ...command, proof: { claimId: claim.value.id } } : provider?.ok ?
      { ...command, proof: { operationId: provider.value.operationId, binding: provider.value.binding ? { kind: provider.value.binding.kind, jobId: provider.value.binding.jobId, obligationId: provider.value.binding.obligationId,
        beneficiaryId: provider.value.binding.beneficiaryId, destinationId: provider.value.binding.destinationId } : null, amount: provider.value.amount, currency: provider.value.currency, status: provider.value.status,
        reason: Finance.failureReason(provider.value.status, provider.value.reason) } } : command;
    const currentAuth = await Validate.callPort(() => this.ports.auth.authenticate(session), Validate.principal, 'Unauthorized'); if (!currentAuth.ok) return currentAuth;
    const current = checked(() => {
      requireThat(currentAuth.value.userId === actor.userId && currentAuth.value.role === actor.role, 'Unauthorized');
      authorizeCommand(before, currentAuth.value, command);
    }); if (!current.ok) return current; actor = currentAuth.value;
    const access = Validate.domainCallback((state: Parameters<typeof authorizeCommand>[0]) => checked(() => authorizeCommand(state, currentAuth.value, command)));
    const result = await Validate.callPort(() => this.ports.repository.transact(operationId, `${actor.userId}:${actor.role}`, signature(commandIdentity), 'return', Validate.domainCallback(state => checked(() => {
      unwrap(access(state));
      identifier(operationId);
      const now = this.clock.now(); const context: TransactionContext = { actor, now, operationId }; const events: DomainEvent[] = [];
      const threadContext = 'chatId' in command ? own(state.threads, command.chatId)?.context : null;
      const affectedJobIds = ('jobId' in command ? [command.jobId, ...(command.type === 'link_jobs' ? [command.linkedJobId] : [])] :
        command.type === 'new_job' ? [command.id] : 'caseId' in command ? [own(state.cases, command.caseId)?.jobId] :
          'obligationId' in command ? [own(state.obligations, command.obligationId)?.jobId] : threadContext?.type === 'job' ? [threadContext.jobId] : [])
        .filter((id): id is string => id !== undefined);
      const previousTimers = new Map(affectedJobIds.flatMap(id => { const job = own(state.jobs, id); return job ? Integrity.jobTimers(state, job) : []; }).map(fact => [fact.id, snapshotFact(fact)]));
      const financialChange = ['initiate_payment', 'complete', 'decide_resolution', 'start_payout', 'start_settlement', 'receive_repayment'].includes(command.type);
      const previousFinancialIds = new Set((financialChange ? Integrity.financialRecords(state) : []).map(record => record.id));
      const previousRetention = new Map(Object.entries(state.retention).map(([id, fact]) => [id, snapshotFact(fact)]));
      const emit = (type: EventType, subject: string, recipients: readonly string[] = [], facts: DomainEvent['facts'] = {}) => events.push(event(context, type, subject, recipients, facts));
      const user = own(state.users, actor.userId);
      if (actor.role !== 'admin' && !['profile', 'activate', 'switch_role', 'locale', 'bind_contact'].includes(command.type)) Accounts.requireActive(user, actor, actor.role);
      else if (actor.role !== 'admin') requireThat(user, 'NotFound');
      const policy = command.type === 'publish_policy' ? command.policy : effectivePolicy(state.policies, now, state.events);
      const catalog = () => Integrity.currentCatalog(state);
      const jobById = (id: string) => Integrity.jobById(state, id);
      const offerByMaster = (job: Market.Job, masterId: string) => { const offer = own(job.offers, masterId); requireThat(offer, 'NotFound'); return offer; };
      const threadById = (id: string) => Integrity.threadById(state, id);
      const openCase = (job: Market.Job, id: string, evidence: readonly string[], source: 'request' | 'cancellation_timeout' = 'request') => {
        if (!own(state.cases, id)) Integrity.requireNewIdentity(state, 'resolution', id);
        Work.resolutionEvidence(job, state, state.events, evidence, job.resolutionId);
        const resolution = Work.openResolution(state, job, id, context, evidence, source);
        emit('resolution_opened', resolution.id, admins);
        events[events.length - 1] = { ...events.at(-1)!, proof: snapshotFact({ kind: 'resolution', resolution, refusal: null }) };
        return resolution;
      };
      const repayment = (id: string) => Integrity.repaymentById(state, id);
      const matchedNotification = (job: Market.Job) => emit('job_published', job.id, Accounts.accountList(state).filter(user => user.masterActive === true).filter(master =>
        !job.excludedMasters.includes(master.id) && master.id !== job.clientId && Accounts.matches(master.specialization, job.snapshot!.items)).map(master => master.id));
      let outcome: Outcome;
      if (command.type === 'save_catalog') {
        const key = Catalog.catalogKey(command.draft); if (own(state.drafts, key)) Integrity.catalogByKey(state, key, 'drafts');
        else if (!own(state.published, key)) Integrity.requireNewIdentity(state, 'catalog', key);
      } else if (['approve_text', 'approve_content_set', 'publish_catalog'].includes(command.type) && 'key' in command && own(state.drafts, command.key)) {
        Integrity.catalogByKey(state, command.key, 'drafts');
      }
      switch (command.type) {
        case 'publish_policy': { const proposed = command.policy; unwrap(Validate.syncPort(() => this.ports.legalRetention.validate(proposed),
          value => requireThat(value === undefined, 'RetentionBlocked'), 'RetentionBlocked')); outcome = { kind: 'policy', policy: unwrap(publishPolicy(actor, state.policies, proposed)) }; break; }
        case 'threshold': requireThat(own(state.users, command.masterId)?.masterActive === true, 'RoleInactive'); Accounts.accountById(state, command.masterId); Integrity.requireThreshold(state, command.masterId); Finance.setThreshold(state, actor, command.masterId, command.amount);
          state.thresholdHistory.push({ masterId: command.masterId, amount: command.amount, version: operationId, effectiveAt: now });
          outcome = { kind: 'threshold', masterId: command.masterId, amount: command.amount,
            effectiveMasterDebtThreshold: command.amount ?? policy.globalDebtThreshold, currency: 'THB' }; break;
        case 'save_catalog': outcome = { kind: 'catalog', catalog: unwrap(Catalog.saveCatalogDraft(state, actor, command.draft, command.expectedSequence)) }; break;
        case 'approve_text': outcome = { kind: 'catalog', catalog: Catalog.approveText(state, actor, command.key, command.textId, command.locale, command.sequence, command.revision) }; break;
        case 'approve_content_set': outcome = { kind: 'catalog', catalog: Catalog.approveContentSet(state, actor, command.key, command.sequence, command.revisions, command.confirmed) }; break;
        case 'publish_catalog': outcome = { kind: 'catalog', catalog: Catalog.publishCatalog(state, actor, command.key, command.sequence) }; break;
        case 'translation_correction': {
          authorize(actor, 'content_approval'); requireThat(command.sameMeaningConfirmed === true, 'ConfirmationRequired');
          Integrity.correctionKey(state, command.oldCatalogKey, command.textId);
          const old = own(state.published, command.oldCatalogKey) && Integrity.catalogByKey(state, command.oldCatalogKey, 'published').texts.find(text => text.id === command.textId);
          const corrected = own(state.published, command.newCatalogKey) && Integrity.catalogByKey(state, command.newCatalogKey, 'published').texts.find(text => text.id === command.textId);
          requireThat(old && corrected && old.meaning === corrected.meaning && command.oldCatalogKey !== command.newCatalogKey, 'StaleRevision');
          put(state.corrections, compoundId(command.oldCatalogKey, command.textId), command.newCatalogKey); outcome = { kind: 'recorded', id: command.textId }; break;
        }
        case 'profile': requireThat(user, 'NotFound'); Catalog.requirePhotos(command.photoId === null ? [] : [command.photoId], photos.value, actor.userId);
          outcome = { kind: 'user', user: Accounts.updateProfile(user, actor, command, catalog()) }; break;
        case 'activate': requireThat(user, 'NotFound');
          if (command.role === 'master') { requireThat(user.photoId, 'ProfileIncomplete'); Catalog.requirePhotos([user.photoId], photos.value, actor.userId); }
          outcome = { kind: 'user', user: Accounts.activate(user, actor, command.role, catalog()) }; break;
        case 'switch_role': requireThat(user, 'NotFound'); outcome = { kind: 'role', principal: Accounts.switchRole(user, actor, command.role) }; break;
        case 'locale': requireThat(user && policy.locales.includes(command.locale), 'InvalidLocale'); user.locale = command.locale; outcome = { kind: 'user', user }; break;
        case 'bind_contact': requireThat(claim?.ok, 'ContactUnverified'); outcome = { kind: 'user', user: Accounts.bindContact(state, actor, claim.value, now) }; break;
        case 'new_job': Catalog.checkRouting(catalog(), command.draft.items);
          if (!own(state.jobs, command.id)) Integrity.requireNewIdentity(state, 'job', command.id);
          outcome = { kind: 'job', job: Market.newJob(state, actor, command.id, command.draft) }; break;
        case 'edit_draft': { const job = jobById(command.jobId); Market.editDraft(job, actor, command.draft); outcome = { kind: 'job', job }; break; }
        case 'publish_job': {
          const job = jobById(command.jobId); owner(actor, job.clientId, 'client'); requireThat(job.draft, 'PublishedSnapshotImmutable'); const current = catalog();
          unwrap(Catalog.validateScope(current, job.draft.items, photos.value, actor.userId));
          const rules = Catalog.ruleReferences(current, job.draft.items);
          Market.publishJob(job, actor, { catalogKey: Catalog.catalogKey(current), items: job.draft.items, cep: job.draft.cep,
            publicAddress: job.draft.publicAddress, address: job.draft.address, rules,
            photoIds: job.draft.items.flatMap(item => Object.values(item.photos).flat()) }, policy, now);
          matchedNotification(job); outcome = { kind: 'job', job }; break;
        }
        case 'link_jobs': { const job = jobById(command.jobId); const historical = job.snapshot && Integrity.catalogByKey(state, job.snapshot.catalogKey, 'published'); requireThat(historical, 'InvalidReference');
          Market.linkJobs(job, jobById(command.linkedJobId), historical, actor); outcome = { kind: 'job', job }; break; }
        case 'initial_offer': { const job = jobById(command.jobId); requireThat(user, 'NotFound');
          Integrity.requireNewIdentity(state, 'offer', command.id); Integrity.requireNewIdentity(state, 'chat', command.chatId);
          requireThat(!Object.values(state.jobs).some(existing => Object.values(existing.offers).some(offer => offer.id === command.id)), 'Conflict');
          const offer = Market.initialOffer(job, state, actor, user.specialization, command.id, command.chatId, now); emit('initial_offer_sent', offer.id, [job.clientId]); outcome = { kind: 'offer', offer }; break; }
        case 'message': {
          const thread = threadById(command.chatId); Chat.participant(thread, actor, true);
          Catalog.requirePhotos(command.photoIds, photos.value, actor.userId);
          let job: Market.Job | null = null;
          if (thread.context.type === 'job') { job = jobById(thread.context.jobId); if (thread.mode === 'temporary') Market.offerAvailable(job, offerByMaster(job, thread.context.masterId), thread, now); }
          requireThat(!conversation || sameFact(thread.context, conversation), 'InvalidReference');
          Integrity.requireNewIdentity(state, 'message', command.id);
          const message = Chat.sendMessage(state, thread, actor, command, detected?.ok && detected.value.reliable ? detected.value.language : null, policy, now, this.supportPhotos(actor, thread, command.photoIds), admission);
          if (job && thread.mode === 'temporary' && thread.protected) Market.cycle(job).hadBilateral = true;
          if (job && thread.mode === 'working') Market.activity(job, policy, now);
          const recipients = thread.context.type === 'support' ? actor.role === 'admin' ? [thread.context.userId] : admins :
            [actor.userId === thread.context.clientId ? thread.context.masterId : thread.context.clientId];
          emit('chat_message', message.id, recipients, { chatId: thread.id }); outcome = { kind: 'message', message }; break;
        }
        case 'revise_price': case 'approve_price': case 'final_application': case 'select_master': case 'terminate_negotiation': {
          const job = jobById(command.jobId); const offer = offerByMaster(job, command.masterId); const thread = threadById(offer.chatId);
          if (command.type === 'revise_price') { Market.revisePrice(job, offer, thread, actor, command.amount, command.reason, command.confirmed, now); emit('price_adjustment_requested', offer.id, [job.clientId]); }
          if (command.type === 'approve_price') { Market.approvePrice(job, offer, thread, actor, command.approved, command.confirmed, now); emit(command.approved ? 'price_adjustment_approved' : 'price_adjustment_rejected', offer.id, [offer.masterId]); }
          if (command.type === 'final_application') { Market.finalApplication(job, offer, thread, actor, command, now); emit('final_application_sent', offer.id, [job.clientId], { amount: offer.final!.amount, sentAt: offer.final!.sentAt }); }
          if (command.type === 'select_master') {
            const competitors = Object.values(job.offers).filter(other => other.masterId !== offer.masterId && other.state === 'open');
            Market.selectMaster(job, state, offer, actor, command, policy, now);
            for (const other of competitors) emit('chat_closed', other.chatId, [job.clientId, other.masterId]);
             emit('master_selected', job.id, [offer.masterId], { policyVersion: policy.version, fap: job.financial!.fap, currency: 'THB', masterId: offer.masterId });
          }
          if (command.type === 'terminate_negotiation') { events.push(...Market.terminateNegotiation(state, state, job, offer, context, command.confirmed, command.reason, state.events));
            const transition = Market.evaluatePublication(job, state, policy, now); if (transition === 'republished') matchedNotification(job); if (transition === 'expired') emit('publication_closed', job.id, [job.clientId]); }
          outcome = { kind: 'offer', offer }; break;
        }
        case 'publication_deadline': {
          authorize(actor, 'scheduler'); const job = jobById(command.jobId);
          requireThat(command.cycleIndex === Market.cycle(job).index, 'StaleRevision');
          const transition = Market.evaluatePublication(job, state, policy, now);
          if (transition === 'republished') matchedNotification(job); if (transition === 'expired') emit('publication_closed', job.id, [job.clientId]); outcome = { kind: 'job', job }; break;
        }
        case 'cash': case 'initiate_payment': case 'payment_outcome': case 'reservation_deadline': case 'decline_reservation': {
          const job = jobById(command.jobId); requireThat(job.reservation && job.financial, 'InvalidTransition'); const reservation = job.reservation;
          if (command.type === 'payment_outcome') { authorize(actor, 'provider'); requireThat(provider?.ok, 'ProviderConflict'); Integrity.requireOperationIdentity(state, provider.value.operationId, true); const result = Finance.paymentOutcome(reservation, provider.value, policy, now, job.financial, job.id);
            if (result === 'assigned') { Market.assignment(job, state, policy, now); emit('master_assigned', job.id, [job.selectedMasterId!]); }
            if (result !== 'unchanged') emit('payment_status', job.id, [job.clientId], { status: result }); }
          else if (command.type === 'reservation_deadline' || command.type === 'decline_reservation') {
            if (command.type === 'reservation_deadline') { authorize(actor, 'scheduler'); requireThat(now >= reservation.countdown.deadline, 'InvalidTransition'); }
            else { owner(actor, job.clientId, 'client'); requireThat(command.confirmed === true, 'ConfirmationRequired'); }
            requireThat(job.state === 'reserved', 'InvalidTransition'); requireThat(!Finance.unresolved(reservation), 'PaymentOutcomeUnknown');
            const thread = job.chatId ? threadById(job.chatId) : null;
            reservation.state = 'released'; job.state = 'expired'; if (thread) thread.mode = 'closed'; emit('reservation_released', job.id, [job.clientId, job.selectedMasterId!]);
          } else {
            owner(actor, job.clientId, 'client');
            if (command.type === 'cash') { Integrity.debtView(state, reservation.masterId, policy); Finance.chooseCash(reservation, state, policy, now); Market.assignment(job, state, policy, now); emit('master_assigned', job.id, [job.selectedMasterId!]); }
             else {
               Integrity.requireOperationIdentity(state, command.id);
               requireThat(incomingRoute?.ok && incomingRoute.value.route === command.route && incomingRoute.value.status === 'supported', 'RouteUnavailable');
              Finance.initiatePayment(reservation, job.financial, policy, now, command.id, command.route, job.id); emit('payment_requested', command.id);
            }
          }
          outcome = { kind: 'payment', view: Finance.paymentView(reservation, now) }; break;
        }
        case 'accept_work': { const job = jobById(command.jobId); events.push(Work.acceptWork(job, context, policy, command.accepted, command.explanation)); outcome = { kind: 'job', job }; break; }
        case 'submit_result': { const job = jobById(command.jobId);
          Catalog.requirePhotos(command.photoIds, photos.value, actor.userId);
          events.push(Work.submitResult(job, context, policy, command.explanation, command.photoIds)); outcome = { kind: 'job', job }; break; }
        case 'complete': { const job = jobById(command.jobId); events.push(...Work.completeJob(job, state, state, state, state, context, state.events)); outcome = { kind: 'job', job }; break; }
        case 'cancel': {
          const job = jobById(command.jobId); Catalog.requirePhotos(command.evidence, photos.value, actor.userId);
          requireThat(!Object.values(state.jobs).some(existing => existing.cancellation?.id === command.id), 'Conflict');
          Integrity.requireNewIdentity(state, 'cancellation', command.id);
          if (command.classification === 'partial') requireThat(command.remainingWork.trim() && command.evidence.length > 0, 'EvidenceRequired');
          if (command.classification === 'false_call') requireThat(command.evidence.length > 0, 'EvidenceRequired');
          const existingCase = job.resolutionId ? own(state.cases, job.resolutionId) : null;
          if (existingCase) requireThat(existingCase.status === 'admin_resolution_pending' && existingCase.requestId === null, 'InvalidTransition');
          Work.requestCancellation(job, context, policy, command);
          if (existingCase) existingCase.requestId = command.id;
          else if (actor.role === 'master' || command.classification === 'partial') openCase(job, `case:${command.id}`, command.evidence);
          emit('cancellation_requested', job.id, [job.clientId, job.selectedMasterId!]); outcome = { kind: 'job', job }; break;
        }
        case 'cancellation_response': {
          const job = jobById(command.jobId); requireThat(job.cancellation && ['assigned', 'working'].includes(job.state), 'InvalidTransition'); const request = job.cancellation;
          requireThat(now < request.responseTimer.deadline, 'InvalidTransition');
          if (job.resolutionId) requireThat(own(state.cases, job.resolutionId)?.status === 'admin_resolution_pending', 'InvalidTransition');
          requireThat(actor.userId !== request.initiator && (actor.userId === job.clientId && actor.role === 'client' || actor.userId === job.selectedMasterId && actor.role === 'master'), 'Unauthorized');
          requireThat(typeof command.workStopped === 'boolean' && typeof command.financialConsent === 'boolean', 'InvalidTransition');
          requireThat(request.workStopped === null && (command.financialConsent || command.explanation.trim()), 'EvidenceRequired');
          const material = command.evidence ?? (job.chatId ? threadById(job.chatId).messageIds.filter(id => own(state.messages, id)?.authorId === actor.userId) : []);
          Work.resolutionEvidence(job, state, state.events, material, job.resolutionId);
          request.workStopped = command.workStopped; request.financialConsent = command.financialConsent; request.responseExplanation = command.explanation;
          request.response = { id: operationId, actorId: actor.userId, at: now, explanation: command.explanation, remainingWork: command.remainingWork ?? '', evidence: material };
          if (!job.resolutionId) openCase(job, `case:${request.id}`, request.evidence);
          emit('cancellation_response', job.id, [request.initiator]); outcome = { kind: 'job', job }; break;
        }
        case 'open_resolution': { const job = jobById(command.jobId); outcome = { kind: 'resolution', resolution: openCase(job, command.id, command.evidence) }; break; }
        case 'decide_resolution': { const resolution = own(state.cases, command.caseId); requireThat(resolution, 'NotFound');
          if (resolution.decision === null) Integrity.requireNewIdentity(state, 'decision', command.decision.id);
          events.push(...Work.decideResolution(state, state, state, state, jobById(resolution.jobId), resolution, context, command.decision, state.events)); outcome = { kind: 'resolution', resolution }; break; }
        case 'inspect_resolution': {
          authorize(actor, 'resolution'); const resolution = own(state.cases, command.caseId); requireThat(resolution, 'NotFound'); const job = jobById(resolution.jobId);
          requireThat(job.resolutionId === resolution.id && job.snapshot, 'InvalidReference');
          const threads = Chat.resolutionThreads(state, job, resolution.id, state.events);
          const messages = threads.flatMap(value => { const thread = threadById(value.id); return thread.messageIds.map(id => Chat.messageById(state, thread, id, state.events)); });
          emit('resolution_inspected', resolution.id, [], { jobId: job.id, acceptanceOperationId: job.acceptanceOperationId, lastActivityAt: job.lastActivityAt,
            messageCount: messages.length, evidenceCount: job.evidence.length, cancellationRequestId: job.cancellation?.id ?? null, cancellationResponseId: job.cancellation?.response?.id ?? null });
          outcome = { kind: 'resolution_evidence', resolution, snapshot: job.snapshot, messages, evidence: job.evidence,
            cancellation: job.cancellation, financial: job.financial, funds: job.funds, reservation: job.reservation, events: state.events.filter(value => {
              const context = value.context;
              return context.kind === 'job' && context.jobId === job.id || context.kind === 'support' && context.basis === 'resolution' &&
                context.basisId === resolution.id && threads.some(thread => thread.id === context.chatId);
            }) }; break;
        }
        case 'reminders': {
          authorize(actor, 'scheduler'); const job = jobById(command.jobId);
          for (const offer of Object.values(job.offers)) { const thread = threadById(offer.chatId);
            if (job.state === 'published' && offer.state === 'open' && thread.mode === 'temporary' && thread.waitingFor && thread.reminder && now >= thread.reminder.deadline && (Market.acceptingOffers(job, now) || thread.protected)) {
              emit('negotiation_reminder', thread.id, [thread.waitingFor]); thread.reminder = timer(now, policy.negotiationRepeatReminder, policy.version);
            }
          }
          if (job.cancellation && ['assigned', 'working'].includes(job.state) && job.cancellation.response === null &&
            job.cancellation.workStopped === null && job.cancellation.classification !== 'false_call' &&
            (!job.resolutionId || own(state.cases, job.resolutionId)?.status === 'admin_resolution_pending')) {
            const request = job.cancellation;
            if (now >= request.responseTimer.deadline) { if (!job.resolutionId) openCase(job, `case:${request.id}`, request.evidence, 'cancellation_timeout'); }
            else if (now >= request.reminder.deadline) { emit('cancellation_reminder', job.id, [request.initiator === job.clientId ? job.selectedMasterId! : job.clientId]); request.reminder = timer(now, policy.cancellationReminder, policy.version); }
          }
          if (['assigned', 'working', 'client_accepted'].includes(job.state) && job.inactivityReminder && now >= job.inactivityReminder.deadline) {
            emit('inactivity_reminder', job.id, job.state === 'client_accepted' ? [job.selectedMasterId!] : [job.clientId, job.selectedMasterId!]);
            job.inactivityReminder = timer(now, policy.inactivityRepeatReminder, policy.version);
          }
          outcome = { kind: 'job', job }; break;
        }
        case 'start_payout': {
          authorize(actor, 'finance'); const job = jobById(command.jobId); const payout = own(state.payouts, job.id); requireThat(payout && job.state === 'completed', 'InvalidTransition');
          Integrity.requireOperationIdentity(state, command.attemptId);
          requireThat(destination?.ok, 'DestinationUnverified'); const attempt = Finance.initiatePayout(payout, policy, destination.value, now, command.attemptId);
          if (attempt) emit('payout_requested', attempt.id); outcome = { kind: 'payout', payout, execution: Finance.transferView(payout) }; break;
        }
        case 'payout_outcome': { authorize(actor, 'provider'); const job = jobById(command.jobId); const payout = own(state.payouts, job.id); requireThat(payout && provider?.ok, 'NotFound'); Integrity.requireOperationIdentity(state, provider.value.operationId, true); Finance.payoutOutcome(payout, provider.value); outcome = { kind: 'payout', payout, execution: Finance.transferView(payout) }; break; }
        case 'start_settlement': {
          authorize(actor, 'finance'); const obligation = Integrity.settlementById(state, command.obligationId); requireThat(settlementDestination, 'NotFound');
          Integrity.requireOperationIdentity(state, command.attemptId);
          Finance.initiateSettlement(obligation, policy, settlementDestination, now, command.attemptId); emit('payout_requested', command.attemptId); outcome = { kind: 'settlement', obligation, execution: Finance.transferView(obligation) }; break;
        }
        case 'settlement_outcome': {
          authorize(actor, 'provider'); const obligation = Integrity.settlementById(state, command.obligationId); requireThat(provider?.ok, 'NotFound');
          Integrity.requireOperationIdentity(state, provider.value.operationId, true);
          Finance.settlementOutcome(obligation, provider.value); outcome = { kind: 'settlement', obligation, execution: Finance.transferView(obligation) }; break;
        }
        case 'request_repayment': {
          if (!own(state.repayments, command.id)) Integrity.requireNewIdentity(state, 'repayment', command.id);
          const request = Finance.requestRepayment(state, actor, command.id, command.amount, command.confirmed, now); emit('debt_repayment_requested', request.id, admins); outcome = { kind: 'repayment', request }; break; }
        case 'agree_repayment': { const request = repayment(command.requestId); Finance.agreeRepayment(request, actor, command.amount, command.method, command.agreementId);
          emit('debt_repayment_agreed', request.id, [request.masterId], { amount: command.amount, method: command.method, agreementId: command.agreementId }); outcome = { kind: 'repayment', request }; break; }
        case 'receive_repayment': { const request = repayment(command.requestId); const debtBefore = Finance.debtBalance(state, request.masterId);
          Finance.receiveRepayment(state, request, actor, command, now); emit('debt_repayment_received', request.id, [request.masterId], { debtBefore }); outcome = { kind: 'repayment', request }; break; }
        case 'close_repayment': { authorize(actor, 'finance'); const request = repayment(command.requestId); requireThat(request.status !== 'received' && command.reason.trim(), 'InvalidTransition'); request.status = 'closed'; emit('debt_repayment_closed', request.id, [request.masterId], { reason: command.reason }); outcome = { kind: 'repayment', request }; break; }
        case 'support': {
          requireThat(['client', 'master'].includes(command.userRole) && ['repayment', 'resolution'].includes(command.basis), 'InvalidReference');
          authorize(actor, 'support'); const recipient = own(state.users, command.userId); requireThat(recipient && (command.userRole === 'client' ? recipient.clientActive === true : recipient.masterActive === true), 'RoleInactive'); Accounts.accountById(state, command.userId);
          if (command.basis === 'repayment') { const request = repayment(command.basisId); requireThat(request.masterId === command.userId && command.userRole === 'master' && !request.supportChatId, 'InvalidReference'); request.supportChatId = command.id; }
          else { const resolution = own(state.cases, command.basisId); requireThat(resolution, 'InvalidReference'); const job = jobById(resolution.jobId);
            requireThat(command.userRole === 'client' && command.userId === job.clientId || command.userRole === 'master' && command.userId === job.selectedMasterId, 'Unauthorized'); }
          Integrity.requireNewIdentity(state, 'chat', command.id);
          const chat = Chat.createSupport(state, actor, command.id, { type: 'support', userId: command.userId, userRole: command.userRole, basis: command.basis, basisId: command.basisId }, now);
          emit('support_opened', chat.id, [command.userId], { userId: command.userId, userRole: command.userRole,
            basis: command.basis, basisId: command.basisId }); outcome = { kind: 'chat', chat }; break;
        }
        case 'close_support': { const chat = threadById(command.chatId); Chat.closeSupport(chat, actor); outcome = { kind: 'chat', chat }; break; }
        case 'review': {
          requireThat(!state.events.some(record => record.type === 'operation:review' && record.context.kind === 'job' && record.context.jobId === command.jobId), 'Conflict');
          if (!own(state.reviews, command.id)) Integrity.requireNewIdentity(state, 'review', command.id);
          const review = Reputation.createReview(state, jobById(command.jobId), actor,
            { id: command.id, stars: command.stars, marks: command.marks, comment: command.comment }, now);
          outcome = { kind: 'review', review }; break;
        }
        case 'hide_review': { const review = Integrity.reviewById(state, command.reviewId); Reputation.hideReview(review, actor, command.reason, now);
          emit('review_hidden', review.id, [], { jobId: review.jobId, reason: command.reason }); outcome = { kind: 'review', review }; break; }
        case 'hide_history': { const job = jobById(command.jobId); Reputation.hideHistory(state, job, actor); outcome = { kind: 'recorded', id: job.id }; break; }
        case 'preferences': {
          Validate.list(Validate.text('InvalidConfiguration'), 'InvalidConfiguration')(this.ports.notifications.supportedChannels);
          const preference = command.preference; requireThat(preference.userId === actor.userId, 'Unauthorized');
          requireThat(Array.isArray(preference.channels) && Array.isArray(preference.eventTypes) && typeof preference.soundRequested === 'boolean', 'InvalidConfiguration');
          requireThat(preference.channels.every(channel => this.ports.notifications.supportedChannels.includes(channel)) && new Set(preference.channels).size === preference.channels.length &&
            new Set(preference.eventTypes).size === preference.eventTypes.length && preference.eventTypes.every(type => notificationTypes.includes(type)), 'InvalidConfiguration');
          requireThat(preference.role === undefined || preference.role === actor.role, 'Unauthorized');
          put(state.preferences, `${actor.userId}:${actor.role}`, { ...preference, role: actor.role }); outcome = { kind: 'recorded', id: actor.userId }; break;
        }
        case 'inbox': { authorize(actor, 'support'); requireThat(own(state.users, command.recipientId) && !own(state.inbox, command.id) && command.original.trim(), 'InvalidReference');
          Integrity.requireNewIdentity(state, 'inbox', command.id); Accounts.accountById(state, command.recipientId); put(state.inbox, command.id, { id: command.id, recipientId: command.recipientId, original: command.original, at: now }); emit('inbox_message', command.id, [command.recipientId]); outcome = { kind: 'recorded', id: command.id }; break; }
        case 'feedback': { requireThat(!own(state.feedback, command.id) && command.original.trim(), 'Conflict');
          Integrity.requireNewIdentity(state, 'feedback', command.id); put(state.feedback, command.id, { id: command.id, authorId: actor.userId, original: command.original, at: now }); emit('feedback_received', command.id, admins); outcome = { kind: 'recorded', id: command.id }; break; }
        case 'evaluate_retention': {
          authorize(actor, 'retention'); const fact = Integrity.retentionById(state, command.factId, this.clock);
          const factId = command.factId;
          const legal = unwrap(Validate.syncPort(() => this.ports.legalRetention.restrictions(factId), Validate.restrictions, 'RetentionBlocked'));
          requireThat(typeof legal.hold === 'boolean' && (legal.notBefore === null || Number.isSafeInteger(legal.notBefore)), 'RetentionBlocked');
          outcome = { kind: 'retention', factId: command.factId, fact, assessment: evaluateRetention(fact, this.clock, legal) }; break;
        }
        default: requireThat(false, 'InvalidTransition', 'Unsupported operation');
      }
      let scope: EventContext = { kind: 'configuration' };
      let relatedJob: Market.Job | undefined;
      if ('jobId' in command) relatedJob = own(state.jobs, command.jobId);
      else if (command.type === 'new_job') relatedJob = own(state.jobs, command.id);
      else if (outcome.kind === 'resolution' || outcome.kind === 'resolution_evidence') relatedJob = own(state.jobs, outcome.resolution.jobId);
      else if (outcome.kind === 'settlement') relatedJob = own(state.jobs, outcome.obligation.jobId);
      if (outcome.kind === 'message' || outcome.kind === 'chat') {
        const chat = outcome.kind === 'chat' ? outcome.chat : own(state.threads, outcome.message.chatId)!;
        if (chat.context.type === 'job') relatedJob = own(state.jobs, chat.context.jobId);
        else scope = { kind: 'support', chatId: chat.id, userId: chat.context.userId, userRole: chat.context.userRole, basis: chat.context.basis, basisId: chat.context.basisId };
      } else if (outcome.kind === 'repayment') scope = { kind: 'repayment', requestId: outcome.request.id, masterId: outcome.request.masterId };
      else if (outcome.kind === 'user' || outcome.kind === 'role') scope = { kind: 'account', userId: actor.userId };
      if (command.type === 'hide_review' && outcome.kind === 'review') relatedJob = own(state.jobs, outcome.review.jobId);
      if (relatedJob) scope = { kind: 'job', jobId: relatedJob.id, clientId: relatedJob.clientId,
        masterId: outcome.kind === 'offer' ? outcome.offer.masterId : relatedJob.selectedMasterId };
      let proof: OperationProof | null = null;
      const refusal = Object.values(state.refusals).find(record => record.operationId === operationId);
      const recordedStreak = refusal ? own(state.refusalStreak, refusal.masterId) : undefined;
      requireThat(!refusal || recordedStreak !== undefined, 'InvalidReference');
      const refusalProof = refusal ? { record: refusal, streak: recordedStreak! } : null;
      if (command.type === 'publish_policy') proof = { kind: 'policy', policy: command.policy,
        initial: state.events.some(record => record.type === 'operation:publish_policy') ? null : state.policies.filter(policy => policy.version !== command.policy.version) };
      else if (command.type === 'translation_correction') proof = { kind: 'translation_correction', oldCatalogKey: command.oldCatalogKey, newCatalogKey: command.newCatalogKey, textId: command.textId };
      else if (command.type === 'threshold') proof = { kind: 'threshold', masterId: command.masterId, amount: command.amount };
      else if (command.type === 'preferences') proof = { kind: 'preferences', preference: { ...command.preference, role: actor.role } };
      else if (command.type === 'inbox') proof = { kind: 'inbox', message: own(state.inbox, command.id)! };
      else if (command.type === 'link_jobs') proof = { kind: 'link', jobId: command.jobId, linkedJobId: command.linkedJobId };
      else if (outcome.kind === 'user') proof = { kind: 'account', user: outcome.user, claimId: claim?.ok ? claim.value.id : null, claimPurpose: claim?.ok ? claim.value.purpose : null };
      else if (outcome.kind === 'catalog') {
        const value = outcome.catalog;
        proof = { kind: 'catalog', key: Catalog.catalogKey(value), sequence: value.sequence, status: value.status,
          initial: state.events.some(record => record.proof?.kind === 'catalog') ? null : Object.values(state.published),
          initialCurrent: state.events.some(record => record.proof?.kind === 'catalog') ? null : state.current,
          structure: command.type === 'save_catalog' ? { id: value.id, version: value.version, categories: value.categories, entities: value.entities,
            scenarios: value.scenarios, blocks: value.blocks, bindings: value.bindings } : null,
          texts: command.type === 'publish_catalog' ? [] : command.type === 'approve_text' ? value.texts.filter(text => text.id === command.textId) : value.texts };
      } else if (outcome.kind === 'offer') proof = { kind: 'offer', offer: outcome.offer, cycleIndex: Market.cycle(relatedJob!).index,
        financial: command.type === 'select_master' ? relatedJob!.financial : null, refusal: refusalProof };
      else if (outcome.kind === 'message') proof = { kind: 'message', message: outcome.message, mode: own(state.threads, outcome.message.chatId)!.mode };
      else if (outcome.kind === 'repayment') proof = { kind: 'repayment', request: outcome.request,
        receipt: outcome.request.receiptId ? own(state.receipts, outcome.request.receiptId) ?? null : null };
      else if (outcome.kind === 'resolution') proof = { kind: 'resolution', resolution: outcome.resolution, refusal: refusalProof };
      else if (outcome.kind === 'review') proof = { kind: 'review', review: outcome.review };
      if (command.type === 'publish_job') proof = { kind: 'publication', snapshot: relatedJob!.snapshot! };
      if (command.type === 'submit_result') {
        const evidence = relatedJob!.evidence.find(material => material.id === operationId); requireThat(evidence, 'EvidenceRequired'); proof = { kind: 'work', evidence };
      }
      if (command.type === 'accept_work') proof = { kind: 'acceptance', accepted: command.accepted };
      if (command.type === 'cancel' || command.type === 'cancellation_response') proof = { kind: 'cancellation', request: relatedJob!.cancellation! };
      if (command.type === 'initiate_payment') proof = { kind: 'instruction', operation: relatedJob!.reservation!.operations.find(value => value.id === command.id)! };
      if (command.type === 'start_payout' && outcome.kind === 'payout' || command.type === 'start_settlement' && outcome.kind === 'settlement') {
        const attempts = outcome.kind === 'payout' ? outcome.payout.attempts : outcome.kind === 'settlement' ? outcome.obligation.attempts : [];
        const attempt = attempts.find(value => value.id === command.attemptId); if (attempt) proof = { kind: 'instruction', operation: attempt };
      }
      const safeReason = provider?.ok ? Finance.failureReason(provider.value.status, provider.value.reason) : null;
      if (provider?.ok) proof = { kind: 'provider', outcome: { operationId: provider.value.operationId, binding: provider.value.binding,
        amount: provider.value.amount, currency: provider.value.currency, status: provider.value.status, ...(safeReason ? { reason: safeReason } : {}) } };
      const auditFacts: DomainEvent['facts'] = provider?.ok ? { operationId: provider.value.operationId, kind: provider.value.binding.kind, jobId: provider.value.binding.jobId,
        obligationId: provider.value.binding.obligationId, beneficiaryId: provider.value.binding.beneficiaryId, destinationId: provider.value.binding.destinationId,
        amount: provider.value.amount, currency: provider.value.currency, status: provider.value.status, reason: safeReason } : 'jobId' in command ? { jobId: command.jobId } : {};
      emit(`operation:${command.type}`, operationId, [], auditFacts);
      const updatedTimers = affectedJobIds.flatMap(id => { const job = own(state.jobs, id); return job ? Integrity.jobTimers(state, job) : []; }).filter(fact => !sameFact(previousTimers.get(fact.id), fact));
      const audit = events.at(-1)!;
      events[events.length - 1] = { ...audit, proof: snapshotFact(proof), timers: snapshotFact(updatedTimers) };
      const addressed = events.map(value => {
        const roles = Object.fromEntries(value.recipients.map(id => [id,
          ['resolution_opened', 'debt_repayment_requested', 'feedback_received'].includes(value.type) ? 'admin' :
          value.type === 'job_published' ? 'master' : scope.kind === 'support' ?
            value.type === 'chat_message' && actor.role !== 'admin' ? 'admin' : scope.userRole :
          scope.kind === 'job' ? id === scope.clientId ? 'client' : 'master' : scope.kind === 'repayment' ? 'master' :
          own(state.users, id)?.masterActive === true ? 'master' : 'client'])) as DomainEvent['recipientRoles'];
        return { ...value, context: scope, policyVersion: policy.version, recipientRoles: roles };
      });
      state.events.push(...addressed);
      const retentionPolicy = effectivePolicy(state.policies, now, state.events);
      for (const value of events) Integrity.registerRetention(state, `audit:${value.id}`, retentionFact('audit', value.at, 'recorded', retentionPolicy, this.clock));
      for (const fact of financialChange ? Integrity.financialRecords(state) : []) if (!previousFinancialIds.has(fact.id)) Integrity.registerRetention(state, `financial:${fact.id}`, retentionFact('financial', fact.at, 'recorded', effectivePolicy(state.policies, fact.at, state.events), this.clock));
      for (const job of relatedJob ? [relatedJob] : []) if (job.state !== 'draft') for (const kind of ['communication', 'evidence'] as const) {
        const key = `${kind}:${job.id}`; const existing = own(state.retention, key);
        if (!existing || existing.anchor === null && job.state === 'completed') {
          if (job.state === 'completed' && !checked(() => Integrity.requireCompletion(state, job)).ok) continue;
          const anchor = job.state === 'completed' ? job.completedAt : null;
          Integrity.registerRetention(state, key, retentionFact(kind, anchor, 'completed', anchor === null ? retentionPolicy : effectivePolicy(state.policies, anchor, state.events), this.clock));
        }
      }
      const stamped = { ...addressed.at(-1)!, retentions: snapshotFact(Object.entries(state.retention).filter(([id, fact]) => !sameFact(previousRetention.get(id), fact)).map(([id, fact]) => ({ id, fact }))) };
      addressed[addressed.length - 1] = stamped; state.events[state.events.length - 1] = stamped;
      return { outcome, events: addressed };
    })), access), Validate.execution, 'RepositoryOutcomeUnknown');
    if (!result.ok || command.type !== 'evaluate_retention') return result;
    // A receipt proves an evaluation happened, not continuing permission to act.
    // Re-evaluate on every replay without another mutation or audit event.
    const refreshed = await Validate.readRepository(this.ports.repository); if (!refreshed.ok) return refreshed; const currentState = refreshed.value;
    return checked(() => {
      authorizeCommand(currentState, currentAuth.value, command);
      const fact = Integrity.retentionById(currentState, command.factId, this.clock);
      const legal = unwrap(Validate.syncPort(() => this.ports.legalRetention.restrictions(command.factId), Validate.restrictions, 'RetentionBlocked'));
      requireThat(legal.notBefore === null || Number.isSafeInteger(legal.notBefore), 'RetentionBlocked');
      return { outcome: { kind: 'retention' as const, factId: command.factId, fact, assessment: evaluateRetention(fact, this.clock, legal) }, events: result.value.events };
    });
  }

  async translateMessage(session: string, messageId: string, target: string): Promise<Result<{ original: string; translated: string; locale: string }>> {
    const input = checked(() => { Validate.text('Unauthorized')(session); identifier(messageId); Validate.text('InvalidLocale')(target); }); if (!input.ok) return input;
    const auth = await Validate.callPort(() => this.ports.auth.authenticate(session), Validate.principal, 'Unauthorized'); if (!auth.ok) return auth;
    const loaded = await Validate.readRepository(this.ports.repository); if (!loaded.ok) return loaded; const state = loaded.value; const allowed = checked(() => {
      if (auth.value.role !== 'admin') { Accounts.requireActive(own(state.users, auth.value.userId), auth.value, auth.value.role); Accounts.accountById(state, auth.value.userId); }
      const message = own(state.messages, messageId); requireThat(message, 'NotFound'); const thread = Integrity.threadById(state, message.chatId); Chat.participant(thread, auth.value);
      Chat.messageById(state, thread, messageId, state.events);
      requireThat(effectivePolicy(state.policies, this.clock.now(), state.events).locales.includes(target), 'InvalidLocale');
      return { message, purpose: thread.context.type === 'job' ? 'job_chat' as const : 'external_translation' as const };
    });
    if (!allowed.ok) return allowed;
    const translated = await this.translator.translate(allowed.value.message.original, allowed.value.message.originalLanguage, target, allowed.value.purpose, async () => {
      const current = await Validate.callPort(() => this.ports.auth.authenticate(session), Validate.principal, 'Unauthorized'); if (!current.ok) return current;
      const loaded = await Validate.readRepository(this.ports.repository); if (!loaded.ok) return loaded; const currentState = loaded.value;
      return checked(() => {
        requireThat(current.value.userId === auth.value.userId && current.value.role === auth.value.role, 'Unauthorized');
        if (current.value.role !== 'admin') { Accounts.requireActive(own(currentState.users, current.value.userId), current.value, current.value.role); Accounts.accountById(currentState, current.value.userId); }
        const thread = Integrity.threadById(currentState, allowed.value.message.chatId); Chat.participant(thread, current.value);
        requireThat(sameFact(Chat.messageById(currentState, thread, messageId, currentState.events), allowed.value.message) &&
          (thread.context.type === 'job' ? 'job_chat' : 'external_translation') === allowed.value.purpose, 'InvalidReference');
        requireThat(effectivePolicy(currentState.policies, this.clock.now(), currentState.events).locales.includes(target), 'InvalidLocale');
      });
    });
    return translated.ok ? success({ original: allowed.value.message.original, translated: translated.value, locale: target }) : translated;
  }

  async draftTranslation(session: string, original: string, source: string, target: string): Promise<Result<{ candidate: string; approved: false }>> {
    const input = checked(() => { Validate.text('Unauthorized')(session); Validate.text('InvalidLocale')(original); Validate.text('InvalidLocale')(source); Validate.text('InvalidLocale')(target); }); if (!input.ok) return input;
    const auth = await Validate.callPort(() => this.ports.auth.authenticate(session), Validate.principal, 'Unauthorized'); if (!auth.ok) return auth;
    const loaded = await Validate.readRepository(this.ports.repository); if (!loaded.ok) return loaded; const state = loaded.value;
    const allowed = checked(() => { authorize(auth.value, 'catalog'); const locales = [...requiredLocales, ...effectivePolicy(state.policies, this.clock.now(), state.events).locales];
      requireThat(original.trim() && source !== target && locales.includes(source) && locales.includes(target), 'InvalidLocale'); }); if (!allowed.ok) return allowed;
    const translated = await this.translator.translate(original, source, target, 'external_translation', async () => {
      const current = await Validate.callPort(() => this.ports.auth.authenticate(session), Validate.principal, 'Unauthorized'); if (!current.ok) return current;
      const loaded = await Validate.readRepository(this.ports.repository); if (!loaded.ok) return loaded; const currentState = loaded.value;
      return checked(() => {
        requireThat(current.value.userId === auth.value.userId && current.value.role === auth.value.role, 'Unauthorized'); authorize(current.value, 'catalog');
        const locales = [...requiredLocales, ...effectivePolicy(currentState.policies, this.clock.now(), currentState.events).locales];
        requireThat(locales.includes(source) && locales.includes(target), 'InvalidLocale');
      });
    });
    return translated.ok ? success({ candidate: translated.value, approved: false }) : translated;
  }

  async dispatchNotification(session: string, eventId: string, recipientId: string, channel: string, deliveryId: string): Promise<Result<'delivered' | 'failed' | 'requested'>> {
    const input = checked(() => { Validate.text('Unauthorized')(session); [eventId, recipientId, channel, deliveryId].forEach(identifier);
      Validate.list(Validate.text('RouteUnavailable'), 'RouteUnavailable')(this.ports.notifications.supportedChannels); }); if (!input.ok) return input;
    const auth = await Validate.callPort(() => this.ports.auth.authenticate(session), Validate.principal, 'Unauthorized'); if (!auth.ok) return auth;
    const access = (state: Parameters<typeof authorizeCommand>[0], actor = auth.value) => checked(() => {
      authorize(actor, 'scheduler');
      Validate.list(Validate.text('RouteUnavailable'), 'RouteUnavailable')(this.ports.notifications.supportedChannels);
      const notification = state.events.find(value => value.id === eventId);
      requireThat(notification && notification.recipients.includes(recipientId), 'Unauthorized');
      const recipientRole = own(notification.recipientRoles, recipientId); requireThat(recipientRole, 'Unauthorized');
      const preference = Integrity.notificationPreference(state, recipientId, recipientRole);
      requireThat(!preference || preference.userId === recipientId && preference.role === recipientRole, 'InvalidReference');
      requireThat(this.ports.notifications.supportedChannels.includes(channel) && preference?.channels.includes(channel) &&
        preference.eventTypes.includes(notification.type as typeof notificationTypes[number]), 'RouteUnavailable');
    });
    const loaded = await Validate.readRepository(this.ports.repository); if (!loaded.ok) return loaded;
    const permitted = access(loaded.value); if (!permitted.ok) return permitted;
    const prepared = await Validate.callPort(() => this.ports.repository.transact(`delivery:${deliveryId}`, auth.value.userId, signature({ eventId, recipientId, channel }), 'return', Validate.domainCallback(state => checked(() => {
      authorize(auth.value, 'scheduler'); identifier(deliveryId);
      const notification = state.events.find(value => value.id === eventId);
      requireThat(notification && notification.recipients.includes(recipientId), 'Unauthorized');
      const recipientRole = own(notification.recipientRoles, recipientId); requireThat(recipientRole, 'Unauthorized');
      const preferences = own(state.preferences, `${recipientId}:${recipientRole}`);
      requireThat(this.ports.notifications.supportedChannels.includes(channel) && preferences?.channels.includes(channel) &&
        preferences.eventTypes.includes(notification.type as typeof notificationTypes[number]), 'RouteUnavailable');
      const existing = Object.values(state.deliveries).find(value => value.eventId === eventId && value.recipientId === recipientId && value.channel === channel);
      requireThat(!existing, 'Conflict');
      const delivery = { id: deliveryId, eventId, recipientId, recipientRole, channel, attempt: 1, status: 'requested' as const };
      put(state.deliveries, deliveryId, delivery); return { delivery, notification };
    })), Validate.domainCallback(access)), Validate.object({ delivery: Validate.delivery, notification: Validate.eventRecord }), 'RepositoryOutcomeUnknown');
    if (!prepared.ok) return prepared;
    const deliveryAccess = (state: Parameters<typeof authorizeCommand>[0]) => {
      const delivery = own(state.deliveries, deliveryId), notification = state.events.find(event => event.id === eventId);
      requireThat(delivery && prepared.value.notification.id === eventId && prepared.value.delivery.id === deliveryId &&
        prepared.value.delivery.eventId === eventId && prepared.value.delivery.recipientId === recipientId && prepared.value.delivery.channel === channel &&
        sameFact({ ...delivery, status: 'requested' }, prepared.value.delivery) && sameFact(notification, prepared.value.notification), 'InvalidReference');
      Validate.delivery(delivery); return delivery;
    };
    const reauthorize = async (pending = false) => {
      const current = await Validate.callPort(() => this.ports.auth.authenticate(session), Validate.principal, 'Unauthorized'); if (!current.ok) return current;
      const loaded = await Validate.readRepository(this.ports.repository); if (!loaded.ok) return loaded; const state = loaded.value;
      const sameActor = checked(() => { requireThat(current.value.userId === auth.value.userId && current.value.role === auth.value.role, 'Unauthorized');
        const delivery = deliveryAccess(state); requireThat(!pending || delivery.status === 'pending', 'InvalidTransition'); });
      return sameActor.ok ? access(state, current.value) : sameActor;
    };
    const beforeClaim = await reauthorize(); if (!beforeClaim.ok) return beforeClaim;
    // A persisted claim is never automatically re-sent after a crash/unknown delivery.
    const claimed = await Validate.callPort(() => this.ports.repository.claimDelivery(deliveryId), Validate.boolean(), 'InvalidTransition');
    if (!claimed.ok) return claimed;
    if (!claimed.value) {
      const loaded = await Validate.readRepository(this.ports.repository); if (!loaded.ok) return loaded;
      return checked(() => { const delivery = deliveryAccess(loaded.value); return delivery.status === 'delivered' || delivery.status === 'failed' ? delivery.status : 'requested'; });
    }
    const beforeDelivery = await reauthorize(true); if (!beforeDelivery.ok) return beforeDelivery;
    const notification = prepared.value.notification;
    const safe = notification.type === 'chat_message' || notification.type === 'support_opened' ? { ...notification, actorId: 'helpy' } : notification;
    const result = await Validate.callPort(() => this.ports.notifications.deliver(prepared.value.delivery, safe),
      value => requireThat(value === 'delivered' || value === 'failed', 'InvalidTransition'), 'InvalidTransition');
    if (!result.ok) return result;
    return Validate.callPort(() => this.ports.repository.transact(`delivery-result:${deliveryId}`, auth.value.userId, result.value, 'return', Validate.domainCallback(state => checked(() => {
      const delivery = deliveryAccess(state); requireThat(delivery.status === 'pending', 'InvalidTransition'); delivery.status = result.value; return result.value;
    }))), value => requireThat(value === 'delivered' || value === 'failed', 'InvalidTransition'), 'RepositoryOutcomeUnknown');
  }
}
