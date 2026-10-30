import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {server} from '../server.mjs';
import {database,closeDatabase} from '../db.mjs';

if(process.env.NODE_ENV!=='test'||process.env.CONFIRM_TEST_DATABASE!=='yes'||!new URL(process.env.DATABASE_URL).pathname.startsWith('/novacart_test_'))throw new Error('Refusing integration tests without an explicitly disposable novacart_test_ database');
const cwd=new URL('../',import.meta.url);
let base;
const env={...process.env,NODE_ENV:'development',CONFIRM_DEMO_SCHEMA:'yes',CONFIRM_DEMO_SEED:'yes'};
function script(name,extra={}){return execFileSync(process.execPath,[name],{cwd,env:{...env,...extra},encoding:'utf8'})}
async function api(path,{method='GET',body,cookie,headers={}}={}){
 const response=await fetch(base+path,{method,headers:{Origin:base,...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};
}
before(async()=>{script('migrate.mjs');script('migrate.mjs');script('seed-demo.mjs');await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port});
after(async()=>{await new Promise(resolve=>server.close(resolve));await closeDatabase()});

test('Stage 2 real PostgreSQL registration, provisioning, ownership and audited product lifecycle',async()=>{
 const suffix=Date.now();
 const customer=await api('/api/auth/register',{method:'POST',body:{email:`customer-${suffix}@example.test`,password:'test-password-long-enough',name:'Test Customer',role:'OWNER'}});
 assert.equal(customer.status,201);assert.equal(customer.body.user.role,'CUSTOMER');assert.ok(customer.cookie);
 assert.equal((await api('/api/auth/me',{cookie:customer.cookie})).status,200);
 assert.equal((await api('/api/admin/products',{cookie:customer.cookie})).status,403);
 const email=`owner-${suffix}@example.test`;
 const owner=await api('/api/auth/register',{method:'POST',body:{email,password:'test-owner-password-long',name:'Test Owner'}});
 assert.equal(owner.status,201);
 script('provision-owner.mjs',{OWNER_EMAIL:email,CONFIRM_OWNER_PROVISION:'yes'});
 const login=await api('/api/auth/login',{method:'POST',body:{email,password:'test-owner-password-long'}});
 assert.equal(login.status,200);assert.equal(login.body.user.role,'OWNER');
 const input={name:'Acceptance Product',slug:'acceptance-'+suffix,categorySlug:'home',sku:'ACCEPT-'+suffix,pricePaise:12345,stock:3};
 const created=await api('/api/admin/products',{method:'POST',cookie:login.cookie,body:input});
 assert.equal(created.status,201);assert.equal(created.body.active,false);
 let catalog=await api('/api/products?search=Acceptance');assert.equal(catalog.body.total,0);
 const edit=await api('/api/admin/products/'+created.body.id,{method:'PATCH',cookie:login.cookie,body:{active:true,stock:5,pricePaise:15000}});
 assert.equal(edit.status,200);
 catalog=await api('/api/products?search=Acceptance');assert.equal(catalog.body.total,1);assert.equal(Number(catalog.body.items[0].pricePaise),15000);
 const quote=await api('/api/checkout/quote',{method:'POST',body:{items:[{variantId:created.body.variantId,quantity:2,pricePaise:1}]}});
 assert.equal(quote.status,200);assert.equal(quote.body.subtotalPaise,30000);
 const audits=await database().query('SELECT action FROM audit_events WHERE entity_id=$1',[created.body.id]);assert.deepEqual(audits.rows.map(r=>r.action).sort(),['PRODUCT_CREATED','PRODUCT_UPDATED']);
 assert.equal((await api('/api/admin/products/'+created.body.id,{method:'PATCH',cookie:customer.cookie,body:{stock:0}})).status,403);
 assert.equal((await api('/api/auth/logout',{method:'POST',cookie:login.cookie,body:{}})).status,200);
 assert.equal((await api('/api/admin/me',{cookie:login.cookie})).status,403);
 const versions=await database().query('SELECT version FROM schema_migrations ORDER BY version');assert.ok(versions.rows.length>=2);
});
