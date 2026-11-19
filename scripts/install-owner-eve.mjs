import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const marker = 'Eden Eve owner onboarding v1';
const args = process.argv.slice(2);
const check = args.includes('--check');
const paths = args.filter(arg => arg !== '--check');
if (paths.length > 2 || paths.some(arg => arg.startsWith('-'))) {
  throw Error('Usage: node install-owner-eve.mjs [site directory] [asset directory] [--check]');
}
const root = paths[0] || join(homedir(), 'Desktop', 'clinicnet-voice-preview');
const assetDir = paths[1] || fileURLToPath(new URL('../assets/', import.meta.url));
const assets = {
  'eden-owner-eve.webp': '62ae200516b29024d9962ef74ba323edae9b345e7d3c4b893b588ee063c89a66',
  'eden-cebu-dent-pilot-wall.webp': 'aa66fe5a3d4fe7d99e30e3e861fec00f2bb73aca0e3b8ad5503c00811cffd5bc'
};

function edit(source, anchor, replacement) {
  if (typeof anchor === 'string' ? !source.includes(anchor) : !anchor.test(source)) {
    throw Error('Incompatible owner setup near ' + String(anchor).slice(0, 100));
  }
  return source.replace(anchor, () => replacement);
}
function line(source, anchor, transform) {
  const old = source.split('\n').find(row => row.startsWith(anchor));
  if (!old) throw Error('Incompatible owner setup near ' + anchor);
  return edit(source, old, transform(old));
}

function core(source) {
  if (source.includes(marker)) return source;
  const ownerViewAnchor = "heroUrl:a.hero_key&&a.hero_status==='ready'?(a.hero_key.startsWith('template/')?";
  source = edit(source, 'function ownerPreview(request,a){', `/* ${marker} */
const cebuWallKey='pilot/cebu-dent-test';
const cebuWallAsset='/assets/eden-cebu-dent-pilot-wall.webp';
function canUseCebuWall(a){
  return a.id==='0fc86bd9-b703-49b2-be0c-d64c2b19cd91'&&a.template==='pearl'&&a.clinic==='Cebu Dent Clinic (Test)';
}
function hasCebuWall(a){
  return canUseCebuWall(a)&&a.hero_key===cebuWallKey&&a.hero_status==='ready';
}
function ownerPreview(request,a){`);
  source = edit(source, ownerViewAnchor,
    "generatedWallAvailable:canUseCebuWall(a),heroIsPilot:hasCebuWall(a),heroUrl:a.hero_key&&a.hero_status==='ready'?(hasCebuWall(a)?cebuWallAsset:a.hero_key.startsWith('template/')?");
  source = edit(source, "hero_key:'template/'+theme,hero_status:'ready'\n  };",
    "hero_key:theme===a.template&&canUseCebuWall(a)?cebuWallKey:'template/'+theme,hero_status:'ready'\n  };");
  source = edit(source, '  if(!env.OPENAI_IMAGE_API_KEY||!env.EDEN_HERO_IMAGES)', `  if(canUseCebuWall(a)){
    const asset=await env.ASSETS?.fetch(new Request(new URL(cebuWallAsset,request.url),{method:'HEAD'}));
    if(!asset?.ok)return json({error:'The generated Cebu wall is unavailable.'},503);
    if(hasCebuWall(a))return json(ownerView(a));
    const stamp=now();
    const saved=await env.PILOT_DB.prepare("UPDATE clinic_assistants SET hero_key=?,hero_status='ready',hero_reviewed_at=NULL,review_approved_at=NULL,updated_at=? WHERE id=? AND status!='published' AND updated_at=?")
      .bind(cebuWallKey,stamp,id,a.updated_at).run();
    if(saved.meta?.changes!==1)return json({error:'The wall changed. Refresh and check again.'},409);
    return json(ownerView({...a,hero_key:cebuWallKey,hero_status:'ready',hero_reviewed_at:null,review_approved_at:null,updated_at:stamp}));
  }
  if(!env.OPENAI_IMAGE_API_KEY||!env.EDEN_HERO_IMAGES)`);
  source = edit(source, ' const photoWall=templateWall?', ' const pilotWall=hasCebuWall(a);\n const photoWall=pilotWall?cebuWallAsset:templateWall?');
  source = edit(source, "${templateWall?'has-template-wall':''}", "${templateWall?'has-template-wall':''} ${pilotWall?'has-cebu-pilot-wall':''}");
  source = edit(source, ' const shortFeatured=featured&&featured.length<=24?featured:null;\n', '');
  source = edit(source, '${shortFeatured?`<p class="sign-feature">${h(shortFeatured)}</p>`', '${featured?`<p class="sign-feature">${h(featured)}</p>`');
  source = edit(source, 'font-weight:700;color:#6e4a2e}', 'font-weight:700;color:#6e4a2e;overflow-wrap:anywhere}');
  return edit(source, '/* Eden wall priority v10 */', `body.theme-pearl.variant-original.has-cebu-pilot-wall .sign-plate.left{left:19.4%;top:52%;width:10.6%;height:20%}
body.theme-pearl.variant-original.has-cebu-pilot-wall .sign-plate.center{left:52%;top:66.3%;width:10.8%;height:8%}
body.theme-pearl.variant-original.has-cebu-pilot-wall .sign-plate.right{left:77.4%;top:55%;width:11.7%;height:23.6%}
/* Eden wall priority v10 */`);
}

