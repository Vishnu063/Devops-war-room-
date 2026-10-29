import {database,closeDatabase,transaction} from "./db.mjs";
import {products} from "./catalog.mjs";
// Explicitly gated seed for disposable development databases only.
// Uses stable slugs and SKUs to support repeatable updates.
async function seed(){
 if(process.env.CONFIRM_DEMO_SEED!=="yes")throw new Error("Set CONFIRM_DEMO_SEED=yes to seed a disposable development database");
 if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL required");
 await transaction(async client=>{
  for(const category of ["Home","Tech","Lifestyle"]){
   const slug=category.toLowerCase();
   await client.query("INSERT INTO categories(slug,name) VALUES($1,$2) ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name",[slug,category]);
  }
  for(const p of products){
   const slug="demo-"+p.sku.toLowerCase();
   const result=await client.query(`INSERT INTO products(category_id,slug,title,description,active)
   VALUES((SELECT id FROM categories WHERE slug=$1),$2,$3,'Fictional demonstration product. Not for sale.',TRUE)
   ON CONFLICT(slug) DO UPDATE SET title=EXCLUDED.title,category_id=EXCLUDED.category_id,description=EXCLUDED.description,active=TRUE
   RETURNING id`,[p.category.toLowerCase(),slug,p.name]);
   await client.query(`INSERT INTO variants(product_id,sku,price_paise,stock_on_hand,active)
   VALUES($1,$2,$3,$4,TRUE)
   ON CONFLICT(sku) DO UPDATE SET product_id=EXCLUDED.product_id,price_paise=EXCLUDED.price_paise,stock_on_hand=EXCLUDED.stock_on_hand,active=TRUE`,
   [result.rows[0].id,p.sku,p.pricePaise,p.stock]);
  }
 });
 console.log("Seeded "+products.length+" fictional demo products");
}
seed().catch(error=>{console.error(error.message);process.exitCode=1}).finally(closeDatabase);
