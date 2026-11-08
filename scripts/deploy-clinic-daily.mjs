import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
      /\/assets\/clinic\.js\?v=(?:clinic-daily-1|clinic-messenger-1|clinic-messenger-connect-[123]|clinic-comment-pilot-[12]|messenger-guide-1)"/.test(clinic) &&
      readFileSync(join(folder, '_worker.js'), 'utf8').includes('Serve the Clinic Workspace from Pages assets.');
  })
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

if (!candidates.length) throw Error('Could not find the restored ClinicNet deployment with the daily view.');

const source = candidates[0];
const stage = mkdtempSync(join(root, 'tmp.'));
cpSync(source, stage, { recursive: true });
const sourceRoot = 'https://raw.githubusercontent.com/Stefan-Sevran/clinicnet-web/' + revision + '/';
for (const path of [clinicPage, 'assets/clinic.js', 'assets/clinic.css']) {
  execFileSync('curl', ['-fsSL', '--max-time', '45', sourceRoot + path, '-o', join(stage, path)], { stdio: 'inherit' });
}
execFileSync(process.execPath, ['--check', join(stage, 'assets/clinic.js')], { stdio: 'inherit' });
const clinic = readFileSync(join(stage, clinicPage), 'utf8');
if (!clinic.includes('id="clinic-messenger-guide"') || !clinic.includes('/assets/clinic.js?v=messenger-guide-1') ||
    !clinic.includes('<meta name="referrer" content="no-referrer">')) {
  throw Error('The revision does not contain the guided Messenger Workspace.');
}

if (options.includes('--check')) {
  console.log('Staged only. Review ' + stage);
} else {
  execFileSync('npx', ['wrangler', 'pages', 'deploy', '.', '--project-name', 'clinicnet-web', '--branch', 'main'],
    { cwd: stage, stdio: 'inherit' });
}
