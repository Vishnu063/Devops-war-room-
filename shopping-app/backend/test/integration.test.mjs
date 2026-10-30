import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {server} from '../server.mjs';
import {database,closeDatabase} from '../db.mjs';

if(process.env.NODE_ENV!=='test'||process.env.CONFIRM_TEST_DATABASE!=='yes'||!new URL(process.env.DATABASE_URL).pathname.startsWith('/novacart_test_'))throw new Error('Refusing integration tests without an explicitly disposable novacart_test_ database');
const cwd=new URL('../',import.meta.url);
let base,ownerCookie,customerCookie,customerId,productId,variantId;
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
 const input={name:'Acceptance '+suffix,slug:'acceptance-'+suffix,categorySlug:'home',sku:'ACCEPT-'+suffix,pricePaise:12345,stock:3};
 const created=await api('/api/admin/products',{method:'POST',cookie:login.cookie,body:input});
 ownerCookie=login.cookie;customerCookie=customer.cookie;customerId=customer.body.user.id;productId=created.body.id;variantId=created.body.variantId;
 assert.equal(created.status,201);assert.equal(created.body.active,false);
 let catalog=await api('/api/products?search='+encodeURIComponent(input.name));assert.equal(catalog.body.total,0);
 const edit=await api('/api/admin/products/'+created.body.id,{method:'PATCH',cookie:login.cookie,body:{active:true,stock:5,pricePaise:15000}});
 assert.equal(edit.status,200);
 catalog=await api('/api/products?search='+encodeURIComponent(input.name));assert.equal(catalog.body.total,1);assert.equal(Number(catalog.body.items[0].pricePaise),15000);
 const quote=await api('/api/checkout/quote',{method:'POST',body:{items:[{variantId:created.body.variantId,quantity:2,pricePaise:1}]}});
 assert.equal(quote.status,200);assert.equal(quote.body.subtotalPaise,30000);
 const audits=await database().query('SELECT action FROM audit_events WHERE entity_id=$1',[created.body.id]);assert.deepEqual(audits.rows.map(r=>r.action).sort(),['PRODUCT_CREATED','PRODUCT_UPDATED']);
 assert.equal((await api('/api/admin/products/'+created.body.id,{method:'PATCH',cookie:customer.cookie,body:{stock:0}})).status,403);
 assert.equal((await api('/api/auth/logout',{method:'POST',cookie:login.cookie,body:{}})).status,200);
 assert.equal((await api('/api/admin/me',{cookie:login.cookie})).status,403);
 const versions=await database().query('SELECT version FROM schema_migrations ORDER BY version');assert.ok(versions.rows.length>=2);ownerCookie=(await api('/api/auth/login',{method:'POST',body:{email,password:'test-owner-password-long'}})).cookie;
});

const shipping={recipient:'Fictional Customer',phone:'9876543210',line1:'12 Demo Lane',line2:'',city:'Bengaluru',state:'Karnataka',pincode:'560001'};

