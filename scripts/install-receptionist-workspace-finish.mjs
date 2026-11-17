import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: { check }, positionals: [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview'), ...rest] } =
  parseArgs({ allowPositionals: true, options: { check: { type: 'boolean' } } });
if (rest.length) throw Error('Pass one voice-preview folder, optionally followed by --check.');

// Updates the installed voice-preview site in place.
const previous = 'Eden live save polish v1';
const marker = 'Eden receptionist and Workspace finish v1';

function replace(source, from, to) {
  const count = typeof from === 'string'
    ? source.split(from).length - 1
    : [...source.matchAll(new RegExp(from, 'g'))].length;
  if (count !== 1) throw Error('Unexpected setup version near ' + String(from).slice(0, 105) + '. No files were changed.');
  return source.replace(from, (...args) => typeof to === 'function' ? to(...args) : to);
}

const workspaceIntake = String.raw`/* Eden receptionist and Workspace finish v1 */
async function sendWebsiteRequestToWorkspace(env, assistant, data) {
  if (!env.BOOKING_INGEST_KEY) return null;
  const scope = await findWorkspaceScope(env, 'assistant_id', assistant.id);
  if (!scope) return null;
  const sourceEventId = workspaceId.test(data.sourceEventId || '') ? data.sourceEventId : crypto.randomUUID();
  try {
    const url = new URL('/integrations/tenant-website-requests', workspaceConfigUrl);
    const response = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type':'application/json', Authorization:'Bearer '+env.BOOKING_INGEST_KEY},
      body: JSON.stringify({
        accountId: scope.account_id, locationId: scope.location_id, sourceEventId,
        requestType: data.requestType, patientName: data.name.trim(), contact: data.contact.trim(),
        service: data.service.trim(), requestedTime: data.preferredTime.trim(),
        verifiedAlertEmail: assistant.alert_confirmed_at ? assistant.alert_email : null
      }),
      redirect: 'error', signal: AbortSignal.timeout(12000)
    });
    if (response.ok && (await response.json()).ok === true) return json({ok:true});
  } catch {}
  return json({error:'The clinic inbox is temporarily unavailable. Your details are still here. Please try again shortly.'},503);
}
`;

function updateWorker(source) {
  if (source.includes(marker)) return source;
  if (!source.includes(previous)) throw Error('Install the live save polish update first.');
  const patch = (from, to) => { source = replace(source, from, to); };
  patch('async function findWorkspaceScope(env,column,value){',
    workspaceIntake+'\nasync function findWorkspaceScope(env,column,value){');
  patch(/(if\(action==='request'&&request\.method==='POST'\)\{[^\n]*?const x=await body\(request\);)if\(!value\(x\.name,2,80\)\|\|!safeContact\(x\.contact\)\|\|!value\(x\.service,2,160\)\|\|!value\(x\.preferredTime,2,100\)\|\|x\.consent!==true\)return json\(\{error:'Check the request details and consent\.'\},400\);/,
    (_, start) => start + String.raw`
x.requestType=x.requestType??'booking';
x.preferredTime=x.preferredTime??'';
const noPreference=x.requestType==='question'&&x.preferredTime==='';
const validContact=safeContact(x.contact)&&(!x.contact.startsWith('+')||/^\+[1-9][0-9]{7,14}$/.test(x.contact.replace(/[ ()-]/g,'')));
if(!['booking','question'].includes(x.requestType)||!value(x.name,2,80)||!validContact||
   !value(x.service,2,160)||(!noPreference&&!value(x.preferredTime,2,100))||x.consent!==true)
  return json({error:'Check the request details and consent.'},400);
const workspaceResult=await sendWebsiteRequestToWorkspace(env,a,x);
if(workspaceResult)return workspaceResult;
`);
  patch(/(<label>[^<>]*<input name="service"[^>]*>)/,
    (_, service) => '<label>Request type<select name="requestType"><option value="booking">Appointment</option><option value="question">Question for the clinic</option></select></label>'+service);
  patch(/const receptionistClient\s*=\s*("(?:\\.|[^"\\])*");/, (_, encoded) => {
    let client = JSON.parse(encoded);
    client = replace(client, '  const sent = new Set();', '  const sent = new Set();\n  const requestIds = new Map();');
    client = replace(client, '  form.onsubmit = async event => {', `  function syncRequestType() {
    const booking = form.elements.requestType.value === 'booking';
    form.elements.preferredTime.required = booking;
    form.elements.preferredTime.closest('label').hidden = !booking;
  }
  form.elements.requestType.onchange = syncRequestType;
  syncRequestType();

  form.onsubmit = async event => {`);
    client = replace(client, '    const key = signature(data);', `    const question = data.requestType === 'question';
    if (question) data.preferredTime = '';
    const key = question ? 'question:' + signature(data) : signature(data);
    if (!isOwnerTest) {
      if (!requestIds.has(key)) requestIds.set(key, crypto.randomUUID());
      data.sourceEventId = requestIds.get(key);
    }`);
    client = replace(client, '      if (reviewedDraft) sent.add(signature(reviewedDraft));', '      if (!question && reviewedDraft) sent.add(signature(reviewedDraft));');
    client = replace(client, '      if (recap) sent.add(signature(recap));', '      if (!question && recap) sent.add(signature(recap));');
    client = replace(client, "      if (!isOwnerTest) requestSent = {service:data.service, preferredTime:data.preferredTime};",
      "      if (!isOwnerTest && !question) requestSent = {service:data.service, preferredTime:data.preferredTime};");
    client = replace(client, "'Request submitted. The clinic team will confirm availability.';\n      form.reset();",
      "(question ? 'Question submitted. The clinic team will follow up.' : 'Request submitted. The clinic team will confirm availability.');\n      form.reset();\n      syncRequestType();");
    execFileSync(process.execPath, ['--input-type=module', '--check'], {input:client, stdio:['pipe','inherit','inherit']});
    return 'const receptionistClient = '+JSON.stringify(client)+';';
  });
  return source;
}

