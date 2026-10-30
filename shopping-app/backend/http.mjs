import {fail} from './validation.mjs';
export const headers={
 'cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY',
 'referrer-policy':'same-origin','permissions-policy':'camera=(), microphone=(), geolocation=()',
 'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
};
export function send(res,status,data){res.writeHead(status,{'content-type':'application/json; charset=utf-8',...headers,...(process.env.NODE_ENV==='production'?{'strict-transport-security':'max-age=31536000'}:{})});res.end(JSON.stringify(data))}
export async function readRaw(req,max=65536){const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>max)fail('Request too large');chunks.push(chunk)}return Buffer.concat(chunks)}
export async function readJson(req){if(req.headers['content-encoding'])fail('Encoded requests are not supported',415);try{const value=JSON.parse((await readRaw(req,16384)).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))fail('Invalid JSON');return value}catch(e){if(e.status)throw e;fail('Invalid JSON')}}
