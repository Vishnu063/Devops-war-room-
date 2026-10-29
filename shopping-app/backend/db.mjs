import pg from "pg";
const {Pool}=pg;
let pool;
export function database(){
  if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL is required for database operations");
  if(!pool)pool=new Pool({connectionString:process.env.DATABASE_URL,max:10,connectionTimeoutMillis:5000,idleTimeoutMillis:30000});
  return pool;
}
export async function transaction(work){
  const client=await database().connect();
  try{await client.query("BEGIN");const result=await work(client);await client.query("COMMIT");return result}
  catch(error){await client.query("ROLLBACK");throw error}
  finally{client.release()}
}
export async function closeDatabase(){if(pool){await pool.end();pool=undefined}}
