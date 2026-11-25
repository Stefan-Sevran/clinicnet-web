import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {saveAskEdenFeedback} from '../site/support/ask-eden-feedback.mjs';
import {answerAskEden} from '../site/support/ask-eden-model.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const url = 'https://codex-ask-eden-preview.clinicnet-web.pages.dev';
const sandbox = {window:{}, document:{body:{dataset:{page:'clinic'}}}, location:new URL(url),
  fetch:async () => { throw Error('offline'); }};
for (const path of ['assets/eden-support-knowledge.js','assets/ask-eden.js']) runInNewContext(read(path),sandbox);
sandbox.window.EdenSupportKnowledge = sandbox.EdenSupportKnowledge;
const {previewReply, publicReply, facebookPageHelp} = sandbox.window.ClinicNetAskEden;

const setup = await previewReply('How do I set up Messenger on our new FB page?');
assert.equal(setup.kind,'connect');
assert.equal(setup.href,'/clinic/');
assert.match(setup.answer,/authoriz.*test/i);
const replacement = await previewReply('How do I cancel our current Facebook page and create a new Facebook page we thereafter can connect to Eden?');
assert.equal(replacement.kind,'connect');
assert.match(replacement.answer,/Verify the new Page.*before deactivating/i);
assert.equal(facebookPageHelp('How do I create a Facebook Page?').kind,'meta');
assert.equal(publicReply('I sent a Messenger test and nothing showed up.').guide,'messenger');
assert.equal(publicReply('What opening hours does Eden have saved?').guide,'clinic-facts');
assert.equal(publicReply('Where do I review a support access request?').view,'alerts');
assert.equal(publicReply('How do I switch locations?').guide,'locations');

const clinic = read('assets/clinic.js');
const start = clinic.indexOf('        async answerQuestion(question, history, topic) {');
const end = clinic.indexOf('\n      });',start);
assert.ok(start > -1 && end > start);
const functions = clinic.slice(clinic.indexOf('  function workspaceSupportLookup('),
  clinic.indexOf('  async function answerWorkspaceLookup('));
const workspace = {
  window:sandbox.window, facebookPageHelp, publicReply, previewReply,
  state:{session:{user:{id:'test-owner'}},generation:1,locations:[{id:'cebu',name:'Cebu Test Location'}]},
  byId:id=>({value:id === 'clinic-location' ? 'cebu' : 'test-account'}),
  channelByGuide:{messenger:'facebook_messenger'},
  answerChannelStatus:(channel,checkTest)=>({channel,checkTest}),
  answerWorkspaceLookup:lookup=>({lookup}), loadedGeneration:1, isClinicOwner:false, canManageClinic:false
};
const ask = runInNewContext(functions + '\n({' + clinic.slice(start,end) + '}).answerQuestion',workspace);
const missing = await ask('I sent a Messenger test and nothing showed up.',[]);
assert.equal(missing.feedbackTopic,'messenger-test');
assert.equal(missing.checkTest,true);
assert.equal((await ask('What opening hours does Eden have saved?',[])).lookup.key,'hours');
const denied = await ask('Where do I review a support access request?',[]);
assert.equal(denied.source,'permissions');
assert.equal(denied.onAction,undefined);
assert.equal((await ask('Where are my opening hours in Clinic Profile?',[])).lookup.key,'hours');
assert.equal((await ask('How do I update opening hours?',[])).source,'permissions');
assert.equal((await ask('How do I set up Messenger on our new FB page?',[])).clinicName,'Cebu Test Location');

const post = (path,body,origin = url) => new Request(url + path,{
  method:'POST', headers:{origin,'Content-Type':'application/json'}, body:JSON.stringify(body)
});
const sqlCalls = [];
const env = {EDEN_FEEDBACK:{prepare:sql=>({bind:(...args)=>({run:async()=>sqlCalls.push({sql,args})})})}};
const entry = {id:'c9bda651-80ad-494b-a1c3-d2e5dc994004', rating:8, comment:'',
  outcome:'resolved', handoff:false, surface:'public', topic:'messenger', source:'guidance'};
const feedback = (body, origin) => saveAskEdenFeedback(post('/api/ask-eden-feedback',body,origin),env);
assert.equal((await feedback(entry)).status,200);
assert.equal((await feedback({...entry, outcome:'reopened', handoff:true})).status,200);
assert.equal((await feedback({...entry, id:'c9bda651-80ad-494b-a1c3-d2e5dc994005', surface:'workspace'})).status,200);
assert.equal((await feedback({...entry,rating:11})).status,400);
assert.equal((await feedback({...entry,comment:'Write to hello@example.org'})).status,400);
assert.equal((await feedback(entry,'https://example.org')).status,403);
assert.equal(sqlCalls.length,3);
assert.equal(sqlCalls[1].args[6],'reopened');
assert.equal(sqlCalls[1].args[7],1);

let modelInput;
const AI = {run:async (_model,input) => {
  modelInput = input;
  return {response:'General guidance. Assign a front-desk owner for each shift.'};
}};
const response = await answerAskEden(post('/api/ask-eden',{
  question:'Can you suggest a front desk coverage checklist?',history:[]
}),{AI});
assert.equal(response.status,200);
assert.match(modelInput.messages[0].content,/general, non-clinical clinic operations guidance/);
console.log('Ask Eden Cebu checks passed');
