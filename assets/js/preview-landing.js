/* The shared preview password is never embedded in this file. */
(function(){
 const key="barford-2027-preview-session";

  async function gateRPC(name,params){
    const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),12000);
    try{
      const res=await fetch("https://xspzmthygrajzktydvvj.supabase.co/rest/v1/rpc/"+name,{
        method:"POST",headers:{"apikey":"sb_publishable_xLM39PjQf4XdTVfNHFOzAQ_i4re6w_c","Content-Type":"application/json"},
        body:JSON.stringify(params),cache:"no-store",signal:ctrl.signal
      });
      if(!res.ok)throw Error("Preview access server unavailable");
      return res.json();
    }finally{clearTimeout(timeout);}
  }
 const form=document.getElementById("previewForm"),pass=document.getElementById("previewPassword"),
       btn=document.getElementById("previewSubmit"),status=document.getElementById("previewStatus");
 const next=(()=>{
  const p=new URLSearchParams(location.search),v=p.get("next"),event=p.get("event");
  if(v){
   try {
    const url=new URL(v,location.href),root=location.pathname.slice(0,location.pathname.lastIndexOf("/")+1),relative=url.pathname.slice(root.length);
    if(url.origin===location.origin&&url.pathname.startsWith(root)&&/^[a-z0-9-]+\.html$/i.test(relative)&&relative!=="index.html") return relative+url.search+url.hash;
   }catch{}
  }
  if(event&&/^[1-9]\d*$/.test(event))return "home.html?event="+event+location.hash;
  return "home.html";
 })();
 (async()=>{
   const token=sessionStorage.getItem(key);if(!token)return;
   try{if(await gateRPC("baseline_preview_valid",{p_token:token})===true){location.replace(next);return;}}catch{}
   sessionStorage.removeItem(key);
 })();
 form.addEventListener("submit",async e=>{
   e.preventDefault();btn.disabled=true;btn.textContent="Checking…";status.textContent="";
   try{
     const token=await gateRPC("baseline_preview_unlock",{p_password:pass.value});
     if(typeof token==="string"&&/^[a-f0-9]{64}$/.test(token)){
        sessionStorage.setItem(key,token);pass.value="";location.assign(next);return;
     }
     status.textContent="Incorrect password. Please try again.";pass.select();
   }catch{status.textContent="Unable to check access. Please try again.";}
   finally{btn.disabled=false;btn.textContent="Enter 2027 site →";}
 });
})();