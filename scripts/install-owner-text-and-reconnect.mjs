import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: { check }, positionals: [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview'), ...rest] } =
  parseArgs({ allowPositionals: true, options: { check: { type: 'boolean' } } });
if (rest.length) throw Error('Pass one voice-preview folder, optionally followed by --check.');

const file = join(root, 'assistant-setup', 'index.html');
const before = readFileSync(file, 'utf8');
const previous = '<!-- Eden Tailormade hero previews v1 -->';
const marker = '<!-- Eden owner text and reconnect v1 -->';
if (before.includes(marker)) {
  console.log('Owner text and reconnect are already installed.');
  process.exit(0);
}
if (!before.includes(previous)) throw Error('Install the Tailormade hero preview update first.');

let html = before;
function replace(from, to) {
  if (html.split(from).length !== 2) throw Error('Unexpected setup page near ' + from.slice(0, 110) + '. No files were changed.');
  html = html.replace(from, () => to);
}

replace(previous, previous + marker);
replace('#workspaceNavigation[hidden]{display:none}', `#workspaceNavigation[hidden]{display:none}
#setupReconnect{position:fixed;inset:auto 16px 16px auto;z-index:50;width:min(400px,calc(100% - 32px));box-sizing:border-box;padding:16px 18px;color:var(--ink);background:#fff;border:1px solid #aac1b3;border-radius:16px;box-shadow:0 10px 36px #162e2426}
#setupReconnect[hidden]{display:none}
#setupReconnect h2{margin:0 0 6px;font:inherit;font-weight:750}
#setupReconnect p{margin:0 0 12px}
#setupReconnect .actions{display:flex;flex-wrap:wrap;gap:8px;margin:0}
#setupReconnect .btn{margin:0}`);
replace('<nav id="workspaceNavigation"', `<aside id="setupReconnect" aria-labelledby="setupReconnectTitle" hidden>
  <h2 id="setupReconnectTitle">Reconnect to Clinic Workspace</h2>
  <p id="setupReconnectDetail" role="status"></p>
  <div class="actions">
    <a class="btn" id="setupReconnectLink" target="_blank" rel="noopener noreferrer" href="https://clinicnet.live/clinic/">Open Workspace in a new tab ↗</a>
    <button type="button" class="btn light" id="checkSetupConnection">Check connection</button>
  </div>
</aside>
<nav id="workspaceNavigation"`);
const oldAPI = "async function api(path,options={}){const r=await fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{}),...(options.headers||{})}});const j=await r.json();if(!r.ok)throw Object.assign(Error(j.error||'Please try again.'),{field:j.field,status:r.status,wallImageAllowance:j.wallImageAllowance});return j}";
replace(oldAPI, `const setupReconnectMessage='Setup access expired. Your edits are still here.';
const setupReconnectSteps='In Workspace, select Website chat → Set up AI receptionist for this location, then return to this tab.';
let workspaceScope, setupConnectionPending, needsSetupAccess=false;

function setupAccessExpired(){
  if(!needsSetupAccess){
    needsSetupAccess=true;
    $('setupReconnect').hidden=false;
    $('setupReconnectTitle').textContent='Reconnect to Clinic Workspace';
    $('setupReconnectDetail').textContent=setupReconnectMessage+' '+setupReconnectSteps;
    $('setupReconnectLink').href=$('backToWorkspace').href;
    $('setupReconnectLink').hidden=false;
    $('checkSetupConnection').textContent='Check connection';
  }
  return setupReconnectMessage;
}
async function api(path,options={}){
  const response=await fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{}),...(options.headers||{})}});
  const result=await response.json().catch(()=>null);
  if(!response.ok||!result){
    const message=useWorkspace&&response.status===401&&path!=='/api/assistants/workspace-close'
      ?setupAccessExpired():result?.error||'Could not read the setup response. Please try again.';
    throw Object.assign(Error(message),{field:result?.field,status:response.status,wallImageAllowance:result?.wallImageAllowance});
  }
  return result;
}
function workspaceScopeFrom(setup){
  const url=new URL(setup.returnUrl);
  return JSON.stringify([url.searchParams.get('account'),url.searchParams.get('location')]);
}
function checkSetupConnection(showProgress=false){
  if(!needsSetupAccess)return;
  if(setupConnectionPending)return setupConnectionPending;
  const button=$('checkSetupConnection');
  button.disabled=true;
  if(showProgress)$('setupReconnectDetail').textContent='Checking your setup access…';
  setupConnectionPending=(async()=>{
    try{
      const setup=await api('/api/assistants/workspace-session',{method:'POST',body:'{}',signal:AbortSignal.timeout(25000)});
      if((workspaceScope&&workspaceScope!==workspaceScopeFrom(setup))||(id&&id!==setup.id)){
        $('setupReconnectDetail').textContent='Workspace opened a different location. Reopen setup for the location in this tab.';
        return;
      }
      if(currentScreen==='screen-no-invite')await openWorkspaceDraft(setup);
      needsSetupAccess=false;
      $('setupReconnectTitle').textContent='Setup reconnected';
      $('setupReconnectDetail').textContent='Your edits are here. You can continue and retry the last action.';
      $('setupReconnectLink').hidden=true;
      button.textContent='Continue setup';
    }catch(error){
      if(showProgress||error.status!==401)
        $('setupReconnectDetail').textContent=error.status===401?setupReconnectSteps:error.message;
    }finally{
      button.disabled=false;
      setupConnectionPending=undefined;
    }
  })();
  return setupConnectionPending;
}
$('checkSetupConnection').onclick=()=>{
  if(needsSetupAccess)void checkSetupConnection(true);
  else $('setupReconnect').hidden=true;
};
window.addEventListener('focus',()=>void checkSetupConnection());
`);
replace(`    $('backToWorkspace').href=setup.returnUrl;
    if(setup.id){id=setup.id;activeStep=1;view('screen-manage');await reload()}
    else{
      if(!$('clinic').value&&setup.locationName){
        $('clinic').value=setup.locationName;
        $('clinic').dispatchEvent(new Event('input'));
      }
      view('screen-create');
    }`, '    await openWorkspaceDraft(setup);');
replace('async function startWorkspace(){', `async function openWorkspaceDraft(setup){
  workspaceScope=workspaceScopeFrom(setup);
  $('backToWorkspace').href=setup.returnUrl;
  if(setup.id){
    id=setup.id;
    activeStep=1;
    view('screen-manage');
    await reload();
  }else{
    if(!$('clinic').value&&setup.locationName){
      $('clinic').value=setup.locationName;
      $('clinic').dispatchEvent(new Event('input'));
    }
    view('screen-create');
  }
}
async function startWorkspace(){`);
replace("  if(!r.ok)throw Error('Could not load the page preview.');",
  "  if(!r.ok)throw Error(useWorkspace&&r.status===401?setupAccessExpired():'Could not load the page preview.');");
replace("placeholder=\"(Optional) Type during your test booking...\"", 'placeholder="Type a test message…"');
replace('id="talk" type="button" aria-labelledby="eveTalkLabel" aria-pressed="false"',
  'id="talk" type="button" aria-labelledby="eveTalkLabel" aria-pressed="false" disabled');
replace("  const inVoice=eveMode===selectedEveMode;", "  const inVoice=Boolean(session)&&eveMode===selectedEveMode;");
replace("(settingUp?(workspaceIntake?'Start voice interview':'Start clinic setup'):'Start voice test booking')",
  "(settingUp?'Start voice interview':'Start voice test booking')");
replace("  $('talk').disabled=eveUnavailable();",
  "  $('talk').disabled=eveUnavailable()||(settingUp?!canInterview():!assistant);");
replace("  $('eveMessage').disabled=$('eveSend').disabled=eveUnavailable()||(!session&&(!settingUp||!canInterview()));",
  "  $('eveMessage').disabled=$('eveSend').disabled=eveUnavailable()||(settingUp?!canInterview():!assistant);");
replace("settingUp?'(Optional) Type your clinic details or make corrections...':'(Optional) Type during your test booking...'",
  "settingUp?'Type your clinic details or corrections…':'Type a test message…'");
replace(":'Try a private test booking. No request is sent.';", ":'Type a test message or start a voice test. This test sends no booking request.';");
replace("status('voiceStatus',interviewing?'Connecting to your interview…':assistant.agentReady?'Connecting…':'Preparing your voice assistant…');",
  "status('voiceStatus',textOnly?'Connecting to chat…':interviewing?'Connecting to your interview…':assistant.agentReady?'Connecting…':'Preparing your receptionist…');");
replace("  const pendingEcho=[];", `  const pendingEcho=[];
  let sentPracticeText=false, recordingTest=false;
  const recordTextTest=async()=>{
    if(recordingTest||assistant.voiceReviewed)return;
    const testedAssistant=assistant;
    recordingTest=true;
    try{
      await api('/api/assistants/'+id+'/voice-reviewed',{method:'POST',body:JSON.stringify({agentId:result.agentId})});
      if(assistant!==testedAssistant)return;
      testedAssistant.voiceReviewed=true;
      renderReceptionistTestSummary(testedAssistant);
      renderApproval();
      syncEveControls();
    }catch(error){
      if(run===eveRun)status('voiceStatus',error.status===401?error.message:'Could not save the test result. Send another test message to retry.',true);
    }finally{recordingTest=false}
  };`);
replace(`      displayEveTurn({role,message:entry.message},interviewing);
    },
    onDisconnect`, `      displayEveTurn({role,message:entry.message},interviewing);
      if(!interviewing&&textOnly&&role==='agent'&&sentPracticeText&&entry.message?.trim())
        void recordTextTest();
    },
    onDisconnect`);
replace(`    try{connection.sendUserMessage(message)}catch(error){pendingEcho.pop();throw error}
    displayEveTurn({role:'user',message},interviewing);`, `    try{connection.sendUserMessage(message)}catch(error){pendingEcho.pop();throw error}
    if(!interviewing&&textOnly)sentPracticeText=true;
    displayEveTurn({role:'user',message},interviewing);`);
replace("  if(eveUnavailable()||!message||(!session&&(selectedEveMode!=='interview'||!canInterview())))return;",
  "  if(input.disabled||eveUnavailable()||!message)return;");
replace(`async function runEveConversation(mode){
  if(eveUnavailable())return;`, `async function runEveConversation(mode){
  if($('talk').disabled||eveUnavailable())return;`);
replace("    if(!session)await connectEve('interview-chat');",
  "    if(!session)await connectEve(selectedEveMode+'-chat');");
replace(`    sendEveText(message);
    input.value='';
  }catch(error){status('voiceStatus',error.message||'Could not send that message. Try again.',true)}
  finally{eveBusy=false;syncEveControls()}
};`, `    sendEveText(message);
    input.value='';
  }catch(error){status('voiceStatus',error.message||'Could not send that message. Try again.',true)}
  finally{
    eveBusy=false;
    syncEveControls();
    if(!input.value&&!input.disabled)input.focus({preventScroll:true});
  }
};`);
replace(`$('evePracticeMode').onclick=()=>chooseEveMode('test');
$('eveSetupMode').onclick=()=>chooseEveMode('interview');`, `for(const [button,mode] of [['evePracticeMode','test'],['eveSetupMode','interview']])
  $(button).onclick=async()=>{
    await chooseEveMode(mode);
    if(!$('eveMessage').disabled)$('eveMessage').focus();
  };`);
const summary = /\$\('summaryVoice'\)\.textContent=\(a\.language==='Thai'[^;]+;/.exec(html)?.[0];
if (!summary) throw Error('Could not find the receptionist test summary.');
replace(summary, 'renderReceptionistTestSummary(a);');
replace('function renderApproval(){', `function renderReceptionistTestSummary(a){
  ${summary.replace(" · Voice tested", " · Test complete").replace(" · Test with Talk above", " · Test by chat or voice above")}
}
function renderApproval(){`);
replace('Clinic details were updated. Test the updated booking voice before approval.',
  'Clinic details were updated. Test the receptionist by chat or voice before approval.');
replace('Inbox confirmed. You can publish when the voice test is complete.',
  'Inbox confirmed. You can publish once the receptionist test and page approval are complete.');
replace("[!a.voiceReviewed,a.agentReady?'Test the updated booking voice':'Start a voice test booking','talk'],",
  "[!a.voiceReviewed,'Test the receptionist by chat or voice','eveMessage'],");
replace("if(target==='talk')void chooseEveMode('test').then(()=>$(target).focus({preventScroll:true}));",
  "if(target==='eveMessage')void chooseEveMode('test').then(()=>$(target).focus({preventScroll:true}));");
replace('I reviewed the page preview and voice', 'I reviewed the page preview and tested the receptionist');

const module = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
if (!module) throw Error('Could not validate the setup code. No files were changed.');
execFileSync(process.execPath, ['--input-type=module', '--check'], {
  input: module, stdio: ['pipe', 'inherit', 'inherit']
});
if (check) {
  console.log('Owner text and reconnect checks passed. assistant-setup/index.html would change.');
} else {
  const backup = mkdtempSync(join(tmpdir(), 'eden-owner-text-and-reconnect-'));
  writeFileSync(join(backup, 'index.html'), before);
  if (readFileSync(file, 'utf8') !== before) throw Error('The setup file changed. Run the installer again.');
  const temporary = file + '.eden-' + process.pid;
  writeFileSync(temporary, html, { flag: 'wx' });
  try { renameSync(temporary, file); }
  finally { rmSync(temporary, { force: true }); }
  console.log('Owner text and reconnect installed. Backup: ' + backup);
}
