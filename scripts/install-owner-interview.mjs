import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const marker = 'Eden owner voice interview v1';
const args = process.argv.slice(2);
const check = args.includes('--check');
const paths = args.filter(arg => arg !== '--check');
if (paths.length > 1 || paths.some(arg => arg.startsWith('-'))) {
  throw Error('Usage: node install-owner-interview.mjs [site directory] [--check]');
}
const root = paths[0] || join(homedir(), 'Desktop', 'clinicnet-voice-preview');

function replace(source, anchor, replacement) {
  if (typeof anchor === 'string' ? !source.includes(anchor) : !anchor.test(source)) {
    throw Error('Incompatible owner setup near ' + String(anchor).slice(0, 100));
  }
  return source.replace(anchor, () => replacement);
}

const interviewCore = `/* ${marker} */
const interviewKey='eve-owner-english-v1';
const interviewTool={
  type:'client',
  name:'draft_clinic_facts',
  description:'Show the reviewed clinic facts as an editable draft in the owner’s browser.',
  expects_response:true,
  parameters:{
    type:'object',
    required:['hours','services','bookingMode'],
    properties:{
      hours:{type:'string',description:'Confirmed opening hours up to 160 characters. Empty if skipped.'},
      services:{type:'string',description:'One confirmed service per line, with exact approved price and currency when given. Up to 700 characters. Empty if skipped.'},
      bookingMode:{type:'string',enum:['request','information',''],description:'request if Eve takes inquiries for staff to confirm. information if patients contact staff themselves. Empty if skipped.'}
    }
  }
};
const interviewPrompt=[
  'You are Eve, helping a clinic owner prepare the facts for their AI receptionist. Speak English. This is a private setup interview. Never act as the clinic’s receptionist or create an appointment or request.',
  'Ask one short question at a time. Ask for opening hours, then approved services and any prices they want published, then whether the assistant should take appointment requests for staff to confirm or answer questions and ask patients to contact staff. The clinic team always confirms availability.',
  'Accept “skip” for any topic. Ask for missing days, AM or PM, ambiguous service names, and currency when a price is given. Never assume opening hours, prices, currency, or names. Do not ask for patient information, health history, payment details, or private staff details.',
  'Before drafting, read back what you heard and ask the owner whether it is right. Preserve the owner’s exact prices and currency. For the draft, keep hours under 160 characters and services under 700 characters. Write one service per line and use digits without thousands separators. If too long, ask which facts to prioritize.',
  'After the owner confirms, call draft_clinic_facts with the complete set of confirmed answers for this conversation, leaving skipped fields empty. If the owner corrects something, read back the correction and send a fresh complete draft only after confirmation. Tell the owner the draft is ready to check on screen. They can choose which fields to apply, edit the form, and save it themselves.'
].join(' ');

async function ownerInterviewAgent(env){
  const db=env.PILOT_DB;
  // Store only the shared agent ID and the lease used for first-time provisioning.
  await db.prepare('CREATE TABLE IF NOT EXISTS eden_owner_interview_agents (config TEXT PRIMARY KEY, agent_id TEXT, claim TEXT, started_at INTEGER NOT NULL)').run();
  const select=db.prepare('SELECT agent_id FROM eden_owner_interview_agents WHERE config=?').bind(interviewKey);
  const existing=await select.first();
  if(existing?.agent_id)return existing.agent_id;
  const claim=crypto.randomUUID(), started=Date.now();
  const lease=await db.prepare("INSERT INTO eden_owner_interview_agents (config,claim,started_at) VALUES (?,?,?) ON CONFLICT(config) DO UPDATE SET claim=excluded.claim,started_at=excluded.started_at WHERE agent_id IS NULL AND started_at < ?")
    .bind(interviewKey,claim,started,started-180000).run();
  if(lease.meta?.changes!==1)return (await select.first())?.agent_id||null;
  let created;
  try{
    const example=await eleven(env,'agents/'+sampleAgent.pearl);
    const voice=example.conversation_config?.tts?.voice_id;
    if(!voice)throw Error('The interview voice is unavailable.');
    const config={
      name:'Eden · Eve owner interview',
      conversation_config:{
        agent:{
          first_message:'Hi, I’m Eve. I can help draft your clinic details. What days and hours are you open?',
          language:'en',
          prompt:{prompt:interviewPrompt,tools:[interviewTool]}
        },
        tts:{voice_id:voice},
        conversation:{max_duration_seconds:360}
      },
      platform_settings:{
        auth:{enable_auth:true},
        privacy:{record_voice:false,retention_days:0},
        call_limits:{daily_limit:60,agent_concurrency_limit:3}
      }
    };
    const response=await eleven(env,'agents/create',{method:'POST',body:JSON.stringify(config)});
    if(!/^agent_[a-z0-9]+$/i.test(response.agent_id||''))throw Error('Voice provider did not return an interview agent ID.');
    created=response.agent_id;
    const saved=await db.prepare('UPDATE eden_owner_interview_agents SET agent_id=?,claim=NULL WHERE config=? AND claim=?')
      .bind(created,interviewKey,claim).run();
    if(saved.meta?.changes===1)return created;
    // Another lease took over before this write. Discard our unused provider agent.
    await eleven(env,'agents/'+encodeURIComponent(created),{method:'DELETE'}).catch(()=>{});
    return (await select.first())?.agent_id||null;
  }catch(error){
    await db.prepare('DELETE FROM eden_owner_interview_agents WHERE config=? AND claim=? AND agent_id IS NULL')
      .bind(interviewKey,claim).run().catch(()=>{});
    throw error;
  }
}
`;

