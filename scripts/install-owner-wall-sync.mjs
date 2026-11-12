import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {dirname,join} from 'node:path';

const args=process.argv.slice(2);
const check=args.includes('--check');
const [root=join(homedir(),'Desktop','clinicnet-voice-preview')]=args.filter(arg=>arg!=='--check');
const marker='Eden live wall review v1';

function replace(source,before,after,path){
  if(source.split(before).length!==2)throw Error('Unexpected '+path+' near '+before.slice(0,100));
  return source.replace(before,()=>after);
}

const patches={
  "assistant-core.js": [
    [
      "import {renderMountedWall} from './assets/eden-wall-lettering.js';",
      "import {fitDeskSigns,renderMountedWall} from './assets/eden-wall-lettering.js';"
    ],
    [
      "(${receptionistClient})(${clientSettings});",
      "const fitDeskSigns=${fitDeskSigns.toString()};\nnew ResizeObserver(()=>fitDeskSigns(document)).observe(document.querySelector('.scene'));\n(${receptionistClient})(${clientSettings});"
    ],
    [
      "function wallCopyLines(value, max){\n  if(typeof value!=='string'||!value.isWellFormed()||/[<>\\u0000-\\u0009\\u000b-\\u001f\\u007f]/.test(value))return null;\n  const lines=value.split('\\n').map(line=>line.trim()).filter(Boolean);\n  const text=lines.join('\\n');\n  return lines.length<=2&&text.length>=1&&text.length<=max?text:null;\n}\n\n",
      "// Eden live wall review v1\nfunction wallCopyLines(value,max,allowEmpty=false){\n  if(typeof value!=='string'||!value.isWellFormed()||/[<>\\u0000-\\u0009\\u000b-\\u001f\\u007f]/.test(value))return null;\n  const lines=value.split('\\n').map(line=>line.trim()).filter(Boolean);\n  const text=lines.join('\\n');\n  return lines.length<=2&&(allowEmpty||text.length>=1)&&text.length<=max?text:null;\n}\n\nfunction deskSignCopy(input,allowEmpty=false){\n  const welcome=wallCopyLines(input.welcome,120,allowEmpty);\n  const chat=wallCopyLines(input.chat,64,allowEmpty);\n  const lines=typeof input.services==='string'?input.services.replace(/\\r\\n/g,'\\n').split('\\n').map(line=>line.trim()).filter(Boolean):null;\n  if(welcome===null||chat===null||!lines||(!allowEmpty&&!lines.length)||lines.length>3||\n     !lines.every(line=>wallCopyLines(line,54)!==null))return null;\n  return {welcome,chat,services:lines.join('\\n')};\n}\nconst deskSignError='Use up to 120 characters for Welcome, 64 for Chat, and three service lines of 54 characters each.';\n\n"
    ],
    [
      "  const text=wallCopyLines(input.wallText,70);\n  const welcome=wallCopyLines(input.welcome,62);\n  const chat=wallCopyLines(input.chat,32);\n  const lines=typeof input.services==='string'?input.services.split(/\\r?\\n/).map(line=>line.trim()).filter(Boolean):null;\n  if(!text)return json({error:'Enter up to two lines and 70 characters for the wall lettering.'},400);\n  if(!welcome||!chat||!lines?.length||lines.length>3||!lines.every(line=>value(line,1,28)))\n    return json({error:'Use up to two lines each for the welcome and chat signs, and up to three service lines of 28 characters each.'},400);\n  const services=lines.join('\\n');\n",
      "  const text=wallCopyLines(input.wallText,70);\n  const deskSigns=deskSignCopy(input);\n  if(!text)return json({error:'Enter up to two lines and 70 characters for the wall lettering.'},400);\n  if(!deskSigns)return json({error:deskSignError},400);\n  const {welcome,chat,services}=deskSigns;\n"
    ],
    [
      "  const deskSigns={welcome,chat,services};\n  if(a.hero_reviewed_at&&sameArtwork",
      "  if(a.hero_reviewed_at&&sameArtwork"
    ],
    [
      "async function saveDeskSigns(request,env,a){\n  if(a.status==='published')return json({error:'Published desk signs need an owner support review.'},409);\n  if(a.hero_status==='generating'&&Date.now()-Date.parse(a.updated_at)<600000)return json({error:'Wait for the wall image to finish before saving desk signs.'},409);\n  const input=await body(request);\n  const welcome=typeof input.welcome==='string'?input.welcome.trim():null;\n  const chat=typeof input.chat==='string'?input.chat.trim():null;\n  const lines=typeof input.services==='string'?input.services.split(/\\r?\\n/).map(line=>line.trim()).filter(Boolean):null;\n  if(!value(welcome,0,62)||!value(chat,0,32)||!lines||lines.length>3||!lines.every(line=>value(line,1,28)))\n    return json({error:'Use a short welcome line, a short chat line, and up to three service lines of 28 characters each.'},400);\n  const services=lines.join('\\n');\n",
      "async function saveDeskSigns(request,env,a){\n  if(a.status==='published')return json({error:'Published desk signs need an owner support review.'},409);\n  if(a.hero_status==='generating'&&Date.now()-Date.parse(a.updated_at)<600000)return json({error:'Wait for the wall image to finish before saving desk signs.'},409);\n  const input=await body(request);\n  const copy=deskSignCopy(input,true);\n  if(!copy)return json({error:deskSignError},400);\n  const {welcome,chat,services}=copy;\n"
    ],
    [
      "...themed,variant:'original',hero_key:cebuWall(themed)?.key||'template/'+theme,hero_status:'ready'",
      "...themed,variant:'original',hero_key:'template/'+theme,hero_status:'ready'"
    ],
    [
      "const preview = editable && !uploadedWall(draft) ? {...draft,variant:'original',hero_key:'template/'+theme,hero_status:'ready'} : draft;",
      "const preview = editable && !uploadedWall(draft) ? {...draft,variant:'original',hero_key:isTemplateWall(draft)?draft.hero_key:'template/'+theme,hero_status:'ready'} : draft;"
    ],
    [
      " const newScene=next.clinic!==a.clinic||next.template!==a.template;",
      " const newScene=next.clinic!==a.clinic||next.template!==a.template;\n if(next.template!==a.template)next.variant='original';"
    ],
    [
      "template=?,language=?,booking_mode=?,agent_id=?,voice_test_at=CASE",
      "template=?,language=?,booking_mode=?,variant=?,agent_id=?,voice_test_at=CASE"
    ],
    [
      "next.template,next.language,next.booking_mode,agentId,voiceChanged?1:0,newScene",
      "next.template,next.language,next.booking_mode,next.variant||'original',agentId,voiceChanged?1:0,newScene"
    ],
    [
      " const nextWallBase=newScene&&isTemplateWall(a)?await availableTemplateWall(request,env,next.template):null;",
      " const nextWallBase=newScene&&!uploadedWall(a)?await availableTemplateWall(request,env,next.template):null;"
    ],
    [
      " const agentId=a.agent_id&&voiceChanged?await createVoice(env,next):a.agent_id;\n try{",
      " const agentId=a.agent_id&&voiceChanged?await createVoice(env,next):a.agent_id;\n const stamp=now();\n try{"
    ],
    [
      "nextWall?'ready':null,newScene?1:0,newScene?1:0,now(),id,a.updated_at).run();",
      "nextWall?'ready':null,newScene?1:0,newScene?1:0,stamp,id,a.updated_at).run();"
    ],
    [
      "return json(ownerView({...next,agent_id:agentId,voice_test_at:voiceChanged?null:a.voice_test_at,",
      "return json(ownerView({...next,updated_at:stamp,agent_id:agentId,voice_test_at:voiceChanged?null:a.voice_test_at,"
    ],
    [
      " const signMarkup=!ownerPhoto?`<div class=\"sign-wall ${wallText.length>35?'compact':''}\" aria-hidden=\"true\">${templateWall?'':'<small>WELCOME TO</small>'}<span class=\"wall-name\">${h(wallText)}</span></div>${mountedWall}<div class=\"sign-plate left\" aria-hidden=\"true\"><h2>WELCOME</h2>${desk?.welcome?`<p class=\"sign-feature\">${h(desk.welcome)}</p>`:`${featured?`<p class=\"sign-feature\">${h(featured)}</p>`:''}${signHours?`<p>${signHours}</p>`:'<p>Ask us about our hours</p>'}<p>${a.booking_mode==='request'?'Request an appointment':'Questions welcome'}</p>`}</div><div class=\"sign-plate center\" aria-hidden=\"true\"><h2>CHAT WITH US</h2><p>${desk?.chat?h(desk.chat):a.booking_mode==='request'?'Ask or request a time':'Ask a question'}</p></div><div class=\"sign-plate right\" aria-hidden=\"true\"><h2>OUR SERVICES</h2>${signRows?`<ul>${signRows}</ul>`:'<p>Ask our team for details</p>'}</div>`:'';\n",
      " const signMarkup=!ownerPhoto?`<div class=\"sign-wall ${wallText.length>35?'compact':''}\" aria-hidden=\"true\">${templateWall?'':'<small>WELCOME TO</small>'}<span class=\"wall-name\">${h(wallText)}</span></div>${mountedWall}<div class=\"sign-plate left\"${desk?.welcome?.length>72?' data-long-copy':''} aria-hidden=\"true\"><h2>WELCOME</h2>${desk?.welcome?`<p class=\"sign-feature\">${h(desk.welcome)}</p>`:`${featured?`<p class=\"sign-feature\">${h(featured)}</p>`:''}${signHours?`<p>${signHours}</p>`:'<p>Ask us about our hours</p>'}<p>${a.booking_mode==='request'?'Request an appointment':'Questions welcome'}</p>`}</div><div class=\"sign-plate center\"${desk?.chat?.length>32?' data-long-copy':''} aria-hidden=\"true\"><h2>CHAT WITH US</h2><p>${desk?.chat?h(desk.chat):a.booking_mode==='request'?'Ask or request a time':'Ask a question'}</p></div><div class=\"sign-plate right\"${signServices.some(line=>line.length>28)?' data-long-copy':''} aria-hidden=\"true\"><h2>OUR SERVICES</h2>${signRows?`<ul>${signRows}</ul>`:'<p>Ask our team for details</p>'}</div>`:'';\n"
    ],
    [
      "body.has-template-wall .wall-name,body.variant-original .sign-plate p{white-space:pre-line}",
      "body.has-template-wall .wall-name,body.variant-original .sign-plate p{white-space:pre-line}\nbody.variant-original .sign-plate.left[data-long-copy] p{font-size:calc(.64cqw * var(--desk-fit,1));line-height:1.12}\nbody.variant-original .sign-plate.center[data-long-copy] p{font-size:calc(.61cqw * var(--desk-fit,1));line-height:1.08;margin-block:.1cqw}\nbody.variant-original .sign-plate.right[data-long-copy] li{font-size:calc(.63cqw * var(--desk-fit,1));line-height:1.1;padding-block:.14cqw}\nbody.variant-original .sign-plate[data-break-copy] :is(p,li){word-break:break-all}"
    ],
    [
      "body.theme-pattaya.variant-original.is-style-sample.has-photo-wall .sign-plate.center{\n  padding-inline:",
      "body.theme-pattaya.variant-original.is-style-sample.has-photo-wall:not(.has-template-wall) .sign-plate.center{\n  padding-inline:"
    ],
    [
      "body.theme-pattaya.variant-original.is-style-sample.has-photo-wall .sign-plate.center{\n  left:43.55%",
      "body.theme-pattaya.variant-original.is-style-sample.has-photo-wall:not(.has-template-wall) .sign-plate.center{\n  left:43.55%"
    ],
    [
      "body.theme-pearl.variant-original.is-style-sample.has-photo-wall .sign-plate.center{",
      "body.theme-pearl.variant-original.is-style-sample.has-photo-wall:not(.has-template-wall) .sign-plate.center{"
    ],
    [
      "body.theme-mabuhay.variant-original.is-style-sample.has-photo-wall{",
      "body.theme-mabuhay.variant-original.is-style-sample.has-photo-wall:not(.has-template-wall){"
    ],
    [
      "hero_key: 'sample/'+theme",
      "hero_key:'template/'+theme, hero_status:'ready'"
    ]
  ],
  "assistant-setup/index.html": [
    [
      "import {renderMountedWall} from \"/assets/eden-wall-lettering.js\";",
      "import {fitDeskSigns,renderMountedWall} from \"/assets/eden-wall-lettering.js?v=wall-review-1\";"
    ],
    [
      "<p id=\"wallEditingHelp\" class=\"wall-subheading\">Edit wall lettering and desk signs</p><div class=\"wall-frame\" id=\"wallFrame\" hidden><iframe id=\"wallPreview\" title=\"Clinic scene with live desk signs\" sandbox=\"allow-same-origin\"></iframe></div>",
      "<div class=\"wall-frame\" id=\"wallFrame\" hidden><iframe id=\"wallPreview\" title=\"Clinic scene with live desk signs\" sandbox=\"allow-same-origin\"></iframe></div><p id=\"wallEditingHelp\" class=\"wall-subheading\">Edit wall lettering and desk signs</p>"
    ],
    [
      "#wallFrame{margin:0 0 clamp(18px,3vw,32px)}",
      "#wallFrame{margin:0 0 clamp(8px,1.4vw,16px)}"
    ],
    [
      "id=\"deskServices\" rows=\"3\" maxlength=\"86\"",
      "id=\"deskServices\" rows=\"3\" maxlength=\"164\""
    ],
    [
      "Use up to three lines, with up to 28 characters per line.",
      "Use up to three lines, with up to 54 characters per line."
    ],
    [
      "<textarea id=\"deskWelcome\" rows=\"2\" maxlength=\"62\" required></textarea>",
      "<textarea id=\"deskWelcome\" rows=\"2\" maxlength=\"120\" required aria-describedby=\"deskWelcomeHint\"></textarea><small id=\"deskWelcomeHint\">Up to two lines and 120 characters.</small>"
    ],
    [
      "<textarea id=\"deskChat\" rows=\"2\" maxlength=\"32\" required></textarea>",
      "<textarea id=\"deskChat\" rows=\"2\" maxlength=\"64\" required aria-describedby=\"deskChatHint\"></textarea><small id=\"deskChatHint\">Up to two lines and 64 characters.</small>"
    ],
    [
      "src=\"/__eden/template-preview/pearl/?v=wall-samples-2\"",
      "src=\"/__eden/template-preview/pearl/?v=wall-samples-3\""
    ],
    [
      "'/__eden/template-preview/'+encodeURIComponent(theme)+'/?v=wall-samples-2'",
      "'/__eden/template-preview/'+encodeURIComponent(theme)+'/?v=wall-samples-3'"
    ],
    [
      "/__eden/template-preview/${t.id}/?v=wall-samples-2",
      "/__eden/template-preview/${t.id}/?v=wall-samples-3"
    ],
    [
      "function usesEditableWall(){\n  return assistant.status!=='published'&&!assistant.heroIsUpload&&(!assistant.heroReady||\n    $('wallLettering').value.trim()!==(assistant.wallText||assistant.clinic));\n}\n\nfunction renderWallCopyPreview(){\n  const frame=$('wallPreview'), page=frame.contentDocument;\n  if(assistant.status==='published'||!page?.querySelector('.sign-plate'))return;\n  const wall=page.querySelector('body.has-template-wall .sign-wall');\n  if(wall){\n    const text=$('wallLettering').value.trim()||assistant.clinic;\n    wall.classList.toggle('compact',text.length>35);\n    wall.querySelector('.wall-name').textContent=text;\n    page.querySelector('.mounted-wall')?.remove();\n    const mounted=renderMountedWall(text,assistant.template);\n    if(mounted)wall.insertAdjacentHTML('afterend',mounted);\n  }\n  for(const [field,side] of [['welcome','left'],['chat','center'],['services','right']]){\n    const sign=page.querySelector('.sign-plate.'+side);\n    if(!sign)continue;\n    const text=$(deskInputs[field]).value.trim();\n    if(field==='services'){\n      const list=page.createElement('ul');\n      for(const line of text.split(/\\r?\\n/).filter(line=>line.trim()).slice(0,3)){\n        const item=page.createElement('li');\n        item.textContent=line.trim();\n        list.append(item);\n      }\n      sign.replaceChildren(sign.querySelector('h2'),list);\n    }else{\n      const p=page.createElement('p');\n      if(field==='welcome')p.className='sign-feature';\n      p.textContent=text;\n      sign.replaceChildren(sign.querySelector('h2'),p);\n    }\n  }\n}\n$('wallPreview').addEventListener('load',()=>{\n  const page=$('wallPreview').contentDocument;\n  const stamp=page?.querySelector('meta[name=\"eden-wall-preview\"]')?.content;\n  if(!assistant||stamp!==String(wallPreviewRun))return;\n  $('wallFrame').hidden=false;\n  renderWallCopyPreview();\n  renderWallLettering();\n  if($('wallStatus').textContent==='Photo saved. Reload the preview to see it.')\n    status('wallStatus','Photo ready. Check the preview above, then confirm the photo.');\n});\n$('wallLetteringForm').oninput=()=>{\n  wallCopyDirty=true;\n  renderWallCopyPreview();\n  void loadWallPreview();\n  status('wallStatus','Check the preview above, then confirm your wall and signs.');\n};\n\n",
      "function usesEditableWall(){\n  return assistant.status!=='published'&&!assistant.heroIsUpload&&!assistant.heroIsTemplate&&\n    (!assistant.heroReady||$('wallLettering').value.trim()!==(assistant.wallText||assistant.clinic));\n}\n\nfunction renderWallCopyPreviews(){\n  if(!assistant||assistant.status==='published'||assistant.heroIsUpload)return;\n  const text=$('wallLettering').value.trim()||assistant.clinic;\n  let mounted;\n  for(const id of ['wallPreview','pagePreview']){\n    const page=$(id).contentDocument;\n    if(!page?.body?.classList.contains('theme-'+assistant.template))continue;\n    const wall=page.querySelector('body.has-template-wall .sign-wall');\n    if(wall&&wall.querySelector('.wall-name').textContent!==text){\n      wall.classList.toggle('compact',text.length>35);\n      wall.querySelector('.wall-name').textContent=text;\n      page.querySelector('.mounted-wall')?.remove();\n      mounted??=renderMountedWall(text,assistant.template);\n      if(mounted)wall.insertAdjacentHTML('afterend',mounted);\n    }\n    for(const [field,side] of [['welcome','left'],['chat','center'],['services','right']]){\n      const sign=page.querySelector('.sign-plate.'+side);\n      if(!sign)continue;\n      const copy=$(deskInputs[field]).value.trim();\n      if(field==='services'){\n        const lines=copy.split(/\\r?\\n/).map(line=>line.trim()).filter(Boolean).slice(0,3);\n        const list=page.createElement('ul');\n        for(const line of lines){\n          const item=page.createElement('li');\n          item.textContent=line;\n          list.append(item);\n        }\n        sign.toggleAttribute('data-long-copy',lines.some(line=>line.length>28));\n        sign.replaceChildren(sign.querySelector('h2'),list);\n      }else{\n        const p=page.createElement('p');\n        if(field==='welcome')p.className='sign-feature';\n        p.textContent=copy;\n        sign.toggleAttribute('data-long-copy',copy.length>(field==='welcome'?72:32));\n        sign.replaceChildren(sign.querySelector('h2'),p);\n      }\n      if(!sign.hasAttribute('data-long-copy')){\n        sign.removeAttribute('data-break-copy');\n        sign.style.removeProperty('--desk-fit');\n      }\n    }\n    fitDeskSigns(page);\n  }\n}\nconst deskSignResize=new ResizeObserver(entries=>{\n  for(const {target} of entries){\n    if(target.contentDocument)fitDeskSigns(target.contentDocument);\n  }\n});\nfor(const id of ['wallPreview','pagePreview'])deskSignResize.observe($(id));\n\n$('wallPreview').addEventListener('load',()=>{\n  const page=$('wallPreview').contentDocument;\n  const stamp=page?.querySelector('meta[name=\"eden-wall-preview\"]')?.content;\n  if(!assistant||stamp!==String(wallPreviewRun))return;\n  $('wallFrame').hidden=false;\n  renderWallLettering();\n  renderWallCopyPreviews();\n  if($('wallStatus').textContent==='Photo saved. Reload the preview to see it.')\n    status('wallStatus','Photo ready. Check the preview above, then confirm the photo.');\n});\n$('wallLetteringForm').oninput=()=>{\n  const a=assistant;\n  wallCopyDirty=$('wallLettering').value.trim()!==(a.wallText||a.clinic)||\n    Object.entries(deskInputs).some(([field,id])=>$(id).value.trim()!==(a.deskSigns?.[field]||a.wallDefaults[field]));\n  renderWallCopyPreviews();\n  void loadWallPreview();\n  void loadMobilePreview();\n  renderApproval();\n  status('wallStatus',wallCopyDirty?'Confirm your wall and signs to save these changes.':\n    a.heroApproved?'Wall and desk signs confirmed.':'Check the preview above, then confirm your wall and signs.');\n};\n\n"
    ],
    [
      "let pagePreviewKey='', pagePreviewRun=0;",
      "let pagePreviewKey='', pagePreviewRun=0;\n$('pagePreview').addEventListener('load',()=>{\n  const page=$('pagePreview').contentDocument;\n  if(page?.querySelector('meta[name=\"eden-page-preview\"]')?.content!==String(pagePreviewRun))return;\n  $('pagePreviewFrame').hidden=false;\n  renderWallCopyPreviews();\n  renderApproval();\n  status('previewStatus','');\n});"
    ],
    [
      "  const next=JSON.stringify([a.clinic,a.city,a.hours,a.services,a.featuredService,a.template,a.bookingMode,a.language,a.phone,a.mapsUrl,a.heroUrl,a.variant,a.deskSigns,a.wallText]);",
      "  const lettering=usesEditableWall();\n  const next=JSON.stringify([a.clinic,a.city,a.hours,a.services,a.featuredService,a.template,a.bookingMode,a.language,a.phone,a.mapsUrl,a.heroUrl,a.variant,a.deskSigns,a.wallText,lettering]);"
    ],
    [
      "    const html=await previewHtml(a.template);\n    if(run!==pagePreviewRun)return;\n    $('pagePreview').srcdoc=html;\n    $('pagePreviewFrame').hidden=false;\n    renderApproval();\n    status('previewStatus','');",
      "    const html=await previewHtml(a.template,false,lettering);\n    if(run!==pagePreviewRun)return;\n    const stamp='<meta name=\"eden-page-preview\" content=\"'+run+'\">';\n    $('pagePreview').srcdoc=html.replace('</head>',stamp+'</head>');"
    ],
    [
      "  $('retakeClinicInterview').hidden=!canInterview();\n  const missing=[",
      "  $('retakeClinicInterview').hidden=!canInterview();\n  const wallConfirmed=a.heroApproved&&!wallCopyDirty;\n  const reviewApproved=a.reviewApproved&&!wallCopyDirty;\n  $('testCheck').textContent=wallConfirmed?'✓ Wall confirmed':'○ Confirm wall';\n  $('testCheck').classList.toggle('yes',wallConfirmed);\n  $('testCheck').classList.toggle('no',!wallConfirmed);\n  $('pageCheck').textContent=reviewApproved?'✓ Page approved':'○ Approve page';\n  $('pageCheck').classList.toggle('yes',reviewApproved);\n  $('pageCheck').classList.toggle('no',!reviewApproved);\n  $('continuePageReview').hidden=!wallConfirmed||a.status==='published';\n  $('publish').disabled=!a.agentReady||!a.voiceReviewed||!a.testConfirmed||!wallConfirmed||!reviewApproved||a.status==='published';\n  const missing=["
    ],
    [
      "[!a.heroApproved,a.heroIsUpload?'Check and confirm the reception photo':'Check and approve the wall scene','wallSceneCard']",
      "[!wallConfirmed,a.heroIsUpload?'Check and confirm the reception photo':'Confirm the wall and signs','wallSceneCard']"
    ],
    [
      "  list.hidden=a.reviewApproved||missing.length===0;\n  $('approveCheck').disabled=a.reviewApproved||missing.length>0;\n  if(a.reviewApproved)$('approveCheck').checked=true;\n  $('approvePage').disabled=a.reviewApproved||!$('approveCheck').checked||missing.length>0;\n  $('approvePage').textContent=a.reviewApproved?'Page approved':'Approve page for publication';\n",
      "  list.hidden=reviewApproved||missing.length===0;\n  $('approveCheck').disabled=reviewApproved||missing.length>0;\n  if(reviewApproved||wallCopyDirty)$('approveCheck').checked=reviewApproved;\n  $('approvePage').disabled=reviewApproved||!$('approveCheck').checked||missing.length>0;\n  $('approvePage').textContent=reviewApproved?'Page approved':'Approve page for publication';\n  if(reviewApproved)actionState('approvePage','done');\n  else if($('approvePage').dataset.actionState==='done')actionState('approvePage','');\n"
    ],
    [
      "$('continuePageReview').hidden=!a.heroApproved||a.status==='published';void loadWallPreview();",
      "void loadWallPreview();"
    ],
    [
      "$('testCheck').textContent=(a.heroApproved?'✓':'○')+(a.heroApproved?' Wall confirmed':' Confirm wall');$('testCheck').classList.toggle('yes',a.heroApproved);$('testCheck').classList.toggle('no',!a.heroApproved);$('pageCheck').textContent=(a.reviewApproved?'✓':'○')+(a.reviewApproved?' Page approved':' Approve page');$('pageCheck').classList.toggle('yes',a.reviewApproved);$('pageCheck').classList.toggle('no',!a.reviewApproved);$('publish').disabled=!a.agentReady||!a.voiceReviewed||!a.testConfirmed||!a.heroApproved||!a.reviewApproved||a.status==='published';",
      ""
    ],
    [
      "['confirmEmail',a.testConfirmed],['approvePage',a.reviewApproved],['publish',a.status==='published']",
      "['confirmEmail',a.testConfirmed],['publish',a.status==='published']"
    ]
  ],
  "assets/eden-wall-lettering.js": [
    [
      "export function renderMountedWall(value, theme) {",
      "export function fitDeskSigns(page) {\n  for (const sign of page.querySelectorAll('.sign-plate[data-long-copy]')) {\n    if (!sign.clientHeight) continue;\n    sign.removeAttribute('data-break-copy');\n    sign.style.removeProperty('--desk-fit');\n    if (sign.scrollHeight <= sign.clientHeight + 1) continue;\n    sign.style.setProperty('--desk-fit', '.92');\n    if (sign.scrollHeight <= sign.clientHeight + 1) continue;\n    sign.style.setProperty('--desk-fit', '.84');\n    if (sign.scrollHeight > sign.clientHeight + 1) sign.setAttribute('data-break-copy', '');\n  }\n}\n\nexport function renderMountedWall(value, theme) {"
    ],
    [
      "const faces = {sans: decodeAtlas(atlas.sans), serif: decodeAtlas(atlas.serif)};",
      "const glyphs = decodeAtlas(atlas.sans);"
    ],
    [
      "  const glyphs = faces[surface.font];\n",
      ""
    ],
    [
      "font: 'sans', caps: true, center: true, x: 55",
      "center: true, x: 55"
    ],
    [
      "font: 'sans', caps: true, center: true, x: 500",
      "center: true, x: 500"
    ],
    [
      "font: 'sans', caps: true, center: true, x: 122",
      "center: true, x: 122"
    ],
    [
      "  const text = surface.caps ? normalized.toUpperCase() : normalized;",
      "  const text = normalized.toUpperCase();"
    ],
    [
      "  lumi: {\n    font: 'serif', x: 192, y: 18, width: 470, size: 74,\n    shear: .008, vanish: .00003, depth: 9, edgeX: -.42, edgeY: -.36,\n    face: ['#fbdd95','#c18c40','#edc878','#a46927'], edges: ['#563516','#795226','#ad7939','#efc46d'],\n    glint: '#fff0b6', shadow: '#3c291a', shadowX: 5, shadowY: 8\n  },\n  siam: {\n    font: 'serif', x: 71, y: 84, width: 525, size: 89,\n    shear: -.015, vanish: -.00007, depth: 9, edgeX: .45, edgeY: -.33,\n    face: ['#f5d389','#c29443','#e4b864','#a87b32'], edges: ['#3b2410','#62401a','#a47735','#ca9d50'],\n    glint: '#ffe2a1', shadow: '#110904', shadowX: -4, shadowY: 7\n  },\n",
      "  lumi: {\n    x: 181, y: 21, width: 400, size: 63,\n    shear: .008, vanish: .00003, depth: 12, edgeX: -.43, edgeY: -.37,\n    face: ['#eacb93','#caa06a','#ae8149'], edges: ['#5b3c20','#80562e','#ab7945','#e0b77d'],\n    glint: '#fff1c1', shadow: '#443020', shadowX: 6, shadowY: 8\n  },\n  siam: {\n    x: 72, y: 72, width: 507, size: 70,\n    shear: -.015, vanish: -.00007, depth: 13, edgeX: .49, edgeY: -.4,\n    face: ['#d7b478','#bd945b','#9e733e'], edges: ['#402b19','#674729','#916837','#b88a53'],\n    glint: '#f3d399', shadow: '#120904', shadowX: -5, shadowY: 8\n  },\n"
    ]
  ]
};

const files=Object.entries(patches).map(([path,edits])=>{
  const before=readFileSync(join(root,path),'utf8');
  if(before.includes(marker))return {path,before,after:before};
  let after=before;
  for(const [from,to] of edits)after=replace(after,from,to,path);
  return {path,before,after:path.endsWith('.html')
    ? replace(after,'<!doctype html>','<!doctype html><!-- '+marker+' -->',path)
    : '// '+marker+'\n'+after};
});

for(const {path,after} of files){
  const code=path.endsWith('.html')?after.match(/<script type="module">([\s\S]+?)<\/script>/)?.[1]:after;
  if(!code)throw Error('Could not find the setup page script.');
  execFileSync(process.execPath,['--check','--input-type=module'],{input:code,encoding:'utf8'});
}

const changed=files.filter(file=>file.before!==file.after);
if(check||!changed.length){
  console.log('Wall review check passed. '+changed.length+' file(s) would change.');
}else{
  const backup=mkdtempSync(join(tmpdir(),'eden-wall-review-'));
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
  console.log('Wall review updated. Backup: '+backup);
}
