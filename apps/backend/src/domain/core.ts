import { compoundId } from './provenance.js';
import type { EventContext, OperationProof, TimerFact } from './provenance.js';
import type { RetentionFact } from './policy.js';

export const failureCodes = ['Unauthorized', 'NotFound', 'Conflict', 'InvalidConfiguration',
  'InvalidIdentity', 'IdentityOccupied', 'ContactUnverified', 'ClaimConsumed',
  'RoleInactive', 'ProfileIncomplete', 'InvalidLocale', 'TranslationUnavailable',
  'ApprovalRequired', 'StaleRevision', 'InvalidReference', 'InactiveEntity',
  'InvalidScope', 'RequiredAnswer', 'RequiredPhoto', 'InvalidPhoto', 'RouteRequired', 'StopCondition',
  'PublishedSnapshotImmutable', 'PublicationExpired', 'SpecializationMismatch',
  'ChatClosed', 'ConfirmationRequired', 'DiscussionRequired', 'PriceAlreadyRevised',
  'FinalApplicationRequired', 'ReservationExpired', 'CashUnavailable',
  'PaymentOutcomeUnknown', 'ProviderConflict', 'InvalidMoney', 'InvalidRate',
  'FixedRecoveryRate', 'DestinationUnverified', 'RouteUnavailable',
  'InvalidRepayment', 'ReceiptUnconfirmed', 'DebtChanged', 'InvalidTransition',
  'ResolutionRequired', 'EvidenceRequired', 'FundsMismatch', 'RetentionBlocked', 'SelfOrderForbidden', 'TextRejected', 'TextSafetyUnavailable',
  'RepositoryUnavailable', 'RepositoryOutcomeUnknown'] as const;
export type FailureCode = typeof failureCodes[number];

export interface Failure { readonly code: FailureCode; readonly detail: string }
export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: Failure };
export const success = <T>(value: T): Result<T> => ({ ok: true, value });
export const failure = (code: FailureCode, detail: string = code): Result<never> => ({ ok: false, error: { code, detail } });

class Rejection extends Error {
  constructor(readonly failure: Failure) { super(failure.detail); }
}
export function requireThat(condition: unknown, code: FailureCode, detail: string = code): asserts condition {
  if (!condition) throw new Rejection({ code, detail });
}
export function checked<T>(operation: () => T): Result<T> {
  try { return success(operation()); }
  catch (error) {
    if (error instanceof Rejection) return { ok: false, error: error.failure };
    throw error;
  }
}
export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Rejection(result.error);
  return result.value;
}
export function identifier(value: string): void {
  requireThat(typeof value === 'string' && value.trim().length > 0, 'InvalidIdentity');
}
// Stable IDs are data, including names also present on Object.prototype.
export function own<T>(entries: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(entries, key) ? entries[key] : undefined;
}
export function put<T>(entries: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(entries, key, { value, enumerable: true, writable: true, configurable: true });
}
export function positiveInteger(value: number): boolean { return Number.isSafeInteger(value) && value > 0; }

