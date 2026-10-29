import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {database,closeDatabase} from "./db.mjs";
const migration=fileURLToPath(new URL("../data-model.sql",import.meta.url));
async function main(){
  if(process.env.CONFIRM_DEMO_SCHEMA!=="yes")throw new Error("Set CONFIRM_DEMO_SCHEMA=yes to apply the schema to a disposable development database");
  const sql=await readFile(migration,"utf8");
  const authSql=await readFile(new URL("./auth-schema.sql",import.meta.url),"utf8");
  const client=await database().connect();
  try{
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(8712301)");
    await client.query(sql);
    await client.query(authSql);
    await client.query("COMMIT");
    console.log("NovaCart base and session schemas applied to disposable development database");
  }catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
}
main().catch(error=>{console.error(error.message);process.exitCode=1}).finally(closeDatabase);
