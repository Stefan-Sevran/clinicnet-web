import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const check = args.includes('--check');
const [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview')] = args.filter(arg => arg !== '--check');
const marker = 'Eden owner setup polish v1';

function replace(source, from, to) {
  if (source.split(from).length !== 2) throw Error('Unexpected setup version near ' + from.slice(0, 100));
  return source.replace(from, () => to);
}

function updateWorker(source) {
  const changes = [
    [`function confirmedContact(input) {
  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
  const mapsUrl = typeof input.mapsUrl === 'string' ? input.mapsUrl.trim() : '';
  if ((input.phone != null && typeof input.phone !== 'string') ||
      (input.mapsUrl != null && typeof input.mapsUrl !== 'string') ||
      phone.length > 20 || mapsUrl.length > 500 ||
      !validClinicPhone(phone) || !validClinicMap(mapsUrl) ||
      ((phone || mapsUrl) && input.confirmed !== true)) return null;
  return {phone,mapsUrl};
}

`,
      `function clinicFactIssue(x) {
  if(!types.has(x.template))return {field:'template',error:'Choose a receptionist style in step 1.'};
  if(!value(x.clinic,2,70))return {field:'clinic',error:'Enter a clinic name of 2–70 characters.'};
  if(!value(x.city,2,80))return {field:'city',error:'Enter your city and country, up to 80 characters.'};
  if(typeof x.slug!=='string'||!validSlug(x.slug))return {field:'slug',error:'Use 3–49 lowercase letters, numbers or single hyphens. Start with a letter and end with a letter or number.'};
  if(!value(x.hours??'',0,160))return {field:'hours',error:'Use up to 160 characters for opening hours. Leave out angle brackets.'};
  if(!value(x.services,3,700)||!splitServices(x.services).length)return {field:'services',error:'Enter at least one approved service, using 3–700 characters and no angle brackets.'};
  if(!value(x.featuredService??'',0,80)||(x.featuredService?.trim()&&!splitServices(x.services).includes(x.featuredService.trim())))
    return {field:'featuredService',error:'Choose a featured service from your approved list, up to 80 characters.'};
  return null;
}
function normalizeClinicContact(input,requireConfirmation=false) {
  const phone=typeof input.phone==='string'?input.phone.trim().replace(/[ ()-]/g,''):'';
  const mapsUrl=typeof input.mapsUrl==='string'?input.mapsUrl.trim():'';
  if((input.phone!=null&&typeof input.phone!=='string')||(input.phone?.trim()&&!phone)||!validClinicPhone(phone))
    return {field:'phone',error:'Start with + and the country code, followed by the clinic number. Example +639171234567.'};
  if((input.mapsUrl!=null&&typeof input.mapsUrl!=='string')||mapsUrl.length>500||!validClinicMap(mapsUrl))
    return {field:'mapsUrl',error:'Paste a Google Maps link for your clinic, up to 500 characters.'};
  if((phone||mapsUrl||requireConfirmation)&&input.confirmed!==true)
    return {field:'confirmed',error:'Confirm that the public contact details belong to your clinic.'};
  return {phone,mapsUrl};
}

`],
    [`  if(!types.has(x.template)||!value(x.clinic,2,70)||!value(x.city,2,80)||!value(x.services,3,700)||
      !value(x.slug,3,50)||!validSlug(x.slug)||!value(x.hours||'',0,160)||!value(x.featuredService||'',0,80)||
      ((x.featuredService||'').trim()&&!splitServices(x.services).includes(x.featuredService.trim())))
    return json({error:'Check clinic details and page address.'},400);
  const contact=confirmedContact(x);
  if(!contact)return json({error:'Check and confirm the public clinic phone and Google Maps link.'},400);
`,
      `  if(!x||typeof x!=='object'||Array.isArray(x))return json({error:'Check your clinic facts.'},400);
  const issue=clinicFactIssue(x);
  if(issue)return json(issue,400);
  const contact=normalizeClinicContact(x);
  if(contact.error)return json(contact,400);
`],
    [` const input=await body(request);
 const x=input.styleOnly`,
      ` const input=await body(request);
 if(!input||typeof input!=='object'||Array.isArray(input))return json({error:'Check your clinic facts.'},400);
 const x=input.styleOnly`],
    ["Return to Workspace and select Open setup.",
      "Return to Workspace and select Set up AI receptionist."],
    [" if(!types.has(x.template)||!value(x.clinic,2,70)||!value(x.city,2,80)||!value(x.services,3,700)||!value(x.slug,3,50)||!validSlug(x.slug)||!value(x.hours||'',0,160)||!value(x.featuredService||'',0,80)||((x.featuredService||'').trim()&&!splitServices(x.services).includes(x.featuredService.trim())))return json({error:'Check the clinic details and page address.'},400);",
      ` const issue=clinicFactIssue(x);
 if(issue)return json(issue,400);`],
    ["    if(/UNIQUE|constraint/i.test(error.message||''))return json({error:'That page address is already taken. Choose another.'},409);",
      "    if(/UNIQUE|constraint/i.test(error.message||''))return json({field:'slug',error:'That page address is already taken. Choose another.'},409);"],
    [" }catch(e){if(/UNIQUE|constraint/i.test(e.message||''))return json({error:'That page address is already taken. Choose another.'},409);throw e}",
      " }catch(e){if(/UNIQUE|constraint/i.test(e.message||''))return json({field:'slug',error:'That page address is already taken. Choose another.'},409);throw e}"],
    ["if(action==='contact'&&request.method==='POST'){const x=await body(request);const contact=confirmedContact(x);if(!contact||x.confirmed!==true)return json({error:'Check the official phone and Google Maps link, then confirm them.'},400);const {phone,mapsUrl}=contact;await env.PILOT_DB.prepare('UPDATE clinic_assistants SET phone=?,maps_url=?,review_approved_at=NULL,updated_at=? WHERE id=?').bind(phone||null,mapsUrl||null,now(),id).run();return json({ok:true,phone,mapsUrl})}",
      `if(action==='contact'&&request.method==='POST'){
  const x=await body(request);
  if(!x||typeof x!=='object'||Array.isArray(x))return json({error:'Check your public contact details.'},400);
  const contact=normalizeClinicContact(x,true);
  if(contact.error)return json(contact,400);
  const {phone,mapsUrl}=contact;
  await env.PILOT_DB.prepare('UPDATE clinic_assistants SET phone=?,maps_url=?,review_approved_at=NULL,updated_at=? WHERE id=?').bind(phone||null,mapsUrl||null,now(),id).run();
  return json({ok:true,phone,mapsUrl});
}`],
    ["body.theme-pattaya.variant-original.has-photo-wall .sign-plate.center{left:44.3%;top:79.7%;width:18%;height:8.2%}",
      `/* Center the two lines on the photographed plaque and match its perspective. */
body.theme-pattaya.variant-original.has-photo-wall .sign-plate.center{
  left:43.7%;top:78.9%;width:19.1%;height:9%;
  display:grid;align-content:center;justify-items:center;
  transform-origin:center;
  transform:rotateZ(-1deg) perspective(100cqw) rotateY(20deg) scaleX(1.06);
}`],
    ["  left:44.1%;top:76.2%;width:18.2%;height:10.6%;",
      `  left:43.55%;top:74.7%;width:19.25%;height:13.2%;
  transform:perspective(80cqw) rotateY(28deg) scaleX(1.12);`],
  ];
  for (const [from,to] of changes) source = replace(source,from,to);
  return "// " + marker + "\n" + source;
}

function updatePage(source) {
  const changes = [
    ["Website chat → Open setup.",
      "Website chat → Set up AI receptionist."],
    ["Filipino here means Tagalog. Cebuano is not configured.",
      "Filipino here means Tagalog. Your AI receptionist does not yet speak Cebuano."],
    ["<select id=\"editLanguage\"></select>",
      "<select id=\"editLanguage\"></select><small>Filipino here means Tagalog. Your AI receptionist does not yet speak Cebuano.</small>"],
    ["id=\"clinicPhone\" type=\"tel\" inputmode=\"tel\" maxlength=\"20\" placeholder=\"+639171234567\">",
      "id=\"clinicPhone\" type=\"tel\" inputmode=\"tel\" maxlength=\"32\" placeholder=\"+639171234567\"><small>Start with + and the country code, for example +63 for the Philippines.</small>"],
    ["id=\"slug\" maxlength=\"50\" required placeholder=\"pearlsmile-cebu\">",
      "id=\"slug\" maxlength=\"49\" required placeholder=\"pearlsmile-cebu\"><small>Use 3–49 lowercase letters, numbers or single hyphens. Start with a letter.</small>"],
    ["if(!r.ok)throw Error(j.error||'Please try again.');return j}",
      "if(!r.ok)throw Object.assign(Error(j.error||'Please try again.'),{field:j.field});return j}"],
    ["let manualSlug=false;$('slug').oninput=()=>manualSlug=true;$('clinic').oninput=()=>{if(!manualSlug)$('slug').value=$('clinic').value.toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,49)};",
      `let manualSlug=false;
$('slug').oninput=()=>manualSlug=true;
$('clinic').oninput=()=>{
  if(manualSlug)return;
  const slug=$('clinic').value.toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  $('slug').value=(/^\\d/.test(slug)?'clinic-'+slug:slug).slice(0,49).replace(/-$/,'');
  clearFieldIssue($('slug'));
};`],
    ["async function reload(){",
      `function actionState(id,state) {
  const button=$(id);
  if(state)button.dataset.actionState=state;
  else delete button.dataset.actionState;
  if(state==='pending')button.setAttribute('aria-busy','true');
  else button.removeAttribute('aria-busy');
}
const contactFieldIds={phone:'clinicPhone',mapsUrl:'clinicMap',confirmed:'confirmContact'};
const createFieldIds={clinic:'clinic',city:'city',slug:'slug',hours:'hours',services:'services',featuredService:'featured',...contactFieldIds};
const editFieldIds={clinic:'editClinic',city:'editCity',slug:'editSlug',hours:'editHours',services:'editServices',featuredService:'editFeatured',...contactFieldIds};
function clearFieldIssue(field){
  if(field.getAttribute('aria-invalid')!=='true')return;
  field.removeAttribute('aria-invalid');
  field.setCustomValidity('');
  const hint=$(field.id+'Issue');
  const described=(field.getAttribute('aria-describedby')||'').split(/\\s+/).filter(id=>id&&id!==hint?.id);
  if(described.length)field.setAttribute('aria-describedby',described.join(' '));
  else field.removeAttribute('aria-describedby');
  hint?.remove();
}
function showFieldIssue(target,error,fields){
  status(target,error.message,true);
  if(error.field==='template'){
    step(1);
    return;
  }
  const field=$(fields[error.field]);
  if(!field)return;
  clearFieldIssue(field);
  const hint=document.createElement('small');
  hint.id=field.id+'Issue';
  hint.className='field-issue';
  hint.textContent=error.message;
  field.closest('label').append(hint);
  field.setAttribute('aria-invalid','true');
  field.setCustomValidity(error.message);
  field.setAttribute('aria-describedby',[field.getAttribute('aria-describedby'),hint.id].filter(Boolean).join(' '));
  field.focus();
}
for(const fieldId of new Set([...Object.values(createFieldIds),...Object.values(editFieldIds)])){
  $(fieldId).addEventListener('input',event=>clearFieldIssue(event.currentTarget));
}

async function reload(){`],
    [`    await reload();
    activeStep=4;`,
      `    await reload();
    actionState('create','done');
    actionState('saveDetails','done');
    status('editStatus','Clinic facts saved.');
    activeStep=4;`],
    ["  }catch(error){status('createStatus',error.message,true)}",
      "  }catch(error){showFieldIssue('createStatus',error,createFieldIds)}"],
    ["  $('eveDraftFields').replaceChildren(...rows);",
      `  $('eveDraftFields').replaceChildren(...rows);
  actionState('eveApplyDraft','');`],
    ["  field.value=choice.value;",
      `  field.value=choice.value;
  clearFieldIssue(field);`],
    ["  wallCopyBusy=button.disabled=$('generateWall').disabled=true;",
      `  wallCopyBusy=button.disabled=$('generateWall').disabled=true;
  actionState('confirmWallCopy','pending');`],
    [`    wallCopyBusy=false;
    for(const id of wallCopyFields)`,
      `    wallCopyBusy=false;
    if(button.dataset.actionState==='pending')actionState('confirmWallCopy','');
    for(const id of wallCopyFields)`],
    ["  selected.forEach(copyEveField);",
      `  selected.forEach(copyEveField);
  actionState('eveApplyDraft','done');`],
    [`    wallCopyDirty=false;
    renderManage();
    status('wallStatus','Wall and desk signs confirmed.');`,
      `    wallCopyDirty=false;
    renderManage();
    actionState('confirmWallCopy','done');
    status('wallStatus','Wall and desk signs confirmed.');`],
    ["$('saveContact').onclick=async()=>{const b=$('saveContact');b.disabled=true;status('contactStatus','Saving contact links…');try{const phone=$('clinicPhone').value.trim(),mapsUrl=$('clinicMap').value.trim();await api('/api/assistants/'+id+'/contact',{method:'POST',body:JSON.stringify({phone,mapsUrl,confirmed:$('confirmContact').checked})});await reload();status('contactStatus','Saved. Your page will show the links you supplied. Open them to check they lead to your clinic.')}catch(e){status('contactStatus',e.message,true)}finally{b.disabled=false}};",
      "$('saveContact').onclick=async()=>{const b=$('saveContact');b.disabled=true;status('contactStatus','Saving contact links…');try{const phone=$('clinicPhone').value.trim(),mapsUrl=$('clinicMap').value.trim();await api('/api/assistants/'+id+'/contact',{method:'POST',body:JSON.stringify({phone,mapsUrl,confirmed:$('confirmContact').checked})});await reload();actionState('saveContact','done');status('contactStatus','Saved. Your page will show the links you supplied. Open them to check they lead to your clinic.')}catch(e){showFieldIssue('contactStatus',e,contactFieldIds)}finally{b.disabled=false}};"],
    ["$('sendTestEmail').onclick=async()=>{const email=$('alertEmail').value.trim();$('sendTestEmail').disabled=true;status('alertStatus','Sending test email…');try{await api(`/api/assistants/${id}/test-email`,{method:'POST',body:JSON.stringify({email})});status('alertStatus','Check your clinic email to enter the six-digit code.');await reload()}catch(e){status('alertStatus',e.message,true)}finally{$('sendTestEmail').disabled=false}};",
      "$('sendTestEmail').onclick=async()=>{const email=$('alertEmail').value.trim();$('sendTestEmail').disabled=true;status('alertStatus','Sending test email…');try{await api(`/api/assistants/${id}/test-email`,{method:'POST',body:JSON.stringify({email})});status('alertStatus','Check your clinic email to enter the six-digit code.');await reload();actionState('sendTestEmail','done')}catch(e){status('alertStatus',e.message,true)}finally{$('sendTestEmail').disabled=false}};"],
    ["$('confirmEmail').onclick=async()=>{try{await api(`/api/assistants/${id}/confirm-email`,{method:'POST',body:JSON.stringify({code:$('emailCode').value.trim()})});await reload();status('alertStatus','Inbox confirmed. You can publish when the voice test is complete.')}catch(e){status('alertStatus',e.message,true)}};",
      "$('confirmEmail').onclick=async()=>{try{await api(`/api/assistants/${id}/confirm-email`,{method:'POST',body:JSON.stringify({code:$('emailCode').value.trim()})});await reload();actionState('confirmEmail','done');status('alertStatus','Inbox confirmed. You can publish when the voice test is complete.')}catch(e){status('alertStatus',e.message,true)}};"],
    ["$('saveDetails').onclick=async()=>{const b=$('saveDetails');b.disabled=true;status('editStatus','Saving clinic details…');try{const x={template:$('editTemplate').value,clinic:$('editClinic').value.trim(),city:$('editCity').value.trim(),slug:$('editSlug').value.trim(),hours:$('editHours').value.trim(),services:$('editServices').value.trim(),featuredService:$('editFeatured').value,language:$('editLanguage').value,bookingMode:$('editBooking').value};assistant=await api('/api/assistants/'+id+'/details',{method:'POST',body:JSON.stringify(x)});renderManage();populateDetails();if(assistant.heroReady)await loadWallPreview();$('eveDraftReview').hidden=true;$('eveDraftFields').replaceChildren();priorEveDraft.clear();if(eveMode.startsWith('interview')){await endEve().catch(()=>{});syncEveControls()}status('editStatus','Clinic details saved. Check the remaining publication steps below.')}catch(e){status('editStatus',e.message,true)}finally{b.disabled=false}};",
      "$('saveDetails').onclick=async()=>{const b=$('saveDetails');b.disabled=true;status('editStatus','Saving clinic details…');try{const x={template:$('editTemplate').value,clinic:$('editClinic').value.trim(),city:$('editCity').value.trim(),slug:$('editSlug').value.trim(),hours:$('editHours').value.trim(),services:$('editServices').value.trim(),featuredService:$('editFeatured').value,language:$('editLanguage').value,bookingMode:$('editBooking').value};assistant=await api('/api/assistants/'+id+'/details',{method:'POST',body:JSON.stringify(x)});renderManage();populateDetails();if(assistant.heroReady)await loadWallPreview();$('eveDraftReview').hidden=true;$('eveDraftFields').replaceChildren();priorEveDraft.clear();if(eveMode.startsWith('interview')){await endEve().catch(()=>{});syncEveControls()}actionState('saveDetails','done');status('editStatus','Clinic details saved. Check the remaining publication steps below.')}catch(e){showFieldIssue('editStatus',e,editFieldIds)}finally{b.disabled=false}};"],
    ["    status('manageChooseStatus','Style saved. Generate its wall image next.');",
      `    actionState('chooseStyle','done');
    status('manageChooseStatus','Style saved. Generate its wall image next.');`],
    [`  renderStyleActions($('editTemplate').value||a.template);
  syncEveControls();`,
      `  renderStyleActions($('editTemplate').value||a.template);
  for(const [id,completed] of [['confirmEmail',a.testConfirmed],['approvePage',a.reviewApproved],['publish',a.status==='published']]){
    if(completed)actionState(id,'done');
    else if($(id).dataset.actionState==='done')actionState(id,'');
  }
  syncEveControls();`],
    ["async function startWorkspace(){",
      `for(const id of ['create','saveDetails','saveContact','chooseStyle','sendTestEmail','confirmEmail','approvePage','publish']){
  const button=$(id), run=button.onclick;
  button.onclick=async event=>{
    if(button.disabled||button.dataset.actionState==='pending')return;
    actionState(id,'pending');
    try{await run(event)}
    finally{if(button.dataset.actionState==='pending')actionState(id,'')}
  };
}
for(const [container,buttons] of [
  ['eveDraftFields',['eveApplyDraft']],
  ['screen-create',['create']],
  ['editDetails',['saveDetails']],
  ['clinicContact',['saveContact']],
  ['alertEmail',['sendTestEmail','confirmEmail']],
  ['wallLetteringForm',['confirmWallCopy']]
]){
  $(container).addEventListener('input',()=>buttons.forEach(id=>{
    if($(id).dataset.actionState==='done')actionState(id,'');
  }));
}

async function startWorkspace(){`],
    ["</style></head><body>",
      `.btn:active:not(:disabled){background:#2c6752}
.btn[data-action-state="pending"]{opacity:.72}
.btn[data-action-state="done"]{background:#e1f0e5;color:#1d4938;box-shadow:inset 0 0 0 1px #9dbfaa}
.btn[data-action-state="done"]:disabled{opacity:1}
.btn[data-action-state="done"]::after{content:" ✓"}
.field-issue{display:block;color:#a32e28;font-weight:600}
.field [aria-invalid="true"]{border-color:#a32e28}
</style></head><body>`],
  ];
  for (const [from,to] of changes) source = replace(source,from,to);
  return source.replace("<!doctype html>", "<!doctype html><!-- " + marker + " -->").replaceAll("wall-samples-1","wall-samples-2");
}

const files = [
  ['assistant-core.js', updateWorker],
  ['assistant-setup/index.html', updatePage]
].map(([path, update]) => {
  const before = readFileSync(join(root, path), 'utf8');
  if (!before.includes('Eden owner setup sequence v1')) throw Error('Install the setup sequence update first.');
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
  console.log('Setup polish check passed. ' + changed.length + ' file(s) would change.');
} else {
  const backup = mkdtempSync(join(tmpdir(), 'eden-owner-setup-polish-'));
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
  console.log('Setup polish installed. Backup: ' + backup);
}
