import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'esbuild';
import { appTemplate, bootstrapTemplate } from './template.mjs';
const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function prepare() {
 const dir = path.join(root,'server-dist');
 await fs.mkdir(dir,{recursive:true});
 await build({entryPoints:[path.join(root,'server/lambda.mjs')],outfile:path.join(dir,'index.mjs'),bundle:true,
  platform:'node',target:'node24',format:'esm',minify:true,sourcemap:false,
  banner:{js:"import { createRequire as __createRequire } from 'node:module';const require=__createRequire(import.meta.url);"}});
 // zip one known file only; no env, credentials, test databases, or source snapshots.
 await fs.rm(path.join(dir,'lambda.zip'),{force:true});
 await exec('/usr/bin/zip',['-q','lambda.zip','index.mjs'],{cwd:dir});
 for(const [name,t] of [['bootstrap',bootstrapTemplate()],['app',appTemplate()],['app.feedback',appTemplate({feedback:true})]])
  await fs.writeFile(path.join(dir,`${name}.template.json`),JSON.stringify(t,null,2)+'\n');
 const bytes=await fs.readFile(path.join(dir,'lambda.zip'));
 const artifact={zip:path.join(dir,'lambda.zip'),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
 await fs.writeFile(path.join(dir,'artifact.json'),JSON.stringify(artifact,null,2)+'\n');
 return artifact;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try { console.log(JSON.stringify(await prepare(),null,2)); }
 catch(e){console.error(e.message);process.exitCode=1;}
}
