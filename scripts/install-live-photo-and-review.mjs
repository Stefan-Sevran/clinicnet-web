import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: { check }, positionals: [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview'), ...rest] } =
  parseArgs({ allowPositionals: true, options: { check: { type: 'boolean' } } });
if (rest.length) throw Error('Pass one voice-preview folder, optionally followed by --check.');

const previous = 'Eden Tailormade live styles v1';
const marker = 'Eden live photo and review v1';
function replace(source, from, to) {
  if (source.split(from).length !== 2) throw Error('Unexpected setup version near ' + from.slice(0, 105) + '. No files were changed.');
  return source.replace(from, () => to);
}

function updateWorker(source) {
  if (source.includes(marker)) return source;
  if (!source.includes(previous)) throw Error('Install the Tailormade live styles update first.');
  const start = source.indexOf(' const x=input.styleOnly===true?{');
  const response = /return json\(ownerView\(\{\.\.\.next,updated_at:stamp,agent_id:agentId[\s\S]*?\}\)\);/.exec(source.slice(start));
  const inputStart = source.lastIndexOf('const input=await body(request);', start);
  if (start < 0 || inputStart < 0 || !response) throw Error('Could not find the live clinic details handler. No files were changed.');

  // The legacy restriction was evaluated before the details body could opt into a live update.
  const oldMessage = 'Published pages need an owner support review before changing clinic details.';
  const oldCondition = String.raw`(?:a\.status\s*===\s*['"]published['"]|a\.status\s*!==\s*['"]draft['"])`;
  const oldResponse = String.raw`return\s+json\(\{\s*error:\s*['"]${oldMessage.slice(0,-1)}\.['"]\s*\},\s*(?:403|409)\);?`;
  const legacyPattern = new RegExp(String.raw`if\s*\(\s*${oldCondition}\s*\)\s*(?:\{\s*${oldResponse}\s*\}|${oldResponse})`);
  const legacy = legacyPattern.exec(source)?.[0];
  const end = start + response.index + response[0].length;
  let handler = source.slice(inputStart, end);
  const before = handler;
  if (legacy && handler.includes(legacy)) handler = replace(handler, legacy, '');
  handler = replace(handler, 'const input=await body(request);', `const photoRequest=a.status==='published'&&request.headers.get('X-Eden-Live-Photo')==='1';
 const input=photoRequest?await body(request,Math.ceil(wallPhotoLimit/3)*4+5000):await body(request);`);
  handler = replace(handler, ' const x=input.styleOnly===true?{', ` if(a.status==='published'&&input.liveUpdate!==true)
   return json({error:'Select Update live receptionist to save this published page.'},409);
 const x=input.styleOnly===true?{`);
  handler = replace(handler, "   if(x.template!==a.template&&!uploadedWall(a))return json({error:'Use the current style when saving this live page.'},400);\n }",
    ` }
 let photoBytes;
 if(Object.hasOwn(input,'photo')){
   if(!updatingLive||!photoRequest||typeof input.photo!=='string'||input.photo.length>Math.ceil(wallPhotoLimit/3)*4)
     return json({error:'Choose a valid reception photo.'},400);
   try{photoBytes=Uint8Array.from(atob(input.photo),char=>char.charCodeAt(0));}
   catch{return json({error:'Could not read that photo. Choose a different image.'},400);}
   if(photoBytes.length>wallPhotoLimit||!validWallPhoto(photoBytes))
     return json({error:'Could not read that photo. Choose a different image.'},400);
   if(!env.EDEN_HERO_IMAGES)return json({error:'Photo storage is unavailable. Try again shortly.'},503);
 }
 if(updatingLive&&x.template!==a.template&&!uploadedWall(a)&&!photoBytes)
   return json({error:'Choose a Tailormade photo to use a new style on this live page.'},400);`);
  handler = replace(handler, ' const newScene=!updatingLive&&(next.clinic!==a.clinic||next.template!==a.template);',
    ' const newScene=Boolean(photoBytes)||(!updatingLive&&(next.clinic!==a.clinic||next.template!==a.template));');
  const wallKey = /const nextWall\s*=\s*/.exec(handler)?.[0];
  if (!wallKey) throw Error('Could not find the reception photo assignment. No files were changed.');
  handler = replace(handler, wallKey, "const nextWall=photoBytes?'upload/'+crypto.randomUUID():");
  handler = replace(handler, 'const nextWallBase=', 'const nextWallBase=photoBytes?null:');
  handler = replace(handler, ' const agentId=', ` if(photoBytes&&!await limit(env,'wall-photo:'+a.id,12,86400))
   return json({error:'You reached the daily photo upload limit. Try again tomorrow.'},429);
 const agentId=`);
  const agent = / const agentId=[^;]+;\n const stamp=now\(\);\n try\{/.exec(handler)?.[0];
  if (!agent) throw Error('Could not find the live receptionist save. No files were changed.');
  handler = replace(handler, agent, `
 const photoObject=photoBytes?wallPhotoObject({hero_key:nextWall}):null;
 let photoCommitted=false;
 try{
   if(photoObject)await env.EDEN_HERO_IMAGES.put(photoObject,photoBytes,{httpMetadata:{contentType:'image/jpeg'}});
  ${agent.slice(0, -'\n try{'.length)}
   try{`);
  const detailsUpdate = /const\s+([a-zA-Z_$][\w$]*)\s*=\s*await\s+[^;]*[.]prepare\(\s*(["'`])\s*UPDATE\s+clinic_assistants\s+SET\s+phone=CASE[\s\S]*?\2\s*\)\s*[.]bind\([\s\S]*?[.]run\(\);/.exec(handler);
  if (!detailsUpdate) throw Error('Could not find the saved clinic revision. No files were changed.');
  const [update, saved] = detailsUpdate;
  handler = replace(handler, update, update + '\n   if(photoObject)photoCommitted='+saved+'.meta?.changes===1;');
  handler = replace(handler, response[0], response[0] + `
 }finally{
   if(photoObject){
     if(!photoCommitted)await env.EDEN_HERO_IMAGES.delete(photoObject).catch(()=>{});
     else if(uploadedWall(a))await env.EDEN_HERO_IMAGES.delete(wallPhotoObject(a)).catch(()=>{});
   }
 }`);
  source = replace(source, before, handler);
  if (legacy && source.includes(legacy)) source = replace(source, legacy, '');
  if (source.includes(oldMessage)) throw Error('Could not replace the legacy published-details restriction. No files were changed.');

  return replace(source, '/* '+previous+' */', `/* ${previous} */
/* ${marker} */
body.theme-pearl{--section-frame:#cfae83;--section-inlay:#fbf3e9}
body.theme-lumi{--section-frame:#c49949;--section-inlay:#fff1cb}
body.theme-siam{--section-frame:#bca173;--section-inlay:#f4ebd9}
body.theme-pattaya{--section-frame:#79b7b9;--section-inlay:#e9f8f4}
body.theme-mabuhay{--section-frame:#91afb6;--section-inlay:#eff6f5}
body .details .service-list,body #request.request{
  border:2px solid var(--section-frame);
  box-shadow:inset 0 0 0 3px var(--section-inlay),0 14px 32px #26343e14;
}
body.theme-lumi .details .service-list,body.theme-lumi #request.request{
  border-width:3px;
  box-shadow:inset 0 0 0 2px var(--section-inlay),inset 0 0 0 3px #c4994966,0 16px 36px #5437431c;
}`);
}

function updatePage(source) {
  if (source.includes(marker)) return source;
  if (!source.includes(previous)) throw Error('Install the Tailormade live styles update first.');
  const patch = (from, to) => { source = replace(source, from, to); };
  patch('<!-- '+previous+' -->', '<!-- '+previous+' --><!-- '+marker+' -->');
  patch("  $('wallPhotoControls').hidden=assistant?.status==='published';\n", '');
  patch("  $('wallPhotoControls').hidden=published;\n", '');
  patch("? 'This is the reception image on your published page.'",
    "? (stagedLivePhoto()?'Preview of your new photo. Select Update live receptionist to publish it.':'This is the reception image on your published page.')");
  patch("  $('applyWallPhoto').hidden=!selectedWallPhoto||(!assistant&&uploadAfterCreate);",
    "  $('applyWallPhoto').hidden=!selectedWallPhoto||assistant?.status==='published'||(!assistant&&uploadAfterCreate);");
  patch("  $('uploadWallPhoto').disabled=wallCopyBusy||preparingWallPhoto||applyingWallPhoto;",
    "  $('uploadWallPhoto').disabled=wallCopyBusy||preparingWallPhoto||applyingWallPhoto||$('saveLiveReceptionist').dataset.actionState==='pending';");
  patch(`  if(wallCopyBusy||preparingWallPhoto||applyingWallPhoto||!files.length)return;`,
    `  if(wallCopyBusy||preparingWallPhoto||applyingWallPhoto||$('saveLiveReceptionist').dataset.actionState==='pending'||!files.length)return;`);
  patch(`let selectedWallPhoto, preparingWallPhoto=false, applyingWallPhoto=false;`,
    `let selectedWallPhoto, preparingWallPhoto=false, applyingWallPhoto=false, photoPreviewRevision=0;`);
  patch(`    selectedWallPhoto=photo;
    uploadAfterCreate=false;`, `    selectedWallPhoto=photo;
    photoPreviewRevision++;
    uploadAfterCreate=false;`);
  patch(`    status('tailormadeUploadStatus','Preview ready. Check Desktop and Mobile below, then choose Use this photo.');`,
    `    if(assistant?.status==='published')renderManageTemplates();
    status('tailormadeUploadStatus',assistant?.status==='published'
      ? 'Preview ready. Select Update live receptionist to publish this photo.'
      : 'Preview ready. Check Desktop and Mobile below, then choose Use this photo.');`);
  patch(`  status('tailormadeUploadStatus',assistant?.heroIsUpload?'Showing your saved photo.':'Showing the template artwork.');
  renderReceptionArtwork();`, `  status('tailormadeUploadStatus',assistant?.heroIsUpload?'Showing your saved photo.':'Showing the template artwork.');
  if(assistant?.status==='published')renderManageTemplates();
  else renderReceptionArtwork();`);
  patch(`  return a.heroIsUpload?($('editTemplate').value||a.template):a.template;
}`, `  return a.heroIsUpload||(a.status==='published'&&selectedWallPhoto)?($('editTemplate').value||a.template):a.template;
}
function stagedLivePhoto(){
  return assistant?.status==='published'?selectedWallPhoto:null;
}
function previewWithPhoto(html,photo){
  if(!photo)return html;
  const doc=new DOMParser().parseFromString(html,'text/html');
  const scene=doc.querySelector('.scene');
  if(!scene)return html;
  doc.body.classList.add('has-uploaded-wall');
  doc.querySelector('.sign-mobile')?.remove();
  const img=doc.createElement('img');
  img.src=photo.src;
  img.alt='Reception photo supplied by the clinic';
  img.width=1672;
  img.height=941;
  scene.replaceChildren(img);
  return '<!doctype html>'+doc.documentElement.outerHTML;
}`);
  patch('a.wallText,lettering]);', 'a.wallText,lettering,stagedLivePhoto()?photoPreviewRevision:0]);');
  patch('assistant.wallText,lettering,comparing]);', 'assistant.wallText,lettering,comparing,stagedLivePhoto()?photoPreviewRevision:0]);');
  patch("    $('pagePreview').srcdoc=html.replace('</head>',stamp+'</head>');",
    "    $('pagePreview').srcdoc=previewWithPhoto(html,stagedLivePhoto()).replace('</head>',stamp+'</head>');");
  patch("    frame.srcdoc=html.replace('</head>',stamp+'</head>');",
    "    frame.srcdoc=previewWithPhoto(html,comparing?null:stagedLivePhoto()).replace('</head>',stamp+'</head>');");
  patch("  $('editTemplate').disabled=published&&!a.heroIsUpload;",
    "  $('editTemplate').disabled=published&&!a.heroIsUpload&&!stagedLivePhoto();");
  patch("  if(published&&assistant.heroIsUpload){",
    "  if(published&&(assistant.heroIsUpload||stagedLivePhoto())){");
  patch(`  location.assign(assistant.publicUrl+'#owner-test='+(useWorkspace?'workspace':key));`, `  if(selectedPhotoStyle()!==assistant.template||stagedLivePhoto()){
    step(5);
    status('livePageStatus','Select Update live receptionist to publish your preview, then run the private test.');
    $('saveLiveReceptionist').focus({preventScroll:true});
    return;
  }
  window.open(assistant.publicUrl+'#owner-test='+(useWorkspace?'workspace':key),'_blank','noopener');`);
  patch('Save your selected Tailormade style, clinic facts, and public contact links.',
    'Save your Tailormade photo, selected style, clinic facts, and public contact links.');
  patch(`  if(current?.status!=='published')return;
  const facts=`, `  if(current?.status!=='published'||preparingWallPhoto||applyingWallPhoto)return;
  const photo=stagedLivePhoto();
  const facts=`);
  patch("  if(theme===current.template&&!contactChanged&&Object.entries(facts)",
    "  if(!photo&&theme===current.template&&!contactChanged&&Object.entries(facts)");
  patch("  if(contactChanged)payload.contact={...contact,confirmed:$('confirmContact').checked};",
    "  if(contactChanged)payload.contact={...contact,confirmed:$('confirmContact').checked};\n  if(photo)payload.photo=photo.src.split(',')[1];");
  patch(`  const disabled=controls.map(field=>field.disabled);
  controls.forEach(field=>field.disabled=true);
  status('livePageStatus',`, `  const disabled=controls.map(field=>field.disabled);
  controls.forEach(field=>field.disabled=true);
  syncPhotoControls();
  status('livePageStatus',`);
  patch(`    assistant=await api('/api/assistants/'+id+'/details',{method:'POST',body:JSON.stringify(payload)});
    renderManage();`, `    assistant=await api('/api/assistants/'+id+'/details',{
      method:'POST',body:JSON.stringify(payload),
      ...(photo?{headers:{'X-Eden-Live-Photo':'1'}}:{})
    });
    if(photo){
      selectedWallPhoto=undefined;
      savedArtwork={url:assistant.heroUrl,src:photo.src};
      status('tailormadeUploadStatus','Your reception photo is live.');
    }
    renderManage();`);
  patch("    controls.forEach((field,index)=>field.disabled=disabled[index]);\n  }\n};",
    "    controls.forEach((field,index)=>field.disabled=disabled[index]);\n    syncPhotoControls();\n  }\n};");
  patch(`    finally{if(button.dataset.actionState==='pending')actionState(id,'')}
  };
}
for(const [container,buttons]`, `    finally{
      if(button.dataset.actionState==='pending')actionState(id,'');
      if(id==='saveLiveReceptionist')syncPhotoControls();
    }
  };
}
for(const [container,buttons]`);
  return source;
}

const changes = [['assistant-core.js', updateWorker], ['assistant-setup/index.html', updatePage]].map(([path, update]) => {
  const file = join(root, path);
  const before = readFileSync(file, 'utf8');
  return { path, file, before, after: update(before) };
}).filter(({before,after}) => before !== after);

for (const {path,after} of changes) {
  const module = path.endsWith('.html') ? after.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] : after;
  if (!module) throw Error('Could not validate the setup code. No files were changed.');
  execFileSync(process.execPath, ['--input-type=module', '--check'], {
    input: module, stdio: ['pipe', 'inherit', 'inherit']
  });
}
if (check || !changes.length) {
  console.log('Live photo and review check passed. ' + changes.length + ' file(s) would change.');
} else {
  for (const {file,before} of changes) {
    if (readFileSync(file, 'utf8') !== before) throw Error('Setup files changed. Run the installer again.');
  }
  const backup = mkdtempSync(join(tmpdir(), 'eden-live-photo-and-review-'));
  const written = [];
  try {
    for (const entry of changes) {
      const {path,file,before,after} = entry;
      const saved = join(backup, path);
      mkdirSync(dirname(saved), {recursive:true});
      writeFileSync(saved, before);
      const temporary = file + '.eden-' + process.pid;
      writeFileSync(temporary,after,{flag:'wx'});
      try { renameSync(temporary,file); written.push(entry); }
      finally { rmSync(temporary,{force:true}); }
    }
  } catch(error) {
    for (const {file,before} of written.reverse()) writeFileSync(file,before);
    throw error;
  }
  console.log('Live photo and review installed. Backup: ' + backup);
}
