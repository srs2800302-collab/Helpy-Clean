import catalog from '../lib/src/catalog.json' with { type: 'json' };

export const languages = Object.freeze(['th', 'ru', 'en'] as const);
export type Language = (typeof languages)[number];
export type TextKey = 'title' | 'adminTitle' | 'foundation' | 'description' |
  'language' | 'preferenceUnavailable';

export function isLanguage(value: unknown): value is Language {
  return value === 'th' || value === 'ru' || value === 'en';
}

export function text(language: Language, key: TextKey): string {
  return catalog.messages[language][key];
}

export function languageName(language: Language): string {
  return catalog.languages[language];
}

export interface HealthResponse {
  readonly status: 'ok';
  readonly contractVersion: 1;
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  return typeof value === 'object' && value !== null &&
    'status' in value && value.status === 'ok' &&
    'contractVersion' in value && value.contractVersion === 1 &&
    Object.keys(value).length === 2;
}

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key:string]:Json };
export type Decimal = string & { readonly __decimal: unique symbol };
export function decimalMoney(value:unknown):Decimal {
  if(typeof value!=='string'||!/^(?:0|[1-9][0-9]*)$/.test(value))throw new Error('Bad decimal money');return value as Decimal;
}
export const commandFields = {
  publish_policy:{policy:'object'},threshold:{masterId:'string',amount:'money?'},save_catalog:{draft:'object',expectedSequence:'number?'},
  approve_text:{key:'string',textId:'string',locale:'string',sequence:'number',revision:'number'},approve_content_set:{key:'string',sequence:'number',revisions:'array',confirmed:'boolean'},
  publish_catalog:{key:'string',sequence:'number'},translation_correction:{oldCatalogKey:'string',newCatalogKey:'string',textId:'string',sameMeaningConfirmed:'boolean'},
  profile:{displayName:'string',photoId:'string?',specialization:'object'},activate:{role:'string'},switch_role:{role:'string'},locale:{locale:'string'},bind_contact:{proof:'string'},
  new_job:{id:'string',draft:'object'},edit_draft:{jobId:'string',draft:'object'},publish_job:{jobId:'string'},link_jobs:{jobId:'string',linkedJobId:'string'},
  initial_offer:{jobId:'string',id:'string',chatId:'string'},message:{chatId:'string',id:'string',original:'string',photoIds:'array',sender:'string'},
  revise_price:{jobId:'string',masterId:'string',amount:'money',reason:'string',confirmed:'boolean'},approve_price:{jobId:'string',masterId:'string',approved:'boolean',confirmed:'boolean'},
  final_application:{jobId:'string',masterId:'string',confirmed:'boolean',amount:'money',recipientId:'string'},select_master:{jobId:'string',masterId:'string',confirmed:'boolean',amount:'money'},
  terminate_negotiation:{jobId:'string',masterId:'string',confirmed:'boolean',reason:'string'},publication_deadline:{jobId:'string',cycleIndex:'number'},cash:{jobId:'string'},
  initiate_payment:{jobId:'string',id:'string',route:'string'},payment_outcome:{jobId:'string',proof:'string'},reservation_deadline:{jobId:'string'},decline_reservation:{jobId:'string',confirmed:'boolean'},
  accept_work:{jobId:'string',accepted:'boolean',explanation:'string'},submit_result:{jobId:'string',explanation:'string',photoIds:'array'},complete:{jobId:'string'},
  cancel:{jobId:'string',id:'string',reason:'string',explanation:'string',evidence:'array',confirmed:'boolean',classification:'string',remainingWork:'string'},
  cancellation_response:{jobId:'string',workStopped:'boolean',financialConsent:'boolean',explanation:'string',remainingWork:'optional:string',evidence:'optional:array'},
  open_resolution:{jobId:'string',id:'string',evidence:'array'},decide_resolution:{caseId:'string',decision:'object'},inspect_resolution:{caseId:'string'},reminders:{jobId:'string'},
  start_payout:{jobId:'string',attemptId:'string'},payout_outcome:{jobId:'string',proof:'string'},start_settlement:{obligationId:'string',attemptId:'string'},settlement_outcome:{obligationId:'string',proof:'string'},
  request_repayment:{id:'string',amount:'money',confirmed:'boolean'},agree_repayment:{requestId:'string',amount:'money',method:'string',agreementId:'string'},
  receive_repayment:{requestId:'string',masterId:'string',amount:'money',receiptId:'string',agreementId:'string',actuallyReceived:'boolean',evidence:'string'},
  close_repayment:{requestId:'string',reason:'string'},support:{id:'string',userId:'string',userRole:'string',basis:'string',basisId:'string'},close_support:{chatId:'string'},
  review:{jobId:'string',id:'string',stars:'number',marks:'array',comment:'string'},hide_review:{reviewId:'string',reason:'string'},hide_history:{jobId:'string'},
  preferences:{preference:'object'},inbox:{id:'string',recipientId:'string',original:'string'},feedback:{id:'string',original:'string'},evaluate_retention:{factId:'string'},
} as const;
export const queryFields = {
  feed:{},job:{jobId:'string'},payment:{jobId:'string'},debt:{masterId:'string'},cash_availability:{masterId:'string'},
  information:{catalogKey:'string',targets:'array',locale:'string',jobId:'optional:string'},published_text:{catalogKey:'string',textId:'string',locale:'string',corrected:'optional:boolean',jobId:'optional:string'},
  chat_history:{chatId:'string'},history:{},reputation:{masterId:'string'},contacts:{userId:'string'},role_counts:{},repayment:{requestId:'string'},payout:{jobId:'string'},inbox:{},
} as const;
type Field<T> = T extends 'money'?Decimal:T extends 'money?'?Decimal|null:T extends 'string'?string:T extends 'string?'?string|null:
  T extends 'number'?number:T extends 'number?'?number|null:T extends 'boolean'?boolean:T extends 'array'?readonly Json[]:T extends 'object'?{readonly [key:string]:Json}:
  T extends `optional:${infer S}`?Field<S>|undefined:never;