function updatePage(source) {
  if (source.includes(marker)) return source;
  if (!source.includes(previous)) throw Error('Install the live save polish update first.');
  const patch = (from, to) => { source = replace(source, from, to); };
  patch('<!-- '+previous+' -->', '<!-- '+previous+' --><!-- '+marker+' -->');
  patch('#setupReconnect h2{margin:0 0 6px;', `#dismissSetupReconnect{float:right;border:1px solid #aac1b3;background:#fff;color:inherit;border-radius:50%;width:2.25rem;height:2.25rem;padding:0;font:inherit;cursor:pointer}
#setupReconnect h2{margin:0 2.75rem 6px 0;`);
  patch('  <h2 id="setupReconnectTitle">', '  <button type="button" id="dismissSetupReconnect" aria-label="Dismiss reconnect notice">×</button>\n  <h2 id="setupReconnectTitle">');
  patch("  if(!needsSetupAccess){\n    needsSetupAccess=true;\n    $('setupReconnect').hidden=false;",
    "  $('setupReconnect').hidden=false;\n  if(!needsSetupAccess){\n    needsSetupAccess=true;");
  patch("?setupAccessExpired():result?.error||'Could not read the setup response. Please try again.';",
    "?((path==='/api/assistants/workspace-session'&&needsSetupAccess)?setupReconnectMessage:setupAccessExpired())\n      :result?.error||'Could not read the setup response. Please try again.';");
  patch("window.addEventListener('focus',()=>void checkSetupConnection());", `function dismissReconnect(){
  $('setupReconnect').hidden=true;
}
$('dismissSetupReconnect').onclick=dismissReconnect;
document.addEventListener('pointerdown',event=>{
  const notice=$('setupReconnect');
  if(!notice.hidden&&!notice.contains(event.target))dismissReconnect();
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!event.defaultPrevented&&!$('setupReconnect').hidden)dismissReconnect();
});
window.addEventListener('focus',()=>void checkSetupConnection());`);
  patch('async function connectEve(mode){', String.raw`function stripPracticeGreeting(message, a){
  const template=a?.language==='Thai'
    ? 'สวัสดีค่ะ ยินดีต้อนรับสู่ '+a?.clinic+' มีอะไรให้ช่วยไหมคะ'
    : 'Hi, welcome to '+a?.clinic+'. What can I help you with?';
  const text=message.trim();
  const prefix=text.slice(0,template.length).toLowerCase();
  if(prefix===template.toLowerCase()&&(!text[template.length]||/\s/.test(text[template.length])))return text.slice(template.length).trim();
  return message;
}
async function connectEve(mode){`);
  patch("      displayEveTurn({role,message:entry.message},interviewing);\n      if(!interviewing&&textOnly&&role==='agent'&&sentPracticeText&&entry.message?.trim())",
    `      const message=role==='agent'&&textOnly&&!interviewing&&typeof entry.message==='string'
        ?stripPracticeGreeting(entry.message,assistant):entry.message;
      if(role==='agent'&&!message?.trim())return;
      displayEveTurn({role,message},interviewing);
      if(!interviewing&&textOnly&&role==='agent'&&sentPracticeText&&message?.trim())`);
  const testButton = '<button class="btn light" id="ownerPublicTest" type="button" hidden>Test the public receptionist privately</button>';
  patch(testButton, '');
  patch('<p id="approvalStatus" class="status" role="status"></p></div></div><div class="card" id="publishStep">',
    '<p id="approvalStatus" class="status" role="status"></p></div>'+testButton+'</div><div class="card" id="publishStep">');
  patch(/(<label[^>]*>\s*<input[^>]*\bid="confirmContact"[^>]*>[^<]*<\/label>)(\s*)/, (match) =>
    match+'<button type="button" class="btn" id="saveLiveClinicFacts" hidden>Save clinic facts</button><p id="liveClinicFactsStatus" class="status" role="status" hidden></p>');
  patch("  $('saveContact').hidden=published;", `  $('saveContact').hidden=published;
  $('saveLiveClinicFacts').hidden=$('liveClinicFactsStatus').hidden=!published;`);
  patch('Edit your clinic facts and contact links here, then select Update live receptionist.',
    'Edit your clinic facts and contact links here, then select Save clinic facts.');
  patch('    <button type="button" id="reloadLiveSetup" class="btn light" hidden>Reload this setup tab</button>\n', '');
  patch("  $('reloadLiveSetup').hidden=!conflict;\n  $('liveSaveFollowup').hidden=link.hidden&&!conflict;",
    "  $('liveSaveFollowup').hidden=link.hidden;");
  patch("$('reloadLiveSetup').onclick=()=>location.reload();\n\n$('saveLiveReceptionist').onclick=async()=>{", `function showSetupRevisionConflict(statusId){
  status(statusId,'Setup changed while you were editing. ',true);
  const link=document.createElement('a');
  link.href=location.href;
  link.textContent='Reload this setup tab';
  link.onclick=event=>{
    event.preventDefault();
    location.reload();
  };
  $(statusId).append(link,' before saving again. Reloading clears unsaved edits in this tab.');
}
async function saveLiveReceptionist(statusId){`);
  patch("  if(current?.status!=='published'||preparingWallPhoto||applyingWallPhoto)return;", `  if(current?.status!=='published'||preparingWallPhoto||applyingWallPhoto||savingLiveReceptionist)return;`);
  patch("  controls.forEach(field=>field.disabled=true);\n  syncPhotoControls();\n  status('livePageStatus',", `  savingLiveReceptionist=true;
  $('saveLiveClinicFacts').disabled=true;
  controls.forEach(field=>field.disabled=true);
  syncPhotoControls();
  status(statusId,`);
  patch("    status('livePageStatus','Your live receptionist is up to date.');",
    "    status(statusId,'Your live receptionist is up to date.');");
  patch("    populateDetails();\n    $('confirmContact').checked=false;\n    status('livePageStatus','Changes are live. Open your live page to see them.');",
    `    populateDetails();
    if(current.clinic!==assistant.clinic&&session){
      await endEve().catch(()=>{});
      $('eveTranscript').replaceChildren();
      syncEveControls();
      status('voiceStatus','Clinic name updated. Start a new test to hear the updated greeting.');
    }
    $('confirmContact').checked=false;
    status(statusId,statusId==='liveClinicFactsStatus'?'Clinic facts saved and live.':'Changes are live. Open your live page to see them.');`);
  patch("      status('livePageStatus','Setup changed while you were editing. Reload this setup tab before saving again. Reloading clears unsaved edits in this tab.',true);",
    "      showSetupRevisionConflict(statusId);");
  patch("    }else showFieldIssue('livePageStatus',error,{...editFieldIds,...contactFieldIds});",
    "    }else showFieldIssue(statusId,error,{...editFieldIds,...contactFieldIds});");
  patch("    controls.forEach((field,index)=>field.disabled=disabled[index]);\n    syncPhotoControls();\n  }\n};", `    controls.forEach((field,index)=>field.disabled=disabled[index]);
    savingLiveReceptionist=false;
    $('saveLiveClinicFacts').disabled=false;
    syncPhotoControls();
  }
}
let savingLiveReceptionist=false;
$('saveLiveClinicFacts').onclick=()=>saveLiveReceptionist('liveClinicFactsStatus');
$('saveLiveReceptionist').onclick=()=>saveLiveReceptionist('livePageStatus');`);
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
  console.log('Receptionist and Workspace update check passed. ' + changes.length + ' file(s) would change.');
} else {
  for (const {file,before} of changes) {
    if (readFileSync(file, 'utf8') !== before) throw Error('Setup files changed. Run the installer again.');
  }
  const backup = mkdtempSync(join(tmpdir(), 'eden-receptionist-workspace-'));
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
  console.log('Receptionist and Workspace update installed. Backup: ' + backup);
}
