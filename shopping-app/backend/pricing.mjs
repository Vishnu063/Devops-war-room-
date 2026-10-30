import {lines,money,fail,effectivePrice} from './validation.mjs';
export function totals(items,coupon=null,credit=0){
 let subtotalPaise=0;
 for(const item of items){item.unitPricePaise=money(item.pricePaise??item.unitPricePaise);item.lineTotalPaise=money(item.unitPricePaise*item.quantity);subtotalPaise=money(subtotalPaise+item.lineTotalPaise)}
 let discountPaise=0;
 if(coupon){if(subtotalPaise<money(coupon.minimum_paise))fail('Coupon minimum not reached');discountPaise=coupon.type==='PERCENT'?Number(BigInt(subtotalPaise)*BigInt(coupon.value)/100n):Math.min(coupon.value,subtotalPaise)}
 const shippingPaise=subtotalPaise>=99900?0:7900,totalPaise=money(subtotalPaise-discountPaise+shippingPaise),creditPaise=Math.min(money(credit),totalPaise);
 return {items,subtotalPaise,discountPaise,shippingPaise,taxPaise:0,totalPaise,creditPaise,payablePaise:totalPaise-creditPaise,currency:'INR',policy:'Development shipping/tax rules; prices in integer paise'};
}
export async function price(db,input,{lock=false,couponCode,credit=0}={}){
 const requested=lines(input);
 const found=await db.query(`SELECT v.id::text AS "variantId",v.sku,p.title AS name,${effectivePrice} AS "pricePaise",v.stock_on_hand-v.stock_reserved AS stock FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=ANY($1::uuid[]) AND v.active AND p.active ORDER BY v.id ${lock?'FOR UPDATE OF v':''}`,[requested.map(x=>x.variantId)]);
 const byId=new Map(found.rows.map(row=>[row.variantId,row]));
 const items=requested.map(line=>{const row=byId.get(line.variantId);if(!row)fail('Unknown or inactive variant');if(line.quantity>row.stock)fail('Insufficient stock',409);return {...row,quantity:line.quantity}});
 let coupon=null;
 if(couponCode){const r=await db.query(`SELECT * FROM coupons WHERE upper(code)=$1 AND active AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>now()) AND (usage_limit IS NULL OR usage_count<usage_limit) ${lock?'FOR UPDATE':''}`,[couponCode]);if(!r.rows.length)fail('Invalid or exhausted coupon');coupon=r.rows[0]}
 return {...totals(items,coupon,credit),couponId:coupon?.id||null};
}
// Largest-remainder allocation keeps discounts exact to a paise over all lines.
export function allocate(amount,weights){if(!weights.length)return [];const total=weights.reduce((a,b)=>a+BigInt(b),0n);if(total===0n)return weights.map(()=>0);const result=weights.map(w=>Number(BigInt(amount)*BigInt(w)/total));let left=amount-result.reduce((a,b)=>a+b,0);const indices=weights.map((w,i)=>({i,r:BigInt(amount)*BigInt(w)%total})).sort((a,b)=>a.r===b.r?a.i-b.i:a.r>b.r?-1:1);for(let i=0;i<left;i++)result[indices[i].i]++;return result}
