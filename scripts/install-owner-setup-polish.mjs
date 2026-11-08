import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const marker = 'Eden owner readiness and preview v1';
const args = process.argv.slice(2);
const check = args.includes('--check');
const paths = args.filter(arg => arg !== '--check');
if (paths.length > 1 || paths.some(arg => arg.startsWith('-'))) {
  throw Error('Usage: node install-owner-setup-polish.mjs [site directory] [--check]');
}
const root = paths[0] || join(homedir(), 'Desktop', 'clinicnet-voice-preview');

function replace(source, anchor, replacement) {
  const index = typeof anchor === 'string' ? source.indexOf(anchor) : source.search(anchor);
  if (index < 0) throw Error('Incompatible owner setup near ' + String(anchor).slice(0, 110));
  return source.replace(anchor, replacement);
}

function core(source) {
  if (source.includes(marker)) return source;
  let updated = replace(source, "import {createWallImage,readWallImage} from './hero-image.js';",
    "import {createWallImage,readWallImage,wallTemplatePath} from './hero-image.js';\n/* " + marker + " */");
  updated = replace(updated, "heroUrl:a.hero_key&&a.hero_status==='ready'?'/__eden/hero/'+a.hero_key+'.webp':null",
    "heroUrl:a.hero_key&&a.hero_status==='ready'?(a.hero_key.startsWith('template/')?wallTemplatePath(a.template):'/__eden/hero/'+a.hero_key+'.webp'):null,heroIsTemplate:a.hero_key==='template/'+a.template&&a.hero_status==='ready'");
  updated = replace(updated, "return new Response(clinicHtml(a),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':\"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'\"}});if(!allowPost(request))",
    "return ownerPreview(request,a);if(!allowPost(request))");
  updated = replace(updated, "async function routeOwner(",
    function() { return `function ownerPreview(request,a){
  const selected=new URL(request.url).searchParams.get('template');
  if(selected&&!types.has(selected))return json({error:'Choose an available template.'},400);
  const theme=selected||a.template;
  const draft=theme===a.template&&a.hero_key&&a.hero_status==='ready'?a:{
    ...a,template:theme,variant:'original',hero_key:'template/'+theme,hero_status:'ready'
  };
  return new Response(clinicHtml(draft),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"}});
}
async function routeOwner(`; });
  updated = replace(updated, "if(action==='hero-approve'&&request.method==='POST')", () => `if(action==='hero-template'&&request.method==='POST'){
  if(a.status==='published')return json({error:'The published wall is already set.'},409);
  const path=wallTemplatePath(a.template);
  if(!path||!env.ASSETS||(await env.ASSETS.fetch(new Request(new URL(path,request.url),{method:'HEAD'}))).ok!==true)
    return json({error:'The template photo is unavailable. Contact Eden for help.'},503);
  const stamp=now(),hero='template/'+a.template;
  const saved=await env.PILOT_DB.prepare("UPDATE clinic_assistants SET hero_key=?,hero_status='ready',hero_reviewed_at=NULL,review_approved_at=NULL,updated_at=? WHERE id=? AND status!='published' AND updated_at=? AND (COALESCE(hero_status,'')!='generating' OR updated_at < ?)").bind(hero,stamp,id,a.updated_at,new Date(Date.now()-600000).toISOString()).run();
  if(saved.meta?.changes!==1)return json({error:'The wall changed or is still generating. Refresh and check again.'},409);
  return json(ownerView({...a,hero_key:hero,hero_status:'ready',hero_reviewed_at:null,review_approved_at:null,updated_at:stamp}));
}
if(action==='hero-approve'&&request.method==='POST')`);
  updated = replace(updated, 'publish|hero-generate|hero-approve|details', 'publish|hero-generate|hero-template|hero-approve|details');
  updated = replace(updated, "const photoWall=a.hero_key", "const templateWall=a.hero_key==='template/'+theme&&a.hero_status==='ready';\n const photoWall=templateWall?wallTemplatePath(theme):a.hero_key");
  updated = replace(updated, 'body.has-photo-wall .sign-wall{display:none!important}', 'body.has-photo-wall:not(.has-template-wall) .sign-wall{display:none!important}');
  updated = replace(updated, "${photoWall?'has-photo-wall':''}", () => "${photoWall?'has-photo-wall':''} ${templateWall?'has-template-wall':''}");
  updated = replace(updated, "  let j;try{j=await r.json()}catch{j={}};\n  if(!r.ok||j.success!==true||!(j.result?.queued?.includes(to)||j.result?.delivered?.includes(to))){\n    console.error('Clinic email rejected',r.status,j.errors?.[0]?.code||'unknown',j.errors?.[0]?.message||'no detail');\n    throw Error('Email delivery was not accepted. Check the address and sending plan.');\n  }", () => `  let j;try{j=await r.json()}catch{j={}};
  const delivered=j.result?.delivered?.includes(to);
  const queued=j.result?.queued?.includes(to);
  if(r.ok&&j.success===true&&(delivered||queued))return delivered?'delivered':'queued';
  const issue=j.result?.suppressed?.includes(to)?'suppressed':
    j.result?.permanent_bounces?.includes(to)?'permanent-bounce':'not-accepted';
  console.error('Clinic email rejected',r.status,j.errors?.[0]?.code||'unknown',issue);
  throw Error(issue==='suppressed'?'Email delivery was suppressed for this address. Contact Eden or use another inbox.':
    issue==='permanent-bounce'?'The email bounced. Check the address or use another inbox.':
    'Email delivery was not accepted. Check the address and sending plan.');`);
  updated = replace(updated, /  const code=sixDigitCode\(\);[\s\S]*?  return json\(\{ok:true,message:'Test email sent\. Enter the six-digit code from your inbox\.'\}\);/, () => String.raw`  const code=sixDigitCode(),stamp=now();
  const hash=await sha(id+':'+code+':'+env.PILOT_RATE_SALT);
  const saved=await env.PILOT_DB.prepare('UPDATE clinic_assistants SET alert_email=?,email_code_hash=?,email_code_expires_at=?,alert_confirmed_at=NULL,updated_at=? WHERE id=? AND updated_at=?')
    .bind(email,hash,new Date(Date.now()+600000).toISOString(),stamp,id,a.updated_at).run();
  if(saved.meta?.changes!==1)return json({error:'The setup changed while sending. Refresh and try again.'},409);
  try{
    const delivery=await sendEmail(env,email,'Eden test alert for '+a.clinic,'This is a test alert for '+a.clinic+'. No patient request was created.\n\nConfirmation code: '+code+'\n\nEnter this code on your Eden setup page within 10 minutes to confirm this inbox receives alerts.');
    return json({ok:true,message:delivery==='delivered'?
      'The email service reports delivery. Enter the six-digit code from your inbox.':
      'The email service queued the test. Enter the six-digit code when it arrives.'});
  }catch(error){
    await env.PILOT_DB.prepare('UPDATE clinic_assistants SET alert_email=?,email_code_hash=?,email_code_expires_at=?,alert_confirmed_at=?,updated_at=? WHERE id=? AND email_code_hash=?')
      .bind(a.alert_email??null,a.email_code_hash??null,a.email_code_expires_at??null,a.alert_confirmed_at??null,now(),id,hash).run();
    return json({error:error.message.startsWith('Email delivery')||error.message.startsWith('The email bounced')||error.message==='Clinic email alerts are not configured.'?
      error.message:'Could not send the test email. Try again or contact Eden.'},503);
  }`);
  updated = replace(updated, "if(!a.agent_id||!a.voice_test_at||!a.alert_confirmed_at)return json({error:'Test the voice and confirm the email alert first.'},409);",
    "if(!a.agent_id||!a.voice_test_at||!a.alert_confirmed_at)return json({error:'Complete the voice test and verify the inbox first.'},409);");
  updated = replace(updated, "await env.PILOT_DB.prepare('UPDATE clinic_assistants SET alert_confirmed_at=?,email_code_hash=NULL,email_code_expires_at=NULL,updated_at=? WHERE id=?').bind(now(),now(),id).run();",
    "const confirmed=await env.PILOT_DB.prepare('UPDATE clinic_assistants SET alert_confirmed_at=?,email_code_hash=NULL,email_code_expires_at=NULL,updated_at=? WHERE id=? AND email_code_hash=? AND alert_email=?').bind(now(),now(),id,a.email_code_hash,a.alert_email).run();\n  if(confirmed.meta?.changes!==1)return json({error:'The email test changed. Enter the code from the latest message.'},409);");
  updated = replace(updated, "if(!a.hero_key||!a.hero_reviewed_at)return json({error:'Generate and check your clinic name on the wall before approving.'},409);",
    "if(!a.hero_key||!a.hero_reviewed_at||a.hero_status!=='ready'||(a.variant||'original')!=='original')return json({error:'Select the photographic layout and approve the wall before approving the page.'},409);");
  updated = replace(updated, "!a.review_approved_at||!a.hero_key||!a.hero_reviewed_at", "!a.review_approved_at||!a.hero_key||!a.hero_reviewed_at||a.hero_status!=='ready'||(a.variant||'original')!=='original'");
  return updated;
}

