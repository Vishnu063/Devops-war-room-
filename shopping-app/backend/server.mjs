// NovaCart development-only HTTP API. No production checkout, credentials or customer PII.
import {createServer} from "node:http";
import {fileURLToPath} from "node:url";
import {listProducts,products,quoteCart} from "./catalog.mjs";
import {findProducts,quoteDatabaseCart} from "./repository.mjs";
const port=Number(process.env.PORT||3100);
const maxBytes=16*1024;
function send(res,status,data){const body=JSON.stringify(data);res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","x-frame-options":"DENY","content-security-policy":"default-src 'none'"});res.end(body)}
async function readJson(req){let text="";for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>maxBytes)throw new Error("Request too large")}try{return JSON.parse(text)}catch{throw new Error("Invalid JSON")}}
export const server=createServer(async(req,res)=>{
try{
const url=new URL(req.url,"http://localhost");const method=req.method;
if(method==="GET"&&url.pathname==="/api/health")return send(res,200,{status:"ok",mode:"DEMO"});
if(method==="GET"&&url.pathname==="/api/products"){const page=Number(url.searchParams.get("page")||1),limit=Number(url.searchParams.get("limit")||12);if(!Number.isInteger(page)||page<1||page>10000||!Number.isInteger(limit)||limit<1||limit>50)return send(res,400,{error:"Invalid pagination"});return send(res,200,process.env.DATABASE_URL?await findProducts({search:url.searchParams.get("search")||"",category:url.searchParams.get("category")||"",sort:url.searchParams.get("sort")||"featured",page,limit}):listProducts({search:url.searchParams.get("search")||"",category:url.searchParams.get("category")||"",sort:url.searchParams.get("sort")||"featured",page,limit}))}
if(!process.env.DATABASE_URL&&method==="GET"&&url.pathname.startsWith("/api/products/")){const id=decodeURIComponent(url.pathname.slice("/api/products/".length));const p=products.find(x=>x.id===id);return p?send(res,200,{...p,mode:"DEMO"}):send(res,404,{error:"Product not found"})}
if(method==="POST"&&url.pathname==="/api/checkout/quote"){const body=await readJson(req);return send(res,200,process.env.DATABASE_URL?await quoteDatabaseCart(body?.items):quoteCart(body?.items))}
if(process.env.DATABASE_URL&&method==="GET"&&url.pathname.startsWith("/api/products/"))return send(res,404,{error:"Use catalog endpoint for database products"});
if(url.pathname.startsWith("/api/admin")||url.pathname==="/api/orders"||url.pathname.startsWith("/api/payments"))return send(res,403,{error:"Unavailable in demo mode"});
return send(res,404,{error:"Not found"});
}catch(e){return send(res,400,{error:e instanceof Error?e.message:"Bad request"})}
});
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])server.listen(port,"127.0.0.1",()=>console.log("NovaCart DEMO API on http://127.0.0.1:"+port));
