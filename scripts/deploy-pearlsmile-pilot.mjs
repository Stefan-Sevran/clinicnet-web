import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [revision, ...options] = process.argv.slice(2);
if (!/^[a-f0-9]{40}$/.test(revision ?? '') ||
    options.some(option => option !== '--check')) {
  throw Error('Pass the full ClinicNet Git revision and, optionally, --check.');
}

const root = tmpdir();
const clinicPage = 'clinic/index.html';
const pearlPage = 'pearlsmile-cebu/index.html';
const assets = ['assets/clinic.js', 'assets/clinic.css', 'assets/pearlsmile-pilot.js'];
const candidates = readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && entry.name.startsWith('tmp.'))
  .map(entry => join(root, entry.name))
  .filter(folder => [clinicPage, pearlPage, '_worker.js'].every(file => existsSync(join(folder, file))))
  .filter(folder => {
    const clinic = readFileSync(join(folder, clinicPage), 'utf8');
    return clinic.includes('id="clinic-booked-outcomes"') &&
      clinic.includes('class="ecn-footer-main"') &&
      (clinic.includes('booking-outcomes-1') || clinic.includes('pearl-pilot-1')) &&
      readFileSync(join(folder, '_worker.js'), 'utf8').includes('Serve the Clinic Workspace from Pages assets.');
  })
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

if (!candidates.length) throw Error('The restored ClinicNet deployment with the updated footer was not found.');

const source = candidates[0];
const clinic = readFileSync(join(source, clinicPage), 'utf8');
const pearl = readFileSync(join(source, pearlPage), 'utf8');
const pilotScript = '<script defer src="/assets/pearlsmile-pilot.js?v=1"></script>';
if (!pearl.includes('id="pearlsmile-reception-chat-2026"') || !pearl.includes('</head>')) {
  throw Error('The expected PearlSmile chat markup was not found.');
}

const stage = mkdtempSync(join(root, 'tmp.'));
cpSync(source, stage, { recursive: true });
for (const path of assets) {
  const url = 'https://raw.githubusercontent.com/Stefan-Sevran/clinicnet-web/' + revision + '/' + path;
  execFileSync('curl', ['-fsSL', '--max-time', '45', url, '-o', join(stage, path)], { stdio: 'inherit' });
  if (path.endsWith('.js')) execFileSync(process.execPath, ['--check', join(stage, path)], { stdio: 'inherit' });
}
writeFileSync(join(stage, clinicPage), clinic.replaceAll('booking-outcomes-1', 'pearl-pilot-1'));
writeFileSync(join(stage, pearlPage), pearl.includes(pilotScript) ? pearl : pearl.replace('</head>', pilotScript + '\n</head>'));

if (options.includes('--check')) {
  console.log('Staged only. Review ' + stage);
} else {
  execFileSync('npx', ['wrangler', 'pages', 'deploy', '.', '--project-name', 'clinicnet-web', '--branch', 'main'],
    { cwd: stage, stdio: 'inherit' });
}
