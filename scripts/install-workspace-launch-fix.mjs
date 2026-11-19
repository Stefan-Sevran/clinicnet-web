import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const check = args.includes('--check');
const [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview')] = args.filter(arg => arg !== '--check');
const marker = 'Eden Workspace Worker redirects v1';
const file = join(root, 'assistant-core.js');
const before = readFileSync(file, 'utf8');
if (!before.includes('Eden signed-in Workspace setup v2')) throw Error('Install the signed-in Workspace setup update first.');

function update(source) {
  if (source.includes(marker)) return source;
  const config = "fetch(workspaceConfigUrl,{redirect:'error',signal:AbortSignal.timeout(12000)})";
  const access = "Authorization:auth},redirect:'error',signal:AbortSignal.timeout(8000)";
  for (const line of [config, access]) {
    if (source.split(line).length !== 2) throw Error('Unexpected Workspace Worker version.');
    source = source.replace(line, line.replace("redirect:'error'", "redirect:'manual'"));
  }
  return source.replace('async function workspaceProject(){', '// '+marker+'\nasync function workspaceProject(){');
}

const after = update(before);
if (check || after === before) {
  console.log('Workspace launch check passed. ' + (after === before ? '0' : '1') + ' file(s) would change.');
} else {
  const backup = mkdtempSync(join(tmpdir(), 'eden-workspace-launch-'));
  writeFileSync(join(backup, 'assistant-core.js'), before);
  const temporary = file + '.eden-' + process.pid;
  if (readFileSync(file, 'utf8') !== before || existsSync(temporary)) throw Error('The site changed during the update. Run the installer again.');
  writeFileSync(temporary, after, {flag:'wx'});
  try { renameSync(temporary, file); }
  finally { rmSync(temporary, {force:true}); }
  console.log('Workspace launch fix installed. Backup: ' + backup);
}
