(() => {
  'use strict';
  const client=window.BarfordSupabase,config=window.BARFORD_2027_CONFIG,F=window.BarfordMemberFlow;
  if(!client||!config||!F)return;
  const initialise=model=>{
    const button=document.getElementById('dashboardEventCamera'),input=document.getElementById('dashboardEventCameraInput'),status=document.getElementById('eventPhotoStatus'),retry=document.getElementById('eventPhotoRetry'),gallery=document.getElementById('eventPhotoGallery');
    if(!button||!input||button.dataset.ready)return;
    const event=model.event,memberId=model.session?.user.id;
    if(!memberId||event.event_date!==F.today()||event.status==='cancelled')return;
    button.dataset.ready='true';let pending=null,busy=false;
    async function upload(){
      if(!pending||busy)return;
      busy=true;button.disabled=true;retry.classList.add('hidden');status.textContent='Adding photo to the gallery…';
      try{
        if(!navigator.onLine)throw Error('No signal. Keep this page open and tap retry when connected.');
        const auth=await F.request(client.auth.getSession());
        if(auth.session?.user.id!==memberId)throw Error('Sign in with the same member account to upload this photo.');
        const bucket=client.storage.from(config.galleryBucket);
        if(!pending.uploaded){
          const result=await F.bounded(bucket.upload(pending.path,pending.file,{contentType:pending.file.type||'image/jpeg',upsert:false}),30000);
          // The same unique path is reused if a successful upload lost its response.
          if(result.error&&!/already exists|duplicate/i.test(result.error.message||''))throw result.error;
          pending.uploaded=true;
        }
        const result=await F.bounded(client.from('gallery_photos').insert({id:pending.id,event_id:event.id,storage_path:pending.path,uploaded_by:memberId,approved:true,caption:event.name+' · '+F.date(event.event_date)}),15000);
        // A repeated insert after a lost response must not create a second photo.
        if(result.error&&result.error.code!=='23505')throw result.error;
        pending=null;input.value='';status.textContent='Photo added to the gallery.';gallery.classList.remove('hidden');
      }catch(error){status.textContent=error.message||'Photo not added. Keep this page open and tap retry.';retry.classList.remove('hidden');}
      finally{busy=false;button.disabled=Boolean(pending);}
    }
    button.addEventListener('click',()=>input.click());
    retry.addEventListener('click',upload);
    input.addEventListener('change',()=>{
      const file=input.files?.[0];if(!file||busy)return;
      if(!file.type.startsWith('image/')||file.type==='image/svg+xml'){status.textContent='Please choose a photograph.';input.value='';return;}
      const id=crypto.randomUUID(),extension=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
      pending={file,id,path:`${memberId}/${id}.${extension}`,uploaded:false};gallery.classList.add('hidden');return upload();
    });
  };
  window.addEventListener('barford-dashboard-ready',e=>initialise(e.detail));
  if(window.BarfordDashboardModel)initialise(window.BarfordDashboardModel);
})();
