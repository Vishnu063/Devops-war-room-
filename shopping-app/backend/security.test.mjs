import test from "node:test";
import assert from "node:assert/strict";
import {checkRateLimit,verifySameOrigin,requireJson} from "./security.mjs";
test("rate limit blocks repeated attempts",()=>{
 const key="test-rate-"+Math.random();
 assert.equal(checkRateLimit(key,{max:1}).allowed,true);
 assert.equal(checkRateLimit(key,{max:1}).allowed,false);
});
test("origin must match host",()=>{
 assert.equal(verifySameOrigin({headers:{host:"localhost:3100",origin:"http://localhost:3100"}}),true);
 assert.equal(verifySameOrigin({headers:{host:"localhost:3100",origin:"http://example.com"}}),false);
});
test("JSON content type",()=>{
 assert.equal(requireJson({headers:{"content-type":"application/json"}}),true);
 assert.equal(requireJson({headers:{"content-type":"text/plain"}}),false);
});

test("origin validation rejects absent and malformed origins",()=>{
 assert.equal(verifySameOrigin({headers:{host:"localhost:3100"}}),false);
 assert.equal(verifySameOrigin({headers:{host:"localhost:3100",origin:"not-a-url"}}),false);
});
test("JSON content type allows charset parameter",()=>{
 assert.equal(requireJson({headers:{"content-type":"application/json; charset=utf-8"}}),true);
 assert.equal(requireJson({headers:{}}),false);
});

test("rate limiter resets after the configured window",()=>{
 const key="window-test-"+Math.random();
 assert.equal(checkRateLimit(key,{max:1,windowMs:0}).allowed,true);
 assert.equal(checkRateLimit(key,{max:1,windowMs:0}).allowed,true);
});
test("origin comparison rejects a different port",()=>{
 assert.equal(verifySameOrigin({headers:{host:"localhost:3100",origin:"http://localhost:3101"}}),false);
});
