/* Barford 2027: launch gate for site navigation. Static source remains publicly served by GitHub Pages. */
(function(){
 const key="barford-2027-preview-session",page=location.pathname.split("/").pop()||"index.html";
 if(page==="index.html")return;
 document.documentElement.style.visibility="hidden";
 const token=sessionStorage.getItem(key);
 const back=()=>location.replace("index.html?next="+encodeURIComponent(page+location.search+location.hash));
 if(!token){back();return;}

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
 gateRPC("baseline_preview_valid",{p_token:token}).then(ok=>{
   if(ok!==true){sessionStorage.removeItem(key);back();return;}
   document.documentElement.style.visibility="";
   function exit(){
     if(!document.body||document.getElementById("exitPreview"))return;
     const b=document.createElement("button");b.id="exitPreview";b.type="button";b.textContent="Exit preview";
     b.style.cssText="position:fixed;right:12px;top:8px;z-index:9999;padding:7px 12px;border:1px solid #b09c70;border-radius:99px;background:#163849;color:#f8e7c0;font:600 12px system-ui;cursor:pointer";
     b.addEventListener("click",()=>{sessionStorage.removeItem(key);location.assign("index.html");});
     document.body.append(b);
   }
   if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",exit,{once:true});else exit();
 }).catch(()=>{sessionStorage.removeItem(key);back();});
})();