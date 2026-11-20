import { checked, failure, failureCodes, identifier, requireThat, success, unwrap } from '../domain/core.js';
import type { Clock, FailureCode, Result } from '../domain/core.js';
import type { AtomicRepository, CoreState } from './ports.js';
import type { Command } from './domain-core.js';
import type { Query } from './queries.js';
import { snapshotFact } from '../domain/provenance.js';
import type { OperationProof } from '../domain/provenance.js';

// Runtime boundaries do not inherit TypeScript's compile-time guarantees.
// These validators check representation only; Domain still owns business rules.
export type Shape = (value: unknown) => void;
export const text = (code: FailureCode = 'InvalidTransition'): Shape => value => requireThat(typeof value === 'string', code);
export const boolean = (code: FailureCode = 'InvalidTransition'): Shape => value => requireThat(typeof value === 'boolean', code);
const number = (code: FailureCode = 'InvalidConfiguration'): Shape => value => requireThat(typeof value === 'number' && Number.isFinite(value), code);
const bigint = (code: FailureCode = 'InvalidMoney'): Shape => value => requireThat(typeof value === 'bigint', code);
const optional = (shape: Shape): Shape => value => { if (value !== undefined) shape(value); };
export const nullable = (shape: Shape): Shape => value => { if (value !== null) shape(value); };
export const list = (shape: Shape, code: FailureCode = 'InvalidTransition'): Shape => value => {
  requireThat(Array.isArray(value), code);
  for (const child of value) shape(child);
};
function record(value: unknown, code: FailureCode): asserts value is Record<string, unknown> {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)), code);
  requireThat(Reflect.ownKeys(value).every(key => typeof key === 'string' &&
    Object.getOwnPropertyDescriptor(value, key)?.get === undefined &&
    Object.getOwnPropertyDescriptor(value, key)?.set === undefined), code);
}
export const object = (fields: Readonly<Record<string, Shape>>, code: FailureCode = 'InvalidTransition'): Shape => value => {
  record(value, code);
  for (const [key, shape] of Object.entries(fields)) shape(Object.hasOwn(value, key) ? value[key] : undefined);
};
export const dictionary = (shape: Shape, code: FailureCode): Shape => value => {
  record(value, code); for (const child of Object.values(value)) shape(child);
};
const strings = (code: FailureCode = 'InvalidTransition') => list(text(code), code);
const id: Shape = value => { text('InvalidIdentity')(value); identifier(value as string); };
const s = text(), b = boolean('ConfirmationRequired'), n = number();
const photos = strings('InvalidPhoto');
const specialization = object({ categoryIds: strings('InvalidReference'), entityIds: strings('InvalidReference') }, 'InvalidReference');
const target = { categoryId: id, entityId: id, scenarioId: id };
const scalar: Shape = value => requireThat(['string', 'boolean', 'number'].includes(typeof value) &&
  (typeof value !== 'number' || Number.isFinite(value)), 'InvalidScope');
const answer: Shape = value => Array.isArray(value) ? list(number('InvalidScope'), 'InvalidScope')(value) : scalar(value);
const answers = dictionary(optional(answer), 'InvalidScope');
const item = object({ ...target, id, answers, photos: dictionary(photos, 'InvalidPhoto'),
  tables: dictionary(list(answers, 'InvalidScope'), 'InvalidScope') }, 'InvalidScope');
