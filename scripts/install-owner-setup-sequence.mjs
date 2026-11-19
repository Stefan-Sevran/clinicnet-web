import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const check = args.includes('--check');
const [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview')] = args.filter(arg => arg !== '--check');
const marker = 'Eden owner setup sequence v1';

function replace(source, from, to) {
  if (source.split(from).length !== 2) throw Error('Unexpected setup version near ' + from.slice(0, 100));
  return source.replace(from, () => to);
}

function updateWorker(source) {
  const changes = [
    ['async function create(request,env){',
      `// ${marker}
function confirmedContact(input) {
  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
  const mapsUrl = typeof input.mapsUrl === 'string' ? input.mapsUrl.trim() : '';
  if ((input.phone != null && typeof input.phone !== 'string') ||
      (input.mapsUrl != null && typeof input.mapsUrl !== 'string') ||
      phone.length > 20 || mapsUrl.length > 500 ||
      !validClinicPhone(phone) || !validClinicMap(mapsUrl) ||
      ((phone || mapsUrl) && input.confirmed !== true)) return null;
  return {phone,mapsUrl};
}

async function create(request,env){`],
    ["    return json({error:'Check clinic details and page address.'},400);\n  const lang=",
      `    return json({error:'Check clinic details and page address.'},400);
  const contact=confirmedContact(x);
  if(!contact)return json({error:'Check and confirm the public clinic phone and Google Maps link.'},400);
  const lang=`],
    ["lang,x.template,mode,(x.featuredService||'').trim()||null,stamp,stamp];",
      "lang,x.template,mode,(x.featuredService||'').trim()||null,contact.phone||null,contact.mapsUrl||null,stamp,stamp];"],
    ['booking_mode,featured_service,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?',
      'booking_mode,featured_service,phone,maps_url,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?'],
    ["const phone=String(x.phone||'').trim(),mapsUrl=String(x.mapsUrl||'').trim();if(phone.length>20||mapsUrl.length>500||!validClinicPhone(phone)||!validClinicMap(mapsUrl)||x.confirmed!==true)",
      'const contact=confirmedContact(x);if(!contact||x.confirmed!==true)'],
    ["then confirm them.'},400);await env.PILOT_DB.prepare('UPDATE clinic_assistants SET phone=",
      "then confirm them.'},400);const {phone,mapsUrl}=contact;await env.PILOT_DB.prepare('UPDATE clinic_assistants SET phone="]
  ];
  for (const [from,to] of changes) source = replace(source,from,to);
  return source;
}

function updatePage(source) {
  const changes = [
    ['<button type="button" id="p2">2 Clinic</button><button type="button" id="p3">3 Talk</button>',
      '<button type="button" id="p2">2 Talk</button><button type="button" id="p3">3 Clinic facts</button>'],
    ['<h2 id="chooseStyle" tabindex="-1">', '<h2 id="createChooseStyle" tabindex="-1">'],
    ['<h2 id="createClinicDetails">Tell us about your clinic.</h2>', '<h2 id="createClinicDetails" tabindex="-1">Clinic facts</h2>'],
    ['<div class="actions"><button class="btn" id="create">Create my assistant</button></div><p id="createStatus" class="status" role="status"></p></section>',
      '<div class="actions" id="saveCreateFacts"><button type="button" class="btn" id="create">Save clinic facts and continue</button></div><p id="createStatus" class="status" role="status"></p><div id="createLaterSteps"></div></section>'],
    ['<h3>Clinic details and style</h3>', '<h3>Clinic facts</h3>'],
    ['<p id="editStatus" class="status" role="status"></p></div>', '<p id="editStatus" class="status" role="status"></p><div id="clinicContactSlot"></div></div>'],
    ['<button class="btn light" id="eveContinueToStyle" type="button" hidden>Continue to styles</button>\n', ''],
    ["  $('eveContinueToStyle').hidden=!workspaceIntake;\n", ''],
    ["$('eveContinueToStyle').onclick=()=>step(2);\n", ''],
    ['<div class="card" id="alertStep"><h3>2 · Test your email alert</h3>',
      '<div class="card" id="alertStep"><h3 id="alertHeading" tabindex="-1">4 · Test your email alert</h3><p id="alertDraftHint" hidden>Save your clinic facts to send a test email.</p>'],
    ['<div class="fields" style="margin-top:18px"><label class="field"><span>Code from the test email</span>',
      '<div id="alertVerification"><div class="fields" style="margin-top:18px"><label class="field"><span>Code from the test email</span>'],
    ['<p id="alertStatus" class="status" role="status"></p></div><div class="card"><h3>3 · Clinic contact links</h3><p>Add your official phone and Google Maps link.</p>',
      '<p id="alertStatus" class="status" role="status"></p></div></div><section id="clinicContact" class="clinic-contact" aria-labelledby="clinicContactHeading"><h4 id="clinicContactHeading">Public contact links</h4><p>Add the official phone number and Google Maps link for the Call and Find us buttons on your public page.</p>'],
    ['<span>Clinic phone, with country code</span>', '<span>Clinic phone with country code (optional)</span>'],
    ['<span>Google Maps link</span><input id="clinicMap"', '<span>Google Maps link (optional)</span><input id="clinicMap"'],
    ['<p id="contactStatus" class="status" role="status"></p></div>', '<p id="contactStatus" class="status" role="status"></p></section>'],
    ['<h3>4 · Review your page</h3>', '<h3>Review your page</h3>'],
    ['<div class="card" id="publishStep"><h3>5 · Publish</h3><div class="check">',
      '<div class="card" id="publishStep"><h3>5 · Publish</h3><p id="publishDraftHint" hidden>Save your clinic facts to preview your page. Then complete a test booking, confirm the clinic inbox, and approve the page to publish.</p><div id="publishReadiness"><div class="check">'],
    ['<p>Complete the checks above to publish your clinic page.</p><button class="btn" id="publish"',
      '<p>Complete the checks above to publish your clinic page.</p></div><button class="btn" id="publish"'],
    ["const draftSteps=[['Talk','talkStep'],['Choose','manageChoose'],['Clinic','editDetails'],['Alert','alertStep'],['Publish','publishStep']];\n// Eden Workspace interview first v1\nconst invitationSteps=[['Choose','chooseStyle'],['Clinic','createClinicDetails'],['Talk',null],['Alert',null],['Publish',null]];\nconst workspaceCreateSteps=[['Talk','talkStep'],['Choose','chooseStyle'],['Clinic','createClinicDetails'],['Alert',null],['Publish',null]];\nconst stepsFor=screen=>screen==='screen-manage'?draftSteps:useWorkspace?workspaceCreateSteps:invitationSteps;",
      `// Eden Workspace interview first v1
// ${marker}
const draftSteps=[['Choose','manageChoose'],['Talk','talkStep'],['Clinic facts','editDetails'],['Alert','alertStep'],['Publish','pageReview']];
const createSteps=[['Choose','createChooseStyle'],['Talk',useWorkspace?'talkStep':null],['Clinic facts','createClinicDetails'],['Alert','alertStep'],['Publish','publishStep']];
const stepsFor=screen=>screen==='screen-manage'?draftSteps:createSteps;
let currentScreen='screen-no-invite';`],
    ["  const screen=id?'screen-manage':'screen-create';", '  const screen=currentScreen;'],
    ["  for(const section of ['screen-create','screen-manage','screen-no-invite'])$(section).hidden=section!==screen;",
      `  currentScreen=screen;
  for(const section of ['screen-create','screen-manage','screen-no-invite'])$(section).hidden=section!==screen;
  const creating=screen==='screen-create';
  if(creating){
    $('saveCreateFacts').before($('clinicContact'));
    $('createLaterSteps').append($('alertStep'),$('publishStep'));
  }else{
    $('clinicContactSlot').append($('clinicContact'));
    $('pageReview').before($('alertStep'));
    $('pageReview').after($('publishStep'));
  }
  $('saveContact').hidden=creating;
  $('alertDraftHint').hidden=$('publishDraftHint').hidden=!creating;
  $('alertVerification').hidden=$('publishReadiness').hidden=creating;
  $('sendTestEmail').disabled=creating;
  if(creating)$('publish').disabled=true;`],
    ["    if(workspaceIntake)$('chooseStyle').before($('talkStep'));\n    else $('manageIntro').after($('talkStep'));",
      "    if(workspaceIntake)$('createClinicDetails').before($('talkStep'));\n    else $('manageChoose').after($('talkStep'));"],
    ["  $('ownerHeroStart').textContent=startWithEve?'Set up with Eve':screen==='screen-create'?'Choose your style':'Continue setup';",
      "  $('ownerHeroStart').textContent=creating?'Choose your style':'Continue setup';"],
    ["    step(2);\n    $('chooseStyle').focus({preventScroll:true});",
      "    step(3);\n    $('createClinicDetails').focus({preventScroll:true});"],
    ["  $('editDetails').scrollIntoView({block:'start',behavior:'smooth'});\n  $(selected[0].dataset.field).focus",
      "  step(3);\n  $(selected[0].dataset.field).focus"],
    ["#chooseStyle,#createClinicDetails{scroll-margin-top:100px}",
      `#createChooseStyle,#createClinicDetails,#alertStep,#publishStep,#pageReview{scroll-margin-top:100px}
.clinic-contact{margin:24px 0}
.clinic-contact h4{margin:0 0 8px}
.clinic-contact .check{margin-top:12px}`]
  ];
  for (const [from,to] of changes) source = replace(source,from,to);
  const anchor = '<p id="manageIntro" class="intro"></p>';
  const talk = source.indexOf('<div class="card" id="talkStep">',source.indexOf(anchor));
  const choose = source.indexOf('<!-- Eden visual choice v7 -->',talk);
  const facts = source.indexOf('<div class="card" id="editDetails">',choose);
  if (talk < 0 || choose <= talk || facts <= choose) throw Error('Could not find the saved setup steps.');
  source = source.slice(0,talk) + source.slice(choose,facts) + source.slice(talk,choose) + source.slice(facts);

  const start = source.indexOf("$('create').onclick=async()=>");
  const end = source.indexOf('async function generateOwnerWall(){',start);
  if (start < 0 || end <= start) throw Error('Could not find the clinic facts submission.');
  return source.slice(0,start) + `$('create').onclick=async()=>{
  if(eveBusy)return;
  if(!invite&&!useWorkspace){status('createStatus','Open setup from Clinic Workspace.',true);return}
  const button=$('create');
  button.disabled=true;
  syncEveControls();
  status('createStatus','Saving your clinic facts…');
  try{
    if(!id){
      const x={
        invite:useWorkspace?undefined:invite,workspace:useWorkspace,template,
        clinic:$('clinic').value.trim(),city:$('city').value.trim(),slug:$('slug').value.trim(),
        hours:$('hours').value.trim(),services:$('services').value.trim(),featuredService:$('featured').value,
        language:$('language').value,bookingMode:$('booking').value,
        phone:$('clinicPhone').value.trim(),mapsUrl:$('clinicMap').value.trim(),confirmed:$('confirmContact').checked
      };
      const result=await api('/api/assistants',{method:'POST',body:JSON.stringify(x)});
      id=result.id;
      key=result.key;
      sessionStorage.removeItem('edenInvite');
      if(!useWorkspace)location.hash=id+'.'+key;
      if(workspaceIntake){
        await endEve().catch(()=>{});
        interviewHistory.length=0;
        priorEveDraft.clear();
        $('eveDraftReview').hidden=true;
        $('eveDraftFields').replaceChildren();
        $('eveMessage').value='';
        status('voiceStatus','');
      }
    }
    await reload();
    activeStep=4;
    view('screen-manage');
    step(4);
    $('alertHeading').focus({preventScroll:true});
  }catch(error){status('createStatus',error.message,true)}
  finally{button.disabled=false;syncEveControls()}
};
` + source.slice(end);
}

const files = [
  ['assistant-core.js', updateWorker],
  ['assistant-setup/index.html', updatePage]
].map(([path, update]) => {
  const before = readFileSync(join(root, path), 'utf8');
  if (!before.includes('Eden Workspace interview first v1')) throw Error('Install the previous Workspace interview update first.');
  return {path, before, after: before.includes(marker) ? before : update(before)};
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
  console.log('Setup sequence check passed. ' + changed.length + ' file(s) would change.');
} else {
  const backup = mkdtempSync(join(tmpdir(), 'eden-owner-setup-sequence-'));
  for (const {path, before} of changed) {
    if (readFileSync(join(root, path), 'utf8') !== before) throw Error('Setup changed during the update. Run the installer again.');
    mkdirSync(dirname(join(backup, path)), {recursive:true});
    writeFileSync(join(backup, path), before);
  }
  try {
    for (const {path, after} of changed) writeFileSync(join(root, path), after);
  } catch (error) {
    for (const {path, before} of changed) writeFileSync(join(root, path), before);
    throw error;
  }
  console.log('Setup sequence and contact fields installed. Backup: ' + backup);
}