type Variant<T> = {[K in keyof T]:{readonly type:K}&{readonly [P in keyof T[K] as T[K][P] extends `optional:${string}`?never:P]:Field<T[K][P]>}&
  {readonly [P in keyof T[K] as T[K][P] extends `optional:${string}`?P:never]?:Field<T[K][P]>}}[keyof T];
export type ApiCommand = Variant<typeof commandFields>;
export type ApiQuery = Variant<typeof queryFields>;
export interface CommandEnvelope {readonly operationId:string;readonly command:ApiCommand}
export interface QueryEnvelope {readonly query:ApiQuery}
export interface CommandView {readonly kind:string;readonly id:string|null}
export const methodRoutes = {login:'/api/v1/account/access',recover:'/api/v1/account/access',translateMessage:'/api/v1/translations/message',
  draftTranslation:'/api/v1/translations/draft',dispatchNotification:'/api/v1/notifications/dispatch'} as const;
export const apiFailureCodes = ['Unauthorized','NotFound','Conflict','InvalidConfiguration','InvalidIdentity','IdentityOccupied','ContactUnverified','ClaimConsumed',
  'RoleInactive','ProfileIncomplete','InvalidLocale','TranslationUnavailable','ApprovalRequired','StaleRevision','InvalidReference','InactiveEntity','InvalidScope','RequiredAnswer','RequiredPhoto','InvalidPhoto','RouteRequired','StopCondition',
  'PublishedSnapshotImmutable','PublicationExpired','SpecializationMismatch','ChatClosed','ConfirmationRequired','DiscussionRequired','PriceAlreadyRevised','FinalApplicationRequired','ReservationExpired','CashUnavailable','PaymentOutcomeUnknown','ProviderConflict',
  'InvalidMoney','InvalidRate','FixedRecoveryRate','DestinationUnverified','RouteUnavailable','InvalidRepayment','ReceiptUnconfirmed','DebtChanged','InvalidTransition','ResolutionRequired','EvidenceRequired','FundsMismatch','RetentionBlocked','SelfOrderForbidden','TextRejected','TextSafetyUnavailable',
  'RepositoryUnavailable','RepositoryOutcomeUnknown','BadRequest','UnsupportedMediaType','InfrastructureUnavailable'] as const;