const setupCss = `
/* ${marker} */
#talkStep{background:#edf5ed;border-color:#b4cbbb}
.eve-demo{display:grid;grid-template-columns:1fr 1fr;gap:0;background:#f9f5eb;border:1px solid #d9d8c7;border-radius:26px;overflow:hidden;max-width:820px;margin:20px auto 4px}
.eve-photo{position:relative;min-height:330px}
.eve-image{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover;object-position:50% 39%}
.eve-chat{display:flex;flex-direction:column;min-width:0;padding:20px;min-height:330px}
.eve-chat-head{display:flex;align-items:center;gap:10px;padding:0 0 12px;border-bottom:1px solid #dadcd0}
.eve-chat-head span{display:block;color:#466257;font-size:.85rem}
.eve-online{width:11px;height:11px;background:#218466;border-radius:50%;flex:none}
.eve-transcript{flex:1;overflow:auto;max-height:210px;min-height:94px;display:flex;flex-direction:column;gap:8px;padding:12px 2px}
.eve-transcript p{margin:0;background:#fff;border-radius:14px 14px 14px 4px;padding:9px 12px;max-width:92%;color:#25403a;align-self:flex-start;overflow-wrap:anywhere}
.eve-transcript .eve-owner{background:#dceadf;align-self:flex-end;border-radius:14px 14px 4px 14px}
.eve-talk-row{text-align:center;margin:8px 0 12px;color:#173b32;font-weight:700}
.eve-talk-row button{display:inline-grid;justify-items:center;gap:6px;padding:0;border:0;border-radius:8px;background:none;color:inherit;font:inherit;cursor:pointer}
.eve-mic{display:grid;place-items:center;width:56px;height:56px;border-radius:50%;background:#174b3e;color:#fff;box-shadow:0 5px 12px #123f3c35}
.eve-talk-row button:disabled{opacity:.6;cursor:wait}
.eve-talk-row button[aria-pressed=true] .eve-mic{background:#9d382c}
.eve-talk-row svg{width:23px;height:23px}
.eve-composer{display:flex;align-items:center;gap:8px}
.eve-composer input{min-width:0;flex:1;border-radius:100px;border:1px solid #b8cabc;background:white;padding:10px 13px;font:inherit}
.eve-composer button{border:0;border-radius:50%;background:#174b3e;color:#fff;width:38px;height:38px;font:inherit;cursor:pointer;flex:none}
.eve-composer button:disabled{opacity:.45;cursor:default}
#talkStep .status:empty{display:none}
#voiceStatus:not(:empty){margin:10px 0 0;text-align:center}
.owner-channel summary{font:600 clamp(1.25rem,2.1vw,1.65rem)/1.2 Georgia,serif;cursor:pointer;color:var(--forest)}
.owner-channel summary small{font:500 .8em system-ui;color:#4e6057}
.owner-channel[open] summary{margin-bottom:12px}
.owner-page-frame{width:min(100%,400px);height:min(740px,78vh);margin:18px auto 28px}
#pagePreview{display:block;width:100%;max-width:none;height:100%;border:0;border-radius:0;margin:0;box-shadow:none}
#reviewPreviewActions[hidden]{display:none}
#wallApproval,#finalOwnerReview{scroll-margin-top:78px}
.publish-review-link{font-weight:700;color:inherit;text-underline-offset:3px}
@media(max-width:650px){.eve-demo{grid-template-columns:1fr}.eve-photo{min-height:220px}.eve-image{object-position:50% 35%}.eve-chat{min-height:0;padding:14px}.eve-transcript{max-height:155px}.eve-talk-row{margin:4px 0 9px}}
`;

