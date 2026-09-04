import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {renderPage} from '../build.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFile(resolve(root,p),'utf8');
const pages=JSON.parse(await read('site/pages.json'));
for(const page of pages) {
  const html=await renderPage(page);
  assert.equal(html,await read(page.output),'Generated output is current');
  assert(!html.includes('{{'),'No unresolved tokens');
  assert.equal((html.match(/<header\b/g)||[]).length,1);
  assert.equal((html.match(/<footer\b/g)||[]).length,1);
  assert.equal(html.includes('src="/audit-chat.js"'),page.id==='audit');
  for(const header of [true,false]) for(const footer of [true,false]) {
    const result=await renderPage({...page,header,footer});
    assert.equal(result.includes('<header'),header);
    assert.equal(result.includes('<footer'),footer);
  }
  for(const [,url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if(url.startsWith('#')) assert(html.includes('id="'+url.slice(1)+'"'));
    else if(url.startsWith('/')) await access(resolve(root,url.slice(1)+(url.endsWith('/')?'index.html':'')));
  }
}
const home=await read('site/pages/home.html');
assert.equal((home.match(/<img /g)||[]).length,10);
assert.equal((home.match(/loading="lazy"/g)||[]).length,9);
assert(home.includes('No more</span> late replies:'));
assert(home.includes('No more</span> lost revenue:'));
const navigation=await read('assets/navigation.js');
for(const [pathname,hash,expected] of [['/','#audit','/audit/?test=1'],['/','#clinic-audit-chat-2026','/audit/?test=1#clinic-audit-chat-2026'],['/audit/','#audit',null],['/','#about',null]]) {
  let target=null;
  vm.runInNewContext(navigation,{location:{pathname,hash,search:'?test=1',replace:value=>target=value}});
  assert.equal(target,expected);
}
console.log('PASS: shared layouts, all visibility switches, local routes, image count, and legacy Audit links.');
