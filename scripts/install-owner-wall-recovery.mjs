import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const marker='Eden owner wall recovery v1';
const args=process.argv.slice(2);
const check=args.includes('--check');
const paths=args.filter(arg=>arg!=='--check');
if(paths.length>1||paths.some(arg=>arg.startsWith('-')))throw Error('Usage: node install-owner-wall-recovery.mjs [site directory] [--check]');
const root=paths[0]||join(homedir(),'Desktop','clinicnet-voice-preview');

function replace(source,anchor,replacement){
  if(typeof anchor==='string'?!source.includes(anchor):!anchor.test(source))throw Error('Incompatible owner setup near '+String(anchor).slice(0,110));
  return source.replace(anchor,typeof replacement==='function'?replacement:()=>replacement);
}

const deskCore=`/* ${marker} */
async function readDeskSigns(env,id){
  try{
    const signs=await env.PILOT_DB.prepare('SELECT welcome,chat,services FROM assistant_desk_signs WHERE assistant_id=?').bind(id).first();
    return signs||null;
  }catch(error){
    if(/no such table: assistant_desk_signs/i.test(error.message))return null;
    throw error;
  }
}
async function saveDeskSigns(request,env,a){
  if(a.status==='published')return json({error:'Published desk signs need an owner support review.'},409);
  if(a.hero_status==='generating'&&Date.now()-Date.parse(a.updated_at)<600000)return json({error:'Wait for the wall image to finish before saving desk signs.'},409);
  const input=await body(request);
  const welcome=typeof input.welcome==='string'?input.welcome.trim():null;
  const chat=typeof input.chat==='string'?input.chat.trim():null;
  const lines=typeof input.services==='string'?input.services.split(/\\r?\\n/).map(line=>line.trim()).filter(Boolean):null;
  if(!value(welcome,0,62)||!value(chat,0,32)||!lines||lines.length>3||!lines.every(line=>value(line,1,28)))
    return json({error:'Use a short welcome line, a short chat line, and up to three service lines of 28 characters each.'},400);
  const services=lines.join('\\n');
  const db=env.PILOT_DB;
  await db.prepare('CREATE TABLE IF NOT EXISTS assistant_desk_signs (assistant_id TEXT PRIMARY KEY,welcome TEXT NOT NULL,chat TEXT NOT NULL,services TEXT NOT NULL)').run();
  const previous=await readDeskSigns(env,a.id);
  if((previous?.welcome||'')===welcome&&(previous?.chat||'')===chat&&(previous?.services||'')===services)
    return json({ok:true});
  const results=await db.batch([
    db.prepare("INSERT INTO assistant_desk_signs (assistant_id,welcome,chat,services) SELECT id,?,?,? FROM clinic_assistants WHERE id=? AND updated_at=? AND status!='published' ON CONFLICT(assistant_id) DO UPDATE SET welcome=excluded.welcome,chat=excluded.chat,services=excluded.services")
      .bind(welcome,chat,services,a.id,a.updated_at),
    db.prepare("UPDATE clinic_assistants SET hero_reviewed_at=NULL,review_approved_at=NULL,updated_at=? WHERE id=? AND updated_at=? AND status!='published'")
      .bind(now(),a.id,a.updated_at)
  ]);
  if(results[0]?.meta?.changes!==1||results[1]?.meta?.changes!==1)
    return json({error:'Setup changed. Reload and try the desk-sign edit again.'},409);
  return json({ok:true});
}
async function availableTemplateWall(request,env,theme){
  const path=wallTemplatePath(theme);
  if(!path||!env.ASSETS)return null;
  try{
    const image=await env.ASSETS.fetch(new Request(new URL(path,request.url),{method:'HEAD'}));
    return image.ok?'template/'+theme:null;
  }catch{return null}
}
`;

