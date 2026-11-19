import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const check = args.includes('--check');
const [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview')] = args.filter(arg => arg !== '--check');
const marker = 'Eden booking review and wall lettering v1';

function replace(source, from, to) {
  const count = typeof from === 'string' ? source.split(from).length - 1 : [...source.matchAll(new RegExp(from, 'g'))].length;
  if (count !== 1) throw Error('Unexpected site version near ' + String(from).slice(0, 105));
  return source.replace(from, () => to);
}

function updateClient(source) {
  source = replace(source, 'const history = [];', String.raw`const history = [];
  const form = get('request'), reviewButton = get('reviewRequest'), reviewNote = get('reviewRequestNote');
  const fields = {name:80, contact:120, service:160, preferredTime:100};
  const sent = new Set();
  let draft = null, reviewedDraft = null;

  function signature(details) {
    return JSON.stringify(Object.keys(fields).map(key => details[key].trim().toLowerCase()));
  }

  function setDraft(details) {
    draft = details;
    reviewButton.hidden = reviewNote.hidden = !draft;
  }

  reviewButton.onclick = () => {
    if (!draft || requestPending) return;
    if (reviewedDraft !== draft) {
      for (const key of Object.keys(fields)) form.elements[key].value = draft[key];
      form.elements.consent.checked = false;
      reviewedDraft = draft;
    }
    get('formStatus').textContent = 'Check or edit your details, then give consent and send your request.';
    get('requestHeading').focus({preventScroll:true});
    form.scrollIntoView({block:'start'});
  };`);
  source = replace(source, 'talk.disabled = sendChat.disabled = switching || requestPending;', 'talk.disabled = sendChat.disabled = switching || requestPending;\n    reviewButton.disabled = requestPending;');
  source = replace(source, /    const progress = requestSent[\s\S]+?    return 'This is one conversation/, String.raw`    const progress = (requestSent
      ? 'Most recent request successfully submitted by the visitor on this page: ' + JSON.stringify(requestSent) + '. It is awaiting clinic confirmation. Do not suggest submitting it again. '
      : 'No request has been submitted on this page. ') +
      (draft ? 'An editable request draft is ready. If helpful, direct the visitor to Review request. ' : '') +
      'On this page, send_booking_request only prepares a form draft. After collecting and recapping details, ask whether the visitor would like to review them, and use their affirmative words for consentQuote. Then ask them to select Review request, check their details, give consent, and press Send request. Only the form sends. If the tool returns reviewReady, tell the visitor the draft is ready to review. Do not describe it as a failed send or as received by the clinic.';
    return 'This is one conversation`);
  source = replace(source, /  async function booking\(run, details\) \{[\s\S]+?\n  \}\n\n  async function credentials\(\)/, String.raw`  function booking(run, details) {
    if (active !== run || !run.receivedInput || typeof details?.consentQuote !== 'string' || details.consentQuote.trim().length < 2) {
      return {ok:false, error:'Recap the details and ask if the visitor wants to review them on the page.'};
    }
    if (requestPending) return {ok:false, error:'The form is submitting a request. Wait for the page to show its result.'};
    const next = {};
    for (const [key, max] of Object.entries(fields)) {
      const value = typeof details[key] === 'string' ? details[key].trim() : '';
      if (value.length < 2 || value.length > max) {
        return {ok:false, error:'Check the ' + key + ' with the visitor before preparing their draft.'};
      }
      next[key] = value;
    }
    if (sent.has(signature(next))) {
      return {ok:false, alreadySent:true, message:'The visitor already submitted this request. The clinic still needs to confirm availability.'};
    }
    if (!draft || signature(next) !== signature(draft)) setDraft(next);
    fallback.hidden = true;
    // Existing voice agents treat ok:true as proof the clinic received a request.
    return {ok:false, reviewReady:true, message:'The draft is ready. Ask the visitor to select Review request, check their details, give consent, and press Send request.'};
  }

  async function credentials()`);
  source = replace(source, "      run.connection.sendUserMessage(text);\n      run.receivedInput = true;\n      addTurn('visitor (text)', text);", "      run.receivedInput = true;\n      addTurn('visitor (text)', text);\n      run.connection.sendUserMessage(text);");
  return replace(source, /  get\('request'\)\.onsubmit = async event => \{[\s\S]+?\n  \};/, String.raw`  form.onsubmit = async event => {
    event.preventDefault();
    if (requestPending || !form.reportValidity()) return;
    const button = form.querySelector('button'), output = get('formStatus');
    const data = Object.fromEntries(new FormData(form));
    data.consent = form.elements.consent.checked;
    const key = signature(data);
    if (sent.has(key)) {
      output.textContent = 'This request was already sent. The clinic team will confirm availability.';
      return;
    }
    requestPending = button.disabled = true;
    renderControls();
    output.textContent = 'Sending…';
    try {
      const response = await fetch('/api/clinic/'+slug+'/request', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error(result.error);
      sent.add(key);
      if (reviewedDraft) sent.add(signature(reviewedDraft));
      if (draft === reviewedDraft || (draft && signature(draft) === key)) setDraft(null);
      reviewedDraft = null;
      requestSent = {service:data.service, preferredTime:data.preferredTime};
      output.textContent = 'Request submitted. The clinic team will confirm availability.';
      status.textContent = 'Request submitted. The clinic team will confirm availability.';
      form.reset();
      try { active?.connection?.sendContextualUpdate(handoffContext(active.mode)); } catch {}
    } catch (error) {
      output.textContent = error.message || 'Could not send. Try again.';
    } finally {
      requestPending = button.disabled = false;
      renderControls();
    }
  };`);
}

function updateCore(source) {
  if (source.includes(marker)) return source;
  if (!source.includes('Eden wall and style samples v1')) throw Error('Install the wall and style samples update first.');
  const clientPattern = /const receptionistClient\s*=\s*("(?:\\.|[^"\\])*");/;
  const [, encoded] = clientPattern.exec(source);
  source = replace(source, clientPattern, 'const receptionistClient = '+JSON.stringify(updateClient(JSON.parse(encoded)))+';');
  source = replace(source, 'const ownerView = a => ({deskSigns:', String.raw`/* Eden booking review and wall lettering v1 */
function isTemplateWall(a) {
  const base = 'template/'+a.template;
  return a.hero_status==='ready' && (a.hero_key===base || Boolean(a.hero_key?.startsWith(base+'/')));
}
function savedWallText(a) {
  if (!isTemplateWall(a)) return '';
  try { return decodeURIComponent(a.hero_key.split('/')[2] || ''); }
  catch { return ''; }
}
const ownerView = a => ({wallText:savedWallText(a),deskSigns:`);
  source = replace(source, "heroIsTemplate:a.hero_key==='template/'+a.template&&a.hero_status==='ready'", 'heroIsTemplate:isTemplateWall(a)');
  source = replace(source, "  const html=staticClinicPreview(clinicHtml(draft));", String.raw`  const editable = params.get('lettering')==='1' || (params.get('view')==='wall' && !a.hero_key);
  const preview = editable ? {...draft,variant:'original',hero_key:'template/'+theme,hero_status:'ready'} : draft;
  const html=staticClinicPreview(clinicHtml(preview));`);
  source = replace(source, "  const hero=await availableTemplateWall(request,env,a.template);", String.raw`  const input=await body(request);
  if(input.template&&input.template!==a.template)return json({error:'The saved style changed. Reload and try again.'},409);
  const letters=input.wallText===undefined?'':input.wallText;
  if(typeof letters!=='string'||letters.length>70||/[\r\n\u0000-\u001f\u007f]/.test(letters)||!letters.isWellFormed())
    return json({error:'Enter one line of up to 70 characters for the wall lettering.'},400);
  const base=await availableTemplateWall(request,env,a.template);
  const text=letters.trim();
  const hero=base && (text ? base+'/'+encodeURIComponent(text) : base);
  if(hero&&a.hero_status==='ready'&&hero===a.hero_key)return json(ownerView(a));`);
  source = replace(source, "if((x.heroUrl&&x.heroUrl!==ownerView(a).heroUrl)||", "if((x.heroUrl&&x.heroUrl!==ownerView(a).heroUrl)||(Object.hasOwn(x,'wallText')&&x.wallText!==savedWallText(a))||");
  source = replace(source, ' const newScene=next.clinic!==a.clinic||next.template!==a.template;', String.raw` const newScene=next.clinic!==a.clinic||next.template!==a.template;
 const existingLetters=savedWallText(a);
 const nextWallBase=newScene&&isTemplateWall(a)?await availableTemplateWall(request,env,next.template):null;
 const nextWall=nextWallBase&&(existingLetters?nextWallBase+'/'+encodeURIComponent(existingLetters):nextWallBase);`);
  source = replace(source, 'hero_key=CASE WHEN ? THEN NULL ELSE hero_key END,hero_status=CASE WHEN ? THEN NULL ELSE hero_status END', 'hero_key=CASE WHEN ? THEN ? ELSE hero_key END,hero_status=CASE WHEN ? THEN ? ELSE hero_status END');
  source = replace(source, 'agentId,voiceChanged?1:0,newScene?1:0,newScene?1:0,newScene?1:0,newScene?1:0,now()', "agentId,voiceChanged?1:0,newScene?1:0,nextWall,newScene?1:0,nextWall?'ready':null,newScene?1:0,newScene?1:0,now()");
  source = replace(source, 'hero_key:newScene?null:a.hero_key,hero_status:newScene?null:a.hero_status', "hero_key:newScene?nextWall:a.hero_key,hero_status:newScene?(nextWall?'ready':null):a.hero_status");
  source = replace(source, `await env.PILOT_DB.prepare("UPDATE clinic_assistants SET status='published',updated_at=? WHERE id=?").bind(now(),id).run();`, String.raw`const published=await env.PILOT_DB.prepare("UPDATE clinic_assistants SET status='published',updated_at=? WHERE id=? AND updated_at=?").bind(now(),id,a.updated_at).run();if(published.meta?.changes!==1)return json({error:'Setup changed. Reload and review the page before publishing.'},409);`);
  source = replace(source, " const templateWall=a.hero_key==='template/'+theme&&a.hero_status==='ready';", " const templateWall=isTemplateWall(a);\n const wallText=savedWallText(a)||a.clinic;");
  source = replace(source, '<div class="sign-wall ${a.clinic.length>35?\'compact\':\'\'}" aria-hidden="true"><small>WELCOME TO</small><span class="wall-name">${name}</span></div>', '<div class="sign-wall ${wallText.length>35?\'compact\':\'\'}" aria-hidden="true">${templateWall?\'\':\'<small>WELCOME TO</small>\'}<span class="wall-name">${h(wallText)}</span></div>');
  source = replace(source, '/* Eden wall and style samples v1 */', String.raw`
body.has-template-wall.variant-original .wall-name{
  font-kerning:normal;white-space:normal;text-wrap:balance;overflow-wrap:anywhere;
  text-shadow:-.025em -.025em 0 #fff9,.022em .022em 0 var(--wall-side),
    .044em .044em 0 var(--wall-side),.065em .065em 0 var(--wall-side),
    .105em .14em .04em var(--wall-cast),.17em .19em .12em var(--wall-cast);
}
body:is(.theme-pearl,.theme-pattaya,.theme-mabuhay).has-template-wall.variant-original .wall-name{
  font-family:system-ui,sans-serif;font-weight:750;
}
#reviewRequest:not([hidden]){margin:.65rem auto 0;display:block}
#reviewRequestNote{text-align:center}
#requestHeading:focus{outline:none}
body.theme-pattaya.variant-original.is-style-sample.has-photo-wall .sign-plate.center{
  padding-inline:.5cqw;
}
/* Eden wall and style samples v1 */`);
  source = replace(source, 'left:44.3%;top:76.2%;width:17.8%;height:10.7%;--plate-center-angle:1.5deg;', 'left:44.1%;top:76.2%;width:18.2%;height:10.6%;--plate-center-angle:1.5deg;');
  source = replace(source, '<p id="status" class="status" role="status"></p>', '<p id="status" class="status" role="status"></p><button id="reviewRequest" class="primary" type="button" aria-controls="request" hidden>Review request</button><p id="reviewRequestNote" class="chat-note" role="status" hidden>Your draft is ready. Review your details before sending.</p>');
  return replace(source, '<h2>Request an appointment</h2><label>Your name', '<h2 id="requestHeading" tabindex="-1">Request an appointment</h2><label>Your name');
}

