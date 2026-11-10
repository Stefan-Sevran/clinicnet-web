import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const marker='Eden owner Eve modes v1';
const args=process.argv.slice(2);
const check=args.includes('--check');
const paths=args.filter(arg=>arg!=='--check');
if(paths.length>2||paths.some(arg=>arg.startsWith('-')))throw Error('Usage: node install-owner-eve-modes.mjs [site directory] [asset directory] [--check]');
const root=paths[0]||join(homedir(),'Desktop','clinicnet-voice-preview');
const assetDir=paths[1]||fileURLToPath(new URL('../assets/',import.meta.url));
const assetName='eden-cebu-dent-lumi-wall.webp';

function replace(source,anchor,replacement){
  if(typeof anchor==='string'?!source.includes(anchor):!anchor.test(source))throw Error('Incompatible owner setup near '+String(anchor).slice(0,110));
  return source.replace(anchor,typeof replacement==='function'?replacement:()=>replacement);
}

const cebuWalls=`/* ${marker} */
function cebuWall(a){
  if(a.id!=='0fc86bd9-b703-49b2-be0c-d64c2b19cd91'||a.clinic!=='Cebu Dent Clinic (Test)')return null;
  if(a.template==='pearl')return {key:'pilot/cebu-dent-test',asset:'/assets/eden-cebu-dent-pilot-wall.webp'};
  if(a.template==='lumi')return {key:'pilot/cebu-dent-test-lumi',asset:'/assets/eden-cebu-dent-lumi-wall.webp'};
  return null;
}
function canUseCebuWall(a){return Boolean(cebuWall(a))}
function hasCebuWall(a){
  const wall=cebuWall(a);
  return Boolean(wall&&a.hero_status==='ready'&&wall.key===a.hero_key);
}
`;

const plaqueCss=`
/* Horizontal baselines follow the top edges of the photographed plaques. */
body.theme-pearl.variant-original.has-photo-wall{--left-plaque-slope:-.8deg;--right-plaque-slope:2.1deg}
body.theme-lumi.variant-original.has-photo-wall{--left-plaque-slope:-1.4deg;--right-plaque-slope:1.4deg}
body.theme-siam.variant-original.has-photo-wall{--left-plaque-slope:-.6deg;--right-plaque-slope:.1deg}
body.theme-pattaya.variant-original.has-photo-wall{--left-plaque-slope:-2.6deg;--right-plaque-slope:.2deg}
body.theme-mabuhay.variant-original.has-photo-wall{--left-plaque-slope:-2.1deg;--right-plaque-slope:1.9deg}
body.variant-original.has-photo-wall .sign-plate.left{transform:skewY(var(--left-plaque-slope));transform-origin:50% 0}
body.variant-original.has-photo-wall .sign-plate.right{transform:skewY(var(--right-plaque-slope));transform-origin:50% 0}
body.theme-pearl.variant-original.has-cebu-pilot-wall{--left-plaque-slope:-1deg;--right-plaque-slope:2deg}
body.theme-lumi.variant-original.has-cebu-pilot-wall{--left-plaque-slope:-1.3deg;--right-plaque-slope:1.6deg}
body.theme-lumi.variant-original.has-cebu-pilot-wall .sign-plate.left{left:16.9%;top:51.4%;width:12.1%;height:30.8%}
body.theme-lumi.variant-original.has-cebu-pilot-wall .sign-plate.center{left:42.8%;top:71%;width:16.3%;height:14.5%}
body.theme-lumi.variant-original.has-cebu-pilot-wall .sign-plate.right{left:72.5%;top:52.6%;width:12.1%;height:30.7%}
`;

