import test from "node:test";
import assert from "node:assert/strict";
import {quoteDatabaseCart,findProducts} from "./repository.mjs";

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
