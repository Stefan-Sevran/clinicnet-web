import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const args = process.argv.slice(2);
const check = args.includes('--check');
const sourceArg = args.find(arg => arg.startsWith('--source='));
const [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview')] = args.filter(arg => arg !== '--check' && arg !== sourceArg);
const marker = 'Eden mounted wall lettering v1';
const assets = {
  'eden-wall-lettering.js': '119894a71851849b24f69d6a346ffc8948d6fae002cf43b81bf97b5c50708968',
  'eden-wall-glyphs.js': '22f4ce1443e5aa00ff52753b6b4d7027980c1f91258dd1159f53beaf6677b990'
};

function sourceAsset(name, expected) {
  const here = join(dirname(fileURLToPath(import.meta.url)), name);
  const local = existsSync(here);
  if (!local && !sourceArg) throw Error('Pass --source with the pinned repository directory.');
  const data = local ? readFileSync(here) : execFileSync('curl', ['-fsSL', new URL(name, sourceArg.slice(9)).href]);
  if (createHash('sha256').update(data).digest('hex') !== expected) throw Error('Asset integrity check failed for ' + name);
  return data.toString('utf8');
}

function replace(source, from, to) {
  if (source.split(from).length !== 2) throw Error('Unexpected setup version near ' + from.slice(0, 100));
  return source.replace(from, () => to);
}

function updateWorker(source) {
  const patches = [
    ["import {startAssistantQa,getAssistantQa} from './assistant-qa.js';",
      "import {renderMountedWall} from './assets/eden-wall-lettering.js';\nimport {startAssistantQa,getAssistantQa} from './assistant-qa.js';"],
    [`async function confirmUploadedPhoto(env,a,revision){
  if(!uploadedWall(a)||a.hero_status!=='ready'||revision!==a.updated_at)
    return json({error:'The photo changed. Reload setup and check the preview.'},409);
  if(a.hero_reviewed_at)return json(ownerView(a));
  const stamp=now();
  const saved=await env.PILOT_DB.prepare("UPDATE clinic_assistants SET hero_reviewed_at=?,review_approved_at=NULL,updated_at=? WHERE id=? AND updated_at=? AND hero_key=? AND status!='published'")
    .bind(stamp,stamp,a.id,a.updated_at,a.hero_key).run();`,
      `async function confirmUploadedPhoto(env,a,input){
  const currentPhoto = uploadedWall(a) && a.hero_status==='ready';
  const samePhoto = input.photoUrl===undefined ? input.revision===a.updated_at : input.photoUrl===uploadedWallUrl(a);
  if(!currentPhoto||!samePhoto)
    return json({error:'The reception photo changed. Check the latest preview before confirming.'},409);
  if(a.hero_reviewed_at)return json(ownerView(a));
  const stamp=now();
  const saved=await env.PILOT_DB.prepare("UPDATE clinic_assistants SET hero_reviewed_at=?,review_approved_at=NULL,updated_at=? WHERE id=? AND hero_key=? AND status!='published' AND hero_status='ready'")
    .bind(stamp,stamp,a.id,a.hero_key).run();`],
    [`async function confirmWallCopy(request,env,a){`, `function wallCopyLines(value, max){
  if(typeof value!=='string'||!value.isWellFormed()||/[<>\\u0000-\\u0009\\u000b-\\u001f\\u007f]/.test(value))return null;
  const lines=value.split('\\n').map(line=>line.trim()).filter(Boolean);
  const text=lines.join('\\n');
  return lines.length<=2&&text.length>=1&&text.length<=max?text:null;
}

async function confirmWallCopy(request,env,a){`],
    [`  if(input.confirmPhoto===true)return confirmUploadedPhoto(env,a,input.revision);
  if(input.revision!==a.updated_at)return json({error:'Clinic details changed. Reload setup and check the wall again.'},409);
  const letters=input.wallText;
  const welcome=typeof input.welcome==='string'?input.welcome.trim():null;
  const chat=typeof input.chat==='string'?input.chat.trim():null;
  const lines=typeof input.services==='string'?input.services.split(/\\r?\\n/).map(line=>line.trim()).filter(Boolean):null;
  if(!value(letters,1,70)||/[\\r\\n\\u0000-\\u001f\\u007f]/.test(letters)||!letters.isWellFormed())
    return json({error:'Enter one line of up to 70 characters for the wall lettering.'},400);
  if(!value(welcome,1,62)||!value(chat,1,32)||!lines?.length||lines.length>3||!lines.every(line=>value(line,1,28)))
    return json({error:'Enter a welcome line, a chat line, and one to three service lines of up to 28 characters each.'},400);
  const text=letters.trim(), services=lines.join('\\n');`,
      `  if(input.confirmPhoto===true)return confirmUploadedPhoto(env,a,input);
  if(uploadedWall(a))return json({error:'A reception photo is now in use. Check the photo preview before confirming.'},409);
  if(input.revision!==a.updated_at)return json({error:'Clinic details changed. Check the latest preview before confirming.'},409);
  const text=wallCopyLines(input.wallText,70);
  const welcome=wallCopyLines(input.welcome,62);
  const chat=wallCopyLines(input.chat,32);
  const lines=typeof input.services==='string'?input.services.split(/\\r?\\n/).map(line=>line.trim()).filter(Boolean):null;
  if(!text)return json({error:'Enter up to two lines and 70 characters for the wall lettering.'},400);
  if(!welcome||!chat||!lines?.length||lines.length>3||!lines.every(line=>value(line,1,28)))
    return json({error:'Use up to two lines each for the welcome and chat signs, and up to three service lines of 28 characters each.'},400);
  const services=lines.join('\\n');`],
    ["const preview = editable ? {...draft,variant:'original',hero_key:'template/'+theme,hero_status:'ready'} : draft;",
      "const preview = editable && !uploadedWall(draft) ? {...draft,variant:'original',hero_key:'template/'+theme,hero_status:'ready'} : draft;"],
    [" const signMarkup=!ownerPhoto?`<div class=\"sign-wall ${wallText.length>35?'compact':''}\" aria-hidden=\"true\">${templateWall?'':'<small>WELCOME TO</small>'}<span class=\"wall-name\">${h(wallText)}</span></div>",
      " const mountedWall=templateWall&&variant==='original'?renderMountedWall(wallText,theme):'';\n const signMarkup=!ownerPhoto?`<div class=\"sign-wall ${wallText.length>35?'compact':''}\" aria-hidden=\"true\">${templateWall?'':'<small>WELCOME TO</small>'}<span class=\"wall-name\">${h(wallText)}</span></div>${mountedWall}"],
    ["\n.has-uploaded-wall .scene{background:none!important",
      `\n/* Eden mounted wall lettering v1 */
.mounted-wall{position:absolute;inset:0;display:block;width:100%;height:100%;pointer-events:none}
body.has-template-wall .scene:has(.mounted-wall) .sign-wall{display:none}
body.has-template-wall .wall-name,body.variant-original .sign-plate p{white-space:pre-line}
.has-uploaded-wall .scene{background:none!important`]
  ];
  for (const [from, to] of patches) source = replace(source, from, to);
  return source;
}

const frame = '<div class="wall-frame" id="wallFrame" hidden><iframe id="wallPreview" title="Clinic scene with live desk signs" sandbox="allow-same-origin"></iframe></div>';
const practice = '<button id="evePracticeMode" type="button" aria-pressed="true">Test a booking</button>';
const setup = '<button id="eveSetupMode" type="button" aria-pressed="false">Set up my clinic</button>';

function updatePage(source) {
  const patches = [
    ['<script type="module">\nfunction sizeTemplatePreviews', '<script type="module">\nimport {renderMountedWall} from "/assets/eden-wall-lettering.js";\nfunction sizeTemplatePreviews'],
    ['<strong id="styleNext"></strong>', ''],
    ["  $('styleNext').textContent=saved?(assistant.heroIsUpload?'Review your reception photo below.':'Edit and confirm your wall lettering and signs below.'):'Choose this template to save the style.';\n", ''],
    [frame + '<h3>Your clinic name on the reception wall</h3><p id="wallEditingHelp">Check the wall lettering and desk signs in this preview before approving.</p>',
      '<h3>Your clinic name on the reception wall</h3><p id="wallEditingHelp" class="wall-subheading">Edit wall lettering and desk signs</p>' + frame + '<button id="retryWallPreview" class="btn light" type="button" hidden>Reload preview</button>'],
    ['#wallFrame{margin:0 0 clamp(18px,3vw,32px)}',
      '#wallFrame{margin:0 0 clamp(18px,3vw,32px)}\n#wallEditingHelp.wall-subheading{font-size:clamp(1.05rem,2vw,1.35rem);font-weight:650;color:var(--ink);margin:.4rem 0 1.15rem}'],
    ["      :'Edit the wall lettering and desk signs, then confirm the preview.';", "      :'Edit wall lettering and desk signs';"],
    [' Your voice test stays complete when you change only the style.', ''],
    ["  status('editStatus','Draft added to the form. Check the details, then select Save clinic details.');\n", ''],
    [practice + '\n      ' + setup, setup + '\n      ' + practice],
    ['<input id="wallLettering" maxlength="70" required aria-describedby="wallLetteringHint">', '<textarea id="wallLettering" rows="2" maxlength="70" required aria-describedby="wallLetteringHint"></textarea>'],
    ['Type your clinic name to see it in block letters in the preview.', 'Type your clinic name. Press Enter to start a second line.'],
    ['<input id="deskWelcome" maxlength="62" required>', '<textarea id="deskWelcome" rows="2" maxlength="62" required></textarea>'],
    ['<input id="deskChat" maxlength="32" required>', '<textarea id="deskChat" rows="2" maxlength="32" required></textarea>'],
    ["    wall.querySelector('.wall-name').textContent=text;",
      `    wall.querySelector('.wall-name').textContent=text;
    page.querySelector('.mounted-wall')?.remove();
    const mounted=renderMountedWall(text,assistant.template);
    if(mounted)wall.insertAdjacentHTML('afterend',mounted);`],
    [`const priorEveDraft=new Map();`, `const priorEveDraft=new Map();
const manualEveLanguage=new Set();
for(const id of ['language','editLanguage'])$(id).addEventListener('change',()=>manualEveLanguage.add(id));

function suggestFilipinoLanguage(services, creating){
  const language=$(creating?'language':'editLanguage');
  if(manualEveLanguage.has(language.id))return;
  const location=$(creating?'city':'editCity').value;
  const php=/₱|\\bPHP\\b|\\b(?:Philippine|Filipino) pesos?\\b/i.test(services);
  const otherMarket=/\\b(?:Thailand|Bangkok|Pattaya|Phuket|Mexico|Argentina|Colombia|Chile|Uruguay|Cuba|Dominican Republic)\\b/i.test(location)||
    /\\b(?:MXN|ARS|COP|CLP|UYU|CUP|DOP|THB|baht|(?:Mexican|Argentine|Colombian|Chilean|Uruguayan|Cuban|Dominican) pesos?)\\b/i.test(services);
  if(php||(!otherMarket&&/\\bpesos?\\b/i.test(services)))language.value='English and Filipino';
}`],
    ["  if(field.id==='services')refreshFeatured();", "  if(field.id==='services')refreshFeatured();\n  if(field.id==='services'||field.id==='editServices')suggestFilipinoLanguage(field.value,field.id==='services');"],
    [`async function changeWallPhoto(button,save,message){`, `function sameWallArtwork(before, current){
  return JSON.stringify([before.template,before.heroUrl,before.wallText,before.deskSigns])===
    JSON.stringify([current.template,current.heroUrl,current.wallText,current.deskSigns]);
}

async function saveWallPhoto(save){
  const before=assistant;
  try{return await save(before.wallRevision)}
  catch(error){
    if(error.status!==409)throw error;
    const current=await api('/api/assistants/'+id);
    assistant=current;
    if(current.status==='published'||!sameWallArtwork(before,current)){
      renderManage();
      throw Error('The reception artwork changed. Check the latest preview before uploading again.');
    }
    return save(current.wallRevision);
  }
}

async function changeWallPhoto(button,save,message){`],
    ['    assistant=await save(assistant.wallRevision);', '    assistant=await saveWallPhoto(save);'],
    [`  await changeWallPhoto('uploadWallPhoto',async revision=>{
    const image=await prepareWallPhoto(file);
    const data=await api('/api/assistants/'+id+'/wall-photo',{
      method:'POST',
      headers:{'Content-Type':'image/jpeg','X-Eden-Wall-Revision':revision},
      body:image
    });
    $('wallPhotoFile').value='';
    return data;
  },'Photo uploaded. Check the preview above, then confirm the photo.');`,
      `  let image;
  await changeWallPhoto('uploadWallPhoto',async revision=>{
    image??=await prepareWallPhoto(file);
    const data=await api('/api/assistants/'+id+'/wall-photo',{
      method:'POST',
      headers:{'Content-Type':'image/jpeg','X-Eden-Wall-Revision':revision},
      body:image
    });
    $('wallPhotoFile').value='';
    return data;
  },'Photo uploaded. Check the preview above, then confirm the photo.');`],
    ["const copy=photo?{confirmPhoto:true}:{", "const copy=photo?{confirmPhoto:true,photoUrl:assistant.heroUrl}:{"],
    [`  }catch(error){status('wallStatus',error.message,true)}
  finally{
    wallCopyBusy=false;
    if(button.dataset.actionState==='pending')`,
      `  }catch(error){
    if(error.status===409){
      try{
        assistant=await api('/api/assistants/'+id);
        if(assistant.heroIsUpload)wallCopyDirty=false;
        renderManage();
      }catch{}
    }
    status('wallStatus',error.message,true);
  }
  finally{
    wallCopyBusy=false;
    if(button.dataset.actionState==='pending')`],
    [`$('wallPreview').addEventListener('load',()=>{
  if(!assistant)return;
  renderWallCopyPreview();
  renderWallLettering();
});`, `$('wallPreview').addEventListener('load',()=>{
  const page=$('wallPreview').contentDocument;
  const stamp=page?.querySelector('meta[name="eden-wall-preview"]')?.content;
  if(!assistant||stamp!==String(wallPreviewRun))return;
  $('wallFrame').hidden=false;
  renderWallCopyPreview();
  renderWallLettering();
  if($('wallStatus').textContent==='Photo saved. Reload the preview to see it.')
    status('wallStatus','Photo ready. Check the preview above, then confirm the photo.');
});`],
    [`    frame.srcdoc=html;
    $('wallFrame').hidden=false;`, `    const stamp='<meta name="eden-wall-preview" content="'+run+'">';
    frame.srcdoc=html.replace('</head>',stamp+'</head>');`],
    [`let wallPreviewRun=0;
async function loadWallPreview(){`, `let wallPreviewRun=0;
$('retryWallPreview').onclick=()=>loadWallPreview();
async function loadWallPreview(){`],
    [`  const run=++wallPreviewRun;
  $('wallFrame').hidden=true;`, `  const run=++wallPreviewRun;
  $('retryWallPreview').hidden=true;
  $('wallFrame').hidden=true;`],
    [`    delete frame.dataset.hero;
    status('wallStatus',error.message,true);`,
      `    delete frame.dataset.hero;
    $('retryWallPreview').hidden=false;
    status('wallStatus',assistant.heroIsUpload?'Photo saved. Reload the preview to see it.':error.message,true);`],
  ];
  for (const [from, to] of patches) source = replace(source, from, to);
  return replace(source, '<!doctype html>', '<!doctype html><!-- ' + marker + ' -->');
}

const updates = [
  ['assistant-core.js', updateWorker],
  ['assistant-setup/index.html', updatePage]
];
const files = updates.map(([path, update]) => {
  const before = readFileSync(join(root, path), 'utf8');
  if (!before.includes('Eden owner wall alignment v1')) throw Error('Install the owner wall alignment update first.');
  return {path, before, after: before.includes(marker) ? before : update(before)};
});
for (const [name, sha] of Object.entries(assets)) {
  const path = 'assets/'+name;
  const before = existsSync(join(root,path)) ? readFileSync(join(root,path),'utf8') : null;
  files.push({path, before, after: sourceAsset(name,sha)});
}
function validate(code) {
  execFileSync(process.execPath, ['--check','--input-type=module'], {input:code, encoding:'utf8'});
}
validate(files[0].after);
const pageScript=files[1].after.match(/<script type="module">([\s\S]+?)<\/script>/)?.[1];
if (!pageScript) throw Error('Could not find the setup page script.');
validate(pageScript);
files.slice(2).forEach(file=>validate(file.after));
const changed=files.filter(file=>file.before!==file.after);
if(check||!changed.length){
  console.log('Setup check passed. '+changed.length+' file(s) would change.');
}else{
  const backup=mkdtempSync(join(tmpdir(),'eden-mounted-wall-'));
  for(const {path,before} of changed){
    const current=existsSync(join(root,path))?readFileSync(join(root,path),'utf8'):null;
    if(current!==before)throw Error('Setup changed during the update. Run the installer again.');
    if(before===null)continue;
    mkdirSync(dirname(join(backup,path)),{recursive:true});
    writeFileSync(join(backup,path),before);
  }
  const written=[];
  try{
    for(const file of changed){
      mkdirSync(dirname(join(root,file.path)),{recursive:true});
      written.push(file);
      writeFileSync(join(root,file.path),file.after);
    }
  }catch(error){
    for(const {path,before} of written){
      if(before===null){if(existsSync(join(root,path)))unlinkSync(join(root,path));}
      else writeFileSync(join(root,path),before);
    }
    throw error;
  }
  console.log('Setup updated. Backup: '+backup);
}
