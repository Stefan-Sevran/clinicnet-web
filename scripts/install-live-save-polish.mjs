import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: { check }, positionals: [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview'), ...rest] } =
  parseArgs({ allowPositionals: true, options: { check: { type: 'boolean' } } });
if (rest.length) throw Error('Pass one voice-preview folder, optionally followed by --check.');

const previous = 'Eden live photo and review v1';
const marker = 'Eden live save polish v1';
function replace(source, from, to) {
  if (source.split(from).length !== 2) throw Error('Unexpected setup version near ' + from.slice(0, 105) + '. No files were changed.');
  return source.replace(from, () => to);
}

function updateWorker(source) {
  if (source.includes(marker)) return source;
  if (!source.includes(previous)) throw Error('Install the live photo and review update first.');
  return replace(source,
    'body.theme-pearl{--section-frame:#cfae83;--section-inlay:#fbf3e9}',
    '/* '+marker+' */\nbody.theme-pearl{--section-frame:#fff;--section-inlay:transparent}');
}

function updatePage(source) {
  if (source.includes(marker)) return source;
  if (!source.includes(previous)) throw Error('Install the live photo and review update first.');
  const patch = (from, to) => { source = replace(source, from, to); };
  patch('<!-- '+previous+' -->', '<!-- '+previous+' --><!-- '+marker+' -->');
  patch('<p id="livePageStatus" class="status" role="status"></p>', `<p id="livePageStatus" class="status" role="status"></p>
  <div class="actions" id="liveSaveFollowup" hidden>
    <a id="openSavedLivePage" class="btn light" target="_blank" rel="noopener noreferrer" hidden>Open live page ↗</a>
    <button type="button" id="reloadLiveSetup" class="btn light" hidden>Reload this setup tab</button>
  </div>`);
  patch('<style>', `<style>
#liveSaveFollowup[hidden],#liveSaveFollowup [hidden]{display:none}
#openSavedLivePage{text-decoration:none}
`);
  patch("$('saveLiveReceptionist').onclick=async()=>{", `function showLiveSaveFollowup(page,conflict=false){
  const link=$('openSavedLivePage');
  link.hidden=!page?.publicUrl;
  if(page?.publicUrl)link.href=page.publicUrl;
  link.textContent=conflict?'View current live page ↗':'Open live page ↗';
  $('reloadLiveSetup').hidden=!conflict;
  $('liveSaveFollowup').hidden=link.hidden&&!conflict;
}
$('reloadLiveSetup').onclick=()=>location.reload();

$('saveLiveReceptionist').onclick=async()=>{`);
  patch("  if(current?.status!=='published'||preparingWallPhoto||applyingWallPhoto)return;",
    "  if(current?.status!=='published'||preparingWallPhoto||applyingWallPhoto)return;\n  $('liveSaveFollowup').hidden=true;");
  patch("    status('livePageStatus','Your live receptionist is up to date.');",
    "    status('livePageStatus','Your live receptionist is up to date.');\n    showLiveSaveFollowup(current);");
  patch(`    status('livePageStatus','Live receptionist updated. Refresh the public page to see your changes.');`,
    `    status('livePageStatus','Changes are live. Open your live page to see them.');
    showLiveSaveFollowup(assistant);`);
  patch("    showFieldIssue('livePageStatus',error,{...editFieldIds,...contactFieldIds});",
    `    if(error.status===409&&/changed.*(tab|reload|reopen)/i.test(error.message)){
      status('livePageStatus','Setup changed while you were editing. Reload this setup tab before saving again. Reloading clears unsaved edits in this tab.',true);
      showLiveSaveFollowup(current,true);
    }else showFieldIssue('livePageStatus',error,{...editFieldIds,...contactFieldIds});`);
  return source;
}

const changes = [['assistant-core.js', updateWorker], ['assistant-setup/index.html', updatePage]].map(([path, update]) => {
  const file = join(root, path);
  const before = readFileSync(file, 'utf8');
  return { path, file, before, after: update(before) };
}).filter(({before,after}) => before !== after);

for (const {path,after} of changes) {
  const module = path.endsWith('.html') ? after.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] : after;
  if (!module) throw Error('Could not validate the setup code. No files were changed.');
  execFileSync(process.execPath, ['--input-type=module', '--check'], {
    input: module, stdio: ['pipe', 'inherit', 'inherit']
  });
}
if (check || !changes.length) {
  console.log('Live save polish check passed. ' + changes.length + ' file(s) would change.');
} else {
  for (const {file,before} of changes) {
    if (readFileSync(file, 'utf8') !== before) throw Error('Setup files changed. Run the installer again.');
  }
  const backup = mkdtempSync(join(tmpdir(), 'eden-live-save-polish-'));
  const written = [];
  try {
    for (const entry of changes) {
      const {path,file,before,after} = entry;
      const saved = join(backup, path);
      mkdirSync(dirname(saved), {recursive:true});
      writeFileSync(saved, before);
      const temporary = file + '.eden-' + process.pid;
      writeFileSync(temporary,after,{flag:'wx'});
      try { renameSync(temporary,file); written.push(entry); }
      finally { rmSync(temporary,{force:true}); }
    }
  } catch(error) {
    for (const {file,before} of written.reverse()) writeFileSync(file,before);
    throw error;
  }
  console.log('Live save polish installed. Backup: ' + backup);
}
