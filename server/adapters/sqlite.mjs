import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { initialState } from '../../src/domain/state.ts';

/** Each account state revision serializes state AND companion evidence updates. */
export function createSqliteAdapter(filename) {
 mkdirSync(dirname(filename),{recursive:true});
 const db=new DatabaseSync(filename);
 db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records(subject TEXT NOT NULL, sk TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(subject,sk));');
 const read=(subject,sk)=>{const row=db.prepare('SELECT data FROM records WHERE subject=? AND sk=?').get(subject,sk); return row ? JSON.parse(row.data) : undefined;};
 const put=(subject,sk,data)=>db.prepare('INSERT INTO records(subject,sk,data) VALUES(?,?,?) ON CONFLICT(subject,sk) DO UPDATE SET data=excluded.data').run(subject,sk,JSON.stringify(data));
 return {
  async read(subject) { return read(subject,'STATE') ?? initialState(); },
  async record(subject,sk) { return read(subject,sk); },
  async commit(subject, expectedRevision, state, records=[]) {
   db.exec('BEGIN IMMEDIATE');
   try { const current=read(subject,'STATE'); if((current?.revision??0)!==expectedRevision || records.some(r=>r.absent&&read(subject,r.key)!==undefined)) { db.exec('ROLLBACK'); return false; }
    put(subject,'STATE',state); for(const r of records) put(subject,r.key,r.value); db.exec('COMMIT'); return true;
   } catch(e) { db.exec('ROLLBACK'); throw e; }
  },
  async snapshot(subject) { db.exec('BEGIN'); try { const rows=db.prepare('SELECT sk,data FROM records WHERE subject=? ORDER BY sk').all(subject); const records=rows.map(r=>({key:r.sk,value:JSON.parse(r.data)})); db.exec('COMMIT'); return {state:records.find(r=>r.key==='STATE')?.value??initialState(),records:records.filter(r=>r.key!=='STATE')}; } catch(e) {db.exec('ROLLBACK');throw e;} },
  async restore(subject, state, records) { db.exec('BEGIN IMMEDIATE'); try { if(db.prepare('SELECT 1 FROM records WHERE subject=? LIMIT 1').get(subject)) throw new Error('Restore destination is occupied'); put(subject,'STATE',state); for(const r of records) put(subject,r.key,r.value); db.exec('COMMIT'); } catch(e) { db.exec('ROLLBACK'); throw e; } },
  close() { db.close(); },
 };
}
