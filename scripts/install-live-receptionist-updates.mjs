import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: { check }, positionals: [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview'), ...rest] } =
  parseArgs({ allowPositionals: true, options: { check: { type: 'boolean' } } });
if (rest.length) throw Error('Pass one voice-preview folder, optionally followed by --check.');

const marker = 'Eden live receptionist updates v1';
function replace(source, from, to) {
  if (source.split(from).length !== 2) throw Error('Unexpected setup version near ' + from.slice(0, 105) + '. No files were changed.');
  return source.replace(from, () => to);
}

function addContactToDetailsUpdate(handler) {
  const preparedUpdates = /([.]prepare\(\s*)(["'`])(\s*UPDATE\s+clinic_assistants\s+SET\s+)((?:\\[\s\S]|(?!\2)[^\\])*)\2(\s*\)\s*[.]bind\(\s*)/gi;
  const detailsUpdates = [...handler.matchAll(preparedUpdates)].filter(([, , , , sql]) =>
    /\bclinic\s*=\s*\?/i.test(sql) && /\bagent_id\s*=\s*\?/i.test(sql) && /\bhero_key\s*=/i.test(sql)
  );
  if (detailsUpdates.length !== 1) {
    throw Error('Could not identify the clinic facts database update. No files were changed.');
  }
  const [original, prepare, quote, prefix, sql, bind] = detailsUpdates[0];
  // Match the SET columns so Worker versions can keep their original WHERE and bind order.
  const fields = 'phone=CASE WHEN ? THEN ? ELSE phone END,maps_url=CASE WHEN ? THEN ? ELSE maps_url END,';
  const values = 'contact?1:0,next.phone??null,contact?1:0,next.maps_url??null,';
  return replace(handler, original, prepare + quote + prefix + fields + sql + quote + bind + values);
}

function updateWorker(source) {
  if (source.includes(marker)) return source;
  const start = source.indexOf(' const x=input.styleOnly===true?{');
  const end = source.indexOf('return json(ownerView({...next,updated_at:stamp,agent_id:agentId', start);
  if (start < 0 || end < start || !source.includes('function normalizeClinicContact(')) {
    throw Error('Could not locate the clinic facts and contact handlers. No files were changed.');
  }
  const original = source.slice(start, end);
  let handler = original;
  handler = replace(handler, ' const issue=clinicFactIssue(x);\n if(issue)return json(issue,400);', ` /* ${marker} */
 const issue=clinicFactIssue(x);
 if(issue)return json(issue,400);
 const updatingLive=input.liveUpdate===true;
 if(updatingLive){
   if(a.status!=='published'||input.styleOnly===true)return json({error:'Only a published receptionist can be updated here.'},409);
   if(input.revision!==a.updated_at)return json({error:'This receptionist changed in another tab. Reopen setup and check the current details before saving.'},409);
   if(x.slug.trim()!==a.slug||x.template!==a.template)return json({error:'Use the current public page address and style when saving live details.'},400);
 }
 let contact;
 if(updatingLive&&Object.hasOwn(input,'contact')){
   if(!input.contact||typeof input.contact!=='object'||Array.isArray(input.contact))
     return json({error:'Check the public contact links.'},400);
   contact=normalizeClinicContact(input.contact,true);
   if(contact.error)return json(contact,400);
 }`);
  handler = replace(handler, ' const voiceChanged=', ` if(contact){
   next.phone=contact.phone||null;
   next.maps_url=contact.mapsUrl||null;
 }
 const voiceChanged=`);
  handler = replace(handler, ' const newScene=next.clinic!==a.clinic||next.template!==a.template;',
    ' const newScene=!updatingLive&&(next.clinic!==a.clinic||next.template!==a.template);');
  handler = addContactToDetailsUpdate(handler);
  source = replace(source, original, handler);
  const approval = "if(action==='review'&&request.method==='POST'){";
  return replace(source, approval, approval + "if(a.status==='published')return json({error:'This page is already live. Update your clinic facts from setup.'},409);");
}

function updatePage(source) {
  if (source.includes(marker)) return source;
  if (!source.includes('Eden owner text and reconnect v1')) throw Error('Install the owner text and reconnect update first.');
  const patch = (from, to) => { source = replace(source, from, to); };
  patch('<!-- Eden owner text and reconnect v1 -->', '<!-- Eden owner text and reconnect v1 --><!-- '+marker+' -->');
  patch('<h3>5 · Publish</h3>', '<h3 id="publishTitle">5 · Publish</h3>');
  patch('<label class="check"><input type="checkbox" id="approveCheck">',
    '<div id="publicationApproval"><label class="check"><input type="checkbox" id="approveCheck">');
  patch('<p id="approvalStatus" class="status" role="status"></p></div><div class="card" id="publishStep">',
    '<p id="approvalStatus" class="status" role="status"></p></div></div><div class="card" id="publishStep">');
  patch(`<button type="button" class="btn light" id="liveConversationUpgrade" hidden>Update live chat and voice</button>
<p id="liveConversationStatus" class="status" role="status"></p>`, `<div id="livePageEditor" hidden>
  <p>Save changes to your clinic facts and public contact links on your live page.</p>
  <button type="button" class="btn" id="saveLiveReceptionist">Update live receptionist</button>
  <p id="livePageStatus" class="status" role="status"></p>
</div>`);
  patch('<h3>Clinic facts</h3><p>Adjust these before publication. After changing the clinic name or style, review the wall again.</p>',
    '<h3>Clinic facts</h3><p id="editDetailsHelp">Adjust these before publication. After changing the clinic name or style, review the wall again.</p>');
  patch('<p id="editStatus" class="status" role="status"></p>',
    '<p id="editStatus" class="status" role="status"></p><p id="liveEditShortcut" hidden><a href="#saveLiveReceptionist">Go to Update live receptionist ↓</a></p>');
  patch("const draftSteps=[['Choose','manageChoose'],['Talk','talkStep'],['Clinic facts','editDetails'],['Alert','alertStep'],['Publish','pageReview']];",
    "const draftSteps=[['Choose','manageChoose'],['Talk','talkStep'],['Clinic facts','editDetails'],['Alert','alertStep'],['Publish','pageReview']];\nconst liveSteps=[...draftSteps.slice(0,-1),['Live page','publishStep']];");
  patch("const stepsFor=screen=>screen==='screen-manage'?draftSteps:createSteps;",
    "const stepsFor=screen=>screen==='screen-manage'?(assistant?.status==='published'?liveSteps:draftSteps):createSteps;");
  patch(";$('liveConversationUpgrade').hidden=a.bookingMode!=='request'", '');
  const upgradeStart = source.indexOf("$('liveConversationUpgrade').onclick=async()=>{");
  const upgradeEnd = source.indexOf("$('behaviorUpgrade').onclick=", upgradeStart);
  if (upgradeStart < 0 || upgradeEnd < 0) throw Error('Could not locate the previous live update button.');
  patch(source.slice(upgradeStart, upgradeEnd), '');
  patch(`function renderApproval(){
  const a=assistant;
  $('retakeClinicInterview').hidden=!canInterview();`, `function renderApproval(){
  const a=assistant;
  const published=a.status==='published';
  $('publicationApproval').hidden=published;
  $('publishReadiness').hidden=published;
  $('publish').hidden=published;
  $('publishTitle').textContent=published?'5 · Live page':'5 · Publish';
  $('livePageEditor').hidden=!published;
  $('liveEditShortcut').hidden=!published;
  $('saveDetails').hidden=published;
  $('saveContact').hidden=published;
  $('editSlug').readOnly=published;
  $('editTemplate').disabled=published;
  $('editDetailsHelp').textContent=published
    ?'Edit your clinic facts and contact links here, then select Update live receptionist.'
    :'Adjust these before publication. After changing the clinic name or style, review the wall again.';
  $('retakeClinicInterview').hidden=!canInterview();
  if(published){
    $('publish').disabled=true;
    $('continuePageReview').hidden=true;
    renderProgress(currentScreen);
    return;
  }`);
  const approve = source.match(/\$\('approvePage'\)\.onclick=async\(\)=>\{[^\n]+/g);
  if (!approve || approve.length !== 1) throw Error('Could not locate page approval.');
  patch(approve[0], `$('approvePage').onclick=async()=>{
  if(!assistant||assistant.status==='published'||$('pagePreviewFrame').hidden)return;
  try{
    $('approvePage').disabled=true;
    await api('/api/assistants/'+id+'/review',{method:'POST',body:JSON.stringify({approved:$('approveCheck').checked,deskSigns:assistant.deskSigns||null})});
    assistant=await api('/api/assistants/'+id);
    renderManage();
    if(assistant.status!=='published')status('approvalStatus','Page approved. You can publish now.');
  }catch(error){
    if(error.status===409){
      try{
        assistant=await api('/api/assistants/'+id);
        $('approveCheck').checked=false;
        renderManage();
        if(assistant.status==='published'){
          status('livePageStatus','Your receptionist is already live. You can update it from this page.');
          return;
        }
        void loadMobilePreview(true);
        status('approvalStatus','The setup changed. Check the refreshed preview and approve it again.',true);
        return;
      }catch(refreshError){error=refreshError}
    }
    status('approvalStatus',error.message,true);
    renderApproval();
  }
};`);
  patch(`for(const id of ['create','saveDetails','saveContact','chooseStyle','sendTestEmail','confirmEmail','approvePage','publish']){`, `const liveFields=[
  ['clinic','editClinic'],['city','editCity'],['hours','editHours'],['services','editServices'],
  ['featuredService','editFeatured'],['language','editLanguage'],['bookingMode','editBooking']
];
function liveContactValues(){
  return {
    phone:$('clinicPhone').value.trim(),
    mapsUrl:$('clinicMap').value.trim()
  };
}
for(const field of ['clinicPhone','clinicMap'])$(field).addEventListener('input',()=>{
  if(assistant?.status==='published')$('confirmContact').checked=false;
});
$('saveLiveReceptionist').onclick=async()=>{
  const current=assistant;
  if(current?.status!=='published')return;
  const facts=Object.fromEntries(liveFields.map(([key,input])=>[key,$(input).value.trim()]));
  const contact=liveContactValues();
  const phone=contact.phone.replace(/[ ()-]/g,'')||contact.phone;
  const contactChanged=phone!==(current.phone||'')||contact.mapsUrl!==(current.mapsUrl||'');
  if(!contactChanged&&Object.entries(facts).every(([key,value])=>value===(current[key]||''))){
    status('livePageStatus','Your live receptionist is up to date.');
    return;
  }
  const payload={...facts,slug:current.slug,template:current.template,liveUpdate:true,revision:current.wallRevision};
  if(contactChanged)payload.contact={...contact,confirmed:$('confirmContact').checked};
  const controls=[...liveFields.map(([,key])=>$(key)),$('clinicPhone'),$('clinicMap'),$('confirmContact')];
  const disabled=controls.map(field=>field.disabled);
  controls.forEach(field=>field.disabled=true);
  status('livePageStatus','Updating your live receptionist…');
  try{
    assistant=await api('/api/assistants/'+id+'/details',{method:'POST',body:JSON.stringify(payload)});
    renderManage();
    populateDetails();
    $('confirmContact').checked=false;
    status('livePageStatus','Live receptionist updated. Refresh the public page to see your changes.');
  }catch(error){
    controls.forEach((field,index)=>field.disabled=disabled[index]);
    showFieldIssue('livePageStatus',error,{...editFieldIds,...contactFieldIds});
  }finally{
    controls.forEach((field,index)=>field.disabled=disabled[index]);
  }
};

for(const id of ['create','saveDetails','saveContact','chooseStyle','sendTestEmail','confirmEmail','approvePage','publish','saveLiveReceptionist']){`);
  return source;
}

const changes = [['assistant-core.js', updateWorker], ['assistant-setup/index.html', updatePage]].map(([path, update]) => {
  const file = join(root, path);
  const before = readFileSync(file, 'utf8');
  return { path, file, before, after: update(before) };
}).filter(({before,after}) => before !== after);

for (const { path, after } of changes) {
  const module = path.endsWith('.html') ? after.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] : after;
  if (!module) throw Error('Could not validate the setup code. No files were changed.');
  execFileSync(process.execPath, ['--input-type=module', '--check'], {
    input: module, stdio: ['pipe', 'inherit', 'inherit']
  });
}
if (check || !changes.length) {
  console.log('Live receptionist update check passed. ' + changes.length + ' file(s) would change.');
} else {
  for (const { file, before } of changes) {
    if (readFileSync(file, 'utf8') !== before) throw Error('Setup files changed. Run the installer again.');
  }
  const backup = mkdtempSync(join(tmpdir(), 'eden-live-receptionist-update-'));
  const written = [];
  try {
    for (const entry of changes) {
      const { path, file, before, after } = entry;
      const saved = join(backup, path);
      mkdirSync(dirname(saved), { recursive: true });
      writeFileSync(saved, before);
      const temporary = file + '.eden-' + process.pid;
      writeFileSync(temporary, after, { flag: 'wx' });
      try { renameSync(temporary, file); written.push(entry); }
      finally { rmSync(temporary, { force: true }); }
    }
  } catch (error) {
    for (const { file, before } of written.reverse()) writeFileSync(file, before);
    throw error;
  }
  console.log('Live receptionist updates installed. Backup: ' + backup);
}