const draft = object({ items: list(item, 'InvalidScope'), cep: bigint(), address: text('InvalidScope') }, 'InvalidScope');
const ratio = object({ numerator: bigint('InvalidRate'), denominator: bigint('InvalidRate') }, 'InvalidRate');
const period = object({ value: n, unit: s }, 'InvalidConfiguration');
export const policy = object({
  version: id, effectiveAt: n, initialDuration: n, initialAutoClose: boolean('InvalidConfiguration'), repeatDurations: list(n, 'InvalidConfiguration'),
  repeatFloor: n, negotiationFirstReminder: n, negotiationRepeatReminder: n, paymentSelectionTimeout: n, providerConfirmation: optional(n),
  clientPaymentRoutes: strings('InvalidConfiguration'), masterPayoutRoutes: strings('InvalidConfiguration'),
  commission: ratio, globalDebtThreshold: bigint(), mutualCancellationFee: ratio, falseCallFee: ratio, falseCallMasterShare: ratio,
  cancellationResponse: n, cancellationReminder: n, inactivityFirstReminder: n, inactivityRepeatReminder: n, inactivityThreshold: n, historyLimit: n,
  communicationRetention: period, evidenceRetention: period, financialRetention: period, auditRetention: period, accountRetention: period,
  locales: strings('InvalidLocale'),
}, 'InvalidConfiguration');
const condition = object({ questionId: id, equals: scalar }, 'InvalidConfiguration');
const conditions = list(condition, 'InvalidConfiguration');
const question = object({ id, textId: id, required: boolean('InvalidConfiguration'), kind: s,
  choices: optional(list(object({ id, textId: id }, 'InvalidConfiguration'), 'InvalidConfiguration')), when: optional(conditions) }, 'InvalidConfiguration');
const form = object({
  id, questions: list(question, 'InvalidConfiguration'),
  photos: list(object({ id, textId: id, minimum: n, maximum: optional(n), formats: strings('InvalidConfiguration'), when: optional(conditions) }, 'InvalidConfiguration'), 'InvalidConfiguration'),
  tables: list(object({ id, textId: id, initialRows: n, fixedRows: optional(n), minimumRows: n, columns: list(question, 'InvalidConfiguration') }, 'InvalidConfiguration'), 'InvalidConfiguration'),
  routes: list(object({ id, when: conditions, target: object(target, 'InvalidConfiguration') }, 'InvalidConfiguration'), 'InvalidConfiguration'),
  stops: list(object({ id, when: conditions, textId: id }, 'InvalidConfiguration'), 'InvalidConfiguration'),
  linkedCategories: strings('InvalidConfiguration'),
}, 'InvalidConfiguration');
export const catalog = object({
  id, version: n, sequence: n, status: s,
  texts: list(object({ id, revision: n, meaning: n, editions: dictionary(object({ text: s, revision: n, approvedBy: nullable(s) }, 'InvalidConfiguration'), 'InvalidConfiguration') }, 'InvalidConfiguration'), 'InvalidConfiguration'),
  categories: list(object({ id, title: id, description: id, architecture: s, enabled: boolean('InvalidConfiguration'), order: n }, 'InvalidConfiguration'), 'InvalidConfiguration'),
  entities: list(object({ id, categoryId: id, title: id, description: id, enabled: boolean('InvalidConfiguration'), order: n, scenarioIds: strings() }, 'InvalidConfiguration'), 'InvalidConfiguration'),
  scenarios: list(object({ id, entityId: id, action: id, title: id, form }, 'InvalidConfiguration'), 'InvalidConfiguration'),
  blocks: list(object({ id, revision: n, textId: id, roles: strings(), enabled: boolean('InvalidConfiguration') }, 'InvalidConfiguration'), 'InvalidConfiguration'),
  bindings: list(object({ id, blockId: id, blockRevision: n, role: s, categoryId: optional(id), entityId: optional(id), scenarioId: optional(id), order: n }, 'InvalidConfiguration'), 'InvalidConfiguration'),
}, 'InvalidConfiguration');
const decision = object({ id, type: s, reason: text('EvidenceRequired'), evidence: strings('EvidenceRequired'),
  facts: object({ arrived: boolean('ResolutionRequired'), partialWork: boolean('ResolutionRequired'), voluntaryRefusalProven: boolean('ResolutionRequired'),
    acceptanceReviewed: boolean('ResolutionRequired'), historyReviewed: boolean('ResolutionRequired') }, 'ResolutionRequired'),
  shares: optional(object({ clientRefund: bigint(), masterCompensation: bigint() }, 'FundsMismatch')) }, 'ResolutionRequired');

