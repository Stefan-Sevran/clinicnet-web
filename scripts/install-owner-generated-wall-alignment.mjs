import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {dirname,join} from 'node:path';

const args=process.argv.slice(2);
const check=args.includes('--check');
const [root=join(homedir(),'Desktop','clinicnet-voice-preview')]=args.filter(arg=>arg!=='--check');
const marker='Eden aligned generated wall v1';
const patches={
  "hero-image.js": [
    [
      "const themes={\n pearl:{file:'eden-composition-v2-pearl.webp',place:'blank cream wall at upper left',material:'raised dark navy metal letters'},\n lumi:{file:'eden-composition-v2-lumi.webp',place:'cream wall at upper left, above and behind the orchids, without covering staff',material:'polished champagne-gold metal letters with a subtle warm halo'},\n siam:{file:'eden-composition-v2-siam.webp',place:'dark brown wall at upper left, without covering staff',material:'warm brass letters with subtle warm halo'},\n pattaya:{file:'eden-composition-v3-pattaya.webp',place:'pale aqua wall above the six team members, without covering faces',material:'raised teal metal letters'},\n mabuhay:{file:'eden-composition-v3-mabuhay.webp',place:'cream wall at upper left, without covering the hospital team',material:'brushed dark-blue metal letters'}\n};\n/* Eden owner readiness and preview v1 */\nexport function wallTemplatePath(theme){return Object.hasOwn(themes,theme)?\"/assets/\"+themes[theme].file:null}\n",
      "const themes={\n pearl:{file:'eden-composition-v2-pearl.webp',sample:'eden-style-sample-pearl.webp',place:'cream wall at upper left',material:'raised dark navy metal letters',wall:'0,2 30.8,2 30.8,40 0,40'},\n lumi:{file:'eden-composition-v2-lumi.webp',sample:'eden-photo-wall-v5-lumi.webp',place:'cream wall at upper left, above and behind the orchids',material:'polished champagne-gold metal letters with a subtle warm halo',wall:'6,0 45,0 45,18.5 40,18.5 39.2,15.7 37,15 35,16 33.7,18 32.4,21 31.5,26 10,26 8.8,22 6,16'},\n siam:{file:'eden-composition-v2-siam.webp',sample:'eden-photo-wall-v5-siam.webp',place:'dark brown wall at upper left',material:'warm brass letters with a subtle warm halo',wall:'3,5 44,5 44,20 39,20 36,20.7 33.5,23 31,31 14,31 11.5,27 4,24'},\n pattaya:{file:'eden-composition-v3-pattaya.webp',sample:'eden-style-sample-pattaya.webp',place:'pale aqua wall above the six team members',material:'raised teal metal letters',wall:'30,3 65,3 65,25.5 47,25.5 46,24 40,24 38,25.5 36,24 34,22.6 30,24'},\n mabuhay:{file:'eden-composition-v3-mabuhay.webp',sample:'eden-photo-wall-v5-mabuhay.webp',place:'cream wall at upper left',material:'brushed dark-blue metal letters',wall:'12,0 55,0 55,26 39,26 39,24 37.3,23.2 36.5,23 34.3,23 32.2,23.8 30.5,25.5 12,25.5'}\n};\n/* Eden owner readiness and preview v1 */\nexport function wallTemplatePath(theme){return Object.hasOwn(themes,theme)?'/assets/'+themes[theme].file:null}\nexport function wallSamplePath(theme){return Object.hasOwn(themes,theme)?'/assets/'+themes[theme].sample:null}\nexport function wallEditMask(theme){\n const points=themes[theme].wall;\n // Feather the wall edge so minor differences in the generated lighting blend into the template.\n const svg=`<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\" preserveAspectRatio=\"none\"><filter id=\"soft\"><feGaussianBlur stdDeviation=\".42 .65\"/></filter><polygon points=\"${points}\" fill=\"white\" filter=\"url(#soft)\"/></svg>`;\n return 'data:image/svg+xml,'+encodeURIComponent(svg);\n}\n"
    ],
    [
      " const t=themes[a.template];if(!t)throw Error('Unknown template.');\n const base=await env.ASSETS.fetch(new Request(new URL('/assets/'+t.file,request.url)));\n if(!base.ok)throw Error('Template photograph unavailable.');\n const bytes=new Uint8Array(await base.arrayBuffer());if(bytes.length<20000||bytes.length>2000000)throw Error('Invalid template photograph.');\n let encoded='';for(let i=0;i<bytes.length;i+=8192)encoded+=String.fromCharCode(...bytes.subarray(i,i+8192));\n const exact=wallText||a.clinic.trim();\n const images=[{image_url:'data:image/webp;base64,'+btoa(encoded)}];\n if(wallText){\n   const prefix=a.template==='pearl'||a.template==='pattaya'?'eden-style-sample-':'eden-photo-wall-v5-';\n   const reference=await env.ASSETS.fetch(new Request(new URL('/assets/'+prefix+a.template+'.webp',request.url)));\n   if(reference.ok){\n     const bytes=new Uint8Array(await reference.arrayBuffer());\n     if(bytes.length<2000000){\n       let sample='';\n       for(let i=0;i<bytes.length;i+=8192)sample+=String.fromCharCode(...bytes.subarray(i,i+8192));\n       images.push({image_url:'data:image/webp;base64,'+btoa(sample)});\n     }\n   }\n }\n let prompt=`Edit this reception photograph by installing physical wall signage. The exact clinic name to install is on its own line below, between the markers. The markers are instructions and must not be printed.\\nCLINIC_NAME_START\\n${exact}\\nCLINIC_NAME_END\\nSpell every character of that name exactly. Do not add a trailing quote, quotation marks, punctuation, citation mark, marker text, or any other character unless it actually occurs in the clinic name. Choose one or two readable lines. Location: ${t.place}. Material: ${t.material}. Use realistic bevels, contact shadows and existing room lighting so the letters appear actually mounted to the photographed wall. Preserve all people, their faces, outfits and poses; room, furniture, flowers and ALL THREE BLANK DESK SIGNS. No invented logos, claims, other words, or changed background. Do not print a placeholder. The exact wall name is the only text to add.`;\n if(wallText){\n   prompt+=' Follow any line break supplied in the exact text. Give each letter bright metallic bevels, directional highlights, a tight contact shadow and a natural warm reflected glow at the wall. Match the perspective of the wall.';\n   if(images.length>1)prompt+=' Edit only the first input image. The second input is a reference for the template’s original lettering style, material, wall perspective and lighting only. Never copy its placeholder name. Keep the first image composition, all people and the three blank desk signs.';\n }\n",
      " const reference=wallSamplePath(a.template);\n if(!reference)throw Error('Unknown template.');\n const t=themes[a.template];\n const base=await env.ASSETS.fetch(new Request(new URL(reference,request.url)));\n if(!base.ok)throw Error('Template photograph unavailable.');\n const bytes=new Uint8Array(await base.arrayBuffer());\n if(bytes.length<20000||bytes.length>2000000)throw Error('Invalid template photograph.');\n let encoded='';\n for(let i=0;i<bytes.length;i+=8192)encoded+=String.fromCharCode(...bytes.subarray(i,i+8192));\n const exact=wallText||a.clinic.trim();\n const images=[{image_url:'data:image/webp;base64,'+btoa(encoded)}];\n const prompt=`Edit only the wall lettering in this reception photograph. Completely replace the placeholder lettering with this exact text, preserving any supplied line break. The markers are instructions and must not appear in the image.\\nCLINIC_NAME_START\\n${exact}\\nCLINIC_NAME_END\\nUse the same letter design, depth, finish, perspective and lighting as the original (${t.material}). Place the new letters in the existing lettering area on the ${t.place}. Fit the new text within the original footprint, including its shadows, using one or two lines. Keep the original framing and image boundaries. Preserve the wall, people, furniture, lighting and every detail outside the lettering. Keep all three desk signs blank and exactly where they are. The supplied name is the only text to add.`;\n"
    ]
  ],
  "assistant-core.js": [
    [
      "import {createWallImage,readWallImage,wallImageConfigured,wallTemplatePath} from './hero-image.js';",
      "import {createWallImage,readWallImage,wallEditMask,wallImageConfigured,wallSamplePath,wallTemplatePath} from './hero-image.js';"
    ],
    [
      "const finishedWallPattern=/^generated\\/([a-f0-9-]{36})\\/([^/]+)$/;\nfunction finishedWall(a){return finishedWallPattern.exec(a.hero_key||'')?.[1]||null}",
      "const finishedWallPattern=/^(?:generated|generated-aligned)\\/([a-f0-9-]{36})\\/([^/]+)$/;\nfunction finishedWall(a){return finishedWallPattern.exec(a.hero_key||'')?.[1]||null}"
    ],
    [
      "key=customText?'generated/'+objectKey+'/'+encodeURIComponent(customText):objectKey",
      "key='generated-aligned/'+objectKey+'/'+encodeURIComponent(customText||a.clinic.trim())"
    ],
    [
      " const photoWall=ownerPhoto?null:pilotWall?cebuWall(a).asset:templateWall?(theme==='pearl'&&variant==='original'?'/assets/eden-style-sample-pearl.webp':wallTemplatePath(theme)):a.hero_key&&(a.hero_status==='ready'||a.hero_key.startsWith('sample/'))?(a.hero_key.startsWith('sample/')?'/assets/'+(['pearl','pattaya'].includes(theme)?'eden-style-sample-':'eden-photo-wall-v5-')+theme+'.webp':'/__eden/hero/'+(finishedWall(a)||a.hero_key)+'.webp'):null;\n",
      " const generated=finishedWall(a);\n const alignedWall=Boolean(generated&&a.hero_status==='ready'&&a.hero_key.startsWith('generated-aligned/'));\n const sampleWall=a.hero_key?.startsWith('sample/');\n const savedPhoto=a.hero_key&&a.hero_status==='ready'?'/__eden/hero/'+(generated||a.hero_key)+'.webp':null;\n const photoWall=ownerPhoto?null:pilotWall?cebuWall(a).asset:\n   alignedWall||sampleWall||(templateWall&&theme==='pearl'&&variant==='original')?wallSamplePath(theme):\n   templateWall?wallTemplatePath(theme):savedPhoto;\n const wallEditStyle=alignedWall?`body.has-aligned-wall .scene::after{content:\"\";position:absolute;inset:0;pointer-events:none;background:url('/__eden/hero/${generated}.webp') center/100% 100% no-repeat;mask:url(\"${wallEditMask(theme)}\") center/100% 100% no-repeat}`:'';\n"
    ],
    [
      "/* Eden wall and style samples v1 */\nbody.theme-pearl.variant-original.is-style-sample.has-photo-wall:not(.has-template-wall) .sign-plate.center{\n  left:49.3%;top:65.7%;width:15.3%;height:9.9%;--plate-center-angle:2deg;\n}\nbody.theme-pattaya.variant-original.is-style-sample.has-photo-wall:not(.has-template-wall) .sign-plate.center{\n  left:43.55%;top:74.7%;width:19.25%;height:13.2%;\n  transform:perspective(80cqw) rotateY(28deg) scaleX(1.12);\n}\nbody.theme-mabuhay.variant-original.is-style-sample.has-photo-wall:not(.has-template-wall){--right-plaque-slope:-.6deg}",
      "/* The current sample and generated wall share the same desk photograph. */\nbody.theme-pattaya.variant-original.has-photo-wall:is(.is-style-sample,.has-aligned-wall) .sign-plate.center{\n  left:44%;top:75%;width:18.4%;height:12%;\n  transform:none;\n}\nbody.theme-mabuhay.variant-original.has-photo-wall:is(.is-style-sample,.has-aligned-wall){--right-plaque-slope:-.6deg}\nbody.variant-original.has-photo-wall:is(.is-style-sample,.has-aligned-wall) .sign-plate.center{\n  display:grid;align-content:safe center;justify-items:center;row-gap:.13cqw;\n}\nbody.variant-original.has-photo-wall:is(.is-style-sample,.has-aligned-wall) .sign-plate.center h2{\n  font-size:1.15cqw;white-space:nowrap;margin:0;\n}\nbody.variant-original.has-photo-wall:is(.is-style-sample,.has-aligned-wall) .sign-plate.center p{margin:0}\n${wallEditStyle}"
    ],
    [
      "body.theme-pearl.has-template-wall.variant-original .sign-plate.left{",
      "body.theme-pearl.variant-original:is(.has-template-wall,.is-style-sample,.has-aligned-wall) .sign-plate.left{"
    ],
    [
      "body.theme-pearl.has-template-wall.variant-original .sign-plate.center{",
      "body.theme-pearl.variant-original:is(.has-template-wall,.is-style-sample,.has-aligned-wall) .sign-plate.center{"
    ],
    [
      "body.theme-pearl.has-template-wall.variant-original .sign-plate.center h2{",
      "body.theme-pearl.variant-original:is(.has-template-wall,.is-style-sample,.has-aligned-wall) .sign-plate.center h2{"
    ],
    [
      "body.theme-pearl.has-template-wall.variant-original .sign-plate.center p{",
      "body.theme-pearl.variant-original:is(.has-template-wall,.is-style-sample,.has-aligned-wall) .sign-plate.center p{"
    ],
    [
      "body.theme-pearl.has-template-wall.variant-original .sign-plate.right{",
      "body.theme-pearl.variant-original:is(.has-template-wall,.is-style-sample,.has-aligned-wall) .sign-plate.right{"
    ],
    [
      "${templateWall?'has-template-wall':''} ${pilotWall?'has-cebu-pilot-wall':''}",
      "${templateWall?'has-template-wall':''} ${alignedWall?'has-aligned-wall':''} ${pilotWall?'has-cebu-pilot-wall':''}"
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
  after='// '+marker+'\n'+after;
  execFileSync(process.execPath,['--check','--input-type=module'],{input:after,encoding:'utf8'});
  return {path,before,after};
});
const changed=files.filter(file=>file.before!==file.after);
if(check||!changed.length){
  console.log('Wall alignment check passed. '+changed.length+' file(s) would change.');
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
  console.log('Wall alignment updated. Backup: '+backup);
}
