import {database} from "./db.mjs";
import {newSessionToken,sessionDigest,publicUser} from "./auth.mjs";
const ttlMs=7*24*60*60*1000;
export async function createSession(userId){
 const token=newSessionToken();
 await database().query("INSERT INTO user_sessions(user_id,token_sha256,expires_at) VALUES($1,$2,$3)",[userId,sessionDigest(token),new Date(Date.now()+ttlMs)]);
 return token;
}
export function parseSessionCookie(cookie){
 if(typeof cookie!=="string")return null;
 const match=cookie.match(/(?:^|;\s*)novacart_session=([A-Za-z0-9_-]{43})(?:;|$)/);
 return match?.[1]||null;
}
export function sessionCookie(token,{secure=true}={}){
 return "novacart_session="+token+"; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800"+(secure?"; Secure":"");
}
export function clearSessionCookie({secure=true}={}){
 return "novacart_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"+(secure?"; Secure":"");
}
export async function currentUser(req){
 const token=parseSessionCookie(req.headers.cookie);
 if(!token)return null;
 const result=await database().query(`SELECT u.id,u.email,u.name,u.role FROM user_sessions s
 JOIN users u ON u.id=s.user_id WHERE s.token_sha256=$1 AND s.revoked_at IS NULL
 AND s.expires_at>now() AND u.deleted_at IS NULL LIMIT 1`,[sessionDigest(token)]);
 return result.rows.length?publicUser(result.rows[0]):null;
}
export async function revokeSession(req){
 const token=parseSessionCookie(req.headers.cookie);
 if(token)await database().query("UPDATE user_sessions SET revoked_at=now() WHERE token_sha256=$1 AND revoked_at IS NULL",[sessionDigest(token)]);
}
