import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: { check }, positionals: [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview'), ...rest] } =
  parseArgs({ allowPositionals: true, options: { check: { type: 'boolean' } } });
if (rest.length) throw Error('Pass one voice-preview folder, optionally followed by --check.');

const file = join(root, 'assistant-setup', 'index.html');
const before = readFileSync(file, 'utf8');
const marker = '<!-- Eden Tailormade hero previews v1 -->';
if (before.includes(marker)) {
  console.log('Tailormade hero previews are already installed.');
  process.exit(0);
}

let html = before;
function replace(from, to) {
  if (html.split(from).length !== 2) throw Error('Unexpected setup page near ' + from.slice(0, 115) + '. No files were changed.');
  html = html.replace(from, () => to);
}

replace('<!doctype html>', '<!doctype html>' + marker);
replace('Upload your own reception image or ask Eden to help set up your receptionist and design a custom scene.',
  'Choose any template for the page style, then add your own hero photo. The Desktop and Mobile previews below show how they fit together.');
replace('JPG, PNG or WebP under 12 MB. Ideal size 1672 × 941 px.',
  'JPG, PNG or WebP up to 12 MB. A wide 16:9 image fills the hero. Other shapes get space around the sides or edges so the full photo stays visible.');
const uploadStatus = '<p id="tailormadeUploadStatus" class="status" role="status"></p>';
replace(uploadStatus, uploadStatus + '\n    <button type="button" id="applyWallPhoto" class="btn" hidden>Use this photo</button>\n    <button type="button" id="discardWallPhoto" class="btn light" hidden>Discard selected photo</button>');
for (const id of ['selectedFrame', 'manageStylePreview']) {
  const frame = new RegExp('<iframe id="' + id + '"[^>]*></iframe>').exec(html)?.[0];
  if (!frame) throw Error('Could not find the ' + id + ' preview.');
  replace(frame, '<p class="tailormade-preview-status status" role="status" hidden></p>' + frame);
}
// Keep the choice of photo independent from the choice of style.
replace("$('selectedFrame').src='/__eden/template-preview/'+t.id+'/?v=wall-samples-2';", '');
replace(`  if(card){
    tailormadeOpen=false;
    renderTailormade();
    showTalkTemplate(card.dataset.id);
  }`, `  if(card)renderReceptionArtwork(card.dataset.id);`);
replace(`  if(!card||$('chooseStyle').disabled)return;
  tailormadeOpen=false;
  $('editTemplate').value=card.dataset.id;`, `  if(!card||$('chooseStyle').disabled||applyingWallPhoto)return;
  $('editTemplate').value=card.dataset.id;`);
replace(`  if(tailormadeOpen)$('tailormadePanel').scrollIntoView({block:'nearest'});`, `  if(tailormadeOpen){
    renderReceptionArtwork();
    $('tailormadePanel').scrollIntoView({block:'nearest'});
  }`);
replace(`  for(const id of [...photoButtons,'wallPhotoFile'])$(id).disabled=wallCopyBusy;`,
  '  syncPhotoControls();');
replace(`const photoButtons=['uploadWallPhoto','retryWallPhoto','useTemplateWall'];
let selectedWallPhoto, preparingWallPhoto=false;`, `let selectedWallPhoto, preparingWallPhoto=false, applyingWallPhoto=false;
let savedArtwork = {};
const styleSamples = new Map();
const frameArtwork = new WeakMap();

function syncPhotoControls(){
  $('uploadWallPhoto').disabled=wallCopyBusy||preparingWallPhoto||applyingWallPhoto;
  $('wallPhotoFile').disabled=$('uploadWallPhoto').disabled;
  $('applyWallPhoto').disabled=$('uploadWallPhoto').disabled;
  $('applyWallPhoto').textContent=applyingWallPhoto?'Saving photo…':'Use this photo';
  $('applyWallPhoto').setAttribute('aria-busy',String(applyingWallPhoto));
  $('applyWallPhoto').hidden=!selectedWallPhoto||(!assistant&&uploadAfterCreate);
  $('discardWallPhoto').hidden=!selectedWallPhoto;
  $('discardWallPhoto').disabled=$('uploadWallPhoto').disabled;
  $('retryWallPhoto').disabled=$('uploadWallPhoto').disabled;
  $('useTemplateWall').disabled=wallCopyBusy||preparingWallPhoto;
  $('uploadWallPhoto').textContent=selectedWallPhoto||assistant?.heroIsUpload?'Choose another photo':'Upload photo';
}

function styleSample(theme,url){
  if(!styleSamples.has(theme)){
    const sample=fetch(url,{redirect:'error'}).then(response=>{
      if(!response.ok)throw Error('Could not load the selected template.');
      return response.text();
    }).catch(error=>{
      styleSamples.delete(theme);
      throw error;
    });
    styleSamples.set(theme,sample);
  }
  return styleSamples.get(theme);
}

async function paintChooseArtwork(frame,theme,source,clinic){
  const url='/__eden/template-preview/'+encodeURIComponent(theme)+'/?v=wall-samples-4';
  const previous=frameArtwork.get(frame);
  if(previous?.theme===theme&&previous.source===source&&previous.clinic===clinic)return;
  const artwork={theme,source,clinic};
  frameArtwork.set(frame,artwork);
  const notice=frame.previousElementSibling;
  notice.hidden=true;
  if(!source){
    if(frame.getAttribute('src')!==url)frame.src=url;
    frame.removeAttribute('srcdoc');
    frame.hidden=!!assistant?.heroIsUpload;
    if(frame.hidden){
      notice.textContent=savedArtwork.failed?'Could not load the saved photo. Reopen Tailormade to retry.':'Loading your saved photo…';
      notice.hidden=false;
    }
    return;
  }

  const doc=new DOMParser().parseFromString(await styleSample(theme,url).catch(()=>''),'text/html');
  if(frameArtwork.get(frame)!==artwork)return;
  let scene=doc.querySelector('.scene');
  if(!scene){
    // Keep the photo visible if the sample body is temporarily unavailable.
    frameArtwork.delete(frame);
    notice.textContent='The selected page style could not load. The hero photo is shown below.';
    notice.hidden=false;
    scene=doc.body.appendChild(doc.createElement('section'));
    const style=doc.head.appendChild(doc.createElement('style'));
    style.textContent='body{margin:0;font-family:system-ui}img{display:block;width:100%}h1{text-align:center}';
  }
  doc.body.classList.add('has-uploaded-wall');
  const image=doc.createElement('img');
  image.src=source;
  image.alt=clinic+' reception photo';
  image.width=1672;
  image.height=941;
  scene.replaceChildren(image);
  const name=doc.createElement('section');
  name.className='photo-clinic-name';
  const heading=name.appendChild(doc.createElement('h1'));
  heading.textContent=clinic;
  scene.after(name);
  frame.srcdoc='<!doctype html>'+doc.documentElement.outerHTML;
  frame.hidden=false;
}

function loadSavedArtwork(){
  const url=assistant?.heroIsUpload&&assistant.heroUrl;
  if(!url){
    savedArtwork={};
    return;
  }
  if(savedArtwork.url===url)return;
  const artwork={url};
  savedArtwork=artwork;
  void previewHtml().then(markup=>{
    const doc=new DOMParser().parseFromString(markup,'text/html');
    const source=doc.querySelector('.scene img')?.getAttribute('src');
    if(!/^data:image\\/jpeg;base64,[a-z0-9+/]+=*$/i.test(source||'')&&source!==url)
      throw Error('Could not load the saved photo.');
    artwork.src=source;
  }).catch(()=>{
    artwork.failed=true;
  }).finally(()=>{
    if(savedArtwork===artwork)renderReceptionArtwork();
  });
}

function renderReceptionArtwork(theme=assistant?($('editTemplate').value||assistant.template):template){
  if(!templates.some(item=>item.id===theme))return;
  loadSavedArtwork();
  const source=selectedWallPhoto?.src||savedArtwork.src;
  const frame=$(assistant?'manageStylePreview':'selectedFrame');
  // The pending and failed states share an empty source, but use different status text.
  if(savedArtwork.failed&&!source)frameArtwork.delete(frame);
  void paintChooseArtwork(frame,theme,source,assistant?.clinic||$('clinic').value.trim()||'Your clinic name');
  const image=$('eveTemplateImage');
  image.hidden=!!assistant?.heroIsUpload&&!source;
  if(source){
    if(image.getAttribute('src')!==source)image.src=source;
    image.alt='Your reception photo';
  }else if(!image.hidden){
    showTalkTemplate(assistant?.template||theme);
  }
}`);
replace(`  if(tailormadeOpen){
    renderReceptionArtwork();`, `  if(tailormadeOpen){
    if(savedArtwork.failed)savedArtwork={};
    renderReceptionArtwork();`);
replace(`  $('wallPhotoControls').hidden=assistant?.status==='published';`,
  `  $('wallPhotoControls').hidden=assistant?.status==='published';
  syncPhotoControls();`);
replace(`  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>12000000)
    throw Error('Choose a JPG, PNG or WebP file under 12 MB.');`,
  `  if(!['image/jpeg','image/png','image/webp'].includes(file.type))
    throw Error('Choose a JPG, PNG or WebP photo.');
  if(file.size>12000000)throw Error('This photo is over 12 MB. Choose a smaller file.');`);
replace('    await photo.decode();', `    try{await photo.decode()}
    catch{throw Error('This photo could not be opened. Try a different JPG, PNG or WebP file.');}`);
replace('const scale=Math.max(canvas.width/photo.naturalWidth,canvas.height/photo.naturalHeight);',
  'const scale=Math.min(canvas.width/photo.naturalWidth,canvas.height/photo.naturalHeight);');
replace(`    const image=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.86));
    if(!image||image.size>1500000)throw Error('Could not prepare the photo. Choose a smaller image.');
    return image;`, `    let image;
    for(const quality of [.86,.75,.65]){
      image=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
      if(image&&image.size<=1500000)break;
    }
    if(!image||image.size>1500000)throw Error('Could not prepare the photo. Choose a smaller image.');
    const src=await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result);
      reader.onerror=()=>reject(Error('Could not preview the photo. Choose another image.'));
      reader.readAsDataURL(image);
    });
    return {image,src};`);
replace(`    if(button==='uploadWallPhoto'){
      uploaded=true;
      $('wallSceneCard').scrollIntoView({block:'start'});
    }`, `    if(button==='uploadWallPhoto')uploaded=true;`);
const uploadStart = html.indexOf('async function uploadSelectedWallPhoto(){');
const uploadEnd = html.indexOf("\$('wallPhotoFile').onchange", uploadStart);
if (uploadStart < 0 || uploadEnd < 0) throw Error('Could not locate the Tailormade upload workflow.');
replace(html.slice(uploadStart, uploadEnd), `async function uploadSelectedWallPhoto(){
  if(!selectedWallPhoto||wallCopyBusy||preparingWallPhoto||applyingWallPhoto)return false;
  if(!assistant){
    uploadAfterCreate=true;
    status('tailormadeUploadStatus','Photo selected. It will save with your clinic details.');
    syncPhotoControls();
    step(useWorkspace?2:3);
    return true;
  }
  applyingWallPhoto=true;
  syncPhotoControls();
  $('retryWallPhoto').hidden=true;
  const photo=selectedWallPhoto;
  const theme=$('editTemplate').value;
  try{
    if(theme&&theme!==assistant.template){
      await $('chooseStyle').onclick();
      if(theme!==assistant.template){
        status('tailormadeUploadStatus','Save the selected page style before retrying the photo.',true);
        return false;
      }
    }
    const uploaded=await changeWallPhoto('uploadWallPhoto',async revision=>{
      const result=await api('/api/assistants/'+id+'/wall-photo',{
        method:'POST',
        headers:{'Content-Type':'image/jpeg','X-Eden-Wall-Revision':revision},
        body:photo.image
      });
      savedArtwork={url:result.heroUrl,src:photo.src};
      return result;
    },'Photo saved. It will be used on your receptionist page.');
    if(uploaded){
      selectedWallPhoto=undefined;
      renderReceptionArtwork();
    }
    $('retryWallPhoto').hidden=uploaded||assistant.status==='published';
    return uploaded;
  }finally{
    applyingWallPhoto=false;
    syncPhotoControls();
  }
}

async function selectWallPhoto(files){
  if(wallCopyBusy||preparingWallPhoto||applyingWallPhoto||!files.length)return;
  if(files.length!==1){
    status('tailormadeUploadStatus','Choose one reception photo at a time.',true);
    return;
  }
  const file=files[0];
  preparingWallPhoto=true;
  syncPhotoControls();
  status('tailormadeUploadStatus','Preparing your preview…');
  try{
    const photo=await prepareWallPhoto(file);
    selectedWallPhoto=photo;
    uploadAfterCreate=false;
    actionState('uploadWallPhoto','');
    $('retryWallPhoto').hidden=true;
    $('wallPhotoFilename').textContent=file.name;
    $('wallPhotoFilename').hidden=false;
    renderReceptionArtwork();
    status('tailormadeUploadStatus','Preview ready. Check Desktop and Mobile below, then choose Use this photo.');
  }catch(error){
    status('tailormadeUploadStatus',error.message,true);
  }finally{
    preparingWallPhoto=false;
    syncPhotoControls();
  }
}

$('uploadWallPhoto').onclick=()=>$('wallPhotoFile').click();
$('applyWallPhoto').onclick=async()=>{
  if(assistant){
    if(await uploadSelectedWallPhoto())step(2);
  }else await uploadSelectedWallPhoto();
};
$('discardWallPhoto').onclick=()=>{
  selectedWallPhoto=undefined;
  uploadAfterCreate=false;
  $('wallPhotoFilename').hidden=true;
  $('retryWallPhoto').hidden=true;
  status('tailormadeUploadStatus',assistant?.heroIsUpload?'Showing your saved photo.':'Showing the template artwork.');
  renderReceptionArtwork();
  syncPhotoControls();
};
$('retryWallPhoto').onclick=()=>uploadSelectedWallPhoto();
`);
replace(`$('create').onclick=async()=>{
  if(eveBusy)return;`, `$('create').onclick=async()=>{
  if(eveBusy||preparingWallPhoto)return;
  if(selectedWallPhoto&&!uploadAfterCreate&&!assistant){
    tailormadeOpen=true;
    renderTailormade();
    status('tailormadeUploadStatus','Choose Use this photo or discard it before saving your clinic details.',true);
    step(1);
    return;
  }`);
replace(`      await uploadSelectedWallPhoto();
      return;`, `      if(!await uploadSelectedWallPhoto()){
        step(1);
        return;
      }`);
replace(`function renderStylePreview(theme){
  const frame=$('manageStylePreview');
  if(frame.dataset.template!==theme){
    frame.dataset.template=theme;
    frame.src='/__eden/template-preview/'+encodeURIComponent(theme)+'/?v=wall-samples-4';
  }
  frame.hidden=false;
}`, `function renderStylePreview(theme){
  renderReceptionArtwork(theme);
}`);
replace("  showTalkTemplate(assistant.template);\n}", '}');
replace("    status('manageChooseStatus','Style saved. Personalize your wall lettering and signs below.');",
  "    status('manageChooseStatus',assistant.heroIsUpload?'Page style saved with your photo.':'Style saved. Personalize your wall lettering and signs below.');");

const module = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
if (!module) throw Error('Could not validate the setup code. No files were changed.');
execFileSync(process.execPath, ['--input-type=module', '--check'], {
  input: module, stdio: ['pipe', 'inherit', 'inherit']
});
if (check) {
  console.log('Tailormade hero preview checks passed. assistant-setup/index.html would change.');
} else {
  const backup = mkdtempSync(join(tmpdir(), 'eden-tailormade-photo-'));
  writeFileSync(join(backup, 'index.html'), before);
  if (readFileSync(file, 'utf8') !== before) throw Error('The setup file changed. Run the installer again.');
  const temporary = file + '.eden-' + process.pid;
  writeFileSync(temporary, html, { flag: 'wx' });
  try { renameSync(temporary, file); }
  finally { rmSync(temporary, { force: true }); }
  console.log('Tailormade hero previews installed. Backup: ' + backup);
}
