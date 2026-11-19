import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {dirname,join} from 'node:path';

const args=process.argv.slice(2);
const check=args.includes('--check');
const [root=join(homedir(),'Desktop','clinicnet-voice-preview')]=args.filter(arg=>arg!=='--check');
const marker='Eden scoped Messenger handoff v1';
const patches={
  "assistant-setup/index.html": [
    [
      "    const bookingMode = a.bookingMode === 'request' ? 'request' : 'information';",
      "    const destination = new URL('https://clinicnet.live/clinic/');\n    destination.searchParams.set('view', 'setup');\n    destination.searchParams.set('setup', 'facebook_messenger');\n    const returnUrl = new URL($('backToWorkspace').href);\n    const accountId = returnUrl.searchParams.get('account');\n    const locationId = returnUrl.searchParams.get('location');\n    const workspaceId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;\n    if (!useWorkspace || !workspaceId.test(accountId || '') || !workspaceId.test(locationId || '')) {\n      window.open(destination.href, '_blank', 'noopener,noreferrer');\n      return;\n    }\n    destination.searchParams.set('account', accountId);\n    destination.searchParams.set('location', locationId);\n    const bookingMode = a.bookingMode === 'request' ? 'request' : 'information';"
    ],
    [
      "    const destination = new URL('https://clinicnet.live/clinic/');\n    destination.hash = new URLSearchParams({\n      'eden-messenger-details': JSON.stringify({ clinic: a.clinic, at: Date.now(), facts })\n    }).toString();",
      "    destination.hash = new URLSearchParams({\n      'eden-messenger-details': JSON.stringify({ accountId, locationId, clinic: a.clinic, at: Date.now(), facts })\n    }).toString();"
    ]
  ]
};
function replace(source,before,after,path){
  if(source.split(before).length!==2)throw Error('Unexpected '+path+' near '+before.slice(0,100));
  return source.replace(before,()=>after);
}
const files=Object.entries(patches).map(([path,changes])=>{
  const before=readFileSync(join(root,path),'utf8');
  if(before.includes(marker))return {path,before,after:before};
  let after=before;
  for(const [from,to] of changes)after=replace(after,from,to,path);
  if(path.endsWith('.html'))after=after.replace('<!doctype html>','<!doctype html><!-- '+marker+' -->');
  else after='// '+marker+'\n'+after;
  const code=path.endsWith('.html')?after.match(/<script type="module">([\s\S]+?)<\/script>/)?.[1]:after;
  if(!code)throw Error('Could not find the setup page script.');
  execFileSync(process.execPath,['--check','--input-type=module'],{input:code,encoding:'utf8'});
  return {path,before,after};
});
const changed=files.filter(file=>file.before!==file.after);
if(check||!changed.length){
  console.log('Messenger handoff check passed. '+changed.length+' file(s) would change.');
}else{
  const backup=mkdtempSync(join(tmpdir(),'eden-owner-next-'));
  for(const {path,before} of changed){
    if(readFileSync(join(root,path),'utf8')!==before)throw Error('Setup changed during the update. Run the installer again.');
    mkdirSync(dirname(join(backup,path)),{recursive:true});
    writeFileSync(join(backup,path),before);
  }
  try{
    for(const {path,after} of changed)writeFileSync(join(root,path),after);
  }catch(error){
    for(const {path,before} of changed)writeFileSync(join(root,path),before);
    throw error;
  }
  console.log('Messenger handoff updated. Backup: '+backup);
}
