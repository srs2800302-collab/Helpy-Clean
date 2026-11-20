import { authorize, own, owner, positiveInteger, put, requireDifferentJobParties, requireThat } from './core.js';
import type { DomainEvent, Principal } from './core.js';
import type { Job } from './marketplace.js';

export const reviewMarks = ['agreements_kept', 'careful_work', 'cleaned_up', 'would_hire_again'] as const;
export interface Review { readonly id: string; readonly jobId: string; readonly clientId: string; readonly masterId: string; readonly stars: number; readonly marks: readonly typeof reviewMarks[number][]; readonly comment: string; readonly createdAt: number; hidden: boolean; moderation: { actorId: string; reason: string; at: number } | null }
export interface ReputationState { reviews: Record<string, Review>; hiddenHistory: Record<string, readonly string[]> }
export function createReview(state: ReputationState, job: Job, actor: Principal, input: { id: string; stars: number; marks: readonly typeof reviewMarks[number][]; comment: string }, now: number): Review {
  owner(actor, job.clientId, 'client'); requireThat(job.state === 'completed' && job.selectedMasterId, 'InvalidTransition');
  requireDifferentJobParties(job.clientId, job.selectedMasterId);
  requireThat(!own(state.reviews, input.id) && !Object.values(state.reviews).some(review => review.jobId === job.id), 'Conflict');
  requireThat(Number.isInteger(input.stars) && input.stars >= 1 && input.stars <= 5 && new Set(input.marks).size === input.marks.length && input.marks.every(mark => reviewMarks.includes(mark)), 'InvalidScope');
  const review: Review = { ...input, jobId: job.id, clientId: job.clientId, masterId: job.selectedMasterId, createdAt: now, hidden: false, moderation: null };
  put(state.reviews, review.id, review); return review;
}
export function hideReview(review: Review, actor: Principal, reason: string, now: number): void {
  authorize(actor, 'reviews'); requireThat(reason.trim(), 'EvidenceRequired'); requireThat(!review.hidden, 'Conflict');
  review.hidden = true; review.moderation = { actorId: actor.userId, reason, at: now };
}
export function reputation(state: ReputationState, jobs: readonly Job[], masterId: string): { workQuality: number | null; reliability: number | null; reviewsCount: number; experience: number; reviews: readonly Review[] } {
  const completed = jobs.filter(job => job.selectedMasterId === masterId && job.state === 'completed' && job.clientId !== masterId);
  const reviews = Object.values(state.reviews).filter(review => review.masterId === masterId && !review.hidden &&
    completed.some(job => job.id === review.jobId && job.clientId === review.clientId));
  return { workQuality: reviews.length ? reviews.reduce((sum, review) => sum + review.stars, 0) / reviews.length : null,
    reliability: reviews.length ? reviews.filter(review => review.marks.includes('agreements_kept')).length / reviews.length : null,
    reviewsCount: reviews.length, experience: completed.length, reviews };
}
export function hideHistory(state: ReputationState, job: Job, actor: Principal): void {
  requireThat(job.state === 'completed' && (actor.userId === job.clientId && actor.role === 'client' || actor.userId === job.selectedMasterId && actor.role === 'master'), 'Unauthorized');
  const key = `${actor.userId}:${actor.role}`; put(state.hiddenHistory, key, [...new Set([...(own(state.hiddenHistory, key) ?? []), job.id])]);
}
export function orderHistory(state: ReputationState, jobs: readonly Job[], actor: Principal, limit: number, events?: readonly DomainEvent[]): readonly Job[] {
  requireThat(positiveInteger(limit) && (actor.role === 'client' || actor.role === 'master'), 'InvalidConfiguration');
  const hidden = own(state.hiddenHistory, `${actor.userId}:${actor.role}`) ?? [];
  if (events) {
    const confirmed = new Set(events.filter(record => record.type === 'operation:hide_history' && record.actorId === actor.userId && record.actorRole === actor.role)
      .map(record => { requireThat(record.context.kind === 'job' && record.facts.jobId === record.context.jobId, 'InvalidReference'); return record.context.jobId; }));
    requireThat(Array.isArray(hidden) && new Set(hidden).size === hidden.length && hidden.length === confirmed.size && hidden.every(id => confirmed.has(id)), 'InvalidReference');
  }
  return jobs.filter(job => job.state === 'completed' && job.clientId !== job.selectedMasterId &&
    (actor.role === 'client' ? job.clientId === actor.userId : job.selectedMasterId === actor.userId) && !hidden.includes(job.id))
    .sort((a, b) => b.completedAt! - a.completedAt!).slice(0, limit);
}
