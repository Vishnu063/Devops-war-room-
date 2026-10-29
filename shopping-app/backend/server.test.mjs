import test from "node:test";
import assert from "node:assert/strict";
import {server} from "./server.mjs";
test("demo API returns catalog and refuses orders",async()=>{
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 try{
  const base="http://127.0.0.1:"+server.address().port;
  const catalog=await fetch(base+"/api/products?category=Tech");
  assert.equal(catalog.status,200);
  assert.equal((await catalog.json()).total,2);
  const quote=await fetch(base+"/api/checkout/quote",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({items:[{id:"p1",quantity:1,pricePaise:1}]})});
  assert.equal(quote.status,200);
  assert.equal((await quote.json()).totalPaise,849900);
  const forbidden=await fetch(base+"/api/orders");
  assert.equal(forbidden.status,403);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