function core(source) {
  if (source.includes(marker)) return source;
  if (!source.includes('Eden Eve owner onboarding v1')) throw Error('Install the Eve owner setup update first.');
  source = replace(source, 'async function sendEmail(env,to,subject,text){', interviewCore + 'async function sendEmail(env,to,subject,text){');
  source = replace(source, "if(action==='voice-reviewed'&&request.method==='POST')", `if(action==='owner-interview'&&request.method==='POST'){
  if(a.status==='published'||!a.voice_test_at)return json({error:'Finish the private voice test before starting the interview on a draft.'},409);
  if(!env.SELF_SERVE_ELEVENLABS_KEY)return json({error:'The voice interview is unavailable. You can fill in the clinic details below.'},503);
  if(!await limit(env,'owner-interview:'+id,8,86400))return json({error:'Daily interview limit reached. You can fill in the clinic details below.'},429);
  try{
    const agentId=await ownerInterviewAgent(env);
    if(!agentId)return json({error:'Eve is getting ready. Try again in a few seconds.'},409);
    const result=await eleven(env,'conversation/get-signed-url?include_conversation_id=true&agent_id='+encodeURIComponent(agentId));
    if(typeof result.signed_url!=='string'||!result.signed_url)throw Error('The voice provider did not return a session.');
    return json({signedUrl:result.signed_url});
  }catch(error){
    console.error('Owner interview unavailable',error?.message||'unknown');
    return json({error:'Could not connect to the interview. Try again or fill in the clinic details below.'},503);
  }
}
if(action==='voice-reviewed'&&request.method==='POST')`);
  return replace(source, 'voice|signed-url|voice-reviewed|', 'voice|signed-url|owner-interview|voice-reviewed|');
}

const interviewMarkup = `<div class="eve-interview" id="eveInterview" hidden>
  <h4>Set up with Eve</h4>
  <p>Tell Eve your opening hours, services and prices, and how your team handles booking requests. The interview is in English. Share clinic information only.</p>
  <button type="button" class="btn light" id="eveInterviewStart">Start voice interview</button>
  <div id="eveDraftReview" hidden>
    <h4>Review Eve’s draft</h4>
    <p>Check the hours, spelling, prices, and who confirms appointments. Choose the fields to put in your form.</p>
    <div id="eveDraftFields"></div>
    <button type="button" class="btn" id="eveApplyDraft">Use selected details</button>
    <p id="eveDraftStatus" class="status" role="status"></p>
  </div>
</div>
`;

const interviewStyles = `
/* ${marker} */
.eve-interview{max-width:820px;margin:18px auto 0;padding:16px 18px;border:1px solid #c7d8c9;border-radius:18px;background:#fbfcf8}
.eve-interview h4{margin:0 0 6px;font-size:1.06rem}
.eve-interview p{margin:0 0 10px}
#eveDraftReview{margin-top:17px;border-top:1px solid #c7d8c9;padding-top:14px}
.eve-draft-field{display:flex;gap:10px;align-items:flex-start;padding:9px 0;cursor:pointer}
.eve-draft-field input{margin-top:5px;flex:none}
.eve-draft-field span{display:block;white-space:pre-wrap;overflow-wrap:anywhere}
#eveApplyDraft{margin-top:8px}
#eveDraftStatus{margin:8px 0 0}
`;

