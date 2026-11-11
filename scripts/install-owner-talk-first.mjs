import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const check = args.includes('--check');
const [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview')] = args.filter(arg => arg !== '--check');
const marker = 'Eden Workspace interview first v1';

function replace(source, from, to) {
  if (source.split(from).length !== 2) throw Error('Unexpected setup version near ' + from.slice(0, 100));
  return source.replace(from, () => to);
}

function updateWorker(source) {
  if (source.includes(marker)) return source;
  if (!source.includes('Eden Workspace Worker redirects v1')) throw Error('Install the Workspace launch fix first.');
  const ownerInterviewStart = "if(action==='owner-interview'&&request.method==='POST'){";
  const ownerInterviewEnd = "if(action==='voice-reviewed'";
  const start = source.indexOf(ownerInterviewStart);
  const end = source.indexOf(ownerInterviewEnd, start);
  if (start < 0 || end < 0) throw Error('Could not find the existing Eve interview route.');
  const ownerInterview = source.slice(start, end);
  const issueStart = ownerInterview.indexOf('  if(!env.SELF_SERVE_ELEVENLABS_KEY)');
  if (issueStart < 0) throw Error('Could not find the existing Eve session issuer.');
  const issuer = replace(ownerInterview.slice(issueStart), "'owner-interview:'+id", 'bucket');
  source = replace(source, ownerInterview, `if(action==='owner-interview'&&request.method==='POST'){
  if(a.status==='published')return json({error:'Edit clinic details in your setup.'},409);
  const scope=await findWorkspaceScope(env,'assistant_id',id);
  return issueOwnerInterview(env,scope?workspaceInterviewBucket(scope.account_id,scope.location_id):'owner-interview:'+id);
}
`);
  const handlers = `// ${marker}
const workspaceInterviewBucket=(accountId,locationId)=>'workspace-interview:'+accountId+':'+locationId;
async function startWorkspaceInterview(request,env){
  if(!allowPost(request))return json({error:'Open setup on this site.'},403);
  const session=await workspaceSession(request,env);
  if(!session)return json({error:'Open setup again from Clinic Workspace.'},401);
  const binding=await workspaceBinding(env,session);
  if(!binding||binding.assistant_id)return json({error:'Reload to open your saved setup.'},409);
  return issueOwnerInterview(env,workspaceInterviewBucket(session.accountId,session.locationId));
}
async function issueOwnerInterview(env,bucket){
${issuer}
`;
  source = replace(source, 'async function ownerInterviewAgent(env){', handlers + 'async function ownerInterviewAgent(env){');
  const route = "if(path==='/api/assistants/workspace-session'&&request.method==='POST')";
  source = replace(source, route, "if(path==='/api/assistants/workspace-interview'&&request.method==='POST')return await startWorkspaceInterview(request,env);" + route);
  source = replace(source, '--plate-left-angle:-.25deg;--plate-center-angle:.15deg;--plate-right-angle:.2deg',
    '--plate-left-angle:-.25deg;--plate-center-angle:0deg;--plate-right-angle:.2deg');
  return replace(source, 'left:44.1%;top:76.2%;width:18.2%;height:10.6%;--plate-center-angle:1.5deg;',
    'left:44.1%;top:76.2%;width:18.2%;height:10.6%;');
}

function updatePage(source) {
  if (source.includes(marker)) return source;
  const changes = [
    ['<section id="screen-create"><h2>', '<section id="screen-create" hidden><h2 id="chooseStyle">'],
    ['<h2>Tell us about your clinic.</h2>', '<h2 id="createClinicDetails">Tell us about your clinic.</h2>'],
    ['<h3>Talk to your AI receptionist</h3>', '<h3 id="eveHeading">Talk to your AI receptionist</h3>'],
    ['<p>Test a patient booking or give Eve the details she needs to set up your clinic.</p>',
      '<p id="eveIntro">Test a patient booking or give Eve the details she needs to set up your clinic.</p>'],
    ['<button class="btn light" id="voiceUpgrade"', '<button class="btn light" id="eveContinueToStyle" type="button" hidden>Continue to styles</button>\n<button class="btn light" id="voiceUpgrade"'],
    ["const invitationSteps=[['Choose','templates'],['Clinic','clinic'],['Talk',null],['Alert',null],['Publish',null]];",
      `// ${marker}
const invitationSteps=[['Choose','chooseStyle'],['Clinic','createClinicDetails'],['Talk',null],['Alert',null],['Publish',null]];
const workspaceCreateSteps=[['Talk','talkStep'],['Choose','chooseStyle'],['Clinic','createClinicDetails'],['Alert',null],['Publish',null]];
const stepsFor=screen=>screen==='screen-manage'?draftSteps:useWorkspace?workspaceCreateSteps:invitationSteps;
let workspaceIntake=false;`],
    ["const current=screen==='screen-manage'?draftSteps:invitationSteps;", 'const current=stepsFor(screen);'],
    ['const target=(id?draftSteps:invitationSteps)[n-1]?.[1];', 'const target=stepsFor(screen)[n-1]?.[1];'],
    ["  $('ownerHeroStart').hidden=screen==='screen-no-invite';\n  $('ownerHeroStart').textContent=screen==='screen-create'?'Choose your style':'Continue setup';",
      `  const startWithEve=screen==='screen-create'&&useWorkspace;
  if(startWithEve!==workspaceIntake){
    workspaceIntake=startWithEve;
    if(workspaceIntake)$('chooseStyle').before($('talkStep'));
    else $('manageIntro').after($('talkStep'));
    selectedEveMode=workspaceIntake?'interview':'test';
    $('eveHeading').textContent=workspaceIntake?'Set up your AI receptionist with Eve':'Talk to your AI receptionist';
    $('eveIntro').textContent=workspaceIntake
      ?'Tell Eve your opening hours, services, and how you handle bookings. She’ll fill those details into your form for you to review.'
      :'Test a patient booking or give Eve the details she needs to set up your clinic.';
    showEveModeConversation();
    syncEveControls();
  }
  $('ownerHeroStart').hidden=screen==='screen-no-invite';
  $('ownerHeroStart').textContent=startWithEve?'Set up with Eve':screen==='screen-create'?'Choose your style':'Continue setup';`],
    ["$('create').onclick=async()=>{if(!invite&&!useWorkspace)", "$('create').onclick=async()=>{if(eveBusy)return;if(!invite&&!useWorkspace)"],
    ["$('create').disabled=true;status('createStatus','Creating your clinic page…');", "$('create').disabled=true;syncEveControls();status('createStatus','Creating your clinic page…');"],
    ["if(!useWorkspace)location.hash=id+'.'+key;await reload();view('screen-manage');activeStep=1;view('screen-manage');",
      `if(!useWorkspace)location.hash=id+'.'+key;
    if(workspaceIntake){
      await endEve().catch(()=>{});
      interviewHistory.length=0;
      priorEveDraft.clear();
      $('eveDraftReview').hidden=true;
      $('eveDraftFields').replaceChildren();
      $('eveMessage').value='';
      status('voiceStatus','');
    }
    await reload();activeStep=1;view('screen-manage');`],
    ["finally{$('create').disabled=false}};", "finally{$('create').disabled=false;syncEveControls()}};"],
    ["input:'editHours',max:160", "input:'editHours',createInput:'hours',max:160"],
    ["input:'editServices',max:700", "input:'editServices',createInput:'services',max:700"],
    ["input:'editBooking',max:11", "input:'editBooking',createInput:'booking',max:11"],
    ["const canInterview=()=>Boolean(assistant&&assistant.status!=='published');",
      "const canInterview=()=>workspaceIntake||Boolean(assistant&&assistant.status!=='published');\nconst eveUnavailable=()=>$('create').disabled||eveBusy;"],
    ["(settingUp?'Start clinic setup':'Start voice test booking')",
      "(settingUp?(workspaceIntake?'Start voice interview':'Start clinic setup'):'Start voice test booking')"],
    ["  $('talk').disabled=eveBusy;\n  $('evePracticeMode').disabled=eveBusy;\n  $('eveSetupMode').disabled=eveBusy||!canInterview();",
      `  $('talk').disabled=eveUnavailable();
  $('eveModes').hidden=workspaceIntake;
  $('eveContinueToStyle').hidden=!workspaceIntake;
  $('evePracticeMode').disabled=eveUnavailable()||workspaceIntake;
  $('eveSetupMode').disabled=eveUnavailable()||!canInterview();`],
    ["  $('eveMessage').disabled=$('eveSend').disabled=eveBusy||", "  $('eveMessage').disabled=$('eveSend').disabled=eveUnavailable()||"],
    ["for(const {key,label,input,max} of interviewFields)", "for(const {key,label,input,createInput,max} of interviewFields)"],
    ['checkbox.dataset.field=input;', 'checkbox.dataset.field=workspaceIntake?createInput:input;'],
    ["const previous=priorEveDraft.get(field.id)??(assistant[choice.dataset.key]||'');",
      "const original=workspaceIntake?(field.id==='booking'?'request':''):(assistant?.[choice.dataset.key]||'');\n    const previous=priorEveDraft.get(field.id)??original;"],
    ["if(field.id==='editServices')refreshEditFeatured();", "if(field.id==='editServices')refreshEditFeatured();\n  if(field.id==='services')refreshFeatured();"],
    ['  if(!assistant.agentReady){', '  if(!interviewing&&!assistant.agentReady){'],
    ["  const result=await api('/api/assistants/'+id+'/'+(interviewing?'owner-interview':'signed-url'),{method:'POST',body:'{}'});",
      `  const endpoint=workspaceIntake?'/api/assistants/workspace-interview':'/api/assistants/'+id+'/'+(interviewing?'owner-interview':'signed-url');
  const result=await api(endpoint,{method:'POST',body:'{}'});`],
    ['interviewFields.map(({key,input})=>[key,$(input).value])',
      'interviewFields.map(({key,input,createInput})=>[key,$(workspaceIntake?createInput:input).value])'],
    ['async function runEveConversation(mode){\n  if(eveBusy)return;',
      'async function runEveConversation(mode){\n  if(eveUnavailable())return;'],
    ['if(eveBusy||!message||(!session', 'if(eveUnavailable()||!message||(!session'],
    ["$('eveApplyDraft').onclick=()=>{", "$('eveContinueToStyle').onclick=()=>step(2);\n$('eveApplyDraft').onclick=()=>{"],
    ["  selected.forEach(copyEveField);\n  status('editStatus'",
      `  selected.forEach(copyEveField);
  if(workspaceIntake){
    status('eveDraftStatus','Details added to the clinic form. You can review or edit them in step 3.');
    step(2);
    $('chooseStyle').focus({preventScroll:true});
    return;
  }
  status('editStatus'`],
    ['<h2 id="chooseStyle">', '<h2 id="chooseStyle" tabindex="-1">'],
    ['</style></head><body>', '#eveModes[hidden]{display:none}\n#chooseStyle,#createClinicDetails{scroll-margin-top:100px}\n</style></head><body>']
  ];
  for (const [from, to] of changes) source = replace(source, from, to);
  return source;
}

const files = [
  ['assistant-core.js', updateWorker],
  ['assistant-setup/index.html', updatePage]
].map(([path, update]) => {
  const before = readFileSync(join(root, path), 'utf8');
  return {path, before, after: update(before)};
});
const validate = (code, label) => {
  try {
    execFileSync(process.execPath, ['--check', '--input-type=module'], {input: code, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']});
  } catch {
    throw Error('Updated ' + label + ' failed JavaScript syntax validation.');
  }
};
validate(files[0].after, files[0].path);
const pageScript = files[1].after.match(/<script type="module">([\s\S]+?)<\/script>/)?.[1];
if (!pageScript) throw Error('Could not find the setup page script.');
validate(pageScript, files[1].path);
const changed = files.filter(file => file.before !== file.after);
if (check || !changed.length) {
  console.log('Talk-first setup check passed. ' + changed.length + ' file(s) would change.');
} else {
  const backup = mkdtempSync(join(tmpdir(), 'eden-owner-talk-first-'));
  for (const {path, before} of changed) {
    if (readFileSync(join(root, path), 'utf8') !== before) throw Error('Setup changed during the update. Run the installer again.');
    mkdirSync(dirname(join(backup, path)), {recursive: true});
    writeFileSync(join(backup, path), before);
  }
  try {
    for (const {path, after} of changed) writeFileSync(join(root, path), after);
  } catch (error) {
    for (const {path, before} of changed) writeFileSync(join(root, path), before);
    throw error;
  }
  console.log('Talk-first setup and Bilingual sign alignment installed. Backup: ' + backup);
}
