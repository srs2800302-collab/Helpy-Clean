import { apiFailureCodes, decodeCommandMoney, encodeWire, exactFields, isApiCommand, isApiQuery, isRecord } from '@helpy/contracts';
import type { ApiErrorCode, HealthResponse, Json } from '@helpy/contracts';
import type { DomainCore, CorePorts, Command } from '../application/domain-core.js';
import type { Query } from '../application/queries.js';
import { query } from '../application/queries.js';
import type { PhotoApplicationService } from '../application/photo-service.js';

export interface HttpRequest {readonly method:string;readonly path:string;readonly headers?:Readonly<Record<string,string>>;readonly body?:Uint8Array;readonly bodyTooLarge?:boolean}
export const maxHttpBodyBytes=12582912;
export interface HttpResponse {readonly status:number;readonly body:HealthResponse|Json|Uint8Array;readonly headers?:Readonly<Record<string,string>>}
export interface HttpApplication {
  readonly core:DomainCore;readonly ports:CorePorts;readonly photos:PhotoApplicationService;
  readonly accountAccess:(proof:string,operationId:string,recovery:boolean)=>ReturnType<DomainCore['authenticate']>;
}
const routes:Record<string,string>={'/health':'GET','/api/v1/account/access':'POST','/api/v1/commands':'POST','/api/v1/queries':'POST',
  '/api/v1/translations/message':'POST','/api/v1/translations/draft':'POST','/api/v1/notifications/dispatch':'POST'};