const commandFields: Record<Command['type'], Readonly<Record<string, Shape>>> = {
  publish_policy: { policy }, threshold: { masterId: id, amount: nullable(bigint()) },
  save_catalog: { draft: catalog, expectedSequence: nullable(n) },
  approve_text: { key: id, textId: id, locale: s, sequence: n, revision: n },
  approve_content_set: { key: id, sequence: n, revisions: list(object({ textId: id, revision: n })), confirmed: b },
  publish_catalog: { key: id, sequence: n },
  translation_correction: { oldCatalogKey: id, newCatalogKey: id, textId: id, sameMeaningConfirmed: b },
  profile: { displayName: text('ProfileIncomplete'), photoId: nullable(text('InvalidPhoto')), specialization },
  activate: { role: s }, switch_role: { role: s }, locale: { locale: text('InvalidLocale') }, bind_contact: { proof: s },
  new_job: { id, draft }, edit_draft: { jobId: id, draft }, publish_job: { jobId: id }, link_jobs: { jobId: id, linkedJobId: id },
  initial_offer: { jobId: id, id, chatId: id }, message: { chatId: id, id, original: text('InvalidScope'), photoIds: photos, sender: s },
  revise_price: { jobId: id, masterId: id, amount: bigint(), reason: text('InvalidMoney'), confirmed: b },
  approve_price: { jobId: id, masterId: id, approved: b, confirmed: b },
  final_application: { jobId: id, masterId: id, confirmed: b, amount: bigint(), recipientId: id },
  select_master: { jobId: id, masterId: id, confirmed: b, amount: bigint() },
  terminate_negotiation: { jobId: id, masterId: id, confirmed: b, reason: text('EvidenceRequired') },
  publication_deadline: { jobId: id, cycleIndex: n }, cash: { jobId: id }, initiate_payment: { jobId: id, id, route: s },
  payment_outcome: { jobId: id, proof: s }, reservation_deadline: { jobId: id }, decline_reservation: { jobId: id, confirmed: b },
  accept_work: { jobId: id, accepted: b, explanation: text('EvidenceRequired') },
  submit_result: { jobId: id, explanation: text('EvidenceRequired'), photoIds: photos }, complete: { jobId: id },
  cancel: { jobId: id, id, reason: text('EvidenceRequired'), explanation: text('EvidenceRequired'), evidence: photos, confirmed: b, classification: s, remainingWork: text('EvidenceRequired') },
  cancellation_response: { jobId: id, workStopped: boolean(), financialConsent: boolean(), explanation: text('EvidenceRequired'), remainingWork: optional(text('EvidenceRequired')), evidence: optional(strings('EvidenceRequired')) },
  open_resolution: { jobId: id, id, evidence: strings('EvidenceRequired') }, decide_resolution: { caseId: id, decision }, inspect_resolution: { caseId: id },
  reminders: { jobId: id }, start_payout: { jobId: id, attemptId: id }, payout_outcome: { jobId: id, proof: s },
  start_settlement: { obligationId: id, attemptId: id }, settlement_outcome: { obligationId: id, proof: s },
  request_repayment: { id, amount: bigint(), confirmed: b }, agree_repayment: { requestId: id, amount: bigint(), method: s, agreementId: id },
  receive_repayment: { requestId: id, masterId: id, amount: bigint(), receiptId: id, agreementId: id, actuallyReceived: boolean('ReceiptUnconfirmed'), evidence: text('ReceiptUnconfirmed') },
  close_repayment: { requestId: id, reason: text('EvidenceRequired') }, support: { id, userId: id, userRole: s, basis: s, basisId: id },
  close_support: { chatId: id }, review: { jobId: id, id, stars: number('InvalidScope'), marks: strings('InvalidScope'), comment: text('InvalidScope') },
  hide_review: { reviewId: id, reason: text('EvidenceRequired') }, hide_history: { jobId: id },
  preferences: { preference: object({ userId: id, role: optional(s), eventTypes: strings('InvalidConfiguration'), channels: strings('InvalidConfiguration'), soundRequested: boolean('InvalidConfiguration') }, 'InvalidConfiguration') },
  inbox: { id, recipientId: id, original: s }, feedback: { id, original: s }, evaluate_retention: { factId: id },
};
const queryFields: Record<Query['type'], Readonly<Record<string, Shape>>> = {
  feed: {}, job: { jobId: id }, payment: { jobId: id }, debt: { masterId: id }, cash_availability: { masterId: id },
  information: { catalogKey: id, targets: list(object(target, 'InvalidReference'), 'InvalidReference'), locale: s, jobId: optional(id) },
  published_text: { catalogKey: id, textId: id, locale: s, corrected: optional(boolean()), jobId: optional(id) },
  chat_history: { chatId: id }, history: {}, reputation: { masterId: id }, contacts: { userId: id }, role_counts: {},
  repayment: { requestId: id }, payout: { jobId: id }, inbox: {},
};

