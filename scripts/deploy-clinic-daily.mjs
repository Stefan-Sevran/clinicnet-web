import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const {
  positionals: [revision, ...extra],
  values: { source: explicitSource, check, home }
} = parseArgs({
  allowPositionals: true,
  options: { source: { type: 'string' }, check: { type: 'boolean' }, home: { type: 'boolean' } }
});
if (!/^[a-f0-9]{40}$/.test(revision ?? '') || extra.length || explicitSource === '') {
  throw Error('Pass the full ClinicNet Git revision, optionally --source <production folder>, --check, and --home.');
}

const root = tmpdir();
const clinicPage = 'clinic/index.html';
const clinicScript = 'assets/clinic.js';
const clinicStyle = 'assets/clinic.css';
const scriptTag = /src="\/assets\/clinic\.js\?v=(?:clinic-daily-1|clinic-messenger-1|clinic-messenger-connect-[123]|clinic-comment-pilot-[12]|messenger-guide-(?:[1-9]|1[0-9]|2[0-9]|3[0-9]|4[0-5]))(?:-r-[a-f0-9]{40})?"/;
const styleTag = /href="\/assets\/clinic\.css(?:\?[^"\s]*)?"/;
const heroSection = /<section class="clinic-hero"[^>]*>[\s\S]*?<\/section>/;
const legacyHero = /<div class="clinic-hero"[^>]*>[\s\S]*?<\/div>/;
const workspaceFaviconAsset = 'assets/clinicnet-favicon.svg';
const iconTag = /<link rel="icon"[^>]*>/;
const workspaceHeroAsset = 'assets/eden-owner-eve-welcome-sign.webp';
const workspaceMemberHeroAsset = /data-src="\/(assets\/eden-workspace-team(?:-eve|-courtyard)?\.webp)"/;
const inviteSection = /<section id="clinic-team-invite"[^>]*>[\s\S]*?<\/section>/;
const guideSection = /<section id="clinic-messenger-guide"[^>]*>[\s\S]*?<\/section>/;
const signInSection = /<section id="clinic-signin"[^>]*>[\s\S]*?<\/section>/;
const locationSection = /<section class="clinic-panel clinic-selectors"[^>]*>[\s\S]*?<\/section>/;
const channelsSection = /<(section|nav) id="clinic-channel-setup"[^>]*>[\s\S]*?<\/\1>/;
const legacyChannelsSection = /<section class="clinic-panel">(?:(?!<\/section>)[\s\S])*?<div id="clinic-channels"[^>]*><\/div>\s*<\/section>\s*/;
const nextSection = /<section class="clinic-panel clinic-next"[^>]*>[\s\S]*?<\/section>\s*/;
const dailySection = /<!-- Clinic Daily work -->[\s\S]*?<!-- \/Clinic Daily work -->/;
const legacyDailySection = /(?:<div class="clinic-columns">\s*)?<section class="clinic-panel">(?:(?!<\/section>)[\s\S])*?id="clinic-bookings"[\s\S]*?<\/section>(?:\s*<\/div>)?\s*<section class="clinic-panel">(?:(?!<\/section>)[\s\S])*?id="clinic-inbox"[\s\S]*?<\/section>\s*<section class="clinic-panel">(?:(?!<\/section>)[\s\S])*?id="clinic-booked-outcomes"[\s\S]*?<\/section>/;
const bootstrapRequest = /<!-- Clinic bootstrap request -->[\s\S]*?<!-- \/Clinic bootstrap request -->\n?/;
const cssMarker = '/* Eden Messenger setup guide */';
function isWorkspaceDeployment(folder) {
  if (![clinicPage, clinicScript, clinicStyle, '_worker.js', 'assets/pearlsmile-pilot.js'].every(file => existsSync(join(folder, file)))) return false;
  const clinic = readFileSync(join(folder, clinicPage), 'utf8');
  return clinic.includes('class="ecn-footer-main"') && (dailySection.test(clinic) || legacyDailySection.test(clinic)) &&
    scriptTag.test(clinic) && styleTag.test(clinic) && signInSection.test(clinic) && locationSection.test(clinic) &&
    readFileSync(join(folder, '_worker.js'), 'utf8').includes('Serve the Clinic Workspace from Pages assets.');
}