test('persistent guest cart/wishlist merge, encrypted addresses, immutable COD order, ownership and retry protection',async()=>{
 const guest=await api('/api/guest',{method:'POST',body:{}});assert.equal(guest.status,200);
 assert.equal((await api('/api/cart',{method:'PUT',cookie:guest.cookie,body:{variantId,quantity:2}})).status,200);
 assert.equal((await api('/api/wishlist/'+productId,{method:'PUT',cookie:guest.cookie,body:{}})).status,200);
 const email='merge-'+Date.now()+'@example.test';
 const merged=await api('/api/auth/register',{method:'POST',cookie:guest.cookie,body:{email,password:'test-merge-long-password',name:'Merge Test'}});
 assert.equal(merged.status,201);assert.equal((await api('/api/cart',{cookie:merged.cookie})).body.items[0].quantity,2);
 assert.equal((await api('/api/wishlist',{cookie:merged.cookie})).body.items.length,1);
 const address=await api('/api/addresses',{method:'POST',cookie:merged.cookie,body:shipping});assert.equal(address.status,201);
 const raw=await database().query('SELECT recipient,encrypted_payload FROM addresses WHERE id=$1',[address.body.id]);assert.equal(raw.rows[0].recipient,'[encrypted]');assert.ok(!JSON.stringify(raw.rows[0].encrypted_payload).includes('Demo Lane'));
 const quote=await api('/api/cart/quote',{method:'POST',cookie:merged.cookie,body:{}});assert.equal(quote.body.totalPaise,37900);
 const {randomUUID}=await import('node:crypto');const idempotency=randomUUID();
 const body={items:[{variantId,quantity:2,pricePaise:1}],addressId:address.body.id,paymentMethod:'COD'};
 const results=await Promise.all([1,2].map(()=>api('/api/orders',{method:'POST',cookie:merged.cookie,headers:{'Idempotency-Key':idempotency},body})));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);assert.equal(results[0].body.id,results[1].body.id);
 const id=results[0].body.id;
 const order=await api('/api/orders/'+id,{cookie:merged.cookie});assert.equal(order.status,200);assert.equal(order.body.totalPaise,37900);assert.equal(order.body.status,'CONFIRMED');assert.equal(order.body.address.line1,shipping.line1);
 assert.equal((await api('/api/orders/'+id,{cookie:customerCookie})).status,404);
 assert.equal((await api('/api/orders',{method:'POST',cookie:merged.cookie,headers:{'Idempotency-Key':idempotency},body:{...body,items:[{variantId,quantity:1}]}})).status,409);
 assert.equal((await api('/api/orders/'+id+'/cancel',{method:'POST',cookie:merged.cookie,body:{}})).status,200);
 assert.equal((await api('/api/orders/'+id+'/cancel',{method:'POST',cookie:merged.cookie,body:{}})).body.duplicate,true);
 assert.equal((await database().query('SELECT stock_reserved FROM variants WHERE id=$1',[variantId])).rows[0].stock_reserved,0);
 assert.equal((await api('/api/cart',{method:'PUT',cookie:merged.cookie,headers:{Origin:'http://evil.example'},body:{variantId,quantity:1}})).status,403);
});

test('two independent checkouts race for the last unit without overselling; cancellation releases exactly once',async()=>{
 const {createAdminProduct}=await import('../admin.mjs');const {randomUUID}=await import('node:crypto');
 const owner=(await database().query("SELECT id FROM users WHERE role='OWNER' LIMIT 1")).rows[0];
 const suffix=randomUUID().slice(0,8);const p=await createAdminProduct({name:'Last unit fixture',slug:'last-'+suffix,categorySlug:'home',sku:'LAST-'+suffix.toUpperCase(),pricePaise:10000,stock:1,active:true},owner.id);
 const guest=await api('/api/guest',{method:'POST',body:{}});
 const body={items:[{variantId:p.variantId,quantity:1}],address:shipping,paymentMethod:'COD'};
 const r=await Promise.all([customerCookie,guest.cookie].map(cookie=>api('/api/orders',{method:'POST',cookie,headers:{'Idempotency-Key':randomUUID()},body})));
 assert.deepEqual(r.map(x=>x.status).sort(),[201,409]);
 const stock=(await database().query('SELECT stock_on_hand,stock_reserved FROM variants WHERE id=$1',[p.variantId])).rows[0];assert.deepEqual(stock,{stock_on_hand:1,stock_reserved:1});
 const winner=r.findIndex(x=>x.status===201),cookie=winner===0?customerCookie:guest.cookie;
 await api('/api/orders/'+r[winner].body.id+'/cancel',{method:'POST',cookie,body:{}});
 assert.equal((await database().query('SELECT stock_reserved FROM variants WHERE id=$1',[p.variantId])).rows[0].stock_reserved,0);
});
