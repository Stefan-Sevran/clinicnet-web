import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {dirname,join} from 'node:path';

const args=process.argv.slice(2);
const check=args.includes('--check');
const [root=join(homedir(),'Desktop','clinicnet-voice-preview')]=args.filter(arg=>arg!=='--check');
const marker='Eden tailormade reception v1';
const patches={
  "hero-image.js": [
    [
      " if(wallText&&a.template==='lumi'){\n   const reference=await env.ASSETS.fetch(new Request(new URL('/assets/eden-photo-wall-v5-lumi.webp',request.url)));",
      " if(wallText){\n   const prefix=a.template==='pearl'||a.template==='pattaya'?'eden-style-sample-':'eden-photo-wall-v5-';\n   const reference=await env.ASSETS.fetch(new Request(new URL('/assets/'+prefix+a.template+'.webp',request.url)));"
    ],
    [
      "the original champagne-gold lettering, perspective and lighting only",
      "the template’s original lettering style, material, wall perspective and lighting only"
    ]
  ],
  "assistant-core.js": [
    [
      "  if(hasCustomText&&(!customText||a.template!=='lumi'))\n    return json({error:'Enter the Aesthetics Concierge wall name before generating.'},400);",
      "  if(hasCustomText&&!customText)\n    return json({error:'Enter the wall name before generating an image.'},400);"
    ],
    [
      "function sampleTemplatePage(theme) {",
      "function sampleTemplatePage(theme,compact=false) {"
    ],
    [
      "  return staticClinicPreview(page);\n}\nexport async function handleAssistantRoute",
      "  const html=staticClinicPreview(page);\n  if(!compact)return html;\n  const cardStyle='<style>body.is-style-sample main>:not(.scene):not(#receptionist),body.is-style-sample>footer{display:none!important}</style>';\n  return html.replace('</head>',cardStyle+'</head>');\n}\nexport async function handleAssistantRoute"
    ],
    [
      "sampleTemplatePage(sample[1])",
      "sampleTemplatePage(sample[1],new URL(request.url).searchParams.get('view')==='card')"
    ]
  ],
  "assistant-setup/index.html": [
    [
      "<!doctype html>",
      "<!doctype html><!-- Eden tailormade reception v1 -->"
    ],
    [
      "  <picture class=\"owner-intro-art\">\n    <source media=\"(min-width: 760px)\" srcset=\"/assets/eden-owner-eve-panorama-life.webp\">\n    <img class=\"owner-intro-image\" src=\"/assets/eden-owner-eve.webp\" width=\"941\" height=\"1672\" alt=\"\" fetchpriority=\"high\">\n  </picture>",
      "  <img class=\"owner-intro-image\" src=\"/assets/eden-owner-eve-welcome-sign.webp\" width=\"1902\" height=\"827\" alt=\"\" fetchpriority=\"high\">"
    ],
    [
      "@media(max-width:919px){\n  .owner-intro-art{display:block}\n  .owner-intro-image{object-position:50% 34%}\n}\n@media(min-width:920px){\n  .hero{grid-template-columns:minmax(345px,.8fr) minmax(0,1.3fr);min-height:0}\n  .hero::before{content:none}\n  .owner-intro-art{grid-column:2;grid-row:1;height:100%}\n  .owner-intro-image{position:static;aspect-ratio:1671/941;object-position:50% 40%}\n  .owner-intro-copy{grid-column:1;grid-row:1;width:auto;padding:44px clamp(28px,4vw,80px)}\n  .hero .owner-intro-copy h1{font-size:clamp(2.35rem,3.7vw,4.75rem)}\n  .hero .owner-intro-copy p{max-width:38ch}\n}\n@media(min-width:760px) and (max-width:919px){.owner-intro-image{object-position:50% 40%}}\n",
      "@font-face{font-family:\"Patrick Hand\";src:url(data:font/woff;base64,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) format(\"woff\");font-style:normal;font-weight:400;font-display:swap}\n#eveIntroList{margin:0 0 16px;padding-left:1.25em;color:var(--muted)}\n#eveIntroList li+li{margin-top:4px}\n.wall-finish-options{margin:0 auto 18px;text-align:center}\n.wall-finish-options p{margin:8px auto 0}\n.wall-finish-options button{margin:0}\n#generateWallFinish{border:1px solid #96afa4;background:#edf4f0;color:#174a3e;border-radius:24px;padding:11px 24px;font-weight:750}\n#generateWallFinish:hover:enabled{background:#174a3e;color:#fff}\n#restoreEditableWall:not([hidden]){display:block;margin:10px auto 0}\n#tailormadePanel{margin:12px 0 24px;padding:clamp(16px,3vw,28px);border:1px solid #c7d5ca;border-radius:14px;background:#f8faf6}\n#tailormadePanel h4{margin:0 0 8px;color:var(--forest);font-size:1.2rem}\n#tailormadePanel a.btn{text-decoration:none}\n#tailormadePanel .actions{margin-bottom:0}\n.template.tailormade-card{align-self:stretch;text-align:left;border:1px solid #b8cbbb;background:#f3f8f2}\n.tailormade-card[aria-expanded=true]{outline:2px solid var(--forest);outline-offset:3px}\n.tailormade-card-art{display:grid;place-content:center;padding:14px;aspect-ratio:390/747;background:radial-gradient(ellipse at 25% 15%,#fbfbf1,#dbece0);border-radius:8px;text-align:center}\n.tailormade-card-art span{font-family:\"Patrick Hand\",\"Bradley Hand\",\"Segoe Print\",\"Chalkboard SE\",cursive;font-size:clamp(1.35rem,2.7vw,2.7rem);line-height:1.13;color:#205347;transform:rotate(-5deg)}\n.tailormade-card small{margin-top:8px}\n"
    ],
    [
      ".live-stage{display:block;position:relative;overflow:hidden;aspect-ratio:390/850",
      ".live-stage{display:block;position:relative;overflow:hidden;aspect-ratio:390/747"
    ],
    [
      "width:390px;height:850px;border:0;transform-origin:top left",
      "width:390px;height:747px;border:0;transform-origin:top left"
    ],
    [
      "<div class=\"templates\" id=\"templates\"></div><div class=\"visual owner-invite-preview\">",
      "<div class=\"templates\" id=\"templates\"></div><div id=\"tailormadeCreateSlot\"></div><div class=\"visual owner-invite-preview\">"
    ],
    [
      "<div id=\"manageTemplates\" class=\"templates\"></div><div class=\"owner-preview-controls\" ",
      "<div id=\"manageTemplates\" class=\"templates\"></div><div id=\"tailormadeManageSlot\"></div><div class=\"owner-preview-controls\" "
    ],
    [
      "Compare all five styles using the example clinic name. Personalize the wall lettering after you save a style.",
      "Choose a template or explore a Tailormade AI receptionist. Personalize the wall lettering after you save a style."
    ],
    [
      "<p id=\"eveIntro\">Test a patient booking or give Eve the details she needs to set up your clinic.</p>",
      "<p id=\"eveIntro\" hidden></p>\n<ul id=\"eveIntroList\"><li>Talk or chat with Eve to set up your clinic.</li><li>Test a booking.</li></ul>"
    ],
    [
      "    $('eveIntro').textContent=workspaceIntake\n      ?'Tell Eve your opening hours, services, and how you handle bookings. She’ll fill those details into your form for you to review.'\n      :'Test a patient booking or give Eve the details she needs to set up your clinic.';",
      "    $('eveIntro').hidden=!workspaceIntake;\n    $('eveIntroList').hidden=workspaceIntake;\n    $('eveIntro').textContent='Tell Eve your opening hours, services, and how you handle bookings. She’ll fill those details into your form for you to review.';"
    ],
    [
      "Enter the email address your clinic team will check for new bookings.",
      "Enter the email address your clinic team will use to receive bookings from the AI receptionist."
    ],
    [
      "  <section id=\"wallFinishOptions\" class=\"wall-finish-options\" aria-labelledby=\"wallFinishTitle\" hidden>\n    <h4 id=\"wallFinishTitle\">Photographic finish</h4>\n    <p>Generate an image with polished gold lettering for Aesthetics Concierge. Check the spelling and signs in the preview before you confirm.</p>\n    <button id=\"generateWallFinish\" class=\"btn\" type=\"button\">Generate final image</button>\n    <button id=\"restoreEditableWall\" class=\"btn light\" type=\"button\" hidden>Return to editable lettering</button>\n    <p id=\"wallFinishStatus\" class=\"status\" role=\"status\"></p>\n  </section>\n",
      ""
    ],
    [
      "<details id=\"wallPhotoControls\" hidden>\n  <summary>Upload your own image</summary>\n  <label class=\"field\"><span>Reception photo</span><input type=\"file\" id=\"wallPhotoFile\" accept=\"image/jpeg,image/png,image/webp\"></label>\n  <p>Ideal size 1672 × 941 px. JPG, PNG or WebP under 12 MB. The public page uses a wide crop.</p>\n  <button type=\"button\" id=\"uploadWallPhoto\" class=\"btn light\">Upload photo</button>\n</details>\n",
      ""
    ],
    [
      "<h3>Your clinic name on the reception wall</h3><div class=\"wall-frame\" id=\"wallFrame\" hidden><iframe id=\"wallPreview\" title=\"Clinic scene with live desk signs\" sandbox=\"allow-same-origin\"></iframe></div>",
      "<h3>Your clinic name on the reception wall</h3><div class=\"wall-frame\" id=\"wallFrame\" hidden><iframe id=\"wallPreview\" title=\"Clinic scene with live desk signs\" sandbox=\"allow-same-origin\"></iframe></div>\n<div id=\"wallFinishOptions\" class=\"wall-finish-options\" hidden>\n  <button id=\"generateWallFinish\" type=\"button\" aria-describedby=\"wallFinishHelp\">✦ Generate AI image</button>\n  <p id=\"wallFinishHelp\">Generate a photographic version of the wall lettering. Check the spelling and desk signs before confirming.</p>\n  <button id=\"restoreEditableWall\" class=\"btn light\" type=\"button\" hidden>Return to editable lettering</button>\n  <p id=\"wallFinishStatus\" class=\"status\" role=\"status\"></p>\n</div>"
    ],
    [
      "<nav id=\"workspaceNavigation\" aria-label=\"Clinic Workspace\" hidden>",
      "<section id=\"tailormadePanel\" aria-labelledby=\"tailormadeTitle\" hidden>\n  <h4 id=\"tailormadeTitle\">Tailormade AI receptionist</h4>\n  <p>Upload your own reception image or ask Eden to help set up your receptionist and design a custom scene.</p>\n  <div id=\"wallPhotoControls\">\n    <label class=\"field\"><span>Reception photo</span><input type=\"file\" id=\"wallPhotoFile\" accept=\"image/jpeg,image/png,image/webp\"></label>\n    <p>Ideal size 1672 × 941 px. JPG, PNG or WebP under 12 MB. The public page uses a wide crop.</p>\n    <button type=\"button\" id=\"uploadWallPhoto\" class=\"btn light\">Upload photo</button>\n    <p id=\"tailormadeUploadStatus\" class=\"status\" role=\"status\"></p>\n  </div>\n  <div class=\"actions\"><a class=\"btn light\" href=\"mailto:team@clinicnet.live?subject=Tailormade%20AI%20receptionist\">Ask Eden about custom setup</a></div>\n</section>\n<nav id=\"workspaceNavigation\" aria-label=\"Clinic Workspace\" hidden>"
    ],
    [
      "src=\"/__eden/template-preview/${t.id}/?v=wall-samples-4\"",
      "src=\"/__eden/template-preview/${t.id}/?view=card&amp;v=wall-samples-5\""
    ],
    [
      "$('templates').addEventListener('click',event=>{\n  const card=event.target.closest('button[data-id]');\n  if(card)showTalkTemplate(card.dataset.id);\n});",
      "const tailormadeCard='<button type=\"button\" class=\"template tailormade-card\" data-tailormade aria-controls=\"tailormadePanel\" aria-expanded=\"false\"><span class=\"tailormade-card-art\"><span>Tailormade<br>AI receptionist</span></span><small>Upload a photo or ask Eden about custom setup.</small></button>';\n$('templates').insertAdjacentHTML('beforeend',tailormadeCard);\nlet tailormadeOpen=false, uploadAfterCreate=false;\nfunction renderTailormade(){\n  const screen=currentScreen==='screen-manage'||assistant?'manage':'create';\n  const slot=$(screen==='manage'?'tailormadeManageSlot':'tailormadeCreateSlot');\n  if($('tailormadePanel').parentElement!==slot)slot.append($('tailormadePanel'));\n  $('tailormadePanel').hidden=!tailormadeOpen||currentScreen==='screen-no-invite';\n  $('wallPhotoControls').hidden=assistant?.status==='published';\n  for(const card of document.querySelectorAll('[data-tailormade]'))\n    card.setAttribute('aria-expanded',String(tailormadeOpen&&card.closest('.templates').id===(screen==='manage'?'manageTemplates':'templates')));\n}\nfunction toggleTailormade(){\n  tailormadeOpen=!tailormadeOpen;\n  renderTailormade();\n  if(tailormadeOpen)$('tailormadePanel').scrollIntoView({block:'nearest'});\n}\n$('templates').addEventListener('click',event=>{\n  if(event.target.closest('[data-tailormade]'))return toggleTailormade();\n  const card=event.target.closest('button[data-id]');\n  if(card){\n    tailormadeOpen=false;\n    renderTailormade();\n    showTalkTemplate(card.dataset.id);\n  }\n});"
    ],
    [
      "  renderProgress(screen);\n}\n\nconst previewDeviceButtons",
      "  renderProgress(screen);\n  renderTailormade();\n}\n\nconst previewDeviceButtons"
    ],
    [
      "    view('screen-manage');\n    step(4);\n    $('alertHeading').focus({preventScroll:true});",
      "    view('screen-manage');\n    if(uploadAfterCreate){\n      uploadAfterCreate=false;\n      tailormadeOpen=true;\n      renderTailormade();\n      activeStep=1;\n      renderProgress('screen-manage');\n      await $('uploadWallPhoto').onclick();\n      return;\n    }\n    step(4);\n    $('alertHeading').focus({preventScroll:true});"
    ],
    [
      "  $('confirmWallCopy').hidden=$('wallPhotoControls').hidden=published;",
      "  $('confirmWallCopy').hidden=published;\n  $('wallPhotoControls').hidden=published;"
    ],
    [
      "  $('wallFinishOptions').hidden=published||a.heroIsUpload||a.template!=='lumi';\n  $('generateWallFinish').disabled=wallCopyBusy;",
      "  $('wallFinishOptions').hidden=published||a.heroIsUpload||$('wallFrame').hidden;\n  $('generateWallFinish').disabled=wallCopyBusy;"
    ],
    [
      "  $('wallFrame').hidden=true;",
      "  $('wallFrame').hidden=true;\n  $('wallFinishOptions').hidden=true;"
    ],
    [
      "  status('wallStatus','Updating your reception photo…');",
      "  const target=button==='uploadWallPhoto'?'tailormadeUploadStatus':'wallStatus';\n  status(target,'Updating your reception photo…');"
    ],
    [
      "    status('wallStatus',message);\n  }catch(error){\n    if(error.status!==401){\n      status('wallStatus',error.message,true);\n    }else if(useWorkspace){\n      $('reopenWallSetup').href=$('backToWorkspace').href;\n      $('wallPhotoReconnect').hidden=false;\n      status('wallStatus',button==='uploadWallPhoto'",
      "    status(target,message);\n    if(button==='uploadWallPhoto')$('wallSceneCard').scrollIntoView({block:'start'});\n  }catch(error){\n    if(error.status!==401){\n      status(target,error.message,true);\n    }else if(useWorkspace){\n      $('reopenWallSetup').href=$('backToWorkspace').href;\n      $('wallPhotoReconnect').hidden=false;\n      if(button==='uploadWallPhoto')$('tailormadeUploadStatus').after($('wallPhotoReconnect'));\n      status(target,button==='uploadWallPhoto'"
    ],
    [
      "status('wallStatus','Open your private setup link again to restore access.',true);",
      "status(target,'Open your private setup link again to restore access.',true);"
    ],
    [
      "  if(!file){$('wallPhotoFile').focus();return status('wallStatus','Choose a photo to upload.',true)}\n  let image;",
      "  if(!file){$('wallPhotoFile').focus();return status('tailormadeUploadStatus','Choose a photo to upload.',true)}\n  if(!assistant){\n    try{await prepareWallPhoto(file)}\n    catch(error){return status('tailormadeUploadStatus',error.message,true)}\n    if($('wallPhotoFile').files[0]!==file)return;\n    if(assistant)return $('uploadWallPhoto').onclick();\n    uploadAfterCreate=true;\n    status('tailormadeUploadStatus','Photo ready to upload after you save your clinic details.');\n    step(3);\n    return;\n  }\n  let image;"
    ],
    [
      "  },'Photo uploaded. Check the preview above, then confirm the photo.');",
      "  },'Photo uploaded. Review it in Your clinic name on the reception wall.');"
    ],
    [
      "$('wallPhotoFile').onchange=()=>actionState('uploadWallPhoto','');",
      "$('wallPhotoFile').onchange=()=>{\n  uploadAfterCreate=false;\n  actionState('uploadWallPhoto','');\n  status('tailormadeUploadStatus','');\n};"
    ],
    [
      "    status('wallFinishStatus',result.wallNotice||\n      (generating?'Your final image is ready. Check the spelling, then confirm the wall and signs.':'Editable lettering is ready. Check the preview, then confirm the wall and signs.'),Boolean(result.wallNotice));",
      "    status('wallFinishStatus',result.wallNotice||\n      (generating?'Your AI image is ready. Check the spelling, then confirm the wall and signs.':'Editable lettering is ready. Check the preview, then confirm the wall and signs.'),Boolean(result.wallNotice));"
    ],
    [
      "renderStylePreview(current);renderStyleActions(current)}",
      "renderStylePreview(current);renderStyleActions(current);renderTailormade()}"
    ],
    [
      "$('manageTemplates').onclick=event=>{\n  const card=event.target.closest('button[data-id]');\n  if(!card||$('chooseStyle').disabled)return;\n  $('editTemplate').value=card.dataset.id;",
      "$('manageTemplates').onclick=event=>{\n  if(event.target.closest('[data-tailormade]'))return toggleTailormade();\n  const card=event.target.closest('button[data-id]');\n  if(!card||$('chooseStyle').disabled)return;\n  tailormadeOpen=false;\n  $('editTemplate').value=card.dataset.id;"
    ],
    [
      ".templates{grid-template-columns:repeat(2,1fr)}",
      ".templates{grid-template-columns:repeat(2,minmax(0,1fr))}"
    ],
    [
      ".template.tailormade-card{",
      "@media(min-width:1150px){.templates{grid-template-columns:repeat(6,minmax(0,1fr))}}\n.template.tailormade-card{"
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
  console.log('Tailormade reception check passed. '+changed.length+' file(s) would change.');
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
  console.log('Tailormade reception updated. Backup: '+backup);
}