let source;
if (explicitSource) {
  source = resolve(explicitSource);
  if (!isWorkspaceDeployment(source)) throw Error('The folder passed to --source is missing the restored production Workspace files.');
} else {
  const roots = [...new Set([root, '/tmp'].filter(path => existsSync(path)))];
  source = roots.flatMap(path => readdirSync(path, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('tmp.'))
    .map(entry => join(path, entry.name)))
    .filter(isWorkspaceDeployment)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (!source) throw Error('Could not find the restored production Workspace folder. Pass its path with --source <folder>.');
}

console.log('Using production source ' + source);
const stage = mkdtempSync(join(root, 'tmp.'));
cpSync(source, stage, { recursive: true });
const sourceRoot = 'https://raw.githubusercontent.com/Stefan-Sevran/clinicnet-web/' + revision + '/';
const fetchText = path => execFileSync('curl', ['-fsSL', '--max-time', '45', sourceRoot + path], { encoding: 'utf8' });
const reviewedPage = fetchText(clinicPage);
const reviewedStyle = fetchText(clinicStyle);
const guide = reviewedPage.match(guideSection)?.[0];
const team = reviewedPage.match(inviteSection)?.[0];
const hero = reviewedPage.match(heroSection)?.[0];
const version = reviewedPage.match(/\/assets\/clinic\.js\?v=(messenger-guide-(?:[5-9]|1[0-9]|2[0-9]|3[0-9]|4[0-5]))"/)?.[1];
const signIn = reviewedPage.match(signInSection)?.[0];
const channels = reviewedPage.match(channelsSection)?.[0];
const cssStart = reviewedStyle.indexOf(cssMarker);
const guideNumber = Number(version?.split('-').at(-1));
const daily = reviewedPage.match(dailySection)?.[0];
if (!guide || !signIn?.includes('id="clinic-code-form"') || !channels || cssStart < 0 ||
    !version || (guideNumber >= 6 && !hero) || (guideNumber >= 8 && !team) || (guideNumber >= 24 && !daily)) {
  throw Error('The revision does not contain the guided Messenger Workspace.');
}
let clinic = readFileSync(join(stage, clinicPage), 'utf8');
if (hero) {
  const currentHero = heroSection.test(clinic) ? heroSection : legacyHero;
  if (!currentHero.test(clinic)) throw Error('Could not find the Workspace hero to update.');
  clinic = clinic.replace(currentHero, () => hero);
  const image = execFileSync('curl', ['-fsSL', '--max-time', '45', sourceRoot + workspaceHeroAsset]);
  writeFileSync(join(stage, workspaceHeroAsset), image);
  const teamAsset = hero.match(workspaceMemberHeroAsset)?.[1];
  if (teamAsset) {
    const teamImage = execFileSync('curl', ['-fsSL', '--max-time', '45', sourceRoot + teamAsset]);
    writeFileSync(join(stage, teamAsset), teamImage);
  }
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
if (daily) {
  const currentDaily = dailySection.test(clinic) ? dailySection : legacyDailySection;
  if (!currentDaily.test(clinic)) throw Error('Could not find Daily Action in the source Workspace.');
  clinic = clinic.replace(currentDaily, () => daily);
} else if (dailySection.test(clinic)) {
  throw Error('Use a production folder from before the Daily Action update for this revision.');
}
clinic = clinic.replace(signInSection, () => signIn)
  .replace(scriptTag, 'src="/assets/clinic.js?v=' + version + '-r-' + revision + '"')
  .replace(styleTag, 'href="/assets/clinic.css?v=' + version + '-r-' + revision + '"');
const icon = reviewedPage.match(iconTag)?.[0];
if (icon) {
  if (!icon.includes('href="/' + workspaceFaviconAsset + '"')) throw Error('Unexpected Workspace favicon path.');
  writeFileSync(join(stage, workspaceFaviconAsset), fetchText(workspaceFaviconAsset));
  clinic = iconTag.test(clinic)
    ? clinic.replace(iconTag, () => icon)
    : clinic.replace('</head>', icon + '\n</head>');
}
const bootstrap = reviewedPage.match(bootstrapRequest)?.[0];
if (bootstrap) {
  clinic = clinic.replace(bootstrapRequest, '');
  const startOfHead = '<meta name="robots" content="noindex,nofollow">';
  if (!clinic.includes(startOfHead)) throw Error('Could not place the early Workspace configuration request.');
  clinic = clinic.replace(startOfHead, () => startOfHead + '\n' + bootstrap);
}
if (!clinic.includes('<meta name="referrer" content="no-referrer">')) {
  clinic = clinic.replace('</head>', '<meta name="referrer" content="no-referrer">\n</head>');
}
const css = readFileSync(join(stage, clinicStyle), 'utf8').split(cssMarker)[0].trimEnd();
if (guideNumber >= 44) {
  for (const path of ['assets/clinic-rescue.js','assets/clinic-qr.mjs']) writeFileSync(join(stage, path), fetchText(path));
  const rescue = '<script defer src="/assets/clinic-rescue.js?v=1-r-' + revision + '"></script>';
  const previousRescue = /<script defer src="\/assets\/clinic-rescue\.js(?:\?[^"]*)?"><\/script>/;
  if (previousRescue.test(clinic)) clinic = clinic.replace(previousRescue, rescue);
  else clinic = clinic.replace(/<script defer src="\/assets\/clinic\.js/, rescue + '\n<script defer src="/assets/clinic.js');
  if (!clinic.includes(rescue)) throw Error('Could not add the report interface');
}
writeFileSync(join(stage, clinicPage), clinic);
writeFileSync(join(stage, clinicStyle), css + '\n\n' + reviewedStyle.slice(cssStart));
writeFileSync(join(stage, clinicScript), fetchText(clinicScript));
execFileSync(process.execPath, ['--check', join(stage, clinicScript)], { stdio: 'inherit' });

if (home) {
  const homepage = 'index.html';
  const homeStyle = 'assets/home.css';
  const heroPattern = /<!-- Eden homepage demo hero -->[\s\S]*?<!-- \/Eden homepage demo hero -->/;
  const mobilePattern = /<!-- Eden homepage mobile header -->[\s\S]*?<!-- \/Eden homepage mobile header -->/;
  const navButtonPattern = /<a class="ecn-desktop-cta(?: eden-home-signin)?"[^>]*>[\s\S]*?<\/a>/;
  const homeStyleTag = /href="\/assets\/home\.css(?:\?[^"]*)?"/;
  const oldHeadline = /<h1 class="sr-only">[^<]*<\/h1>/;
  const storyImage = /<img class="story-image"[^>]*>/;
  const homeStyleMarker = '/* Eden homepage demo hero */';
  const reviewedHome = fetchText(homepage);
  const reviewedHomeCss = fetchText(homeStyle);
  let page = readFileSync(join(stage, homepage), 'utf8');
  const hero = reviewedHome.match(heroPattern)?.[0];
  const mobile = reviewedHome.match(mobilePattern)?.[0];
  const signIn = reviewedHome.match(navButtonPattern)?.[0];
  const heroTarget = heroPattern.test(page) ? heroPattern : oldHeadline;
  const cssOffset = reviewedHomeCss.indexOf(homeStyleMarker);
  if (!hero || !mobile || !signIn || !heroTarget.test(page) || !page.includes('</header>') ||
      !navButtonPattern.test(page) || !homeStyleTag.test(page) || cssOffset < 0) {
    throw Error('Could not safely update the production homepage.');
  }
  page = page.replace(heroTarget, () => hero).replace(mobilePattern, '')
    .replace('</header>', () => mobile + '\n</header>')
    .replace(navButtonPattern, () => signIn)
    .replace(homeStyleTag, 'href="/assets/home.css?v=r-' + revision + '"')
    .replace(storyImage, tag => tag.replace('fetchpriority="high"', '').replace('loading="eager"', 'loading="lazy"'));
  const currentHomeCss = readFileSync(join(stage, homeStyle), 'utf8').split(homeStyleMarker)[0].trimEnd();
  writeFileSync(join(stage, homepage), page);
  writeFileSync(join(stage, homeStyle), currentHomeCss + '\n\n' + reviewedHomeCss.slice(cssOffset));
  const image = 'assets/eden-owner-eve-demo-wide.webp';
  writeFileSync(join(stage, image), execFileSync('curl', ['-fsSL', '--max-time', '45', sourceRoot + image]));
}

if (check) {
  console.log('Staged only. Review ' + stage);
} else {
  execFileSync('npx', ['wrangler', 'pages', 'deploy', '.', '--project-name', 'clinicnet-web', '--branch', 'main'],
    { cwd: stage, stdio: 'inherit' });
}