const talkCard = `<div class="card" id="talkStep">
<h3>Talk to your assistant</h3>
<p>Try a private conversation. Ask about a service or request a time as a patient would.</p>
<div class="eve-demo">
  <div class="eve-photo"><img class="eve-image" src="/assets/eden-owner-eve.webp" alt="Eve, Eden’s AI receptionist, at a dental reception desk" width="941" height="1672"></div>
  <div class="eve-chat">
    <div class="eve-chat-head"><i class="eve-online" aria-hidden="true"></i><div><strong>Talk with Eve</strong><span>Private receptionist test</span></div></div>
    <div class="eve-transcript" id="eveTranscript" role="log" aria-label="Test conversation">
      <p>Hi, I’m Eve. Try asking me about opening hours or an appointment.</p>
    </div>
    <div class="eve-talk-row">
      <button id="talk" type="button" aria-labelledby="eveTalkLabel" aria-pressed="false">
        <span class="eve-mic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-3 0h6"/></svg></span>
        <span id="eveTalkLabel">Start voice test</span>
      </button>
    </div>
    <form class="eve-composer" id="eveComposer">
      <input id="eveMessage" aria-label="Type a test message" placeholder="Type during the test…" maxlength="500" disabled>
      <button id="eveSend" type="submit" aria-label="Send test message" disabled>➜</button>
    </form>
  </div>
</div>
<p id="voiceStatus" class="status" role="status"></p>
<button class="btn light" id="voiceUpgrade" hidden style="display:none" aria-hidden="true">Enable or improve voice requests</button>
<p id="voiceUpgradeStatus" class="status" role="status"></p>
</div>`;

const talkScript = `function setEveConversation(active){
  $('eveTalkLabel').textContent=active?'End voice test':'Start voice test';
  $('talk').setAttribute('aria-pressed',String(active));
  $('eveMessage').disabled=$('eveSend').disabled=!active;
}
function addEveMessage({source,role,message}){
  if(typeof message!=='string'||!message.trim())return;
  const log=$('eveTranscript'), bubble=document.createElement('p');
  if((role||source)==='user')bubble.className='eve-owner';
  bubble.textContent=message;
  log.append(bubble);
  log.scrollTop=log.scrollHeight;
}
$('eveComposer').onsubmit=event=>{
  event.preventDefault();
  const input=$('eveMessage'), message=input.value.trim();
  if(!session||!message)return;
  try{
    session.sendUserMessage(message);
    input.value='';
  }catch{
    status('voiceStatus','Could not send that message. Try again.',true);
  }
};
let eveRun=0;
$('talk').onclick=async()=>{
  const button=$('talk');
  button.disabled=true;
  try{
    if(session){
      await session.endSession();
      session=null;
      setEveConversation(false);
      status('voiceStatus','Voice test ended.');
      return;
    }
    const run=++eveRun;
    status('voiceStatus',assistant.agentReady?'Connecting…':'Preparing your voice assistant…');
    if(!assistant.agentReady){
      assistant=await api('/api/assistants/'+id+'/voice',{method:'POST',body:'{}'});
      renderManage();
      status('voiceStatus','Connecting…');
    }
    const result=await api('/api/assistants/'+id+'/signed-url',{method:'POST',body:'{}'});
    const {Conversation}=await import('https://esm.sh/@elevenlabs/client?bundle');
    $('eveTranscript').replaceChildren();
    const connection=await Conversation.startSession({
      signedUrl:result.signedUrl,
      connectionType:'websocket',
      onMessage:message=>{if(run===eveRun)addEveMessage(message)},
      onDisconnect:()=>{
        if(run!==eveRun)return;
        eveRun++;
        session=null;
        setEveConversation(false);
        status('voiceStatus','Voice test ended.');
      }
    });
    if(run!==eveRun)return;
    session=connection;
    setEveConversation(true);
    status('voiceStatus','Listening…');
    await api('/api/assistants/'+id+'/voice-reviewed',{method:'POST',body:'{}'});
    await reload();
  }catch(error){
    status('voiceStatus',error.message,true);
  }finally{
    button.disabled=false;
  }
};`;

