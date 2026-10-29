"use strict";
// Phase 1 storefront: demo catalog only. No payment, account, or order processing.
const products=[
{id:"p1",name:"The Everyday Chair",category:"Home",price:8499,image:"https://images.unsplash.com/photo-1503602642458-232111445657?w=700&q=80"},
{id:"p2",name:"Studio Headphones",category:"Tech",price:3499,image:"https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=700&q=80"},
{id:"p3",name:"Everyday Sneakers",category:"Lifestyle",price:2999,image:"https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=700&q=80"},
{id:"p4",name:"Ceramic Accent Vase",category:"Home",price:1299,image:"https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=700&q=80"},
{id:"p5",name:"Minimal Desk Lamp",category:"Home",price:2199,image:"https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=700&q=80"},
{id:"p6",name:"Classic Wristwatch",category:"Lifestyle",price:4999,image:"https://images.unsplash.com/photo-1524592094714-0f0654e20314?w=700&q=80"},
{id:"p7",name:"Wireless Essentials",category:"Tech",price:1899,image:"https://images.unsplash.com/photo-1572569511254-d8f925fe2cbb?w=700&q=80"},
{id:"p8",name:"Soft Knit Throw",category:"Home",price:1599,image:"https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=700&q=80"}
];
const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(n);
function read(key,fallback){try{const x=JSON.parse(localStorage.getItem(key));return x??fallback}catch{return fallback}}
const validIds=new Set(products.map(p=>p.id));
let cart=read("novacart-demo-cart",{});if(!cart||typeof cart!=="object"||Array.isArray(cart))cart={};
cart=Object.fromEntries(Object.entries(cart).filter(([id,q])=>validIds.has(id)&&Number.isInteger(q)&&q>0&&q<=99));
let wish=read("novacart-demo-wishlist",[]);wish=new Set(Array.isArray(wish)?wish.filter(id=>validIds.has(id)):[]);
let category="All",search="";
const filters=["All","Home","Lifestyle","Tech"];
function save(){try{localStorage.setItem("novacart-demo-cart",JSON.stringify(cart));localStorage.setItem("novacart-demo-wishlist",JSON.stringify([...wish]))}catch{}updateCounts()}
function updateCounts(){$("cartCount").textContent=Object.values(cart).reduce((a,b)=>a+b,0);$("wishlistCount").textContent=wish.size}
function node(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n}
function renderFilters(){const box=$("filters");box.replaceChildren();filters.forEach(c=>{const b=node("button",c===category?"active":"",c);b.type="button";b.setAttribute("aria-pressed",String(c===category));b.addEventListener("click",()=>{category=c;renderFilters();renderProducts()});box.append(b)})}
function renderProducts(){const list=products.filter(p=>(category==="All"||p.category===category)&&(p.name+" "+p.category).toLowerCase().includes(search));const grid=$("productGrid");grid.replaceChildren();$("empty").hidden=list.length!==0;list.forEach(p=>{const card=node("article","productCard");const image=node("div","productImage");const img=node("img");img.src=p.image;img.alt=p.name;img.loading="lazy";image.append(img);const heart=node("button","heart"+(wish.has(p.id)?" saved":""),wish.has(p.id)?"♥":"♡");heart.type="button";heart.setAttribute("aria-label",(wish.has(p.id)?"Remove from":"Add to")+" wishlist: "+p.name);heart.addEventListener("click",()=>{wish.has(p.id)?wish.delete(p.id):wish.add(p.id);save();renderProducts();notify("Wishlist updated")});image.append(heart);const info=node("div","productInfo");info.append(node("strong","",p.name),node("small","",p.category));const price=node("p","price",money(p.price));const add=node("button","add","Add to bag +");add.type="button";add.addEventListener("click",()=>{cart[p.id]=Math.min(99,(cart[p.id]||0)+1);save();notify(p.name+" added to bag")});card.append(image,info,price,add);grid.append(card)})}
function notify(s){const t=$("toast");t.textContent=s;t.classList.add("visible");clearTimeout(notify.timer);notify.timer=setTimeout(()=>t.classList.remove("visible"),2200)}
function showDrawer(mode){const content=$("drawerContent"),foot=$("drawerFooter");content.replaceChildren();foot.replaceChildren();$("drawerTitle").textContent=mode==="cart"?"Your bag":"Your wishlist";const ids=mode==="cart"?Object.keys(cart):[...wish];if(!ids.length)content.append(node("p","muted",mode==="cart"?"Your bag is empty. Explore the collection to add something you love.":"No saved favorites yet."));ids.forEach(id=>{const p=products.find(x=>x.id===id);if(!p)return;const row=node("div","drawerItem"),img=node("img");img.src=p.image;img.alt=p.name;const info=node("div");info.append(node("strong","",p.name),node("p","",money(p.price)+(mode==="cart"?" × "+cart[id]:"")));const remove=node("button","","Remove");remove.type="button";remove.addEventListener("click",()=>{if(mode==="cart")delete cart[id];else wish.delete(id);save();renderProducts();showDrawer(mode)});row.append(img,info,remove);content.append(row)});if(mode==="cart"&&ids.length){const subtotal=Object.entries(cart).reduce((sum,[id,q])=>sum+(products.find(p=>p.id===id)?.price||0)*q,0);const f=node("div","drawerFoot");const total=node("p");total.append(node("strong","","Demo subtotal"),node("strong","",money(subtotal)));const disabled=node("button","disabledCheckout","Checkout coming in a later phase");disabled.disabled=true;f.append(total,disabled,node("p","muted","Prices and products are illustrative. Orders and payments are not available in this preview."));foot.append(f)}$("drawer").showModal()}
$("searchInput").addEventListener("input",e=>{search=e.target.value.trim().toLowerCase();renderProducts()});
$("searchButton").addEventListener("click",()=>{$("shop").scrollIntoView({behavior:"smooth"});$("searchInput").focus({preventScroll:true})});
$("cartButton").addEventListener("click",()=>showDrawer("cart"));
$("wishlistButton").addEventListener("click",()=>showDrawer("wish"));
$("closeDrawer").addEventListener("click",()=>$("drawer").close());
$("drawer").addEventListener("click",e=>{if(e.target===$("drawer"))$("drawer").close()});
document.querySelectorAll("[data-category]").forEach(a=>a.addEventListener("click",()=>{category=a.dataset.category;renderFilters();renderProducts()}));
renderFilters();renderProducts();updateCounts();