// NovaCart development-only HTTP API. No production checkout, credentials or customer PII.
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {listProducts,products,quoteCart} from "./catalog.mjs";
import {findProducts,quoteDatabaseCart,findProduct,categories} from "./repository.mjs";
import {registerCustomer,authenticateCustomer,requireRole} from "./auth.mjs";
import {createSession,currentUser,revokeSession,sessionCookie,clearSessionCookie} from "./sessions.mjs";
import {checkRateLimit,databaseRateLimit,verifySameOrigin,requireJson,clientAddress} from "./security.mjs";
import {handleAdminProducts} from "./admin-routes.mjs";
import {send,readJson,headers as staticHeaders} from './http.mjs';
import {commerceRoutes} from './commerce-routes.mjs';
import {mergeGuest} from './shopping.mjs';
const port=Number(process.env.PORT||3100);
export const server=createServer(async(req,res)=>{
try{
const url=new URL(req.url,"http://localhost");const method=req.method;
const staticFiles={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/ui.js':'ui.js','/styles.css':'styles.css','/admin':'admin.html','/admin.html':'admin.html','/admin.css':'admin.css','/admin.js':'admin.js','/checkout-demo.html':'checkout-demo.html','/checkout-demo.js':'checkout-demo.js'};
if(method==='GET'&&(staticFiles[url.pathname]||/^\/assets\/[a-z-]+\.svg$/.test(url.pathname))){
 const name=staticFiles[url.pathname]||url.pathname.slice(1),bytes=await readFile(new URL('../'+name,import.meta.url));
 res.writeHead(200,{...staticHeaders,'content-type':name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8'});res.end(bytes);return;
}
if(url.pathname.startsWith("/api/auth/")){
 if(!process.env.DATABASE_URL)return send(res,403,{error:"Authentication requires a configured database"});
 if(method==="GET"&&url.pathname==="/api/auth/me"){const user=await currentUser(req);return user?send(res,200,{user}):send(res,401,{error:"Not authenticated"})}
 if(method==="POST"&&["/api/auth/register","/api/auth/login","/api/auth/logout"].includes(url.pathname)){
  if(!verifySameOrigin(req))return send(res,403,{error:"Cross-origin request denied"});
  if(!requireJson(req))return send(res,415,{error:"JSON required"});
  if(url.pathname!=="/api/auth/logout"){const rate=process.env.DATABASE_URL?await databaseRateLimit("auth:"+clientAddress(req)):checkRateLimit("auth:"+clientAddress(req));if(!rate.allowed)return send(res,429,{error:"Too many attempts"})}
  if(url.pathname==="/api/auth/logout"){await revokeSession(req);res.setHeader("Set-Cookie",clearSessionCookie({secure:process.env.NODE_ENV==="production"}));return send(res,200,{ok:true})}
  const body=await readJson(req);
  const user=url.pathname==="/api/auth/register"?await registerCustomer(body):await authenticateCustomer(body);
  await mergeGuest(req,user.id);
  const token=await createSession(user.id);
  res.setHeader("Set-Cookie",sessionCookie(token,{secure:process.env.NODE_ENV==="production"}));
  return send(res,url.pathname==="/api/auth/register"?201:200,{user});
 }
 return send(res,404,{error:"Not found"});
}
if(method==='GET'&&url.pathname==='/api/health'){
 if(process.env.DATABASE_URL){const {database}=await import('./db.mjs');await database().query('SELECT 1');}
 return send(res,200,{status:'ok',mode:process.env.DATABASE_URL?'DATABASE':'DEMO',commerce:!!process.env.DATABASE_URL});
}
if(method==='GET'&&url.pathname==='/api/categories'&&process.env.DATABASE_URL)return send(res,200,await categories());
const commerce=await commerceRoutes(req,res,url,readJson);
if(commerce){if(!commerce.sent)send(res,commerce.status,commerce.data);return;}

if(method==="GET"&&url.pathname==="/api/products"){const page=Number(url.searchParams.get("page")||1),limit=Number(url.searchParams.get("limit")||12);if(!Number.isInteger(page)||page<1||page>10000||!Number.isInteger(limit)||limit<1||limit>50)return send(res,400,{error:"Invalid pagination"});return send(res,200,process.env.DATABASE_URL?await findProducts({search:url.searchParams.get("search")||"",category:url.searchParams.get("category")||"",sort:url.searchParams.get("sort")||"featured",page,limit}):listProducts({search:url.searchParams.get("search")||"",category:url.searchParams.get("category")||"",sort:url.searchParams.get("sort")||"featured",page,limit}))}
if(!process.env.DATABASE_URL&&method==="GET"&&url.pathname.startsWith("/api/products/")){const id=decodeURIComponent(url.pathname.slice("/api/products/".length));const p=products.find(x=>x.id===id);return p?send(res,200,{...p,mode:"DEMO"}):send(res,404,{error:"Product not found"})}
if(method==="POST"&&url.pathname==="/api/checkout/quote"){if(!requireJson(req))return send(res,415,{error:"JSON required"});const body=await readJson(req);return send(res,200,process.env.DATABASE_URL?await quoteDatabaseCart(body?.items):quoteCart(body?.items))}
if(process.env.DATABASE_URL&&method==="GET"&&url.pathname.startsWith("/api/products/"))return send(res,200,await findProduct(decodeURIComponent(url.pathname.slice(14))));
if(method==="GET"&&url.pathname==="/api/admin/me"){if(!process.env.DATABASE_URL)return send(res,403,{error:"Database required"});const user=await currentUser(req);requireRole(user,"OWNER");return send(res,200,{user,mode:"READ_ONLY"})}
const adminResponse=await handleAdminProducts(req,url.pathname,readJson);
if(adminResponse)return send(res,adminResponse.status,adminResponse.data);
if(url.pathname.startsWith("/api/admin")||url.pathname==="/api/orders"||url.pathname.startsWith("/api/payments"))return send(res,403,{error:"Unavailable in demo mode"});
return send(res,404,{error:"Not found"});
}catch(e){const known=e instanceof Error&&(/^(Invalid|Unsupported|Cart |Duplicate |Unknown |Insufficient |Stock |Total |Request too large|Password must|Account already exists|Invalid credentials|Forbidden|Product not found|Category not found|Multi-variant editing)/.test(e.message));const status=e?.code==="23505"?409:Number.isInteger(e?.status)?e.status:known?400:500;const safe=status>=500?"Internal server error":e?.code==="23505"?"A record with this identifier already exists":e instanceof Error?e.message:"Bad request";return send(res,status,{error:safe})}
});
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])server.listen(port,"127.0.0.1",()=>console.log("NovaCart DEMO API on http://127.0.0.1:"+port));
