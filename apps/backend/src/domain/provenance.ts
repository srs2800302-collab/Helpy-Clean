import type { NotificationPreference, Timer } from './core.js';
import type { FinancialSnapshot, PaymentOperation, TransferAttempt, ProviderOutcome, DebtRepaymentRequest, DebtRepaymentReceipt } from './finance.js';
import type { Job, Offer, JobScopeSnapshot, CancellationRequest, RefusalRecord } from './marketplace.js';
import type { CatalogRevision, TextRevision } from './catalog.js';
import type { ChatMessage, ChatThread, InboxMessage } from './messaging.js';
import type { ResolutionCase } from './work.js';
import type { Review } from './reputation.js';
import type { Policy } from './policy.js';
import type { User, VerifiedClaim } from './accounts.js';

export type EventContext =
  | { readonly kind: 'job'; readonly jobId: string; readonly clientId: string; readonly masterId: string | null }
  | { readonly kind: 'support'; readonly chatId: string; readonly userId: string; readonly userRole: 'client' | 'master'; readonly basis: 'repayment' | 'resolution'; readonly basisId: string }
  | { readonly kind: 'repayment'; readonly requestId: string; readonly masterId: string }
  | { readonly kind: 'account'; readonly userId: string }
  | { readonly kind: 'configuration' };

export interface TimerFact {
  readonly id: string;
  readonly kind: 'publication' | 'reservation' | 'provider' | 'cancellation_response' | 'cancellation_reminder' | 'negotiation_reminder' | 'inactivity_reminder' | 'inactivity_threshold';
  readonly value: Timer | null;
  readonly index: number | null;
}
export interface RefusalProof { readonly record: RefusalRecord; readonly streak: number }
// Original operands/results belong to the atomic audit, not to mutable status fields.
export type OperationProof =
  | { readonly kind: 'account'; readonly user: User; readonly claimId: string | null; readonly claimPurpose: VerifiedClaim['purpose'] | null }
  | { readonly kind: 'preferences'; readonly preference: NotificationPreference }
  | { readonly kind: 'policy'; readonly policy: Policy; readonly initial: readonly Policy[] | null }
  | { readonly kind: 'translation_correction'; readonly oldCatalogKey: string; readonly newCatalogKey: string; readonly textId: string }
  | { readonly kind: 'threshold'; readonly masterId: string; readonly amount: bigint | null }
  | { readonly kind: 'catalog'; readonly key: string; readonly sequence: number; readonly status: CatalogRevision['status']; readonly initial: readonly CatalogRevision[] | null; readonly initialCurrent: string | null;
      readonly structure: Omit<CatalogRevision, 'texts' | 'sequence' | 'status'> | null; readonly texts: readonly TextRevision[] }
  | { readonly kind: 'instruction'; readonly operation: Readonly<PaymentOperation | TransferAttempt> }
  | { readonly kind: 'provider'; readonly outcome: ProviderOutcome }
  | { readonly kind: 'offer'; readonly offer: Readonly<Offer>; readonly cycleIndex: number; readonly financial: FinancialSnapshot | null; readonly refusal: RefusalProof | null }
  | { readonly kind: 'publication'; readonly snapshot: JobScopeSnapshot }
  | { readonly kind: 'link'; readonly jobId: string; readonly linkedJobId: string }
  | { readonly kind: 'message'; readonly message: ChatMessage; readonly mode: ChatThread['mode'] }
  | { readonly kind: 'inbox'; readonly message: InboxMessage }
  | { readonly kind: 'cancellation'; readonly request: Readonly<CancellationRequest> }
  | { readonly kind: 'resolution'; readonly resolution: Readonly<ResolutionCase>; readonly refusal: RefusalProof | null }
  | { readonly kind: 'repayment'; readonly request: Readonly<DebtRepaymentRequest>; readonly receipt: DebtRepaymentReceipt | null }
  | { readonly kind: 'review'; readonly review: Readonly<Review> }
  | { readonly kind: 'work'; readonly evidence: Job['evidence'][number] }
  | { readonly kind: 'acceptance'; readonly accepted: boolean };

export function compoundId(...parts: readonly string[]): string {
  return parts.map(part => `${part.length}:${part}`).join('');
}
export function sameFact(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right) && left.length !== right.length) return false;
  const a = Object.entries(left), b = Object.entries(right);
  return a.length === b.length && a.every(([key, value]) => Object.hasOwn(right, key) && sameFact(value, (right as Record<string, unknown>)[key]));
}
export function snapshotFact<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  const copy = Array.isArray(value) ? value.map(snapshotFact) : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, snapshotFact(child)]));
  return Object.freeze(copy) as T;
}