/** Reject cycles, accessors and non-data objects before recursion/signatures.
 * Do not catch arbitrary exceptions: unexpected implementation errors propagate. */
function data(value: unknown, ancestors = new Set<object>(), code: FailureCode = 'InvalidTransition'): void {
  if (value === null || ['undefined', 'string', 'boolean', 'number', 'bigint'].includes(typeof value)) return;
  requireThat(typeof value === 'object' && value !== null && !ancestors.has(value), code);
  ancestors.add(value);
  if (Array.isArray(value)) {
    requireThat(Reflect.ownKeys(value).every(key => typeof key === 'string' &&
      Object.getOwnPropertyDescriptor(value, key)?.get === undefined &&
      Object.getOwnPropertyDescriptor(value, key)?.set === undefined), code);
    for (const child of value) data(child, ancestors, code);
  }
  else { record(value, code); for (const child of Object.values(value)) data(child, ancestors, code); }
  ancestors.delete(value);
}
function variant(value: unknown, fields: Readonly<Record<string, Readonly<Record<string, Shape>>>>): void {
  record(value, 'InvalidTransition'); requireThat(typeof value.type === 'string' && Object.hasOwn(fields, value.type), 'InvalidTransition');
  data(value); object(fields[value.type]!)(value);
}
export const command = (value: Command): void => variant(value, commandFields);
export const query = (value: Query): void => variant(value, queryFields);
export const principal = object({ userId: id, role: s, permissions: strings('Unauthorized') }, 'Unauthorized');
export const claim = object({ id, purpose: s, identity: object({ method: id, subject: id }, 'ContactUnverified'),
  email: nullable(text('ContactUnverified')), phone: nullable(text('ContactUnverified')), expiresAt: number('ContactUnverified'), ownerId: nullable(id) }, 'ContactUnverified');
export const photoMetadata = list(object({ id, ownerId: id, present: boolean('InvalidPhoto'), format: text('InvalidPhoto') }, 'InvalidPhoto'), 'InvalidPhoto');
export const providerOutcome = object({ operationId: id, binding: object({ kind: s, jobId: id, obligationId: id, beneficiaryId: id, destinationId: nullable(id) }, 'ProviderConflict'),
  amount: bigint('ProviderConflict'), currency: s, status: s, reason: optional(s) }, 'ProviderConflict');
export const detection = object({ language: value => { text('TranslationUnavailable')(value);
  requireThat(/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(value as string), 'TranslationUnavailable'); }, reliable: boolean('TranslationUnavailable') }, 'TranslationUnavailable');
export const textSafetyDecision = object({ text: text('TextSafetyUnavailable'), purpose: text('TextSafetyUnavailable'),
  status: text('TextSafetyUnavailable'), reason: nullable(text('TextSafetyUnavailable')) }, 'TextSafetyUnavailable');
