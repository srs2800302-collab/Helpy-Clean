import { requireThat } from './core.js';

export type TextSafetyPurpose = 'job_chat' | 'external_translation';
export type TextSafetyReason = 'contact' | 'address' | 'account_identifier' | 'personal_data';
export interface TextSafetyRequest { readonly text: string; readonly purpose: TextSafetyPurpose }
export interface TextSafetyDecision extends TextSafetyRequest {
  readonly status: 'allowed' | 'rejected' | 'unknown';
  readonly reason: TextSafetyReason | null;
}
export function requireApprovedText(decision: TextSafetyDecision | null, text: string, purpose: TextSafetyPurpose): void {
  requireThat(decision && decision.text === text && decision.purpose === purpose &&
    ['allowed', 'rejected', 'unknown'].includes(decision.status) &&
    (decision.reason === null || ['contact', 'address', 'account_identifier', 'personal_data'].includes(decision.reason)), 'TextSafetyUnavailable');
  requireThat(decision.status !== 'rejected', 'TextRejected');
  requireThat(decision.status === 'allowed' && decision.reason === null, 'TextSafetyUnavailable');
}
