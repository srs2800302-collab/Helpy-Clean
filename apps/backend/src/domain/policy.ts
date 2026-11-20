import { authorize, checked, identifier, money, positiveInteger, rate, requireThat, timer, unwrap } from './core.js';
import type { Clock, DomainEvent, Period, Principal, Rate, Result, Timer } from './core.js';
import { sameFact } from './provenance.js';

export const paymentRoutes = ['promptpay', 'cash', 'bank_transfer', 'wallet', 'card'] as const;
export type PaymentRoute = typeof paymentRoutes[number];
export type PayoutRoute = Exclude<PaymentRoute, 'cash'>;
// Numeric durations are seconds and effectiveAt is Unix seconds; retention has its own explicit unit.
export interface Policy {
  readonly version: string;
  readonly effectiveAt: number;
  readonly initialDuration: number;
  readonly initialAutoClose: boolean;
  readonly repeatDurations: readonly number[];
  readonly repeatFloor: number;
  readonly negotiationFirstReminder: number;
  readonly negotiationRepeatReminder: number;
  readonly paymentSelectionTimeout: number;
  readonly providerConfirmation?: number;
  readonly clientPaymentRoutes: readonly PaymentRoute[];
  readonly masterPayoutRoutes: readonly PayoutRoute[];
  readonly commission: Rate;
  readonly globalDebtThreshold: bigint;
  readonly mutualCancellationFee: Rate;
  readonly falseCallFee: Rate;
  readonly falseCallMasterShare: Rate;
  readonly cancellationResponse: number;
  readonly cancellationReminder: number;
  readonly inactivityFirstReminder: number;
  readonly inactivityRepeatReminder: number;
  readonly inactivityThreshold: number;
  readonly historyLimit: number;
  readonly communicationRetention: Period;
  readonly evidenceRetention: Period;
  readonly financialRetention: Period;
  readonly auditRetention: Period;
  readonly accountRetention: Period;
  readonly locales: readonly string[];
}
const durationKeys = ['initialDuration', 'repeatFloor', 'negotiationFirstReminder', 'negotiationRepeatReminder',
  'paymentSelectionTimeout', 'cancellationResponse', 'cancellationReminder', 'inactivityFirstReminder',
  'inactivityRepeatReminder', 'inactivityThreshold', 'historyLimit'] as const;
const retentionKeys = ['communicationRetention', 'evidenceRetention', 'financialRetention', 'auditRetention', 'accountRetention'] as const;
const keys = new Set<string>(['version', 'effectiveAt', ...durationKeys, ...retentionKeys, 'initialAutoClose',
  'repeatDurations', 'providerConfirmation', 'clientPaymentRoutes', 'masterPayoutRoutes', 'commission',
  'globalDebtThreshold', 'mutualCancellationFee', 'falseCallFee', 'falseCallMasterShare', 'locales']);