export const restrictions = object({ hold: boolean('RetentionBlocked'), notBefore: nullable(number('RetentionBlocked')) }, 'RetentionBlocked');
export const capability = object({ route: s, status: s }, 'RouteUnavailable');
export const payoutDestination = nullable(object({ id, masterId: id, route: s, verified: boolean('DestinationUnverified'), available: boolean('RouteUnavailable') }, 'DestinationUnverified'));
export const settlementDestination = object({ id, beneficiaryId: id, route: s, verified: boolean('DestinationUnverified'), available: boolean('RouteUnavailable'), sourcePaymentId: nullable(id) }, 'DestinationUnverified');
export const resultShape = (shape: Shape, code: FailureCode): Shape => input => {
    data(input, new Set<object>(), code);
    record(input, code); const value = input as Result<unknown>;
    record(value, code); requireThat(typeof value.ok === 'boolean', code);
    if (value.ok) shape(value.value);
    else { object({ code: text(code), detail: text(code) }, code)(value.error); requireThat(failureCodes.includes(value.error.code), code); }
};
export function portResult<T>(value: Result<T>, shape: Shape, code: FailureCode): Result<T> {
  const valid = checked(() => resultShape(shape, code)(value));
  return valid.ok ? value.ok ? success(snapshotFact(value.value)) : value : valid;
}

class CallbackFailure { constructor(readonly error: unknown) {} }
export function domainCallback<A extends unknown[], T>(operation: (...args: A) => T): (...args: A) => T {
  return (...args) => { try { return operation(...args); } catch (error) { if (error instanceof CallbackFailure) throw error; throw new CallbackFailure(error); } };
}
function unavailable(error: unknown, code: FailureCode): Result<never> {
  // Operational port outages are typed. Broken implementations remain visible
  // as programmer errors, as required by the existing R3 boundary contract.
  if (error instanceof CallbackFailure) throw error.error;
  if (error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError || error instanceof SyntaxError) throw error;
  return failure(code);
}
export async function callPort<T>(operation: () => Promise<Result<T>>, shape: Shape, code: FailureCode): Promise<Result<T>> {
  let result: Result<T>;
  try { result = await operation(); } catch (error) { return unavailable(error, code); }
  return portResult(result, shape, code);
}
export function syncPort<T>(operation: () => Result<T>, shape: Shape, code: FailureCode): Result<T> {
  let result: Result<T>;
  try { result = operation(); } catch (error) { return unavailable(error, code); }
  return portResult(result, shape, code);
}

const timestamp: Shape = value => requireThat(typeof value === 'number' && Number.isSafeInteger(value), 'InvalidConfiguration');
export function guardedClock(clock: Clock): Clock {
  return {
    now: () => unwrap(syncPort(() => success(clock.now()), timestamp, 'InvalidConfiguration')),
    add: (anchor, period) => unwrap(syncPort(() => success(clock.add(anchor, period)), timestamp, 'InvalidConfiguration')),
  };
}
export const repositoryRecord = object({}, 'InvalidReference');
const storedText = text('InvalidReference'), storedList = (shape: Shape) => list(shape, 'InvalidReference');
const storedFinancial = object({ commission: repositoryRecord, mutualCancellationFee: repositoryRecord,
  falseCallFee: repositoryRecord, falseCallMasterShare: repositoryRecord }, 'InvalidReference');
