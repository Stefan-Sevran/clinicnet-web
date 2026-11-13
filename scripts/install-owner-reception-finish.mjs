import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {dirname,join} from 'node:path';

const args=process.argv.slice(2);
const check=args.includes('--check');
const [root=join(homedir(),'Desktop','clinicnet-voice-preview')]=args.filter(arg=>arg!=='--check');
const marker='Eden reception finish and setup flow v1';
const patches={
  "assets/eden-wall-lettering.js": [
    [
      "material: {blur: 2.6, falloff: 5.8, cast: .44",
      "material: {baseShadow: .6, blur: 2.6, falloff: 5.8, cast: .44"
    ],
    [
      "glow: '#fbb254'}",
      "glow: '#ffbd59', backlight: .57, baseShadow: .4}"
    ],
    [
      "  if (lines.length === 1) {",
      "  // Give a single line time to shrink before wrapping. Preserve its scale at the wrap point.\n  if (surface === surfaces.pearl && lines.length === 1) {\n    const lineWidth = length(layoutLine(text, glyphs));\n    const scale = Math.min(surface.size / 1000, surface.width / lineWidth);\n    const words = text.split(' ');\n    let split;\n    let best = lineWidth;\n    if (scale < .078) {\n      for (let index = 1; index < words.length; index++) {\n        const left = words.slice(0,index).join(' '), right = words.slice(index).join(' ');\n        const widest = Math.max(length(layoutLine(left,glyphs)), length(layoutLine(right,glyphs)));\n        if (widest < best) {\n          best = widest;\n          split = [left,right];\n        }\n      }\n    }\n    if (split) return {rows: split.map(line=>layoutLine(line,glyphs)), scale: Math.min(.078,surface.width/best)};\n    return {rows:[layoutLine(text,glyphs)], scale};\n  }\n  if (lines.length === 1) {"
    ],
    [
      "  return {rows, scale};\n}\n\nexport function fitDeskSigns",
      "  return {rows, scale};\n}\n\nexport function fitDeskSigns"
    ],
    [
      "    if (sign.scrollHeight > sign.clientHeight + 1) sign.setAttribute('data-break-copy', '');",
      "    if (sign.scrollHeight <= sign.clientHeight + 1) continue;\n    sign.setAttribute('data-break-copy', '');\n    if (sign.classList.contains('right')) {\n      for (const scale of [.76,.68,.60,.54]) {\n        if (sign.scrollHeight <= sign.clientHeight + 1) break;\n        sign.style.setProperty('--desk-fit', String(scale));\n      }\n    }"
    ],
    [
      "lightX,lightY,glow} = surface.material;",
      "lightX,lightY,glow,backlight,baseShadow} = surface.material;"
    ],
    [
      "    '<filter id=\"wall-bevel\" ",
      "    '<filter id=\"wall-base\" x=\"-15%\" y=\"-30%\" width=\"130%\" height=\"170%\"><feGaussianBlur stdDeviation=\"1.2\"/></filter>'+\n    '<filter id=\"wall-bevel\" "
    ],
    [
      "    pathLayer(shadow,opacity*.7,'wall-contact',shadowX*.43,shadowY*.39)+\n    edges",
      "    pathLayer(shadow,opacity*.7,'wall-contact',shadowX*.43,shadowY*.39)+\n    (backlight ? pathLayer(glow,backlight,'wall-contact',-1,-1) : '')+\n    (baseShadow ? pathLayer(shadow,baseShadow,'wall-base',shadowX*.32,2.4) : '')+\n    edges"
    ]
  ],
  "hero-image.js": [
    [
      "export async function createWallImage(request,env,a){",
      "export async function createWallImage(request,env,a,wallText){"
    ],
    [
      " const exact=a.clinic.trim();",
      " const exact=wallText||a.clinic.trim();\n const images=[{image_url:'data:image/webp;base64,'+btoa(encoded)}];\n if(wallText&&a.template==='lumi'){\n   const reference=await env.ASSETS.fetch(new Request(new URL('/assets/eden-photo-wall-v5-lumi.webp',request.url)));\n   if(reference.ok){\n     const bytes=new Uint8Array(await reference.arrayBuffer());\n     if(bytes.length<2000000){\n       let sample='';\n       for(let i=0;i<bytes.length;i+=8192)sample+=String.fromCharCode(...bytes.subarray(i,i+8192));\n       images.push({image_url:'data:image/webp;base64,'+btoa(sample)});\n     }\n   }\n }"
    ],
    [
      " const prompt=`Edit this reception photograph",
      " let prompt=`Edit this reception photograph"
    ],
    [
      " const response=await fetch",
      " if(wallText){\n   prompt+=' Follow any line break supplied in the exact text. Give each letter bright metallic bevels, directional highlights, a tight contact shadow and a natural warm reflected glow at the wall. Match the perspective of the wall.';\n   if(images.length>1)prompt+=' Edit only the first input image. The second input is a reference for the original champagne-gold lettering, perspective and lighting only. Never copy its placeholder name. Keep the first image composition, all people and the three blank desk signs.';\n }\n const response=await fetch"
    ],
    [
      "method:'POST',headers:{Authorization:'Bearer '+env.OPENAI_IMAGE_API_KEY",
      "method:'POST',signal:AbortSignal.timeout(150000),headers:{Authorization:'Bearer '+env.OPENAI_IMAGE_API_KEY"
    ],
    [
      "images:[{image_url:'data:image/webp;base64,'+btoa(encoded)}],prompt",
      "images,prompt"
    ]
  ],
  "assistant-core.js": [
    [
      "function savedWallText(a) {\n  if (!isTemplateWall(a)) return '';",
      "const finishedWallPattern=/^generated\\/([a-f0-9-]{36})\\/([^/]+)$/;\nfunction finishedWall(a){return finishedWallPattern.exec(a.hero_key||'')?.[1]||null}\nfunction savedWallText(a) {\n  if (!isTemplateWall(a)&&!finishedWall(a)) return '';"
    ],
    [
      "heroIsUpload:Boolean(uploadedWall(a)),id:a.id",
      "heroIsUpload:Boolean(uploadedWall(a)),heroIsFinished:Boolean(finishedWall(a)),id:a.id"
    ],
    [
      "wallTemplatePath(a.template):'/__eden/hero/'+a.hero_key+'.webp'",
      "wallTemplatePath(a.template):'/__eden/hero/'+(finishedWall(a)||a.hero_key)+'.webp'"
    ],
    [
      "+'.webp':'/__eden/hero/'+a.hero_key+'.webp'",
      "+'.webp':'/__eden/hero/'+(finishedWall(a)||a.hero_key)+'.webp'"
    ],
    [
      "services:services.filter(service=>service.length<=28).slice(0,3)",
      "services:services.filter(service=>service.length<=54).slice(0,6)"
    ],
    [
      "lines.length>3||",
      "lines.length>6||"
    ],
    [
      "and three service lines of 54 characters each.",
      "and up to six service lines of 54 characters each."
    ],
    [
      "if(!a)return json({error:'Access link missing or invalid.'},401);",
      "if(!a)return json({error:'Setup access expired or is unavailable. Reopen setup from Clinic Workspace.'},401);"
    ],
    [
      "  const pilot=cebuWall(a);\n  if(pilot){",
      "  const hasCustomText=Object.hasOwn(expected,'wallText');\n  const customText=hasCustomText?wallCopyLines(expected.wallText,70):null;\n  if(hasCustomText&&(!customText||a.template!=='lumi'))\n    return json({error:'Enter the Aesthetics Concierge wall name before generating.'},400);\n  if(hasCustomText&&(expected.revision!==a.updated_at||uploadedWall(a)))\n    return json({error:'The wall changed. Reload setup and try again.'},409);\n  const pilot=hasCustomText?null:cebuWall(a);\n  if(pilot){"
    ],
    [
      "  if(canGenerate&&!await limit(env,'owner-wall:'+id,5,86400))",
      "  if(hasCustomText&&!canGenerate)\n    return json({error:'Image generation is unavailable in this deployment. You can still use the editable wall.'},503);\n  if(canGenerate&&!await limit(env,'owner-wall:'+id,5,86400))"
    ],
    [
      "  let key, notice='', imageIssue",
      "  let key, objectKey, notice='', imageIssue"
    ],
    [
      "try{key=await createWallImage(request,env,a)}",
      "try{objectKey=await createWallImage(request,env,a,customText);key=customText?'generated/'+objectKey+'/'+encodeURIComponent(customText):objectKey}"
    ],
    [
      "  const ready=Boolean(key), keepApproval=ready&&key===a.hero_key;",
      "  const ready=Boolean(key), keepApproval=ready&&key===a.hero_key, stamp=now();"
    ],
    [
      ".bind(key||null,ready?'ready':'failed',keepApproval?1:0,keepApproval?1:0,now(),id,claimTime,attempt).run();",
      ".bind(key||null,ready?'ready':'failed',keepApproval?1:0,keepApproval?1:0,stamp,id,claimTime,attempt).run();"
    ],
    [
      "  if(saved.meta?.changes!==1)return json({error:'A newer setup change took precedence. Reload to review it.'},409);",
      "  if(saved.meta?.changes!==1){\n    if(objectKey)await env.EDEN_HERO_IMAGES.delete('wall/'+objectKey+'.webp').catch(()=>{});\n    return json({error:'A newer setup change took precedence. Reload to review it.'},409);\n  }"
    ],
    [
      "hero_key:key,hero_status:'ready',hero_attempts:attempt,",
      "hero_key:key,hero_status:'ready',updated_at:stamp,hero_attempts:attempt,"
    ],
    [
      "  const letters=input.wallText===undefined?'':input.wallText;\n  if(typeof letters!=='string'||letters.length>70||/[\\r\\n\\u0000-\\u001f\\u007f]/.test(letters)||!letters.isWellFormed())\n    return json({error:'Enter one line of up to 70 characters for the wall lettering.'},400);\n  const base=await availableTemplateWall(request,env,a.template);\n  const text=letters.trim();",
      "  const text=input.wallText===undefined?'':wallCopyLines(input.wallText,70,true);\n  if(text===null)return json({error:'Enter up to two lines and 70 characters for the wall lettering.'},400);\n  const base=await availableTemplateWall(request,env,a.template);"
    ],
    [
      "if(!await limit(env,'assistant-edit:'+id,12,86400))return json({error:'Daily edit limit reached. Please try again tomorrow.'},429);",
      "if(!await limit(env,'assistant-edit:'+id,12,86400))\n   return json({error:input.styleOnly===true?'Daily setup edit limit reached. You can still preview styles. Try saving again tomorrow.':'Daily edit limit reached. Please try again tomorrow.'},429);"
    ],
    [
      "signServices.some(line=>line.length>28)",
      "(signServices.length>3||signServices.some(line=>line.length>28))"
    ],
    [
      "font-size:.72cqw}",
      "font-size:.79cqw}"
    ],
    [
      "body.variant-original .sign-plate.left[data-long-copy] p{font-size:calc(.64cqw",
      "body.variant-original.has-photo-wall .sign-plate.left h2{font-size:1.16cqw}\nbody.variant-original .sign-plate.left[data-long-copy] p{font-size:calc(.69cqw"
    ]
  ],
  "assistant-setup/index.html": [
    [
      "eden-wall-lettering.js?v=photographic-finish-1",
      "eden-wall-lettering.js?v=photographic-finish-2"
    ],
    [
      "<!doctype html>",
      "<!doctype html><!-- Eden reception finish and setup flow v1 -->"
    ],
    [
      "  <img class=\"owner-intro-image\" src=\"/assets/eden-owner-eve-welcome-sign.webp\" width=\"1902\" height=\"827\" alt=\"\" fetchpriority=\"high\">",
      "  <picture class=\"owner-intro-art\">\n    <source media=\"(min-width: 760px)\" srcset=\"/assets/eden-owner-eve-panorama-life.webp\">\n    <img class=\"owner-intro-image\" src=\"/assets/eden-owner-eve.webp\" width=\"941\" height=\"1672\" alt=\"\" fetchpriority=\"high\">\n  </picture>"
    ],
    [
      "  <picture class=\"eve-photo\"><source media=\"(min-width: 920px)\" srcset=\"/assets/eden-owner-eve-panorama-life.webp\" width=\"1671\" height=\"941\"><img class=\"eve-image\" src=\"/assets/eden-owner-eve.webp\" alt=\"Eve, Eden’s AI receptionist, at a dental reception desk\" loading=\"lazy\" decoding=\"async\" width=\"941\" height=\"1672\"></picture>",
      "  <div class=\"eve-photo\"><img id=\"eveTemplateImage\" class=\"eve-image\" src=\"/assets/eden-style-sample-pearl.webp\" alt=\"Warm dental booking reception template\" loading=\"lazy\" decoding=\"async\" width=\"1672\" height=\"941\"></div>"
    ],
    [
      "<strong id=\"manageSelection\"></strong>",
      "<strong id=\"manageSelection\"></strong><span id=\"styleSaved\" class=\"style-saved\" hidden>✓ Saved</span>"
    ],
    [
      "<p id=\"manageChooseStatus\" class=\"status\" role=\"status\"></p>",
      "<p id=\"manageChooseStatus\" class=\"status\" role=\"status\"></p>\n<a id=\"reconnectStyle\" class=\"btn light\" href=\"https://clinicnet.live/clinic/\" target=\"_blank\" rel=\"noopener noreferrer\" hidden>Reconnect in Clinic Workspace ↗</a>"
    ],
    [
      "<textarea id=\"deskServices\" rows=\"3\" maxlength=\"164\"",
      "<textarea id=\"deskServices\" rows=\"6\" maxlength=\"329\""
    ],
    [
      "Use up to three lines, with up to 54 characters per line.",
      "Use up to six lines, with up to 54 characters per line."
    ],
    [
      "  <label class=\"field\"><span>Welcome sign</span>",
      "  <section id=\"wallFinishOptions\" class=\"wall-finish-options\" aria-labelledby=\"wallFinishTitle\" hidden>\n    <h4 id=\"wallFinishTitle\">Photographic finish</h4>\n    <p>Generate an image with polished gold lettering for Aesthetics Concierge. Check the spelling and signs in the preview before you confirm.</p>\n    <button id=\"generateWallFinish\" class=\"btn\" type=\"button\">Generate final image</button>\n    <button id=\"restoreEditableWall\" class=\"btn light\" type=\"button\" hidden>Return to editable lettering</button>\n    <p id=\"wallFinishStatus\" class=\"status\" role=\"status\"></p>\n  </section>\n  <label class=\"field\"><span>Welcome sign</span>"
    ],
    [
      "#wallPhotoReconnect p{margin:8px 0 0}",
      "#wallPhotoReconnect p{margin:8px 0 0}\n#manageSelection,.style-saved{display:inline-block}\n.style-saved{margin-inline-start:10px;color:var(--forest);font-size:.9rem}\n.wall-finish-options{padding:16px;border:1px solid #dac8a8;border-radius:12px;background:#fcf5e8;margin:6px 0 12px}\n.wall-finish-options h4,.wall-finish-options p{margin:0 0 8px}\n.wall-finish-options button{margin:4px 6px 4px 0}\n#reconnectStyle,.wall-finish-options[hidden],.style-saved[hidden]{display:none}\n#reconnectStyle:not([hidden]){display:inline-block;text-decoration:none}\n.eve-image{object-fit:cover;aspect-ratio:1672/941}\n@media(max-width:919px){\n  .owner-intro-art{display:block}\n  .owner-intro-image{object-position:50% 34%}\n}\n@media(min-width:920px){\n  .hero{grid-template-columns:minmax(345px,.8fr) minmax(0,1.3fr);min-height:0}\n  .hero::before{content:none}\n  .owner-intro-art{grid-column:2;grid-row:1;height:100%}\n  .owner-intro-image{position:static;aspect-ratio:1671/941;object-position:50% 40%}\n  .owner-intro-copy{grid-column:1;grid-row:1;width:auto;padding:44px clamp(28px,4vw,80px)}\n  .hero .owner-intro-copy h1{font-size:clamp(2.35rem,3.7vw,4.75rem)}\n  .hero .owner-intro-copy p{max-width:38ch}\n}\n@media(min-width:760px) and (max-width:919px){.owner-intro-image{object-position:50% 40%}}"
    ],
    [
      "const $=id=>document.getElementById(id);let template='pearl',id,key,assistant,session;",
      "const $=id=>document.getElementById(id);let template='pearl',id,key,assistant,session;\nfunction showTalkTemplate(theme){\n  const style=templates.find(item=>item.id===theme);\n  if(!style)return;\n  const image=$('eveTemplateImage');\n  const prefix=theme==='pearl'||theme==='pattaya'?'eden-style-sample-':'eden-photo-wall-v5-';\n  const src='/assets/'+prefix+theme+'.webp';\n  if(image.getAttribute('src')!==src)image.src=src;\n  image.alt=style.name+' reception template';\n}"
    ],
    [
      "  $('confirmWallCopy').textContent=a.heroIsUpload?'Confirm photo':'Confirm wall and signs';",
      "  $('confirmWallCopy').textContent=a.heroIsUpload?'Confirm photo':'Confirm wall and signs';\n  $('wallFinishOptions').hidden=published||a.heroIsUpload||a.template!=='lumi';\n  $('generateWallFinish').disabled=wallCopyBusy;\n  $('restoreEditableWall').disabled=wallCopyBusy;\n  $('restoreEditableWall').hidden=!a.heroIsFinished;"
    ],
    [
      ".filter(Boolean).slice(0,3);",
      ".filter(Boolean).slice(0,6);"
    ],
    [
      "lines.some(line=>line.length>28)",
      "lines.length>3||lines.some(line=>line.length>28)"
    ],
    [
      "$('wallPhotoFile').onchange=()=>actionState('uploadWallPhoto','');",
      "$('wallPhotoFile').onchange=()=>actionState('uploadWallPhoto','');\n\n$('generateWallFinish').onclick=()=>updateWallFinish('hero-generate');\n$('restoreEditableWall').onclick=()=>updateWallFinish('hero-template');\n\nasync function updateWallFinish(action){\n  if(wallCopyBusy||$('wallFinishOptions').hidden)return;\n  if($('editTemplate').value!==assistant.template){\n    status('wallFinishStatus','Save your selected template first.',true);\n    return;\n  }\n  const wallText=$('wallLettering').value.trim();\n  if(!$('wallLettering').reportValidity()||!wallText)return;\n  const generating=action==='hero-generate';\n  wallCopyBusy=true;\n  renderWallLettering();\n  for(const id of wallCopyFields)$(id).readOnly=true;\n  status('wallFinishStatus',generating?'Generating your final image. This may take a moment.':'Restoring editable lettering…');\n  try{\n    const result=await api('/api/assistants/'+id+'/'+action,{\n      method:'POST',body:JSON.stringify({template:assistant.template,wallText,revision:assistant.wallRevision})\n    });\n    assistant=result;\n    wallCopyDirty=Object.entries(deskInputs).some(([field,id])=>\n      $(id).value.trim()!==(result.deskSigns?.[field]||result.wallDefaults[field]))||\n      wallText!==(result.wallText||result.clinic);\n    renderManage();\n    status('wallFinishStatus',result.wallNotice||\n      (generating?'Your final image is ready. Check the spelling, then confirm the wall and signs.':'Editable lettering is ready. Check the preview, then confirm the wall and signs.'),Boolean(result.wallNotice));\n  }catch(error){\n    status('wallFinishStatus',error.status===401\n      ?'Your setup session expired. Reopen setup from Clinic Workspace to continue.' : error.message,true);\n  }finally{\n    wallCopyBusy=false;\n    for(const id of wallCopyFields)$(id).readOnly=false;\n    renderWallLettering();\n  }\n}"
    ],
    [
      "function renderStyleActions(theme){\n  const saved=theme===assistant.template;\n  $('manageSelection').textContent='Selected: '+templates.find(item=>item.id===theme).name;\n  $('chooseStyle').hidden=saved||assistant.status==='published';\n}",
      "function renderStyleActions(theme){\n  const saved=theme===assistant.template;\n  $('manageSelection').textContent='Selected: '+templates.find(item=>item.id===theme).name;\n  $('styleSaved').hidden=!saved;\n  $('chooseStyle').hidden=saved||assistant.status==='published';\n  if(!saved&&$('chooseStyle').dataset.actionState==='done')actionState('chooseStyle','');\n  showTalkTemplate(assistant.template);\n}"
    ],
    [
      "  $('editTemplate').value=card.dataset.id;\n  status('manageChooseStatus','');",
      "  $('editTemplate').value=card.dataset.id;\n  $('reconnectStyle').hidden=true;\n  status('manageChooseStatus','');"
    ],
    [
      "$('editTemplate').onchange=()=>{status('manageChooseStatus','');renderManageTemplates()};",
      "$('editTemplate').onchange=()=>{$('reconnectStyle').hidden=true;status('manageChooseStatus','');renderManageTemplates()};"
    ],
    [
      "  if(button.disabled||theme===assistant.template)return;",
      "  if(button.disabled||theme===assistant.template)return;\n  if(wallCopyBusy){status('manageChooseStatus','Wait for the wall update before changing templates.',true);return;}"
    ],
    [
      "  button.disabled=true;\n  status('manageChooseStatus','Saving style…');",
      "  button.disabled=true;\n  $('reconnectStyle').hidden=true;\n  status('manageChooseStatus','Saving style…');"
    ],
    [
      "    actionState('chooseStyle','done');\n    status('manageChooseStatus','Style saved. Personalize your wall lettering and signs below.');\n  }catch(error){status('manageChooseStatus',error.message,true)}",
      "    status('wallFinishStatus','');\n    status('manageChooseStatus','Style saved. Personalize your wall lettering and signs below.');\n  }catch(error){\n    if(error.status===401&&useWorkspace){\n      $('reconnectStyle').href=$('backToWorkspace').href;\n      $('reconnectStyle').hidden=false;\n      status('manageChooseStatus','Your setup session expired or changed. Reopen Website chat setup in Clinic Workspace, then return here and try again.',true);\n    }else status('manageChooseStatus',error.message,true);\n  }"
    ],
    [
      "const createSteps=",
      "$('templates').addEventListener('click',event=>{\n  const card=event.target.closest('button[data-id]');\n  if(card)showTalkTemplate(card.dataset.id);\n});\nconst createSteps="
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
  if(!path.endsWith('.html'))after='// '+marker+'\n'+after;
  const code=path.endsWith('.html')?after.match(/<script type="module">([\s\S]+?)<\/script>/)?.[1]:after;
  if(!code)throw Error('Could not find the setup page script.');
  execFileSync(process.execPath,['--check','--input-type=module'],{input:code,encoding:'utf8'});
  return {path,before,after};
});
const changed=files.filter(file=>file.before!==file.after);
if(check||!changed.length){
  console.log('Reception finish check passed. '+changed.length+' file(s) would change.');
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
  console.log('Reception finish updated. Backup: '+backup);
}
