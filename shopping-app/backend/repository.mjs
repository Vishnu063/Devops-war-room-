import {database} from "./db.mjs";
// Parameterized, read-only catalog access to the PostgreSQL schema.
// Prices are integer paise and are never accepted from the browser.
const baseSelect=`
 SELECT p.id::text AS id,p.slug,p.title AS name,p.description,
 c.name AS category,v.id::text AS variant_id,v.sku,v.price_paise AS "pricePaise",
 (v.stock_on_hand-v.stock_reserved) AS stock
 FROM products p
 JOIN variants v ON v.product_id=p.id
 LEFT JOIN categories c ON c.id=p.category_id
 WHERE p.active=TRUE AND v.active=TRUE
`;
export async function findProducts({search="",category="",sort="featured",page=1,limit=12}={}){
 if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(limit)||limit<1||limit>50)throw new Error("Invalid pagination");
 const q=String(search).trim().slice(0,120);
 const c=String(category).trim().slice(0,80);
 const params=[q,c];
 const where=` AND ($1='' OR p.title ILIKE '%'||$1||'%' OR v.sku ILIKE '%'||$1||'%')
 AND ($2='' OR lower(c.name)=lower($2))`;
 const order={featured:"p.created_at DESC",priceAsc:"v.price_paise ASC",priceDesc:"v.price_paise DESC",name:"p.title ASC"}[sort]||"p.created_at DESC";
 const count=await database().query(`SELECT count(*)::int AS total FROM products p JOIN variants v ON v.product_id=p.id LEFT JOIN categories c ON c.id=p.category_id WHERE p.active=TRUE AND v.active=TRUE${where}`,params);
 const rows=await database().query(`${baseSelect}${where} ORDER BY ${order},p.id,v.id LIMIT $3 OFFSET $4`,[...params,limit,(page-1)*limit]);
 return {items:rows.rows,total:count.rows[0].total,page,limit,mode:"DATABASE"};
}
export async function quoteDatabaseCart(lines){
 if(!Array.isArray(lines)||lines.length<1||lines.length>50)throw new Error("Cart must contain 1–50 lines");
 const seen=new Set(),requested=[];
 for(const line of lines){
  if(!line||typeof line.variantId!=="string"||!Number.isInteger(line.quantity)||line.quantity<1||line.quantity>99)throw new Error("Invalid cart line");
  if(line.variantId.length>80)throw new Error("Invalid cart line");
  if(seen.has(line.variantId))throw new Error("Duplicate variant");
  seen.add(line.variantId);requested.push(line.variantId);
 }
 const result=await database().query(`SELECT v.id::text AS id,v.sku,p.title AS name,v.price_paise AS "pricePaise",(v.stock_on_hand-v.stock_reserved) AS stock
 FROM variants v JOIN products p ON p.id=v.product_id
 WHERE v.id::text=ANY($1::text[]) AND v.active=TRUE AND p.active=TRUE`,[requested]);
 const byId=new Map(result.rows.map(row=>[row.id,row]));
 let subtotalPaise=0;const items=[];
 for(const line of lines){
  const p=byId.get(line.variantId);
  if(!p)throw new Error("Unknown or inactive variant");
  if(line.quantity>p.stock)throw new Error("Insufficient stock");
  const unit=Number(p.pricePaise);
  if(!Number.isSafeInteger(unit)||unit<0)throw new Error("Invalid stored price");
  const lineTotalPaise=unit*line.quantity;
  if(!Number.isSafeInteger(lineTotalPaise))throw new Error("Total too large");
  subtotalPaise+=lineTotalPaise;
  if(!Number.isSafeInteger(subtotalPaise))throw new Error("Total too large");
  items.push({variantId:p.id,sku:p.sku,name:p.name,quantity:line.quantity,unitPricePaise:unit,lineTotalPaise});
 }
 const shippingPaise=subtotalPaise>=99900?0:7900;
 if(!Number.isSafeInteger(subtotalPaise+shippingPaise))throw new Error("Total too large");
 return {items,subtotalPaise,shippingPaise,taxPaise:0,discountPaise:0,totalPaise:subtotalPaise+shippingPaise,currency:"INR",mode:"DATABASE_QUOTE_ONLY"};
}