const storedOperation = object({ binding: repositoryRecord, providerTimer: repositoryRecord }, 'InvalidReference');
export const transfer = object({ attempts: storedList(storedOperation) }, 'InvalidReference');
export const job = object({
  cycles: storedList(object({ countdown: nullable(repositoryRecord) }, 'InvalidReference')),
  offers: dictionary(object({ id: storedText, jobId: storedText, masterId: storedText, chatId: storedText,
    revised: nullable(repositoryRecord), final: nullable(repositoryRecord) }, 'InvalidReference'), 'InvalidReference'),
  excludedMasters: storedList(storedText), evidence: storedList(repositoryRecord),
  snapshot: nullable(repositoryRecord), draft: nullable(repositoryRecord), financial: nullable(storedFinancial),
  reservation: nullable(object({ countdown: repositoryRecord, operations: storedList(storedOperation) }, 'InvalidReference')),
  cancellation: nullable(object({ responseTimer: repositoryRecord, reminder: repositoryRecord, evidence: storedList(storedText),
    response: nullable(object({ evidence: storedList(storedText) }, 'InvalidReference')) }, 'InvalidReference')),
}, 'InvalidReference');
export const thread = object({ context: repositoryRecord, messageIds: storedList(storedText) }, 'InvalidReference');
const refusalProof = nullable(object({ record: repositoryRecord }, 'InvalidReference'));
const proofFields: Record<OperationProof['kind'], Readonly<Record<string, Shape>>> = {
  account: { user: repositoryRecord }, preferences: { preference: repositoryRecord },
  policy: { policy: repositoryRecord, initial: nullable(storedList(repositoryRecord)) },
  translation_correction: { oldCatalogKey: storedText, newCatalogKey: storedText, textId: storedText },
  threshold: { masterId: storedText },
  catalog: { initial: nullable(storedList(repositoryRecord)), structure: nullable(repositoryRecord), texts: storedList(repositoryRecord) },
  instruction: { operation: storedOperation }, provider: { outcome: object({ binding: repositoryRecord }, 'InvalidReference') },
  offer: { offer: repositoryRecord, financial: nullable(repositoryRecord), refusal: refusalProof },
  publication: { snapshot: repositoryRecord }, link: { jobId: storedText, linkedJobId: storedText },
  message: { message: repositoryRecord }, inbox: { message: repositoryRecord }, cancellation: { request: repositoryRecord },
  resolution: { resolution: repositoryRecord, refusal: refusalProof }, repayment: { request: repositoryRecord, receipt: nullable(repositoryRecord) },
  review: { review: repositoryRecord }, work: { evidence: repositoryRecord }, acceptance: { accepted: boolean('InvalidReference') },
};
const proofRecord: Shape = value => {
  record(value, 'InvalidReference');
  requireThat(typeof value.kind === 'string' && Object.hasOwn(proofFields, value.kind), 'InvalidReference');
  object(proofFields[value.kind as OperationProof['kind']], 'InvalidReference')(value);
};
export const eventRecord = object({ id, operationId: id, subjectId: id, actorId: id, actorRole: nullable(storedText), at: number('InvalidReference'),
  recipients: storedList(storedText), recipientRoles: dictionary(storedText, 'InvalidReference'), policyVersion: nullable(storedText),
  type: storedText, context: object({ kind: storedText }, 'InvalidReference'),
  facts: repositoryRecord, timers: list(repositoryRecord, 'InvalidReference'), retentions: list(repositoryRecord, 'InvalidReference'),
  proof: nullable(proofRecord) }, 'InvalidReference');
export const delivery = object({ id, eventId: id, recipientId: id, recipientRole: text('InvalidReference'), channel: id,
  attempt: value => requireThat(value === 1, 'InvalidReference'),
  status: value => requireThat(['requested', 'pending', 'delivered', 'failed'].includes(value as string), 'InvalidReference') }, 'InvalidReference');
const stateRecord = object(Object.fromEntries([
  'users', 'consumedClaims', 'drafts', 'published', 'jobs', 'refusalStreak', 'refusals', 'threads', 'messages', 'debt', 'thresholds',
  'ledger', 'payouts', 'repayments', 'receipts', 'cases', 'obligations', 'reviews', 'hiddenHistory', 'preferences', 'deliveries', 'inbox',
  'feedback', 'retention', 'retentionOrigins', 'corrections',
].map(key => [key, repositoryRecord]).concat([['events', list(eventRecord, 'InvalidReference')], ['policies', list(repositoryRecord, 'InvalidReference')],
  ['thresholdHistory', list(repositoryRecord, 'InvalidReference')]])), 'InvalidReference');
export function readRepository(repository: Pick<AtomicRepository, 'read'>): Promise<Result<CoreState>> {
  return callPort(async () => success(await repository.read()), stateRecord, 'RepositoryUnavailable');
}
export const account = object({ id, createdAt: timestamp, identities: list(object({ method: id, subject: id })), email: nullable(s), phone: nullable(s),
  displayName: s, photoId: nullable(s), locale: s, clientActive: boolean(), masterActive: boolean(), specialization, contacts: repositoryRecord });
export const execution: Shape = value => {
  const valid = checked(() => { data(value); object({ outcome: object({ kind: s }), events: list(eventRecord) })(value); });
  requireThat(valid.ok, 'RepositoryOutcomeUnknown');
};