const interviewControls = `let eveRun=0, eveMode='', eveBusy=false;
const interviewFields=[
  {key:'hours',label:'Opening hours',input:'editHours',max:160},
  {key:'services',label:'Services and prices',input:'editServices',max:700},
  {key:'bookingMode',label:'Appointment handling',input:'editBooking',max:11}
];
const interviewModes={
  request:'Take booking requests for clinic staff to confirm.',
  information:'Answer questions and ask patients to contact clinic staff to book.'
};
function syncEveControls(){
  const hasSession=Boolean(session);
  $('eveTalkLabel').textContent=eveMode==='test'?'End voice test':'Start voice test';
  $('talk').setAttribute('aria-pressed',String(eveMode==='test'));
  $('talk').disabled=eveBusy||eveMode==='interview';
  $('eveMessage').disabled=$('eveSend').disabled=!hasSession;
  $('eveConversationLabel').textContent=eveMode==='interview'?'Clinic setup interview':'Private receptionist test';
  $('eveInterview').hidden=!assistant?.voiceReviewed||assistant.status==='published';
  $('eveInterviewStart').textContent=eveMode==='interview'?'End voice interview':'Start voice interview';
  $('eveInterviewStart').disabled=eveBusy||eveMode==='test';
}
function showEveDraft(details){
  const rows=[];
  for(const {key,label,input,max} of interviewFields){
    if(typeof details?.[key]!=='string')return 'Please send text for each field, or an empty string for skipped fields.';
    const value=details[key].replace(/\\r\\n/g,'\\n').trim();
    if(!value)continue;
    if(value.length>max||/[<>\\r]/.test(value))return 'Please shorten or clean up '+label+' before drafting.';
    if(key==='services'&&value.length<3)return 'Please include a complete service name.';
    if(key==='bookingMode'&&!Object.hasOwn(interviewModes,value))return 'Please confirm how appointment requests are handled.';
    const row=document.createElement('label'), checkbox=document.createElement('input');
    row.className='eve-draft-field';
    checkbox.type='checkbox';
    checkbox.checked=true;
    checkbox.value=value;
    checkbox.dataset.field=input;
    const copy=document.createElement('span'), heading=document.createElement('strong'), text=document.createElement('span');
    heading.textContent=label;
    text.textContent=key==='bookingMode'?interviewModes[value]:value;
    copy.append(heading,text);
    row.append(checkbox,copy);
    rows.push(row);
  }
  if(!rows.length)return 'There are no confirmed details to draft yet.';
  $('eveDraftFields').replaceChildren(...rows);
  $('eveDraftReview').hidden=false;
  status('eveDraftStatus','Draft ready to review.');
  return 'The draft is visible. The clinic owner will review, apply and save it.';
}

async function runEveConversation(mode){
  if(eveBusy||(eveMode&&eveMode!==mode))return;
  eveBusy=true;
  syncEveControls();
  try{
    if(session){
      await session.endSession();
      session=null;
      eveMode='';
      status('voiceStatus',mode==='interview'?'Voice interview ended.':'Voice test ended.');
      return;
    }
    const run=++eveRun;
    const interviewing=mode==='interview';
    status('voiceStatus',interviewing?'Connecting to your interview…':assistant.agentReady?'Connecting…':'Preparing your voice assistant…');
    if(!interviewing&&!assistant.agentReady){
      assistant=await api('/api/assistants/'+id+'/voice',{method:'POST',body:'{}'});
      renderManage();
      status('voiceStatus','Connecting…');
    }
    const endpoint=interviewing?'owner-interview':'signed-url';
    const result=await api('/api/assistants/'+id+'/'+endpoint,{method:'POST',body:'{}'});
    const {Conversation}=await import('https://esm.sh/@elevenlabs/client?bundle');
    $('eveTranscript').replaceChildren();
    const connection=await Conversation.startSession({
      signedUrl:result.signedUrl,
      connectionType:'websocket',
      ...(interviewing?{clientTools:{draft_clinic_facts:details=>{
        return run===eveRun?showEveDraft(details):'This interview has ended.';
      }}}:{}),
      onMessage:message=>{if(run===eveRun)addEveMessage(message)},
      onDisconnect:()=>{
        if(run!==eveRun)return;
        eveRun++;
        session=null;
        eveMode='';
        syncEveControls();
        status('voiceStatus',interviewing?'Voice interview ended.':'Voice test ended.');
      }
    });
    if(run!==eveRun)return;
    session=connection;
    eveMode=mode;
    syncEveControls();
    status('voiceStatus',interviewing?'Eve is listening for your clinic details.':'Listening…');
    if(interviewing){
      $('eveTranscript').scrollIntoView({block:'nearest',behavior:'smooth'});
    }else{
      await api('/api/assistants/'+id+'/voice-reviewed',{method:'POST',body:'{}'});
      await reload();
    }
  }catch(error){
    status('voiceStatus',error.message,true);
  }finally{
    eveBusy=false;
    syncEveControls();
  }
}
$('talk').onclick=()=>runEveConversation('test');
$('eveInterviewStart').onclick=()=>runEveConversation('interview');
$('eveApplyDraft').onclick=()=>{
  const selected=[...$('eveDraftFields').querySelectorAll('input:checked')];
  if(!selected.length){
    status('eveDraftStatus','Choose at least one field to add to your form.',true);
    return;
  }
  for(const choice of selected){
    const field=$(choice.dataset.field);
    field.value=choice.value;
    if(field.id==='editServices')refreshEditFeatured();
  }
  if(eveMode==='interview')void runEveConversation('interview');
  status('editStatus','Draft added to the form. Check the details, then select Save clinic details.');
  $('editDetails').scrollIntoView({block:'start',behavior:'smooth'});
  $(selected[0].dataset.field).focus({preventScroll:true});
};
`;

