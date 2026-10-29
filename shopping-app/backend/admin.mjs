import {database,transaction} from "./db.mjs";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const slug=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function validateProduct(input){
 if(!input||typeof input!=="object"||Array.isArray(input))throw new Error("Invalid product");
 const {name,slug:productSlug,description="",categorySlug,sku,pricePaise,stock,active=false}=input;
 if(typeof name!=="string"||name.trim().length<3||name.trim().length>150)throw new Error("Invalid product name");
 if(typeof productSlug!=="string"||productSlug.length>100||!slug.test(productSlug))throw new Error("Invalid product slug");
 if(typeof description!=="string"||description.length>5000)throw new Error("Invalid description");
 if(typeof categorySlug!=="string"||categorySlug.length>80||!slug.test(categorySlug))throw new Error("Invalid category");
 if(typeof sku!=="string"||sku.length<3||sku.length>80||!/^[A-Z0-9_-]+$/.test(sku))throw new Error("Invalid SKU");
 if(!Number.isSafeInteger(pricePaise)||pricePaise<0||pricePaise>100000000000)throw new Error("Invalid price");
 if(!Number.isInteger(stock)||stock<0||stock>1000000)throw new Error("Invalid stock");
 if(typeof active!=="boolean")throw new Error("Invalid active flag");
 return {name:name.trim(),slug:productSlug,description,categorySlug,sku,pricePaise,stock,active};
}
export function validatePatch(input){
 if(!input||typeof input!=="object"||Array.isArray(input))throw new Error("Invalid update");
 const allowed=["name","description","pricePaise","stock","active"];
 if(Object.keys(input).length===0||Object.keys(input).some(key=>!allowed.includes(key)))throw new Error("Unsupported update");
 if("name" in input&&(typeof input.name!=="string"||input.name.trim().length<3||input.name.trim().length>150))throw new Error("Invalid name");
 if("description" in input&&(typeof input.description!=="string"||input.description.length>5000))throw new Error("Invalid description");
 if("pricePaise" in input&&(!Number.isSafeInteger(input.pricePaise)||input.pricePaise<0||input.pricePaise>100000000000))throw new Error("Invalid price");
 if("stock" in input&&(!Number.isInteger(input.stock)||input.stock<0||input.stock>1000000))throw new Error("Invalid stock");
 if("active" in input&&typeof input.active!=="boolean")throw new Error("Invalid active flag");
 return input;
}
export function validProductId(id){return uuid.test(id)}
export async function listAdminProducts(){
 const r=await database().query(`SELECT p.id::text,p.title AS name,p.slug,p.description,p.active,v.id::text AS "variantId",v.sku,v.price_paise AS "pricePaise",v.stock_on_hand AS stock,v.stock_reserved AS reserved FROM products p JOIN variants v ON v.product_id=p.id ORDER BY p.created_at DESC LIMIT 100`);
 return r.rows;
}
export async function createAdminProduct(input,actorId){
 const p=validateProduct(input);
 return transaction(async db=>{
  const category=await db.query("SELECT id FROM categories WHERE slug=$1",[p.categorySlug]);
  if(!category.rows.length)throw Object.assign(new Error("Category not found"),{status:404});
  const product=await db.query("INSERT INTO products(category_id,slug,title,description,active) VALUES($1,$2,$3,$4,$5) RETURNING id",[category.rows[0].id,p.slug,p.name,p.description,p.active]);
  const variant=await db.query("INSERT INTO variants(product_id,sku,price_paise,stock_on_hand) VALUES($1,$2,$3,$4) RETURNING id",[product.rows[0].id,p.sku,p.pricePaise,p.stock]);
  await db.query("INSERT INTO audit_events(actor_id,action,entity_type,entity_id) VALUES($1,'PRODUCT_CREATED','PRODUCT',$2)",[actorId,String(product.rows[0].id)]);
  return {id:product.rows[0].id,variantId:variant.rows[0].id,active:p.active};
 });
}
export async function updateAdminProduct(id,patch,actorId){
 if(!validProductId(id))throw Object.assign(new Error("Invalid product ID"),{status:400});
 const data=validatePatch(patch);
 return transaction(async db=>{
  const existing=await db.query("SELECT p.id,v.id AS variant_id,v.stock_reserved FROM products p JOIN variants v ON v.product_id=p.id WHERE p.id=$1 FOR UPDATE OF p,v",[id]);
  if(existing.rows.length>1)throw Object.assign(new Error("Multi-variant editing is not supported yet"),{status:409});
  if(!existing.rows.length)throw Object.assign(new Error("Product not found"),{status:404});
  if("stock" in data&&data.stock<existing.rows[0].stock_reserved)throw Object.assign(new Error("Stock cannot be below reserved inventory"),{status:409});
  const productUpdates=[],productValues=[];
  for(const [field,col] of [["name","title"],["description","description"],["active","active"]])if(field in data){productValues.push(field==="name"?data[field].trim():data[field]);productUpdates.push(col+"=$"+productValues.length)}
  if(productUpdates.length){productValues.push(id);await db.query("UPDATE products SET "+productUpdates.join(",")+",updated_at=now() WHERE id=$"+productValues.length,productValues)}
  const variantUpdates=[],variantValues=[];
  for(const [field,col] of [["pricePaise","price_paise"],["stock","stock_on_hand"]])if(field in data){variantValues.push(data[field]);variantUpdates.push(col+"=$"+variantValues.length)}
  if(variantUpdates.length){variantValues.push(existing.rows[0].variant_id);await db.query("UPDATE variants SET "+variantUpdates.join(",")+" WHERE id=$"+variantValues.length,variantValues)}
  await db.query("INSERT INTO audit_events(actor_id,action,entity_type,entity_id,details) VALUES($1,'PRODUCT_UPDATED','PRODUCT',$2,$3)",[actorId,id,JSON.stringify({fields:Object.keys(data)})]);
  return {id,updated:Object.keys(data)};
 });
}