export type ApiErrorCode = typeof apiFailureCodes[number];
export type ApiResult<T=Json> = {readonly ok:true;readonly value:T}|{readonly ok:false;readonly error:{readonly code:ApiErrorCode}};
export interface AccountAccessEnvelope {readonly method:'login'|'recover';readonly proof:string;readonly operationId:string}
export interface MessageTranslationEnvelope {readonly messageId:string;readonly target:string}
export interface DraftTranslationEnvelope {readonly original:string;readonly source:string;readonly target:string}
export interface NotificationDispatchEnvelope {readonly eventId:string;readonly recipientId:string;readonly channel:string;readonly operationId:string}
export const publicJobFields={id:'string',state:'string',items:'array',cep:'money',fap:'money?',publicAddress:'string',address:'string?',chatId:'string?',completedAt:'number?',acceptedAt:'number?'} as const;
export const publicMessageFields={id:'string',chatId:'string',authorId:'string',sender:'string',original:'string',originalLanguage:'string?',photoIds:'array',at:'number'} as const;
export const queryViewFields={feed:{jobs:'array'},job:{job:'object'},payment:{view:'object'},debt:{view:'object'},cash_availability:{mode:'string'},
  information:{blocks:'array'},published_text:{text:'string'},chat_history:{messages:'array'},history:{jobs:'array'},reputation:{summary:'object'},
  contacts:{contacts:'object'},role_counts:{clientProfiles:'number',masterProfiles:'number'},repayment:{request:'object'},
  payout:{amount:'money',settled:'boolean',state:'string',providerStatus:'string?',operationId:'string?',deadline:'number?',reason:'string?',failureReason:'string?'},inbox:{messages:'array'}} as const;
export const methodEnvelopeFields={AccountAccessEnvelope:{method:'string',proof:'string',operationId:'string'},MessageTranslationEnvelope:{messageId:'string',target:'string'},
  DraftTranslationEnvelope:{original:'string',source:'string',target:'string'},NotificationDispatchEnvelope:{eventId:'string',recipientId:'string',channel:'string',operationId:'string'}} as const;
export interface PublicJobView {
 readonly id:string;readonly state:'draft'|'published'|'reserved'|'assigned'|'working'|'client_accepted'|'completed'|'expired'|'cancelled';
 readonly items:readonly Json[];readonly cep:Decimal;readonly fap:Decimal|null;readonly publicAddress:string;readonly address:string|null;readonly chatId:string|null;
 readonly completedAt:number|null;readonly acceptedAt:number|null;
}
export interface PublicMessage {readonly id:string;readonly chatId:string;readonly authorId:string;readonly sender:'user'|'helpy';readonly original:string;readonly originalLanguage:string|null;readonly photoIds:readonly string[];readonly at:number}
export type ApiQueryValue =
 | {readonly type:'feed';readonly jobs:readonly {readonly id:string;readonly publishedAt:number;readonly cep:Decimal;readonly publicAddress:string;readonly items:readonly Json[]}[]}
 | {readonly type:'job';readonly job:PublicJobView}
 | {readonly type:'payment';readonly view:Readonly<Record<string,Json>>}
 | {readonly type:'debt';readonly view:{readonly outstandingDebt:Decimal;readonly effectiveMasterDebtThreshold:Decimal;readonly cashAvailable:boolean;readonly mode:'cash_and_noncash'|'noncash_only';readonly currency:'THB'}}
 | {readonly type:'cash_availability';readonly mode:'cash_and_noncash'|'noncash_only'}
 | {readonly type:'information';readonly blocks:readonly {readonly id:string;readonly revision:number;readonly text:string}[]}
 | {readonly type:'published_text';readonly text:string}
 | {readonly type:'chat_history';readonly messages:readonly PublicMessage[]}
 | {readonly type:'history';readonly jobs:readonly PublicJobView[]}
 | {readonly type:'reputation';readonly summary:{readonly workQuality:number|null;readonly reliability:number|null;readonly reviewsCount:number;readonly experience:number;readonly reviews:readonly Json[]}}
 | {readonly type:'contacts';readonly contacts:Readonly<Record<string,string|null>>}
 | {readonly type:'role_counts';readonly clientProfiles:number;readonly masterProfiles:number}
 | {readonly type:'repayment';readonly request:Readonly<Record<string,Json>>}
 | {readonly type:'payout';readonly amount:Decimal;readonly settled:boolean;readonly state:'ready'|'needsResolution'|'settled';readonly providerStatus:string|null;readonly operationId:string|null;readonly deadline:number|null;readonly reason:string|null;readonly failureReason:string|null}
 | {readonly type:'inbox';readonly messages:readonly {readonly id:string;readonly recipientId:string;readonly original:string;readonly at:number}[]};
