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
