import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export const migration = readFileSync(new URL('../migrations/0001_f3_base.sql',import.meta.url),'utf8');
export class LocalDatabase {
  constructor(path=':memory:') {this.sqlite=new DatabaseSync(path);this.sqlite.exec('PRAGMA foreign_keys=ON');this.sqlite.exec(migration);this.loseAck=false;this.fail=false;}
  prepare(sql) {return {sql,values:[],bind(...values){return {...this,values};}};}
  async batch(statements) {
    await Promise.resolve();
    if(this.fail)throw new Error('injected outage');
    this.sqlite.exec('BEGIN');
    try {
      const result=statements.map(s=>({success:true,results:this.sqlite.prepare(s.sql).all(...s.values)}));
      this.sqlite.exec('COMMIT');
      if(this.loseAck&&statements.some(s=>s.sql.startsWith('UPDATE repository_meta'))){this.loseAck=false;throw new Error('injected lost acknowledgement');}
      return result;
    }catch(error){if(this.sqlite.isTransaction)this.sqlite.exec('ROLLBACK');throw error;}
  }
}
