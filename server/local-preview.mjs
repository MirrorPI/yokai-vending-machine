import { createServer } from 'vite';
import { resolve } from 'node:path';
import { createLocalServer } from './local.mjs';
import { localAccountResponse } from './local-login.mjs';

// One explicit local-only command; no AWS clients or credentials are loaded.
const api=createLocalServer({directory:resolve('.account-local/manual'),testAuth:true});
let vite;
async function close(){await vite?.close();await new Promise(resolve=>{api.server.close(resolve);api.server.closeAllConnections();});}
try {
  await api.listen(5180);
  vite=await createServer({server:{host:'127.0.0.1',port:5174,strictPort:true},plugins:[{
    name:'local-account-login',configureServer(server){server.middlewares.use((req,res,next)=>{
      const result=localAccountResponse({url:req.url,host:req.headers.host,method:req.method});
      if(!result)return next();
      res.writeHead(result.status,{'Content-Type':result.type,'Cache-Control':'no-store','X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"});
      res.end(req.method==='HEAD'?'':result.body);
    });}
  }]});
  await vite.listen();
  console.log('Local test login: http://127.0.0.1:5174/local-login');
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void close().then(()=>process.exit(0)));
}catch(error){await close();throw error;}