function core(source){
  if(source.includes(marker))return source;
  if(!source.includes('Eden owner wall recovery v1'))throw Error('Install owner wall recovery first.');
  source=replace(source,/const cebuWallKey=[\s\S]*?(?=\/\* Eden owner review flow v1 \*\/)/,cebuWalls);
  source=replace(source,'hasCebuWall(a)?cebuWallAsset:', 'hasCebuWall(a)?cebuWall(a).asset:');
  source=replace(source,"  const theme=selected||a.template;\n  const draft=theme===a.template&&a.hero_key&&a.hero_status==='ready'?a:{\n    ...a,template:theme,variant:'original',hero_key:theme===a.template&&canUseCebuWall(a)?cebuWallKey:'template/'+theme,hero_status:'ready'\n  };",
    `  const theme=selected||a.template;
  const themed={...a,template:theme};
  const draft=theme===a.template&&a.hero_key&&a.hero_status==='ready'?a:{
    ...themed,variant:'original',hero_key:cebuWall(themed)?.key||'template/'+theme,hero_status:'ready'
  };`);
  source=replace(source,"  if(canUseCebuWall(a)){\n    const asset=await env.ASSETS?.fetch(new Request(new URL(cebuWallAsset,request.url),{method:'HEAD'}));",
    "  const pilot=cebuWall(a);\n  if(pilot){\n    const asset=await env.ASSETS?.fetch(new Request(new URL(pilot.asset,request.url),{method:'HEAD'}));");
  source=replace(source,'.bind(cebuWallKey,stamp,id,a.updated_at)', '.bind(pilot.key,stamp,id,a.updated_at)');
  source=replace(source,'hero_key:cebuWallKey,', 'hero_key:pilot.key,');
  source=replace(source,'const photoWall=pilotWall?cebuWallAsset:', 'const photoWall=pilotWall?cebuWall(a).asset:');
  source=replace(source,"  if((a.hero_attempts||0)>=3)return json({error:'Three image attempts have been used for this style. You can use the template wall below.'},429);\n",'');
  source=replace(source,"OR updated_at < ?) AND COALESCE(hero_attempts,0)<3", "OR updated_at < ?)");
  source=replace(source,"  let key, notice='';", "  let key, notice='', imageIssue=canGenerate?'':'configuration';");
  source=replace(source,"    catch(error){console.warn('Wall photo unavailable',error.message)}",
    "    catch(error){imageIssue=error.wallIssue||'processing';console.warn('Wall photo unavailable',error.message)}");
  source=replace(source,"    notice=a.hero_key?'A new image could not be made. Your previous wall is still available.':'The image service is unavailable. Review your clinic name on the template wall below.';",
    `    const descriptions={
      configuration:'Image generation is unavailable in this deployment.',
      access:'The image service rejected the project’s access.',
      capacity:'The image service is rate-limited right now.',
      quota:'The image project has reached its available quota.',
      request:'The image service rejected the edit request.',
      provider:'The image service is temporarily unavailable.',
      processing:'The generated photo could not be saved or processed.'
    };
    notice=descriptions[imageIssue]+' '+(a.hero_key?'Your previous wall is still available.':'The template wall is ready to review below.');`);
  return replace(source,'/* Eden wall priority v10 */',plaqueCss+'/* Eden wall priority v10 */');
}

function image(source){
  if(source.includes(marker))return source;
  source=replace(source,'/* Eden owner wall recovery v1 */','/* Eden owner wall recovery v1 */\n/* '+marker+' */');
  return replace(source,"   throw Error('Image edit HTTP '+response.status+' ('+code+', request '+requestId+').');",
    `   const error=Error('Image edit HTTP '+response.status+' ('+code+', request '+requestId+').');
   if(['insufficient_quota','billing_hard_limit_reached'].includes(code))error.wallIssue='quota';
   else if([401,403,404].includes(response.status))error.wallIssue='access';
   else if(response.status===429)error.wallIssue='capacity';
   else if(response.status>=500)error.wallIssue='provider';
   else if(response.status>=400)error.wallIssue='request';
   else error.wallIssue='processing';
   throw error;`);
}

const progressScript=`const draftSteps=[['Talk','talkStep'],['Choose','manageChoose'],['Clinic','editDetails'],['Alert','alertStep'],['Publish','publishStep']];
const invitationSteps=[['Choose','templates'],['Clinic','clinic'],['Talk',null],['Alert',null],['Publish',null]];
let activeStep=1;
function renderProgress(screen){
  const current=screen==='screen-manage'?draftSteps:invitationSteps;
  current.forEach(([label,target],index)=>{
    const button=$('p'+(index+1)), active=activeStep===index+1&&screen!=='screen-no-invite';
    button.textContent=(index+1)+' '+label;
    button.disabled=screen==='screen-no-invite'||!target;
    button.classList.toggle('active',active);
    if(active)button.setAttribute('aria-current','step');
    else button.removeAttribute('aria-current');
  });
}
function step(n){
  const screen=id?'screen-manage':'screen-create';
  const target=(id?draftSteps:invitationSteps)[n-1]?.[1];
  if(!target)return;
  activeStep=n;
  renderProgress(screen);
  $(target).scrollIntoView({block:'start',behavior:'smooth'});
}
function view(screen){
  for(const section of ['screen-create','screen-manage','screen-no-invite'])$(section).hidden=section!==screen;
  renderProgress(screen);
}
`;

const modeMarkup=`<div id="eveModes" class="eve-modes" role="group" aria-label="Choose how to use Eve">
      <button id="evePracticeMode" type="button" aria-pressed="true">Practice a booking</button>
      <button id="eveSetupMode" type="button" aria-pressed="false">Set up my clinic</button>
    </div>
    <p id="eveModeHint" class="eve-mode-hint">Try a private practice booking. No request is sent.</p>
    `;

