import {database} from './db.mjs';
import {principal,requireActor,guest,cart,changeCart,wishlist,changeWish,addresses,saveAddress} from './shopping.mjs';
import {quote,createOrder,getOrder,listOrders,cancelOrder,expireReservations} from './commerce.mjs';
import {verifySameOrigin,requireJson,databaseRateLimit,clientAddress} from './security.mjs';
import {fail,uuid} from './validation.mjs';

export async function commerceRoutes(req,res,url,readJson){
 const path=url.pathname,method=req.method;
 if(!['/api/guest','/api/cart','/api/cart/quote','/api/wishlist','/api/addresses','/api/orders'].includes(path)&&!/^\/api\/(orders|wishlist|addresses)\//.test(path))return null;
 if(!process.env.DATABASE_URL)return {status:403,data:{error:'Database required'}};
 if(!['GET','HEAD'].includes(method)){
  if(!verifySameOrigin(req))fail('Cross-origin request denied',403);if(!requireJson(req))fail('JSON required',415);
  const rate=await databaseRateLimit('commerce:'+clientAddress(req),{max:200,windowMs:60000});if(!rate.allowed)fail('Too many requests',429);
 }
 if(path==='/api/guest'&&method==='POST'){
  if(!await principal(req)){const token=await guest();res.setHeader('Set-Cookie',`novacart_guest=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.NODE_ENV==='production'?'; Secure':''}`)}
  return {status:200,data:{ok:true}};
 }
 const actor=requireActor(await principal(req));
 if(path==='/api/cart'&&method==='GET')return {status:200,data:await cart(actor)};
 if(path==='/api/cart'&&method==='PUT')return {status:200,data:await changeCart(actor,await readJson(req))};
 if(path==='/api/cart/quote'&&method==='POST')return {status:200,data:await quote(actor,await readJson(req))};
 if(path==='/api/wishlist'&&method==='GET')return {status:200,data:await wishlist(actor)};
 if(/^\/api\/wishlist\/[^/]+$/.test(path)&&['PUT','DELETE'].includes(method))return {status:200,data:await changeWish(actor,path.split('/')[3],method==='DELETE')};
 if(path==='/api/addresses'&&method==='GET')return {status:200,data:await addresses(actor)};
 if(path==='/api/addresses'&&method==='POST')return {status:201,data:await saveAddress(actor,await readJson(req))};
 if(/^\/api\/addresses\/[^/]+$/.test(path)&&method==='DELETE'){if(actor.kind!=='user')fail('Sign in required',401);await database().query('DELETE FROM addresses WHERE id=$1 AND user_id=$2',[uuid(path.split('/')[3]),actor.id]);return {status:200,data:{ok:true}}}
 if(path==='/api/orders'&&method==='GET')return {status:200,data:await listOrders(actor)};
 if(path==='/api/orders'&&method==='POST'){const result=await createOrder(actor,await readJson(req),req.headers['idempotency-key']);return {status:result.duplicate?200:201,data:result}}
 const match=path.match(/^\/api\/orders\/([^/]+)(?:\/(cancel|receipt))?$/);
 if(match){if(!match[2]&&method==='GET')return {status:200,data:await getOrder(actor,match[1])};if(match[2]==='cancel'&&method==='POST')return {status:200,data:await cancelOrder(actor,match[1])};if(match[2]==='receipt'&&method==='GET'){const {receipt}=await import('./receipt.mjs');await receipt(res,await getOrder(actor,match[1]));return {sent:true}}}
 return {status:404,data:{error:'Not found'}};
}
