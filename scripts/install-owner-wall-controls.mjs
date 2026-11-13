import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {dirname,join} from 'node:path';

const args=process.argv.slice(2);
const check=args.includes('--check');
const [root=join(homedir(),'Desktop','clinicnet-voice-preview')]=args.filter(arg=>arg!=='--check');
const marker='Eden wall generation and photo controls v1';
const patches={
  "assets/eden-wall-lettering.js": [
    [
      "const text = surface.caps === false ? normalized : normalized.toUpperCase();",
      "const text = normalized;"
    ],
    [
      "    caps: false, center: true, x: 145, y: 20, width: 610, lowerWidth: 365, size: 103,\n    shear: .142,",
      "    center: true, x: 143, y: 17, width: 596, lowerWidth: 340, size: 101,\n    shear: .092,"
    ],
    [
      "    caps: false, center: true, x: 99",
      "    center: true, x: 99"
    ]
  ],
  "hero-image.js": [
    [
      "wall:'6,0 45,0 45,18.5 40,18.5 39.2,15.7 37,15 35,16 33.7,18 32.4,21 31.5,26 10,26 8.8,22 6,16'",
      "wall:'6,0 45.5,0 45.5,20 40.3,20 39.5,16.6 38.3,14.9 36.8,14.5 35.4,14.8 34.2,15.6 33.3,17.1 32.6,19.1 31.9,21.3 31.4,23.6 30.6,26 10,26 8.8,22 6,16', alignment:'Give both lines an almost horizontal baseline, with at most a very slight downward tilt to the right. The lower line must be smaller or shorter in physical width when needed so every letter and its halo fit to the left of the receptionist’s hair. Keep a clearly visible strip of clean wall between the name and her head. Keep lettering and light entirely out of the foreground, including fine hair and orchids.'"
    ],
    [
      "with this exact text, preserving any supplied line break.",
      "with this exact text, preserving uppercase, lowercase, accents, punctuation and any supplied line break. Reproduce each character in its original case even if the example is in capitals."
    ],
    [
      "The supplied name is the only text to add.`;",
      "The supplied name is the only text to add.${t.alignment?' '+t.alignment:''}`;"
    ]
  ],
  "assistant-core.js": [
    [
      "  text-align:center;text-transform:uppercase;",
      "  text-align:center;"
    ],
    [
      "const now = () => new Date().toISOString();",
      "const now = () => new Date().toISOString();\nconst dailyWallImageLimit=5;\nconst wallImageWindow=86400;\nasync function wallImageAllowance(env,id){\n  const bucket=await sha(`${env.PILOT_RATE_SALT}:owner-wall:${id}`);\n  const usage=await env.PILOT_DB.prepare('SELECT count, expires_at FROM assistant_rate WHERE bucket=?').bind(bucket).first();\n  const resetAt=usage?.expires_at*1000;\n  return resetAt>Date.now()\n    ? {remaining:Math.max(0,dailyWallImageLimit-usage.count),resetAt}\n    : {remaining:dailyWallImageLimit,resetAt:null};\n}"
    ],
    [
      "if(request.method==='GET'&&!action)return json(ownerView(a));",
      "if(request.method==='GET'&&!action)return json({...ownerView(a),wallImageAllowance:a.status==='published'?null:await wallImageAllowance(env,id)});"
    ],
    [
      "  if(canGenerate&&!await limit(env,'owner-wall:'+id,5,86400))\n    return json({error:'Five image attempts are available per day. Try again tomorrow or use the template wall below.'},429);\n",
      "  const allowance=canGenerate?await wallImageAllowance(env,id):null;\n  const limitMessage='You’ve used today’s AI image attempts. You can still edit and confirm your wall below.';\n  if(allowance?.remaining===0)return json({error:limitMessage,wallImageAllowance:allowance},429);\n"
    ],
    [
      "  if(claim.meta?.changes!==1)return json({error:'The wall or setup changed. Reload before trying again.'},409);\n\n  let key, objectKey",
      "  if(claim.meta?.changes!==1)return json({error:'The wall or setup changed. Reload before trying again.'},409);\n  if(canGenerate&&!await limit(env,'owner-wall:'+id,dailyWallImageLimit,wallImageWindow)){\n    await env.PILOT_DB.prepare(\"UPDATE clinic_assistants SET hero_status=?,hero_attempts=?,updated_at=? WHERE id=? AND updated_at=? AND hero_status='generating' AND hero_attempts=?\")\n      .bind(a.hero_status,a.hero_attempts||0,a.updated_at,id,claimTime,attempt).run();\n    return json({error:limitMessage,wallImageAllowance:await wallImageAllowance(env,id)},429);\n  }\n\n  let key, objectKey"
    ],
    [
      "review_approved_at:keepApproval?a.review_approved_at:null}),wallNotice:notice});",
      "review_approved_at:keepApproval?a.review_approved_at:null}),wallNotice:notice,wallImageAllowance:await wallImageAllowance(env,id)});"
    ]
  ],
  "assistant-setup/index.html": [
    [
      "/assets/eden-wall-lettering.js?v=photographic-finish-2",
      "/assets/eden-wall-lettering.js?v=wall-letter-case-1"
    ],
    [
      "#generateWallFinish:hover:enabled{background:#174a3e;color:#fff}",
      "#generateWallFinish:hover:enabled{background:#174a3e;color:#fff}\n#generateWallFinish[data-generating=true]{opacity:1;background:#174a3e;color:#fff;cursor:progress}\n#generateWallFinish[data-generating=true]::before{content:\"\";display:inline-block;vertical-align:-.12em;width:.9em;height:.9em;border:2px solid #fff6;border-top-color:#fff;border-radius:50%;margin-inline-end:.6em;animation:wall-spin .85s linear infinite}\n@keyframes wall-spin{to{transform:rotate(360deg)}}\n@media(prefers-reduced-motion:reduce){#generateWallFinish[data-generating=true]::before{animation:none}}\n#wallImageAllowance{font-size:.9rem;color:var(--muted)}\n#wallImageAllowance[hidden]{display:none}\n#wallFinishStatus:not(:empty){font-weight:650}\n#wallPhotoDrop{display:grid;justify-items:center;text-align:center;gap:8px;padding:clamp(15px,3vw,28px);border:2px dashed #93b3a2;border-radius:14px;background:#f1f7f0}\n#wallPhotoDrop[data-dragging=true]{border-color:#174a3e;background:#dfefe5}\n#wallPhotoDrop p{margin:0}\n#wallPhotoDrop .muted,#wallPhotoFilename{overflow-wrap:anywhere}\n#uploadWallPhoto{background:#174a3e;color:#fff;border-color:#174a3e}\n#uploadWallPhoto:hover:enabled{background:#246254}\n#retryWallPhoto{margin-top:8px}"
    ],
    [
      "    <label class=\"field\"><span>Reception photo</span><input type=\"file\" id=\"wallPhotoFile\" accept=\"image/jpeg,image/png,image/webp\"></label>\n    <p>Ideal size 1672 × 941 px. JPG, PNG or WebP under 12 MB. The public page uses a wide crop.</p>\n    <button type=\"button\" id=\"uploadWallPhoto\" class=\"btn light\">Upload photo</button>\n    <p id=\"tailormadeUploadStatus\" class=\"status\" role=\"status\"></p>",
      "    <div id=\"wallPhotoDrop\">\n      <input type=\"file\" id=\"wallPhotoFile\" accept=\"image/jpeg,image/png,image/webp\" hidden>\n      <button type=\"button\" id=\"uploadWallPhoto\" class=\"btn\" aria-describedby=\"wallPhotoHelp\">Upload photo</button>\n      <p>or drag and drop a reception photo here</p>\n      <p id=\"wallPhotoHelp\" class=\"muted\">JPG, PNG or WebP under 12 MB. Ideal size 1672 × 941 px.</p>\n      <p id=\"wallPhotoFilename\" hidden></p>\n    </div>\n    <p id=\"tailormadeUploadStatus\" class=\"status\" role=\"status\"></p>\n    <button type=\"button\" id=\"retryWallPhoto\" class=\"btn light\" hidden>Retry upload</button>"
    ],
    [
      "  <button id=\"generateWallFinish\" type=\"button\" aria-describedby=\"wallFinishHelp\">✦ Generate AI image</button>\n  <p id=\"wallFinishHelp\">Generate a photographic version of the wall lettering. Check the spelling and desk signs before confirming.</p>",
      "  <button id=\"generateWallFinish\" type=\"button\" aria-describedby=\"wallFinishHelp wallImageAllowance\">✦ Generate AI image</button>\n  <p id=\"wallFinishHelp\">Click Generate AI image for increased realism of the wall lettering.<br>Check spelling and desk signs before confirming.</p>\n  <p id=\"wallImageAllowance\" hidden></p>"
    ],
    [
      "await $('uploadWallPhoto').onclick();",
      "await uploadSelectedWallPhoto();"
    ],
    [
      "async function reload(){assistant=await api('/api/assistants/'+id);renderManage();populateDetails()}",
      "async function reload(){assistant=await api('/api/assistants/'+id);wallImageAllowance=assistant.wallImageAllowance;renderManage();populateDetails()}"
    ],
    [
      "let wallCopyDirty=false, wallCopyBusy=false;",
      "let wallCopyDirty=false, wallCopyBusy=false, generatingWallImage=false;\nlet wallImageAllowance, wallImageResetTimer;"
    ],
    [
      "  $('generateWallFinish').disabled=wallCopyBusy;",
      "  const generate=$('generateWallFinish');\n  const allowance=$('wallImageAllowance');\n  const quota=wallImageAllowance;\n  clearTimeout(wallImageResetTimer);\n  if(quota?.resetAt&&quota.resetAt>Date.now()){\n    wallImageResetTimer=setTimeout(()=>{\n      api('/api/assistants/'+id).then(current=>{\n        wallImageAllowance=current.wallImageAllowance;\n        renderWallLettering();\n      }).catch(()=>{});\n    },quota.resetAt-Date.now()+250);\n  }\n  const blocked=quota?.remaining===0;\n  generate.disabled=wallCopyBusy||blocked;\n  generate.dataset.generating=String(generatingWallImage);\n  generate.textContent=generatingWallImage?'Generating AI image…':'✦ Generate AI image';\n  if(generatingWallImage)generate.setAttribute('aria-busy','true');\n  else generate.removeAttribute('aria-busy');\n  allowance.hidden=!quota;\n  if(quota){\n    const reset=quota.resetAt?new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(quota.resetAt):'';\n    const remaining=quota.remaining===1?'1 AI image attempt':quota.remaining+' AI image attempts';\n    allowance.textContent=(blocked?'AI image limit reached. '+(reset?'More attempts available '+reset+'. ':''):remaining+' left'+(reset?' · Resets '+reset:'')+'. ')+\n      'Editing the live lettering preview uses no attempts.';\n  }"
    ],
    [
      "const photoButtons=['uploadWallPhoto','useTemplateWall'];",
      "const photoButtons=['uploadWallPhoto','retryWallPhoto','useTemplateWall'];\nlet selectedWallPhoto, preparingWallPhoto=false;"
    ],
    [
      "const target=button==='uploadWallPhoto'?'tailormadeUploadStatus':'wallStatus';",
      "const target=button==='uploadWallPhoto'?'tailormadeUploadStatus':'wallStatus';\n  let uploaded=false;"
    ],
    [
      "    if(button==='uploadWallPhoto')$('wallSceneCard').scrollIntoView({block:'start'});",
      "    if(button==='uploadWallPhoto'){\n      uploaded=true;\n      $('wallSceneCard').scrollIntoView({block:'start'});\n    }"
    ],
    [
      "    renderWallLettering();\n  }\n}\n\n$('uploadWallPhoto').onclick=async()=>{\n  const file=$('wallPhotoFile').files[0];\n  if(!file){$('wallPhotoFile').focus();return status('tailormadeUploadStatus','Choose a photo to upload.',true)}\n  if(!assistant){\n    try{await prepareWallPhoto(file)}\n    catch(error){return status('tailormadeUploadStatus',error.message,true)}\n    if($('wallPhotoFile').files[0]!==file)return;\n    if(assistant)return $('uploadWallPhoto').onclick();\n    uploadAfterCreate=true;\n    status('tailormadeUploadStatus','Photo ready to upload after you save your clinic details.');\n    step(3);\n    return;\n  }\n  let image;\n  await changeWallPhoto('uploadWallPhoto',async revision=>{\n    image??=await prepareWallPhoto(file);\n    const data=await api('/api/assistants/'+id+'/wall-photo',{\n      method:'POST',\n      headers:{'Content-Type':'image/jpeg','X-Eden-Wall-Revision':revision},\n      body:image\n    });\n    $('wallPhotoFile').value='';\n    return data;\n  },'Photo uploaded. Review it in Your clinic name on the reception wall.');\n};\n$('wallPhotoFile').onchange=()=>{\n  uploadAfterCreate=false;\n  actionState('uploadWallPhoto','');\n  status('tailormadeUploadStatus','');\n};",
      "    renderWallLettering();\n  }\n  return uploaded;\n}\n\nasync function uploadSelectedWallPhoto(){\n  if(!selectedWallPhoto||wallCopyBusy||preparingWallPhoto)return;\n  const file=selectedWallPhoto;\n  $('retryWallPhoto').hidden=true;\n  if(!assistant){\n    preparingWallPhoto=true;\n    $('uploadWallPhoto').disabled=true;\n    status('tailormadeUploadStatus','Preparing your photo…');\n    try{\n      await prepareWallPhoto(file);\n    }catch(error){\n      status('tailormadeUploadStatus',error.message,true);\n      return;\n    }finally{\n      preparingWallPhoto=false;\n      $('uploadWallPhoto').disabled=false;\n    }\n    if(assistant)return uploadSelectedWallPhoto();\n    uploadAfterCreate=true;\n    status('tailormadeUploadStatus','Photo selected. It will upload when you save your clinic details.');\n    step(3);\n    return;\n  }\n  let image;\n  const uploaded=await changeWallPhoto('uploadWallPhoto',async revision=>{\n    image??=await prepareWallPhoto(file);\n    return api('/api/assistants/'+id+'/wall-photo',{\n      method:'POST',\n      headers:{'Content-Type':'image/jpeg','X-Eden-Wall-Revision':revision},\n      body:image\n    });\n  },'Photo uploaded. Review it in Your clinic name on the reception wall.');\n  if(uploaded)selectedWallPhoto=undefined;\n  $('retryWallPhoto').hidden=uploaded||assistant.status==='published';\n}\n\nfunction selectWallPhoto(files){\n  if(wallCopyBusy||preparingWallPhoto||!files.length)return;\n  if(files.length!==1){\n    status('tailormadeUploadStatus','Choose one reception photo at a time.',true);\n    return;\n  }\n  selectedWallPhoto=files[0];\n  uploadAfterCreate=false;\n  actionState('uploadWallPhoto','');\n  const filename=$('wallPhotoFilename');\n  filename.textContent=selectedWallPhoto.name;\n  filename.hidden=false;\n  void uploadSelectedWallPhoto();\n}\n\n$('uploadWallPhoto').onclick=()=>$('wallPhotoFile').click();\n$('retryWallPhoto').onclick=uploadSelectedWallPhoto;\n$('wallPhotoFile').onchange=event=>{\n  selectWallPhoto(event.currentTarget.files);\n  event.currentTarget.value='';\n};\nconst wallPhotoDrop=$('wallPhotoDrop');\nfor(const type of ['dragenter','dragover'])wallPhotoDrop.addEventListener(type,event=>{\n  if(!event.dataTransfer?.types.includes('Files'))return;\n  event.preventDefault();\n  event.dataTransfer.dropEffect=wallCopyBusy||preparingWallPhoto?'none':'copy';\n  if(!wallCopyBusy&&!preparingWallPhoto)wallPhotoDrop.dataset.dragging='true';\n});\nwallPhotoDrop.addEventListener('dragleave',event=>{\n  if(!wallPhotoDrop.contains(event.relatedTarget))delete wallPhotoDrop.dataset.dragging;\n});\nwallPhotoDrop.addEventListener('drop',event=>{\n  event.preventDefault();\n  delete wallPhotoDrop.dataset.dragging;\n  if(event.dataTransfer)selectWallPhoto(event.dataTransfer.files);\n});"
    ],
    [
      "status('wallFinishStatus',generating?'Generating your final image. This may take a moment.':'Restoring editable lettering…');",
      "status('wallFinishStatus',generating?'This may take a moment. Your current preview stays visible while the image generates.':'Restoring editable lettering…');"
    ],
    [
      "  const generating=action==='hero-generate';\n  wallCopyBusy=true;",
      "  const generating=action==='hero-generate';\n  if(generating&&wallImageAllowance?.remaining===0)return;\n  generatingWallImage=generating;\n  wallCopyBusy=true;"
    ],
    [
      "    assistant=result;\n    wallCopyDirty=Object.entries(deskInputs)",
      "    assistant=result;\n    if(result.wallImageAllowance)wallImageAllowance=result.wallImageAllowance;\n    wallCopyDirty=Object.entries(deskInputs)"
    ],
    [
      "  }catch(error){\n    status('wallFinishStatus',error.status===401\n      ?'Your setup session expired. Reopen setup from Clinic Workspace to continue.' : error.message,true);\n  }finally{\n    wallCopyBusy=false;\n    for(const id of wallCopyFields)$(id).readOnly=false;\n    renderWallLettering();\n  }\n}",
      "  }catch(error){\n    if(error.wallImageAllowance)wallImageAllowance=error.wallImageAllowance;\n    status('wallFinishStatus',error.status===401\n      ?'Your setup session expired. Reopen setup from Clinic Workspace to continue.' : error.message,!error.wallImageAllowance);\n  }finally{\n    generatingWallImage=false;\n    wallCopyBusy=false;\n    for(const id of wallCopyFields)$(id).readOnly=false;\n    renderWallLettering();\n  }\n}"
    ],
    [
      "{field:j.field,status:r.status}",
      "{field:j.field,status:r.status,wallImageAllowance:j.wallImageAllowance}"
    ]
  ]
};
function replace(source,before,after,path){
  if(source.split(before).length!==2)throw Error('Unexpected '+path+' near '+before.slice(0,100));
  return source.replace(before,()=>after);
}
const files=Object.entries(patches).map(([path,changes])=>{
  const before=readFileSync(join(root,path),'utf8');
  if(before.includes(marker))return {path,before,after:before};
  let after=before;
  for(const [from,to] of changes)after=replace(after,from,to,path);
  if(path.endsWith('.html'))after=after.replace('<!doctype html>','<!doctype html><!-- '+marker+' -->');
  else after='// '+marker+'\n'+after;
  const code=path.endsWith('.html')?after.match(/<script type="module">([\s\S]+?)<\/script>/)?.[1]:after;
  if(!code)throw Error('Could not find the setup page script.');
  execFileSync(process.execPath,['--check','--input-type=module'],{input:code,encoding:'utf8'});
  return {path,before,after};
});
const changed=files.filter(file=>file.before!==file.after);
if(check||!changed.length){
  console.log('Wall controls check passed. '+changed.length+' file(s) would change.');
}else{
  const backup=mkdtempSync(join(tmpdir(),'eden-owner-next-'));
  for(const {path,before} of changed){
    if(readFileSync(join(root,path),'utf8')!==before)throw Error('Setup changed during the update. Run the installer again.');
    mkdirSync(dirname(join(backup,path)),{recursive:true});
    writeFileSync(join(backup,path),before);
  }
  try{
    for(const {path,after} of changed)writeFileSync(join(root,path),after);
  }catch(error){
    for(const {path,before} of changed)writeFileSync(join(root,path),before);
    throw error;
  }
  console.log('Wall controls updated. Backup: '+backup);
}
