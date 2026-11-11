import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const check = args.includes('--check');
const [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview')] = args.filter(arg => arg !== '--check');
const marker = 'Eden owner wall and interview guidance v1';

function replace(source, from, to) {
  if (source.split(from).length !== 2) throw Error('Unexpected setup version near ' + from.slice(0, 100));
  return source.replace(from, () => to);
}

function updateWorker(source) {
  const changes = [
    ["const interviewKey='eve-owner-english-v2';",
      "const interviewKey='eve-owner-english-v3';"],
    ["          first_message:'Hi, I’m Eve. I can help draft your clinic details. What days and hours are you open?',",
      "          first_message:'',"],
    ["        overrides:{conversation_config_override:{conversation:{text_only:true}}},",
      "        overrides:{conversation_config_override:{agent:{first_message:true},conversation:{text_only:true}}},"],
    ["  'Accept “skip”",
      `  'Answer questions about setup directly before returning to the current interview topic. Start with the answer to the owner’s first message. Skip extra greetings and avoid repeating a question they have answered. If they ask to use chat and hours are still unknown, say “Yes, we can do this in chat. What days and hours is your clinic open?” Otherwise acknowledge chat and ask only for the next missing detail. If they want audio, tell them to select Start voice interview and continue with the details already gathered.',
  'The steps are Choose a style, Talk with Eve, Clinic facts, Alert, and Publish. Clinic facts can be edited manually before saving. To personalize the reception wall, type the name in Wall lettering, preview the block letters, and select Confirm wall and signs. In Alert, enter the clinic inbox, select Send test email, and confirm the six-digit code. If the test email has not arrived, check the address and spam folder, then send a new test email if needed. Preview and approve the page before publishing.',
  'With appointment requests enabled, the website receptionist can prepare an editable request. The patient reviews the details, gives consent, and selects Send request. A submitted request is emailed to the verified clinic inbox. A voice test booking is simulated and sends no clinic email. Only clinic staff confirm availability and arrange the appointment with the patient. A request email does not confirm an appointment. If the owner asks whether they get an email for every booking, explain the difference between a submitted request and a confirmed booking.',
  'You can explain the setup controls and give troubleshooting steps. You cannot see delivery status, verify an inbox yourself, change settings, or promise that a specific email arrived. If setup has expired, return to Clinic Workspace, open Website chat, and select Set up AI receptionist to resume.',
  'Accept “skip”`],
    [`  if(a.hero_status==='generating'&&Date.now()-Date.parse(a.updated_at)<600000)
    return json({error:'Wait for the wall image to finish.'},409);
`,
      ""],
  ];
  for (const [from,to] of changes) source = replace(source,from,to);
  return "// " + marker + "\n" + source;
}

function updatePage(source) {
  const changes = [
    ["  currentScreen=screen;",
      `  currentScreen=screen;
  $('backToWorkspace').hidden=!useWorkspace||screen==='screen-no-invite';`],
    [`  $('backToWorkspace').hidden=false;
`,
      ""],
    ["Details added to the clinic form. You can review or edit them in step 3.",
      "Details added to the clinic form below. You can edit them in step 3."],
    ["Generate your own wall lettering after you save a style.",
      "Personalize the wall lettering after you save a style."],
    ["<span>Wall lettering</span><input id=\"wallLettering\" maxlength=\"70\" required>",
      "<span>Wall lettering</span><input id=\"wallLettering\" maxlength=\"70\" required aria-describedby=\"wallLetteringHint\"><small id=\"wallLetteringHint\">Type your clinic name to see it in block letters in the preview.</small>"],
    ["<details id=\"generateWallOptions\"><summary>Generate a custom photo instead</summary><div class=\"actions\"><button class=\"btn light\" type=\"button\" id=\"generateWall\">Generate image with block letters on wall</button></div></details>",
      ""],
    [`async function generateOwnerWall(){
  if($('generateWall').disabled||wallCopyBusy)return;
  if(wallCopyDirty){status('wallStatus','Confirm your edits before generating a new photo.',true);return;}
  if($('editTemplate').value!==assistant.template){
    status('wallStatus','Save the selected style before generating its wall image.',true);
    return;
  }
  if($('editClinic').value.trim()!==assistant.clinic){
    for(const target of ['wallStatus','manageChooseStatus'])status(target,'Save the clinic name before generating the wall image.',true);
    return;
  }
  $('generateWall').disabled=$('confirmWallCopy').disabled=true;
  const targets=['wallStatus','manageChooseStatus'];
  for(const target of targets)status(target,'Generating your clinic name on the wall. This can take a minute…');
  try{
    assistant=await api('/api/assistants/'+id+'/hero-generate',{
      method:'POST',body:JSON.stringify({template:assistant.template,clinic:assistant.clinic})
    });
    $('approveCheck').checked=false;
    renderManage();
    const notice=assistant.wallNotice||'Wall image ready. Check the spelling and desk signs in the wide preview below.';
    for(const target of targets)status(target,notice);
  }catch(error){
    const current=await api('/api/assistants/'+id).catch(()=>null);
    if(current){assistant=current;renderManage()}
    for(const target of targets)status(target,error.message,true);
  }finally{
    $('generateWall').disabled=assistant.heroStatus==='generating';
    renderWallLettering();
    renderStyleActions($('editTemplate').value||assistant.template);
  }
}
$('generateWall').onclick=generateOwnerWall;

`,
      ""],
    ["function renderManage(){const a=assistant;renderManageTemplates();$('manageTitle').textContent=a.clinic+' assistant';$('manageIntro').textContent=`${a.city} · ${location.host}/clinic/${a.slug}/`;const photoCard=$('wallSceneCard');photoCard.hidden=false;$('generateWall').hidden=a.status==='published'||a.heroIsPilot;$('generateWall').disabled=a.heroStatus==='generating';$('generateWall').textContent=a.heroReady&&!a.heroIsTemplate?'Regenerate wall image with block letters':'Generate image with block letters on wall';if(a.generatedWallAvailable)$('generateWall').textContent='Use generated Cebu wall';renderWallLettering();$('wallStatus').textContent=a.heroApproved?'Wall and desk signs confirmed.':a.heroStatus==='generating'?'Generating…':'';$('continuePageReview').hidden=!a.heroApproved||a.status==='published';void loadWallPreview();$('qaStart').disabled=!a.agentReady||a.bookingMode!=='request';$('behaviorUpgrade').disabled=!a.agentReady||a.bookingMode!=='request';$('qaRefresh').disabled=!a.agentReady||a.bookingMode!=='request';$('voiceUpgrade').hidden=!a.agentReady||a.bookingMode!=='request';if(a.emailAddress&&!$('alertEmail').value)$('alertEmail').value=a.emailAddress;if(document.activeElement!==$('clinicPhone'))$('clinicPhone').value=a.phone||'';if(document.activeElement!==$('clinicMap'))$('clinicMap').value=a.mapsUrl||'';$('voiceCheck').textContent=(a.agentReady?'✓':'○')+' Voice assistant created';$('voiceCheck').className=a.agentReady?'yes':'no';$('reviewCheck').textContent=(a.voiceReviewed?'✓':'○')+' Voice conversation tested';$('reviewCheck').className=a.voiceReviewed?'yes':'no';$('emailCheck').textContent=(a.testConfirmed?'✓':'○')+' Clinic inbox confirmed';$('emailCheck').className=a.testConfirmed?'yes':'no';$('testCheck').textContent=(a.heroApproved?'✓':'○')+(a.heroApproved?' Wall confirmed':' Confirm wall');$('testCheck').classList.toggle('yes',a.heroApproved);$('testCheck').classList.toggle('no',!a.heroApproved);$('pageCheck').textContent=(a.reviewApproved?'✓':'○')+(a.reviewApproved?' Page approved':' Approve page');$('pageCheck').classList.toggle('yes',a.reviewApproved);$('pageCheck').classList.toggle('no',!a.reviewApproved);$('publish').disabled=!a.agentReady||!a.voiceReviewed||!a.testConfirmed||!a.heroApproved||!a.reviewApproved||a.status==='published';renderApproval();document.querySelectorAll('[data-variant]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.variant===(a.variant||'original')));const legacy=a.variant&&a.variant!=='original'&&a.status!=='published';$('legacyLayout').hidden=!legacy;$('legacyLayout').style.display=legacy?'':'none';$('variantStatus').textContent=legacy?'Switch to the current layout to approve this page.':'';$('summaryClinic').textContent=a.clinic+' · '+a.city;$('summaryServices').textContent=a.services;$('summaryHours').textContent=a.hours||'Not supplied';$('summaryFeatured').textContent=a.featuredService||'None';$('summaryVoice').textContent=(a.language==='Thai'?'สวัสดีค่ะ ยินดีต้อนรับสู่ '+a.clinic+' มีอะไรให้ช่วยไหมคะ':'Hi, welcome to '+a.clinic+'. What can I help you with?')+(a.voiceReviewed?' · Voice tested':' · Test with Talk above');$('summaryBooking').textContent=a.bookingMode==='request'?'Appointment requests; clinic staff confirm availability':'Questions only; clinic staff handle bookings';$('summaryContact').textContent=[a.phone,a.mapsUrl].filter(Boolean).join(' · ')||'No phone or map saved';if(a.status==='published'){$('publishStatus').textContent='Your AI receptionist page is published.';const link=document.createElement('a');link.href=a.publicUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent=link.href;$('publicLink').replaceChildren(link);$('liveConversationUpgrade').hidden=a.bookingMode!=='request'}",
      "function renderManage(){const a=assistant;renderManageTemplates();$('manageTitle').textContent=a.clinic+' assistant';$('manageIntro').textContent=`${a.city} · ${location.host}/clinic/${a.slug}/`;$('wallSceneCard').hidden=false;renderWallLettering();$('wallStatus').textContent=a.heroApproved?'Wall and desk signs confirmed.':'';$('continuePageReview').hidden=!a.heroApproved||a.status==='published';void loadWallPreview();$('qaStart').disabled=!a.agentReady||a.bookingMode!=='request';$('behaviorUpgrade').disabled=!a.agentReady||a.bookingMode!=='request';$('qaRefresh').disabled=!a.agentReady||a.bookingMode!=='request';$('voiceUpgrade').hidden=!a.agentReady||a.bookingMode!=='request';if(a.emailAddress&&!$('alertEmail').value)$('alertEmail').value=a.emailAddress;if(document.activeElement!==$('clinicPhone'))$('clinicPhone').value=a.phone||'';if(document.activeElement!==$('clinicMap'))$('clinicMap').value=a.mapsUrl||'';$('voiceCheck').textContent=(a.agentReady?'✓':'○')+' Voice assistant created';$('voiceCheck').className=a.agentReady?'yes':'no';$('reviewCheck').textContent=(a.voiceReviewed?'✓':'○')+' Voice conversation tested';$('reviewCheck').className=a.voiceReviewed?'yes':'no';$('emailCheck').textContent=(a.testConfirmed?'✓':'○')+' Clinic inbox confirmed';$('emailCheck').className=a.testConfirmed?'yes':'no';$('testCheck').textContent=(a.heroApproved?'✓':'○')+(a.heroApproved?' Wall confirmed':' Confirm wall');$('testCheck').classList.toggle('yes',a.heroApproved);$('testCheck').classList.toggle('no',!a.heroApproved);$('pageCheck').textContent=(a.reviewApproved?'✓':'○')+(a.reviewApproved?' Page approved':' Approve page');$('pageCheck').classList.toggle('yes',a.reviewApproved);$('pageCheck').classList.toggle('no',!a.reviewApproved);$('publish').disabled=!a.agentReady||!a.voiceReviewed||!a.testConfirmed||!a.heroApproved||!a.reviewApproved||a.status==='published';renderApproval();document.querySelectorAll('[data-variant]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.variant===(a.variant||'original')));const legacy=a.variant&&a.variant!=='original'&&a.status!=='published';$('legacyLayout').hidden=!legacy;$('legacyLayout').style.display=legacy?'':'none';$('variantStatus').textContent=legacy?'Switch to the current layout to approve this page.':'';$('summaryClinic').textContent=a.clinic+' · '+a.city;$('summaryServices').textContent=a.services;$('summaryHours').textContent=a.hours||'Not supplied';$('summaryFeatured').textContent=a.featuredService||'None';$('summaryVoice').textContent=(a.language==='Thai'?'สวัสดีค่ะ ยินดีต้อนรับสู่ '+a.clinic+' มีอะไรให้ช่วยไหมคะ':'Hi, welcome to '+a.clinic+'. What can I help you with?')+(a.voiceReviewed?' · Voice tested':' · Test with Talk above');$('summaryBooking').textContent=a.bookingMode==='request'?'Appointment requests; clinic staff confirm availability':'Questions only; clinic staff handle bookings';$('summaryContact').textContent=[a.phone,a.mapsUrl].filter(Boolean).join(' · ')||'No phone or map saved';if(a.status==='published'){$('publishStatus').textContent='Your AI receptionist page is published.';const link=document.createElement('a');link.href=a.publicUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent=link.href;$('publicLink').replaceChildren(link);$('liveConversationUpgrade').hidden=a.bookingMode!=='request'}"],
    [`    : 'We filled in your clinic name and suggested sign text. Edit anything you like, then confirm the preview.';
  $('generateWallOptions').hidden=a.status==='published'||a.heroIsPilot;`,
      "    : 'Edit the wall lettering and desk signs, then confirm the preview.';"],
    ["wallCopyBusy||a.heroStatus==='generating'||$('wallFrame').hidden",
      "wallCopyBusy||$('wallFrame').hidden"],
    ["  wallCopyBusy=button.disabled=$('generateWall').disabled=true;",
      "  wallCopyBusy=button.disabled=true;"],
    [`    for(const id of wallCopyFields)$(id).readOnly=false;
    $('generateWall').disabled=assistant.heroStatus==='generating';`,
      "    for(const id of wallCopyFields)$(id).readOnly=false;"],
    ["  $('styleNext').textContent=saved?(assistant.heroIsPilot?'Your generated wall is ready in the wide preview below.':'This is your saved style. Generate the wall image when you’re ready.'):'Choose this template to save the style. You can generate its wall image next.';",
      "  $('styleNext').textContent=saved?'Edit and confirm your wall lettering and signs below.':'Choose this template to save the style.';"],
    ["Style saved. Generate its wall image next.",
      "Style saved. Personalize your wall lettering and signs below."],
    ["  let awaitingGreeting=interviewing&&Boolean(remembered);",
      "  const greetInVoice=interviewing&&!textOnly&&!remembered;"],
    [`    ...(textOnly?{textOnly:true}:{}),
    clientTools:interviewing?`,
      `    ...(textOnly?{textOnly:true}:{}),
    ...(greetInVoice?{overrides:{agent:{firstMessage:'Hi, I’m Eve. What days and hours is your clinic open?'}}}:{}),
    clientTools:interviewing?`],
    [`      if(role==='agent'&&awaitingGreeting){
        awaitingGreeting=false;
        if(entry.message?.trim().endsWith('What days and hours are you open?'))return;
      }
`,
      ""],
    ["interviewing?'You can speak or type your clinic details.':'Listening… You can also type.'",
      "interviewing?(remembered?'Voice connected. Pick up where you left off.':'You can speak or type your clinic details.'):'Listening… You can also type.'"],
  ];
  for (const [from,to] of changes) source = replace(source,from,to);
  return source.replace("<!doctype html>", "<!doctype html><!-- " + marker + " -->");
}

const files = [
  ['assistant-core.js', updateWorker],
  ['assistant-setup/index.html', updatePage]
].map(([path, update]) => {
  const before = readFileSync(join(root, path), 'utf8');
  if (!before.includes('Eden owner setup polish v1')) throw Error('Install the previous setup polish update first.');
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
  console.log('Wall and interview guidance check passed. ' + changed.length + ' file(s) would change.');
} else {
  const backup = mkdtempSync(join(tmpdir(), 'eden-owner-wall-guidance-'));
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
  console.log('Wall and interview guidance installed. Backup: ' + backup);
}
