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
const clinicScript = 'assets/clinic.js';
const clinicStyle = 'assets/clinic.css';
const scriptTag = /src="\/assets\/clinic\.js\?v=(?:clinic-daily-1|clinic-messenger-1|clinic-messenger-connect-[123]|clinic-comment-pilot-[12]|messenger-guide-(?:[1-9]|10))"/;
const styleTag = /href="\/assets\/clinic\.css(?:\?[^"\s]*)?"/;
const heroSection = /<section class="clinic-hero"[^>]*>[\s\S]*?<\/section>/;
const legacyHero = /<div class="clinic-hero"[^>]*>[\s\S]*?<\/div>/;
const workspaceHeroAsset = 'assets/eden-owner-eve-welcome-sign.webp';
const inviteSection = /<section id="clinic-team-invite"[^>]*>[\s\S]*?<\/section>/;
const guideSection = /<section id="clinic-messenger-guide"[^>]*>[\s\S]*?<\/section>/;
const signInSection = /<section id="clinic-signin"[^>]*>[\s\S]*?<\/section>/;
const locationSection = /<section class="clinic-panel clinic-selectors"[^>]*>[\s\S]*?<\/section>/;
const channelsSection = /<section id="clinic-channel-setup"[^>]*>[\s\S]*?<\/section>/;
const legacyChannelsSection = /<section class="clinic-panel">(?:(?!<\/section>)[\s\S])*?<div id="clinic-channels"[^>]*><\/div>\s*<\/section>\s*/;
const nextSection = /<section class="clinic-panel clinic-next"[^>]*>[\s\S]*?<\/section>\s*/;
const cssMarker = '/* Eden Messenger setup guide */';
const candidates = readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && entry.name.startsWith('tmp.'))
  .map(entry => join(root, entry.name))
  .filter(folder => [clinicPage, clinicStyle, '_worker.js', 'assets/pearlsmile-pilot.js'].every(file => existsSync(join(folder, file))))
  .filter(folder => {
    const clinic = readFileSync(join(folder, clinicPage), 'utf8');
    return clinic.includes('class="ecn-footer-main"') && clinic.includes('id="clinic-booked-outcomes"') &&
      scriptTag.test(clinic) && styleTag.test(clinic) && signInSection.test(clinic) && locationSection.test(clinic) &&
      readFileSync(join(folder, '_worker.js'), 'utf8').includes('Serve the Clinic Workspace from Pages assets.');
  })
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

if (!candidates.length) throw Error('Could not find the restored ClinicNet deployment with the daily view.');

const source = candidates[0];
const stage = mkdtempSync(join(root, 'tmp.'));
cpSync(source, stage, { recursive: true });
const sourceRoot = 'https://raw.githubusercontent.com/Stefan-Sevran/clinicnet-web/' + revision + '/';
const fetchText = path => execFileSync('curl', ['-fsSL', '--max-time', '45', sourceRoot + path], { encoding: 'utf8' });
const reviewedPage = fetchText(clinicPage);
const reviewedStyle = fetchText(clinicStyle);
const guide = reviewedPage.match(guideSection)?.[0];
const team = reviewedPage.match(inviteSection)?.[0];
const hero = reviewedPage.match(heroSection)?.[0];
const version = reviewedPage.match(/\/assets\/clinic\.js\?v=(messenger-guide-(?:[5-9]|10))"/)?.[1];
const signIn = reviewedPage.match(signInSection)?.[0];
const channels = reviewedPage.match(channelsSection)?.[0];
const cssStart = reviewedStyle.indexOf(cssMarker);
if (!guide || !signIn?.includes('id="clinic-code-form"') || !channels || cssStart < 0 ||
    (!version || (version !== 'messenger-guide-5' && !hero) || (['messenger-guide-8','messenger-guide-9','messenger-guide-10'].includes(version) && !team))) {
  throw Error('The revision does not contain the guided Messenger Workspace.');
}
let clinic = readFileSync(join(stage, clinicPage), 'utf8');
if (hero) {
  const currentHero = heroSection.test(clinic) ? heroSection : legacyHero;
  if (!currentHero.test(clinic)) throw Error('Could not find the Workspace hero to update.');
  clinic = clinic.replace(currentHero, () => hero);
  const image = execFileSync('curl', ['-fsSL', '--max-time', '45', sourceRoot + workspaceHeroAsset]);
  writeFileSync(join(stage, workspaceHeroAsset), image);
}
if (team) clinic = inviteSection.test(clinic)
  ? clinic.replace(inviteSection, () => team)
  : clinic.replace(locationSection, section => section + '\n      ' + team);
clinic = guideSection.test(clinic)
  ? clinic.replace(guideSection, () => guide)
  : clinic.replace(locationSection, section => section + '\n      ' + guide);
clinic = clinic.replace(legacyChannelsSection, '').replace(nextSection, '');
clinic = channelsSection.test(clinic)
  ? clinic.replace(channelsSection, () => channels)
  : clinic.replace(locationSection, section => section + '\n      ' + channels);
if ((clinic.match(/id="clinic-channels"/g) || []).length !== 1) {
  throw Error('Could not safely replace the channel setup card.');
}
clinic = clinic.replace(signInSection, () => signIn)
  .replace(scriptTag, 'src="/assets/clinic.js?v=' + version + '"')
  .replace(styleTag, 'href="/assets/clinic.css?v=' + version + '"');
if (!clinic.includes('<meta name="referrer" content="no-referrer">')) {
  clinic = clinic.replace('</head>', '<meta name="referrer" content="no-referrer">\n</head>');
}
const css = readFileSync(join(stage, clinicStyle), 'utf8').split(cssMarker)[0].trimEnd();
writeFileSync(join(stage, clinicPage), clinic);
writeFileSync(join(stage, clinicStyle), css + '\n\n' + reviewedStyle.slice(cssStart));
writeFileSync(join(stage, clinicScript), fetchText(clinicScript));
execFileSync(process.execPath, ['--check', join(stage, clinicScript)], { stdio: 'inherit' });

if (options.includes('--check')) {
  console.log('Staged only. Review ' + stage);
} else {
  execFileSync('npx', ['wrangler', 'pages', 'deploy', '.', '--project-name', 'clinicnet-web', '--branch', 'main'],
    { cwd: stage, stdio: 'inherit' });
}
