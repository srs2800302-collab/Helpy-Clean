import type { CoreState } from '../../application/ports.js';
import { compoundId } from '../../domain/provenance.js';
import * as Validate from '../../application/validation.js';
import { pack, unpack, decimal, CodecError } from './d1-codec.js';

export type Row = Record<string, string | number | null>;
export const stateTables = ['users','user_identities','consumed_claims','catalog_revisions','catalog_texts','catalog_items','policies',
  'translation_corrections','jobs','offers','refusal_records','refusal_streaks','chat_threads','chat_messages','inbox_messages','feedback',
  'job_financials','payment_operations','master_finance','threshold_history','ledger_entries','financial_obligations','transfer_attempts',
  'debt_repayments','resolution_cases','reviews','hidden_history','domain_events','notification_preferences','deliveries','retention_records'] as const;
export type Table = typeof stateTables[number];
export type Projection = Record<Table, Row[]>;
export function emptyState(): CoreState {
  return { users:{},consumedClaims:{},drafts:{},published:{},current:null,policies:[],jobs:{},refusalStreak:{},refusals:{},threads:{},messages:{},
    debt:{},thresholds:{},ledger:{},payouts:{},repayments:{},receipts:{},cases:{},obligations:{},reviews:{},hiddenHistory:{},events:[],preferences:{},
    deliveries:{},inbox:{},feedback:{},retention:{},retentionOrigins:{},corrections:{},thresholdHistory:[] };
}
function put<T>(map: Record<string,T>, key: string, value:T): void { Object.defineProperty(map,key,{value,enumerable:true,writable:true,configurable:true}); }
function text(row:Row,key:string):string { const v=row[key]; if(typeof v!=='string') throw new CodecError(); return v; }
function number(row:Row,key:string):number { const v=row[key]; if(!Number.isSafeInteger(v)) throw new CodecError(); return v as number; }
function nullableText(row:Row,key:string):string|null { return row[key]===null?null:text(row,key); }
function nullableNumber(row:Row,key:string):number|null { return row[key]===null?null:number(row,key); }
function bool(row:Row,key:string):boolean { const n=number(row,key); if(n!==0&&n!==1)throw new CodecError(); return n===1; }
const p=<T>(row:Row,key:string):T=>unpack<T>(row[key]);
const ordered=(rows:Row[],key='position')=>[...rows].sort((a,b)=>number(a,key)-number(b,key));
const catalogKinds = {category:'categories',entity:'entities',scenario:'scenarios',block:'blocks',binding:'bindings'} as const;
export function project(s:CoreState):Projection {
  const rows=Object.fromEntries(stateTables.map(table=>[table,[] as Row[]])) as Projection;
  const add=(table:Table,row:Row)=>rows[table].push(row);
  for(const u of Object.values(s.users)) {
    add('users',{user_id:u.id,created_at:u.createdAt,email:u.email,phone:u.phone,display_name:u.displayName,photo_id:u.photoId,locale:u.locale,
      client_active:+u.clientActive,master_active:+u.masterActive,specialization_payload:pack(u.specialization),contacts_payload:pack(u.contacts)});
    u.identities.forEach((i,position)=>add('user_identities',{method:i.method,subject:i.subject,user_id:u.id,position}));
  }
  for(const [claim_id,purpose] of Object.entries(s.consumedClaims)) add('consumed_claims',{claim_id,purpose});
  for(const [key,c] of [...Object.entries(s.drafts),...Object.entries(s.published)]) {
    add('catalog_revisions',{catalog_key:key,catalog_id:c.id,version:c.version,sequence:c.sequence,status:c.status,is_current:+(s.current===key)});
    c.texts.forEach((t,position)=>add('catalog_texts',{catalog_key:key,text_id:t.id,position,revision:t.revision,meaning:t.meaning,editions_payload:pack(t.editions)}));
    for(const [kind,collection] of Object.entries(catalogKinds)) c[collection].forEach((item,position)=>add('catalog_items',{catalog_key:key,item_type:kind,item_id:item.id,position,payload:pack(item)}));
  }
  s.policies.forEach((policy,position)=>add('policies',{version:policy.version,position,effective_at:policy.effectiveAt,policy_payload:pack(policy)}));
  for(const [key,new_catalog_key] of Object.entries(s.corrections)) {
    const matches=[...Object.entries(s.published)].flatMap(([old,c])=>c.texts.filter(t=>compoundId(old,t.id)===key).map(t=>({old,text:t.id})));
    if(matches.length!==1)throw new CodecError();
    add('translation_corrections',{old_catalog_key:matches[0]!.old,text_id:matches[0]!.text,new_catalog_key});
  }
  for(const j of Object.values(s.jobs)) {
    const {id,clientId,state,selectedMasterId,chatId,resolutionId,linkedJobId,acceptedAt,acceptanceOperationId,completedAt,lastActivityAt,
      offers,financial,reservation,funds,...body}=j;
    add('jobs',{job_id:id,client_id:clientId,state,selected_master_id:selectedMasterId,selected_chat_id:chatId,resolution_id:resolutionId,
      linked_job_id:linkedJobId,accepted_at:acceptedAt,acceptance_operation_id:acceptanceOperationId,completed_at:completedAt,last_activity_at:lastActivityAt,job_payload:pack(body)});
    add('job_financials',{job_id:id,funds,financial_payload:pack(financial),reservation_payload:pack(reservation===null?null:(({operations:_,...rest})=>rest)(reservation))});
    reservation?.operations.forEach((op,position)=>add('payment_operations',{operation_id:op.id,job_id:id,position,operation_payload:pack(op)}));
    for(const o of Object.values(offers)) add('offers',{offer_id:o.id,job_id:id,master_id:o.masterId,chat_id:o.chatId,catalog_key:o.catalogKey,
      initial_price:String(o.initialPrice),initial_at:o.initialAt,state:o.state,revised_payload:pack(o.revised),final_payload:pack(o.final),closed_reason:o.closedReason});
  }
  for(const r of Object.values(s.refusals)) add('refusal_records',{refusal_id:r.id,master_id:r.masterId,job_id:r.jobId,offer_id:r.offerId,resolution_decision_id:r.resolutionId,at:r.at,operation_id:r.operationId});
  for(const [master_id,streak] of Object.entries(s.refusalStreak))add('refusal_streaks',{master_id,streak});
  for(const t of Object.values(s.threads)) {
    const c=t.context;
    add('chat_threads',{chat_id:t.id,context_type:c.type,mode:t.mode,created_at:t.createdAt,job_id:c.type==='job'?c.jobId:null,
      client_id:c.type==='job'?c.clientId:null,master_id:c.type==='job'?c.masterId:null,user_id:c.type==='support'?c.userId:null,
      user_role:c.type==='support'?c.userRole:null,basis:c.type==='support'?c.basis:null,basis_id:c.type==='support'?c.basisId:null,
      client_spoke:+t.clientSpoke,master_spoke:+t.masterSpoke,protected:+t.protected,waiting_for:t.waitingFor,reminder_payload:pack(t.reminder),language_payload:pack(t.languageNotice)});
    t.messageIds.forEach((id,position)=>{
      const m=s.messages[id]; if(!Object.hasOwn(s.messages,id)||!m)throw new CodecError();
      add('chat_messages',{message_id:m.id,chat_id:m.chatId,position,author_id:m.authorId,sender:m.sender,original:m.original,original_language:m.originalLanguage,photo_ids_payload:pack(m.photoIds),at:m.at});
    });
  }
  for(const m of Object.values(s.inbox))add('inbox_messages',{message_id:m.id,recipient_id:m.recipientId,original:m.original,at:m.at});
  for(const f of Object.values(s.feedback))add('feedback',{feedback_id:f.id,author_id:f.authorId,original:f.original,at:f.at});
  for(const id of new Set([...Object.keys(s.debt),...Object.keys(s.thresholds)])) add('master_finance',{master_id:id,
    debt_amount:Object.hasOwn(s.debt,id)?String(s.debt[id]):null,threshold_amount:Object.hasOwn(s.thresholds,id)?String(s.thresholds[id]):null});
  s.thresholdHistory.forEach((t,position)=>add('threshold_history',{master_id:t.masterId,version:t.version,position,amount:t.amount===null?null:String(t.amount),effective_at:t.effectiveAt}));
  for(const l of Object.values(s.ledger))add('ledger_entries',{ledger_id:l.id,master_id:l.masterId,basis:l.basis,change_amount:String(l.change),at:l.at,actor_id:l.actorId});
  for(const o of [...Object.values(s.payouts),...Object.values(s.obligations)]) {
    const {id,jobId,amount,createdAt,settled,attempts,...body}=o;
    const payout='masterId' in o;
    add('financial_obligations',{obligation_id:id,kind:payout?'payout':o.kind,job_id:jobId,beneficiary_id:payout?o.masterId:o.beneficiaryId,
      decision_id:payout?null:o.decisionId,source_payment_id:payout?null:o.sourcePaymentId,amount:String(amount),currency:'THB',created_at:createdAt,settled:+settled,type_payload:pack(body)});
    attempts.forEach((attempt,position)=>add('transfer_attempts',{attempt_id:attempt.id,obligation_id:id,position,attempt_payload:pack(attempt)}));
  }
  for(const r of Object.values(s.repayments)) {
    const receipt=r.receiptId===null?null:s.receipts[r.receiptId];
    add('debt_repayments',{request_id:r.id,master_id:r.masterId,amount:String(r.amount),requested_at:r.requestedAt,agreed_amount:r.agreedAmount===null?null:String(r.agreedAmount),
      status:r.status,method:r.method,support_chat_id:r.supportChatId,agreement_id:r.agreementId,receipt_id:r.receiptId,
      received_amount:receipt?String(receipt.amount):null,received_method:receipt?.method??null,received_at:receipt?.receivedAt??null,actor_id:receipt?.actorId??null,evidence:receipt?.evidence??null});
  }
  for(const c of Object.values(s.cases))add('resolution_cases',{case_id:c.id,job_id:c.jobId,request_id:c.requestId,opened_at:c.openedAt,snapshot_policy:c.snapshotPolicy,
    evidence_payload:pack(c.evidence),status:c.status,decision_id:c.decision?.id??null,decision_payload:c.decision===null?null:pack(c.decision)});
  for(const r of Object.values(s.reviews)) {
    const {id,jobId,clientId,masterId,stars,marks,comment,createdAt,hidden,moderation}=r;
    add('reviews',{review_id:id,job_id:jobId,client_id:clientId,master_id:masterId,stars,marks_payload:pack(marks),
      comment,created_at:createdAt,hidden:+hidden,moderation_payload:moderation===null?null:pack(moderation)});
  }
  for(const [key,ids] of Object.entries(s.hiddenHistory)) {
    const split=key.lastIndexOf(':'); for(const job_id of ids)add('hidden_history',{user_id:key.slice(0,split),role:key.slice(split+1),job_id});
  }
  s.events.forEach((e,event_sequence)=>add('domain_events',{event_id:e.id,event_sequence,operation_id:e.operationId,type:e.type,subject_id:e.subjectId,actor_id:e.actorId,actor_role:e.actorRole,at:e.at,
    recipients_payload:pack(e.recipients),roles_payload:pack(e.recipientRoles),facts_payload:pack(e.facts),context_payload:pack(e.context),proof_payload:pack(e.proof),timers_payload:pack(e.timers),retentions_payload:pack(e.retentions),policy_version:e.policyVersion}));
  for(const [key,pref] of Object.entries(s.preferences)) {
    const role=key.slice(key.lastIndexOf(':')+1);
    if(!['client','master','admin'].includes(role)||key!==`${pref.userId}:${role}`||pref.role!==role)throw new CodecError();
    add('notification_preferences',{user_id:pref.userId,role,events_payload:pack(pref.eventTypes),channels_payload:pack(pref.channels),sound_requested:+pref.soundRequested});
  }
  for(const d of Object.values(s.deliveries))add('deliveries',{delivery_id:d.id,event_id:d.eventId,recipient_id:d.recipientId,recipient_role:d.recipientRole,channel:d.channel,attempt:d.attempt,status:d.status});
  for(const [kind,map] of [['current',s.retention],['origin',s.retentionOrigins]] as const)for(const [fact_id,f] of Object.entries(map))add('retention_records',{fact_id,record_kind:kind,kind:f.kind,anchor:f.anchor,anchor_kind:f.anchorKind,deadline:f.deadline,policy_version:f.policyVersion});
  return rows;
}
export function materialize(rows:Projection):CoreState {
  const s=emptyState();
  for(const r of rows.users)put(s.users,text(r,'user_id'),{id:text(r,'user_id'),createdAt:number(r,'created_at'),email:nullableText(r,'email'),phone:nullableText(r,'phone'),
    displayName:text(r,'display_name'),photoId:nullableText(r,'photo_id'),locale:text(r,'locale'),clientActive:bool(r,'client_active'),masterActive:bool(r,'master_active'),
    specialization:p<CoreState['users'][string]['specialization']>(r,'specialization_payload'),contacts:p<CoreState['users'][string]['contacts']>(r,'contacts_payload'),identities:[]});
  for(const r of ordered(rows.user_identities))s.users[text(r,'user_id')]!.identities.push({method:text(r,'method'),subject:text(r,'subject')});
  for(const r of rows.consumed_claims)put(s.consumedClaims,text(r,'claim_id'),text(r,'purpose'));
  for(const r of rows.catalog_revisions) {
    const key=text(r,'catalog_key'); const c:CoreState['published'][string]={id:text(r,'catalog_id'),version:number(r,'version'),sequence:number(r,'sequence'),status:text(r,'status') as 'draft'|'published',texts:[],categories:[],entities:[],scenarios:[],blocks:[],bindings:[]};
    put(c.status==='draft'?s.drafts:s.published,key,c); if(bool(r,'is_current')) {if(s.current!==null)throw new CodecError();s.current=key;}
  }
  const catalog=(r:Row)=>(Object.hasOwn(s.drafts,text(r,'catalog_key'))?s.drafts:s.published)[text(r,'catalog_key')]!;
  for(const r of ordered(rows.catalog_texts))(catalog(r).texts as unknown[]).push({id:text(r,'text_id'),revision:number(r,'revision'),meaning:number(r,'meaning'),editions:p(r,'editions_payload')});
  for(const r of ordered(rows.catalog_items)) { const kind=text(r,'item_type');if(!Object.hasOwn(catalogKinds,kind))throw new CodecError();(catalog(r)[catalogKinds[kind as keyof typeof catalogKinds]] as unknown[]).push(p(r,'payload')); }
  for(const r of ordered(rows.policies))s.policies.push(p(r,'policy_payload'));
  for(const r of rows.translation_corrections)put(s.corrections,compoundId(text(r,'old_catalog_key'),text(r,'text_id')),text(r,'new_catalog_key'));
  for(const r of rows.jobs)put(s.jobs,text(r,'job_id'),{...p<Omit<CoreState['jobs'][string],'id'>>(r,'job_payload'),id:text(r,'job_id'),clientId:text(r,'client_id'),state:text(r,'state') as CoreState['jobs'][string]['state'],
    selectedMasterId:nullableText(r,'selected_master_id'),chatId:nullableText(r,'selected_chat_id'),resolutionId:nullableText(r,'resolution_id'),linkedJobId:nullableText(r,'linked_job_id'),
    acceptedAt:nullableNumber(r,'accepted_at'),acceptanceOperationId:nullableText(r,'acceptance_operation_id'),completedAt:nullableNumber(r,'completed_at'),lastActivityAt:nullableNumber(r,'last_activity_at'),offers:{},financial:null,reservation:null,funds:'none'});
  for(const r of rows.job_financials) { const j=s.jobs[text(r,'job_id')]!;j.funds=text(r,'funds') as typeof j.funds;j.financial=p(r,'financial_payload');const reservation=p<CoreState['jobs'][string]['reservation']>(r,'reservation_payload');j.reservation=reservation===null?null:{...reservation,operations:[]}; }
  for(const r of ordered(rows.payment_operations))s.jobs[text(r,'job_id')]!.reservation!.operations.push(p(r,'operation_payload'));
  for(const r of rows.offers)put(s.jobs[text(r,'job_id')]!.offers,text(r,'master_id'),{id:text(r,'offer_id'),jobId:text(r,'job_id'),masterId:text(r,'master_id'),chatId:text(r,'chat_id'),catalogKey:text(r,'catalog_key'),initialPrice:decimal(r.initial_price),initialAt:number(r,'initial_at'),state:text(r,'state') as 'open'|'selected'|'closed',revised:p(r,'revised_payload'),final:p(r,'final_payload'),closedReason:nullableText(r,'closed_reason')});
  for(const r of rows.refusal_records)put(s.refusals,text(r,'refusal_id'),{id:text(r,'refusal_id'),masterId:text(r,'master_id'),jobId:text(r,'job_id'),offerId:nullableText(r,'offer_id'),resolutionId:nullableText(r,'resolution_decision_id'),at:number(r,'at'),operationId:text(r,'operation_id')});
  for(const r of rows.refusal_streaks)put(s.refusalStreak,text(r,'master_id'),number(r,'streak'));
  for(const r of rows.chat_threads) {
    const context:CoreState['threads'][string]['context']=r.context_type==='job'?{type:'job',jobId:text(r,'job_id'),clientId:text(r,'client_id'),masterId:text(r,'master_id')}:
      {type:'support',userId:text(r,'user_id'),userRole:text(r,'user_role') as 'client'|'master',basis:text(r,'basis') as 'repayment'|'resolution',basisId:text(r,'basis_id')};
    put(s.threads,text(r,'chat_id'),{id:text(r,'chat_id'),context,mode:text(r,'mode') as CoreState['threads'][string]['mode'],createdAt:number(r,'created_at'),messageIds:[],clientSpoke:bool(r,'client_spoke'),masterSpoke:bool(r,'master_spoke'),protected:bool(r,'protected'),waitingFor:nullableText(r,'waiting_for'),reminder:p<CoreState['threads'][string]['reminder']>(r,'reminder_payload'),languageNotice:p<CoreState['threads'][string]['languageNotice']>(r,'language_payload')});
  }
  for(const r of ordered(rows.chat_messages)) {const id=text(r,'message_id'),chatId=text(r,'chat_id');put(s.messages,id,{id,chatId,authorId:text(r,'author_id'),sender:text(r,'sender') as 'user'|'helpy',original:text(r,'original'),originalLanguage:nullableText(r,'original_language'),photoIds:p(r,'photo_ids_payload'),at:number(r,'at')});s.threads[chatId]!.messageIds.push(id);}
  for(const r of rows.inbox_messages)put(s.inbox,text(r,'message_id'),{id:text(r,'message_id'),recipientId:text(r,'recipient_id'),original:text(r,'original'),at:number(r,'at')});
  for(const r of rows.feedback)put(s.feedback,text(r,'feedback_id'),{id:text(r,'feedback_id'),authorId:text(r,'author_id'),original:text(r,'original'),at:number(r,'at')});
  for(const r of rows.master_finance) {const id=text(r,'master_id');if(r.debt_amount!==null)put(s.debt,id,decimal(r.debt_amount));if(r.threshold_amount!==null)put(s.thresholds,id,decimal(r.threshold_amount));}
  for(const r of ordered(rows.threshold_history))s.thresholdHistory.push({masterId:text(r,'master_id'),version:text(r,'version'),amount:r.amount===null?null:decimal(r.amount),effectiveAt:number(r,'effective_at')});
  for(const r of rows.ledger_entries)put(s.ledger,text(r,'ledger_id'),{id:text(r,'ledger_id'),masterId:text(r,'master_id'),basis:text(r,'basis'),change:decimal(r.change_amount),at:number(r,'at'),actorId:text(r,'actor_id')});
  for(const r of rows.financial_obligations) {
    const base={id:text(r,'obligation_id'),jobId:text(r,'job_id'),amount:decimal(r.amount),createdAt:number(r,'created_at'),settled:bool(r,'settled'),attempts:[]};
    if(r.kind==='payout')put(s.payouts,base.jobId,{...p<CoreState['payouts'][string]>(r,'type_payload'),...base});
    else put(s.obligations,base.id,{...p<CoreState['obligations'][string]>(r,'type_payload'),...base,kind:text(r,'kind') as 'refund'|'compensation',beneficiaryId:text(r,'beneficiary_id'),decisionId:text(r,'decision_id'),sourcePaymentId:text(r,'source_payment_id'),currency:'THB'});
  }
  for(const r of ordered(rows.transfer_attempts)) {const id=text(r,'obligation_id'),o=Object.values(s.payouts).find(x=>x.id===id)??s.obligations[id];if(!o)throw new CodecError();o.attempts.push(p(r,'attempt_payload'));}
  for(const r of rows.debt_repayments) {
    const id=text(r,'request_id');put(s.repayments,id,{id,masterId:text(r,'master_id'),amount:decimal(r.amount),requestedAt:number(r,'requested_at'),agreedAmount:r.agreed_amount===null?null:decimal(r.agreed_amount),status:text(r,'status') as CoreState['repayments'][string]['status'],method:nullableText(r,'method') as CoreState['repayments'][string]['method'],supportChatId:nullableText(r,'support_chat_id'),agreementId:nullableText(r,'agreement_id'),receiptId:nullableText(r,'receipt_id')});
    if(r.receipt_id!==null)put(s.receipts,text(r,'receipt_id'),{id:text(r,'receipt_id'),requestId:id,masterId:text(r,'master_id'),amount:decimal(r.received_amount),method:text(r,'received_method') as 'cash'|'bank_transfer',receivedAt:number(r,'received_at'),actorId:text(r,'actor_id'),evidence:text(r,'evidence')});
  }
  for(const r of rows.resolution_cases)put(s.cases,text(r,'case_id'),{id:text(r,'case_id'),jobId:text(r,'job_id'),requestId:nullableText(r,'request_id'),openedAt:number(r,'opened_at'),snapshotPolicy:text(r,'snapshot_policy'),evidence:p(r,'evidence_payload'),status:text(r,'status') as CoreState['cases'][string]['status'],decision:r.decision_payload===null?null:p(r,'decision_payload')});
  for(const r of rows.reviews)put(s.reviews,text(r,'review_id'),{id:text(r,'review_id'),jobId:text(r,'job_id'),clientId:text(r,'client_id'),masterId:text(r,'master_id'),stars:number(r,'stars'),marks:p(r,'marks_payload'),comment:text(r,'comment'),createdAt:number(r,'created_at'),hidden:bool(r,'hidden'),moderation:r.moderation_payload===null?null:p(r,'moderation_payload')});
  for(const r of rows.hidden_history) {const key=`${text(r,'user_id')}:${text(r,'role')}`;put(s.hiddenHistory,key,[...(Object.hasOwn(s.hiddenHistory,key)?s.hiddenHistory[key]!:[]),text(r,'job_id')]);}
  for(const r of ordered(rows.domain_events,'event_sequence'))s.events.push({id:text(r,'event_id'),operationId:text(r,'operation_id'),type:text(r,'type') as CoreState['events'][number]['type'],subjectId:text(r,'subject_id'),actorId:text(r,'actor_id'),actorRole:nullableText(r,'actor_role') as CoreState['events'][number]['actorRole'],at:number(r,'at'),recipients:p(r,'recipients_payload'),recipientRoles:p(r,'roles_payload'),facts:p(r,'facts_payload'),context:p(r,'context_payload'),proof:p(r,'proof_payload'),timers:p(r,'timers_payload'),retentions:p(r,'retentions_payload'),policyVersion:nullableText(r,'policy_version')});
  for(const r of rows.notification_preferences) {const userId=text(r,'user_id'),role=text(r,'role') as 'client'|'master'|'admin';put(s.preferences,`${userId}:${role}`,{userId,role,eventTypes:p<CoreState['preferences'][string]['eventTypes']>(r,'events_payload'),channels:p<CoreState['preferences'][string]['channels']>(r,'channels_payload'),soundRequested:bool(r,'sound_requested')});}
  for(const r of rows.deliveries)put(s.deliveries,text(r,'delivery_id'),{id:text(r,'delivery_id'),eventId:text(r,'event_id'),recipientId:text(r,'recipient_id'),recipientRole:text(r,'recipient_role') as 'client'|'master'|'admin',channel:text(r,'channel'),attempt:number(r,'attempt'),status:text(r,'status') as CoreState['deliveries'][string]['status']});
  for(const r of rows.retention_records)put(r.record_kind==='current'?s.retention:s.retentionOrigins,text(r,'fact_id'),{kind:text(r,'kind') as CoreState['retention'][string]['kind'],anchor:nullableNumber(r,'anchor'),anchorKind:text(r,'anchor_kind') as 'completed'|'recorded',deadline:nullableNumber(r,'deadline'),policyVersion:text(r,'policy_version')});
  // Reject missing projections, malformed ordering and contradictory physical/payload values.
  const again=project(s);
  const signature=(row:Row)=>JSON.stringify(Object.keys(row).sort().map(key=>[key,row[key]]));
  for(const table of stateTables)if(JSON.stringify(rows[table].map(signature).sort())!==JSON.stringify(again[table].map(signature).sort()))throw new CodecError();
  for(const user of Object.values(s.users))Validate.account(user);
  for(const catalog of [...Object.values(s.drafts),...Object.values(s.published)])Validate.catalog(catalog);
  for(const policy of s.policies)Validate.policy(policy);
  for(const job of Object.values(s.jobs)) {
    Validate.job(job);
    if(job.draft)Validate.command({type:'new_job',id:job.id,draft:job.draft});
    if(job.snapshot)Validate.command({type:'new_job',id:job.id,draft:{items:job.snapshot.items,cep:job.snapshot.cep,publicAddress:job.snapshot.publicAddress,address:job.snapshot.address}});
  }
  for(const thread of Object.values(s.threads))Validate.thread(thread);
  for(const event of s.events)Validate.eventRecord(event);
  for(const delivery of Object.values(s.deliveries))Validate.delivery(delivery);
  for(const transfer of [...Object.values(s.payouts),...Object.values(s.obligations)])Validate.transfer(transfer);
  return s;
}
