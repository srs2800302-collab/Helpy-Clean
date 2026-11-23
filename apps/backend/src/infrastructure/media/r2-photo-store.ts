import type { PhotoObjectStorePort } from '../../application/photo-ports.js';
import type { PhotoMetadataPort } from '../../application/ports.js';
import { failure, success } from '../../domain/core.js';
export class PhotoInfrastructureError extends Error {readonly code='InfrastructureUnavailable';constructor(){super('Photo infrastructure unavailable');}}
export interface Bucket {
  head(key:string):Promise<{customMetadata?:Record<string,string>}|null>;
  get(key:string):Promise<{arrayBuffer():Promise<ArrayBuffer>}|null>;
  put(key:string,value:Uint8Array,options:{onlyIf:{etagDoesNotMatch:string};httpMetadata:{contentType:string};customMetadata:Record<string,string>}):Promise<unknown|null>;
}
export class R2PhotoStore implements PhotoObjectStorePort {
  constructor(private readonly bucket:Bucket) {}
  private key(id:string):string {return `photos/${encodeURIComponent(id)}`;}
  async head(id:string):Promise<boolean> {try{return await this.bucket.head(this.key(id))!==null;}catch{throw new PhotoInfrastructureError();}}
  async read(id:string):Promise<Uint8Array|null> {try{const object=await this.bucket.get(this.key(id));return object?new Uint8Array(await object.arrayBuffer()):null;}catch{throw new PhotoInfrastructureError();}}
  async create(id:string,bytes:Uint8Array,signature:string) {
    try {
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(signature))),b=>b.toString(16).padStart(2,'0')).join('');
    const old=await this.bucket.head(this.key(id));
    if(old)return old.customMetadata?.sourceSignature===digest?success(undefined):failure('Conflict');
    const result=await this.bucket.put(this.key(id),bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'image/webp'},customMetadata:{sourceSignature:digest}});
    const confirmed=await this.bucket.head(this.key(id));if(confirmed?.customMetadata?.sourceSignature===digest)return success(undefined);
    if(result===null&&confirmed!==null)return failure('Conflict');
    throw new PhotoInfrastructureError();
    }catch{return {ok:false as const,error:{code:'InfrastructureUnavailable' as const,detail:'InfrastructureUnavailable'}};}
  }
}
export function photoMetadataLookup(metadata:{find(id:string):Promise<{id:string;ownerId:string;format:string;present:boolean}|null>},objects:PhotoObjectStorePort):PhotoMetadataPort {
  return {async lookup(ids){try{const result=[];for(const id of ids){const photo=await metadata.find(id);if(photo)result.push({...photo,present:photo.present&&await objects.head(id)});}return success(result);}catch{return failure('RepositoryUnavailable');}}};
}
