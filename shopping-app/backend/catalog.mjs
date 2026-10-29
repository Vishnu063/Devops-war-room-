// Fictional inventory only. Replace with persistent catalog before production.
export const products=Object.freeze([
{id:"p1",sku:"DEMO-HOME-001",name:"The Everyday Chair",category:"Home",pricePaise:849900,stock:15},
{id:"p2",sku:"DEMO-TECH-002",name:"Studio Headphones",category:"Tech",pricePaise:349900,stock:30},
{id:"p3",sku:"DEMO-LIFE-003",name:"Everyday Sneakers",category:"Lifestyle",pricePaise:299900,stock:25},
{id:"p4",sku:"DEMO-HOME-004",name:"Ceramic Accent Vase",category:"Home",pricePaise:129900,stock:40},
{id:"p5",sku:"DEMO-HOME-005",name:"Minimal Desk Lamp",category:"Home",pricePaise:219900,stock:18},
{id:"p6",sku:"DEMO-LIFE-006",name:"Classic Wristwatch",category:"Lifestyle",pricePaise:499900,stock:12},
{id:"p7",sku:"DEMO-TECH-007",name:"Wireless Essentials",category:"Tech",pricePaise:189900,stock:35},
{id:"p8",sku:"DEMO-HOME-008",name:"Soft Knit Throw",category:"Home",pricePaise:159900,stock:50}
]);
export function listProducts({search="",category="",sort="featured",page=1,limit=12}={}){
const q=String(search).trim().toLowerCase();const c=String(category).trim().toLowerCase();
let items=products.filter(p=>(!c||p.category.toLowerCase()===c)&&(!q||(p.name+" "+p.category+" "+p.sku).toLowerCase().includes(q)));
if(sort==="priceAsc")items.sort((a,b)=>a.pricePaise-b.pricePaise);else if(sort==="priceDesc")items.sort((a,b)=>b.pricePaise-a.pricePaise);else if(sort==="name")items.sort((a,b)=>a.name.localeCompare(b.name));
const total=items.length;return {items:items.slice((page-1)*limit,page*limit),total,page,limit,mode:"DEMO"};
}
export function quoteCart(lines){
if(!Array.isArray(lines)||lines.length<1||lines.length>50)throw new Error("Cart must contain 1–50 lines");
const seen=new Set();let subtotalPaise=0;const items=[];
for(const line of lines){
if(!line||typeof line.id!=="string"||!Number.isInteger(line.quantity)||line.quantity<1||line.quantity>99)throw new Error("Invalid cart line");
if(seen.has(line.id))throw new Error("Duplicate product");seen.add(line.id);
const p=products.find(x=>x.id===line.id);if(!p)throw new Error("Unknown product");
if(line.quantity>p.stock)throw new Error("Insufficient demo stock");
const lineTotalPaise=p.pricePaise*line.quantity;subtotalPaise+=lineTotalPaise;
items.push({id:p.id,sku:p.sku,name:p.name,quantity:line.quantity,unitPricePaise:p.pricePaise,lineTotalPaise});
}
const shippingPaise=subtotalPaise>=99900?0:7900;
return {items,subtotalPaise,shippingPaise,taxPaise:0,discountPaise:0,totalPaise:subtotalPaise+shippingPaise,currency:"INR",mode:"DEMO",notice:"Simulated quote only. No real orders or payments."};
}
