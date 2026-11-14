import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const check = args.includes('--check');
const [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview'), assetDir = dirname(fileURLToPath(import.meta.url))] =
  args.filter(arg => arg !== '--check');
const marker = 'Eden open owner setup v1';
const image = 'eden-owner-eve-reception-extension.webp';
const digest = '8644f1c503e5745d8bb3214325e5122480f6cd7fac5b98b63ee303c2ff0f095d';

const styles = `
/* ${marker} */
.shell{max-width:none;margin:0 auto 56px;padding:0}
.panel{background:transparent;border-radius:0;box-shadow:none;overflow:visible}
.progress{border-radius:0;background:#f8f8f0}
.content{--owner-gutter:clamp(16px,4vw,76px);max-width:1840px;margin-inline:auto;padding:clamp(26px,4vw,58px) var(--owner-gutter)}
.card{background:none;border:0;border-top:1px solid var(--line);border-radius:0;margin:0;padding:clamp(24px,4vw,56px) 0}
.card h3{margin-top:0}
#talkStep{background:none;border:0;padding-top:18px}
.eve-demo{background:none;border:0;border-radius:0;overflow:visible;padding:0}
.eve-photo{display:block}
.owner-invite-preview{background:none;border-radius:0;padding:0}
.owner-preview-window{border:1px solid #bcc9be;border-radius:14px;box-shadow:none}
#wallFrame{border:0;border-radius:0}
#deskSignEditor{border:0;border-top:1px solid var(--line);border-radius:0;padding:14px 0}
.template{background:transparent;border:0;border-radius:10px}
.template.selected{outline:2px solid var(--forest);outline-offset:3px;background:#eff5ec}
.template:focus-visible{outline:3px solid var(--forest);outline-offset:4px}
@media(min-width:920px){
  .eve-demo{margin-inline:calc(-1 * var(--owner-gutter))}
  /* Register the original portrait against the extension and soften only their edges. */
  .eve-photo{aspect-ratio:1672/1007;background:linear-gradient(transparent 91%,var(--cream)),#fff url('/assets/${image}') center top/100% auto no-repeat}
  .eve-photo .eve-image{position:absolute;inset:0 auto auto 30.62%;width:auto;height:100%;mask-image:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent),linear-gradient(#000 71%,transparent 78%);mask-composite:intersect}
  .eve-chat{margin-top:clamp(-128px,-6.8vw,-55px)}
  body:not([data-owner-preview="mobile"]) .owner-preview-window{border:0;border-radius:0}
}
`;

function replace(source, from, to) {
  const count = typeof from === 'string'
    ? source.split(from).length - 1
    : [...source.matchAll(new RegExp(from, 'g'))].length;
  if (count !== 1) throw Error('Unexpected owner setup version near ' + String(from).slice(0,100));
  return source.replace(from, () => to);
}

function update(source) {
  if (source.includes(marker)) return source;
  if (!source.includes('Eden wide owner setup v1')) throw Error('Install the wide owner setup update first.');
  source = replace(source, '</style></head><body>', styles+'</style></head><body>');
  source = replace(source, 'Your AI receptionist, ready to meet your patients 24/7.', 'Your AI receptionist. Meeting your patients 24/7.');
  source = replace(source, 'Give patients a place to ask questions and request an appointment, even when your team is busy.',
    'Let your patients ask questions and book, even when your team is busy.');
  source = replace(source, /<picture class="eve-photo"><source media="\(min-width: 920px\)" srcset="\/assets\/eden-owner-eve-demo-wide\.webp"[^>]*>/, '<div class="eve-photo">');
  return replace(source, 'width="941" height="1672"></picture>', 'width="941" height="1672"></div>');
}

const sitePath = 'assistant-setup/index.html';
const imagePath = join('assets',image);
const original = readFileSync(join(root,sitePath));
const art = readFileSync(join(assetDir,image));
if (createHash('sha256').update(art).digest('hex')!==digest) throw Error('Unexpected checksum for '+image);
const installed = join(root,imagePath);
const files = [
  {path:sitePath,before:original,after:Buffer.from(update(original.toString('utf8')))},
  {path:imagePath,before:existsSync(installed)?readFileSync(installed):null,after:art}
].filter(({before,after})=>!before?.equals(after));

if (check || !files.length) {
  console.log('Open owner setup check passed. '+files.length+' file(s) would change.');
} else {
  const backup = mkdtempSync(join(tmpdir(),'eden-owner-setup-open-'));
  for (const {path,before} of files) {
    if (!before) continue;
    const target = join(backup,path);
    mkdirSync(dirname(target),{recursive:true});
    writeFileSync(target,before);
  }
  const written = [];
  try {
    for (const {path,before,after} of files) {
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
  console.log('Open owner setup installed. Backup: '+backup);
}