export function validatePolicy(policy: Policy): Result<Policy> {
  return checked(() => {
    requireThat(policy && typeof policy === 'object' && !Array.isArray(policy), 'InvalidConfiguration');
    requireThat(!Object.keys(policy).some(key => /recovery|withhold/i.test(key)), 'FixedRecoveryRate');
    requireThat(Object.keys(policy).every(key => keys.has(key)), 'InvalidConfiguration');
    identifier(policy.version);
    requireThat(Number.isSafeInteger(policy.effectiveAt), 'InvalidConfiguration');
    for (const key of durationKeys) requireThat(positiveInteger(policy[key]), 'InvalidConfiguration', key);
    requireThat(typeof policy.initialAutoClose === 'boolean', 'InvalidConfiguration');
    requireThat(Array.isArray(policy.repeatDurations) && policy.repeatDurations.length > 0 &&
      policy.repeatDurations.every(positiveInteger) && policy.repeatDurations.every(value => value >= policy.repeatFloor), 'InvalidConfiguration');
    requireThat(policy.inactivityFirstReminder < policy.inactivityThreshold &&
      policy.cancellationReminder < policy.cancellationResponse, 'InvalidConfiguration');
    if (policy.providerConfirmation !== undefined) requireThat(positiveInteger(policy.providerConfirmation), 'InvalidConfiguration');
    for (const routes of [policy.clientPaymentRoutes, policy.masterPayoutRoutes]) {
      requireThat(Array.isArray(routes) && new Set(routes).size === routes.length &&
        routes.every(route => paymentRoutes.includes(route)), 'InvalidConfiguration');
    }
    requireThat(!policy.masterPayoutRoutes.includes('cash' as PayoutRoute), 'InvalidConfiguration');
    for (const value of [policy.commission, policy.mutualCancellationFee, policy.falseCallFee, policy.falseCallMasterShare]) rate(value);
    money(policy.globalDebtThreshold);
    for (const key of retentionKeys) {
      const period = policy[key];
      requireThat(period && positiveInteger(period.value) && ['seconds', 'days', 'years'].includes(period.unit), 'InvalidConfiguration', key);
    }
    requireThat(Array.isArray(policy.locales) && policy.locales.length > 0 && new Set(policy.locales).size === policy.locales.length &&
      policy.locales.every(locale => /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(locale)), 'InvalidLocale');
    return policy;
  });
}
export function publishPolicy(actor: Principal, policies: Policy[], policy: Policy): Result<Policy> {
  return checked(() => {
    authorize(actor, 'policy');
    const result = validatePolicy(policy); requireThat(result.ok, result.ok ? 'InvalidConfiguration' : result.error.code);
    requireThat(!policies.some(old => old.version === policy.version || old.effectiveAt === policy.effectiveAt), 'Conflict');
    policies.push(policy);
    return policy;
  });
}
export function effectivePolicy(policies: readonly Policy[], now: number, history: readonly DomainEvent[] = []): Policy {
  requireThat(Array.isArray(policies) && Number.isSafeInteger(now), 'InvalidConfiguration');
  for (const policy of policies) unwrap(validatePolicy(policy));
  requireThat(new Set(policies.map(policy => policy.version)).size === policies.length &&
    new Set(policies.map(policy => policy.effectiveAt)).size === policies.length, 'InvalidConfiguration');
  const origins = history.filter(record => record.type === 'operation:publish_policy');
  const versions = new Set<string>();
  const first = origins[0]?.proof;
  const confirmed = first?.kind === 'policy' ? [...first.initial ?? []] : [];
  for (const origin of origins) {
    requireThat(origin.actorRole === 'admin' && origin.proof?.kind === 'policy' && !versions.has(origin.proof.policy.version), 'InvalidReference');
    versions.add(origin.proof.policy.version);
    confirmed.push(origin.proof.policy);
    requireThat(policies.some(policy => sameFact(policy, origin.proof?.kind === 'policy' ? origin.proof.policy : null)), 'InvalidReference');
  }
  if (origins.length) requireThat(sameFact([...policies].sort((a, b) => a.version.localeCompare(b.version)),
    confirmed.sort((a, b) => a.version.localeCompare(b.version))), 'InvalidReference');
  const policy = [...policies].filter(value => value.effectiveAt <= now).sort((a, b) => b.effectiveAt - a.effectiveAt)[0];
  requireThat(policy, 'InvalidConfiguration', 'No effective policy'); return policy;
}
export function startTimer(policy: Policy, now: number, key: typeof durationKeys[number] | 'providerConfirmation'): Timer {
  const duration = policy[key]; requireThat(duration !== undefined, 'InvalidConfiguration', key);
  return timer(now, duration, policy.version);
}
export interface RetentionFact {
  readonly kind: 'communication' | 'evidence' | 'financial' | 'audit' | 'account';
  readonly anchor: number | null;
  readonly anchorKind: 'completed' | 'recorded';
  readonly deadline: number | null;
  readonly policyVersion: string;
}
export function retentionFact(kind: RetentionFact['kind'], anchor: number | null, anchorKind: RetentionFact['anchorKind'],
  policy: Policy, clock: Clock): RetentionFact {
  requireThat(anchor === null || Number.isSafeInteger(anchor), 'InvalidConfiguration');
  const supported = anchor !== null && (['communication', 'evidence'].includes(kind) ? anchorKind === 'completed' : anchorKind === 'recorded');
  const deadline = supported ? clock.add(anchor, policy[`${kind}Retention`]) : null;
  requireThat(deadline === null || Number.isSafeInteger(deadline) && anchor !== null && deadline > anchor, 'InvalidConfiguration');
  return { kind, anchor, anchorKind, deadline, policyVersion: policy.version };
}
export function evaluateRetention(fact: RetentionFact, clock: Clock, legal: { hold: boolean; notBefore: number | null }):
  { readonly eligibleForRetentionAction: boolean; readonly reason: 'eligible' | 'anchor_missing' | 'before_deadline' | 'legal_restriction' } {
  if (fact.anchor === null || fact.deadline === null) return { eligibleForRetentionAction: false, reason: 'anchor_missing' };
  if (legal.hold || (legal.notBefore !== null && clock.now() < legal.notBefore)) return { eligibleForRetentionAction: false, reason: 'legal_restriction' };
  return clock.now() < fact.deadline ? { eligibleForRetentionAction: false, reason: 'before_deadline' } : { eligibleForRetentionAction: true, reason: 'eligible' };
}
