import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const check = args.includes('--check');
const [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview')] = args.filter(arg => arg !== '--check');
const marker = 'Eden owner photo upload v1';

function replace(source, from, to) {
  if (source.split(from).length !== 2) throw Error('Unexpected setup version near ' + from.slice(0, 100));
  return source.replace(from, () => to);
}

function updateWorker(source) {
  const changes = [
    ["async function confirmWallCopy(request,env,a){",
      `// Eden owner photo upload v1
const wallPhotoWidth=1672, wallPhotoHeight=941, wallPhotoLimit=1500000;
const wallPhotoKey=/^upload\\/([a-f0-9-]{36})$/;
function uploadedWall(a){return wallPhotoKey.exec(a.hero_key||'')?.[1]||null}
function uploadedWallUrl(a){return '/__eden/reception-photo/'+a.id+'/'+uploadedWall(a)+'.jpg'}
function wallPhotoObject(a){return 'owner-wall/'+uploadedWall(a)+'.jpg'}

async function readWallPhotoBytes(request){
  const reader=request.body?.getReader();
  if(!reader)return null;
  const bytes=new Uint8Array(wallPhotoLimit);
  let length=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)return bytes.subarray(0,length);
      if(length+value.length>bytes.length){await reader.cancel();return null}
      bytes.set(value,length);
      length+=value.length;
    }
  }finally{reader.releaseLock()}
}

function validWallPhoto(bytes){
  if(bytes.length<32||bytes[0]!==255||bytes[1]!==216||
     bytes.at(-2)!==255||bytes.at(-1)!==217)return false;
  const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for(let offset=2;offset+9<bytes.length;){
    if(bytes[offset++]!==255)return false;
    while(bytes[offset]===255)offset++;
    const marker=bytes[offset++];
    if(marker===218||offset+2>=bytes.length)return false;
    const length=data.getUint16(offset);
    if(length<2||offset+length>bytes.length)return false;
    if(marker===192||marker===194)
      return length>=8&&data.getUint16(offset+3)===wallPhotoHeight&&data.getUint16(offset+5)===wallPhotoWidth;
    offset+=length;
  }
  return false;
}

async function uploadWallPhoto(request,env,a){
  if(request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'Invalid origin'},403);
  if(a.status==='published')return json({error:'The published photo is read-only in setup.'},409);
  if(!env.EDEN_HERO_IMAGES)return json({error:'Photo storage is unavailable. You can use the template wall below.'},503);
  if(request.headers.get('X-Eden-Wall-Revision')!==a.updated_at)return json({error:'Setup changed. Reload before uploading a photo.'},409);
  if(request.headers.get('Content-Type')!=='image/jpeg')return json({error:'Choose a JPG, PNG or WebP photo.'},415);
  if(Number(request.headers.get('Content-Length')||0)>wallPhotoLimit)return json({error:'This photo is too large. Choose a smaller file.'},413);
  if(!await limit(env,'wall-photo:'+a.id,12,86400))return json({error:'You reached the daily photo upload limit. Try again tomorrow.'},429);
  const bytes=await readWallPhotoBytes(request);
  if(!bytes)return json({error:'This photo is too large. Choose a smaller file.'},413);
  if(!validWallPhoto(bytes))return json({error:'Could not read that photo. Choose a different image.'},400);
  const next={...a,hero_key:'upload/'+crypto.randomUUID(),hero_status:'ready',hero_reviewed_at:null,review_approved_at:null,updated_at:now()};
  const object=wallPhotoObject(next);
  await env.EDEN_HERO_IMAGES.put(object,bytes,{httpMetadata:{contentType:'image/jpeg'}});
  let saved;
  try{
    saved=await env.PILOT_DB.prepare("UPDATE clinic_assistants SET hero_key=?,hero_status='ready',hero_reviewed_at=NULL,review_approved_at=NULL,updated_at=? WHERE id=? AND updated_at=? AND status!='published'")
      .bind(next.hero_key,next.updated_at,a.id,a.updated_at).run();
  }catch(error){
    await env.EDEN_HERO_IMAGES.delete(object).catch(()=>{});
    throw error;
  }
  if(saved.meta?.changes!==1){
    await env.EDEN_HERO_IMAGES.delete(object).catch(()=>{});
    return json({error:'Setup changed. Reload before uploading a photo.'},409);
  }
  if(uploadedWall(a))await env.EDEN_HERO_IMAGES.delete(wallPhotoObject(a)).catch(()=>{});
  return json(ownerView(next));
}

async function confirmUploadedPhoto(env,a,revision){
  if(!uploadedWall(a)||a.hero_status!=='ready'||revision!==a.updated_at)
    return json({error:'The photo changed. Reload setup and check the preview.'},409);
  if(a.hero_reviewed_at)return json(ownerView(a));
  const stamp=now();
  const saved=await env.PILOT_DB.prepare("UPDATE clinic_assistants SET hero_reviewed_at=?,review_approved_at=NULL,updated_at=? WHERE id=? AND updated_at=? AND hero_key=? AND status!='published'")
    .bind(stamp,stamp,a.id,a.updated_at,a.hero_key).run();
  if(saved.meta?.changes!==1)return json({error:'Setup changed. Reload before confirming the photo.'},409);
  return json(ownerView({...a,hero_reviewed_at:stamp,review_approved_at:null,updated_at:stamp}));
}

async function readPublishedWallPhoto(env,id,key){
  const row=await env.PILOT_DB.prepare("SELECT hero_key FROM clinic_assistants WHERE id=? AND hero_key=? AND hero_status='ready' AND status='published'")
    .bind(id,'upload/'+key).first();
  if(!row)return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
  const photo=await env.EDEN_HERO_IMAGES?.get(wallPhotoObject(row));
  if(!photo)return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
  return new Response(photo.body,{headers:{'Content-Type':'image/jpeg','Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'}});
}

async function ownerWallPhotoData(env,a){
  const photo=await env.EDEN_HERO_IMAGES?.get(wallPhotoObject(a));
  if(!photo)return null;
  const bytes=new Uint8Array(await photo.arrayBuffer());
  let raw='';
  for(let offset=0;offset<bytes.length;offset+=8192)raw+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
  return 'data:image/jpeg;base64,'+btoa(raw);
}

async function confirmWallCopy(request,env,a){`],
    ["if(input.revision!==a.updated_at)return json({error:'Clinic details changed.",
      `if(input.confirmPhoto===true)return confirmUploadedPhoto(env,a,input.revision);
  if(input.revision!==a.updated_at)return json({error:'Clinic details changed.`],
    ["deskSigns:a.deskSigns||null,id:a.id",
      "deskSigns:a.deskSigns||null,heroIsUpload:Boolean(uploadedWall(a)),id:a.id"],
    ["hasCebuWall(a)?cebuWall(a).asset:a.hero_key.startsWith('template/')",
      "uploadedWall(a)?uploadedWallUrl(a):hasCebuWall(a)?cebuWall(a).asset:a.hero_key.startsWith('template/')"],
    ["Illustrative template scene; the people and premises shown are fictional. Voice conversations",
      "${ownerPhoto?'Reception photo supplied by the clinic.':'Illustrative template scene; the people and premises shown are fictional.'} Voice conversations"],
    ["function ownerPreview(request,a){",
      "async function ownerPreview(request,env,a){"],
    ["  const html=staticClinicPreview(clinicHtml(preview));",
      `  if(uploadedWall(preview)){
    const photo=await ownerWallPhotoData(env,preview);
    if(!photo)return json({error:'This photo is unavailable. Upload it again or use the template wall.'},503);
    preview.photoData=photo;
  }
  const html=staticClinicPreview(clinicHtml(preview));`],
    ["'hero-template','hero-approve','wall-confirm','review','voice'",
      "'hero-template','hero-approve','wall-confirm','wall-photo','review','voice'"],
    ["return ownerPreview(request,a);if(!allowPost(request))",
      "return ownerPreview(request,env,a);if(action==='wall-photo'&&request.method==='POST')return uploadWallPhoto(request,env,a);if(!allowPost(request))"],
    ["  if(input.template&&input.template!==a.template)return json({error:'The saved style changed.",
      `  if(input.revision&&input.revision!==a.updated_at)return json({error:'Setup changed. Reload before using the template.'},409);
  if(input.template&&input.template!==a.template)return json({error:'The saved style changed.`],
    ["  return json(ownerView({...a,hero_key:hero,hero_status:'ready',hero_reviewed_at:null,review_approved_at:null,updated_at:stamp}));",
      `  if(uploadedWall(a))await env.EDEN_HERO_IMAGES?.delete(wallPhotoObject(a)).catch(()=>{});
  return json(ownerView({...a,hero_key:hero,hero_status:'ready',hero_reviewed_at:null,review_approved_at:null,updated_at:stamp}));`],
    [" const nextWall=nextWallBase&&(existingLetters?nextWallBase+'/'+encodeURIComponent(existingLetters):nextWallBase);",
      " const nextWall=uploadedWall(a)?a.hero_key:nextWallBase&&(existingLetters?nextWallBase+'/'+encodeURIComponent(existingLetters):nextWallBase);"],
    [" const photoWall=pilotWall?",
      ` const ownerPhoto=uploadedWall(a)?a.photoData||uploadedWallUrl(a):null;
 const photoWall=ownerPhoto?null:pilotWall?`],
    [" const signMarkup=true?",
      " const signMarkup=!ownerPhoto?"],
    [" const signMobile=true?",
      " const signMobile=!ownerPhoto?"],
    [" ${pilotWall?'has-cebu-pilot-wall':''}${a.preview_contact?",
      " ${pilotWall?'has-cebu-pilot-wall':''}${ownerPhoto?' has-uploaded-wall':''}${a.preview_contact?"],
    ["<main><section class=\"scene\">${signMarkup}",
      "<main><section class=\"scene\">${ownerPhoto?`<img src=\"${h(ownerPhoto)}\" width=\"1672\" height=\"941\" alt=\"Reception photo supplied by the clinic\">`:''}${signMarkup}"],
    ["<section id=\"receptionist\" class=\"chat-wrap\"",
      `\${ownerPhoto?\`<section class="photo-clinic-name"><h1>\${name}</h1></section>\`:''}
<section id="receptionist" class="chat-wrap"`],
    ["</style></head><body class=\"theme-",
      `.has-uploaded-wall .scene{background:none!important;min-height:0;padding:0;aspect-ratio:1672/941}
.has-uploaded-wall .scene img{width:100%;height:100%;display:block;object-fit:cover}
.has-uploaded-wall .scene-copy,.has-uploaded-wall .sitebar{display:none}
.photo-clinic-name{text-align:center;padding:18px 20px}
.photo-clinic-name h1{margin:0;font-size:clamp(1.4rem,4vw,2.25rem);line-height:1.15}
</style></head><body class="theme-`],
    ["export async function handleAssistantRoute(request,env,path){const hero=",
      `export async function handleAssistantRoute(request,env,path){
  const upload=/^\\/__eden\\/reception-photo\\/([a-f0-9-]{36})\\/([a-f0-9-]{36})\\.jpg$/.exec(path);
  if(upload){
    if(request.method!=='GET')return new Response('Method not allowed',{status:405});
    if(!env.PILOT_DB)return new Response('Unavailable',{status:503});
    try{return await readPublishedWallPhoto(env,upload[1],upload[2])}
    catch{return new Response('Photo unavailable',{status:503,headers:{'Cache-Control':'no-store'}})}
  }
  const hero=`],
    ["|hero-approve|wall-confirm|desk-signs|details",
      "|hero-approve|wall-confirm|wall-photo|desk-signs|details"],
  ];
  for (const [from,to] of changes) source = replace(source,from,to);
  return source;
}

function updatePage(source) {
  const changes = [
    ["<p id=\"wallStatus\" class=\"status\" role=\"status\"></p>",
      `<details id="wallPhotoControls" hidden>
  <summary>Upload your own image</summary>
  <label class="field"><span>Reception photo</span><input type="file" id="wallPhotoFile" accept="image/jpeg,image/png,image/webp"></label>
  <p>Choose a JPG, PNG or WebP under 12 MB. The preview shows the landscape crop used on your public page.</p>
  <button type="button" id="uploadWallPhoto" class="btn light">Upload photo</button>
</details>
<button type="button" id="useTemplateWall" class="btn light" hidden>Use template wall</button>
<p id="wallStatus" class="status" role="status"></p>`],
    ["  $('wallLetteringForm').hidden=$('confirmWallCopy').hidden=a.status==='published';",
      `  const published=a.status==='published';
  $('confirmWallCopy').hidden=$('wallPhotoControls').hidden=published;
  $('wallLetteringForm').hidden=published||a.heroIsUpload;
  $('useTemplateWall').hidden=published||!a.heroIsUpload;
  for(const id of [...photoButtons,'wallPhotoFile'])$(id).disabled=wallCopyBusy;
  $('confirmWallCopy').textContent=a.heroIsUpload?'Confirm photo':'Confirm wall and signs';`],
    [`  $('wallEditingHelp').textContent=a.status==='published'
    ? 'This is your published wall and desk signs. You can edit all four texts in a setup draft.'
    : 'Edit the wall lettering and desk signs, then confirm the preview.';`,
      `  $('wallEditingHelp').textContent=published
    ? 'This is the reception image on your published page.'
    : a.heroIsUpload?'Check the photo in the preview. Your clinic name appears below it on the public page.'
      :'Edit the wall lettering and desk signs, then confirm the preview.';`],
    ["  return assistant.status!=='published'&&(!assistant.heroReady||",
      "  return assistant.status!=='published'&&!assistant.heroIsUpload&&(!assistant.heroReady||"],
    ["$('wallLetteringForm').onsubmit=async event=>{",
      `const photoButtons=['uploadWallPhoto','useTemplateWall'];
async function prepareWallPhoto(file){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>12000000)
    throw Error('Choose a JPG, PNG or WebP file under 12 MB.');
  const objectUrl=URL.createObjectURL(file);
  try{
    const photo=new Image();
    photo.src=objectUrl;
    await photo.decode();
    const canvas=document.createElement('canvas');
    canvas.width=1672;
    canvas.height=941;
    const context=canvas.getContext('2d',{alpha:false});
    context.fillStyle='#f7f5ee';
    context.fillRect(0,0,canvas.width,canvas.height);
    const scale=Math.max(canvas.width/photo.naturalWidth,canvas.height/photo.naturalHeight);
    const width=photo.naturalWidth*scale, height=photo.naturalHeight*scale;
    context.drawImage(photo,(canvas.width-width)/2,(canvas.height-height)/2,width,height);
    const image=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.86));
    if(!image||image.size>1500000)throw Error('Could not prepare the photo. Choose a smaller image.');
    return image;
  }finally{URL.revokeObjectURL(objectUrl)}
}

async function changeWallPhoto(button,save,message){
  if(wallCopyBusy||assistant.status==='published')return;
  wallCopyBusy=true;
  actionState(button,'pending');
  renderWallLettering();
  status('wallStatus','Updating your reception photo…');
  try{
    assistant=await save(assistant.wallRevision);
    wallCopyDirty=false;
    actionState('confirmWallCopy','');
    renderManage();
    actionState(button,'done');
    status('wallStatus',message);
  }catch(error){status('wallStatus',error.message,true)}
  finally{
    wallCopyBusy=false;
    if($(button).dataset.actionState==='pending')actionState(button,'');
    renderWallLettering();
  }
}

$('uploadWallPhoto').onclick=async()=>{
  const file=$('wallPhotoFile').files[0];
  if(!file){$('wallPhotoFile').focus();return status('wallStatus','Choose a photo to upload.',true)}
  await changeWallPhoto('uploadWallPhoto',async revision=>{
    const image=await prepareWallPhoto(file);
    const response=await fetch('/api/assistants/'+id+'/wall-photo',{
      method:'POST',
      headers:{'Content-Type':'image/jpeg','X-Eden-Wall-Revision':revision,...(key?{Authorization:'Bearer '+key}:{})},
      body:image
    });
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'Photo upload failed.');
    $('wallPhotoFile').value='';
    return data;
  },'Photo uploaded. Check the crop and confirm it below.');
};
$('wallPhotoFile').onchange=()=>actionState('uploadWallPhoto','');
$('useTemplateWall').onclick=()=>changeWallPhoto('useTemplateWall',revision=>
  api('/api/assistants/'+id+'/hero-template',{method:'POST',body:JSON.stringify({template:assistant.template,revision})}),
  'Template restored. Edit and confirm the wall lettering and signs.');

$('confirmWallCopy').onclick=event=>{
  if(assistant.heroIsUpload)return $('wallLetteringForm').onsubmit(event);
};
$('wallLetteringForm').onsubmit=async event=>{`],
    [`  const button=$('confirmWallCopy');
  if(button.disabled||assistant.status`,
      `  const button=$('confirmWallCopy'), photo=assistant.heroIsUpload;
  if(button.disabled||assistant.status`],
    [`  wallCopyBusy=button.disabled=true;
  actionState('confirmWallCopy','pending');`,
      `  wallCopyBusy=button.disabled=true;
  renderWallLettering();
  actionState('confirmWallCopy','pending');`],
    [`    const copy=Object.fromEntries(Object.entries(deskInputs).map(([name,id])=>[name,$(id).value]));
    assistant=await api('/api/assistants/'+id+'/wall-confirm',{
      method:'POST',body:JSON.stringify({...copy,wallText:$('wallLettering').value,revision:assistant.wallRevision})`,
      `    const copy=photo?{confirmPhoto:true}:{
      ...Object.fromEntries(Object.entries(deskInputs).map(([name,id])=>[name,$(id).value])),
      wallText:$('wallLettering').value
    };
    assistant=await api('/api/assistants/'+id+'/wall-confirm',{
      method:'POST',body:JSON.stringify({...copy,revision:assistant.wallRevision})`],
    ["    status('wallStatus','Wall and desk signs confirmed.');",
      "    status('wallStatus',photo?'Reception photo confirmed.':'Wall and desk signs confirmed.');"],
    ["function renderManage(){const a=assistant;renderManageTemplates();$('manageTitle').textContent=a.clinic+' assistant';$('manageIntro').textContent=`${a.city} · ${location.host}/clinic/${a.slug}/`;$('wallSceneCard').hidden=false;renderWallLettering();$('wallStatus').textContent=a.heroApproved?'Wall and desk signs confirmed.':'';$('continuePageReview').hidden=!a.heroApproved||a.status==='published';void loadWallPreview();$('qaStart').disabled=!a.agentReady||a.bookingMode!=='request';$('behaviorUpgrade').disabled=!a.agentReady||a.bookingMode!=='request';$('qaRefresh').disabled=!a.agentReady||a.bookingMode!=='request';$('voiceUpgrade').hidden=!a.agentReady||a.bookingMode!=='request';if(a.emailAddress&&!$('alertEmail').value)$('alertEmail').value=a.emailAddress;if(document.activeElement!==$('clinicPhone'))$('clinicPhone').value=a.phone||'';if(document.activeElement!==$('clinicMap'))$('clinicMap').value=a.mapsUrl||'';$('voiceCheck').textContent=(a.agentReady?'✓':'○')+' Voice assistant created';$('voiceCheck').className=a.agentReady?'yes':'no';$('reviewCheck').textContent=(a.voiceReviewed?'✓':'○')+' Voice conversation tested';$('reviewCheck').className=a.voiceReviewed?'yes':'no';$('emailCheck').textContent=(a.testConfirmed?'✓':'○')+' Clinic inbox confirmed';$('emailCheck').className=a.testConfirmed?'yes':'no';$('testCheck').textContent=(a.heroApproved?'✓':'○')+(a.heroApproved?' Wall confirmed':' Confirm wall');$('testCheck').classList.toggle('yes',a.heroApproved);$('testCheck').classList.toggle('no',!a.heroApproved);$('pageCheck').textContent=(a.reviewApproved?'✓':'○')+(a.reviewApproved?' Page approved':' Approve page');$('pageCheck').classList.toggle('yes',a.reviewApproved);$('pageCheck').classList.toggle('no',!a.reviewApproved);$('publish').disabled=!a.agentReady||!a.voiceReviewed||!a.testConfirmed||!a.heroApproved||!a.reviewApproved||a.status==='published';renderApproval();document.querySelectorAll('[data-variant]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.variant===(a.variant||'original')));const legacy=a.variant&&a.variant!=='original'&&a.status!=='published';$('legacyLayout').hidden=!legacy;$('legacyLayout').style.display=legacy?'':'none';$('variantStatus').textContent=legacy?'Switch to the current layout to approve this page.':'';$('summaryClinic').textContent=a.clinic+' · '+a.city;$('summaryServices').textContent=a.services;$('summaryHours').textContent=a.hours||'Not supplied';$('summaryFeatured').textContent=a.featuredService||'None';$('summaryVoice').textContent=(a.language==='Thai'?'สวัสดีค่ะ ยินดีต้อนรับสู่ '+a.clinic+' มีอะไรให้ช่วยไหมคะ':'Hi, welcome to '+a.clinic+'. What can I help you with?')+(a.voiceReviewed?' · Voice tested':' · Test with Talk above');$('summaryBooking').textContent=a.bookingMode==='request'?'Appointment requests; clinic staff confirm availability':'Questions only; clinic staff handle bookings';$('summaryContact').textContent=[a.phone,a.mapsUrl].filter(Boolean).join(' · ')||'No phone or map saved';if(a.status==='published'){$('publishStatus').textContent='Your AI receptionist page is published.';const link=document.createElement('a');link.href=a.publicUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent=link.href;$('publicLink').replaceChildren(link);$('liveConversationUpgrade').hidden=a.bookingMode!=='request'}",
      "function renderManage(){const a=assistant;renderManageTemplates();$('manageTitle').textContent=a.clinic+' assistant';$('manageIntro').textContent=`${a.city} · ${location.host}/clinic/${a.slug}/`;$('wallSceneCard').hidden=false;renderWallLettering();$('wallStatus').textContent=a.heroApproved?(a.heroIsUpload?'Reception photo confirmed.':'Wall and desk signs confirmed.'):'';$('continuePageReview').hidden=!a.heroApproved||a.status==='published';void loadWallPreview();$('qaStart').disabled=!a.agentReady||a.bookingMode!=='request';$('behaviorUpgrade').disabled=!a.agentReady||a.bookingMode!=='request';$('qaRefresh').disabled=!a.agentReady||a.bookingMode!=='request';$('voiceUpgrade').hidden=!a.agentReady||a.bookingMode!=='request';if(a.emailAddress&&!$('alertEmail').value)$('alertEmail').value=a.emailAddress;if(document.activeElement!==$('clinicPhone'))$('clinicPhone').value=a.phone||'';if(document.activeElement!==$('clinicMap'))$('clinicMap').value=a.mapsUrl||'';$('voiceCheck').textContent=(a.agentReady?'✓':'○')+' Voice assistant created';$('voiceCheck').className=a.agentReady?'yes':'no';$('reviewCheck').textContent=(a.voiceReviewed?'✓':'○')+' Voice conversation tested';$('reviewCheck').className=a.voiceReviewed?'yes':'no';$('emailCheck').textContent=(a.testConfirmed?'✓':'○')+' Clinic inbox confirmed';$('emailCheck').className=a.testConfirmed?'yes':'no';$('testCheck').textContent=(a.heroApproved?'✓':'○')+(a.heroApproved?' Wall confirmed':' Confirm wall');$('testCheck').classList.toggle('yes',a.heroApproved);$('testCheck').classList.toggle('no',!a.heroApproved);$('pageCheck').textContent=(a.reviewApproved?'✓':'○')+(a.reviewApproved?' Page approved':' Approve page');$('pageCheck').classList.toggle('yes',a.reviewApproved);$('pageCheck').classList.toggle('no',!a.reviewApproved);$('publish').disabled=!a.agentReady||!a.voiceReviewed||!a.testConfirmed||!a.heroApproved||!a.reviewApproved||a.status==='published';renderApproval();document.querySelectorAll('[data-variant]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.variant===(a.variant||'original')));const legacy=a.variant&&a.variant!=='original'&&a.status!=='published';$('legacyLayout').hidden=!legacy;$('legacyLayout').style.display=legacy?'':'none';$('variantStatus').textContent=legacy?'Switch to the current layout to approve this page.':'';$('summaryClinic').textContent=a.clinic+' · '+a.city;$('summaryServices').textContent=a.services;$('summaryHours').textContent=a.hours||'Not supplied';$('summaryFeatured').textContent=a.featuredService||'None';$('summaryVoice').textContent=(a.language==='Thai'?'สวัสดีค่ะ ยินดีต้อนรับสู่ '+a.clinic+' มีอะไรให้ช่วยไหมคะ':'Hi, welcome to '+a.clinic+'. What can I help you with?')+(a.voiceReviewed?' · Voice tested':' · Test with Talk above');$('summaryBooking').textContent=a.bookingMode==='request'?'Appointment requests; clinic staff confirm availability':'Questions only; clinic staff handle bookings';$('summaryContact').textContent=[a.phone,a.mapsUrl].filter(Boolean).join(' · ')||'No phone or map saved';if(a.status==='published'){$('publishStatus').textContent='Your AI receptionist page is published.';const link=document.createElement('a');link.href=a.publicUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent=link.href;$('publicLink').replaceChildren(link);$('liveConversationUpgrade').hidden=a.bookingMode!=='request'}"],
    ["'Edit and confirm your wall lettering and signs below.'",
      "(assistant.heroIsUpload?'Review your reception photo below.':'Edit and confirm your wall lettering and signs below.')"],
    ["    [!a.heroApproved,'Check and approve the wall scene','wallSceneCard'],",
      "    [!a.heroApproved,a.heroIsUpload?'Check and confirm the reception photo':'Check and approve the wall scene','wallSceneCard'],"],
    ["</style></head><body>",
      `#wallPhotoControls{margin:18px 0}
#wallPhotoControls summary{cursor:pointer;font-weight:700}
#wallPhotoControls label{max-width:420px;margin-top:12px}
#useTemplateWall{margin:0 0 12px}
</style></head><body>`],
  ];
  for (const [from,to] of changes) source = replace(source,from,to);
  return source.replace("<!doctype html>", "<!doctype html><!-- " + marker + " -->");
}

const files = [
  ['assistant-core.js', updateWorker],
  ['assistant-setup/index.html', updatePage]
].map(([path, update]) => {
  const before = readFileSync(join(root, path), 'utf8');
  if (!before.includes('Eden owner wall and interview guidance v1')) throw Error('Install the wall and interview guidance update first.');
  return {path, before, after: before.includes(marker) ? before : update(before)};
});

const validate = (code, label) => {
  try {
    execFileSync(process.execPath, ['--check', '--input-type=module'], {input: code, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']});
  } catch {
    throw Error('Updated ' + label + ' failed JavaScript syntax validation.');
  }
};
validate(files[0].after, files[0].path);
const pageScript = files[1].after.match(/<script type="module">([\s\S]+?)<\/script>/)?.[1];
if (!pageScript) throw Error('Could not find the setup page script.');
validate(pageScript, files[1].path);
const changed = files.filter(file => file.before !== file.after);
if (check || !changed.length) {
  console.log('Photo upload check passed. ' + changed.length + ' file(s) would change.');
} else {
  const backup = mkdtempSync(join(tmpdir(), 'eden-owner-wall-photo-'));
  for (const {path, before} of changed) {
    if (readFileSync(join(root, path), 'utf8') !== before) throw Error('Setup changed during the update. Run the installer again.');
    mkdirSync(dirname(join(backup, path)), {recursive:true});
    writeFileSync(join(backup, path), before);
  }
  try {
    for (const {path, after} of changed) writeFileSync(join(root, path), after);
  } catch (error) {
    for (const {path, before} of changed) writeFileSync(join(root, path), before);
    throw error;
  }
  console.log('Photo upload installed. Backup: ' + backup);
}
