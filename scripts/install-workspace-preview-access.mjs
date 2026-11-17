import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: { check }, positionals: [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview'), ...rest] } =
  parseArgs({ allowPositionals: true, options: { check: { type: 'boolean' } } });
if (rest.length) throw Error('Pass one voice-preview folder, optionally followed by --check.');

const file = join(root, 'assistant-core.js');
const before = readFileSync(file, 'utf8');
const marker = '// Allow the Clinic Workspace Daily work preview.';
const functionStart = 'async function workspaceLink(request,env){\n';
const originalGate = [
  "  if(request.headers.get('Origin')!==workspaceOrigin)return json({error:'Open setup from Clinic Workspace.'},403);",
  "  const headers={...JSON_HEADERS,'Access-Control-Allow-Origin':workspaceOrigin,'Vary':'Origin'};"
].join('\n');
const previewGate = [
  '  ' + marker,
  "  const origin=request.headers.get('Origin');",
  "  if(origin!==workspaceOrigin&&origin!=='https://workspace-daily-26.clinicnet-web.pages.dev')",
  "    return json({error:'Open setup from Clinic Workspace.'},403);",
  "  const headers={...JSON_HEADERS,'Access-Control-Allow-Origin':origin,'Vary':'Origin'};"
].join('\n');

if (before.includes(previewGate)) {
  console.log('Workspace preview access is already installed.');
} else {
  if (!before.includes('Eden signed-in Workspace setup v2') || before.includes(marker) ||
      before.split(functionStart + originalGate).length !== 2) {
    throw Error('Unexpected signed-in setup version. No files were changed.');
  }
  const after = before.replace(functionStart + originalGate, functionStart + previewGate);
  execFileSync(process.execPath, ['--input-type=module', '--check'], { input: after, stdio: ['pipe', 'inherit', 'inherit'] });
  if (check) {
    console.log('Workspace preview access check passed. assistant-core.js would change.');
  } else {
    const backup = mkdtempSync(join(tmpdir(), 'eden-workspace-preview-'));
    writeFileSync(join(backup, 'assistant-core.js'), before);
    if (readFileSync(file, 'utf8') !== before) throw Error('The setup file changed. Run the installer again.');
    const temporary = file + '.eden-' + process.pid;
    writeFileSync(temporary, after, { flag: 'wx' });
    try { renameSync(temporary, file); }
    finally { rmSync(temporary, { force: true }); }
    console.log('Workspace preview access installed. Backup: ' + backup);
  }
}