const generation=`  if((a.hero_attempts||0)>=3)return json({error:'Three image attempts have been used for this style. You can use the template wall below.'},429);
  const canGenerate=Boolean(env.OPENAI_IMAGE_API_KEY&&env.EDEN_HERO_IMAGES);
  if(canGenerate&&!await limit(env,'owner-wall:'+id,5,86400))
    return json({error:'Five image attempts are available per day. Try again tomorrow or use the template wall below.'},429);
  const attempt=(a.hero_attempts||0)+1;
  const claimTime=now();
  const claim=await env.PILOT_DB.prepare("UPDATE clinic_assistants SET hero_status='generating',hero_attempts=COALESCE(hero_attempts,0)+1,updated_at=? WHERE id=? AND status!='published' AND updated_at=? AND (COALESCE(hero_status,'')!='generating' OR updated_at < ?) AND COALESCE(hero_attempts,0)<3")
    .bind(claimTime,id,a.updated_at,new Date(Date.now()-600000).toISOString()).run();
  if(claim.meta?.changes!==1)return json({error:'The wall or setup changed. Reload before trying again.'},409);

  let key, notice='';
  if(canGenerate){
    try{key=await createWallImage(request,env,a)}
    catch(error){console.warn('Wall photo unavailable',error.message)}
  }
  if(!key){
    key=a.hero_key||await availableTemplateWall(request,env,a.template);
    notice=a.hero_key?'A new image could not be made. Your previous wall is still available.':'The image service is unavailable. Review your clinic name on the template wall below.';
  }
  const ready=Boolean(key), keepApproval=ready&&key===a.hero_key;
  const saved=await env.PILOT_DB.prepare("UPDATE clinic_assistants SET hero_key=?,hero_status=?,hero_reviewed_at=CASE WHEN ? THEN hero_reviewed_at ELSE NULL END,review_approved_at=CASE WHEN ? THEN review_approved_at ELSE NULL END,updated_at=? WHERE id=? AND updated_at=? AND hero_status='generating' AND hero_attempts=?")
    .bind(key||null,ready?'ready':'failed',keepApproval?1:0,keepApproval?1:0,now(),id,claimTime,attempt).run();
  if(saved.meta?.changes!==1)return json({error:'A newer setup change took precedence. Reload to review it.'},409);
  if(!ready)return json({error:'The wall image and template photo are unavailable. Retry when your connection is stable.'},503);
  return json({...ownerView({...a,hero_key:key,hero_status:'ready',hero_attempts:attempt,hero_reviewed_at:keepApproval?a.hero_reviewed_at:null,review_approved_at:keepApproval?a.review_approved_at:null}),wallNotice:notice});
}
`;

