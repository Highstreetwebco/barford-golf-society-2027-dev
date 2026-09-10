(() => {
  "use strict";
  const client=window.BarfordSupabase,config=window.BARFORD_2027_CONFIG;
  if(!client||!config)return;
  const initialise=model=>{
  const button=document.getElementById("dashboardEventCamera"),input=document.getElementById("dashboardEventCameraInput");
  if(!button||!input||button.dataset.ready)return;button.dataset.ready='true';
  button.innerHTML='<strong>Take event photo</strong>';
  const activeEvent=model.event,session=model.session;
  button.addEventListener("click",()=>{if(activeEvent)input.click()});
  input.addEventListener("change",async()=>{
    const file=input.files?.[0];if(!file||!session||!activeEvent)return;
    button.classList.add("is-uploading");button.querySelector("strong").textContent="Uploading…";button.disabled=true;
    const extension=(file.name.split(".").pop()||"jpg").toLowerCase(),path=`${session.user.id}/${crypto.randomUUID()}.${extension}`;
    const {error:uploadError}=await client.storage.from(config.galleryBucket).upload(path,file,{contentType:file.type||"image/jpeg",upsert:false});
    if(!uploadError){
      const shownDate=activeEvent.test_mode_active&&activeEvent.test_original_event_date?activeEvent.test_original_event_date:activeEvent.event_date;
      const dateText=new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",year:"numeric"}).format(new Date(`${shownDate}T12:00:00`));
      const caption=`${activeEvent.test_mode_active?"TEST · ":""}${activeEvent.name} · ${dateText}`;
      const {error:recordError}=await client.from("gallery_photos").insert({event_id:activeEvent.id,storage_path:path,uploaded_by:session.user.id,approved:true,caption});
      if(!recordError){button.classList.remove("is-uploading");button.classList.add("is-done");button.querySelector("strong").textContent="Photo added to the gallery";setTimeout(()=>{button.classList.remove("is-done");button.querySelector("strong").textContent="Take an event photo";button.disabled=false;input.value=""},1800);return}
    }
    button.classList.remove("is-uploading");button.querySelector("strong").textContent="Try again";button.disabled=false;input.value="";
  });
  };
  window.addEventListener("barford-dashboard-ready",e=>initialise(e.detail));
  if(window.BarfordDashboardModel)initialise(window.BarfordDashboardModel);
})();
