import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const check = args.includes('--check');
const [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview'), assetDir = dirname(fileURLToPath(import.meta.url))] =
  args.filter(arg => arg !== '--check');

const marker = 'Eden wide owner setup v1';
const welcomeImage = 'eden-owner-eve-welcome.webp';
const demoImage = 'eden-owner-eve-demo-wide.webp';
const images = [
  [welcomeImage, '4e7a6bf64a16a8630b242ef1b099c6f9b873667d34f1b0172f25e38028130de6'],
  [demoImage, '88cdcaebd863eb6d4c5b0f4c3207dac4888d0effd1326b7fe9123fce5522eb5a']
];
const desktopBreakpoint = 920;

const styles = `
/* ${marker} */
.hero{position:relative;isolation:isolate;display:grid;align-items:center;overflow:hidden;padding:0;background:#18281d}
.owner-intro-image{display:block;width:100%;height:clamp(224px,57vw,420px);object-fit:cover;object-position:73% 46%}
.owner-intro-copy{position:relative;padding:28px clamp(20px,5vw,92px) 52px}
.owner-intro-kicker{display:block;color:#e6c994;font-size:.76rem;letter-spacing:.15em;font-weight:750;text-transform:uppercase}
.hero .owner-intro-copy h1{max-width:16ch;font-size:clamp(2.25rem,6vw,4rem);line-height:1.03;margin:.3em 0}
.hero .owner-intro-copy p{max-width:38ch;font-size:clamp(1rem,1.35vw,1.2rem);margin:0 0 20px;color:#f5f2e8}
.owner-intro-start{border:1px solid #f2e1b9;border-radius:100px;background:#f4dfb8;color:#1b2d23;padding:12px 21px;font-weight:750}
.owner-intro-start:hover{background:#fff1d5}
.owner-intro-start:focus-visible{outline:3px solid white;outline-offset:4px}
.shell{margin-top:-20px;padding-inline:clamp(12px,2.1vw,36px)}
.owner-preview-controls{display:none;align-items:center;justify-content:flex-end;gap:5px;margin:14px 0 9px}
.owner-preview-controls button{border:1px solid #a4b6a7;background:#fff;border-radius:100px;color:var(--forest);padding:7px 14px;font-size:.875rem;font-weight:700}
.owner-preview-controls button[aria-pressed="true"]{background:var(--forest);border-color:var(--forest);color:#fff}
.owner-preview-controls button:focus-visible{outline:2px solid var(--forest);outline-offset:3px}
.owner-preview-window{max-width:none;width:min(100%,410px);height:clamp(490px,70vh,740px);margin:12px auto 24px;border:8px solid #21352f;border-radius:28px;overflow:hidden;background:#fff;box-shadow:0 12px 35px #102a2624}
.owner-preview-window[hidden],.owner-preview-window iframe[hidden]{display:none}
.owner-preview-window iframe{display:block;width:100%;height:100%;border:0;border-radius:0;background:#fff}
#templates{scroll-margin-top:82px}
.owner-invite-preview{display:block}
.owner-invite-preview .visual-copy{margin:0 0 12px;text-align:left}
.owner-invite-preview .visual-copy h3{margin:0 0 3px}
.owner-invite-preview .visual-copy p{margin:0;max-width:none}
.eve-photo{display:block}
@media(min-width:${desktopBreakpoint}px){
  .hero{min-height:clamp(470px,43.5vw,830px)}
  .hero::before{content:"";position:absolute;z-index:1;inset:0;background:linear-gradient(90deg,#111e13a6,#111e1366 39%,#111e1300 58%);pointer-events:none}
  .owner-intro-image{position:absolute;inset:0;height:100%;object-position:60% center}
  .owner-intro-copy{z-index:2;width:min(51vw,820px);padding-block:56px 78px;padding-right:24px}
  .hero .owner-intro-copy h1{font-size:clamp(2.65rem,4.5vw,5rem)}
  .shell{max-width:1820px;margin-top:-32px}
  .panel{overflow:visible}
  .progress{border-radius:24px 24px 0 0;padding-inline:clamp(24px,4vw,64px)}
  .progress button{text-align:center}
  .content{padding:clamp(20px,2.8vw,48px)}
  .card{padding:clamp(22px,2.6vw,40px)}
  .fields{max-width:1150px}
  .templates{gap:clamp(12px,1.4vw,24px)}
  .owner-preview-controls{display:flex}
  body:not([data-owner-preview="mobile"]) .owner-preview-window{
    width:100%;height:clamp(510px,69vh,820px);border:1px solid #b9c9bc;border-radius:18px;
  }
  .eve-chat{width:min(88%,1050px);margin-top:clamp(-155px,-8vw,-65px)}
}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
`;

const hero = `<section class="hero" aria-labelledby="ownerWelcomeTitle">
  <img class="owner-intro-image" src="/assets/${welcomeImage}" width="1902" height="827" alt="" fetchpriority="high">
  <div class="owner-intro-copy">
    <span class="owner-intro-kicker">Eden clinic setup</span>
    <h1 id="ownerWelcomeTitle">Your AI receptionist, ready to meet your patients 24/7.</h1>
    <p>Give patients a place to ask questions and request an appointment, even when your team is busy.</p>
    <button id="ownerHeroStart" class="owner-intro-start" type="button" hidden>Continue setup</button>
  </div>
</section>`;

const previewButtons = (target, label) => `<div class="owner-preview-controls" role="group" aria-label="${label}">
  <button type="button" data-owner-device="desktop" aria-pressed="true" aria-controls="${target}">Desktop</button>
  <button type="button" data-owner-device="mobile" aria-pressed="false" aria-controls="${target}">Mobile</button>
</div>`;

const previewScript = `
const previewDeviceButtons=[...document.querySelectorAll('[data-owner-device]')];
const widePreviewScreen=matchMedia('(min-width: ${desktopBreakpoint}px)');
function syncPreviewDevices(){
  const mode=widePreviewScreen.matches?(document.body.dataset.ownerPreview||'desktop'):'mobile';
  for(const button of previewDeviceButtons)button.setAttribute('aria-pressed',String(button.dataset.ownerDevice===mode));
}
for(const button of previewDeviceButtons)button.onclick=()=>{
  document.body.dataset.ownerPreview=button.dataset.ownerDevice;
  syncPreviewDevices();
};
widePreviewScreen.addEventListener('change',syncPreviewDevices);
syncPreviewDevices();
$('ownerHeroStart').onclick=()=>step(1);
`;

function replace(source, from, to) {
  const count = typeof from === 'string'
    ? source.split(from).length - 1
    : [...source.matchAll(new RegExp(from, 'g'))].length;
  if (count !== 1) throw Error('Unexpected owner setup version near ' + String(from).slice(0,100));
  return source.replace(from, typeof to === 'function' ? to : () => to);
}

function update(source) {
  if (source.includes(marker)) return source;
  source = replace(source, '</style></head><body>', styles + '</style></head><body>');
  source = replace(source, /<section class="hero"><h1>Your AI receptionist, ready to meet your patients 24\/7\.<\/h1>[\s\S]*?<\/section>/, hero);
  source = replace(source, /<div class="eve-photo">(<img class="eve-image"[^>]+>)<\/div>/,
    (_, mobileImage) => `<picture class="eve-photo"><source media="(min-width: ${desktopBreakpoint}px)" srcset="/assets/${demoImage}" width="1942" height="809">` +
      mobileImage.replace('width="941"', 'loading="lazy" decoding="async" width="941"') + '</picture>');
  source = replace(source, /<div class="visual"><div class="phone-frame"[\s\S]*?<div class="visual-copy">[\s\S]*?<\/div><\/div>/,
    `<div class="visual owner-invite-preview">
  <div class="visual-copy"><h3 id="selectedTitle">Warm dental booking</h3><p id="selectedDescription">Patient questions, preferred times, gentle handoff.</p></div>
  ${previewButtons('selectedFrame', 'Template sample size')}
  <div class="owner-preview-window"><iframe id="selectedFrame" title="Selected clinic page sample" src="/__eden/template-preview/pearl/" sandbox="" loading="lazy"></iframe></div>
</div>`);
  source = replace(source, '<div class="owner-style-preview"><iframe id="manageStylePreview"',
    previewButtons('manageStylePreview', 'Selected style preview size')+'<div class="owner-style-preview owner-preview-window"><iframe id="manageStylePreview"');
  source = replace(source, '<div class="wall-frame owner-page-frame" id="pagePreviewFrame" hidden>',
    previewButtons('pagePreview', 'Page review preview size')+'<div class="wall-frame owner-page-frame owner-preview-window" id="pagePreviewFrame" hidden>');
  source = replace(source, 'title="Mobile clinic page preview"', 'title="Clinic page review preview"');
  source = replace(source, 'Load the mobile preview first.', 'Load the page preview first.');
  source = replace(source, "  renderProgress(screen);\n}\ndocument.querySelector('.progress').onclick=", `  $('ownerHeroStart').hidden=screen==='screen-no-invite';
  $('ownerHeroStart').textContent=screen==='screen-create'?'Choose your style':'Continue setup';
  renderProgress(screen);
}
${previewScript}
document.querySelector('.progress').onclick=`);
  return source;
}

const siteFile = 'assistant-setup/index.html';
const original = readFileSync(join(root, siteFile));
const files = [{path:siteFile, before:original, after:Buffer.from(update(original.toString('utf8')))}];
for (const [name, digest] of images) {
  const path = join('assets', name), target = join(root, path);
  const after = readFileSync(join(assetDir, name));
  if (createHash('sha256').update(after).digest('hex') !== digest) throw Error('Unexpected checksum for '+name);
  const before = existsSync(target) ? readFileSync(target) : null;
  files.push({path,before,after});
}
const changes = files.filter(({before,after})=>!before?.equals(after));
if (check || !changes.length) {
  console.log('Wide owner setup check passed. '+changes.length+' file(s) would change.');
} else {
  const backup = mkdtempSync(join(tmpdir(), 'eden-owner-setup-wide-'));
  for (const {path,before} of changes) {
    if (!before) continue;
    const target = join(backup,path);
    mkdirSync(dirname(target),{recursive:true});
    writeFileSync(target,before);
  }
  const written = [];
  try {
    for (const {path,before,after} of changes) {
      const file = join(root,path);
      const current = existsSync(file) ? readFileSync(file) : null;
      if (before ? !current?.equals(before) : current) throw Error('The site changed during the update. Run the installer again.');
      mkdirSync(dirname(file),{recursive:true});
      const temporary = file+'.eden-'+process.pid;
      writeFileSync(temporary,after,{flag:'wx'});
      try {
        renameSync(temporary,file);
        written.push({file,before});
      } finally {
        rmSync(temporary,{force:true});
      }
    }
  } catch (error) {
    for (const {file,before} of written.reverse()) {
      if (before) writeFileSync(file,before);
      else rmSync(file);
    }
    throw error;
  }
  console.log('Wide owner setup installed. Backup: '+backup);
}