function core(source){
  if(source.includes(marker))return source;
  if(!source.includes('Eden owner review flow v1'))throw Error('Install the owner review flow first.');
  source=replace(source,'function ownerPreview(request,a){',deskCore+'function ownerPreview(request,a){');
  source=replace(source,'const ownerView = a => ({id:a.id,','const ownerView = a => ({deskSigns:a.deskSigns||null,id:a.id,');
  source=replace(source,"if(request.method==='GET'&&!action)return json(ownerView(a));",
    "if(!action||['preview','details','hero-generate','hero-template','hero-approve','review','voice'].includes(action))a.deskSigns=await readDeskSigns(env,id);if(request.method==='GET'&&!action)return json(ownerView(a));");
  source=replace(source,"if(action==='hero-generate'&&request.method==='POST'){",
    "if(action==='desk-signs'&&request.method==='POST')return saveDeskSigns(request,env,a);\nif(action==='hero-generate'&&request.method==='POST'){");
  source=replace(source,/  if\(!env\.OPENAI_IMAGE_API_KEY\|\|!env\.EDEN_HERO_IMAGES\)return json\([\s\S]*?(?=if\(action==='hero-template')/,generation);
  source=replace(source,/  const path=wallTemplatePath\(a\.template\);\n  if\(!path[\s\S]*?const stamp=now\(\),hero='template\/'\+a\.template;/,
    "  const hero=await availableTemplateWall(request,env,a.template);\n  if(!hero)return json({error:'The template photo is unavailable. Try again later.'},503);\n  const stamp=now();");
  source=replace(source,"if(a.status==='published'||!a.voice_test_at)return json({error:'Finish the private voice test before starting the interview on a draft.'},409);",
    "if(a.status==='published'||!a.agent_id)return json({error:'Start the practice voice test to set up Eve first.'},409);");
  source=replace(source,"limit(env,`owner-voice:${id}`,20,86400))return json({error:'Daily voice test limit reached.'}",
    "limit(env,`owner-voice:v2:${id}`,4,86400))return json({error:'Four voice test starts are available per day. Try again tomorrow.'}");
  source=replace(source,"return json({signedUrl:result.signed_url})}\nif(action==='owner-interview'", "return json({signedUrl:result.signed_url,agentId:a.agent_id})}\nif(action==='owner-interview'");
  source=replace(source,"await env.PILOT_DB.prepare('UPDATE clinic_assistants SET voice_test_at=? WHERE id=?').bind(now(),id).run();return json({ok:true})",
    `const x=await body(request);
  if(x.agentId&&x.agentId!==a.agent_id)return json({error:'The voice was updated. Test the current voice again.'},409);
  const tested=await env.PILOT_DB.prepare('UPDATE clinic_assistants SET voice_test_at=? WHERE id=? AND agent_id=?').bind(now(),id,a.agent_id).run();
  if(tested.meta?.changes!==1)return json({error:'The voice was updated. Test the current voice again.'},409);
  return json({ok:true})`);
  source=replace(source,"if(x.heroUrl&&x.heroUrl!==ownerView(a).heroUrl)","if((x.heroUrl&&x.heroUrl!==ownerView(a).heroUrl)||(Object.hasOwn(x,'deskSigns')&&JSON.stringify(x.deskSigns)!==JSON.stringify(a.deskSigns||null)))");
  source=replace(source,"if(x.approved!==true)return json({error:'Review the page and approve it first.'},400);","if(x.approved!==true)return json({error:'Review the page and approve it first.'},400);if(Object.hasOwn(x,'deskSigns')&&JSON.stringify(x.deskSigns)!==JSON.stringify(a.deskSigns||null))return json({error:'Desk signs changed. Reload and review the current page.'},409);");
  source=replace(source," const signServices=splitServices(a.services).filter(s=>s.length<=25).slice(0,5);",
    " const desk=a.deskSigns;\n const signServices=desk?.services?desk.services.split('\\n'):splitServices(a.services).filter(s=>s.length<=25).slice(0,5);");
  source=replace(source,'<h2>WELCOME</h2>${featured?', '<h2>WELCOME</h2>${desk?.welcome?`<p class="sign-feature">${h(desk.welcome)}</p>`:`${featured?');
  source=replace(source,"'Questions welcome'}</p></div><div class=\"sign-plate center\"", "'Questions welcome'}</p>`}</div><div class=\"sign-plate center\"");
  source=replace(source,"<h2>CHAT WITH US</h2><p>${a.booking_mode==='request'?'Ask or request a time':'Ask a question'}</p>",
    "<h2>CHAT WITH US</h2><p>${desk?.chat?h(desk.chat):a.booking_mode==='request'?'Ask or request a time':'Ask a question'}</p>");
  source=replace(source,"if(!action&&request.method==='GET')return new Response(clinicHtml(a),",
    "if(!action&&request.method==='GET')return new Response(clinicHtml({...a,deskSigns:await readDeskSigns(env,a.id)}),");
  return replace(source,'|hero-template|hero-approve|details)', '|hero-template|hero-approve|desk-signs|details)');
}

function image(source){
  if(source.includes(marker))return source;
  source=replace(source,'/* Eden photographic wall generation v5. Server only. */','/* Eden photographic wall generation v5. Server only. */\n/* '+marker+' */');
  source=replace(source, " let data;try{data=await response.json()}catch{throw Error('Image service returned an unreadable response.')}if(!response.ok||!data?.data?.[0]?.b64_json){console.error('Wall image edit failed',response.status,data?.error?.code||'unknown');throw Error('The wall image could not be generated. Try again later.');}",
    ` let data;
 try{data=await response.json()}catch{data=null}
 if(!response.ok||!data?.data?.[0]?.b64_json){
   const code=String(data?.error?.code||'unavailable').replace(/[^a-z0-9_-]/gi,'').slice(0,60);
   const requestId=response.headers.get('x-request-id')||'none';
   throw Error('Image edit HTTP '+response.status+' ('+code+', request '+requestId+').');
 }`);
  return source;
}

const css=`
/* ${marker} */
.eve-demo{display:block;padding-bottom:18px;isolation:isolate;background:#f9f5eb}
.eve-photo{height:auto;min-height:0;aspect-ratio:auto}
.eve-image{position:static;display:block;width:100%;height:auto;object-fit:contain}
.eve-chat{position:relative;z-index:1;width:min(88%,820px);margin:clamp(-205px,-17vw,-55px) auto 0;background:linear-gradient(180deg,#ddc2a7f2,#f5ecddf7 62%);border:1px solid #fff8;border-radius:25px;box-shadow:0 16px 42px #3d291b25}
.eve-talk-row svg,#eveInterviewStart svg{width:23px;height:23px}
.eve-talk-row button[aria-pressed=true] .eve-mic,#eveInterviewStart[aria-pressed=true] .eve-mic{background:#9d382c}
#talk,#wallSceneCard{scroll-margin-top:100px}
#voiceRetestNote{text-align:center;color:#465f55}
#deskSignEditor{margin:14px 0;padding:14px;border:1px solid #c7d8c9;border-radius:12px}
#deskSignEditor summary{cursor:pointer;font-weight:750}
#deskSignEditor label{margin-top:10px}
#deskSignEditor textarea{min-height:76px}
#saveDeskSigns{margin-top:12px}
@media(max-width:650px){.eve-chat{width:calc(100% - 24px);margin-top:-35px}}
`;

const deskEditor=`<details id="deskSignEditor">
<summary>Edit desk-sign text</summary>
<p>Shorten what appears on the signs. These edits only affect the image captions. Leave a field blank to use the text from your clinic setup.</p>
<form id="deskSignForm">
<label class="field"><span>Welcome sign</span><input id="deskWelcome" maxlength="62" placeholder="A short welcome or your hours"></label>
<label class="field"><span>Chat sign</span><input id="deskChat" maxlength="32" placeholder="Ask us about appointments"></label>
<label class="field"><span>Services sign</span><textarea id="deskServices" rows="3" maxlength="86" placeholder="Up to three lines, 28 characters each"></textarea></label>
<button id="saveDeskSigns" class="btn light" type="submit">Save desk-sign text</button>
<p id="deskSignStatus" class="status" role="status"></p>
</form>
</details>
`;

const deskScript=`let deskSignDirty=false;
const deskInputs={welcome:'deskWelcome',chat:'deskChat',services:'deskServices'};
function renderDeskSigns(){
  $('deskSignEditor').hidden=assistant.status==='published';
  if(deskSignDirty)return;
  for(const [key,field] of Object.entries(deskInputs))$(field).value=assistant.deskSigns?.[key]||'';
}
$('deskSignForm').oninput=()=>{deskSignDirty=true};
$('deskSignForm').onsubmit=async event=>{
  event.preventDefault();
  const button=$('saveDeskSigns');
  if(button.disabled)return;
  button.disabled=true;
  for(const field of Object.values(deskInputs))$(field).readOnly=true;
  try{
    const values=Object.fromEntries(Object.entries(deskInputs).map(([key,field])=>[key,$(field).value]));
    await api('/api/assistants/'+id+'/desk-signs',{method:'POST',body:JSON.stringify(values)});
    assistant=await api('/api/assistants/'+id);
    deskSignDirty=false;
    $('wallNameCorrect').checked=false;
    $('approveCheck').checked=false;
    renderManage();
    status('deskSignStatus','Desk signs saved. Check them in the wide preview before approving.');
  }catch(error){status('deskSignStatus',error.message,true)}
  finally{
    button.disabled=false;
    for(const field of Object.values(deskInputs))$(field).readOnly=false;
  }
};
`;

function setup(source){
  if(source.includes(marker))return source;
  if(!source.includes('Eden owner review flow v1'))throw Error('Install the owner review flow first.');
  source=replace(source,'</style></head>',css+'</style></head>');
  source=replace(source,'<h4 id="wallApproval" hidden>',deskEditor+'<h4 id="wallApproval" hidden>');
  source=replace(source,'<p id="voiceStatus" class="status" role="status"></p>',
    '<p id="voiceStatus" class="status" role="status"></p><p id="voiceRetestNote" hidden>Clinic details were updated. Run a fresh voice test before approval. The setup interview is available below.</p>');
  source=replace(source,"const canInterview=()=>assistant?.voiceReviewed&&assistant.status!=='published';",
    "const canInterview=()=>assistant?.agentReady&&assistant.status!=='published';");
  source=replace(source,"$('talk').disabled=eveBusy||eveMode==='interview';","$('talk').disabled=eveBusy;");
  source=replace(source,"  $('eveInterview').hidden=!canInterview();",
    "  $('eveInterview').hidden=!canInterview();\n  $('voiceRetestNote').hidden=!assistant?.agentReady||assistant.voiceReviewed||assistant.status==='published';");
  source=replace(source,"await api('/api/assistants/'+id+'/voice-reviewed',{method:'POST',body:'{}'});",
    "await api('/api/assistants/'+id+'/voice-reviewed',{method:'POST',body:JSON.stringify({agentId:result.agentId})});");
  source=replace(source,"$('useTemplateWall').hidden=a.status==='published'||a.heroReady||a.generatedWallAvailable;",
    "$('useTemplateWall').hidden=a.status==='published'||a.heroIsTemplate||a.heroIsPilot;");
  source=replace(source,"a.heroReady?'Review the wall and confirm the exact name.'",
    "a.heroReady?(a.heroIsTemplate?'Template wall ready. Check the clinic name and desk signs below.':'Review the wall and confirm the exact name.')");
  source=replace(source,"  syncEveControls();\n  void loadMobilePreview();",
    "  renderDeskSigns();\n  syncEveControls();\n  void loadMobilePreview();");
  source=replace(source,"    status('manageChooseStatus','Wall image ready. Check the spelling and desk signs in the wide preview below.');",
    "    const notice=assistant.wallNotice||'Wall image ready. Check the spelling and desk signs in the wide preview below.';\n    for(const target of targets)status(target,notice);");
  source=replace(source,"  }catch(error){\n    for(const target of targets)status(target,error.message,true);",
    "  }catch(error){\n    const current=await api('/api/assistants/'+id).catch(()=>null);\n    if(current){assistant=current;renderManage()}\n    for(const target of targets)status(target,error.message,true);");
  source=replace(source,'nameCorrect:true,heroUrl:assistant.heroUrl','nameCorrect:true,heroUrl:assistant.heroUrl,deskSigns:assistant.deskSigns||null');
  source=replace(source,"{approved:$('approveCheck').checked}","{approved:$('approveCheck').checked,deskSigns:assistant.deskSigns||null}");
  source=replace(source,'a.heroUrl,a.variant]);','a.heroUrl,a.variant,a.deskSigns]);');
  source=replace(source,'assistant.featuredService,assistant.variant]);','assistant.featuredService,assistant.variant,assistant.deskSigns]);');
  source=replace(source,'assistant.phone,assistant.mapsUrl]);','assistant.phone,assistant.mapsUrl,assistant.deskSigns]);');
  source=replace(source,"[!a.voiceReviewed,'Run the voice test','talkStep']", "[!a.voiceReviewed,a.agentReady?'Retake the voice test':'Run the voice test','talk']");
  source=replace(source,"link.onclick=event=>{event.preventDefault();$(target).scrollIntoView({block:'start',behavior:'smooth'});};",
    "link.onclick=event=>{event.preventDefault();$(target).scrollIntoView({block:'start',behavior:'smooth'});if(target==='talk')$(target).focus({preventScroll:true});};");
  source=replace(source,"if(id&&key){activeStep=3;",deskScript+"\nif(id&&key){activeStep=3;");
  return source;
}

const changes=[['assistant-core.js',core],['hero-image.js',image],['assistant-setup/index.html',setup]].map(([path,transform])=>{
  const file=join(root,path),before=readFileSync(file,'utf8');
  return {path,file,before,after:transform(before)};
}).filter(({before,after})=>before!==after);
if(check||!changes.length){
  console.log('Owner wall recovery check passed. '+changes.length+' file(s) would change.');
}else{
  const backup=mkdtempSync(join(tmpdir(),'eden-owner-wall-recovery-'));
  for(const {file,before,path} of changes){
    if(readFileSync(file,'utf8')!==before)throw Error('Site changed. Try again.');
    const target=join(backup,path);
    mkdirSync(dirname(target),{recursive:true});
    copyFileSync(file,target);
  }
  const written=[];
  try{
    for(const change of changes){
      const temporary=change.file+'.eden-'+process.pid;
      try{
        writeFileSync(temporary,change.after,{flag:'wx'});
        renameSync(temporary,change.file);
      }finally{rmSync(temporary,{force:true})}
      written.push(change);
    }
  }catch(error){
    for(const {file,path} of written.reverse())copyFileSync(join(backup,path),file);
    throw error;
  }
  console.log('Owner wall recovery installed. Backup: '+backup);
}
