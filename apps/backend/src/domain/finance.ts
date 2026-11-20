import { authorize, complement, identifier, minimum, money, own, owner, portion, put, rate, requireThat, timer } from './core.js';
import type { DomainEvent, Principal, Rate, Timer } from './core.js';
import type { PaymentRoute, Policy, PayoutRoute } from './policy.js';
import { sameFact } from './provenance.js';

export interface FinancialSnapshot {
  readonly fap: bigint; readonly currency: 'THB'; readonly policyVersion: string; readonly commission: Rate;
  readonly mutualCancellationFee: Rate; readonly falseCallFee: Rate; readonly falseCallMasterShare: Rate;
}
export function financialSnapshot(fap: bigint, policy: Policy): FinancialSnapshot {
  money(fap); requireThat(fap > 0n, 'InvalidMoney');
  return { fap, currency: 'THB', policyVersion: policy.version, commission: policy.commission,
    mutualCancellationFee: policy.mutualCancellationFee, falseCallFee: policy.falseCallFee, falseCallMasterShare: policy.falseCallMasterShare };
}
export type ProviderStatus = 'pending' | 'unknown' | 'success' | 'failed';
export type FailureReason = 'insufficient_funds' | 'declined' | 'unavailable' | 'unspecified';
export interface ProviderBinding {
  readonly kind: 'payment' | 'payout' | 'refund' | 'compensation'; readonly jobId: string;
  readonly obligationId: string; readonly beneficiaryId: string; readonly destinationId: string | null;
}
export interface ProviderOutcome { readonly operationId: string; readonly binding: ProviderBinding; readonly amount: bigint; readonly currency: string; readonly status: ProviderStatus; readonly reason?: FailureReason }
export interface TransferAttempt { readonly id: string; readonly binding: ProviderBinding; readonly amount: bigint; readonly currency: 'THB'; readonly route: PayoutRoute; readonly destinationId: string; readonly initiatedAt: number; readonly providerDeadline: number; readonly providerTimer: Timer; status: ProviderStatus; reason: FailureReason | null }
export interface PaymentOperation { readonly id: string; readonly binding: ProviderBinding; readonly amount: bigint; readonly currency: 'THB'; readonly route: Exclude<PaymentRoute, 'cash'>; readonly initiatedAt: number; readonly providerDeadline: number; readonly providerTimer: Timer; status: ProviderStatus; reason: FailureReason | null }
export interface PaymentReservation { readonly masterId: string; readonly selectedAt: number; countdown: Timer; resetUsed: boolean; operations: PaymentOperation[]; state: 'reserved' | 'assigned' | 'released'; method: PaymentRoute | null }
export interface MasterPayout {
  readonly id: string; readonly jobId: string; readonly masterId: string; readonly snapshot: FinancialSnapshot;
  readonly commission: bigint; readonly debtBefore: bigint; readonly netBeforeDebt: bigint; readonly debtRecovery: bigint;
  readonly amount: bigint; readonly createdAt: number; attempts: TransferAttempt[]; settled: boolean;
}
export interface LedgerEntry { readonly id: string; readonly masterId: string; readonly basis: string; readonly change: bigint; readonly at: number; readonly actorId: string }
export interface DebtRepaymentRequest {
  readonly id: string; readonly masterId: string; readonly amount: bigint; readonly requestedAt: number; agreedAmount: bigint | null;
  status: 'requested' | 'agreed' | 'received' | 'closed'; method: 'cash' | 'bank_transfer' | null;
  supportChatId: string | null; agreementId: string | null; receiptId: string | null;
}
export interface DebtRepaymentReceipt { readonly id: string; readonly requestId: string; readonly masterId: string; readonly amount: bigint; readonly method: 'cash' | 'bank_transfer'; readonly receivedAt: number; readonly actorId: string; readonly evidence: string }
export interface FinanceState { debt: Record<string, bigint>; thresholds: Record<string, bigint>; ledger: Record<string, LedgerEntry>; payouts: Record<string, MasterPayout>; repayments: Record<string, DebtRepaymentRequest>; receipts: Record<string, DebtRepaymentReceipt>; readonly events?: readonly DomainEvent[] }
export function debtBalance(state: FinanceState, masterId: string): bigint {
  const value = Object.hasOwn(state.debt, masterId) ? own(state.debt, masterId)! : 0n;
  money(value);
  if (state.events) {
    const financialCommands = state.events.filter(record => record.context.kind === 'job' && record.context.masterId === masterId &&
      (record.type === 'operation:complete' || record.type === 'operation:decide_resolution' && record.proof?.kind === 'resolution' &&
        record.proof.resolution.decision?.type === 'exceptional_completion') || record.context.kind === 'repayment' && record.context.masterId === masterId && record.type === 'operation:receive_repayment');
    const financialFacts = state.events.filter(record => record.type === 'completed' && record.context.kind === 'job' && record.context.masterId === masterId ||
      record.type === 'debt_repayment_received' && record.context.kind === 'repayment' && record.context.masterId === masterId);
    requireThat(financialCommands.length === financialFacts.length && financialCommands.every(source => financialFacts.filter(record =>
      record.operationId === source.operationId && record.actorId === source.actorId && record.actorRole === source.actorRole &&
      record.at === source.at && sameFact(record.context, source.context)).length === 1), 'InvalidReference');
    let balance: bigint | undefined;
    const expected: LedgerEntry[] = [];
    for (const record of state.events) {
      let before: bigint, change: bigint, id: string, basis: string;
      if (record.type === 'completed' && record.context.kind === 'job' && record.context.masterId === masterId) {
        before = record.facts.debtBefore as bigint;
        const cash = record.facts.payoutId === undefined;
        change = cash ? record.facts.commission as bigint : -(record.facts.debtRecovery as bigint);
        id = `${cash ? 'commission' : 'recovery'}:${record.context.jobId}`; basis = id;
        if (!cash && change === 0n) { money(before); requireThat(balance === undefined || before === balance, 'InvalidReference'); balance = before; continue; }
      } else if (record.type === 'debt_repayment_received' && record.context.kind === 'repayment' && record.context.masterId === masterId) {
        const source = state.events.find(event => event.type === 'operation:receive_repayment' && event.operationId === record.operationId);
        requireThat(source?.proof?.kind === 'repayment' && source.proof.receipt, 'InvalidReference');
        const receipt = source.proof.receipt;
        before = record.facts.debtBefore as bigint; change = -receipt.amount; id = receipt.id; basis = `repayment:${receipt.requestId}`;
        requireThat(receipt.masterId === masterId && receipt.actorId === record.actorId && receipt.receivedAt === record.at, 'InvalidReference');
      } else continue;
      money(before); requireThat(typeof change === 'bigint' && (balance === undefined || before === balance), 'InvalidReference');
      balance = before + change; money(balance);
      expected.push({ id, masterId, basis, change, at: record.at, actorId: record.actorId });
    }
    const actual = Object.entries(state.ledger).filter(([, entry]) => {
      requireThat(entry && typeof entry.masterId === 'string', 'InvalidReference'); return entry.masterId === masterId;
    });
    requireThat(actual.length === expected.length && new Set(expected.map(entry => entry.id)).size === expected.length &&
      expected.every(entry => sameFact(own(state.ledger, entry.id), entry)), 'InvalidReference');
    if (balance !== undefined) requireThat(value === balance && (expected.length === 0 || Object.hasOwn(state.debt, masterId)), 'InvalidReference');
  }
  return value;
}
export function debtView(state: FinanceState, masterId: string, policy: Policy): { outstandingDebt: bigint; effectiveMasterDebtThreshold: bigint; cashAvailable: boolean; mode: 'cash_and_noncash' | 'noncash_only'; currency: 'THB' } {
  const outstandingDebt = debtBalance(state, masterId);
  const threshold = Object.hasOwn(state.thresholds, masterId) ? own(state.thresholds, masterId)! : policy.globalDebtThreshold; money(threshold);
  const cashAvailable = policy.clientPaymentRoutes.includes('cash') && outstandingDebt < threshold;
  return { outstandingDebt, effectiveMasterDebtThreshold: threshold, cashAvailable, mode: cashAvailable ? 'cash_and_noncash' : 'noncash_only', currency: 'THB' };
}
export function setThreshold(state: FinanceState, actor: Principal, masterId: string, amount: bigint | null): void {
  authorize(actor, 'policy'); identifier(masterId);
  if (amount === null) delete state.thresholds[masterId]; else { money(amount); put(state.thresholds, masterId, amount); }
}
export function ledger(state: FinanceState, entry: LedgerEntry): void {
  requireThat(!own(state.ledger, entry.id) && !Object.values(state.ledger).some(old => old.basis === entry.basis), 'Conflict');
  requireThat(typeof entry.change === 'bigint', 'InvalidMoney');
  const balance = debtBalance(state, entry.masterId) + entry.change;
  requireThat(balance >= 0n, 'DebtChanged'); put(state.debt, entry.masterId, balance); put(state.ledger, entry.id, entry);
}
export function unresolved(reservation: PaymentReservation): PaymentOperation | undefined { return reservation.operations.find(operation => operation.status === 'pending' || operation.status === 'unknown'); }
export function paymentBinding(jobId: string): ProviderBinding { return { kind: 'payment', jobId, obligationId: jobId, beneficiaryId: 'helpy', destinationId: null }; }
export function requireBinding(actual: ProviderBinding | undefined, expected: ProviderBinding): void {
  requireThat(['payment', 'payout', 'refund', 'compensation'].includes(expected.kind) && [expected.jobId, expected.obligationId, expected.beneficiaryId].every(value => typeof value === 'string' && value.trim()) &&
    (expected.kind === 'payment' ? expected.destinationId === null : typeof expected.destinationId === 'string' && expected.destinationId.trim()), 'ProviderConflict');
  requireThat(actual && actual.kind === expected.kind && actual.jobId === expected.jobId && actual.obligationId === expected.obligationId &&
    actual.beneficiaryId === expected.beneficiaryId && actual.destinationId === expected.destinationId, 'ProviderConflict');
}
export function initiatePayment(reservation: PaymentReservation, snapshot: FinancialSnapshot, policy: Policy, now: number, id: string, route: Exclude<PaymentRoute, 'cash'>, jobId: string): PaymentOperation {
  validateFinancialSnapshot(snapshot);
  requireThat(reservation.state === 'reserved', 'InvalidTransition'); requireThat(!unresolved(reservation), 'PaymentOutcomeUnknown');
  requireThat(now < reservation.countdown.deadline, 'ReservationExpired');
  requireThat(policy.clientPaymentRoutes.includes(route) && route !== ('cash' as PaymentRoute), 'RouteUnavailable');
  requireThat(policy.providerConfirmation, 'InvalidConfiguration', 'providerConfirmation');
  requireThat(!reservation.operations.some(operation => operation.id === id), 'Conflict'); identifier(id);
  const providerTimer = timer(now, policy.providerConfirmation, policy.version);
  identifier(jobId);
  const operation: PaymentOperation = { id, binding: paymentBinding(jobId), amount: snapshot.fap, currency: 'THB', route, initiatedAt: now,
    providerDeadline: providerTimer.deadline, providerTimer, status: 'pending', reason: null };
  reservation.operations.push(operation); reservation.method = route; return operation;
}
export function requireOperation(operation: PaymentOperation | TransferAttempt, amount: bigint, binding: ProviderBinding): void {
  requireBinding(operation.binding, binding);
  requireThat(typeof amount === 'bigint' && amount > 0n && operation.amount === amount && operation.currency === 'THB' &&
    paymentRouteIsNoncash(operation.route), 'ProviderConflict');
}
export function requirePaymentOperation(operation: PaymentOperation, snapshot: FinancialSnapshot, jobId: string): void {
  requireThat(snapshot.currency === 'THB', 'ProviderConflict');
  requireOperation(operation, snapshot.fap, paymentBinding(jobId));
}
export function confirmedPayment(reservation: PaymentReservation, snapshot: FinancialSnapshot, jobId: string): PaymentOperation {
  for (const operation of reservation.operations) requirePaymentOperation(operation, snapshot, jobId);
  const received = reservation.operations.filter(operation => operation.status === 'success');
  requireThat(received.length === 1 && !unresolved(reservation) && reservation.method === received[0]!.route, 'FundsMismatch');
  return received[0]!;
}
export function failureReason(status: ProviderStatus, reason?: string): FailureReason | null {
  return status === 'failed' ? reason && ['insufficient_funds', 'declined', 'unavailable'].includes(reason) ? reason as FailureReason : 'unspecified' : null;
}
function outcome(operation: PaymentOperation | TransferAttempt, value: ProviderOutcome, amount: bigint, binding: ProviderBinding): boolean {
  requireOperation(operation, amount, binding);
  requireBinding(value.binding, operation.binding);
  requireThat(operation.id === value.operationId && value.amount === amount && value.currency === 'THB', 'ProviderConflict');
  requireThat(['pending', 'unknown', 'success', 'failed'].includes(value.status), 'ProviderConflict');
  if (operation.status === 'success' || operation.status === 'failed') {
    requireThat(operation.status === value.status && operation.reason === failureReason(value.status, value.reason), 'ProviderConflict'); return false;
  }
  if (operation.status === value.status) return false;
  operation.status = value.status;
  operation.reason = failureReason(value.status, value.reason);
  return true;
}
export function paymentOutcome(reservation: PaymentReservation, value: ProviderOutcome, policy: Policy, now: number, snapshot: FinancialSnapshot, jobId: string): 'assigned' | 'failed' | 'unchanged' | 'needsResolution' {
  const operation = reservation.operations.find(valueIn => valueIn.id === value.operationId); requireThat(operation, 'NotFound');
  requirePaymentOperation(operation, snapshot, jobId);
  if (operation.status === 'pending' || operation.status === 'unknown') requireThat(reservation.method === operation.route, 'ProviderConflict');
  if (!outcome(operation, value, snapshot.fap, paymentBinding(jobId))) return 'unchanged';
  requireThat(reservation.state === 'reserved', 'InvalidTransition');
  if (value.status === 'success') { reservation.state = 'assigned'; return 'assigned'; }
  if (value.status === 'failed') {
    if (!reservation.resetUsed) { reservation.resetUsed = true; reservation.countdown = timer(now, policy.paymentSelectionTimeout, policy.version); }
    return 'failed';
  }
  return 'needsResolution';
}
export function chooseCash(reservation: PaymentReservation, state: FinanceState, policy: Policy, now: number): void {
  requireThat(reservation.state === 'reserved', 'InvalidTransition'); requireThat(!unresolved(reservation), 'PaymentOutcomeUnknown');
  requireThat(now < reservation.countdown.deadline, 'ReservationExpired');
  requireThat(debtView(state, reservation.masterId, policy).cashAvailable, 'CashUnavailable'); reservation.method = 'cash'; reservation.state = 'assigned';
}
export function paymentView(reservation: PaymentReservation, now: number): { status: 'needsResolution' | PaymentReservation['state']; providerStatus: ProviderStatus | null; deadline: number; remaining: number; operationId: string | null; providerDeadline: number | null; blockedReason: 'provider_outcome_unknown' | 'terminal_or_expired' | null; reason: FailureReason | null; retryBlocked: boolean } {
  const pending = unresolved(reservation); const latest = reservation.operations[reservation.operations.length - 1];
  return { status: pending ? 'needsResolution' : reservation.state, providerStatus: latest?.status ?? null, deadline: reservation.countdown.deadline,
    remaining: Math.max(0, reservation.countdown.deadline - now), operationId: (pending ?? latest)?.id ?? null, providerDeadline: (pending ?? latest)?.providerDeadline ?? null,
    blockedReason: pending ? 'provider_outcome_unknown' : reservation.state !== 'reserved' || now >= reservation.countdown.deadline ? 'terminal_or_expired' : null,
    reason: latest?.reason ?? null, retryBlocked: !!pending || reservation.state !== 'reserved' || now >= reservation.countdown.deadline };
}
export function calculatePayout(state: FinanceState, jobId: string, masterId: string, snapshot: FinancialSnapshot, now: number, actorId: string): MasterPayout {
  const existing = own(state.payouts, jobId); if (existing) return existing;
  const commission = portion(snapshot.fap, snapshot.commission); const netBeforeDebt = snapshot.fap - commission;
  const debtBefore = debtBalance(state, masterId);
  const debtRecovery = minimum(debtBefore, portion(netBeforeDebt, { numerator: 7n, denominator: 10n }));
  const payout: MasterPayout = { id: `payout:${jobId}`, jobId, masterId, snapshot, commission, debtBefore,
    netBeforeDebt, debtRecovery, amount: netBeforeDebt - debtRecovery, createdAt: now, attempts: [], settled: false };
  if (debtRecovery > 0n) ledger(state, { id: `recovery:${jobId}`, masterId, basis: `recovery:${jobId}`, change: -debtRecovery, at: now, actorId });
  put(state.payouts, jobId, payout); return payout;
}
export interface PayoutDestination { readonly id: string; readonly masterId: string; readonly route: PayoutRoute; readonly verified: boolean; readonly available: boolean }
export interface SettlementObligation {
  readonly id: string; readonly jobId: string; readonly decisionId: string; readonly beneficiaryId: string;
  readonly kind: 'refund' | 'compensation'; readonly amount: bigint; readonly currency: 'THB'; readonly sourcePaymentId: string;
  readonly createdAt: number; attempts: TransferAttempt[]; settled: boolean;
}
export interface SettlementDestination {
  readonly id: string; readonly beneficiaryId: string; readonly route: PayoutRoute;
  readonly verified: boolean; readonly available: boolean; readonly sourcePaymentId: string | null;
}
export interface TransferView { readonly state: 'ready' | 'needsResolution' | 'settled'; readonly providerStatus: ProviderStatus | null; readonly operationId: string | null; readonly deadline: number | null; readonly reason: 'provider_outcome_unknown' | null; readonly failureReason: FailureReason | null }
export function requireTransferState(value: { readonly attempts: readonly TransferAttempt[]; readonly settled: boolean }): void {
  const successes = value.attempts.filter(attempt => attempt.status === 'success');
  requireThat(typeof value.settled === 'boolean' && successes.length <= 1 && value.settled === (successes.length === 1) &&
    new Set(value.attempts.map(attempt => attempt.id)).size === value.attempts.length &&
    value.attempts.every((attempt, index) => ['pending', 'unknown', 'success', 'failed'].includes(attempt.status) &&
      (index === value.attempts.length - 1 || attempt.status === 'failed')), 'ProviderConflict');
}
export function transferView(value: { readonly attempts: readonly TransferAttempt[]; readonly settled: boolean }): TransferView {
  requireTransferState(value);
  const pending = value.attempts.find(attempt => attempt.status === 'pending' || attempt.status === 'unknown');
  const latest = value.attempts[value.attempts.length - 1];
  return { state: pending ? 'needsResolution' : value.settled ? 'settled' : 'ready', providerStatus: latest?.status ?? null, operationId: (pending ?? latest)?.id ?? null,
    deadline: (pending ?? latest)?.providerDeadline ?? null, reason: pending ? 'provider_outcome_unknown' : null, failureReason: latest?.reason ?? null };
}
export function initiateSettlement(obligation: SettlementObligation, policy: Policy, destination: SettlementDestination, now: number, attemptId: string): TransferAttempt {
  requireTransferState(obligation);
  requireThat(obligation.currency === 'THB', 'ProviderConflict'); money(obligation.amount);
  requireThat(!obligation.settled && obligation.amount > 0n, 'InvalidTransition');
  requireThat(!obligation.attempts.some(attempt => attempt.status === 'pending' || attempt.status === 'unknown'), 'PaymentOutcomeUnknown');
  requireThat(destination?.verified === true && typeof destination.id === 'string' && destination.id.trim() && destination.beneficiaryId === obligation.beneficiaryId, 'DestinationUnverified');
  requireThat(destination.available === true && paymentRouteIsNoncash(destination.route), 'RouteUnavailable');
  if (obligation.kind === 'refund') requireThat(destination.sourcePaymentId === obligation.sourcePaymentId, 'ProviderConflict');
  else requireThat(policy.masterPayoutRoutes.includes(destination.route), 'RouteUnavailable');
  requireThat(policy.providerConfirmation, 'InvalidConfiguration', 'providerConfirmation');
  requireThat(!obligation.attempts.some(attempt => attempt.id === attemptId), 'Conflict'); identifier(attemptId);
  const providerTimer = timer(now, policy.providerConfirmation, policy.version);
  const attempt: TransferAttempt = { id: attemptId, binding: { kind: obligation.kind, jobId: obligation.jobId, obligationId: obligation.id, beneficiaryId: obligation.beneficiaryId, destinationId: destination.id }, amount: obligation.amount, currency: 'THB', route: destination.route,
    destinationId: destination.id, initiatedAt: now, providerDeadline: providerTimer.deadline, providerTimer, status: 'pending', reason: null };
  obligation.attempts.push(attempt); return attempt;
}
function paymentRouteIsNoncash(route: PayoutRoute): boolean { return ['promptpay', 'bank_transfer', 'wallet', 'card'].includes(route); }
export function settlementOutcome(obligation: SettlementObligation, value: ProviderOutcome): void {
  requireTransferState(obligation);
  const attempt = obligation.attempts.find(attempt => attempt.id === value.operationId); requireThat(attempt, 'NotFound');
  requireThat(obligation.currency === 'THB', 'ProviderConflict');
  if (outcome(attempt, value, obligation.amount, { kind: obligation.kind, jobId: obligation.jobId, obligationId: obligation.id,
    beneficiaryId: obligation.beneficiaryId, destinationId: attempt.destinationId }) && value.status === 'success') obligation.settled = true;
}
export function initiatePayout(payout: MasterPayout, policy: Policy, destination: PayoutDestination | null, now: number, attemptId: string): TransferAttempt | null {
  requirePayoutCalculation(payout);
  requireTransferState(payout);
  if (payout.amount === 0n) return null;
  requireThat(!payout.settled, 'InvalidTransition');
  requireThat(!payout.attempts.some(attempt => attempt.status === 'pending' || attempt.status === 'unknown'), 'PaymentOutcomeUnknown');
  requireThat(destination?.verified === true && typeof destination.id === 'string' && destination.id.trim() && destination.masterId === payout.masterId, 'DestinationUnverified');
  requireThat(destination.available === true && paymentRouteIsNoncash(destination.route) && policy.masterPayoutRoutes.includes(destination.route), 'RouteUnavailable');
  requireThat(policy.providerConfirmation, 'InvalidConfiguration', 'providerConfirmation');
  requireThat(!payout.attempts.some(attempt => attempt.id === attemptId), 'Conflict'); identifier(attemptId);
  const providerTimer = timer(now, policy.providerConfirmation, policy.version);
  const attempt: TransferAttempt = { id: attemptId, binding: { kind: 'payout', jobId: payout.jobId, obligationId: payout.id, beneficiaryId: payout.masterId, destinationId: destination.id }, amount: payout.amount, currency: 'THB', destinationId: destination.id,
    route: destination.route, initiatedAt: now, providerDeadline: providerTimer.deadline, providerTimer, status: 'pending', reason: null };
  payout.attempts.push(attempt); return attempt;
}
export function payoutOutcome(payout: MasterPayout, value: ProviderOutcome): void {
  requirePayoutCalculation(payout);
  requireTransferState(payout);
  const attempt = payout.attempts.find(item => item.id === value.operationId); requireThat(attempt, 'NotFound');
  requireThat(payout.snapshot.currency === 'THB', 'ProviderConflict');
  if (outcome(attempt, value, payout.amount, { kind: 'payout', jobId: payout.jobId, obligationId: payout.id,
    beneficiaryId: payout.masterId, destinationId: attempt.destinationId }) && value.status === 'success') payout.settled = true;
}
export function requestRepayment(state: FinanceState, actor: Principal, id: string, amount: bigint, confirmed: boolean, now: number): DebtRepaymentRequest {
  requireThat(actor.role === 'master', 'Unauthorized'); requireThat(confirmed === true, 'ConfirmationRequired'); identifier(id); money(amount);
  requireThat(amount > 0n && amount <= debtBalance(state, actor.userId), 'InvalidRepayment'); requireThat(!own(state.repayments, id), 'Conflict');
  const request: DebtRepaymentRequest = { id, masterId: actor.userId, amount, requestedAt: now, agreedAmount: null, status: 'requested', method: null,
    supportChatId: null, agreementId: null, receiptId: null }; put(state.repayments, id, request); return request;
}
export function agreeRepayment(request: DebtRepaymentRequest, actor: Principal, amount: bigint, method: string, agreementId: string): void {
  authorize(actor, 'finance'); requireThat(request.status === 'requested' || request.status === 'agreed', 'InvalidTransition');
  identifier(agreementId);
  requireThat(method === 'cash' || method === 'bank_transfer', 'InvalidRepayment'); money(amount); requireThat(amount > 0n && request.supportChatId, 'InvalidRepayment');
  request.agreedAmount = amount; request.method = method; request.agreementId = agreementId; request.status = 'agreed';
}
export function receiveRepayment(state: FinanceState, request: DebtRepaymentRequest, actor: Principal, input: { masterId: string; amount: bigint; receiptId: string; agreementId: string; actuallyReceived: boolean; evidence: string }, now: number): DebtRepaymentReceipt {
  authorize(actor, 'finance'); requireThat(request.masterId === input.masterId, 'Unauthorized');
  identifier(input.receiptId);
  requireThat(request.status === 'agreed' && request.method && request.agreementId === input.agreementId, 'InvalidRepayment');
  requireThat(input.actuallyReceived === true && input.evidence.trim(), 'ReceiptUnconfirmed');
  requireThat(input.amount === request.agreedAmount && input.amount <= debtBalance(state, request.masterId), 'DebtChanged');
  requireThat(!own(state.receipts, input.receiptId), 'Conflict');
  const receipt: DebtRepaymentReceipt = { id: input.receiptId, requestId: request.id, masterId: request.masterId, amount: input.amount,
    method: request.method, receivedAt: now, actorId: actor.userId, evidence: input.evidence };
  ledger(state, { id: input.receiptId, masterId: request.masterId, basis: `repayment:${request.id}`, change: -input.amount, at: now, actorId: actor.userId });
  put(state.receipts, receipt.id, receipt); request.status = 'received'; request.receiptId = receipt.id; return receipt;
}
export function repaymentView(request: DebtRepaymentRequest, actor: Principal): DebtRepaymentRequest {
  if (actor.role === 'admin') authorize(actor, 'finance'); else owner(actor, request.masterId, 'master'); return request;
}
export interface Allocation { readonly clientRefund: bigint; readonly masterCompensation: bigint; readonly helpyShare: bigint }
export function allocation(snapshot: FinancialSnapshot, type: 'mutual' | 'false_call' | 'master_refusal' | 'partial', shares?: { clientRefund: bigint; masterCompensation: bigint }): Allocation {
  const fap = snapshot.fap;
  let result: Allocation;
  if (type === 'master_refusal') result = { clientRefund: fap, masterCompensation: 0n, helpyShare: 0n };
  else if (type === 'mutual') { const fee = portion(fap, snapshot.mutualCancellationFee); result = { clientRefund: fap - fee, masterCompensation: 0n, helpyShare: fee }; }
  else if (type === 'false_call') {
    const fee = portion(fap, snapshot.falseCallFee); const helpyShare = portion(fee, complement(snapshot.falseCallMasterShare));
    result = { clientRefund: fap - fee, masterCompensation: fee - helpyShare, helpyShare };
  } else {
    requireThat(shares, 'FundsMismatch'); money(shares.clientRefund); money(shares.masterCompensation);
    const helpyShare = portion(fap, snapshot.commission); requireThat(shares.clientRefund + shares.masterCompensation === fap - helpyShare, 'FundsMismatch');
    result = { ...shares, helpyShare };
  }
  requireThat(result.clientRefund + result.masterCompensation + result.helpyShare === fap, 'FundsMismatch'); return result;
}
export function assertFixedRecovery(input: Readonly<Record<string, unknown>>): void {
  requireThat(Object.keys(input).length === 0, 'FixedRecoveryRate');
}
export function validateFinancialSnapshot(snapshot: FinancialSnapshot): void {
  money(snapshot.fap, snapshot.currency); rate(snapshot.commission); rate(snapshot.falseCallFee); rate(snapshot.falseCallMasterShare); rate(snapshot.mutualCancellationFee);
}
export function requirePayoutCalculation(payout: MasterPayout): void {
  validateFinancialSnapshot(payout.snapshot); money(payout.debtBefore);
  requireThat(payout.commission === portion(payout.snapshot.fap, payout.snapshot.commission) &&
    payout.netBeforeDebt === payout.snapshot.fap - payout.commission &&
    payout.debtRecovery === minimum(payout.debtBefore, portion(payout.netBeforeDebt, { numerator: 7n, denominator: 10n })) &&
    payout.amount === payout.netBeforeDebt - payout.debtRecovery, 'InvalidReference');
}
