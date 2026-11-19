import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {setTimeout as pause} from 'node:timers/promises';

const {JSDOM} = createRequire(import.meta.url)(process.env.EDEN_JSDOM_MODULE || 'jsdom');
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const [html, rescue, workspace] = await Promise.all([
  read('clinic/index.html'), read('assets/clinic-rescue.js'), read('assets/clinic.js')
]);
const locationId = '10000000-0000-4000-8000-000000000001';
const accountId = '20000000-0000-4000-8000-000000000002';
const reportId = '30000000-0000-4000-8000-000000000003';

for (const requestedLocation of [null, locationId, 'other']) {
  const url = new URL('https://workspace.test/clinic/?view=daily');
  if (requestedLocation) {
    url.searchParams.set('location', requestedLocation);
    url.searchParams.set('report', reportId);
  }
  const dom = new JSDOM(html,{url,runScripts:'outside-only'});
  try {
    const win = dom.window;
    const calls = [];
    win.fetch = async raw => {
      const request = new URL(raw);
      const responses = {
        '/clinic/public-config':{supabaseUrl:'https://example.test',publishableKey:'fixture'},
        '/clinic/accounts':[{id:accountId,name:'Demo clinic'}],
        '/clinic/locations':[{id:locationId,name:'Cebu fixture',timezone:'Asia/Manila'}],
        '/clinic/bookings':[], '/clinic/inbox':[], '/clinic/connections':[{channel:'website_chat',status:'connected'}]
      };
      assert.ok(Object.hasOwn(responses,request.pathname),request.pathname);
      calls.push(request);
      return Response.json(responses[request.pathname]);
    };
    win.supabase = {createClient:()=>({
      auth:{getSession:async()=>({data:{session:{access_token:'fixture',user:{id:'owner',email:'owner@example.test'}}}}),onAuthStateChange(){}},
      rpc:async()=>({data:[]}),
      from(table){
        const builder = {select:()=>builder,eq:()=>builder,order:()=>builder,
          maybeSingle:async()=>({data:table==='clinic_memberships'?{role:'owner'}:null}),
          then(resolve){resolve({data:[]});}};
        return builder;
      }
    })};
    win.eval(rescue + '\n' + workspace);
    const status = win.document.querySelector('#clinic-status');
    for (let i=0;i<100 && !['success','error'].includes(status.dataset.kind);i++) await pause(10);
    assert.equal(status.textContent,'Workspace loaded for Cebu fixture.');
    const reports = win.document.querySelector('#clinic-rescue');
    assert.equal(reports.hidden,false);
    assert.equal(reports.open,requestedLocation===locationId);
    reports.open = true;
    for (let i=0;i<100 && !reports.textContent.includes('Set up reporting');i++) await pause(10);
    assert.match(reports.textContent,/Set up reporting/);
    const inbox = calls.find(request=>request.pathname==='/clinic/inbox');
    assert.equal(inbox.searchParams.get('accountId'),accountId);
    assert.equal(inbox.searchParams.get('locationId'),locationId);
  } finally { dom.window.close(); }
}
console.log('PASS signed-in Daily Action loads and report links respect the selected location.');

