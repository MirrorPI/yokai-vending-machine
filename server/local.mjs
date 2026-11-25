import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createService } from './service.mjs';
import { createSqliteAdapter } from './adapters/sqlite.mjs';
import { createFileObjects } from './adapters/files.mjs';
import { goodId } from './common.mjs';
const loopbackOrigin=origin=>{try{const u=new URL(origin);return u.origin===origin&&u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname);}catch{return false;}};
export function createLocalServer({directory,testAuth=false}){
 if(testAuth!==true)throw new Error('Local server requires explicit ACCOUNT_TEST_AUTH=1; never use test authentication for deployment');
 const db=createSqliteAdapter(resolve(directory,'state.sqlite')),objects=createFileObjects(resolve(directory,'objects')),service=createService({db,objects});
 const server=createServer(async(req,res)=>{
  const origin=req.headers.origin;
  const reply=(statusCode,body)=>{res.writeHead(statusCode,{'content-type':'application/json','cache-control':'no-store','vary':'Origin',...(origin&&loopbackOrigin(origin)?{'access-control-allow-origin':origin,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'Authorization,Content-Type'}:{})});res.end(body===undefined?'':JSON.stringify(body));};
  if(!/^127\.0\.0\.1:\d+$/.test(req.headers.host??'')&&!/^localhost:\d+$/.test(req.headers.host??''))return reply(403,{error:'host_denied',message:'Loopback host required'});
  if(origin&&!loopbackOrigin(origin))return reply(403,{error:'origin_denied',message:'Loopback origin required'});
  if(req.method==='OPTIONS')return reply(204);
  const url=new URL(req.url,'http://127.0.0.1');
  const match=/^Bearer test:([^\s]+)$/.exec(req.headers.authorization??'');const subject=match?.[1];
  if(!(req.method==='GET'&&url.pathname==='/health')&&!goodId(subject))return reply(401,{error:'unauthorized',message:'Explicit loopback test token required'});
  let size=0;const chunks=[];
  try {for await(const chunk of req){size+=chunk.length;if(size>750000){reply(413,{error:'too_large',message:'Request exceeds limit'});return;}chunks.push(chunk);} const raw=Buffer.concat(chunks).toString();let body;if(raw){try{body=JSON.parse(raw);}catch{return reply(400,{error:'invalid_json',message:'Valid JSON required'});}}
   const result=await service.handle({subject,method:req.method,path:url.pathname,query:Object.fromEntries(url.searchParams),body});reply(result.statusCode,result.body);
  }catch{if(!res.headersSent)reply(503,{error:'unavailable',message:'Local request failed'});}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;server.maxHeadersCount=30;server.on('close',()=>db.close());
 return {server,async listen(port=5180){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});return `http://127.0.0.1:${server.address().port}`;}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const instance=createLocalServer({directory:process.env.ACCOUNT_DATA_DIR??resolve('.account-local'),testAuth:process.env.ACCOUNT_TEST_AUTH==='1'});
 console.log(`Local test account API: ${await instance.listen(Number(process.env.PORT??5180))}`);
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{instance.server.close(()=>process.exit(0));instance.server.closeAllConnections();});
}
