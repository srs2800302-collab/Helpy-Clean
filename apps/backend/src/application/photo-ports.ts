import type { CoreState } from './ports.js';
import type { Result } from '../domain/core.js';
export type PhotoResult<T> = Result<T>|{readonly ok:false;readonly error:{readonly code:'InfrastructureUnavailable';readonly detail:string}};
export interface PhotoReference {readonly kind:'profile'|'job'|'chat';readonly id:string}
export interface StoredPhoto {readonly id:string;readonly ownerId:string;readonly format:'image/webp';readonly businessRef:PhotoReference;readonly present:boolean}
export interface PhotoMetadataStorePort {
  maxBytes():Promise<number>;
  find(id:string):Promise<StoredPhoto|null>;
  replay(operationId:string,actor:string,signature:string,access:(state:CoreState)=>Result<void>):Promise<Result<StoredPhoto>|null>;
  register(operationId:string,actor:string,signature:string,photo:StoredPhoto,access:(state:CoreState)=>Result<void>):Promise<Result<StoredPhoto>>;
}
export interface PhotoObjectStorePort {
  create(id:string,bytes:Uint8Array,signature:string):Promise<PhotoResult<void>>;
  head(id:string):Promise<boolean>;
  read(id:string):Promise<Uint8Array|null>;
}
export interface ImageProcessorPort {process(source:Uint8Array,mime:string,limit:number):Promise<PhotoResult<Uint8Array>>}
