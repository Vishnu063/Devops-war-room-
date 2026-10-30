import test from "node:test";
import assert from "node:assert/strict";
import {quoteDatabaseCart,findProducts,findProductById} from "./repository.mjs";

test("database quote rejects empty carts without connecting",async()=>{
 await assert.rejects(quoteDatabaseCart([]),/Cart must contain/);
});
test("database quote rejects malformed variant identifiers without connecting",async()=>{
 await assert.rejects(quoteDatabaseCart([{variantId:"not-a-uuid",quantity:1}]),/Invalid cart line/);
});
test("database quote rejects repeated variant identifiers without connecting",async()=>{
 const id="123e4567-e89b-42d3-a456-426614174000";
 await assert.rejects(quoteDatabaseCart([{variantId:id,quantity:1},{variantId:id,quantity:2}]),/Duplicate variant/);
});
test("database quote rejects invalid quantities without connecting",async()=>{
 await assert.rejects(quoteDatabaseCart([{variantId:"123e4567-e89b-42d3-a456-426614174000",quantity:0}]),/Invalid cart line/);
});
test("catalog rejects invalid pagination without connecting",async()=>{
 await assert.rejects(findProducts({page:0}),/Invalid pagination/);
 await assert.rejects(findProducts({limit:51}),/Invalid pagination/);
});

test("database quote rejects carts with more than 50 lines",async()=>{
 const lines=Array.from({length:51},(_,i)=>({variantId:"123e4567-e89b-42d3-a456-426614174000",quantity:i+1}));
 await assert.rejects(quoteDatabaseCart(lines),/Cart must contain/);
});
test("database quote rejects fractional quantities",async()=>{
 await assert.rejects(quoteDatabaseCart([{variantId:"123e4567-e89b-42d3-a456-426614174000",quantity:1.5}]),/Invalid cart line/);
});

test("product detail rejects malformed IDs before querying the database",async()=>{
 await assert.rejects(findProductById("not-a-uuid"),/Invalid product ID/);
 await assert.rejects(findProductById(""),/Invalid product ID/);
 await assert.rejects(findProductById(null),/Invalid product ID/);
});
