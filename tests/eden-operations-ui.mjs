import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as tick } from 'node:timers/promises';

const {JSDOM} = createRequire(import.meta.url)(process.env.EDEN_JSDOM_MODULE || 'jsdom');
const dom = new JSDOM('<main></main>',{runScripts:'outside-only'});
const win = dom.window;
const main = win.document.querySelector('main');
const script = await readFile(new URL('../assets/clinic-operations.js',import.meta.url),'utf8');
const operations = win.eval(script + '\nClinicOperations');
const facts = {services:'Checkups',hours:'9–5',address:'Cebu',bookingRules:'Staff confirm'};
const grants = ['read','messenger_facts'].map(scope=>({
  grant_id:scope,account_name:'Test Business',location_name:'Cebu',scope,expires_at:'2099-06-01T12:00:00Z'
}));
const terms = [{id:'initial',kind:'initial',effective_on:'2099-06-01',rate_bps:1500,accepted_at:null}];
const actions = [];
let supportChanges=[];
const client = {rpc:async(name,args)=>{
  actions.push([name,args]);
  if (name==='eden_support_locations') return {data:grants};
  if (name==='eden_finance_locations') return {data:[{location_id:'cebu',account_name:'Test Business',location_name:'Cebu'}]};
  if (name==='eden_support_messenger_facts') return {data:facts};
  if (name==='eden_support_diagnostics') return {data:[{channel:'facebook_messenger',status:'verifying',updated_at:'2026-11-23T10:00:00Z'}]};
  if (name==='eden_propose_support_change') {
    supportChanges=[{id:'change-1',decision:'pending',operator_email:'agent@example.test',
      proposed_at:'2026-11-23T10:00:00Z',before_values:{hours:facts.hours},proposed_values:args.p_changes}];
    return {data:'change-1'};
  }
  if (name==='eden_support_changes') return {data:supportChanges};
  if (name==='eden_review_support_change') {
    supportChanges[0].decision=args.p_action==='approve'?'approved':'undone';
    return {data:args.p_action==='approve'?{...facts,...supportChanges[0].proposed_values}:facts};
  }
  if (name==='eden_review_rescue_terms') return {data:terms};
  if (name==='eden_support_activity') return {data:[{
    grant_id:'read',operator_email:'agent@example.test',scope:'read',occurred_at:'2099-06-01T09:00:00Z',
    expires_at:'2099-06-01T12:00:00Z',action:'granted'
  }]};
  return {data:null};
}};
try {
  assert.equal(await operations.operators(client,main),true);
  const [support,finance]=main.querySelectorAll('details');
  const location=support.querySelector('select');
  assert.match(location.textContent,/Test Business · Cebu · Read only/);
  location.value='read';
  await location.onchange();
  assert.equal(support.querySelectorAll('textarea').length,0);
  await tick(0);
  assert.match(support.textContent,/Opening hours9–5/);
  assert.match(support.textContent,/Messenger · Verification pending/);
  assert.equal(support.querySelector('button'),null);
  location.value='messenger_facts';
  await location.onchange();
  const editor=support.querySelector('form');
  editor.querySelectorAll('textarea')[1].value='10–5';
  editor.dispatchEvent(new win.Event('submit',{cancelable:true}));
  await tick(0);
  const [,edit]=actions.at(-1);
  assert.equal(edit.p_grant,'messenger_facts');
  assert.equal(edit.p_expected.hours,'9–5');
  assert.deepEqual(JSON.parse(JSON.stringify(edit.p_changes)),{hours:'10–5'});
  assert.match(editor.textContent,/Sent for owner approval/);

  const financeForm=finance.querySelector('form');
  financeForm.querySelector('input[type=date]').value='2099-06-01';
  financeForm.querySelector('input[type=number]').value='15';
  financeForm.dispatchEvent(new win.Event('submit',{cancelable:true}));
  await tick(0);
  const sent=actions.find(([name])=>name==='eden_propose_rescue_terms')[1];
  assert.equal(sent.p_location,'cebu');
  assert.equal(sent.p_effective_on,'2099-06-01');
  assert.equal(sent.p_rate_bps,1500);
  assert.match(finance.textContent,/Awaiting clinic approval/);

  let liveFacts;
  const owner=operations.owner(client,'cebu',updated=>{ liveFacts=updated; });
  main.append(owner);
  owner.open=true;
  await tick(10);
  const proposal=owner.querySelector('.clinic-ops-review');
  assert.equal(proposal.open,true);
  assert.match(proposal.textContent,/Before 9–5Proposed 10–5/);
  [...proposal.querySelectorAll('button')].find(item=>item.textContent==='Approve changes').click();
  await tick(0);
  assert.equal(liveFacts.hours,'10–5');
  [...owner.querySelectorAll('button')].find(item=>item.textContent==='Undo changes').click();
  await tick(0);
  assert.equal(liveFacts.hours,'9–5');
  assert.match(owner.textContent,/Previous Messenger facts restored/);
  [...owner.querySelectorAll('button')].find(item=>item.textContent==='Revoke access').click();
  await tick(0);
  assert.ok(actions.some(([name,args])=>name==='eden_revoke_support' && args.p_grant==='read'));
  let reloaded=false;
  const holder=win.document.createElement('div');
  main.append(holder);
  await operations.reportTerms(holder,{client,owner:true,locationId:'cebu'},async()=>{reloaded=true;});
  assert.match(holder.textContent,/Eden share 15%/);
  holder.querySelector('button').click();
  await tick(0);
  assert.equal(reloaded,true);
  const [,approved]=actions.at(-1);
  assert.equal(approved.p_terms,'initial');
  assert.equal(approved.p_location,'cebu');
  console.log('PASS support diagnostics, proposals, owner comparison and undo, revocation and finance approval');
} finally {dom.window.close();}
