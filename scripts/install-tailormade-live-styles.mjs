import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: { check }, positionals: [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview'), ...rest] } =
  parseArgs({ allowPositionals: true, options: { check: { type: 'boolean' } } });
if (rest.length) throw Error('Pass one voice-preview folder, optionally followed by --check.');

const previous = 'Eden live receptionist updates v1';
const marker = 'Eden Tailormade live styles v1';
function replace(source, from, to) {
  if (source.split(from).length !== 2) throw Error('Unexpected setup version near ' + from.slice(0, 105) + '. No files were changed.');
  return source.replace(from, () => to);
}

function updateWorker(source) {
  if (source.includes(marker)) return source;
  if (!source.includes(previous)) throw Error('Install the live receptionist update first.');
  source = replace(source,
    "if(x.slug.trim()!==a.slug||x.template!==a.template)return json({error:'Use the current public page address and style when saving live details.'},400);",
    `if(x.slug.trim()!==a.slug)return json({error:'Use the current public page address when saving live details.'},400);
   if(x.template!==a.template&&!uploadedWall(a))return json({error:'Use the current style when saving this live page.'},400);`);
  const previewStart = source.indexOf('async function ownerPreview(');
  const previewEnd = source.indexOf('const html=staticClinicPreview(clinicHtml(preview));', previewStart);
  if (previewStart < 0 || previewEnd < 0) throw Error('Could not find the owner page preview. No files were changed.');
  const preview = source.slice(previewStart, previewEnd);
  const draft = /const draft\s*=\s*/.exec(preview)?.[0];
  if (!draft) throw Error('Could not find the preview style selection. No files were changed.');
  source = replace(source, preview, replace(preview, draft, `const draft=uploadedWall(a)&&a.hero_status==='ready'
    ? {...a,template:theme,variant:theme===a.template?a.variant:'original'} : `));
  const heading = /[$]\{ownerPhoto\?`<section class="photo-clinic-name"[^\x60]*`:''\}\n/.exec(source)?.[0];
  if (!heading) throw Error('Could not find the duplicate photo heading. No files were changed.');
  source = replace(source, heading, '');
  return replace(source, `.photo-clinic-name{text-align:center;padding:18px 20px}
.photo-clinic-name h1{margin:0;font-size:clamp(1.4rem,4vw,2.25rem);line-height:1.15}`, `/* ${marker} */
body.has-uploaded-wall .chat-wrap{margin-top:clamp(-96px,-6vw,-22px)}
@media(max-width:650px){body.has-uploaded-wall .chat-wrap{margin-top:-22px}}`);
}

function updatePage(source) {
  if (source.includes(marker)) return source;
  if (!source.includes(previous)) throw Error('Install the live receptionist update first.');
  const patch = (from, to) => { source = replace(source, from, to); };
  patch('<!-- '+previous+' -->', '<!-- '+previous+' --><!-- '+marker+' -->');
  patch('</style></head>', `
#talkStep[data-template="pearl"]{--talk-top:#e7d0b9;--talk-body:#f4eadc;--talk-ink:#072e55}
#talkStep[data-template="lumi"]{--talk-top:#e8d1bb;--talk-body:#f4e6d9;--talk-ink:#4b273b;--talk-border:#c49949}
#talkStep[data-template="siam"]{--talk-top:#a99b7d;--talk-body:#e9e0ce;--talk-ink:#21372b;--talk-border:#d5b98d}
#talkStep[data-template="pattaya"]{--talk-top:#c8e4e5;--talk-body:#e5f4f0;--talk-ink:#114d59;--talk-border:#c9ebeb}
#talkStep[data-template="mabuhay"]{--talk-top:#e7e6d8;--talk-body:#edf4f0;--talk-ink:#244654}
#talkStep[data-template] .eve-chat{background:linear-gradient(180deg,var(--talk-top),var(--talk-body) 62%);border-color:var(--talk-border,#fff8);color:var(--talk-ink)}
#talkStep[data-template] .eve-chat-head{color:var(--talk-ink)}
</style></head>`);
  patch(`  const name=doc.createElement('section');
  name.className='photo-clinic-name';
  const heading=name.appendChild(doc.createElement('h1'));
  heading.textContent=clinic;
  scene.after(name);`, `  const chatHeading=doc.querySelector('.chat-top strong');
  if(chatHeading)chatHeading.textContent='Ask '+clinic;`);
  patch(`  if(!templates.some(item=>item.id===theme))return;
  loadSavedArtwork();`, `  if(!templates.some(item=>item.id===theme))return;
  $('talkStep').dataset.template=theme;
  loadSavedArtwork();`);
  patch('    showTalkTemplate(assistant?.template||theme);', '    showTalkTemplate(theme);');

  patch('async function previewHtml(theme,wallOnly=false,lettering=false){',
    `function selectedPhotoStyle(a=assistant){
  return a.heroIsUpload?($('editTemplate').value||a.template):a.template;
}
async function previewHtml(theme,wallOnly=false,lettering=false){`);
  patch(`  const a=assistant;
  const lettering=usesEditableWall();
  const next=JSON.stringify([a.clinic,a.city,a.hours,a.services,a.featuredService,a.template,`, `  const a=assistant;
  const theme=selectedPhotoStyle(a);
  const lettering=usesEditableWall();
  const next=JSON.stringify([a.clinic,a.city,a.hours,a.services,a.featuredService,a.template,theme,`);
  patch('    const html=await previewHtml(a.template,false,lettering);',
    '    const html=await previewHtml(theme,false,lettering);');
  patch(`  const comparing=isComparingTemplateWall();
  const stamp=JSON.stringify([assistant.template,assistant.clinic,`, `  const comparing=isComparingTemplateWall();
  const theme=selectedPhotoStyle();
  const stamp=JSON.stringify([assistant.template,theme,assistant.clinic,`);
  patch('comparing?await templateWallPreview(assistant.template):await previewHtml(undefined,true,lettering)',
    'comparing?await templateWallPreview(theme):await previewHtml(theme,true,lettering)');

  patch(`$('editTemplate').disabled=published;`, `$('editTemplate').disabled=published&&!a.heroIsUpload;`);
  patch("'Edit your clinic facts and contact links here, then select Update live receptionist.'",
    "'Edit your clinic facts or contact links here. With a Tailormade photo, you can also choose a new page style. Select Update live receptionist to save.'");
  patch('Save changes to your clinic facts and public contact links on your live page.',
    'Save your selected Tailormade style, clinic facts, and public contact links.');
  patch(`  const reviewApproved=a.reviewApproved&&!wallCopyDirty;`, `  const pendingStyle=selectedPhotoStyle(a)!==a.template;
  const reviewApproved=a.reviewApproved&&!wallCopyDirty&&!pendingStyle;`);
  patch(`    [a.variant!=='original','Use the current page layout','pageReview'],`,
    `    [pendingStyle,'Save the selected style','manageChoose'],
    [a.variant!=='original','Use the current page layout','pageReview'],`);
  patch('  if(reviewApproved||wallCopyDirty)$(\'approveCheck\').checked=reviewApproved;',
    '  if(reviewApproved||wallCopyDirty||pendingStyle)$(\'approveCheck\').checked=reviewApproved;');
  patch(`  if(!assistant||assistant.status==='published'||$('pagePreviewFrame').hidden)return;`,
    `  if(!assistant||assistant.status==='published'||$('pagePreviewFrame').hidden||selectedPhotoStyle()!==assistant.template)return;`);

  const renders = /function renderManageTemplates\(\)\{[^\n]+/.exec(source)?.[0];
  if (!renders?.endsWith('renderTailormade()}')) throw Error('Could not find the style preview refresh. No files were changed.');
  patch(renders, renders.slice(0, -1) + ';void loadWallPreview();void loadMobilePreview()}');
  patch(`  $('styleSaved').hidden=!saved;
  $('chooseStyle').hidden=saved||assistant.status==='published';`, `  const published=assistant.status==='published';
  $('styleSaved').hidden=!saved;
  $('styleSaved').textContent=published?'✓ Live':'✓ Saved';
  $('chooseStyle').hidden=saved||published;
  if(published&&assistant.heroIsUpload){
    status('manageChooseStatus',saved?'':'Previewing this style. Select Update live receptionist to make it live.');
  }`);
  patch("  if(!card||$('chooseStyle').disabled||applyingWallPhoto)return;",
    "  if(!card||$('chooseStyle').disabled||applyingWallPhoto||$('saveLiveReceptionist').dataset.actionState==='pending')return;");

  patch(`  if(!contactChanged&&Object.entries(facts).every(([key,value])=>value===(current[key]||''))){`, `  const theme=selectedPhotoStyle(current);
  if(theme===current.template&&!contactChanged&&Object.entries(facts).every(([key,value])=>value===(current[key]||''))){`);
  patch('slug:current.slug,template:current.template,liveUpdate:true', 'slug:current.slug,template:theme,liveUpdate:true');
  patch("...liveFields.map(([,key])=>$(key)),$('clinicPhone'),$('clinicMap'),$('confirmContact')",
    "...liveFields.map(([,key])=>$(key)),$('editTemplate'),$('clinicPhone'),$('clinicMap'),$('confirmContact')");
  return source;
}

const changes = [['assistant-core.js', updateWorker], ['assistant-setup/index.html', updatePage]].map(([path, update]) => {
  const file = join(root, path);
  const before = readFileSync(file, 'utf8');
  return { path, file, before, after: update(before) };
}).filter(({before,after}) => before !== after);

for (const { path, after } of changes) {
  const module = path.endsWith('.html') ? after.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] : after;
  if (!module) throw Error('Could not validate the setup code. No files were changed.');
  execFileSync(process.execPath, ['--input-type=module', '--check'], {
    input: module, stdio: ['pipe', 'inherit', 'inherit']
  });
}
if (check || !changes.length) {
  console.log('Tailormade live styles check passed. ' + changes.length + ' file(s) would change.');
} else {
  for (const { file, before } of changes) {
    if (readFileSync(file, 'utf8') !== before) throw Error('Setup files changed. Run the installer again.');
  }
  const backup = mkdtempSync(join(tmpdir(), 'eden-tailormade-live-styles-'));
  const written = [];
  try {
    for (const entry of changes) {
      const { path, file, before, after } = entry;
      const saved = join(backup, path);
      mkdirSync(dirname(saved), { recursive: true });
      writeFileSync(saved, before);
      const temporary = file + '.eden-' + process.pid;
      writeFileSync(temporary, after, { flag: 'wx' });
      try { renameSync(temporary, file); written.push(entry); }
      finally { rmSync(temporary, { force: true }); }
    }
  } catch (error) {
    for (const { file, before } of written.reverse()) writeFileSync(file, before);
    throw error;
  }
  console.log('Tailormade live styles installed. Backup: ' + backup);
}