const setupCss=`
/* ${marker} */
.eve-modes{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px}
.eve-modes button{flex:1 1 135px;border:1px solid #ad9b82;border-radius:20px;padding:8px 14px;background:#fff9;color:var(--ink);font-weight:700}
.eve-modes button[aria-pressed=true]{background:#174a3e;color:white;border-color:#174a3e}
.eve-mode-hint{font-size:.92rem;min-height:1.3em;margin:0 0 12px;color:#41584f}
`;

const modeControls=`const canInterview=()=>Boolean(assistant&&assistant.status!=='published');
function showEveModeConversation(){
  const settingUp=selectedEveMode==='interview';
  const history=settingUp?interviewHistory:practiceHistory;
  $('eveTranscript').replaceChildren();
  for(const entry of history)addEveMessage(entry);
  if(!history.length)addEveMessage({role:'agent',message:settingUp
    ?'Tell me your clinic’s hours, services, and how your team handles booking requests.'
    :'Hi, I’m Eve. Try asking me about opening hours or an appointment.'});
}
function syncEveControls(){
  const settingUp=selectedEveMode==='interview';
  const inVoice=eveMode===selectedEveMode;
  $('eveTalkLabel').textContent=inVoice?(settingUp?'End voice interview':'End voice test'):(settingUp?'Start voice interview':'Start voice test');
  $('talk').setAttribute('aria-pressed',String(inVoice));
  $('talk').disabled=eveBusy;
  $('evePracticeMode').disabled=eveBusy;
  $('eveSetupMode').disabled=eveBusy||!canInterview();
  $('eveSetupMode').hidden=assistant?.status==='published';
  $('evePracticeMode').setAttribute('aria-pressed',String(!settingUp));
  $('eveSetupMode').setAttribute('aria-pressed',String(settingUp));
  $('eveMessage').disabled=$('eveSend').disabled=eveBusy||(!session&&(!settingUp||!canInterview()));
  $('eveMessage').placeholder=settingUp?'Type clinic details or a correction…':'Type during your practice call…';
  $('eveConversationLabel').textContent=settingUp?'Clinic setup interview':'Private receptionist test';
  $('eveModeHint').textContent=settingUp?'Talk or type in English. Share clinic information only.':'Try a private practice booking. No request is sent.';
  $('eveInterview').hidden=!canInterview()||$('eveDraftReview').hidden;
  $('voiceRetestNote').hidden=!assistant?.agentReady||assistant.voiceReviewed||assistant.status==='published';
}
async function chooseEveMode(mode){
  if(eveBusy||mode===selectedEveMode||(mode==='interview'&&!canInterview()))return;
  eveBusy=true;
  syncEveControls();
  try{
    if(session)await endEve();
    selectedEveMode=mode;
    $('eveMessage').value='';
    showEveModeConversation();
    status('voiceStatus','');
  }catch(error){status('voiceStatus',error.message,true)}
  finally{eveBusy=false;syncEveControls()}
}
`;

