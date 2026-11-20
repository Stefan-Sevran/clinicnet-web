import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as pause } from 'node:timers/promises';

const { JSDOM } = createRequire(import.meta.url)(process.env.EDEN_JSDOM_MODULE || 'jsdom');
const [html, rescue, workspace] = await Promise.all(['clinic/index.html','assets/clinic-rescue.js','assets/clinic.js']
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
    let resolveCebu;
    let delayCebu = false;
    win.fetch = async raw => {
      const req = new URL(raw);
      const responses = {
        '/clinic/public-config':{supabaseUrl:'https://example.test',publishableKey:'fixture'},
        '/clinic/accounts':[{id:account,name:'Eden fixture'}],
        '/clinic/locations':[{id:cebu,name:'Cebu fixture',timezone:'Asia/Manila'},
          {id:bangkok,name:'Bangkok fixture',timezone:'Asia/Bangkok'}],
        '/clinic/bookings':[], '/clinic/inbox':[],
        '/clinic/connections':req.searchParams.get('locationId')===cebu ?
          [{channel:'website_chat',status:'connected'},{channel:'facebook_messenger',status:'action_required'}] : []
      };
      assert.ok(Object.hasOwn(responses,req.pathname),req.pathname);
      return Response.json(responses[req.pathname]);
    };
    win.supabase = {createClient:()=>({
      auth:{getSession:async()=>({data:{session:{access_token:'fixture',user:{id:'member',email:'fixture@example.test'}}}}),
        onAuthStateChange(){}},
      async rpc(name,args) {
        requests.push([name,args]);
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
    win.eval(rescue+'\n'+workspace);
    const overview = doc.querySelector('#clinic-owner-overview');
    const hero = doc.querySelector('.clinic-hero');
    const overviewNav = doc.querySelector('.clinic-view-switch a[href*="view=overview"]');
    const clinicStatus = doc.querySelector('#clinic-status');
    const revenue = doc.querySelector('#clinic-overview-revenue');
    const channels = doc.querySelector('#clinic-overview-connections');
    const picker = doc.querySelector('#clinic-location');
    const amount = (minor,currency)=>new win.Intl.NumberFormat(undefined,{style:'currency',currency}).format(minor/100);
    await until(()=>clinicStatus.dataset.kind==='success' &&
      (role==='staff' ? !doc.querySelector('#clinic-daily-view').hidden : !overview.hidden));
    assert.equal(overviewNav.hidden,role==='staff');
    assert.equal(hero.hidden,role!=='staff');
    if (role==='staff') {
      assert.equal(overview.hidden,true);
      assert.ok(!requests.some(([name])=>name==='current_rescue_period'));
      continue;
    }
    await until(()=>revenue.textContent.includes(amount(1300000,'PHP')));
    assert.match(revenue.textContent,/Paid-period collections.*Estimated Eden fee.*Free-pilot collections/s);
    assert.ok(revenue.textContent.includes(amount(195000,'PHP')));
    assert.match(channels.textContent,/Website.*Connected.*Messenger.*Action needed.*Not set up/s);
    channels.querySelector('a').click();
    assert.equal(doc.querySelector('#clinic-setup-view').hidden,false);
    assert.equal(doc.querySelector('#clinic-channel-website_chat').open,true);
    overviewNav.click();
    const report = doc.querySelector('#clinic-overview-open-report');
    assert.equal(new URL(report.href).searchParams.get('location'),cebu);
    report.click();
    assert.equal(doc.querySelector('#clinic-daily-view').hidden,false);
    assert.equal(doc.querySelector('#clinic-rescue').open,true);
    assert.equal(hero.hidden,false);

    overviewNav.click();
    delayCebu = true;
    doc.querySelector('#clinic-refresh').click();
    await until(()=>Boolean(resolveCebu));
    picker.value = bangkok;
    picker.dispatchEvent(new win.Event('change'));
    await until(()=>revenue.textContent.includes(amount(100000,'THB')));
    resolveCebu({data:{...dates,...data[cebu]}});
    await pause(0);
    assert.ok(!revenue.textContent.includes(amount(1300000,'PHP')));
    assert.ok(revenue.textContent.includes(amount(20000,'THB')));
    assert.ok(!channels.textContent.includes('Connected'));
    assert.equal(new URL(report.href).searchParams.get('location'),bangkok);
  } finally { dom.window.close(); }
}
console.log('PASS Owner Overview role access, report links, live channel states, and stale-location isolation.');
