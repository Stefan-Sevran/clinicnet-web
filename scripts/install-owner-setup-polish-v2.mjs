import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const check = args.includes('--check');
const [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview'), assetDir = dirname(fileURLToPath(import.meta.url))] =
  args.filter(arg => arg !== '--check');
const marker = 'Eden owner setup finishing touches v1';
const images = [
  ['eden-owner-eve-welcome-sign.webp', '7e1db37f790f9c0077df6ff2632e4811cf8255615a02a46cd3e72b3fbee6f12f'],
  ['eden-owner-eve-panorama-life.webp', 'a20f8c6cb59d78d2819eaf648e30a5c172ec7a922024dd388ef49ee8c44ef8e9']
];

const styles = `
/* ${marker} */
.owner-channel-list{display:flex;flex-wrap:wrap;gap:4px 23px;margin:-6px 0 18px;padding-left:16px;color:#f5f2e8;font-size:.9rem}
.owner-channel-list li::marker{color:#e6c994}
@media(min-width:920px){
  .hero .owner-intro-copy p{max-width:min(38ch,24.5vw)}
  .owner-channel-list{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
}
`;

function replace(source, from, to) {
  const count = typeof from === 'string'
    ? source.split(from).length - 1
    : [...source.matchAll(new RegExp(from, 'g'))].length;
  if (count !== 1) throw Error('Unexpected site version near ' + String(from).slice(0,110));
  return source.replace(from, () => to);
}

function updateSetup(source) {
  if (source.includes(marker)) return source;
  if (!source.includes('Eden open owner setup v1')) throw Error('Install the open owner setup update first.');
  source = replace(source, '</style></head><body>', styles+'</style></head><body>');
  source = replace(source, 'src="/assets/eden-owner-eve-welcome.webp" width="1902" height="827"',
    'src="/assets/eden-owner-eve-welcome-sign.webp" width="1902" height="827"');
  source = replace(source, '    <button id="ownerHeroStart"', `    <ul class="owner-channel-list" aria-label="Channels Eve can answer">
      <li>Calls</li>
      <li>Facebook Messenger</li>
      <li>Website chat</li>
    </ul>
    <button id="ownerHeroStart"`);
  source = replace(source, /  \/\* Register the original portrait[^\n]*\n  \.eve-photo\{[^\n]*\n  \.eve-photo \.eve-image\{[^\n]*\n/,
    '  .eve-photo{background:var(--cream)}\n');
  source = replace(source, '<div class="eve-photo"><img class="eve-image"',
    '<picture class="eve-photo"><source media="(min-width: 920px)" srcset="/assets/eden-owner-eve-panorama-life.webp" width="1671" height="941"><img class="eve-image"');
  source = replace(source, 'width="941" height="1672"></div>', 'width="941" height="1672"></picture>');
  source = replace(source, "headers:{Authorization:'Bearer '+key},cache:'no-store'});\n  if(!r.ok)throw Error('Could not load the page preview.');",
    "headers:{Authorization:'Bearer '+key},cache:'no-store',redirect:'error'});\n  if(!r.ok)throw Error('Could not load the page preview.');");
  return replace(source, '    const html=await previewHtml();\n    if(run!==pagePreviewRun)', '    const html=await previewHtml(a.template);\n    if(run!==pagePreviewRun)');
}

function updateCore(source) {
  if (source.includes(marker)) return source;
  const staticPreview = String.raw`/* ${marker} */
function staticClinicPreview(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<nav class="quick-actions"[^>]*>[\s\S]*?<\/nav>/, '')
    .replace(/<a\b[^>]*>/gi, tag => tag.replace(/\s+(?:href|target)="[^"]*"/gi, ''))
    .replace(/<(?:button|input|select|textarea)\b/gi, tag => tag + ' disabled');
}
`;
  source = replace(source, 'function ownerPreview(request,a){', staticPreview+'function ownerPreview(request,a){');
  source = replace(source, '  const html=clinicHtml(draft);', '  const html=staticClinicPreview(clinicHtml(draft));');
  return replace(source, String.raw`  return page.replace(/<script type="module">[\s\S]*?<\/script>/, '');`,
    '  return staticClinicPreview(page);');
}

const files = [
  ['assistant-setup/index.html',updateSetup],
  ['assistant-core.js',updateCore]
].map(([path,transform])=>{
  const before = readFileSync(join(root,path));
  return {path,before,after:Buffer.from(transform(before.toString('utf8')))};
});
for (const [name,digest] of images) {
  const path = join('assets',name), installed = join(root,path);
  const after = readFileSync(join(assetDir,name));
  if (createHash('sha256').update(after).digest('hex')!==digest) throw Error('Unexpected checksum for '+name);
  files.push({path,before:existsSync(installed)?readFileSync(installed):null,after});
}
const changes = files.filter(({before,after})=>!before?.equals(after));
if (check || !changes.length) {
  console.log('Owner setup polish check passed. '+changes.length+' file(s) would change.');
} else {
  const backup = mkdtempSync(join(tmpdir(),'eden-owner-setup-polish-'));
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
      const current = existsSync(file)?readFileSync(file):null;
      if (before?!current?.equals(before):current) throw Error('The site changed during the update. Run the installer again.');
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
  console.log('Owner setup polish installed. Backup: '+backup);
}
