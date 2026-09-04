import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const read=p=>readFile(resolve(root,p),'utf8');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function renderPage(page) {
  if(!['home','audit'].includes(page.id)) throw Error('Unknown page');
  if(typeof page.header!=='boolean'||typeof page.footer!=='boolean') throw Error('Header/footer must be true or false');
  const tokens={AUDIT_CTA:page.id==='audit'?'#clinic-audit-chat-2026':'/audit/',AUDIT_ACTIVE:page.id==='audit'?'class="active" aria-current="page"':'',HOME_ACTIVE:page.id==='home'?'class="active" aria-current="page"':''};
  const component=async name=>(await read('site/components/'+name+'.html')).replace(/{{(\w+)}}/g,(_,key)=>{if(!(key in tokens))throw Error('Unknown token '+key);return tokens[key]});
  return '<!doctype html>\n<html lang="en"><head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>'+escape(page.title)+'</title>\n<meta name="description" content="'+escape(page.description)+'">\n'+
  ['/assets/site.css',...page.styles].map(p=>'<link rel="stylesheet" href="'+escape(p)+'">').join('\n')+
  '\n<script src="/assets/navigation.js"></script>\n'+page.scripts.map(p=>'<script defer src="'+escape(p)+'"></script>').join('\n')+
  '\n</head><body data-page="'+page.id+'" data-header="'+(page.header?'visible':'hidden')+'" data-footer="'+(page.footer?'visible':'hidden')+'">\n<a class="skip-link" href="#main-content">Skip to content</a>\n'+
  (page.header?await component('header'):'')+'\n'+await read('site/pages/'+page.id+'.html')+'\n'+(page.footer?await component('footer'):'')+'\n</body></html>\n';
}
export async function build() {
  const pages=JSON.parse(await read('site/pages.json'));
  for(const page of pages) {
    if(page.output!==({home:'index.html',audit:'audit/index.html'})[page.id])throw Error('Unexpected output path');
    const output=resolve(root,page.output);
    await mkdir(dirname(output),{recursive:true});
    await writeFile(output,await renderPage(page));
    console.log('Built '+page.output);
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) await build();

