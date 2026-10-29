import test from "node:test";
import assert from "node:assert/strict";
import {handleAdminProducts} from "./admin-routes.mjs";

test("unrelated route is not handled",async()=>{
 const result=await handleAdminProducts({method:"GET",headers:{}},"/api/health",async()=>({}));
 assert.equal(result,null);
});
test("admin product routes are disabled without a database",async()=>{
 const previous=process.env.DATABASE_URL;
 delete process.env.DATABASE_URL;
 try{
  const result=await handleAdminProducts({method:"GET",headers:{}},"/api/admin/products",async()=>({}));
  assert.equal(result.status,403);
 }finally{
  if(previous!==undefined)process.env.DATABASE_URL=previous;
 }
});