function status(code:ApiErrorCode):number {
  if(code==='BadRequest')return 400;if(code==='Unauthorized')return 401;if(code==='NotFound')return 404;
  if(['Conflict','IdentityOccupied','ClaimConsumed','StaleRevision'].includes(code))return 409;
  if(code==='UnsupportedMediaType')return 415;
  if(['RepositoryUnavailable','RepositoryOutcomeUnknown','InfrastructureUnavailable'].includes(code))return 503;
  return 422;
}
const error=(code:ApiErrorCode,override?:number):HttpResponse=>{
  if(!(apiFailureCodes as readonly unknown[]).includes(code))return {status:500,body:{ok:false,error:{code:'InfrastructureUnavailable'}}};
  return {status:override??status(code),body:{ok:false,error:{code}}};
};
function result(value:{ok:true;value:unknown}|{ok:false;error:{code:ApiErrorCode}}):HttpResponse {
  return value.ok?{status:200,body:{ok:true,value:encodeWire(value.value)}}:error(value.error.code);
}
// Keep the accepted pure F1 health entry point synchronous; all application I/O is awaited.
export function handleHttp(request:HttpRequest&{readonly path:'/health'}):HttpResponse;
export function handleHttp(request:HttpRequest):HttpResponse|Promise<HttpResponse>;
export function handleHttp(request:HttpRequest,app:HttpApplication|undefined):Promise<HttpResponse>;
export function handleHttp(request:HttpRequest,app?:HttpApplication):HttpResponse|Promise<HttpResponse> {
  const asynchronous=arguments.length>1;
  const immediate=(response:HttpResponse)=>asynchronous?Promise.resolve(response):response;
  if(request.bodyTooLarge||request.body&&request.body.byteLength>maxHttpBodyBytes)return immediate(error('BadRequest'));
  const photo=/^\/api\/v1\/photos\/([^/]+)$/.exec(request.path),method=photo?'PUT, GET':routes[request.path];
  if(!method)return immediate(error('NotFound'));
  if(!method.split(', ').includes(request.method))return immediate({...error('BadRequest',405),headers:{allow:method}});
  if(request.path==='/health')return immediate({status:200,body:{status:'ok',contractVersion:1}});
  return executeHttp(request,app,photo?.[1]).catch(cause=>{
    if(isRecord(cause)&&['RepositoryUnavailable','RepositoryOutcomeUnknown','InfrastructureUnavailable'].includes(String(cause.code)))return error(cause.code as ApiErrorCode);
    return error('InfrastructureUnavailable',500);
  });
}
async function executeHttp(request:HttpRequest,app:HttpApplication|undefined,photoSegment?:string):Promise<HttpResponse> {
  const headers=request.headers??{};
  const bearer=/^Bearer ([^\s]+)$/i.exec(headers.authorization??'')?.[1];
  if(request.path!=='/api/v1/account/access'&&!bearer)return error('Unauthorized');
  if(!app)return error('InfrastructureUnavailable');
  if(photoSegment!==undefined) {
    let id:string;try{id=decodeURIComponent(photoSegment);}catch{return error('BadRequest');}
    if(!id.trim())return error('BadRequest');
    if(request.method==='GET') {
      const read=await app.photos.read(bearer!,id);return read.ok?{status:200,body:read.value.bytes,headers:{'content-type':read.value.photo.format,'cache-control':'private, no-store'}}:error(read.error.code);
    }
    const mime=headers['content-type']??'';if(!['image/jpeg','image/png','image/webp'].includes(mime))return error('UnsupportedMediaType');
    const kind=headers['x-business-ref-kind'],ref=headers['x-business-ref-id'],operation=headers['idempotency-key'];
    if(!['profile','job','chat'].includes(kind??'')||!ref||!operation||!request.body)return error('BadRequest');
    return result(await app.photos.store(bearer!,operation,id,{kind:kind as 'profile'|'job'|'chat',id:ref},mime,request.body));
  }
  if((headers['content-type']??'').split(';')[0]?.trim()!=='application/json')return error('UnsupportedMediaType');
  let body:unknown;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(request.body));}catch{return error('BadRequest');}
  const strings=(b:Record<string,unknown>,keys:readonly string[])=>keys.every(k=>typeof b[k]==='string'&&(b[k] as string).trim());
  switch(request.path) {
    case '/api/v1/commands': {
      if(!exactFields(body,['operationId','command'])||typeof body.operationId!=='string'||!body.operationId.trim()||!isApiCommand(body.command))return error('BadRequest');
      let command:Command;try{command=decodeCommandMoney(body.command) as Command;}catch{return error('BadRequest');}
      const executed=await app.core.execute(bearer!,body.operationId,command);if(!executed.ok)return error(executed.error.code);
      const outcome=executed.value.outcome;
      let id:string|null=null;
      for(const [key,value] of Object.entries(outcome))if(key==='id'&&typeof value==='string')id=value;else if(isRecord(value)&&typeof value.id==='string')id=value.id;
      return result({ok:true,value:{kind:outcome.kind,id}});
    }
    case '/api/v1/queries':
      if(!exactFields(body,['query'])||!isApiQuery(body.query))return error('BadRequest');
      return result(await query(app.ports.repository,app.ports.auth,app.ports.clock,bearer!,body.query as Query));
    case '/api/v1/account/access': {
      if(!exactFields(body,['method','proof','operationId'])||!strings(body,['proof','operationId'])||!['login','recover'].includes(String(body.method)))return error('BadRequest');
      const account=await app.accountAccess(body.proof as string,body.operationId as string,body.method==='recover');
      return account.ok?result({ok:true,value:{id:account.value.id,displayName:account.value.displayName,photoId:account.value.photoId,locale:account.value.locale}}):error(account.error.code);
    }
    case '/api/v1/translations/message':
      if(!exactFields(body,['messageId','target'])||!strings(body,['messageId','target']))return error('BadRequest');
      return result(await app.core.translateMessage(bearer!,body.messageId as string,body.target as string));
    case '/api/v1/translations/draft':
      if(!exactFields(body,['original','source','target'])||!strings(body,['original','source','target']))return error('BadRequest');
      return result(await app.core.draftTranslation(bearer!,body.original as string,body.source as string,body.target as string));
    case '/api/v1/notifications/dispatch':
      if(!exactFields(body,['eventId','recipientId','channel','operationId'])||!strings(body,['eventId','recipientId','channel','operationId']))return error('BadRequest');
      return result(await app.core.dispatchNotification(bearer!,body.eventId as string,body.recipientId as string,body.channel as string,body.operationId as string));
    default:return error('NotFound');
  }
}
