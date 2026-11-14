import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.EDEN_PLAYWRIGHT_MODULE||'playwright');
const url=new URL(process.argv[2]||'https://voice-demo.clinicnet-web.pages.dev/clinic/cebu-dent-test/');
if(!/^\/clinic\/[a-z0-9-]+\/$/.test(url.pathname)||url.search||url.hash)throw Error('Pass a public clinic page URL.');
const executablePath=process.env.EDEN_SMOKE_CHROMIUM;
const browser=await chromium.launch(executablePath?{executablePath,args:['--no-sandbox','--single-process','--no-zygote','--use-gl=angle','--use-angle=swiftshader','--in-process-gpu']}:{});
try{
  const page=await browser.newPage();
  page.setDefaultTimeout(10000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  let requests=0;
  await page.route(new URL('/api/clinic/**',url).href,route=>{
    if(route.request().url().endsWith('/signed-url'))return route.fulfill({json:{signedUrl:'wss://example.test/session'}});
    ++requests;
    return route.abort();
  });
  await page.route('https://esm.sh/@elevenlabs/client*',route=>route.fulfill({
    contentType:'application/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:`
    window.smoke={modes:[],volume:[],muted:[],contexts:[],outbound:[]};
    export const Conversation={async startSession(options){
      window.smoke.options=options;
      window.smoke.modes.push(options.textOnly?'text':'audio');
      const connection={
        endSession:async()=>options.onDisconnect(),
        sendContextualUpdate:text=>window.smoke.contexts.push(text),
        sendUserMessage:text=>window.smoke.outbound.push(text),
        setVolume:({volume})=>window.smoke.volume.push(volume),
        setMicMuted:muted=>window.smoke.muted.push(muted)
      };
      options.onConversationCreated?.(connection);
      if(!options.textOnly)setTimeout(()=>{
        options.onMessage({role:'agent',message:'Hello, how can I help you?'});
        options.onModeChange({mode:'speaking'});
        options.onModeChange({mode:'listening'});
      },25);
      return connection;
    }};`
  }));
  await page.goto(url.href);
  async function type(text){
    await page.locator('#chatText').fill(text);
    await page.locator('#sendChat').click();
    await page.waitForFunction(expected=>window.smoke?.outbound.includes(expected),text);
  }
  await type('I would like teeth whitening.');
  await page.locator('#talk').click();
  await page.waitForFunction(()=>window.smoke?.outbound.some(text=>text.startsWith('I switched to audio.')));
  assert.deepEqual(await page.evaluate(()=>window.smoke.volume),[0,1]);
  assert.deepEqual(await page.evaluate(()=>window.smoke.muted),[true,false]);
  assert.equal(await page.getByText('Hello, how can I help you?',{exact:true}).count(),0);
  await page.evaluate(()=>window.smoke.options.onMessage({role:'user',message:'Friday, November 13 at 2 pm.'}));
  await page.getByRole('button',{name:'Back to text chat'}).click();
  await type('Test Visitor, visitor@example.test');
  assert.deepEqual(await page.evaluate(()=>window.smoke.modes),['text','audio','text']);
  assert.match(await page.evaluate(()=>window.smoke.contexts.at(-1)),/Friday, November 13 at 2 pm/);
  await page.evaluate(()=>window.smoke.options.onMessage({role:'agent',message:
    'So to recap, this is for Test Visitor, teeth whitening on Friday November 13 at 2 pm, with contact visitor at example dot test. Would you like to review these details before we send them?'
  }));
  await page.getByRole('button',{name:'Review request',exact:true}).click();
  const expected={name:'Test Visitor',contact:'visitor@example.test',service:'teeth whitening',preferredTime:'Friday November 13 at 2 pm'};
  for(const [name,value] of Object.entries(expected))assert.equal(await page.locator('[name='+name+']').inputValue(),value);
  assert.equal(await page.locator('[name=consent]').isChecked(),false);
  assert.equal(requests,0);
  assert.deepEqual(errors,[]);
  console.log('Passed text → simulated audio → text, conversation context, and editable request prefill. No booking request was sent.');
}finally{
  await browser.close();
}