export type Role = 'client' | 'master' | 'admin';
export type Locale = string;
export const requiredLocales = ['th', 'ru', 'en'] as const;
export interface Principal { readonly userId: string; readonly role: Role; readonly permissions: readonly string[] }
export function authorize(actor: Principal, permission: string): void {
  requireThat(actor.role === 'admin' && actor.permissions.includes(permission), 'Unauthorized', permission);
}
export function owner(actor: Principal, userId: string, role: Role): void {
  requireThat(actor.userId === userId && actor.role === role, 'Unauthorized');
}
export function requireDifferentJobParties(clientId: string, masterId: string): void {
  requireThat(clientId !== masterId, 'SelfOrderForbidden');
}
export interface Period { readonly value: number; readonly unit: 'seconds' | 'days' | 'years' }
export interface Clock {
  // Timestamps are integer Unix seconds; ordinary timer durations are seconds.
  now(): number;
  // Calendar years must be resolved by the adapter, not approximated as 365 days.
  add(anchor: number, period: Period): number;
}
export interface Timer { readonly startedAt: number; readonly duration: number; readonly deadline: number; readonly policyVersion: string }
export function timer(now: number, duration: number, policyVersion: string): Timer {
  requireThat(Number.isSafeInteger(now) && positiveInteger(duration) && Number.isSafeInteger(now + duration), 'InvalidConfiguration');
  return { startedAt: now, duration, deadline: now + duration, policyVersion };
}
export interface Money { readonly amount: bigint; readonly currency: 'THB' }
export function money(amount: bigint, currency: string = 'THB'): Money {
  requireThat(typeof amount === 'bigint' && amount >= 0n && currency === 'THB', 'InvalidMoney');
  return { amount, currency };
}
export interface Rate { readonly numerator: bigint; readonly denominator: bigint }
export function rate(value: Rate): Rate {
  requireThat(typeof value?.numerator === 'bigint' && typeof value?.denominator === 'bigint' &&
    value.denominator > 0n && value.numerator >= 0n && value.numerator <= value.denominator, 'InvalidRate');
  return value;
}
export function portion(amount: bigint, value: Rate): bigint {
  money(amount); rate(value);
  return (amount * value.numerator * 2n + value.denominator) / (value.denominator * 2n);
}
export function complement(value: Rate): Rate { rate(value); return { numerator: value.denominator - value.numerator, denominator: value.denominator }; }
export function minimum(a: bigint, b: bigint): bigint { return a < b ? a : b; }

export const notificationTypes = ['job_published', 'initial_offer_sent', 'chat_message', 'price_adjustment_requested',
  'price_adjustment_approved', 'price_adjustment_rejected', 'final_application_sent', 'chat_closed', 'master_selected',
  'master_assigned', 'negotiations_closed', 'master_voluntary_refusal', 'refusal_recorded_warning', 'repeated_refusal_warning',
  'publication_closed', 'payment_status', 'payment_requested', 'reservation_released', 'completion_confirmed_by_client',
  'correction_requested', 'evidence_submitted', 'completed', 'refusal_streak_reset', 'cancellation_requested', 'cancellation_response',
  'resolution_opened', 'resolution_decided', 'negotiation_reminder', 'cancellation_reminder', 'inactivity_reminder',
  'payout_requested', 'debt_repayment_requested', 'debt_repayment_agreed', 'debt_repayment_received', 'debt_repayment_closed', 'support_opened',
  'inbox_message', 'feedback_received'] as const;
export type NotificationType = typeof notificationTypes[number];
export interface NotificationPreference { readonly userId: string; readonly role?: Role; readonly eventTypes: readonly NotificationType[]; readonly channels: readonly string[]; readonly soundRequested: boolean }
export type EventType = NotificationType | 'resolution_inspected' | 'review_hidden' | `operation:${string}`;
export interface DomainEvent {
  readonly id: string;
  readonly operationId: string;
  readonly type: EventType;
  readonly subjectId: string;
  readonly actorId: string;
  readonly actorRole: Role | null;
  readonly at: number;
  readonly recipients: readonly string[];
  readonly recipientRoles: Readonly<Record<string, Role>>;
  readonly facts: Readonly<Record<string, string | number | boolean | bigint | null>>;
  readonly context: EventContext;
  readonly proof: OperationProof | null;
  readonly timers: readonly TimerFact[];
  readonly retentions: readonly { readonly id: string; readonly fact: RetentionFact }[];
  readonly policyVersion: string | null;
}
export interface TransactionContext { readonly actor: Principal; readonly now: number; readonly operationId: string }
export function event(context: { readonly actor: { readonly userId: string; readonly role: Role | null }; readonly now: number; readonly operationId: string }, type: EventType, subjectId: string,
  recipients: readonly string[] = [], facts: DomainEvent['facts'] = {}): DomainEvent {
  return { id: compoundId(context.operationId, type, subjectId), operationId: context.operationId,
    type, subjectId, actorId: context.actor.userId, actorRole: context.actor.role, at: context.now, recipients: [...new Set(recipients)], recipientRoles: {}, facts,
    context: { kind: 'configuration' }, proof: null, timers: [], retentions: [], policyVersion: null };
}
export function immutable<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
