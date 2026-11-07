import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [revision, ...options] = process.argv.slice(2);
if (!/^[a-f0-9]{40}$/.test(revision ?? '') || options.some(option => option !== '--check')) {
  throw Error('Pass the full ClinicNet Git revision and, optionally, --check.');
}

const root = tmpdir();
const clinicPage = 'clinic/index.html';
const candidates = readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && entry.name.startsWith('tmp.'))
  .map(entry => join(root, entry.name))
  .filter(folder => [clinicPage, '_worker.js', 'assets/pearlsmile-pilot.js'].every(file => existsSync(join(folder, file))))
  .filter(folder => {
    const clinic = readFileSync(join(folder, clinicPage), 'utf8');
    return clinic.includes('class="ecn-footer-main"') && clinic.includes('id="clinic-booked-outcomes"') &&
      /\/assets\/clinic\.js\?v=(?:clinic-daily-1|clinic-messenger-1|clinic-messenger-connect-1)"/.test(clinic) &&
      readFileSync(join(folder, '_worker.js'), 'utf8').includes('Serve the Clinic Workspace from Pages assets.');
  })
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

if (!candidates.length) throw Error('Could not find the restored ClinicNet deployment with the daily view.');

const source = candidates[0];
const stage = mkdtempSync(join(root, 'tmp.'));
cpSync(source, stage, { recursive: true });
const url = 'https://raw.githubusercontent.com/Stefan-Sevran/clinicnet-web/' + revision + '/assets/clinic.js';
execFileSync('curl', ['-fsSL', '--max-time', '45', url, '-o', join(stage, 'assets/clinic.js')], { stdio: 'inherit' });
execFileSync(process.execPath, ['--check', join(stage, 'assets/clinic.js')], { stdio: 'inherit' });
const clinic = readFileSync(join(stage, clinicPage), 'utf8');
let updated = clinic.replace(
  /(\/assets\/clinic\.js\?v=)(?:clinic-daily-1|clinic-messenger-1|clinic-messenger-connect-1)"/,
  '$1clinic-messenger-connect-1"'
);
if (!updated.includes('<meta name="referrer" content="no-referrer">')) {
  updated = updated.replace('<script defer src="/assets/clinic.js?', '<meta name="referrer" content="no-referrer">\n<script defer src="/assets/clinic.js?');
}
writeFileSync(join(stage, clinicPage), updated);

if (options.includes('--check')) {
  console.log('Staged only. Review ' + stage);
} else {
  execFileSync('npx', ['wrangler', 'pages', 'deploy', '.', '--project-name', 'clinicnet-web', '--branch', 'main'],
    { cwd: stage, stdio: 'inherit' });
}
