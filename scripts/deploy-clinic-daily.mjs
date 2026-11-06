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
      ['clinic.css', 'clinic.js'].every(asset =>
        new RegExp('/assets/' + asset.replace('.', '\\.') + '\\?v=(?:pearl-pilot-1|clinic-daily-1)"').test(clinic)) &&
      readFileSync(join(folder, '_worker.js'), 'utf8').includes('Serve the Clinic Workspace from Pages assets.');
  })
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

if (!candidates.length) throw Error('Could not find the restored ClinicNet deployment with the PearlSmile pilot.');

const source = candidates[0];
const stage = mkdtempSync(join(root, 'tmp.'));
cpSync(source, stage, { recursive: true });
for (const path of ['assets/clinic.js', 'assets/clinic.css']) {
  const url = 'https://raw.githubusercontent.com/Stefan-Sevran/clinicnet-web/' + revision + '/' + path;
  execFileSync('curl', ['-fsSL', '--max-time', '45', url, '-o', join(stage, path)], { stdio: 'inherit' });
}
execFileSync(process.execPath, ['--check', join(stage, 'assets/clinic.js')], { stdio: 'inherit' });
const clinic = readFileSync(join(stage, clinicPage), 'utf8');
writeFileSync(join(stage, clinicPage), clinic.replace(/(\/assets\/clinic\.(?:css|js)\?v=)pearl-pilot-1"/g, '$1clinic-daily-1"'));

if (options.includes('--check')) {
  console.log('Staged only. Review ' + stage);
} else {
  execFileSync('npx', ['wrangler', 'pages', 'deploy', '.', '--project-name', 'clinicnet-web', '--branch', 'main'],
    { cwd: stage, stdio: 'inherit' });
}
