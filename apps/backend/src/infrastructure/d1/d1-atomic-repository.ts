import type { AtomicRepository, CoreState } from '../../application/ports.js';
import type { Result } from '../../domain/core.js';
import { failure, success } from '../../domain/core.js';
import { sameFact } from '../../domain/provenance.js';
import { pack, unpack, codecVersion, CodecError } from './d1-codec.js';
import { stateTables, project, materialize } from './d1-projection.js';
import type { Row, Table, Projection } from './d1-projection.js';
import {assertD1Row,assertD1Values,D1CapacityError} from './d1-limits.js';
import type {D1Value} from './d1-limits.js';

// Structural subset shared by D1 and the Node SQLite integration harness.
export interface Statement { bind(...values:D1Value[]):Statement }
export interface Database {
  prepare(sql:string):Statement;
  batch(statements:Statement[]):Promise<{success:boolean;results:Row[]}[]>;
}
export class RepositoryError extends Error {
  constructor(readonly code:'RepositoryUnavailable'|'RepositoryOutcomeUnknown'='RepositoryUnavailable') {super(code);}
}
const keys:Partial<Record<Table,readonly string[]>>={user_identities:['method','subject'],catalog_texts:['catalog_key','text_id'],
  catalog_items:['catalog_key','item_type','item_id'],translation_corrections:['old_catalog_key','text_id'],threshold_history:['master_id','version'],
  hidden_history:['user_id','role','job_id'],notification_preferences:['user_id','role'],retention_records:['fact_id','record_kind']};
