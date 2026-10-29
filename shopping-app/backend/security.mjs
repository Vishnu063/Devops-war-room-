// Development API protections. Use a shared rate-limit store before scaling.
const attempts=new Map();
export function checkRateLimit(key,{max=8,windowMs=15*60*1000}={}){
 const now=Date.now();
 if(attempts.size>10000){for(const [k,v] of attempts)if(v.reset<=now)attempts.delete(k)}
 const state=attempts.get(key);
 if(!state||state.reset<=now){attempts.set(key,{count:1,reset:now+windowMs});return {allowed:true,retryAfter:0}}
 state.count++;
 return {allowed:state.count<=max,retryAfter:Math.ceil((state.reset-now)/1000)};
}
export function verifySameOrigin(req){
 const origin=req.headers.origin;
 const host=req.headers.host;
 if(!origin||!host)return false;
 try{const u=new URL(origin);return (u.protocol==="https:"||u.protocol==="http:")&&u.host.toLowerCase()===host.toLowerCase()}catch{return false}
}
export function requireJson(req){return req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase()==="application/json"}
export function clientAddress(req){return req.socket.remoteAddress||"unknown"}
