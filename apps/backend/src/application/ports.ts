import type { AccountState, VerifiedClaim, User } from '../domain/accounts.js';
import type { CatalogRepositoryState, PhotoMetadata } from '../domain/catalog.js';
import type { DomainEvent, NotificationPreference, Principal, Result, Role } from '../domain/core.js';
export type { NotificationPreference } from '../domain/core.js';
import type { FinanceState, PayoutDestination, ProviderOutcome, SettlementDestination, SettlementObligation } from '../domain/finance.js';
import type { MarketplaceState } from '../domain/marketplace.js';
import type { ChatState, InboxMessage } from '../domain/messaging.js';
export type { InboxMessage } from '../domain/messaging.js';
import type { PaymentRoute, Policy, RetentionFact } from '../domain/policy.js';
import type { ReputationState } from '../domain/reputation.js';
import type { WorkState } from '../domain/work.js';
import type { TextSafetyDecision, TextSafetyRequest } from '../domain/text-safety.js';

export interface Delivery { readonly id: string; readonly eventId: string; readonly recipientId: string; readonly recipientRole: Role; readonly channel: string; readonly attempt: number; status: 'requested' | 'pending' | 'delivered' | 'failed' }
export interface Feedback { readonly id: string; readonly authorId: string; readonly original: string; readonly at: number }
export interface CoreState extends AccountState, CatalogRepositoryState, MarketplaceState, ChatState, FinanceState, WorkState, ReputationState {
  policies: Policy[];
  events: DomainEvent[];
  preferences: Record<string, NotificationPreference>;
  deliveries: Record<string, Delivery>;
  inbox: Record<string, InboxMessage>;
  feedback: Record<string, Feedback>;
  retention: Record<string, RetentionFact>;
  /** Immutable registration of the initially applied basis, atomically recorded
   * with its source. A missing completion anchor may be bound once at completed.
   * Evaluations never replace this registration or choose a new policy. */
  retentionOrigins: Record<string, RetentionFact>;
  corrections: Record<string, string>;
  thresholdHistory: { readonly masterId: string; readonly amount: bigint | null; readonly version: string; readonly effectiveAt: number }[];
}
export interface AtomicRepository {
  /** Serializable, detached lookup only. Return null if the key is absent.
   * Check current access before returning a matching receipt; a different actor
   * or signature returns Conflict. Never execute or reserve a new operation.
   * Allows lawful replay without exporting the command payload to ports again. */
  replay<T>(operationId: string, actorId: string, signature: string, access: (state: CoreState) => Result<void>): Promise<Result<T> | null>;
  /**
   * Serializable, detached transaction across all touched aggregates, immutable
   * events and outbox. Failure rolls back EVERYTHING. Persist the operation key,
   * actor and signature with its result in the same commit. Replay returns that
    * result only AFTER the current access guard succeeds against current state;
    * reusing a key with a different actor/signature returns Conflict.
   * Results and reads must not expose live mutable repository references.
   * This guarantee must survive process restart. F3 implements its transaction.
   * replay=reject is for single-use recovery: a matching completed command must
   * return Conflict, never previously granted account access. Signatures contain
   * verified claim/operation identities, never bearer proofs or OTP values.
   */
  transact<T>(operationId: string, actorId: string, signature: string, replay: 'return' | 'reject', update: (state: CoreState) => Result<T>, access?: (state: CoreState) => Result<void>): Promise<Result<T>>;
  read(): Promise<CoreState>;
  /** Durable compare-and-set requested -> pending, returning true to one caller only. */
  claimDelivery(deliveryId: string): Promise<Result<boolean>>;
}
export interface AuthenticationPort {
  authenticate(session: string): Promise<Result<Principal>>;
  verifyClaim(proof: string): Promise<Result<VerifiedClaim>>;
}
export interface PhotoMetadataPort { lookup(ids: readonly string[]): Promise<Result<readonly PhotoMetadata[]>> }
export interface TranslationPort {
  translate(original: string, source: string | null, target: string): Promise<Result<string>>;
  detect(original: string): Promise<Result<{ language: string; reliable: boolean }>>;
}
export interface TextSafetyPort {
  /** Server-side inspection, never an export of unchecked text to translation
   * or language-detection APIs. A decision binds the exact text and purpose.
   * Real TH/RU/EN recognition and outbound-adapter enforcement belong to F3. */
  inspect(request: TextSafetyRequest): Promise<Result<TextSafetyDecision>>;
}
export interface PaymentProviderPort {
  incomingRoute(route: Exclude<PaymentRoute, 'cash'>): Promise<Result<IncomingRouteCapability>>;
  verifyOutcome(proof: string): Promise<Result<ProviderOutcome>>;
  payoutDestination(masterId: string): Promise<Result<PayoutDestination | null>>;
  settlementDestination(obligation: Readonly<SettlementObligation>): Promise<Result<SettlementDestination>>;
}
export interface IncomingRouteCapability {
  readonly route: Exclude<PaymentRoute, 'cash'>;
  readonly status: 'supported' | 'unsupported' | 'unknown';
}
export interface NotificationPort {
  readonly supportedChannels: readonly string[];
  deliver(delivery: Readonly<Delivery>, event: Readonly<DomainEvent>): Promise<Result<'delivered' | 'failed'>>;
}
export interface AuthorizationDirectoryPort { admins(permission: string): Promise<readonly string[]> }
export interface SupportAttachmentPolicyPort { photosAllowed(actor: Principal): boolean }
export interface LegalRetentionPolicyPort {
  validate(policy: Policy): Result<void>;
  restrictions(factId: string): Result<{ readonly hold: boolean; readonly notBefore: number | null }>;
}
export interface AccountReadPort { profile(userId: string): Promise<Result<User>> }