export function isRecord(v:unknown):v is Record<string,unknown> {return v!==null&&typeof v==='object'&&!Array.isArray(v);}
export function exactFields(v:unknown,required:readonly string[],optional:readonly string[]=[]):v is Record<string,unknown> {
  return isRecord(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
}
function matches(value:unknown,kind:string):boolean {
  if(kind.startsWith('optional:'))return value===undefined||matches(value,kind.slice(9));
  if(kind.endsWith('?'))return value===null||matches(value,kind.slice(0,-1));
  if(kind==='money')return typeof value==='string'&&/^(?:0|[1-9][0-9]*)$/.test(value);
  if(kind==='number')return Number.isSafeInteger(value);
  if(kind==='array')return Array.isArray(value);
  if(kind==='object')return isRecord(value);
  return typeof value===kind;
}
function variant(value:unknown,fields:Record<string,Record<string,string>>):boolean {
  if(!isWireJson(value)||!isRecord(value)||typeof value.type!=='string'||!Object.hasOwn(fields,value.type))return false;
  const schema=fields[value.type]!;
  return Object.keys(value).every(k=>k==='type'||Object.hasOwn(schema,k))&&Object.entries(schema).every(([k,kind])=>matches(value[k],kind));
}
export const isApiCommand=(value:unknown):value is ApiCommand=>variant(value,commandFields);
export const isApiQuery=(value:unknown):value is ApiQuery=>variant(value,queryFields);
export const isApiQueryValue=(value:unknown):value is ApiQueryValue=>variant(value,queryViewFields);
export function isApiResult(value:unknown):value is ApiResult {
  return isWireJson(value)&&isRecord(value)&&(value.ok===true&&exactFields(value,['ok','value'])||value.ok===false&&exactFields(value,['ok','error'])&&
    exactFields(value.error,['code'])&&(apiFailureCodes as readonly unknown[]).includes(value.error.code));
}
function isWireJson(value:unknown,seen=new Set<object>()):boolean {
  if(value===null||typeof value==='string'||typeof value==='boolean')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(typeof value!=='object'||seen.has(value)||seen.size>=64||(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype))return false;
  if(Array.isArray(value)&&Object.keys(value).length!==value.length)return false;
  if(Object.values(Object.getOwnPropertyDescriptors(value)).some(d=>d.get||d.set))return false;
  seen.add(value);const valid=Object.values(value).every(child=>isWireJson(child,seen));seen.delete(value);return valid;
}
export function encodeWire(value:unknown):Json {
  if(typeof value==='bigint')return String(value);
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(Array.isArray(value))return value.map(encodeWire);
  if(isRecord(value))return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,encodeWire(v)]));
  throw new Error('Invalid wire value');
}
export function decodeCommandMoney(command:ApiCommand):unknown {
  const c=JSON.parse(JSON.stringify(command)) as Record<string,unknown>;
  const convert=(o:Record<string,unknown>,keys:readonly string[])=>{for(const key of keys)if(o[key]!==null&&o[key]!==undefined)o[key]=BigInt(decimalMoney(o[key]));};
  if(['threshold','revise_price','final_application','select_master','request_repayment','agree_repayment','receive_repayment'].includes(command.type))convert(c,['amount']);
  if(['new_job','edit_draft'].includes(command.type)){if(!isRecord(c.draft))throw new Error('Bad draft');convert(c.draft,['cep']);}
  if(command.type==='publish_policy') {
    if(!isRecord(c.policy))throw new Error('Bad policy');convert(c.policy,['globalDebtThreshold']);
    for(const key of ['commission','mutualCancellationFee','falseCallFee','falseCallMasterShare']){if(!isRecord(c.policy[key]))throw new Error('Bad rate');convert(c.policy[key],['numerator','denominator']);}
  }
  if(command.type==='decide_resolution'&&isRecord(c.decision)&&c.decision.shares!==undefined){if(!isRecord(c.decision.shares))throw new Error('Bad shares');convert(c.decision.shares,['clientRefund','masterCompensation']);}
  return c;
}
