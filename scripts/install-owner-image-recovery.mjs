import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {dirname,join} from 'node:path';

const args=process.argv.slice(2);
const check=args.includes('--check');
const [root=join(homedir(),'Desktop','clinicnet-voice-preview')]=args.filter(arg=>arg!=='--check');
const marker='Eden wall image recovery v1';
const patches={
  "hero-image.js": [
    [
      "export async function createWallImage(request,env,a,wallText){\n if(!env.OPENAI_IMAGE_API_KEY||!env.EDEN_HERO_IMAGES||!env.ASSETS)throw Error('Photographic wall generation is not configured yet.');",
      "const primaryWallModel='gpt-image-2.5-sunburst';\nconst fallbackWallModel='gpt-image-2.5-flare';\nconst modelAccessCodes=new Set(['model_not_found','model_access_denied','model_not_available','model_not_supported','unsupported_model']);\nconst quotaCodes=new Set(['insufficient_quota','billing_hard_limit_reached']);\n\nexport function wallImageConfigured(env){\n return Boolean((env.OPENAI_IMAGE_API_KEY||env.OPENAI_IMAGE_FALLBACK_API_KEY)&&env.EDEN_HERO_IMAGES&&env.ASSETS);\n}\n\nasync function editWallImage({model,key},payload,signal){\n const response=await fetch('https://api.openai.com/v1/images/edits',{\n   method:'POST',signal,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},\n   body:JSON.stringify({...payload,model})\n });\n const data=await response.json().catch(()=>null);\n if(response.ok&&data?.data?.[0]?.b64_json)return data.data[0].b64_json;\n const providerError=data?.error;\n const code=String(providerError?.code||'unavailable').replace(/[^a-z0-9_-]/gi,'').slice(0,60);\n const requestId=String(response.headers.get('x-request-id')||'none').replace(/[^a-z0-9_-]/gi,'').slice(0,100);\n const message=providerError?.message||'';\n const restricted=/(?:region|country|territor|safety|content[_ -]policy|unsupported[_ -]location)/i.test(code+' '+message);\n const modelAccess=modelAccessCodes.has(code)||\n   (response.status===404&&code==='unavailable')||\n   (response.status===403&&/\\bmodel\\b/i.test(providerError?.message||'')&&\n     /(?:access to (?:the |this )?model|model.{0,100}not (?:enabled|available|allowed))/i.test(providerError?.message||'')&&\n     !/(?:verif|region|countr|policy|safety|scope|organization)/i.test(providerError?.message||''));\n const access=[401,403,404].includes(response.status);\n const quota=quotaCodes.has(code);\n const error=Error('Image edit HTTP '+response.status+' ('+code+', request '+requestId+', model '+model+').');\n error.wallIssue=quota?'quota':access||modelAccess?'access':response.status===429?'capacity':\n   response.status>=500?'provider':response.status>=400?'request':'processing';\n error.modelAccess=modelAccess&&!quota&&!restricted&&response.status!==401;\n error.canUseBackupKey=!restricted&&(error.modelAccess||quota||\n   (response.status===401&&code==='expired_secret_key')||\n   (access&&response.status!==404&&['unavailable','invalid_api_key','insufficient_permissions','organization_verification_required','organization_not_verified'].includes(code)));\n throw error;\n}\n\nasync function requestWallImage(env,payload){\n const primaryKey=env.OPENAI_IMAGE_API_KEY;\n const backupKey=env.OPENAI_IMAGE_FALLBACK_API_KEY;\n const signal=AbortSignal.timeout(150000);\n if(!primaryKey)return editWallImage({model:fallbackWallModel,key:backupKey},payload,signal);\n try{\n   return await editWallImage({model:primaryWallModel,key:primaryKey},payload,signal);\n }catch(error){\n   const hasBackupKey=Boolean(backupKey&&backupKey!==primaryKey);\n   if(!error.modelAccess&&!(hasBackupKey&&error.canUseBackupKey))throw error;\n   console.warn('Wall image primary model unavailable',error.message);\n   return editWallImage({model:fallbackWallModel,key:hasBackupKey?backupKey:primaryKey},payload,signal);\n }\n}\n\nexport async function createWallImage(request,env,a,wallText){\n if(!wallImageConfigured(env))throw Error('Photographic wall generation is not configured yet.');"
    ],
    [
      " const response=await fetch('https://api.openai.com/v1/images/edits',{method:'POST',signal:AbortSignal.timeout(150000),headers:{Authorization:'Bearer '+env.OPENAI_IMAGE_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-image-2.5-sunburst',images,prompt,quality:'high',size:'1536x864',output_format:'webp',output_compression:86,safety_identifier:a.id})});\n let data;\n try{data=await response.json()}catch{data=null}\n if(!response.ok||!data?.data?.[0]?.b64_json){\n   const code=String(data?.error?.code||'unavailable').replace(/[^a-z0-9_-]/gi,'').slice(0,60);\n   const requestId=response.headers.get('x-request-id')||'none';\n   const error=Error('Image edit HTTP '+response.status+' ('+code+', request '+requestId+').');\n   if(['insufficient_quota','billing_hard_limit_reached'].includes(code))error.wallIssue='quota';\n   else if([401,403,404].includes(response.status))error.wallIssue='access';\n   else if(response.status===429)error.wallIssue='capacity';\n   else if(response.status>=500)error.wallIssue='provider';\n   else if(response.status>=400)error.wallIssue='request';\n   else error.wallIssue='processing';\n   throw error;\n }\n const image=decode64(data.data[0].b64_json);if(image.length<20000||image.length>6000000)throw Error('Generated image size was unexpected.');\n",
      " const encodedImage=await requestWallImage(env,{\n   images,prompt,quality:'high',size:'1536x864',output_format:'webp',output_compression:86,safety_identifier:a.id\n });\n const image=decode64(encodedImage);\n if(image.length<20000||image.length>6000000)throw Error('Generated image size was unexpected.');\n"
    ]
  ],
  "assistant-core.js": [
    [
      "import {createWallImage,readWallImage,wallTemplatePath} from './hero-image.js';",
      "import {createWallImage,readWallImage,wallImageConfigured,wallTemplatePath} from './hero-image.js';"
    ],
    [
      "  const canGenerate=Boolean(env.OPENAI_IMAGE_API_KEY&&env.EDEN_HERO_IMAGES);\n  if(hasCustomText&&!canGenerate)\n    return json({error:'Image generation is unavailable in this deployment. You can still use the editable wall.'},503);",
      "  const canGenerate=wallImageConfigured(env);\n  if(!canGenerate)console.warn('Wall image generation is not configured on this deployment.');"
    ],
    [
      "    const descriptions={\n      configuration:'Image generation is unavailable in this deployment.',\n      access:'The image service rejected the project’s access.',\n      capacity:'The image service is rate-limited right now.',\n      quota:'The image project has reached its available quota.',\n      request:'The image service rejected the edit request.',\n      provider:'The image service is temporarily unavailable.',\n      processing:'The generated photo could not be saved or processed.'\n    };\n    notice=descriptions[imageIssue]+' '+(a.hero_key?'Your previous wall is still available.':'The template wall is ready to review below.');",
      "    notice=imageIssue==='capacity'\n      ?'AI image generation is busy right now. You can still review and confirm your current wall.'\n      :'AI image generation is unavailable right now. You can still review and confirm your current wall.';"
    ]
  ],
  "assistant-setup/index.html": [
    [
      "<!doctype html>",
      "<!doctype html><!-- Eden wall image recovery v1 -->"
    ],
    [
      "'Editable lettering is ready. Check the preview, then confirm the wall and signs.'),Boolean(result.wallNotice));",
      "'Editable lettering is ready. Check the preview, then confirm the wall and signs.'));"
    ]
  ]
};
function replace(source,before,after,path){
  if(source.split(before).length!==2)throw Error('Unexpected '+path+' near '+before.slice(0,100));
  return source.replace(before,()=>after);
}
const files=Object.entries(patches).map(([path,changes])=>{
  const before=readFileSync(join(root,path),'utf8');
  let after=before;
  if(!before.includes(marker)){
    for(const [from,to] of changes)after=replace(after,from,to,path);
    if(!path.endsWith('.html'))after='// '+marker+'\n'+after;
  }else if(path==='hero-image.js'&&!before.includes("code==='expired_secret_key'")){
    after=replace(before,'error.canUseBackupKey=!restricted&&(error.modelAccess||quota||',
      "error.canUseBackupKey=!restricted&&(error.modelAccess||quota||\n   (response.status===401&&code==='expired_secret_key')||",path);
  }
  if(after===before)return {path,before,after};
  const code=path.endsWith('.html')?after.match(/<script type="module">([\s\S]+?)<\/script>/)?.[1]:after;
  if(!code)throw Error('Could not find the setup page script.');
  execFileSync(process.execPath,['--check','--input-type=module'],{input:code,encoding:'utf8'});
  return {path,before,after};
});
const changed=files.filter(file=>file.before!==file.after);
if(check||!changed.length){
  console.log('Wall image recovery check passed. '+changed.length+' file(s) would change.');
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
  console.log('Wall image recovery updated. Backup: '+backup);
}
