import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const check = args.includes('--check');
const [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview')] = args.filter(arg => arg !== '--check');
const marker = 'Eden owner wall alignment v1';

function replace(source, from, to) {
  if (source.split(from).length !== 2) throw Error('Unexpected setup version near ' + from.slice(0, 100));
  return source.replace(from, () => to);
}

const wallStyles = `/* Eden owner wall alignment v1 */
body.has-template-wall.variant-original .sign-wall{
  --wall-angle:0deg;--wall-recession:0deg;--wall-glint:#ffedce9c;
  transform-origin:left center;
  transform:perspective(80cqw) rotateY(var(--wall-recession)) skewY(var(--wall-angle));
}
body.has-template-wall.variant-original .sign-wall .wall-name{
  -webkit-text-stroke:.01em var(--wall-side);
  text-shadow:-.012em -.015em 0 var(--wall-glint),.015em .012em 0 var(--wall-side),
    .03em .024em 0 var(--wall-side),.045em .036em 0 var(--wall-side),
    .063em .085em .032em var(--wall-cast),.098em .132em .09em var(--wall-cast);
}
body.theme-pearl.has-template-wall.variant-original .sign-wall{
  --wall-angle:3.5deg;--wall-recession:23deg;--wall-glint:#8297b8b3;
  --wall-face:#172f52;--wall-side:#0c1b31;--wall-cast:#2a231e76;
  left:3.65%;top:11.9%;width:27%;font:800 3.9cqw/.98 system-ui,sans-serif;
  text-align:center;text-transform:uppercase;
}
body.theme-pearl.has-template-wall.variant-original .sign-wall.compact{font-size:2.75cqw}
body.theme-lumi.has-template-wall.variant-original .sign-wall{--wall-angle:.4deg;--wall-recession:3deg}
body.theme-siam.has-template-wall.variant-original .sign-wall{--wall-angle:-.9deg;--wall-recession:-8deg}
body.theme-pattaya.has-template-wall.variant-original .sign-wall{--wall-angle:.4deg;--wall-recession:4deg}
body.theme-mabuhay.has-template-wall.variant-original .sign-wall{--wall-angle:-.6deg;--wall-recession:-3deg}
body.theme-mabuhay.has-template-wall.variant-original .sign-plate.right{
  --right-plaque-slope:-.6deg;
}
/* Keep the larger Pearl desk plaque from the style sample and reveal the clean wall under its sample lettering. */
body.theme-pearl.has-template-wall.variant-original .scene::before{
  content:"";position:absolute;inset:0;pointer-events:none;
  background:url('/assets/eden-composition-v2-pearl.webp') center/100% 100% no-repeat;
  mask-image:linear-gradient(to right,#000 30%,transparent 31.25%),
    linear-gradient(to bottom,#000 33%,transparent 43%);
  mask-composite:intersect;
}
body.theme-pearl.has-template-wall.variant-original .sign-plate.left{
  left:19.7%;top:52.1%;width:10.2%;height:20.1%;
  --left-plaque-slope:-.85deg;
}
body.theme-pearl.has-template-wall.variant-original .sign-plate.center{
  left:49.4%;top:65.6%;width:15.1%;height:8.8%;
  display:grid;align-content:center;justify-items:center;row-gap:.13cqw;
  transform-origin:center;
  transform:skewY(2deg);
}
body.theme-pearl.has-template-wall.variant-original .sign-plate.center h2{
  font-size:1.15cqw;white-space:nowrap;margin:0;
}
body.theme-pearl.has-template-wall.variant-original .sign-plate.center p{margin:0}
body.theme-pearl.has-template-wall.variant-original .sign-plate.right{
  left:77.5%;top:54.4%;width:11.8%;height:22.5%;
  --right-plaque-slope:1.9deg;
}
`;

function updateWorker(source) {
  source = replace(source, 'templateWall?wallTemplatePath(theme):a.hero_key',
    "templateWall?(theme==='pearl'&&variant==='original'?'/assets/eden-style-sample-pearl.webp':wallTemplatePath(theme)):a.hero_key");
  return replace(source, '\n.has-uploaded-wall .scene{background:none!important', '\n' + wallStyles + '\n.has-uploaded-wall .scene{background:none!important');
}

const backLink = '<a class="btn light" id="backToWorkspace" href="https://clinicnet.live/clinic/" hidden>Back to Clinic Workspace</a>';
const wallPreview = '<div class="wall-frame" id="wallFrame" hidden><iframe id="wallPreview" title="Clinic scene with live desk signs" sandbox="allow-same-origin"></iframe></div>';

function updatePage(source) {
  const changes = [
    [backLink, ''],
    ['<section id="screen-create" hidden>', `<nav id="workspaceNavigation" aria-label="Clinic Workspace" hidden>
  <a class="btn light" id="backToWorkspace" href="https://clinicnet.live/clinic/"><span aria-hidden="true">←</span> Back to Clinic Workspace</a>
</nav>
<section id="screen-create" hidden>`],
    ["$('backToWorkspace').hidden=!useWorkspace||screen==='screen-no-invite';", "$('workspaceNavigation').hidden=!useWorkspace||screen==='screen-no-invite';"],
    [wallPreview, ''],
    ['<div class="card" id="wallSceneCard"><h3>', '<div class="card" id="wallSceneCard">' + wallPreview + '<h3>'],
    ['<p>Choose a JPG, PNG or WebP under 12 MB. The preview shows the landscape crop used on your public page.</p>',
      '<p>Ideal size 1672 × 941 px. JPG, PNG or WebP under 12 MB. The public page uses a wide crop.</p>'],
    ['<p id="wallStatus" class="status" role="status"></p>',
      `<p id="wallStatus" class="status" role="status"></p>
<div id="wallPhotoReconnect" hidden>
  <a class="btn light" id="reopenWallSetup" href="https://clinicnet.live/clinic/" target="_blank" rel="noopener noreferrer">Reconnect in Clinic Workspace <span aria-hidden="true">↗</span></a>
  <p>In Workspace, open Website chat and choose Set up AI receptionist. Then return here and click Upload photo again.</p>
</div>`],
    ["fetch(path,{...options,headers:{'Content-Type':'application/json'", "fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json'"],
    ["{field:j.field});return j}", "{field:j.field,status:r.status});return j}"],
    ["  actionState(button,'pending');\n  renderWallLettering();\n  status('wallStatus','Updating your reception photo…');",
      "  actionState(button,'pending');\n  $('wallPhotoReconnect').hidden=true;\n  renderWallLettering();\n  status('wallStatus','Updating your reception photo…');"],
    ["  }catch(error){status('wallStatus',error.message,true)}\n  finally{\n    wallCopyBusy=false;\n    if($(button).dataset.actionState==='pending')",
      `  }catch(error){
    if(error.status!==401){
      status('wallStatus',error.message,true);
    }else if(useWorkspace){
      $('reopenWallSetup').href=$('backToWorkspace').href;
      $('wallPhotoReconnect').hidden=false;
      status('wallStatus',button==='uploadWallPhoto'
        ?'Your setup access needs to be renewed. Your photo is still selected.'
        :'Your setup access needs to be renewed.',true);
    }else{
      status('wallStatus','Open your private setup link again to restore access.',true);
    }
  }
  finally{
    wallCopyBusy=false;
    if($(button).dataset.actionState==='pending')`],
    [`    const response=await fetch('/api/assistants/'+id+'/wall-photo',{
      method:'POST',
      headers:{'Content-Type':'image/jpeg','X-Eden-Wall-Revision':revision,...(key?{Authorization:'Bearer '+key}:{})},
      body:image
    });
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'Photo upload failed.');`,
      `    const data=await api('/api/assistants/'+id+'/wall-photo',{
      method:'POST',
      headers:{'Content-Type':'image/jpeg','X-Eden-Wall-Revision':revision},
      body:image
    });`],
    ["'Photo uploaded. Check the crop and confirm it below.'", "'Photo uploaded. Check the preview above, then confirm the photo.'"],
    ["'Check the preview, then confirm your wall and signs.'", "'Check the preview above, then confirm your wall and signs.'"],
    ['#useTemplateWall{margin:0 0 12px}',
      `#useTemplateWall{margin:0 0 12px}
#workspaceNavigation{display:flex;margin:0 0 clamp(20px,3vw,34px)}
#workspaceNavigation[hidden]{display:none}
#backToWorkspace,#reopenWallSetup{text-decoration:none}
#wallFrame{margin:0 0 clamp(18px,3vw,32px)}
#wallPhotoReconnect{margin:0 0 16px}
#wallPhotoReconnect p{margin:8px 0 0}`]
  ];
  for (const [from, to] of changes) source = replace(source, from, to);
  return replace(source, '<!doctype html>', '<!doctype html><!-- ' + marker + ' -->');
}

const files = [
  ['assistant-core.js', updateWorker],
  ['assistant-setup/index.html', updatePage]
].map(([path, update]) => {
  const before = readFileSync(join(root, path), 'utf8');
  if (!before.includes('Eden owner photo upload v1')) throw Error('Install the owner photo upload update first.');
  return {path, before, after: before.includes(marker) ? before : update(before)};
});

function validate(code, label) {
  try {
    execFileSync(process.execPath, ['--check', '--input-type=module'], {input: code, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']});
  } catch (error) {
    throw Error('Updated ' + label + ' failed JavaScript syntax validation.\n' + error.stderr);
  }
}

validate(files[0].after, files[0].path);
const pageScript = files[1].after.match(/<script type="module">([\s\S]+?)<\/script>/)?.[1];
if (!pageScript) throw Error('Could not find the setup page script.');
validate(pageScript, files[1].path);

const changed = files.filter(file => file.before !== file.after);
if (check || !changed.length) {
  console.log('Wall update check passed. ' + changed.length + ' file(s) would change.');
} else {
  const backup = mkdtempSync(join(tmpdir(), 'eden-owner-wall-alignment-'));
  for (const {path, before} of changed) {
    if (readFileSync(join(root, path), 'utf8') !== before) throw Error('Setup changed during the update. Run the installer again.');
    mkdirSync(dirname(join(backup, path)), {recursive:true});
    writeFileSync(join(backup, path), before);
  }
  try {
    for (const {path, after} of changed) writeFileSync(join(root, path), after);
  } catch (error) {
    for (const {path, before} of changed) writeFileSync(join(root, path), before);
    throw error;
  }
  console.log('Wall update installed. Backup: ' + backup);
}
