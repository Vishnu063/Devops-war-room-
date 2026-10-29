import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash} from "node:crypto";
import {promisify} from "node:util";
import {database} from "./db.mjs";
const scrypt=promisify(scryptCallback);
const DUMMY="scrypt$00000000000000000000000000000000$"+("00".repeat(64));
export function normalizeEmail(email){
 if(typeof email!=="string")throw new Error("Invalid email");
 const value=email.trim().toLowerCase();
 if(value.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw new Error("Invalid email");
 return value;
}
export function validatePassword(password){
 if(typeof password!=="string"||password.length<12||password.length>128)throw new Error("Password must contain 12–128 characters");
 return password;
}
export async function hashPassword(password){
 validatePassword(password);
 const salt=randomBytes(16).toString("hex");
 const derived=await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:32*1024*1024});
 return "scrypt$"+salt+"$"+derived.toString("hex");
}
export async function verifyPassword(password,stored){
 if(typeof password!=="string"||typeof stored!=="string")return false;
 const parts=stored.split("$");
 if(parts.length!==3||parts[0]!=="scrypt"||!/^[a-f0-9]{32}$/.test(parts[1])||!/^[a-f0-9]{128}$/.test(parts[2]))return false;
 const actual=await scrypt(password,parts[1],64,{N:16384,r:8,p:1,maxmem:32*1024*1024});
 return timingSafeEqual(actual,Buffer.from(parts[2],"hex"));
}
export function publicUser(user){return {id:user.id,email:user.email,name:user.name,role:user.role}}
export function requireRole(user,...allowed){if(!user||!allowed.includes(user.role))throw Object.assign(new Error("Forbidden"),{status:403})}
export function newSessionToken(){return randomBytes(32).toString("base64url")}
export function sessionDigest(token){return createHash("sha256").update(token).digest("hex")}
export async function registerCustomer({email,password,name}={}){
 const cleanEmail=normalizeEmail(email);const cleanPassword=validatePassword(password);
 if(typeof name!=="string"||name.trim().length<2||name.trim().length>100)throw new Error("Invalid name");
 const hashed=await hashPassword(cleanPassword);
 const result=await database().query("INSERT INTO users(email,password_hash,name,role) VALUES($1,$2,$3,'CUSTOMER') ON CONFLICT DO NOTHING RETURNING id,email,name,role",[cleanEmail,hashed,name.trim()]);
 if(!result.rows.length)throw Object.assign(new Error("Account already exists"),{status:409});
 return publicUser(result.rows[0]);
}
export async function authenticateCustomer({email,password}={}){
 const cleanEmail=normalizeEmail(email);
 if(typeof password!=="string")throw new Error("Invalid credentials");
 const result=await database().query("SELECT id,email,name,role,password_hash FROM users WHERE lower(email)=$1 AND deleted_at IS NULL LIMIT 1",[cleanEmail]);
 const user=result.rows[0];
 // Always perform a password hash verification on a miss to reduce timing differences.
 const stored=user?.password_hash||DUMMY;
 const valid=await verifyPassword(password,stored);
 if(!user||!valid)throw Object.assign(new Error("Invalid credentials"),{status:401});
 return publicUser(user);
}
