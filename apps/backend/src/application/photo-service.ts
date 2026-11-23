import type { AtomicRepository, AuthenticationPort } from './ports.js';
import type { CoreState } from './ports.js';
import type { ImageProcessorPort, PhotoMetadataStorePort, PhotoObjectStorePort, PhotoReference, StoredPhoto, PhotoResult } from './photo-ports.js';
import type { Principal, Result } from '../domain/core.js';
import { checked, requireThat, success, failure, own, identifier } from '../domain/core.js';
import { jobById, threadById } from './invariants.js';
import { participant } from '../domain/messaging.js';
import { sameFact } from '../domain/provenance.js';
import { accountById, requireActive } from '../domain/accounts.js';
import * as Validate from './validation.js';
export class PhotoApplicationService {
  constructor(private readonly repository:AtomicRepository,private readonly auth:AuthenticationPort,private readonly metadata:PhotoMetadataStorePort,
    private readonly objects:PhotoObjectStorePort,private readonly images:ImageProcessorPort,
    private readonly digest:(bytes:Uint8Array)=>Promise<string>) {}
  private authenticate(session:string):Promise<Result<Principal>> {
    return Validate.callPort(()=>this.auth.authenticate(session),value=>{
      Validate.principal(value);
      requireThat(['client','master','admin'].includes((value as Principal).role),'Unauthorized');
    },'Unauthorized');
  }
  private access(state:CoreState,actor:Principal,ref:PhotoReference,owner:string,write:boolean):Result<void> {
    return checked(()=>{
      identifier(ref.id);requireThat(['profile','job','chat'].includes(ref.kind),'InvalidReference');
      if(actor.role!=='admin') {
        const user=accountById(state,actor.userId);
        if(ref.kind!=='profile')requireActive(user,actor,actor.role);
      }
      if(write)requireThat(actor.userId===owner,'Unauthorized');
      if(ref.kind==='profile')requireThat(own(state.users,ref.id)&&ref.id===owner&&(actor.userId===owner||actor.role==='admin'&&actor.permissions.includes('accounts')),'Unauthorized');
      else if(ref.kind==='job') {
        const job=jobById(state,ref.id);
        requireThat(actor.role==='client'&&actor.userId===job.clientId||actor.role==='master'&&(actor.userId===job.selectedMasterId||!!own(job.offers,actor.userId))||actor.role==='admin'&&actor.permissions.includes('resolution'),'Unauthorized');
      }else {
        const thread=threadById(state,ref.id);
        if(actor.role==='admin'&&thread.context.type==='job')requireThat(actor.permissions.includes('resolution'),'Unauthorized');
        else participant(thread,actor);
      }
    });
  }
  async store(session:string,operationId:string,id:string,ref:PhotoReference,mime:string,source:Uint8Array):Promise<PhotoResult<StoredPhoto>> {
    source=source.slice();ref={...ref};
    const valid=checked(()=>{identifier(operationId);identifier(id);requireThat(source.length>0&&source.length<=10485760,'InvalidPhoto');});if(!valid.ok)return valid;
    const authenticated=await this.authenticate(session);if(!authenticated.ok)return authenticated;
    const actor=authenticated.value;
    const access=(state:CoreState)=>this.access(state,actor,ref,actor.userId,true);
    const permitted=access(await this.repository.read());if(!permitted.ok)return permitted;
    const signature=JSON.stringify(['photo_store',id,actor.userId,actor.role,ref.kind,ref.id,mime,await this.digest(source)]);
    const replay=await this.metadata.replay(operationId,actor.userId,signature,access);
    if(replay!==null) {
      if(!replay.ok)return replay;
      const registered=await this.metadata.find(id);
      return registered&&sameFact(registered,replay.value)&&await this.objects.head(id)?replay:failure('InvalidPhoto');
    }
    const limit=await this.metadata.maxBytes(),processed=await this.images.process(source,mime,limit);if(!processed.ok)return processed;
    if(processed.value.length===0||processed.value.length>limit)return failure('InvalidPhoto');
    const current=await this.authenticate(session);if(!current.ok)return current;
    if(current.value.userId!==actor.userId||current.value.role!==actor.role)return failure('Unauthorized');
    const currentAccess=(state:CoreState)=>this.access(state,current.value,ref,actor.userId,true);
    const allowed=currentAccess(await this.repository.read());if(!allowed.ok)return allowed;
    const created=await this.objects.create(id,processed.value,signature);if(!created.ok)return created;
    const final=await this.authenticate(session);if(!final.ok)return final;
    if(final.value.userId!==actor.userId||final.value.role!==actor.role)return failure('Unauthorized');
    return this.metadata.register(operationId,actor.userId,signature,{id,ownerId:actor.userId,format:'image/webp',businessRef:ref,present:true},
      state=>this.access(state,final.value,ref,actor.userId,true));
  }
  async read(session:string,id:string):Promise<PhotoResult<{photo:StoredPhoto;bytes:Uint8Array}>> {
    const authenticated=await this.authenticate(session);if(!authenticated.ok)return authenticated;
    const photo=await this.metadata.find(id);if(!photo||!photo.present)return failure('NotFound');
    const allowed=this.access(await this.repository.read(),authenticated.value,photo.businessRef,photo.ownerId,false);if(!allowed.ok)return allowed;
    const bytes=await this.objects.read(id);if(!bytes)return failure('NotFound');
    const current=await this.authenticate(session);if(!current.ok)return current;
    if(current.value.userId!==authenticated.value.userId||current.value.role!==authenticated.value.role)return failure('Unauthorized');
    const permitted=this.access(await this.repository.read(),current.value,photo.businessRef,photo.ownerId,false);return permitted.ok?success({photo,bytes}):permitted;
  }
}
