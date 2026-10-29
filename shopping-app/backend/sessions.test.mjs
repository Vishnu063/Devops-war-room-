import test from "node:test";import assert from "node:assert/strict";
import {parseSessionCookie,sessionCookie,clearSessionCookie} from "./sessions.mjs";
import {newSessionToken} from "./auth.mjs";
test("session cookie is HttpOnly and Secure",()=>{const t=newSessionToken();const cookie=sessionCookie(t);assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.equal(parseSessionCookie(cookie),t)});
test("cookie parser rejects malformed token",()=>{assert.equal(parseSessionCookie("novacart_session=bad"),null);assert.equal(parseSessionCookie(""),null)});
test("logout expires the cookie",()=>assert.match(clearSessionCookie(),/Max-Age=0/));