function updateSetup(source) {
  if (source.includes(marker)) return source;
  if (!source.includes('Eden wall and style samples v1')) throw Error('Install the wall and style samples update first.');
  source = replace(source, '.owner-channel a.btn{text-decoration:none}', String.raw`/* Eden booking review and wall lettering v1 */
.owner-channel a.btn{text-decoration:none}
.owner-channel .new-tab-icon{margin-inline-start:.45em;font-size:.95em;line-height:1}
.wall-lettering{max-width:38rem;margin:1rem 0}
`);
  source = replace(source,
    '<p>Generate the wall image with your saved clinic name. Check the lettering and desk signs in this wide preview before approving.</p><div class="actions"><button class="btn light" type="button" id="generateWall">Generate image with block letters on wall</button><button class="btn light" type="button" id="useTemplateWall">Use template wall</button></div>',
    String.raw`<p>Check the wall lettering and desk signs in this preview before approving.</p>
<form id="wallLetteringForm" class="wall-lettering" hidden>
  <label class="field"><span>Wall lettering</span><input id="wallLettering" maxlength="70" aria-describedby="wallLetteringHint"><small id="wallLetteringHint">Type to preview raised letters. Leave blank to use your clinic name.</small></label>
  <button class="btn light" type="submit" id="useTemplateWall">Save wall lettering</button>
</form>
<details id="generateWallOptions"><summary>Generate a custom photo instead</summary><div class="actions"><button class="btn light" type="button" id="generateWall">Generate image with block letters on wall</button></div></details>`);
  source = replace(source, 'Changing the clinic name or style calls for a new wall image.', 'After changing the clinic name or style, review the wall again.');
  source = replace(source, 'The wall name is spelled exactly right, and the text fits inside all three desk signs.', 'The wall lettering is correct, and the text fits inside all three desk signs.');
  source = replace(source, "$('useTemplateWall').hidden=a.status==='published'||a.heroIsTemplate||a.heroIsPilot;", 'renderWallLettering();');
  source = replace(source, 'void loadWallPreview();$(\'qaStart\')', 'void loadWallPreview(wallLetteringDirty);$(\'qaStart\')');
  source = replace(source, "$('generateWall').onclick=generateOwnerWall;\n\n$('useTemplateWall').onclick=async()=>{", String.raw`$('generateWall').onclick=generateOwnerWall;

let wallLetteringDirty=false;
function renderWallLettering(){
  const a=assistant;
  $('wallLetteringForm').hidden=a.status==='published';
  $('generateWallOptions').hidden=a.status==='published'||a.heroIsPilot;
  const input=$('wallLettering');
  input.placeholder=a.clinic;
  if(!wallLetteringDirty)input.value=a.wallText||'';
}

function showDraftLettering(){
  if(!wallLetteringDirty)return;
  const frame=$('wallPreview');
  const wall=frame.contentDocument?.querySelector('body.has-template-wall .sign-wall');
  if(!wall)return;
  const text=$('wallLettering').value.trim()||assistant.clinic;
  wall.classList.toggle('compact',text.length>35);
  wall.querySelector('.wall-name').textContent=text;
}
$('wallPreview').addEventListener('load',showDraftLettering);
$('wallLettering').oninput=()=>{
  wallLetteringDirty=true;
  $('wallNameCorrect').checked=false;
  $('wallNameCorrect').disabled=true;
  $('approveWall').disabled=true;
  showDraftLettering();
  void loadWallPreview(true);
  status('wallStatus','Save the lettering when you’re happy with the preview.');
};

$('wallLetteringForm').onsubmit=async event=>{
  event.preventDefault();`);
  source = replace(source, "  const button=$('useTemplateWall');button.disabled=true;$('generateWall').disabled=true;", String.raw`  const button=$('useTemplateWall'), input=$('wallLettering');
  if(button.disabled||assistant.status==='published')return;
  if($('editTemplate').value!==assistant.template){
    status('wallStatus','Save the selected style before saving your wall lettering.',true);
    return;
  }
  button.disabled=$('generateWall').disabled=input.readOnly=true;`);
  source = replace(source, "    assistant=await api('/api/assistants/'+id+'/hero-template',{method:'POST',body:'{}'});", String.raw`    const wasApproved=assistant.heroApproved;
    assistant=await api('/api/assistants/'+id+'/hero-template',{
      method:'POST',body:JSON.stringify({template:assistant.template,wallText:input.value.trim()})
    });
    wallLetteringDirty=false;
    $('wallNameCorrect').disabled=false;`);
  source = replace(source, "    status('wallStatus','Template wall selected. Check your clinic name and approve the wall below.');", "    status('wallStatus',wasApproved&&assistant.heroApproved?'Wall scene approved.':'Lettering saved. Check the wall and desk signs before approving.');");
  source = replace(source, "  finally{button.disabled=false;$('generateWall').disabled=assistant.heroStatus==='generating'}", "  finally{input.readOnly=false;button.disabled=$('generateWall').disabled=assistant.heroStatus==='generating'}");
  source = replace(source, "    renderManage();\n    const notice=assistant.wallNotice||", "    if(assistant.heroReady&&!assistant.wallNotice){\n      wallLetteringDirty=false;\n      $('wallNameCorrect').disabled=false;\n    }\n    renderManage();\n    const notice=assistant.wallNotice||");
  source = replace(source, "if(button.disabled||!$('wallNameCorrect').checked)return;", "if(button.disabled||wallLetteringDirty||!$('wallNameCorrect').checked)return;");
  source = replace(source, '{nameCorrect:true,heroUrl:assistant.heroUrl,deskSigns:assistant.deskSigns||null}', '{nameCorrect:true,heroUrl:assistant.heroUrl,wallText:assistant.wallText||\'\',deskSigns:assistant.deskSigns||null}');
  source = replace(source, 'async function previewHtml(theme,wallOnly=false){', 'async function previewHtml(theme,wallOnly=false,lettering=false){');
  source = replace(source, "  if(wallOnly)params.set('view','wall');", "  if(wallOnly)params.set('view','wall');\n  if(lettering)params.set('lettering','1');");
  source = replace(source, 'a.heroUrl,a.variant,a.deskSigns]);', 'a.heroUrl,a.variant,a.deskSigns,a.wallText]);');
  source = replace(source, 'async function loadWallPreview(){', 'async function loadWallPreview(lettering=wallLetteringDirty){');
  source = replace(source, 'assistant.variant,assistant.deskSigns]);', 'assistant.variant,assistant.deskSigns,assistant.wallText,lettering]);');
  source = replace(source, 'const html=await previewHtml(undefined,true);', 'const html=await previewHtml(undefined,true,lettering);');
  source = replace(source, "    $('wallFrame').hidden=false;\n    $('approveWall').disabled=!$('wallNameCorrect').checked;", "    $('wallFrame').hidden=false;\n    $('approveWall').disabled=wallLetteringDirty||!$('wallNameCorrect').checked;");
  const external = '<span class="new-tab-icon" aria-hidden="true">↗</span>';
  source = replace(source, '<button type="button" class="btn light">Set up Messenger</button><p class="muted">(Opens in new tab)</p>',
    '<button type="button" class="btn light" title="Opens in a new tab" aria-label="Set up Messenger (opens in a new tab)">Set up Messenger'+external+'</button>');
  return replace(source, 'rel="noopener noreferrer">Open Clinic Workspace</a>',
    'rel="noopener noreferrer" title="Opens in a new tab" aria-label="Open Clinic Workspace (opens in a new tab)">Open Clinic Workspace'+external+'</a>');
}