function setup(source){
  if(source.includes(marker))return source;
  if(!source.includes('Eden owner wall recovery v1'))throw Error('Install owner wall recovery first.');
  source=replace(source,'</style></head>',setupCss+'</style></head>');
  source=replace(source,"Try a private conversation. Ask about a service or request a time as a patient would.",
    "Practice a patient booking or give Eve the details she needs to set up your clinic.");
  source=replace(source,'<div class="eve-transcript" id="eveTranscript" role="log" aria-label="Test conversation">',modeMarkup+'<div class="eve-transcript" id="eveTranscript" role="log" aria-label="Conversation with Eve">');
  source=replace(source,'aria-label="Type a test message"', 'aria-label="Type a message to Eve"');
  source=replace(source,'aria-label="Send test message"', 'aria-label="Send message"');
  source=replace(source,/^#eveInterviewStart\{.*\n/m,'');
  source=replace(source,',#eveInterviewStart svg','');
  source=replace(source,',#eveInterviewStart[aria-pressed=true] .eve-mic','');
  source=replace(source,' The setup interview is available below.','');
  source=replace(source,/  <h4>Set up with Eve<\/h4>[\s\S]*?(?=  <div id="eveDraftReview")/,'');
  source=replace(source,/^let activeStep=1;\nfunction step\(n\).*\nfunction view\(screen\).*\n/m,progressScript);
  source=source.replaceAll('activeStep=3;','activeStep=1;');
  source=source.replaceAll("a.heroStatus==='generating'||(!a.generatedWallAvailable&&a.heroAttempts>=3)","a.heroStatus==='generating'")
    .replaceAll("assistant.heroStatus==='generating'||(!assistant.generatedWallAvailable&&assistant.heroAttempts>=3)","assistant.heroStatus==='generating'")
    .replaceAll("(!assistant.generatedWallAvailable&&assistant.heroAttempts>=3)||assistant.heroStatus==='generating'","assistant.heroStatus==='generating'");
  source=replace(source,"let eveRun=0, eveMode='', eveBusy=false, sendEveText=null;\nconst interviewHistory=[];",
    "let eveRun=0, eveMode='', eveBusy=false, sendEveText=null, selectedEveMode='test';\nconst interviewHistory=[],practiceHistory=[];");
  source=replace(source,/^const canInterview=.*\n\nfunction syncEveControls\(\)\{[\s\S]*?(?=function showEveDraft)/m,modeControls);
  source=replace(source,"  $('eveDraftReview').hidden=false;", "  $('eveDraftReview').hidden=false;\n  $('eveInterview').hidden=false;");
  source=replace(source,/  if\(interviewing&&typeof entry.message==='string'\)\{[\s\S]*?\n  \}/,
    `  if(typeof entry.message==='string'){
    const history=interviewing?interviewHistory:practiceHistory;
    history.push({role:entry.role,message:entry.message.slice(0,750)});
    if(history.length>32)history.shift();
  }`);
  source=replace(source,"  if(!interviewing&&!assistant.agentReady){", "  if(!assistant.agentReady){");
  source=replace(source,"  if(interviewing)for(const entry of interviewHistory)addEveMessage(entry);", "  if(interviewing)for(const entry of interviewHistory)addEveMessage(entry);\n  else practiceHistory.length=0;");
  source=replace(source,"        addEveMessage({role:'agent',message:practice});","        displayEveTurn({role:'agent',message:practice},false);");
  source=replace(source,"if(eveBusy||!message||(!session&&!canInterview()))return;",
    "if(eveBusy||!message||(!session&&(selectedEveMode!=='interview'||!canInterview())))return;");
  source=replace(source,"$('talk').onclick=()=>runEveConversation('test');\n$('eveInterviewStart').onclick=()=>runEveConversation('interview');",
    "$('talk').onclick=()=>runEveConversation(selectedEveMode);\n$('evePracticeMode').onclick=()=>chooseEveMode('test');\n$('eveSetupMode').onclick=()=>chooseEveMode('interview');");
  source=replace(source,"if(target==='talk')$(target).focus({preventScroll:true});",
    "if(target==='talk')void chooseEveMode('test').then(()=>$(target).focus({preventScroll:true}));");
  return source;
}

const changes=[['assistant-core.js',core],['hero-image.js',image],['assistant-setup/index.html',setup]].map(([path,transform])=>{
  const file=join(root,path),before=readFileSync(file);
  return {path,file,before,after:Buffer.from(transform(before.toString('utf8')))};
}).filter(({before,after})=>!before.equals(after));
const asset=readFileSync(join(assetDir,assetName));
if(createHash('sha256').update(asset).digest('hex')!=='ed20f8199cf2faa4fdcb3abedeeb900d9befd48ed72fdd4e45f1cb6b55149cfc')throw Error('Unexpected wall image checksum.');
const assetPath=join('assets',assetName), assetTarget=join(root,assetPath), oldAsset=existsSync(assetTarget)?readFileSync(assetTarget):null;
if(!oldAsset?.equals(asset))changes.push({path:assetPath,file:assetTarget,before:oldAsset,after:asset});
if(check||!changes.length){
  console.log('Owner Eve modes check passed. '+changes.length+' file(s) would change.');
}else{
  const backup=mkdtempSync(join(tmpdir(),'eden-owner-eve-modes-'));
  for(const {file,before,path} of changes){
    const current=existsSync(file)?readFileSync(file):null;
    if(before?!current?.equals(before):current)throw Error('Site changed. Try again.');
    if(before){
      const target=join(backup,path);
      mkdirSync(dirname(target),{recursive:true});
      copyFileSync(file,target);
    }
  }
  const written=[];
  try{
    for(const change of changes){
      const temporary=change.file+'.eden-'+process.pid;
      mkdirSync(dirname(change.file),{recursive:true});
      try{
        writeFileSync(temporary,change.after,{flag:'wx'});
        renameSync(temporary,change.file);
      }finally{rmSync(temporary,{force:true})}
      written.push(change);
    }
  }catch(error){
    for(const {file,path,before} of written.reverse()){
      if(before)copyFileSync(join(backup,path),file);
      else rmSync(file);
    }
    throw error;
  }
  console.log('Owner Eve modes installed. Backup: '+backup);
}