function setup(source) {
  if (source.includes(marker)) return source;
  if (!source.includes('Eden Eve owner onboarding v1')) throw Error('Install the Eve owner setup update first.');
  source = replace(source, '/* Eden Eve owner onboarding v1 */', '/* Eden Eve owner onboarding v1 */'+interviewStyles);
  source = replace(source, '<span>Private receptionist test</span>', '<span id="eveConversationLabel">Private receptionist test</span>');
  source = replace(source, '<p id="voiceStatus" class="status" role="status"></p>', '<p id="voiceStatus" class="status" role="status"></p>\n'+interviewMarkup);
  source = replace(source, '  void loadMobilePreview();\n}', '  syncEveControls();\n  void loadMobilePreview();\n}');
  source = replace(source, /function setEveConversation\(active\)\{[\s\S]*?\n\}(?=\nfunction addEveMessage)/, '');
  source = replace(source, /let eveRun=0;[\s\S]*?(?=\$\('voiceUpgrade'\)\.onclick=)/, interviewControls);
  return replace(source, "status('editStatus','Saved. Review the updated wall scene, voice, and mobile page before publishing.')",
    "$('eveDraftReview').hidden=true;$('eveDraftFields').replaceChildren();status('editStatus','Saved. Review the updated wall scene, voice, and mobile page before publishing.')");
}

const changes = [['assistant-core.js', core], ['assistant-setup/index.html', setup]].map(([path, transform]) => {
  const file = join(root, path), before = readFileSync(file, 'utf8');
  return {path, file, before, after: transform(before)};
}).filter(({before, after}) => before !== after);
if (check || !changes.length) {
  console.log('Owner interview check passed. ' + changes.length + ' file(s) would change.');
} else {
  const backup = mkdtempSync(join(tmpdir(), 'eden-owner-interview-'));
  for (const {file, before, path} of changes) {
    if (readFileSync(file, 'utf8') !== before) throw Error('Site changed. Try again.');
    const target = join(backup, path);
    mkdirSync(dirname(target), {recursive:true});
    copyFileSync(file, target);
  }
  const written = [];
  try {
    for (const change of changes) {
      const temporary = change.file + '.eden-' + process.pid;
      try {
        writeFileSync(temporary, change.after, {flag:'wx'});
        renameSync(temporary, change.file);
      } finally {
        rmSync(temporary, {force:true});
      }
      written.push(change);
    }
  } catch (error) {
    for (const {file, path} of written.reverse()) copyFileSync(join(backup, path), file);
    throw error;
  }
  console.log('Owner interview installed. Backup: ' + backup);
}
