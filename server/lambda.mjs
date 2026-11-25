import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { createService } from './service.mjs';
import { createAwsAdapters } from './adapters/aws.mjs';
import { goodId } from './common.mjs';
import { createCodeVerifier } from './access-codes.mjs';
export function createCognitoVerifier({userPoolId,clientId}){
 if(!userPoolId||!clientId)throw new Error('Cognito configuration missing');
 return CognitoJwtVerifier.create({userPoolId,clientId,tokenUse:'access'});
}
/** Function URL authentication has no test-token or caller-authorizer bypass. */
export function createLambdaHandler({service,verifier,allowedOrigin,codeLogin=false}){
 if(!allowedOrigin||new URL(allowedOrigin).origin!==allowedOrigin||!allowedOrigin.startsWith('https://'))throw new Error('An exact HTTPS application origin is required');
 return async event=>{
  const headers=Object.fromEntries(Object.entries(event.headers??{}).map(([k,v])=>[k.toLowerCase(),v]));
  const cors={'content-type':'application/json','cache-control':'no-store','vary':'Origin',...(headers.origin===allowedOrigin?{'access-control-allow-origin':allowedOrigin,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'Authorization,Content-Type'}:{})};
  const reply=(statusCode,body)=>({statusCode,headers:cors,body:body===undefined?'':JSON.stringify(body)});
  if(headers.origin&&headers.origin!==allowedOrigin)return reply(403,{error:'origin_denied',message:'Origin not allowed'});
  const method=event.requestContext?.http?.method,path=event.rawPath;
  if(method==='OPTIONS')return headers.origin===allowedOrigin?reply(204):reply(403,{error:'origin_denied',message:'Origin not allowed'});
  let subject;
  if(!(method==='GET'&&path==='/health')){
   try {const match=/^Bearer ([^\s]+)$/.exec(headers.authorization??'');if(!match)throw new Error('Missing bearer token');const claims=await verifier.verify(match[1]);if(!goodId(claims.sub))throw new Error('Invalid subject');subject=claims.sub;}catch{return reply(401,{error:'unauthorized',message:'Valid access token required'});}
  }
  if(codeLogin&&method==='POST'&&path==='/v1/access/login')return reply(200,{sub:subject,expiresAt:Date.now()+8*60*60*1000});
  let body;
  try {if(event.body){const raw=event.isBase64Encoded?Buffer.from(event.body,'base64').toString('utf8'):event.body;if(Buffer.byteLength(raw)>750000)return reply(413,{error:'too_large',message:'Request exceeds limit'});body=JSON.parse(raw);}}catch{return reply(400,{error:'invalid_json',message:'Valid JSON required'});}
  const result=await service.handle({subject,method,path,query:event.queryStringParameters??{},body,requestId:event.requestContext?.requestId});return reply(result.statusCode,result.body);
 };
}
let configured;
export async function handler(event){
 try {const codeLogin=process.env.AUTH_MODE==='invite-code';configured??=createLambdaHandler({service:createService(createAwsAdapters()),
  verifier:codeLogin?createCodeVerifier(JSON.parse(process.env.ACCESS_CODE_HASHES??'null')):createCognitoVerifier({userPoolId:process.env.COGNITO_USER_POOL_ID,clientId:process.env.COGNITO_CLIENT_ID}),
  allowedOrigin:process.env.ALLOWED_ORIGIN,codeLogin});return await configured(event);}
 catch{return {statusCode:503,headers:{'content-type':'application/json','cache-control':'no-store'},body:JSON.stringify({error:'unavailable',message:'Account service unavailable'})};}
}
