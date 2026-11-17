import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: { check }, positionals: [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview'), ...rest] } =
  parseArgs({ allowPositionals: true, options: { check: { type: 'boolean' } } });
if (rest.length) throw Error('Pass one voice-preview folder, optionally followed by --check.');

const file = join(root, 'assistant-setup', 'index.html');
const before = readFileSync(file, 'utf8');
const previous = '<!-- Eden Tailormade hero previews v1 -->';
const marker = '<!-- Eden reversible wall preview v1 -->';
if (before.includes(marker)) {
  console.log('Reversible wall previews are already installed.');
  process.exit(0);
}
if (!before.includes(previous)) throw Error('Install the Tailormade hero preview update first.');

let html = before;
function replace(from, to) {
  if (html.split(from).length !== 2) throw Error('Unexpected setup page near ' + from.slice(0, 100) + '. No files were changed.');
  html = html.replace(from, () => to);
}

replace(previous, previous + marker);
replace('hidden>Use template wall</button>', 'hidden>Use template wall instead</button>');
replace("const wallCopyFields=['wallLettering',...Object.values(deskInputs)];", `const wallCopyFields=['wallLettering',...Object.values(deskInputs)];
let compareTemplateForPhoto;
function isComparingTemplateWall(){
  return !!(compareTemplateForPhoto&&assistant?.heroIsUpload&&assistant.status!=='published'&&compareTemplateForPhoto===assistant.heroUrl);
}
`);
replace("$('confirmWallCopy').textContent=a.heroIsUpload?'Confirm photo':'Confirm wall and signs';", `const comparing=isComparingTemplateWall();
  $('useTemplateWall').textContent=comparing?'Use uploaded photo instead':'Use template wall instead';
  $('confirmWallCopy').textContent=comparing?'Confirm template wall':a.heroIsUpload?'Confirm photo':'Confirm wall and signs';`);
replace(": a.heroIsUpload?'Check the photo in the preview. Your clinic name appears below it on the public page.'",
  `: comparing?'Previewing the template wall. Your uploaded photo is still saved.'
      : a.heroIsUpload?'Check that your reception photo looks right in the preview.'`);
replace("$('useTemplateWall').disabled=wallCopyBusy||preparingWallPhoto;",
  "$('useTemplateWall').disabled=wallCopyBusy||preparingWallPhoto||applyingWallPhoto;");
replace(`    actionState(button,'done');
    status(target,message);
    if(button==='uploadWallPhoto')uploaded=true;`, `    if(button==='uploadWallPhoto'){
      actionState(button,'done');
      uploaded=true;
    }
    status(target,message);`);
replace(`$('useTemplateWall').onclick=()=>changeWallPhoto('useTemplateWall',revision=>
  api('/api/assistants/'+id+'/hero-template',{method:'POST',body:JSON.stringify({template:assistant.template,revision})}),
  'Template restored. Edit and confirm the wall lettering and signs.');`, `$('useTemplateWall').onclick=()=>{
  if($('useTemplateWall').disabled||!assistant?.heroIsUpload||assistant.status==='published')return;
  compareTemplateForPhoto=isComparingTemplateWall()?undefined:assistant.heroUrl;
  $('wallPhotoReconnect').hidden=true;
  status('wallStatus','');
  renderWallLettering();
  renderApproval();
  void loadWallPreview();
};

function confirmTemplateWall(){
  return changeWallPhoto('confirmWallCopy',revision=>
    api('/api/assistants/'+id+'/hero-template',{method:'POST',body:JSON.stringify({template:assistant.template,revision})}),
    'Template wall selected. Check your clinic name and signs, then confirm them.');
}`);
replace(`    status('wallStatus','Save your selected style first.',true);
    return;
  }
  wallCopyBusy=button.disabled=true;`, `    status('wallStatus','Save your selected style first.',true);
    return;
  }
  if(isComparingTemplateWall()){
    await confirmTemplateWall();
    return;
  }
  wallCopyBusy=button.disabled=true;`);
replace('let wallPreviewRun=0;', `async function templateWallPreview(theme){
  const url='/__eden/template-preview/'+encodeURIComponent(theme)+'/?v=wall-samples-4';
  const markup=await styleSample(theme,url);
  const page=new DOMParser().parseFromString(markup,'text/html');
  const scene=page.querySelector('.scene');
  if(!scene)throw Error('Could not load the template wall.');
  const main=page.createElement('main');
  main.append(scene);
  page.body.replaceChildren(main);
  return '<!doctype html>'+page.documentElement.outerHTML;
}

let wallPreviewRun=0;`);
replace(`  const stamp=JSON.stringify([assistant.template,assistant.clinic,assistant.heroUrl,assistant.hours,assistant.services,assistant.featuredService,assistant.variant,assistant.deskSigns,assistant.wallText,lettering]);`, `  const comparing=isComparingTemplateWall();
  const stamp=JSON.stringify([assistant.template,assistant.clinic,assistant.heroUrl,assistant.hours,assistant.services,assistant.featuredService,assistant.variant,assistant.deskSigns,assistant.wallText,lettering,comparing]);`);
replace('    const html=await previewHtml(undefined,true,lettering);', `    const html=comparing?await templateWallPreview(assistant.template):await previewHtml(undefined,true,lettering);`);
replace(`    status('wallStatus',assistant.heroIsUpload?'Photo saved. Reload the preview to see it.':error.message,true);`,
  `    status('wallStatus',comparing?'Could not load the template wall. Try reloading the preview.':assistant.heroIsUpload?'Photo saved. Reload the preview to see it.':error.message,true);`);
replace("$('continuePageReview').hidden=!wallConfirmed||a.status==='published';",
  "$('continuePageReview').hidden=!wallConfirmed||a.status==='published'||isComparingTemplateWall();");

const module = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
if (!module) throw Error('Could not validate the setup code. No files were changed.');
execFileSync(process.execPath, ['--input-type=module', '--check'], {
  input: module, stdio: ['pipe', 'inherit', 'inherit']
});
if (check) {
  console.log('Reversible wall preview checks passed. assistant-setup/index.html would change.');
} else {
  const backup = mkdtempSync(join(tmpdir(), 'eden-wall-comparison-'));
  writeFileSync(join(backup, 'index.html'), before);
  if (readFileSync(file, 'utf8') !== before) throw Error('The setup file changed. Run the installer again.');
  const temporary = file + '.eden-' + process.pid;
  writeFileSync(temporary, html, { flag: 'wx' });
  try { renameSync(temporary, file); }
  finally { rmSync(temporary, { force: true }); }
  console.log('Reversible wall previews installed. Backup: ' + backup);
}
