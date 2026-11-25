import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportAccount, restoreAccount } from './backup.mjs';
import { goodId } from './common.mjs';

export async function runBackup(argv){
 const [operation,...rest]=argv,options={};
 if(!['export','restore'].includes(operation)||rest.length%2)throw new Error('Usage: backup-cli.mjs export|restore --adapter local|aws --subject SUBJECT --file FILE [--directory LOCAL_DIR]');
 for(let at=0;at<rest.length;at+=2){const name=rest[at];if(!['--adapter','--subject','--file','--directory'].includes(name)||options[name]!==undefined)throw new Error('Unknown or repeated argument');options[name]=rest[at+1];}
 if(!goodId(options['--subject'])||!options['--file']||!['local','aws'].includes(options['--adapter']))throw new Error('Explicit adapter, subject and file are required');
 let adapters;
 if(options['--adapter']==='local'){
  if(!options['--directory'])throw new Error('Explicit local data directory is required');
  const {createSqliteAdapter}=await import('./adapters/sqlite.mjs');const {createFileObjects}=await import('./adapters/files.mjs');
  adapters={db:createSqliteAdapter(resolve(options['--directory'],'state.sqlite')),objects:createFileObjects(resolve(options['--directory'],'objects'))};
 }else{
  const {createAwsAdapters}=await import('./adapters/aws.mjs');let beforeMutation;
  if(operation==='restore'){const {checkAwsAccount}=await import('../infra/aws-preflight.mjs');beforeMutation=checkAwsAccount;await beforeMutation();}
  adapters=createAwsAdapters(process.env,{beforeMutation});
 }
 try {
  if(operation==='export'){const archive=await exportAccount({...adapters,subject:options['--subject']});await writeFile(resolve(options['--file']),JSON.stringify(archive),{flag:'wx',mode:0o600});return {status:'exported',records:archive.records.length,photos:archive.files.length};}
  const archive=JSON.parse(await readFile(resolve(options['--file']),'utf8'));await restoreAccount({...adapters,subject:options['--subject'],archive});return {status:'restored',records:archive.records.length,photos:archive.files.length};
 }finally{adapters.db.close?.();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{console.log(JSON.stringify(await runBackup(process.argv.slice(2))));}catch(e){console.error(e.message);process.exitCode=1;}}
