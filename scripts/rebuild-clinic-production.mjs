import { execFile, execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const [previewArg, ...extra] = process.argv.slice(2);
if (!previewArg || extra.length) throw Error('Pass the path to the clinicnet-voice-preview folder.');
const preview = resolve(previewArg);
const workerFile = '_worker.js';
const live = 'https://clinicnet-web.pages.dev';
const revision = 'eefda6d904d1dc53ff67a06440ad272303e4ebeb';
const reviewed = 'https://raw.githubusercontent.com/Stefan-Sevran/clinicnet-web/' + revision;
const marker = 'Serve the Clinic Workspace from Pages assets.';
const pathLine = /^[ \t]*const path = new URL\(request\.url\)\.pathname;[ \t]*$/gm;
const sourceWorker = readFileSync(join(preview, workerFile), 'utf8');
if (!sourceWorker.includes('env.ASSETS.fetch')) throw Error('The preview Worker lacks the Pages assets handler.');
if (!sourceWorker.includes(marker) && [...sourceWorker.matchAll(pathLine)].length !== 1) {
  throw Error('The preview Worker differs from the November restore. No files were staged.');
}
const worker = sourceWorker.includes(marker) ? sourceWorker : sourceWorker.replace(pathLine, line => line + `
    // ${marker}
    if ((path === '/clinic' || path === '/clinic/') &&
        (request.method === 'GET' || request.method === 'HEAD')) {
      return env.ASSETS.fetch(request);
    }`);

const get = promisify(execFile);
async function download(url) {
  const { stdout } = await get('curl', ['-fsSL', '--max-time', '30', url], {
    encoding: 'buffer', maxBuffer: 16 * 1024 * 1024
  });
  if (!stdout.length) throw Error('Empty response from ' + url);
  return stdout;
}

const liveFiles = new Map([
  ['/clinic/', 'clinic/index.html'],
  ['/assets/clinic.js', 'assets/clinic.js'],
  ['/assets/clinic.css', 'assets/clinic.css'],
  ['/pearlsmile-cebu/', 'pearlsmile-cebu/index.html'],
  ['/assets/pearlsmile-pilot.js', 'assets/pearlsmile-pilot.js'],
  ['/assistant-setup/', 'assistant-setup/index.html'],
  ['/assistant-core.js', 'assistant-core.js'],
  ['/assistant-qa.js', 'assistant-qa.js'],
  ['/hero-image.js', 'hero-image.js'],
  ['/audit-chat.js', 'audit-chat.js'],
  ['/assets/site.css', 'assets/site.css'],
  ['/assets/navigation.js', 'assets/navigation.js'],
  ['/assets/analytics.js', 'assets/analytics.js'],
  ['/favicon.svg', 'favicon.svg'],
  ['/robots.txt', 'robots.txt'],
  ['/sitemap.xml', 'sitemap.xml']
]);
const sitemap = await download(live + '/sitemap.xml');
for (const [, path] of sitemap.toString().matchAll(/<loc>https:\/\/clinicnet\.live(\/(?:[a-z0-9-]+\/)*)<\/loc>/g)) {
  liveFiles.set(path, path.slice(1) + 'index.html');
}
if (!liveFiles.has('/') || !liveFiles.has('/privacy/') || !liveFiles.has('/terms/')) {
  throw Error('The production sitemap is incomplete.');
}

const root = mkdtempSync(join(tmpdir(), 'clinicnet-rebuild-'));
try {
  const base = join(root, 'base');
  cpSync(preview, base, {
    recursive: true,
    filter(path) {
      if (path === preview) return true;
      const name = basename(path);
      return !name.startsWith('.') && !['backups', 'node_modules'].includes(name) &&
        !/^(?:wrangler\.|.+\.(?:js|html|css|json)\.|.+\.(?:bak|backup|log|zip|sql|pem|key)$)/i.test(name) &&
        !lstatSync(path).isSymbolicLink();
    }
  });
  if (!existsSync(join(base, '_headers'))) throw Error('The preview folder is missing its Pages headers.');
  writeFileSync(join(base, workerFile), worker);
  const files = [...liveFiles];
  for (let index = 0; index < files.length; index += 6) {
    const batch = await Promise.allSettled(files.slice(index, index + 6).map(async ([url, file]) => {
      const body = url === '/sitemap.xml' ? sitemap : await download(live + url);
      if (file.endsWith('.html') && !/^\s*<!doctype html/i.test(body.toString())) {
        throw Error('Expected HTML from ' + url);
      }
      mkdirSync(dirname(join(base, file)), { recursive: true });
      writeFileSync(join(base, file), body);
    }));
    const failed = batch.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
  }
  if (!readFileSync(join(base, 'clinic/index.html'), 'utf8').includes('messenger-guide-13')) {
    throw Error('The live Workspace version changed. Check the new production baseline before rebuilding.');
  }
  const desktopNavigation = 'assets/desktop-navigation.css';
  writeFileSync(join(base, desktopNavigation), await download(reviewed + '/' + desktopNavigation));
  for (const file of [workerFile, 'assistant-core.js', 'assistant-qa.js', 'hero-image.js', 'audit-chat.js']) {
    execFileSync(process.execPath, ['--input-type=module', '--check'], {
      input: readFileSync(join(base, file)), stdio: ['pipe', 'ignore', 'inherit']
    });
  }

  const update = join(root, 'deploy-clinic-daily.mjs');
  writeFileSync(update, await download(reviewed + '/scripts/deploy-clinic-daily.mjs'));
  execFileSync(process.execPath, [update, revision, '--source', base, '--check'], {
    env: { ...process.env, TMPDIR: root }, stdio: 'inherit'
  });
  rmSync(base, { recursive: true });
  console.log('Checked production pages and assets: ' + liveFiles.size);
  console.log('This command did not deploy to Cloudflare.');
} catch (error) {
  rmSync(root, { recursive: true, force: true });
  throw error;
}
