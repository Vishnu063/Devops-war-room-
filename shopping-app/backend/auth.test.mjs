import test from "node:test";
import assert from "node:assert/strict";
import {normalizeEmail,validatePassword,hashPassword,verifyPassword,requireRole,newSessionToken,sessionDigest,publicUser} from "./auth.mjs";
test("email normalization and validation",()=>{assert.equal(normalizeEmail("  TEST@Example.com "),"test@example.com");assert.throws(()=>normalizeEmail("not-an-email"))});
test("password length enforced",()=>{assert.throws(()=>validatePassword("short"));assert.equal(validatePassword("long-demo-password"),"long-demo-password")});
test("scrypt hash verifies and salts differently",async()=>{const a=await hashPassword("a strong demo password");const b=await hashPassword("a strong demo password");assert.notEqual(a,b);assert.equal(await verifyPassword("a strong demo password",a),true);assert.equal(await verifyPassword("wrong",a),false)});
test("malformed hash rejected",async()=>assert.equal(await verifyPassword("anything","bad"),false));
test("role check denies customer owner operations",()=>{assert.throws(()=>requireRole({role:"CUSTOMER"},"OWNER"));assert.doesNotThrow(()=>requireRole({role:"OWNER"},"OWNER"))});
test("session token is random and hashed for storage",()=>{const a=newSessionToken(),b=newSessionToken();assert.notEqual(a,b);assert.equal(sessionDigest(a).length,64);assert.notEqual(sessionDigest(a),sessionDigest(b))});
test("public profile excludes password hash",()=>{assert.deepEqual(publicUser({id:"1",email:"demo@example.com",name:"Demo",role:"CUSTOMER",password_hash:"secret"}),{id:"1",email:"demo@example.com",name:"Demo",role:"CUSTOMER"})});

test("dummy digest still performs password verification",async()=>{const dummy="scrypt$00000000000000000000000000000000$"+("00".repeat(64));assert.equal(await verifyPassword("unknown-account-password",dummy),false)});

test("missing registration body returns validation error",async()=>{const {registerCustomer}=await import("./auth.mjs");await assert.rejects(registerCustomer(),/Invalid email/)});
test("missing login body returns validation error",async()=>{const {authenticateCustomer}=await import("./auth.mjs");await assert.rejects(authenticateCustomer(),/Invalid email/)});