function hero(source) {
  if (source.includes(marker)) return source;
  return replace(source, 'function decode64(', '/* ' + marker + ' */\nexport function wallTemplatePath(theme){return Object.hasOwn(themes,theme)?"/assets/"+themes[theme].file:null}\nfunction decode64(');
}

function setup(source) {
  if (source.includes(marker)) return source;
  let updated = replace(source, '</style>', () => `
/* ${marker} */
.owner-style-preview{max-width:430px;margin:18px auto}
.owner-style-preview iframe{display:block;width:100%;height:560px;border:8px solid #21352f;border-radius:28px;background:white}
#talkStep{background:#edf5ed;border-color:#b4cbbb}
#approvalBlockers a{font-weight:650;color:var(--forest);text-underline-offset:3px}
#approvalBlockers li+li{margin-top:4px}
@media(max-width:520px){.owner-style-preview iframe{height:480px}}
</style>`);
  updated = replace(updated, /(<p id="manageIntro" class="intro"><\/p>)([\s\S]*?)(<div class="card" id="talkStep">[\s\S]*?<\/div><p id="voiceUpgradeStatus"[^>]*><\/p><p id="voiceStatus"[^>]*><\/p><\/div>)/,
    (_match,intro,before,talk)=>intro+talk+before);
  updated = replace(updated, '<h3>1 · Talk to your assistant</h3>', '<h3>Talk to your assistant</h3>');
  updated = replace(updated, 'This style includes a voice. Set it up once, then tap Talk and allow microphone access. Ask about a service and a preferred time. This is a private test; your team still confirms appointment availability.',
    'Start a private voice test and allow microphone access. Ask about a service and try requesting a time. Your team still confirms appointment availability.');
  updated = replace(updated, '<button class="btn" id="voiceCreate">Set up voice</button><button class="btn light" id="talk" disabled>Talk to your assistant</button>',
    '<button class="btn" id="talk" type="button">Start voice test</button>');
  updated = replace(updated, /\$\('voiceCreate'\)\.disabled=a\.agentReady;\$\('voiceCreate'\)\.textContent=a\.agentReady\?'Voice ready':'Set up voice';/, '');
  updated = replace(updated, "$('talk').disabled=!a.agentReady;", '');
  updated = replace(updated, /^\$\('voiceCreate'\)\.onclick=.*\n/m, '');
  updated = replace(updated, "$('talk').textContent='Talk to your assistant'", "$('talk').textContent='Start voice test'");
  updated = replace(updated, "$('talk').textContent='Talk to your assistant'", "$('talk').textContent='Start voice test'");
  updated = replace(updated, "status('voiceStatus','Connecting…');try{const r=await api(", () =>
    "status('voiceStatus',assistant.agentReady?'Connecting…':'Preparing your voice assistant…');try{if(!assistant.agentReady){assistant=await api('/api/assistants/'+id+'/voice',{method:'POST',body:'{}'});renderManage();status('voiceStatus','Connecting…')}const r=await api(");
  updated = replace(updated, 'document.getElementById(\'voiceCreate\').closest(\'.card\')', "document.getElementById('talk').closest('.card')");
  updated = replace(updated, '<div id="manageTemplates" class="templates"></div>',
    '<div id="manageTemplates" class="templates"></div><div class="owner-style-preview"><iframe id="manageStylePreview" title="Selected clinic style with your saved name" sandbox="allow-same-origin" hidden></iframe></div>');
  updated = replace(updated, "function renderManageTemplates(){", () => `let stylePreviewToken=0;
async function renderStylePreview(theme){
  const frame=$('manageStylePreview');
  const signature=JSON.stringify([theme,assistant.template,assistant.clinic,assistant.heroUrl,assistant.variant,assistant.hours,assistant.services,assistant.featuredService,assistant.bookingMode,assistant.phone,assistant.mapsUrl]);
  if(frame.dataset.requested===signature)return;
  frame.dataset.requested=signature;
  const token=++stylePreviewToken;
  try{
    const html=await previewHtml(theme);
    if(token!==stylePreviewToken)return;
    frame.srcdoc=html;
    frame.hidden=false;
  }catch{
    if(token!==stylePreviewToken)return;
    delete frame.dataset.requested;
    frame.hidden=true;
    status('manageChooseStatus','The larger preview could not load. Select the style again to retry.',true);
  }
}
function renderManageTemplates(){`);
  updated = replace(updated, "b.setAttribute('aria-pressed',selected)})}", "b.setAttribute('aria-pressed',selected)});renderStylePreview(current)}");
  updated = replace(updated, "async function previewHtml(){const r=await fetch('/api/assistants/'+id+'/preview',",
    "async function previewHtml(theme){const r=await fetch('/api/assistants/'+id+'/preview'+(theme?'?template='+encodeURIComponent(theme):''),");
  updated = replace(updated, '<button class="btn light" type="button" id="generateWall">Generate wall scene</button>',
    '<div class="actions"><button class="btn light" type="button" id="generateWall">Generate wall scene</button><button class="btn light" type="button" id="useTemplateWall">Use template wall</button></div>');
  updated = replace(updated, "$('generateWall').textContent=a.heroReady?'Regenerate wall scene':'Generate wall scene';", () =>
    "$('generateWall').textContent=a.heroReady&&!a.heroIsTemplate?'Regenerate wall scene':'Generate wall scene';$('useTemplateWall').hidden=a.status==='published'||a.heroReady;$('useTemplateWall').disabled=a.heroStatus==='generating';");
  updated = replace(updated, "'Review the generated image and confirm the exact name.'", "'Review the wall and confirm the exact name.'");
  updated = replace(updated, "'Generation failed. Try again.'", "'Generation failed. You can use the template wall or try again.'");
  updated = replace(updated, "status('wallStatus',e.message,true);b.disabled=false}};", "status('wallStatus',e.message+' You can use the template wall.',true);b.disabled=false}};");
  updated = replace(updated, "$('approveWall').onclick=", () => `$('useTemplateWall').onclick=async()=>{
  const button=$('useTemplateWall');button.disabled=true;$('generateWall').disabled=true;
  try{
    assistant=await api('/api/assistants/'+id+'/hero-template',{method:'POST',body:'{}'});
    $('wallNameCorrect').checked=false;
    renderManage();
    await loadMobilePreview();
    status('wallStatus','Template wall selected. Check your clinic name and approve the wall below.');
  }catch(error){status('wallStatus',error.message,true)}
  finally{button.disabled=false;$('generateWall').disabled=assistant.heroAttempts>=3||assistant.heroStatus==='generating'}
};
$('approveWall').onclick=`);
  updated = replace(updated, '<button type="button" class="btn" id="approvePage" disabled>',
    '<ul id="approvalBlockers" aria-label="Review steps still needed" hidden></ul><button type="button" class="btn" id="approvePage" disabled>');
  updated = replace(updated, '<b id="testCheck" class="no">○ Test alert confirmed</b>', '<b id="testCheck" class="no">○ Wall approved</b>');
  updated = replace(updated, "$('testCheck').textContent=(a.testConfirmed?'✓':'○')+' Test alert confirmed';$('testCheck').className=a.testConfirmed?'yes':'no';",
    "$('testCheck').textContent=(a.heroApproved?'✓':'○')+' Wall approved';$('testCheck').className=a.heroApproved?'yes':'no';");
  updated = replace(updated, "||!a.reviewApproved||a.status==='published';", "||!a.heroApproved||!a.reviewApproved||a.status==='published';renderApproval();");
  updated = replace(updated, "$('approveCheck').checked=false;$('approvePage').disabled=true;status('previewStatus'", "$('approveCheck').checked=assistant.reviewApproved;renderApproval();status('previewStatus'");
  updated = replace(updated, "$('pagePreview').hidden=true;status('previewStatus',err.message,true)", "$('pagePreview').hidden=true;renderApproval();status('previewStatus',err.message,true)");
  updated = replace(updated, "$('pagePreview').hidden=true;$('wallPreview').dataset.hero='';", "$('pagePreview').hidden=true;$('approveCheck').checked=false;renderApproval();$('wallPreview').dataset.hero='';");
  updated = replace(updated, "$('approveCheck').onchange=()=>{$('approvePage').disabled=!$('approveCheck').checked||$('pagePreview').hidden};", () => `function renderApproval(){
  const a=assistant;
  const missing=[
    [!a.voiceReviewed,'Run the voice test','talkStep'],
    [!a.testConfirmed,'Verify the inbox with the email code','alertStep'],
    [!a.heroApproved,'Check and approve the wall scene','wallSceneCard'],
    [a.variant!=='original','Select the photographic page','loadPreview'],
    [$('pagePreview').hidden,'Load the mobile preview','loadPreview']
  ].filter(([needed])=>needed);
  const list=$('approvalBlockers');
  list.replaceChildren(...missing.map(([,label,target])=>{
    const item=document.createElement('li'),link=document.createElement('a');
    link.textContent=label;link.href='#'+target;
    link.onclick=event=>{event.preventDefault();$(target).scrollIntoView({block:'start',behavior:'smooth'});};
    item.append(link);return item;
  }));
  list.hidden=a.reviewApproved||missing.length===0;
  if(a.reviewApproved)$('approveCheck').checked=true;
  $('approvePage').disabled=a.reviewApproved||!$('approveCheck').checked||missing.length>0;
  $('approvePage').textContent=a.reviewApproved?'Page approved':'Approve page for publication';
}
$('approveCheck').onchange=renderApproval;`);
  return updated;
}

const targets = [
  ['assistant-core.js', core],
  ['hero-image.js', hero],
  ['assistant-setup/index.html', setup]
];
const changes = targets.map(([path, transform]) => {
  const file = join(root, path);
  const before = readFileSync(file, 'utf8');
  return { path, file, before, after: transform(before) };
}).filter(change => change.before !== change.after);
if (check || !changes.length) {
  console.log('Owner setup check passed. ' + changes.length + ' file(s) would change.');
} else {
  const backup = mkdtempSync(join(tmpdir(), 'eden-owner-setup-'));
  for (const change of changes) {
    if (readFileSync(change.file, 'utf8') !== change.before) throw Error('Site changed. Try again.');
    const destination = join(backup, change.path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(change.file, destination);
  }
  const written = [];
  try {
    for (const change of changes) {
      const temporary = change.file + '.eden-' + process.pid;
      writeFileSync(temporary, change.after, { flag: 'wx' });
      renameSync(temporary, change.file);
      written.push(change);
    }
  } catch (error) {
    for (const change of written.reverse()) copyFileSync(join(backup, change.path), change.file);
    throw error;
  }
  console.log('Owner setup updated. Backup: ' + backup);
}
