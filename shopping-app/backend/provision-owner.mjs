import {transaction,closeDatabase} from "./db.mjs";
import {normalizeEmail} from "./auth.mjs";

async function provision(){
 if(process.env.CONFIRM_OWNER_PROVISION!=="yes")throw new Error("Confirmation required");
 if(process.env.NODE_ENV!=="development")throw new Error("Development mode required");
 if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL required");
 const email=normalizeEmail(process.env.OWNER_EMAIL);
 await transaction(async db=>{
  const found=await db.query("SELECT id,role FROM users WHERE lower(email)=$1 AND deleted_at IS NULL FOR UPDATE",[email]);
  if(found.rows.length!==1)throw new Error("Account not found");
  const user=found.rows[0];
  if(user.role==="OWNER")return;
  await db.query("UPDATE users SET role='OWNER' WHERE id=$1",[user.id]);
  await db.query("INSERT INTO audit_events(actor_id,action,entity_type,entity_id) VALUES($1,'OWNER_PROVISIONED','USER',$2)",[user.id,String(user.id)]);
 });
 console.log("Owner account provisioned");
}
provision().catch(e=>{console.error(e.message);process.exitCode=1}).finally(closeDatabase);