const files = [
  ['assistant-setup/index.html',updateSetup],
  ['assistant-core.js',updateCore]
].map(([path,transform])=>{
  const before=readFileSync(join(root,path));
  return {path,before,after:Buffer.from(transform(before.toString('utf8')))};
});
const changes=files.filter(({before,after})=>!before.equals(after));
if(check||!changes.length){
  console.log('Booking review and wall lettering check passed. '+changes.length+' file(s) would change.');
}else{
  const backup=mkdtempSync(join(tmpdir(),'eden-booking-review-'));
  for(const {path,before} of changes){
    const target=join(backup,path);
    mkdirSync(dirname(target),{recursive:true});
    writeFileSync(target,before);
  }
  const written=[];
  try{
    for(const {path,before,after} of changes){
      const file=join(root,path);
      if(!readFileSync(file).equals(before))throw Error('The site changed during the update. Run the installer again.');
      const temporary=file+'.eden-'+process.pid;
      writeFileSync(temporary,after,{flag:'wx'});
      try{
        renameSync(temporary,file);
        written.push({file,before});
      }finally{rmSync(temporary,{force:true})}
    }
  }catch(error){
    for(const {file,before} of written.reverse())writeFileSync(file,before);
    throw error;
  }
  console.log('Booking review and wall lettering installed. Backup: '+backup);
}