const appendOnly=new Set<Table>(['consumed_claims','policies','refusal_records','inbox_messages','ledger_entries','domain_events']);
export interface Snapshot {state:CoreState;rows:Projection;revision:number;receipts:Row[]}
export class D1AtomicRepository implements AtomicRepository {
  // 32 optimistic attempts bound contention without exposing F2 StaleRevision.
  constructor(readonly db:Database, readonly attempts=32) {
    if(!Number.isSafeInteger(attempts)||attempts<1||attempts>128)throw new Error('Invalid retry bound');
  }
  prepare(sql:string,values:readonly D1Value[]=[]):Statement {
    assertD1Values(values);
    const statement=this.db.prepare(sql);return values.length?statement.bind(...values):statement;
  }
  async snapshot(operationId=''):Promise<Snapshot> {
    try {
      const result=await this.db.batch([this.db.prepare("SELECT * FROM repository_meta WHERE id='core'"),
        ...stateTables.map(t=>this.db.prepare(`SELECT * FROM ${t}`)),
        this.prepare('SELECT * FROM operation_receipts WHERE operation_id=? ORDER BY chunk_index',[operationId])]);
      if(result.length!==stateTables.length+2||result.some(r=>!r.success))throw new RepositoryError();
      const meta=result[0]!.results;
      if(meta.length!==1||meta[0]!.codec_version!==codecVersion||!Number.isSafeInteger(meta[0]!.revision)||Number(meta[0]!.revision)<0||meta[0]!.commit_token!==null)throw new CodecError();
      const rows=Object.fromEntries(stateTables.map((table,i)=>[table,result[i+1]!.results.map(row=>({...row}))])) as Projection;
      return {state:materialize(rows),rows,revision:Number(meta[0]!.revision),receipts:result.at(-1)!.results};
    }catch {throw new RepositoryError();}
  }
  async read():Promise<CoreState> {return (await this.snapshot()).state;}
  receipt<T>(rows:Row[],actor:string,signature:string):Result<T>|null {
    if(!rows.length)return null;
    if(rows.some((r,i)=>r.chunk_index!==i||r.chunk_count!==rows.length||r.codec_version!==codecVersion||r.actor_id!==rows[0]!.actor_id||r.signature!==rows[0]!.signature||typeof r.payload_chunk!=='string'))throw new RepositoryError();
    if(rows[0]!.actor_id!==actor||rows[0]!.signature!==signature)return failure('Conflict');
    let result:Result<T>;try{result=unpack<Result<T>>(rows.map(r=>r.payload_chunk).join(''));}catch{throw new RepositoryError();}
    if(!result||result.ok!==true||!Object.hasOwn(result,'value')||Object.keys(result).length!==2)throw new RepositoryError();
    return result;
  }
  async replay<T>(id:string,actor:string,signature:string,access:(s:CoreState)=>Result<void>):Promise<Result<T>|null> {
    const s=await this.snapshot(id),allowed=access(structuredClone(s.state));
    return allowed.ok?this.receipt<T>(s.receipts,actor,signature):allowed;
  }
  guard(revision:number,token:string):Statement {
    return this.prepare("UPDATE repository_meta SET revision=revision+1,commit_token=? WHERE id='core' AND revision=? AND codec_version=?",[token,revision,codecVersion]);
  }
  end(token:string):Statement[] {return [
    this.prepare("UPDATE repository_meta SET revision=CASE WHEN commit_token=? THEN revision ELSE -1 END WHERE id='core'",[token]),
    this.prepare("UPDATE repository_meta SET commit_token=NULL WHERE id='core' AND commit_token=?",[token])];}
  diff(before:Projection,after:Projection):Statement[] {
    const deletes:Statement[]=[],inserts:Statement[]=[],updates:Statement[]=[],earlyUpdates:Statement[]=[],sizes=new Map<string,number>();
    for(const table of stateTables) {
      const columns=keys[table]??[Object.keys(before[table][0]??after[table][0]??{})[0]!];
      const key=(r:Row)=>pack(columns.map(c=>r[c]));
      const old=new Map(before[table].map(r=>[key(r),r])),next=new Map(after[table].map(r=>[key(r),r]));
      // UPDATE validation uses the complete resulting row, not only changed fields.
      for(const [id,row] of next)if(!old.has(id)||!sameFact(row,old.get(id)))assertD1Row(row,sizes);
      for(const [id,row] of old)if(!next.has(id)||!sameFact(row,next.get(id))) {
        if(appendOnly.has(table))throw new RepositoryError();
        const replacement=next.get(id);
        if(replacement&&row.position===replacement.position) {
          const changed=Object.keys(replacement).filter(c=>!columns.includes(c)&&!Object.is(row[c],replacement[c]));
          const update=this.prepare(`UPDATE ${table} SET ${changed.map(c=>`${c}=?`).join(',')} WHERE ${columns.map(c=>`${c}=?`).join(' AND ')}`,
            [...changed.map(c=>replacement[c]!),...columns.map(c=>row[c]!)]);
          (table==='catalog_revisions'&&row.is_current===1&&replacement.is_current===0?earlyUpdates:updates).push(update);
        }else deletes.push(this.prepare(`DELETE FROM ${table} WHERE ${columns.map(c=>`${c}=?`).join(' AND ')}`,columns.map(c=>row[c]!)));
      }
      for(const [id,row] of next)if(!old.has(id)||!sameFact(row,old.get(id))) {
        if(old.has(id)&&old.get(id)!.position===row.position)continue;
        const cols=Object.keys(row);
        inserts.push(this.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`,cols.map(c=>row[c]!)));
      }
    }
    return [this.db.prepare('PRAGMA defer_foreign_keys=ON'),...earlyUpdates,...deletes.reverse(),...updates,...inserts];
  }
  receiptStatements(id:string,actor:string,signature:string,result:Result<unknown>):Statement[] {
    assertD1Row({operation_id:id,actor_id:actor,signature,chunk_index:0,chunk_count:1,payload_chunk:'',codec_version:codecVersion});
    const payload=pack(result),chunks:string[]=[],sizes=new Map<string,number>();
    for(let i=0;i<payload.length;){let end=Math.min(i+8192,payload.length);const last=payload.charCodeAt(end-1);if(end<payload.length&&last>=0xd800&&last<=0xdbff)end--;chunks.push(payload.slice(i,end));i=end;}
    return chunks.map((chunk,index)=>{
      const row={operation_id:id,chunk_index:index,actor_id:actor,signature,chunk_count:chunks.length,payload_chunk:chunk,codec_version:codecVersion};
      assertD1Row(row,sizes);
      return this.prepare('INSERT INTO operation_receipts (operation_id,chunk_index,actor_id,signature,chunk_count,payload_chunk,codec_version) VALUES (?,?,?,?,?,?,?)',Object.values(row));
    });
  }
  async transact<T>(id:string,actor:string,signature:string,replay:'return'|'reject',update:(s:CoreState)=>Result<T>,access?:(s:CoreState)=>Result<void>):Promise<Result<T>> {
    for(let attempt=0;attempt<this.attempts;attempt++) {
      let s:Snapshot;try{s=await this.snapshot(id);}catch{return failure('RepositoryUnavailable');}
      if(access) {const allowed=access(structuredClone(s.state));if(!allowed.ok)return structuredClone(allowed);}
      const old=this.receipt<T>(s.receipts,actor,signature);if(old!==null)return replay==='return'?old:failure('Conflict');
      const working=structuredClone(s.state),result=update(working);if(!result.ok)return structuredClone(result);
      const next=project(working),token=crypto.randomUUID();
      let statements:Statement[];
      try{
        // Apply physical bounds before duplicating payloads for round-trip validation.
        const diff=this.diff(s.rows,next),receipts=this.receiptStatements(id,actor,signature,result);
        if(!sameFact(working,materialize(next)))throw new RepositoryError();
        statements=[this.guard(s.revision,token),...diff,...receipts,...this.end(token)];
      }
      catch(error){if(error instanceof D1CapacityError)return failure('RepositoryUnavailable');throw error;}
      try {
        const committed=await this.db.batch(statements);
        if(committed.length!==statements.length||committed.some(r=>!r.success))throw new RepositoryError('RepositoryOutcomeUnknown');
        return structuredClone(result);
      }catch {
        let confirmed:Snapshot;try{confirmed=await this.snapshot(id);}catch{return failure('RepositoryOutcomeUnknown');}
        if(access) {const allowed=access(structuredClone(confirmed.state));if(!allowed.ok)return allowed;}
        const saved=this.receipt<T>(confirmed.receipts,actor,signature);if(saved!==null)return saved;
        if(confirmed.revision===s.revision)return failure('RepositoryUnavailable');
      }
    }
    return failure('RepositoryUnavailable');
  }
  async claimDelivery(id:string):Promise<Result<boolean>> {
    for(let attempt=0;attempt<this.attempts;attempt++) {
      let s:Snapshot;try{s=await this.snapshot();}catch{return failure('RepositoryUnavailable');}
      if(!Object.hasOwn(s.state.deliveries,id)||s.state.deliveries[id]!.status!=='requested')return success(false);
      const token=crypto.randomUUID();
      try{assertD1Row({...s.rows.deliveries.find(row=>row.delivery_id===id)!,status:'pending'});}catch(error){if(error instanceof D1CapacityError)return failure('RepositoryUnavailable');throw error;}
      try {
        const statements=[this.guard(s.revision,token),this.prepare("UPDATE deliveries SET status='pending' WHERE delivery_id=? AND status='requested'",[id]),...this.end(token)];
        const r=await this.db.batch(statements);if(r.length!==statements.length||r.some(x=>!x.success))throw new RepositoryError();return success(true);
      }catch(error) {
        let current:Snapshot;try{current=await this.snapshot();}catch{return failure('RepositoryOutcomeUnknown');}
        if(error instanceof Error&&/CHECK constraint failed:.*revision/i.test(error.message))continue;
        // A lost acknowledgement must never authorize a second external send.
        if(current.state.deliveries[id]?.status!=='requested')return failure('RepositoryOutcomeUnknown');
        if(current.revision===s.revision)return failure('RepositoryUnavailable');
      }
    }
    return failure('RepositoryUnavailable');
  }
}
