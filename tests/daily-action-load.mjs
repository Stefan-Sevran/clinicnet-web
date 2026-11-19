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
