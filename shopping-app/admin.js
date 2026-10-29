const el=id=>document.getElementById(id);
let products=[],editing=null;
function status(message){el("status").textContent=message}
async function request(path,method="GET",data){
 const options={method,credentials:"same-origin"};
 if(data!==undefined){options.headers={"content-type":"application/json"};options.body=JSON.stringify(data)}
 const response=await fetch(path,options);
 const body=await response.json();
 if(!response.ok)throw new Error(body.error||"Request failed");
 return body;
}
function showWorkspace(active){el("loginPanel").hidden=active;el("workspace").hidden=!active}
function resetForm(){el("productForm").reset();editing=null;el("editorTitle").textContent="Add product";for(const name of ["slug","categorySlug","sku"])el("productForm").elements[name].disabled=false}
function edit(product){
 editing=product;el("editorTitle").textContent="Edit product";
 const fields=el("productForm").elements;
 fields.name.value=product.name;fields.slug.value=product.slug;fields.sku.value=product.sku;
 fields.description.value=product.description||"";
 fields.price.value=(Number(product.pricePaise)/100).toFixed(2);
 fields.stock.value=product.stock;fields.active.checked=product.active;
 for(const name of ["slug","categorySlug","sku"])fields[name].disabled=true;
 el("productForm").scrollIntoView({behavior:"smooth"});
}
function render(){
 const root=el("products");root.replaceChildren();
 for(const product of products){
  const card=document.createElement("article");card.className="product";
  const title=document.createElement("strong");title.textContent=product.name;
  const meta=document.createElement("small");meta.textContent=product.sku+" · "+(product.active?"Published":"Draft");
  const detail=document.createElement("p");detail.textContent="₹"+(Number(product.pricePaise)/100).toFixed(2)+" · Stock: "+product.stock;
  const button=document.createElement("button");button.type="button";button.textContent="Edit";button.addEventListener("click",()=>edit(product));
  card.append(title,meta,detail,button);root.append(card);
 }
 if(!products.length)root.textContent="No products found.";
}
async function refresh(){const response=await request("/api/admin/products");products=response.items;render()}
el("loginForm").addEventListener("submit",async event=>{
 event.preventDefault();const form=new FormData(event.currentTarget);
 try{await request("/api/auth/login","POST",{email:form.get("email"),password:form.get("password")});await request("/api/admin/me");showWorkspace(true);await refresh();status("Signed in")}catch(error){status(error.message)}
});
el("logout").addEventListener("click",async()=>{try{await request("/api/auth/logout","POST",{});showWorkspace(false);status("Signed out")}catch(error){status(error.message)}});
el("refresh").addEventListener("click",()=>refresh().then(()=>status("Catalog refreshed")).catch(error=>status(error.message)));
el("cancel").addEventListener("click",resetForm);
el("productForm").addEventListener("submit",async event=>{
 event.preventDefault();const fields=event.currentTarget.elements;
 const price=Number(fields.price.value);
 if(!Number.isFinite(price)||Math.abs(price*100-Math.round(price*100))>0.00001){status("Invalid price");return}
 const data={name:fields.name.value,description:fields.description.value,pricePaise:Math.round(price*100),stock:Number(fields.stock.value)};
 try{
  if(editing){data.active=fields.active.checked;await request("/api/admin/products/"+editing.id,"PATCH",data)}
  else{data.slug=fields.slug.value;data.categorySlug=fields.categorySlug.value;data.sku=fields.sku.value;const created=await request("/api/admin/products","POST",data);if(fields.active.checked)await request("/api/admin/products/"+created.id,"PATCH",{active:true})}
  resetForm();await refresh();status("Product saved");
 }catch(error){status(error.message)}
});
request("/api/admin/me").then(()=>{showWorkspace(true);return refresh()}).catch(()=>showWorkspace(false));