const mobilePreview = `let pagePreviewKey='', pagePreviewRun=0;
async function loadMobilePreview(force=false){
  const a=assistant;
  const next=JSON.stringify([a.clinic,a.city,a.hours,a.services,a.featuredService,a.template,a.bookingMode,a.language,a.phone,a.mapsUrl,a.heroUrl,a.variant]);
  if(!force&&next===pagePreviewKey)return;
  pagePreviewKey=next;
  const run=++pagePreviewRun;
  $('pagePreviewFrame').hidden=true;
  $('reviewPreviewActions').hidden=true;
  $('approveCheck').checked=Boolean(a.reviewApproved);
  renderApproval();
  status('previewStatus','Loading your page preview…');
  try{
    const html=await previewHtml();
    if(run!==pagePreviewRun)return;
    $('pagePreview').srcdoc=html;
    $('pagePreviewFrame').hidden=false;
    renderApproval();
    status('previewStatus','');
  }catch(error){
    if(run!==pagePreviewRun)return;
    pagePreviewKey='';
    $('reviewPreviewActions').hidden=false;
    renderApproval();
    status('previewStatus',error.message,true);
  }
}`;

function setup(source) {
  if (source.includes(marker)) return source;
  source = edit(source, '/* Eden owner readiness and preview v1 */', '/* Eden owner readiness and preview v1 */'+setupCss);
  source = edit(source, /<div class="card" id="talkStep">[\s\S]*?<\/div>(?=<!-- Eden visual)/, talkCard);
  source = edit(source, 'Generate your photographic wall scene after saving the clinic details. The desk signs below are exact live text from those details. Check the wall spelling and the complete page before approval.',
    'Save your clinic details, then generate the wall scene. Check the clinic name and the desk signs below.');
  source = edit(source, '<label class="check" id="wallConfirmRow" hidden>',
    '<h4 id="wallApproval" hidden>Approve your wall</h4><label class="check" id="wallConfirmRow" hidden>');
  source = edit(source, 'Enter the inbox your clinic team checks. We’ll email a test alert and a six-digit code so you can confirm it arrived.',
    'Enter the email inbox your clinic team checks for new bookings.');
  source = edit(source, 'Add your official phone and Google Maps link for the Call and Find us actions. If either is blank, that action leads to the request form or clinic information instead.',
    'Add your official phone and Google Maps link.');
  source = edit(source, 'Review the photographic reception scene with your approved wall name and live clinic details. The mobile preview shows the page your patients will see.',
    'This preview shows the page your patients will see.');
  source = edit(source, '<div class="variation-list" role="group" aria-label="Page design">',
    '<div class="variation-list" id="legacyLayout" role="group" aria-label="Page design" hidden style="display:none">');
  source = edit(source, '>Use photographic page</button>', '>Use current page layout</button>');
  source = edit(source, /<div class="actions"><button type="button" id="loadPreview"[\s\S]*?<h3>Final owner review<\/h3>/,
    `<p id="previewStatus" class="status" role="status"></p>
<div class="actions" id="reviewPreviewActions" hidden><button type="button" id="loadPreview" class="btn light">Retry preview</button></div>
<div class="wall-frame owner-page-frame" id="pagePreviewFrame" hidden>
  <iframe id="pagePreview" title="Mobile clinic page preview" sandbox="allow-same-origin"></iframe>
</div>
<h3 id="finalOwnerReview">Final owner review</h3>`);
  source = edit(source, 'I reviewed the full page, mobile preview, and voice greeting.', 'I reviewed the page preview and voice greeting.');
  source = edit(source, '<b id="pageCheck" class="no">○ Page approved</b>',
    '<a id="pageCheck" class="no publish-review-link" href="#finalOwnerReview">○ Approve page</a>');
  source = edit(source, '<b id="testCheck" class="no">○ Wall approved</b>',
    '<a id="testCheck" class="no publish-review-link" href="#wallSceneCard">○ Approve wall</a>');
  source = edit(source, 'After testing the voice, confirming the inbox, and approving the mobile preview, publish your Eden-hosted page.',
    'Complete the checks above to publish your clinic page.');
  source = line(source, 'function renderManage(){', old => {
    let row = edit(old, "$('generateWall').disabled=a.heroStatus==='generating'||a.heroAttempts>=3;",
      "$('generateWall').hidden=a.status==='published'||a.heroIsPilot;\$('generateWall').disabled=a.heroStatus==='generating'||(!a.generatedWallAvailable&&a.heroAttempts>=3);");
    row = edit(row, "'Regenerate wall scene':'Generate wall scene';", "'Regenerate wall scene':'Generate wall scene';if(a.generatedWallAvailable)$('generateWall').textContent='Use generated Cebu wall';");
    row = edit(row, "a.heroStatus==='failed'?'Generation failed.", "a.generatedWallAvailable?'Your generated Cebu wall is ready to review.':a.heroStatus==='failed'?'Generation failed.");
    row = edit(row, "$('approveWall').hidden=!a.heroReady||a.heroApproved;",
      "$('approveWall').hidden=!a.heroReady||a.heroApproved;$('wallApproval').hidden=$('approveWall').hidden;");
    row = edit(row, "+' Wall approved';$('testCheck').className=a.heroApproved?'yes':'no';",
      "+(a.heroApproved?' Wall approved':' Approve wall');$('testCheck').classList.toggle('yes',a.heroApproved);$('testCheck').classList.toggle('no',!a.heroApproved);");
    row = edit(row, "+' Page approved';$('pageCheck').className=a.reviewApproved?'yes':'no';",
      "+(a.reviewApproved?' Page approved':' Approve page');$('pageCheck').classList.toggle('yes',a.reviewApproved);$('pageCheck').classList.toggle('no',!a.reviewApproved);");
    row = edit(row, "$('variantStatus').textContent=a.variant&&a.variant!=='original'?'This assistant uses an earlier page setting. Select Use photographic page to review the current design.':'';",
      "const legacy=a.variant&&a.variant!=='original'&&a.status!=='published';$('legacyLayout').hidden=!legacy;$('legacyLayout').style.display=legacy?'':'none';$('variantStatus').textContent=legacy?'Switch to the current layout to approve this page.':'';");
    return row.slice(0,-1)+'\n  void loadMobilePreview();\n}';
  });
  source = line(source, "$('talk').onclick=", () => talkScript);
  source = line(source, 'async function loadMobilePreview()', () => mobilePreview);
  source = edit(source, /\$\('loadPreview'\)\.onclick=loadMobilePreview;[\s\S]*?(?=function renderApproval\()/,
    `$('loadPreview').onclick=()=>loadMobilePreview(true);
for(const [link,target] of [['testCheck','wallSceneCard'],['pageCheck','finalOwnerReview']]){
  $(link).onclick=event=>{
    event.preventDefault();
    const section=link==='testCheck'&&!$('wallApproval').hidden?'wallApproval':target;
    $(section).scrollIntoView({block:'start',behavior:'smooth'});
  };
}
`);
  source = edit(source, "[a.variant!=='original','Select the photographic page','loadPreview'],",
    "[a.variant!=='original','Use the current page layout','pageReview'],");
  source = edit(source, "[$('pagePreview').hidden,'Load the mobile preview','loadPreview']",
    "[$('pagePreviewFrame').hidden,'Review the page preview','pageReview']");
  source = edit(source, "const r=await api(`/api/assistants/${id}/test-email`", "await api(`/api/assistants/${id}/test-email`");
  source = edit(source, "status('alertStatus',r.message)", "status('alertStatus','Check your clinic email to enter the six-digit code.')");
  source = edit(source, 'assistant.phone=r.phone;assistant.mapsUrl=r.mapsUrl;', 'await reload();');
  source = edit(source, "const r=await api('/api/assistants/'+id+'/contact'", "await api('/api/assistants/'+id+'/contact'");
  source = edit(source, "populateDetails();$('pagePreview').hidden=true;$('approveCheck').checked=false;renderApproval();$('wallPreview').dataset.hero='';if(assistant.heroReady)await loadWallPreview();",
    "populateDetails();if(assistant.heroReady)await loadWallPreview();");
  source = edit(source, "finally{button.disabled=false;$('generateWall').disabled=assistant.heroAttempts>=3||assistant.heroStatus==='generating'}",
    "finally{button.disabled=false;$('generateWall').disabled=(!assistant.generatedWallAvailable&&assistant.heroAttempts>=3)||assistant.heroStatus==='generating'}");
  source = edit(source, "a.status==='published'||a.heroReady;$('useTemplateWall')", "a.status==='published'||a.heroReady||a.generatedWallAvailable;$('useTemplateWall')");
  source = edit(source, /  const manage = document.getElementById\('screen-manage'\);[\s\S]*?(?=  card.querySelector\('button'\))/,
    `  const card = document.createElement('details');
  card.className = 'card owner-channel';
  card.innerHTML = '<summary>Facebook Messenger <small>(optional)</small></summary>' +
    '<p>Use your saved clinic details for replies on Facebook. Clinic Workspace opens in a new tab to connect your Page and send a private test.</p>' +
    '<button type="button" class="btn light">Set up Messenger</button>' +
    '<p class="status" role="status"></p>';
  $('wallSceneCard').after(card);
  const phone = document.createElement('details');
  phone.className = 'card owner-channel';
  phone.innerHTML = '<summary>Missed calls <small>(optional)</small></summary>' +
    '<p>Set up your AI phone receptionist to help callers when your team can’t answer. Open Clinic Workspace, select your location, and choose AI phone to request setup.</p>' +
    '<a class="btn light" href="https://clinicnet.live/clinic/" target="_blank" rel="noopener noreferrer">Open Clinic Workspace</a>';
  card.after(phone);

`);
  return source;
}

const changes = [];
for (const [path, transform] of [['assistant-core.js', core], ['assistant-setup/index.html', setup]]) {
  const file = join(root, path);
  const before = readFileSync(file);
  const after = Buffer.from(transform(before.toString('utf8')));
  if (!before.equals(after)) changes.push({path, file, before, after});
}
for (const [name, expected] of Object.entries(assets)) {
  const after = readFileSync(join(assetDir, name));
  if (createHash('sha256').update(after).digest('hex') !== expected) throw Error('Unexpected image checksum for ' + name);
  const path = join('assets', name), file = join(root, path);
  const before = existsSync(file) ? readFileSync(file) : null;
  if (!before?.equals(after)) changes.push({path, file, before, after});
}
if (check || !changes.length) {
  console.log('Eve owner setup check passed. ' + changes.length + ' file(s) would change.');
} else {
  const backup = mkdtempSync(join(tmpdir(), 'eden-owner-eve-'));
  for (const {file, before, path} of changes) {
    const current = existsSync(file) ? readFileSync(file) : null;
    if (before ? !current?.equals(before) : current) throw Error('Site changed. Try again.');
    if (before) {
      const target = join(backup, path);
      mkdirSync(dirname(target), {recursive:true});
      copyFileSync(file, target);
    }
  }
  const written = [];
  try {
    for (const change of changes) {
      const temporary = change.file + '.eden-' + process.pid;
      mkdirSync(dirname(change.file), {recursive:true});
      try {
        writeFileSync(temporary, change.after, {flag:'wx'});
        renameSync(temporary, change.file);
      } finally {
        rmSync(temporary, {force:true});
      }
      written.push(change);
    }
  } catch (error) {
    for (const {path, file, before} of written.reverse()) {
      if (before) copyFileSync(join(backup, path), file);
      else rmSync(file);
    }
    throw error;
  }
  console.log('Eve owner setup updated. Backup: ' + backup);
}
