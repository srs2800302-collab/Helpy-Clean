import { authorize, own, owner, requireDifferentJobParties, requireThat } from '../domain/core.js';
import type { Principal } from '../domain/core.js';
import { accountById, requireActive } from '../domain/accounts.js';
import { participant } from '../domain/messaging.js';
import { jobById, threadById } from './invariants.js';
import type { Command } from './domain-core.js';
import type { CoreState } from './ports.js';

const permissions: Partial<Record<Command['type'], string>> = {
  publish_policy: 'policy', threshold: 'policy',
  save_catalog: 'catalog', publish_catalog: 'catalog',
  approve_text: 'content_approval', approve_content_set: 'content_approval', translation_correction: 'content_approval',
  publication_deadline: 'scheduler', reservation_deadline: 'scheduler', reminders: 'scheduler',
  payment_outcome: 'provider', payout_outcome: 'provider', settlement_outcome: 'provider',
  start_payout: 'finance', start_settlement: 'finance', agree_repayment: 'finance', receive_repayment: 'finance', close_repayment: 'finance',
  inspect_resolution: 'resolution', decide_resolution: 'resolution',
  support: 'support', close_support: 'support', inbox: 'support', hide_review: 'reviews', evaluate_retention: 'retention',
};

/** Access, not transition validation: legitimate terminal-operation replays
 * remain possible, but a persisted receipt never grants an old permission. */
export function authorizeCommand(state: CoreState, actor: Principal, command: Command): void {
  requireThat(['client', 'master', 'admin'].includes(actor.role), 'Unauthorized');
  const onboarding = ['profile', 'activate', 'switch_role', 'locale', 'bind_contact'].includes(command.type);
  if (actor.role !== 'admin') {
    if (onboarding) accountById(state, actor.userId);
    else { requireActive(own(state.users, actor.userId), actor, actor.role); accountById(state, actor.userId); }
  }
   const permission = own(permissions, command.type);
  if (permission) { authorize(actor, permission); return; }
  switch (command.type) {
    case 'profile': case 'activate': case 'switch_role': case 'locale': case 'bind_contact':
      requireThat(own(state.users, actor.userId), 'NotFound'); return;
    case 'new_job': requireThat(actor.role === 'client', 'Unauthorized'); return;
    case 'edit_draft': case 'publish_job': case 'link_jobs': case 'approve_price': case 'select_master':
    case 'cash': case 'initiate_payment': case 'decline_reservation': case 'accept_work': case 'review':
      owner(actor, jobById(state, command.jobId).clientId, 'client'); return;
    case 'initial_offer': {
      const job = jobById(state, command.jobId); requireThat(actor.role === 'master', 'Unauthorized');
      requireDifferentJobParties(job.clientId, actor.userId); return;
    }
    case 'revise_price': case 'final_application':
      jobById(state, command.jobId); owner(actor, command.masterId, 'master'); return;
    case 'terminate_negotiation': {
      const job = jobById(state, command.jobId);
      if (actor.role === 'admin') authorize(actor, 'negotiation');
      else requireThat(actor.role === 'client' && actor.userId === job.clientId ||
        actor.role === 'master' && actor.userId === command.masterId, 'Unauthorized');
      return;
    }
    case 'message': participant(threadById(state, command.chatId), actor); return;
    case 'submit_result': case 'complete': {
      const job = jobById(state, command.jobId); requireThat(job.selectedMasterId, 'InvalidTransition');
      owner(actor, job.selectedMasterId, 'master'); return;
    }
    case 'open_resolution': case 'cancel': case 'cancellation_response': case 'hide_history': {
      const job = jobById(state, command.jobId);
      if (command.type === 'open_resolution' && actor.role === 'admin') authorize(actor, 'resolution');
      else requireThat(actor.role === 'client' && actor.userId === job.clientId ||
        actor.role === 'master' && actor.userId === job.selectedMasterId, 'Unauthorized');
      return;
    }
    case 'request_repayment': requireThat(actor.role === 'master', 'Unauthorized'); return;
    case 'preferences':
      requireThat(command.preference.userId === actor.userId &&
        (command.preference.role === undefined || command.preference.role === actor.role), 'Unauthorized'); return;
    case 'feedback': return;
    // Permission-governed variants return above; unknown runtime variants must
    // not reach a cached receipt or any content/provider port.
    default: requireThat(false, 'InvalidTransition', 'Unsupported operation');
  }
}
