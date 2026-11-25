import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createSqliteAdapter } from '../server/adapters/sqlite.mjs';
import { initialState } from '../src/domain/state.ts';
test('backup CLI exports and restores a separate account with checksum and owner fence intact',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'yokai-backup-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));const db=createSqliteAdapter(join(dir,'state.sqlite'));const state=initialState();state.revision=1;state.settings.sound=true;state.observationOwner={sessionId:'tab',epoch:7};await db.commit('alice',0,state);db.close();
 const file=join(dir,'backup.json');
 const run=(action,subject)=>spawnSync(process.execPath,['--experimental-strip-types','server/backup-cli.mjs',action,'--adapter','local','--directory',dir,'--subject',subject,'--file',file],{encoding:'utf8'});
 const exported=run('export','alice');assert.equal(exported.status,0,exported.stderr);const archive=JSON.parse(await readFile(file,'utf8'));assert.equal(archive.state.settings.sound,true);
 const restored=run('restore','bob');assert.equal(restored.status,0,restored.stderr);const reopened=createSqliteAdapter(join(dir,'state.sqlite'));assert.equal((await reopened.read('bob')).observationOwner.epoch,7);reopened.close();
 assert.notEqual(run('restore','bob').status,0);
});
