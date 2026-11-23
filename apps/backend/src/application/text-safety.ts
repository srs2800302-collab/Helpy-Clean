import { checked, failure, success } from '../domain/core.js';
import type { Result } from '../domain/core.js';
import { requireApprovedText } from '../domain/text-safety.js';
import type { TextSafetyDecision, TextSafetyPurpose } from '../domain/text-safety.js';
import type { TextSafetyPort, TranslationPort } from './ports.js';
import * as Validate from './validation.js';

interface PurposeAwareTranslationPort extends TranslationPort {
  translateWithPurpose?(original: string, source: string | null, target: string, purpose: TextSafetyPurpose): Promise<Result<string>>;
  detectWithPurpose?(original: string, purpose: TextSafetyPurpose): Promise<Result<{ language: string; reliable: boolean }>>;
}

export async function inspectText(port: TextSafetyPort, text: string, purpose: TextSafetyPurpose): Promise<Result<TextSafetyDecision>> {
  let result: Result<TextSafetyDecision>;
  try {
    if (!port || typeof port.inspect !== 'function') return failure('TextSafetyUnavailable');
    result = await port.inspect({ text, purpose });
  } catch { return failure('TextSafetyUnavailable'); }
  const valid = Validate.portResult(result, Validate.textSafetyDecision, 'TextSafetyUnavailable'); if (!valid.ok) return valid;
  const decision = Object.freeze({ text: valid.value.text, purpose: valid.value.purpose, status: valid.value.status, reason: valid.value.reason });
  const approved = checked(() => requireApprovedText(decision, text, purpose));
  return approved.ok ? success(decision) : approved;
}

type Access = () => Promise<Result<void>>;
export interface DetectionAttempt {
  readonly result: Result<{ language: string; reliable: boolean }>;
  readonly fatal: boolean;
}
// All raw translation I/O is confined here. Approval is per invocation and
// exact payload; authorization is refreshed after the asynchronous inspection.
export class ProtectedTranslation {
  constructor(private readonly safety: TextSafetyPort, private readonly provider: TranslationPort) {}

  private async run<T>(text: string, purpose: TextSafetyPurpose, access: Access, send: () => Promise<Result<T>>, shape: Validate.Shape): Promise<{ result: Result<T>; fatal: boolean }> {
    const approved = await inspectText(this.safety, text, purpose);
    if (!approved.ok) return { result: approved, fatal: false };
    const allowed = await access(); if (!allowed.ok) return { result: allowed, fatal: true };
    let result: Result<T>;
    try { result = await send(); }
    catch { return { result: failure('TranslationUnavailable'), fatal: false }; }
    const valid = Validate.portResult(result, shape, 'TranslationUnavailable');
    return { result: valid, fatal: !valid.ok && valid !== result };
  }
  detect(text: string, purpose: TextSafetyPurpose, access: Access): Promise<DetectionAttempt> {
    const provider = this.provider as PurposeAwareTranslationPort;
    return this.run(text, purpose, access,
      () => provider.detectWithPurpose ? provider.detectWithPurpose(text, purpose) : this.provider.detect(text),
      Validate.detection);
  }
  async translate(text: string, source: string | null, target: string, purpose: TextSafetyPurpose, access: Access): Promise<Result<string>> {
    const provider = this.provider as PurposeAwareTranslationPort;
    return (await this.run(text, purpose, access,
      () => provider.translateWithPurpose ? provider.translateWithPurpose(text, source, target, purpose) : this.provider.translate(text, source, target),
      Validate.text('TranslationUnavailable'))).result;
  }
}
