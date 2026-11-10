import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const check = args.includes('--check');
const [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview'), assetDir = dirname(fileURLToPath(import.meta.url))] =
  args.filter(arg => arg !== '--check');
const marker = 'Eden wall and style samples v1';
const images = [
  ['eden-style-sample-pearl.webp', 'ba8d02375d7b3e6d9e50d6af16f8d9bed57895c111262627f6b45a528422d145'],
  ['eden-style-sample-pattaya.webp', '8b4bc4c1dff91deb6437a67d1b19c1dc4a0e524e1b2551835a7ae87b1246f19a']
];

function replace(source, from, to) {
  const count = typeof from === 'string'
    ? source.split(from).length - 1
    : [...source.matchAll(new RegExp(from, 'g'))].length;
  if (count !== 1) throw Error('Unexpected site version near ' + String(from).slice(0,110));
  return source.replace(from, () => to);
}

function updateSetup(source) {
  if (source.includes(marker)) return source;
  if (!source.includes('Eden owner setup finishing touches v1')) throw Error('Install the previous owner setup polish update first.');
  source = replace(source, 'Preview all five templates, then choose the one you want for your clinic.',
    'Compare all five styles using the example clinic name. Generate your own wall lettering after you save a style.');
  source = replace(source, 'title="Selected clinic style with your saved name"', 'title="Selected style with example clinic name"');
  source = replace(source, 'src="/__eden/template-preview/pearl/"', 'src="/__eden/template-preview/pearl/?v=wall-samples-1"');
  source = replace(source, 'src="/__eden/template-preview/${t.id}/"', 'src="/__eden/template-preview/${t.id}/?v=wall-samples-1"');
  source = replace(source, "'/__eden/template-preview/'+t.id+'/'", "'/__eden/template-preview/'+t.id+'/?v=wall-samples-1'");
  source = replace(source, /let stylePreviewToken=0;\nasync function renderStylePreview\(theme\)\{[\s\S]*?\n\}\n(?=function renderManageTemplates)/,
    `// ${marker}
function renderStylePreview(theme){
  const frame=$('manageStylePreview');
  if(frame.dataset.template!==theme){
    frame.dataset.template=theme;
    frame.src='/__eden/template-preview/'+encodeURIComponent(theme)+'/?v=wall-samples-1';
  }
  frame.hidden=false;
}
`);
  source = replace(source, '<button type="button" class="btn light" id="styleGenerate" hidden>Generate wall image</button>', '');
  source = replace(source, "  $('generateWall').disabled=$('styleGenerate').disabled=$('useTemplateWall').disabled=true;",
    "  $('generateWall').disabled=$('useTemplateWall').disabled=true;");
  source = replace(source, /  \$\('styleGenerate'\)\.hidden=[^\n]+\n  \$\('styleGenerate'\)\.disabled=[^\n]+\n  \$\('styleGenerate'\)\.textContent=[^\n]+\n/, '');
  source = replace(source, /\$\('styleGenerate'\)\.onclick=async\(\)=>\{\n  await \$\('generateWall'\)\.onclick\(\);\n\};\n/, '');
  source = replace(source, 'id="generateWall">Generate wall scene', 'id="generateWall">Generate image with block letters on wall');
  source = replace(source, "?'Regenerate wall scene':'Generate wall scene'",
    "?'Regenerate wall image with block letters':'Generate image with block letters on wall'");
  source = replace(source, "  if($('generateWall').disabled)return;\n  if($('editClinic').value.trim()!==assistant.clinic){",
    "  if($('generateWall').disabled)return;\n  if($('editTemplate').value!==assistant.template){\n    status('wallStatus','Save the selected style before generating its wall image.',true);\n    return;\n  }\n  if($('editClinic').value.trim()!==assistant.clinic){");
  source = replace(source, 'Check the clinic name and desk signs in this wide preview. Generate the wall image before approving.',
    'Generate the wall image with your saved clinic name. Check the lettering and desk signs in this wide preview before approving.');
  return replace(source, 'Enter the email inbox your clinic team checks for new bookings.',
    'Enter the email address your clinic team will check for new bookings.');
}

function updateCore(source) {
  if (source.includes(marker)) return source;
  source = replace(source, "a.hero_key.startsWith('sample/')?'/assets/eden-photo-wall-v5-'+theme+'.webp'",
    "a.hero_key.startsWith('sample/')?'/assets/'+(['pearl','pattaya'].includes(theme)?'eden-style-sample-':'eden-photo-wall-v5-')+theme+'.webp'");
  source = replace(source, "pilotWall?'has-cebu-pilot-wall':''}\">", "pilotWall?'has-cebu-pilot-wall':''}${a.preview_contact?' is-style-sample':''}\">");
  return replace(source, "body.variant-original.has-photo-wall .sign-plate.left{padding-left:1cqw;padding-right:1cqw;font-size:.72cqw}",
    `body.variant-original.has-photo-wall .sign-plate.left{padding-left:1cqw;padding-right:1cqw;font-size:.72cqw}
/* ${marker} */
body.theme-pearl.variant-original.is-style-sample.has-photo-wall .sign-plate.center{
  left:49.3%;top:65.7%;width:15.3%;height:9.9%;--plate-center-angle:2deg;
}
body.theme-pattaya.variant-original.is-style-sample.has-photo-wall .sign-plate.center{
  left:44.3%;top:76.2%;width:17.8%;height:10.7%;--plate-center-angle:1.5deg;
}
body.theme-mabuhay.variant-original.is-style-sample.has-photo-wall{--right-plaque-slope:-.6deg}
`);
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
  console.log('Wall and style samples check passed. '+changes.length+' file(s) would change.');
} else {
  const backup = mkdtempSync(join(tmpdir(),'eden-owner-wall-samples-'));
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
  console.log('Wall and style samples installed. Backup: '+backup);
}
