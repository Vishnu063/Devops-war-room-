import test from "node:test";
import assert from "node:assert/strict";
import {validateProduct,validatePatch,validProductId} from "./admin.mjs";
const item={name:"Demo chair",slug:"demo-chair",categorySlug:"home",sku:"DEMO-001",pricePaise:10000,stock:4};
test("valid product",()=>assert.equal(validateProduct(item).sku,"DEMO-001"));
test("reject negative stock",()=>assert.throws(()=>validateProduct({...item,stock:-1})));
test("reject fractional price",()=>assert.throws(()=>validateProduct({...item,pricePaise:12.5})));
test("reject role changes",()=>assert.throws(()=>validatePatch({role:"OWNER"})));
test("reject invalid product ID",()=>assert.equal(validProductId("invalid"),false));

test("reject empty product patch",()=>assert.throws(()=>validatePatch({})));
test("reject reserved inventory edits",()=>assert.throws(()=>validatePatch({reserved:0})));
test("reject malformed stock update",()=>assert.throws(()=>validatePatch({stock:-1})));

test("valid publish toggle",()=>assert.equal(validatePatch({active:true}).active,true));
test("reject nonboolean publish toggle",()=>assert.throws(()=>validatePatch({active:"true"})));

test("new products default to draft",()=>assert.equal(validateProduct(item).active,false));
test("new products can be published",()=>assert.equal(validateProduct({...item,active:true}).active,true));
test("reject nonboolean initial publication",()=>assert.throws(()=>validateProduct({...item,active:"true"})));

test("reject unsafe integer product prices",()=>assert.throws(()=>validateProduct({...item,pricePaise:Number.MAX_SAFE_INTEGER})));
test("reject excessive product stock",()=>assert.throws(()=>validateProduct({...item,stock:1000001})));
test("reject invalid product SKU characters",()=>assert.throws(()=>validateProduct({...item,sku:"demo sku"})));
test("reject unsupported price patch types",()=>assert.throws(()=>validatePatch({pricePaise:"10000"})));
test("reject product ID with invalid UUID version",()=>assert.equal(validProductId("123e4567-e89b-02d3-a456-426614174000"),false));