const dom = new JSDOM(html,{url:'https://workspace.test/clinic/?view=daily',runScripts:'outside-only'});
try {
  const { window:win } = dom;
  const document = win.document;
  const api = win.eval(rescue + '\nClinicRescue');
  const coin = (minor,currency) => new win.Intl.NumberFormat(undefined,{style:'currency',currency}).format(minor/100);
  const appointment = '2026-11-19T04:00:00Z';
  const early = '2026-11-19T03:00:00Z';
  const late = '2026-11-19T05:00:00Z';
  const event = {location_id:locationId,event_key:'walk-in',channel:'staff_booking'};
  const events = [
    {event_key:'valid',channel:'website_chat',kind:'booking.requested',occurred_at:early},
    {event_key:'late',channel:'facebook_messenger',kind:'booking.requested',occurred_at:late},
    {event_key:'demo',channel:'ai_phone',kind:'call.followup_needed',occurred_at:early,details:{demo:true}}
  ];
  async function payment(raw,currency,expected,{confirm=false,visit,invalid=false}={}) {
    const row = document.createElement('div');
    document.body.append(row);
    const calls = [];
    const formClient = {rpc:async (name,args)=>{calls.push([name,args]);return {};}};
    api.visitControls(row,{event,latest:{appointment_at:appointment},events,client:formClient,currency,
      timezone:'Asia/Manila',visit,refresh:async()=>row.remove()});
    row.querySelector('button').click();
    const form = row.querySelector('form');
    const input = form.querySelector('input');
    const save = form.querySelector('button:not([type="button"])');
    const source = form.querySelectorAll('select')[1];
    assert.deepEqual([...source.options].map(option=>option.value),['','valid']);
    source.value = 'valid';
    if (raw !== undefined) input.value = raw;
    input.dispatchEvent(new win.Event('input'));
    function submit() {form.dispatchEvent(new win.Event('submit',{cancelable:true}));}
    if (confirm || invalid) {
      assert.equal(save.disabled,true);
      submit();
      assert.equal(calls.length,0,'An unresolved payment must never reach the RPC');
      if(invalid) {row.remove();return;}
      const choice = [...form.querySelectorAll('button')].find(button=>button.textContent==='Use '+coin(expected,currency));
      assert.ok(choice);
      choice.click();
    }
    assert.equal(save.disabled,false);
    const expectedPreview = expected === null ? 'Will record the visit with the amount unknown.' : 'Will record '+coin(expected,currency);
    assert.ok(form.textContent.includes(expectedPreview));
    submit();
    await pause(0);
    assert.equal(calls.length,1);
    assert.equal(calls[0][0],'record_clinic_visit');
    assert.equal(calls[0][1].p_amount_minor,expected);
    assert.equal(calls[0][1].p_currency,currency);
    assert.equal(calls[0][1].p_source,'valid');
  }
  await payment('5000','PHP',500000);
  await payment('5,000','PHP',500000,{confirm:true});
  await payment('5 000','PHP',500000);
  await payment('5.000','PHP',500000,{confirm:true});
  await payment('5.000 PHP','PHP',500000,{confirm:true});
  await payment('5.000','PHP',500,{confirm:true});
  await payment('฿5,000.25','THB',500025);
  await payment('USD 5.000,25','USD',500025);
  await payment('0','THB',0);
  await payment('','PHP',null);
  await payment('0','THB',0,{visit:{currency:'THB',amount_minor:200,revision:1}});
  await payment('','PHP',null,{visit:{currency:'PHP',amount_minor:200,revision:1},invalid:true});
  await payment('5,00.00','PHP',null,{invalid:true});
  await payment('5,000 USD','PHP',null,{invalid:true});
  await payment('1e4','PHP',null,{invalid:true});
  await payment('1000000000','PHP',null,{invalid:true});

  const privateCalls = [];
  const counted = [
    {ref:'request-1',channel:'website_chat',inquiry_at:early,visit_at:appointment,amount_minor:500000,estimated_fee_minor:75000,free:false},
    {ref:'request-2',channel:'facebook_messenger',inquiry_at:early,visit_at:appointment,amount_minor:800000,estimated_fee_minor:120000,free:false},
    {ref:'request-3',channel:'ai_phone',inquiry_at:early,visit_at:appointment,amount_minor:100000,estimated_fee_minor:0,free:true}
  ];
  const period = {period_start:'2026-11-19',through:'2026-11-19',currency:'PHP',rate_bps:1500,
    eligible_minor:1300000,collected_minor:1400000,estimated_share_minor:195000,counted_visits:counted};
  const historical = {id:reportId,kind:'settlement',period_start:'2026-11-01',period_end:'2026-12-01',approved_at:early,
    snapshot:{...period,share_minor:195000,channels:{},entries:[]}};
  const client = {
    async rpc(name,args) {
      privateCalls.push([name,args]);
      return {data:name==='current_rescue_period' ? period : name==='clinic_visit_attribution_reviews' ?
        [{reference:'Review fixture',channel:'website_chat',inquiry_at:late,visit_at:appointment}] : null};
    },
    from(table) {
      const builder = {
        select:()=>builder,eq:(field,value)=>{
          assert.equal(field,'location_id');assert.equal(value,locationId);return builder;
        },
        order:()=>builder,
        maybeSingle:async()=>({data:{currency:'PHP',rate_bps:1500}}),
        then:resolve=>resolve({data:[historical]})
      };
      assert.ok(['clinic_rescue_settings','clinic_rescue_reports'].includes(table));
      return builder;
    }
  };
  const ownerCtx = {client,locationId,timezone:'Asia/Manila',clinicName:'Example',email:'owner@example.test'};
  api.reports({...ownerCtx,manager:false});
  const reports = document.querySelector('#clinic-rescue');
  assert.equal(reports.hidden,true);
  assert.equal(privateCalls.length,0);
  api.reports({...ownerCtx,manager:true});
  reports.open = true;
  for (let i=0;i<100 && !reports.textContent.includes('Current period so far');i++) await pause(10);
  const [paid,free,settlement] = [...reports.querySelectorAll('details')].filter(d=>d.firstChild.textContent.startsWith('View counted visits'));
  paid.open = true;
  for (const minor of [195000,75000,120000]) {
    assert.ok((minor===195000 ? reports : paid).textContent.includes(coin(minor,'PHP')));
  }
  assert.ok(paid.textContent.includes('request-1'));
  assert.ok(paid.textContent.includes('Facebook Messenger'));
  assert.ok(!paid.textContent.includes('request-3'));
  assert.ok(free.textContent.includes('No Eden fee applies'));
  assert.ok(settlement.textContent.includes('request-2'));
  api.attributionReviews(ownerCtx);
  const reviews = document.querySelector('#clinic-attribution-reviews');
  reviews.open = true;
  for (let i=0;i<100 && !reviews.textContent.includes('Review fixture');i++) await pause(10);
  assert.match(reviews.textContent,/Review fixture.*Website chat/s);
  assert.match(reviews.textContent,/Payments are still recorded/);
  assert.ok(privateCalls.every(([,args])=>args.p_location===locationId));
  console.log('PASS payment previews, confirmed amounts, counted visits, and attribution review display.');
} finally {
  dom.window.close();
}
