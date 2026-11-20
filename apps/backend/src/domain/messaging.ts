import { authorize, identifier, own, put, requireDifferentJobParties, requireThat, timer } from './core.js';
import type { DomainEvent, Principal, Role, Timer } from './core.js';
import type { Job } from './marketplace.js';
import type { Policy } from './policy.js';
import { sameFact } from './provenance.js';
import { requireApprovedText } from './text-safety.js';
import type { TextSafetyDecision } from './text-safety.js';

export type ConversationContext = { readonly type: 'job'; readonly jobId: string; readonly clientId: string; readonly masterId: string } |
  { readonly type: 'support'; readonly userId: string; readonly userRole: 'client' | 'master'; readonly basis: 'repayment' | 'resolution'; readonly basisId: string };
export interface ChatThread {
  readonly id: string; readonly context: ConversationContext; mode: 'temporary' | 'working' | 'support' | 'closed';
  readonly createdAt: number; messageIds: string[]; clientSpoke: boolean; masterSpoke: boolean;
  protected: boolean; waitingFor: string | null; reminder: Timer | null;
  languageNotice: { language: string; pending: boolean } | null;
}
export interface ChatMessage {
  readonly id: string; readonly chatId: string; readonly authorId: string; readonly sender: 'user' | 'helpy';
  readonly original: string; readonly originalLanguage: string | null; readonly photoIds: readonly string[]; readonly at: number;
}
export interface InboxMessage { readonly id: string; readonly recipientId: string; readonly original: string; readonly at: number }
export interface ChatState { threads: Record<string, ChatThread>; messages: Record<string, ChatMessage> }
export function participant(thread: ChatThread, actor: Principal, write = false): void {
  if (thread.context.type === 'support') {
    if (actor.role === 'admin') authorize(actor, 'support');
    else requireThat(actor.userId === thread.context.userId && actor.role === thread.context.userRole, 'Unauthorized');
  } else {
    requireDifferentJobParties(thread.context.clientId, thread.context.masterId);
    requireThat((actor.role === 'client' && actor.userId === thread.context.clientId) ||
      (actor.role === 'master' && actor.userId === thread.context.masterId), 'Unauthorized');
  }
  if (write) requireThat(thread.mode !== 'closed', 'ChatClosed');
}
export function createJobChat(state: ChatState, id: string, jobId: string, clientId: string, masterId: string, now: number): ChatThread {
  requireDifferentJobParties(clientId, masterId);
  identifier(id); requireThat(!own(state.threads, id), 'Conflict');
  const thread: ChatThread = { id, context: { type: 'job', jobId, clientId, masterId }, mode: 'temporary', createdAt: now,
    messageIds: [], clientSpoke: false, masterSpoke: false, protected: false, waitingFor: null, reminder: null, languageNotice: null };
  put(state.threads, id, thread); return thread;
}
export function createSupport(state: ChatState, actor: Principal, id: string, context: Extract<ConversationContext, { type: 'support' }>, now: number): ChatThread {
  authorize(actor, 'support'); identifier(id); requireThat(!own(state.threads, id), 'Conflict');
  const thread: ChatThread = { id, context, mode: 'support', createdAt: now, messageIds: [], clientSpoke: false,
    masterSpoke: false, protected: false, waitingFor: null, reminder: null, languageNotice: null };
  requireSupportContext(thread);
  put(state.threads, id, thread); return thread;
}
export function validateMessage(state: ChatState, thread: ChatThread, actor: Principal, input: { id: string; original: string; photoIds: readonly string[]; sender: 'user' | 'helpy' }, supportPhotosAllowed: boolean): void {
  participant(thread, actor, true); identifier(input.id); requireThat(!own(state.messages, input.id), 'Conflict');
  requireThat(typeof input.original === 'string' && Array.isArray(input.photoIds), 'InvalidScope');
  requireThat(input.original.trim().length > 0 || input.photoIds.length > 0, 'InvalidScope');
  requireThat(new Set(input.photoIds).size === input.photoIds.length, 'InvalidPhoto');
  const official = thread.context.type === 'support' && actor.role === 'admin';
  requireThat(input.sender === (official ? 'helpy' : 'user'), 'Unauthorized');
  if (thread.context.type === 'job') requireThat(thread.mode === 'working' ? input.photoIds.length <= 1 : input.photoIds.length === 0, 'InvalidPhoto');
  else requireThat(input.photoIds.length === 0 || supportPhotosAllowed === true, 'InvalidPhoto');
}
export function sendMessage(state: ChatState, thread: ChatThread, actor: Principal, input: { id: string; original: string; photoIds: readonly string[]; sender: 'user' | 'helpy' },
  detectedLanguage: string | null, policy: Policy, now: number, supportPhotosAllowed: boolean, admission: TextSafetyDecision | null = null): ChatMessage {
  validateMessage(state, thread, actor, input, supportPhotosAllowed);
  if (thread.context.type === 'job' && input.original.trim()) requireApprovedText(admission, input.original, 'job_chat');
  const message: ChatMessage = { id: input.id, chatId: thread.id, authorId: actor.userId, sender: input.sender,
    original: input.original, originalLanguage: detectedLanguage, photoIds: input.photoIds, at: now };
  put(state.messages, message.id, message); thread.messageIds.push(message.id);
  if (thread.context.type === 'job') {
    const client = actor.userId === thread.context.clientId;
    if (client) thread.clientSpoke = true; else thread.masterSpoke = true;
    if (thread.mode === 'temporary') {
      if (client && detectedLanguage && thread.languageNotice?.language !== detectedLanguage) thread.languageNotice = { language: detectedLanguage, pending: true };
      if (!client && thread.languageNotice) thread.languageNotice.pending = false;
      thread.protected = thread.clientSpoke && thread.masterSpoke;
      thread.waitingFor = client ? thread.context.masterId : thread.context.clientId;
      thread.reminder = timer(now, policy.negotiationFirstReminder, policy.version);
    }
  }
  return message;
}
export function messageAuthorRole(thread: ChatThread, message: ChatMessage): Role {
  return thread.context.type === 'support' ? message.sender === 'helpy' ? 'admin' : thread.context.userRole :
    message.authorId === thread.context.clientId ? 'client' : 'master';
}
export function messageRecords(thread: ChatThread, events: readonly DomainEvent[]): readonly DomainEvent[] {
  const records = events.filter(record => record.type === 'operation:message' && record.proof?.kind === 'message' && record.proof.message.chatId === thread.id);
  const business = events.filter(record => record.type === 'chat_message' && record.facts.chatId === thread.id);
  const ids = records.map(record => record.proof?.kind === 'message' ? record.proof.message.id : null);
  requireThat(new Set(thread.messageIds).size === thread.messageIds.length &&
    sameFact(thread.messageIds, ids) && sameFact(business.map(record => record.subjectId), ids), 'InvalidReference');
  for (const source of records) {
    const proof = source.proof; requireThat(proof?.kind === 'message', 'InvalidReference');
    requireThat(business.filter(record => record.operationId === source.operationId && record.subjectId === proof.message.id &&
      record.actorId === source.actorId && record.actorRole === source.actorRole && record.at === source.at && sameFact(record.context, source.context)).length === 1, 'InvalidReference');
  }
  return records;
}
export function messageById(state: ChatState, thread: ChatThread, id: string, events?: readonly DomainEvent[]): ChatMessage {
  const message = own(state.messages, id);
  requireThat(message?.id === id && message.chatId === thread.id && thread.messageIds.includes(id), 'InvalidReference');
  if (events) {
    const sources = events.filter(record => record.type === 'operation:message' && record.proof?.kind === 'message' && record.proof.message.id === id);
    const source = sources[0];
    requireThat(sources.length === 1 && source?.proof?.kind === 'message' && sameFact(source.proof.message, message) &&
      source.actorId === message.authorId && source.at === message.at, 'InvalidReference');
    requireThat(source.actorRole === messageAuthorRole(thread, message), 'InvalidReference');
  }
  if (thread.context.type === 'job') requireThat(message.sender === 'user' &&
    [thread.context.clientId, thread.context.masterId].includes(message.authorId), 'InvalidReference');
  else {
    requireThat(message.sender === 'user' ? message.authorId === thread.context.userId :
      message.sender === 'helpy' && typeof message.authorId === 'string' && message.authorId.trim(), 'InvalidReference');
    if (message.sender === 'helpy' && events) requireThat(events.some(record => record.type === 'chat_message' &&
      record.subjectId === id && record.actorId === message.authorId && record.at === message.at && record.facts.chatId === thread.id), 'InvalidReference');
  }
  return message;
}
export function requireSupportContext(thread: ChatThread, events?: readonly DomainEvent[]): void {
  const context = thread.context;
  requireThat(context.type === 'support' && ['client', 'master'].includes(context.userRole) &&
    ['repayment', 'resolution'].includes(context.basis), 'InvalidReference');
  identifier(context.userId); identifier(context.basisId);
  if (events) {
    const opened = events.filter(record => record.type === 'support_opened' && record.subjectId === thread.id);
    requireThat(opened.length === 1 && opened[0]!.at === thread.createdAt && opened[0]!.facts.userId === context.userId &&
      opened[0]!.facts.userRole === context.userRole && opened[0]!.facts.basis === context.basis && opened[0]!.facts.basisId === context.basisId, 'InvalidReference');
    const closed = events.filter(record => record.type === 'operation:close_support' && record.context.kind === 'support' && record.context.chatId === thread.id);
    requireThat(closed.every(record => record.actorRole === 'admin' && events.indexOf(record) > events.indexOf(opened[0]!)) &&
      thread.mode === (closed.length ? 'closed' : 'support'), 'InvalidReference');
    messageRecords(thread, events);
  }
}
export function resolutionThreads(state: ChatState, job: Job, resolutionId: string | null, events: readonly DomainEvent[]): readonly ChatThread[] {
  const threads = Object.values(state.threads).filter(thread => thread.id === job.chatId || thread.context.type === 'support' &&
    resolutionId !== null && thread.context.basis === 'resolution' && thread.context.basisId === resolutionId);
  for (const thread of threads) {
    if (thread.context.type === 'job') requireThat(thread.id === job.chatId && thread.context.jobId === job.id &&
      thread.context.clientId === job.clientId && thread.context.masterId === job.selectedMasterId, 'InvalidReference');
    else {
      requireSupportContext(thread, events);
      requireThat(thread.context.userId === (thread.context.userRole === 'client' ? job.clientId : job.selectedMasterId), 'InvalidReference');
    }
  }
  return threads;
}
export function history(state: ChatState, thread: ChatThread, actor: Principal, events?: readonly DomainEvent[]): readonly ChatMessage[] {
  participant(thread, actor);
  if (events) messageRecords(thread, events);
  // Internal employee identity is audit data, not a public support sender.
  return thread.messageIds.map(id => {
    const message = messageById(state, thread, id, events);
    return message.sender === 'helpy' && actor.role !== 'admin' ? { ...message, authorId: 'helpy' } : message;
  });
}
export function closeSupport(thread: ChatThread, actor: Principal): void {
  authorize(actor, 'support'); requireThat(thread.context.type === 'support', 'InvalidTransition'); thread.mode = 'closed';
}
