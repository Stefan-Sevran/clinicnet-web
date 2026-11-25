import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as pause } from 'node:timers/promises';

const { JSDOM } = createRequire(import.meta.url)(process.env.EDEN_JSDOM_MODULE || 'jsdom');
const [html, rescue, operations, workspace, knowledge, help] = await Promise.all(['clinic/index.html','assets/clinic-rescue.js','assets/clinic-operations.js','assets/clinic.js','assets/eden-support-knowledge.js','assets/ask-eden.js']
  .map(path=>readFile(new URL('../'+path,import.meta.url),'utf8')));
const account = '10000000-0000-4000-8000-000000000001';
const cebu = '20000000-0000-4000-8000-000000000001';
const bangkok = '20000000-0000-4000-8000-000000000002';
const data = {
  [cebu]:{currency:'PHP',eligible_minor:1300000,collected_minor:1800000,estimated_share_minor:195000},
  [bangkok]:{currency:'THB',eligible_minor:100000,collected_minor:100000,estimated_share_minor:20000}
};
const dates = {period_start:'2026-11-19',through:'2026-11-20'};
const roles = ['owner','admin','staff'];
for (const role of roles) {
  const dom = new JSDOM(html,{
    url:'https://workspace.test/clinic/?view=overview',runScripts:'outside-only'
  });
  try {
    const win = dom.window;
    const doc = win.document;
    win.matchMedia = () => ({matches:false});
    win.HTMLElement.prototype.scrollIntoView = function () {};
    async function until(condition) {
      for (let i=0;i<80 && !condition();i++) await pause(10);
      assert.ok(condition(),'Timed out waiting for the workspace');
    }
    const requests = [];
    let hidden = false;
    let clock = win.Date.now();
    Object.defineProperty(doc,'hidden',{get:()=>hidden});
    win.Date.now = () => clock;
    const visibility = value => {
      hidden = value;
      doc.dispatchEvent(new win.Event('visibilitychange'));
    };
    let session = {access_token:'fixture',user:{id:'member',email:'fixture@example.test'}};
    let authChanged;
    let approvedFacts = null;
    let supportPending = true;
    let factsWrites = 0;
    let editorRequests = 0;
    let configReads = 0;
    let sessionChecks = 0;
    let tokenRefreshes = 0;
    let accountReads = 0;
    let activityFailure;
    let accountAuthorization;
    let resolveCebu;
    let delayCebu = false;
    let messengerStatus = 'action_required';
    let resolveConnections;
    let delayConnections = false;
    const supportReads = [];
    const facts = {services:'Checkups',hours:'Weekdays 9 to 5',address:'Cebu',bookingRules:'Staff confirm times'};
    win.fetch = async (raw, options) => {
      const req = new URL(raw);
      if (req.pathname==='/api/assistants/workspace-link') {
        editorRequests++;
        assert.deepEqual(JSON.parse(options.body),{accountId:account,locationId:cebu});
        assert.equal(options.headers.Authorization,'Bearer fixture');
        return new Response(null,{status:503});
      }
      if (req.pathname==='/clinic/public-config') {
        configReads++;
        assert.equal(options.cache,'no-store');
        if (role==='admin' && configReads===1) throw new TypeError('Failed to fetch');
      }
      if (req.pathname==='/clinic/accounts') {
        accountReads++;
        accountAuthorization = options.headers.Authorization;
      }
      if (req.pathname==='/clinic/connections' && options.cache==='no-store') {
        assert.equal(options.headers.Authorization,'Bearer fixture');
        assert.equal(req.searchParams.get('accountId'),account);
        supportReads.push(req.searchParams.get('locationId'));
        if (delayConnections) return new Promise(resolve=>{ resolveConnections=resolve; });
      }
      if (req.pathname==='/clinic/connections' && activityFailure==='offline') throw new TypeError('Failed to fetch');
      if (req.pathname==='/clinic/connections' && activityFailure==='unauthorized') {
        return new Response(null,{status:401});
      }
      const responses = {
        '/clinic/public-config':{supabaseUrl:'https://example.test',publishableKey:'fixture',messengerSetupAvailable:true},
        '/clinic/accounts':[{id:account,name:'Eden fixture'}],
        '/clinic/locations':[{id:cebu,name:'Cebu fixture',timezone:'Asia/Manila'},
          {id:bangkok,name:'Bangkok fixture',timezone:'Asia/Bangkok'}],
        '/clinic/bookings':[], '/clinic/inbox':req.searchParams.get('locationId')===cebu ? [{
          event_key:'morning-callback', channel:'ai_phone', kind:'call.followup_needed', summary:'Call back caller',
          occurred_at:'2026-11-20T03:00:00Z',details:{}
        }] : [],
        '/clinic/messenger/setups':role==='staff'?[]:[{locationId:cebu,clinicName:'Cebu fixture',facts}],
        '/clinic/connections':req.searchParams.get('locationId')===cebu ?
          [{channel:'website_chat',status:'connected'},{channel:'facebook_messenger',status:messengerStatus}]
            .map(row=>({...row,account_id:account,location_id:cebu})) : []
      };
      assert.ok(Object.hasOwn(responses,req.pathname),req.pathname);
      return Response.json(responses[req.pathname]);
    };
    const earlyBootstrap = [...doc.scripts].find(script=>script.textContent.includes('edenClinicConfigRequest'));
    assert.ok(earlyBootstrap,'The workspace head must start the configuration request');
    const sdk = [...doc.scripts].find(script=>script.src.includes('supabase.min.js'));
    assert.ok(earlyBootstrap.compareDocumentPosition(sdk) & win.Node.DOCUMENT_POSITION_FOLLOWING);
    win.eval(earlyBootstrap.textContent);
    assert.equal(configReads,1);
    assert.equal(sessionChecks,0,'Public configuration should start before the sign-in SDK is available');
    win.supabase = {createClient:()=>({
      auth:{
        getSession:async()=>{sessionChecks++;return {data:{session}};},
        refreshSession:async()=>{
          tokenRefreshes++;
          session = {...session,access_token:'recovered'};
          return {data:{session}};
        },
        onAuthStateChange(listener){authChanged=listener;}
      },
      async rpc(name,args) {
        requests.push([name,args]);
        if (name==='workspace_clinic_facts') {
          if (args.p_facts) {
            factsWrites++;
            assert.equal(args.p_location,cebu);
            assert.equal(args.p_expected,approvedFacts);
            approvedFacts = {...args.p_facts,profileApprovedAt:'2026-11-21T04:00:00Z'};
          }
          return {data:approvedFacts};
        }
        if (name==='eden_save_reply_feedback') return {data:null};
        if (name==='eden_support_notifications') return {data:args.p_location===cebu && supportPending ?
          [{id:'access-1',kind:'access',target:'website_chat'}] : []};
        if (name==='eden_support_inbox') return {data:[{id:'access-1',kind:'access',target:'website_chat',
          operator_email:'agent@example.test',created_at:'2026-11-22T10:00:00Z',decision:supportPending?'pending':'dismissed'}]};
        if (name==='eden_review_support_request') {
          assert.equal(args.p_request,'access-1');
          assert.equal(args.p_approve,false);
          supportPending=false;
        }
        if (name==='current_rescue_period') {
          if (args.p_location===cebu && delayCebu) return new Promise(resolve=>{ resolveCebu=resolve; });
          return {data:{...dates,...data[args.p_location]}};
        }
        return {data:[]};
      },
      from(table) {
        const builder = {select:()=>builder,eq:()=>builder,order:()=>builder,
          maybeSingle:async()=>({data:table==='clinic_memberships'?{role}:null}),
          then(resolve){resolve({data:[]});}};
        return builder;
      }
    })};
    win.eval([rescue, operations, knowledge, help, workspace].join('\n'));
    const overview = doc.querySelector('#clinic-owner-overview');
    const hero = doc.querySelector('.clinic-hero');
    const overviewNav = doc.querySelector('.clinic-view-switch a[href*="view=overview"]');
    const clinicStatus = doc.querySelector('#clinic-status');
    const revenue = doc.querySelector('#clinic-overview-revenue');
    const channels = doc.querySelector('#clinic-overview-connections');
    const picker = doc.querySelector('#clinic-location');
    const amount = (minor,currency)=>new win.Intl.NumberFormat(undefined,{style:'currency',currency}).format(minor/100);
    if (role==='admin') {
      await until(()=>clinicStatus.querySelector('button')?.textContent==='Retry workspace');
      clinicStatus.querySelector('button').click();
    }
    await until(()=>clinicStatus.dataset.kind==='success' &&
      (role==='staff' ? !doc.querySelector('#clinic-daily-view').hidden : !overview.hidden));
    assert.equal(configReads,role==='admin'?2:1,'Use the early request once, then fetch fresh on retry');
    assert.equal(overviewNav.hidden,role==='staff');
    const profileNav = doc.querySelector('.clinic-view-switch a[href*="view=profile"]');
    assert.equal(profileNav.hidden,role==='staff');
    assert.ok(doc.body.classList.contains('clinic-workspace-signed-in'));
    const helpDialog=doc.querySelector('#eden-help');
    helpDialog.show=()=>{helpDialog.open=true;};
    helpDialog.close=()=>{helpDialog.open=false;};
    const submitToEden=question=>{
      doc.querySelector('#clinic-open-support').click();
      doc.querySelector('#eden-help-question').value=question;
      helpDialog.querySelector('.eden-help-composer').dispatchEvent(new win.Event('submit',{cancelable:true}));
      return [...helpDialog.querySelectorAll('.eden-help-answer')].at(-1);
    };
    const askEden=async question=>{
      const answer=submitToEden(question);
      await until(()=>answer.querySelector('details'));
      return answer;
    };
    assert.match((await askEden('My sign-in link goes to localhost')).textContent,/fresh sign-in email/);
    const connectionAnswer=await askEden('Messenger stopped connecting');
    assert.match(connectionAnswer.textContent,/Cebu fixture · Facebook Messenger: Action needed/);
    assert.equal(connectionAnswer.querySelector('.eden-help-action').textContent,'Open Facebook Messenger in Connect');
    messengerStatus = 'connected';
    const followUp=await askEden('I already sent a test and nothing showed up.');
    assert.match(followUp.textContent,/Cebu fixture · Facebook Messenger: Connected/);
    assert.match(followUp.textContent,/Daily Action/);
    assert.deepEqual(supportReads,[cebu,cebu]);
    messengerStatus = 'action_required';
    const unfamiliar=await askEden('How do I export my data?');
    assert.match(unfamiliar.textContent,/What were you trying to do/);
    const feedback=unfamiliar.querySelector('.eden-help-feedback');
    assert.equal(feedback.open,false);
    feedback.querySelector('summary').click();
    feedback.querySelector('[aria-label="9 out of 10"]').click();
    await until(()=>requests.filter(([name])=>name==='eden_save_reply_feedback').length===1);
    feedback.querySelector('textarea').value='The next step was clear.';
    feedback.querySelector('.eden-help-done').click();
    await until(()=>feedback.open===false);
    const [rating,saved]=requests.filter(([name])=>name==='eden_save_reply_feedback');
    assert.equal(saved[1].p_id,rating[1].p_id);
    assert.equal(saved[1].p_rating,9);
    assert.equal(saved[1].p_comment,'The next step was clear.');
    assert.match(saved[1].p_reply,/What were you trying to do/);
    const alertCount=doc.querySelector('#clinic-alert-count');
    if (role==='owner') {
      await until(()=>alertCount.textContent==='2');
      const guidance=await askEden('I can’t see the access request');
      assert.match(guidance.textContent,/open Alerts/i);
      guidance.querySelector('.eden-help-action').click();
      assert.equal(doc.querySelector('#clinic-alerts-menu').open,true);
      const notice=doc.querySelector('#clinic-support-alerts button');
      assert.match(notice.textContent,/Eden requested support access.*Website Chat/);
      notice.click();
      await until(()=>doc.activeElement===doc.querySelector('#eden-review-access-1 > summary'));
      assert.equal(new URL(win.location.href).searchParams.get('view'),'settings');
      assert.equal(doc.querySelector('#clinic-alerts-menu').open,false);
      [...doc.querySelectorAll('#eden-review-access-1 button')].find(button=>button.textContent==='Dismiss').click();
      await until(()=>alertCount.textContent==='1');
      assert.equal(doc.querySelector('#clinic-support-alerts').hidden,true);
      overviewNav.click();
    } else {
      const guidance=await askEden('Where is the access request?');
      assert.match(guidance.textContent,/Ask the clinic owner/);
      assert.equal(guidance.querySelector('.eden-help-action'),null);
      helpDialog.close();
      assert.equal(alertCount.textContent,'1');
      assert.ok(!requests.some(([name])=>name==='eden_support_notifications'));
    }
    assert.equal(helpDialog.querySelector('.eden-help-address').textContent,'team@clinicnet.live');
    assert.equal(helpDialog.querySelector('a[href^="mailto:"]'),null);
    assert.deepEqual([...feedback.querySelectorAll('.eden-help-ratings button')].map(button=>button.textContent),
      ['1','2','3','4','5','6','7','8','9','10']);
    assert.equal(hero.hidden,true);
    const accountMenu = doc.querySelector('#clinic-account-menu');
    assert.ok(accountMenu.querySelector('#clinic-signout'));
    assert.doesNotMatch(accountMenu.textContent,/\bnull\b/);
    if (role==='staff') {
      assert.equal(overview.hidden,true);
      assert.equal(doc.querySelector('.clinic-view-switch a[href*="view=revenue"]').hidden,true);
      assert.ok(!requests.some(([name])=>['current_rescue_period','workspace_clinic_facts'].includes(name)));
      doc.querySelector('.clinic-view-switch a[href*="view=setup"]').click();
      assert.equal(doc.querySelector('#clinic-connect-next').hidden,true);
      assert.match(doc.querySelector('#clinic-channels').textContent,/View status/);
      continue;
    }
    await until(()=>revenue.textContent.includes(amount(1800000,'PHP')));
    assert.match(revenue.textContent,/Booking revenue.*Eden fee.*Net revenue/s);
    assert.ok(revenue.textContent.includes(amount(195000,'PHP')));
    assert.ok(revenue.textContent.includes(amount(1605000,'PHP')));
    assert.equal(doc.querySelector('.clinic-location-switcher').open,false);
    assert.match(channels.textContent,/Website.*Connected.*Messenger.*Action needed.*Not set up/s);
    assert.match(doc.querySelector('#clinic-home-attention').textContent,/1 missed call needs a callback/);
    doc.querySelector('#clinic-home-attention').click();
    assert.equal(doc.querySelector('[data-filter=attention]').getAttribute('aria-pressed'),'true');
    overviewNav.click();
    doc.querySelector('#clinic-alerts-menu').open = true;
    doc.querySelector('#clinic-workspace-alerts button').click();
    assert.equal(doc.querySelector('#clinic-daily-view').hidden,false);
    assert.equal(doc.activeElement.dataset.eventKey,'morning-callback');
    profileNav.click();
    assert.equal(doc.querySelector('#clinic-profile-view').hidden,false);
    assert.match(doc.querySelector('#clinic-profile-location').textContent,/Cebu/);
    assert.equal(new URL(profileNav.href).searchParams.get('location'),cebu);
    await until(()=>Boolean(doc.querySelector('.clinic-approved-facts-form')));
    const approvedForm = doc.querySelector('.clinic-approved-facts-form');
    assert.match(approvedForm.textContent,/I approve these facts for patient-facing use on Messenger/);
    const editor = doc.querySelector('#clinic-profile-website_chat');
    assert.equal(editor.textContent,'Edit AI receptionist');
    approvedForm.querySelector('a[href="#clinic-profile-website_chat"]').click();
    assert.equal(doc.activeElement,editor);
    assert.equal(editorRequests,0);
    approvedForm.querySelector('a[href="#clinic-profile-ai_phone"]').click();
    assert.equal(doc.activeElement,doc.querySelector('#clinic-profile-ai_phone'));
    editor.click();
    assert.equal(doc.querySelector('#clinic-setup-view').hidden,true);
    assert.equal(new URL(win.location.href).searchParams.get('view'),'profile');
    const editorStatus = doc.querySelector('#clinic-profile-editor-status');
    await until(()=>editorStatus.dataset.kind==='error');
    assert.match(editorStatus.textContent,/AI receptionist editor is temporarily unavailable/);
    assert.equal(editorRequests,1);
    assert.equal(editor.disabled,false);
    doc.querySelector('#clinic-profile-facebook_messenger').click();
    assert.equal(doc.activeElement,approvedForm.elements.services);
    for (const area of approvedForm.querySelectorAll('textarea')) area.value = 'Fixture '+area.name;
    approvedForm.elements.approved.checked = true;
    approvedForm.dispatchEvent(new win.Event('submit',{cancelable:true}));
    await until(()=>approvedForm.textContent.includes('Approved facts saved'));
    assert.equal(factsWrites,1);
    assert.equal(approvedFacts.hours,'Fixture hours');
    assert.match((await askEden('Why was this visit counted in the settlement?')).textContent,/View counted visits/);
    doc.querySelector('#clinic-open-settings').click();
    assert.equal(doc.querySelector('#clinic-settings-view').hidden,false);
    assert.ok(doc.querySelector('#clinic-settings-view #clinic-team-invite'));
    overviewNav.click();
    channels.querySelector('a').click();
    assert.equal(doc.querySelector('#clinic-setup-view').hidden,false);
    assert.equal(doc.querySelector('#clinic-channel-website_chat').open,true);
    assert.equal(doc.querySelector('#clinic-connect-progress').textContent,'1 of 3 connected');
    assert.equal(doc.querySelector('#clinic-connect-next-title').textContent,'Facebook Messenger');
    doc.querySelector('#clinic-connect-next-action').click();
    assert.equal(doc.querySelector('#clinic-channel-facebook_messenger').open,true);
    assert.deepEqual([...doc.querySelectorAll('#clinic-messenger-steps .clinic-connect-stage')].map(x=>x.textContent),
      ['Saved','Ready to authorize','After authorization']);
    doc.querySelector('#clinic-messenger-profile-facts').click();
    assert.equal(doc.querySelector('#clinic-profile-view').hidden,false);
    assert.equal(doc.activeElement,approvedForm.elements.services);
    channels.querySelector('[data-channel="facebook_messenger"]').click();
    messengerStatus = 'verifying';
    doc.querySelector('#clinic-refresh').click();
    await until(()=>doc.querySelector('#clinic-connect-next-action').textContent==='Review test steps');
    assert.deepEqual([...doc.querySelectorAll('#clinic-messenger-steps .clinic-connect-stage')].map(x=>x.textContent),
      ['Saved','Authorized','Ready to test']);
    assert.equal(doc.querySelector('#clinic-connect-progress').textContent,'1 of 3 connected');
    messengerStatus = 'connected';
    doc.querySelector('#clinic-refresh').click();
    await until(()=>doc.querySelector('#clinic-connect-progress').textContent==='2 of 3 connected');
    assert.deepEqual([...doc.querySelectorAll('#clinic-messenger-steps .clinic-connect-stage')].map(x=>x.textContent),
      ['Saved','Authorized','Connected']);
    assert.equal(doc.querySelector('#clinic-connect-next-title').textContent,'AI Phone');
    overviewNav.click();
    const report = doc.querySelector('#clinic-overview-open-report');
    assert.equal(new URL(report.href).searchParams.get('location'),cebu);
    report.click();
    assert.equal(doc.querySelector('#clinic-revenue-view').hidden,false);
    assert.equal(doc.querySelector('#clinic-daily-view').hidden,true);
    assert.equal(doc.querySelector('#clinic-rescue').open,true);
    assert.equal(hero.hidden,true);

    overviewNav.click();
    delayCebu = true;
    doc.querySelector('#clinic-refresh').click();
    await until(()=>Boolean(resolveCebu));
    delayConnections = true;
    const previousClinicAnswer=submitToEden('Is Messenger connected?');
    await until(()=>Boolean(resolveConnections));
    picker.value = bangkok;
    picker.dispatchEvent(new win.Event('change'));
    await until(()=>revenue.textContent.includes(amount(100000,'THB')));
    resolveCebu({data:{...dates,...data[cebu]}});
    await pause(0);
    assert.ok(!revenue.textContent.includes(amount(1300000,'PHP')));
    assert.ok(revenue.textContent.includes(amount(20000,'THB')));
    assert.ok(!channels.textContent.includes('Connected'));
    assert.ok(doc.querySelector('#clinic-alert-count').hidden);
    assert.doesNotMatch(doc.querySelector('#clinic-workspace-alerts').textContent,/Missed call/);
    assert.equal(new URL(report.href).searchParams.get('location'),bangkok);
    delayConnections = false;
    resolveConnections(Response.json([{channel:'facebook_messenger',status:'connected',account_id:account,location_id:cebu}]));
    await pause(0);
    assert.equal(previousClinicAnswer.isConnected,false);
    assert.doesNotMatch(helpDialog.textContent,/Cebu fixture/);
    assert.match((await askEden('Is Messenger connected?')).textContent,/Bangkok fixture · Facebook Messenger: Not set up/);
    assert.equal(supportReads.at(-1),bangkok);
    const phone=await askEden('Can you check AI Phone?');
    assert.match(phone.textContent,/Bangkok fixture · AI Phone: Not set up/);
    phone.querySelector('.eden-help-action').click();
    assert.equal(doc.querySelector('#clinic-channel-ai_phone').open,true);
    assert.equal(helpDialog.open,false);
    if (role!=='staff') overviewNav.click();
    activityFailure = 'offline';
    const unavailable=await askEden('Is Website Chat connected?');
    assert.match(unavailable.textContent,/couldn’t check Website Chat for Bangkok fixture/);
    assert.equal(unavailable.querySelector('.eden-help-action'),null);
    activityFailure = undefined;
    if (role !== 'owner') continue;
    delayCebu = false;
    await until(()=>!doc.querySelector('#clinic-refresh').disabled);
    const beforeTokenChange = accountReads;
    session = {...session,access_token:'rotated'};
    authChanged('TOKEN_REFRESHED',session);
    await pause(10);
    assert.equal(accountReads,beforeTokenChange,'Token rotation must not rebuild the workspace');
    assert.ok(revenue.textContent.includes(amount(20000,'THB')));

    const beforeWake = sessionChecks;
    visibility(true);
    clock += 8 * 60 * 60 * 1000;
    visibility(false);
    await until(()=>sessionChecks===beforeWake+1 && !doc.querySelector('#clinic-refresh').disabled);
    assert.equal(accountReads,beforeTokenChange);
    assert.equal(picker.value,bangkok);

    activityFailure = 'offline';
    doc.querySelector('#clinic-refresh').click();
    await until(()=>clinicStatus.querySelector('button')?.textContent==='Retry workspace');
    assert.doesNotMatch(revenue.textContent,/Loading clinic/);
    assert.match(revenue.textContent,/Clinic details are unavailable/);
    activityFailure = undefined;
    win.dispatchEvent(new win.Event('online'));
    await until(()=>clinicStatus.dataset.kind==='success' && revenue.textContent.includes(amount(20000,'THB')));
    assert.equal(accountAuthorization,'Bearer rotated');
    assert.equal(picker.value,bangkok);

    await until(()=>!doc.querySelector('#clinic-refresh').disabled);
    activityFailure = 'unauthorized';
    doc.querySelector('#clinic-refresh').click();
    await until(()=>clinicStatus.querySelector('button')?.textContent==='Retry workspace');
    assert.match(clinicStatus.textContent,/session could not be verified/);
    activityFailure = undefined;
    clinicStatus.querySelector('button').click();
    await until(()=>clinicStatus.dataset.kind==='success' && revenue.textContent.includes(amount(20000,'THB')));
    assert.equal(tokenRefreshes,1);
    assert.equal(accountAuthorization,'Bearer recovered');

    await until(()=>!doc.querySelector('#clinic-refresh').disabled);
    visibility(true);
    clock += 8 * 60 * 60 * 1000;
    session = null;
    visibility(false);
    await until(()=>!doc.querySelector('#clinic-signin').hidden);
    assert.equal(doc.querySelector('#clinic-authenticated').hidden,true);
  } finally { dom.window.close(); }
}
console.log('PASS Owner Overview and Connect Clinic role access, navigation, channel verification, workspace navigation, alert routing, location isolation, and session recovery.');
