import type { PhotoMetadataStorePort, StoredPhoto } from '../../application/photo-ports.js';
import type { CoreState } from '../../application/ports.js';
import type { Result } from '../../domain/core.js';
import { failure, success } from '../../domain/core.js';
import { D1AtomicRepository, RepositoryError } from './d1-atomic-repository.js';
import { unpack } from './d1-codec.js';
import {assertD1Row,D1CapacityError} from './d1-limits.js';
import type {Statement} from './d1-atomic-repository.js';
export class D1PhotoMetadataStore implements PhotoMetadataStorePort {
  constructor(private readonly repository:D1AtomicRepository) {}
  async maxBytes():Promise<number> {
    try {
    const r=await this.repository.db.batch([this.repository.db.prepare("SELECT value_payload FROM infrastructure_settings WHERE setting_key='maxStoredPhotoBytes'")]);
    const value=unpack<number>(r[0]?.results[0]?.value_payload);if(!r[0]?.success||!Number.isSafeInteger(value)||value<=0)throw new RepositoryError();return value;
    }catch{throw new RepositoryError();}
  }
  async find(id:string):Promise<StoredPhoto|null> {
    try {
    const result=await this.repository.db.batch([this.repository.prepare('SELECT * FROM photo_metadata WHERE photo_id=?',[id])]);
    if(!result[0]?.success)throw new RepositoryError();const row=result[0].results[0];if(!row)return null;
    if(row.format!=='image/webp'||!['profile','job','chat'].includes(String(row.business_ref_kind))||typeof row.owner_id!=='string'||typeof row.business_ref_id!=='string'||typeof row.present!=='number'||![0,1].includes(row.present))throw new RepositoryError();
    return {id,ownerId:row.owner_id,format:'image/webp',businessRef:{kind:row.business_ref_kind as 'profile'|'job'|'chat',id:row.business_ref_id},present:row.present===1};
    }catch{throw new RepositoryError();}
  }
  replay(id:string,actor:string,signature:string,access:(state:CoreState)=>Result<void>) {return this.repository.replay<StoredPhoto>(id,actor,signature,access);}
  async register(id:string,actor:string,signature:string,photo:StoredPhoto,access:(state:CoreState)=>Result<void>):Promise<Result<StoredPhoto>> {
    for(let attempt=0;attempt<this.repository.attempts;attempt++) {
      const s=await this.repository.snapshot(id),allowed=access(s.state);if(!allowed.ok)return allowed;
      const old=this.repository.receipt<StoredPhoto>(s.receipts,actor,signature);if(old!==null)return old;
      const token=crypto.randomUUID(),saved=success(photo);let statements:Statement[];
      try {
        const row={photo_id:photo.id,owner_id:photo.ownerId,format:photo.format,business_ref_kind:photo.businessRef.kind,business_ref_id:photo.businessRef.id,present:+photo.present};
        assertD1Row(row);
        statements=[this.repository.guard(s.revision,token),this.repository.prepare('INSERT INTO photo_metadata VALUES (?,?,?,?,?,?)',Object.values(row)),
          ...this.repository.receiptStatements(id,actor,signature,saved),...this.repository.end(token)];
      }catch(error){if(error instanceof D1CapacityError)return failure('RepositoryUnavailable');throw error;}
      if(await this.find(photo.id))return failure('Conflict');
      try {const r=await this.repository.db.batch(statements);if(r.length!==statements.length||r.some(x=>!x.success))throw new RepositoryError();return saved;}
      catch {
        let confirmed;try{confirmed=await this.repository.snapshot(id);}catch{return failure('RepositoryOutcomeUnknown');}
        const permitted=access(confirmed.state);if(!permitted.ok)return permitted;
        const receipt=this.repository.receipt<StoredPhoto>(confirmed.receipts,actor,signature);if(receipt!==null)return receipt;if(confirmed.revision===s.revision)return failure('RepositoryUnavailable');}
    }
    return failure('RepositoryUnavailable');
  }
}
