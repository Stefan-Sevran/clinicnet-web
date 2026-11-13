import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {dirname,join} from 'node:path';

const args=process.argv.slice(2);
const check=args.includes('--check');
const [root=join(homedir(),'Desktop','clinicnet-voice-preview')]=args.filter(arg=>arg!=='--check');
const marker='Eden photographic wall finish v1';

function replace(source,before,after,path){
  if(source.split(before).length!==2)throw Error('Unexpected '+path+' near '+before.slice(0,100));
  return source.replace(before,()=>after);
}

const rendererChanges=[
  [
    "// Eden original template lettering v1\n",
    "// Eden photographic wall finish v1\n// Eden original template lettering v1\n"
  ],
  [
    "    shear: .061, vanish: .00031, depth: 11, edgeX: -.64, edgeY: -.26,\n    face: ['#355074','#203955','#192b49'], edges: ['#10192d','#182b46','#244067','#385573'],\n    glint: '#7c98b2', shadow: '#382d24', shadowX: 6, shadowY: 9\n",
    "    shear: .148, vanish: .00057, depth: 11, edgeX: .55, edgeY: -.19,\n    face: ['#253f64','#1c355b','#182c4b'], edges: ['#101c31','#172746','#223758','#405778'],\n    glint: '#8296b5', shadow: '#43352d', shadowX: 2, shadowY: 10,\n    material: {blur: 2.6, falloff: 5.8, cast: .44, specular: .24, sheen: '#8194bb', lightX: 250, lightY: 107}\n"
  ],
  [
    "    caps: false, x: 192, y: 18, width: 445, size: 74,\n    shear: .008, vanish: .00003, depth: 12, edgeX: -.43, edgeY: -.37,\n    face: ['#eacb93','#caa06a','#ae8149'], edges: ['#5b3c20','#80562e','#ab7945','#e0b77d'],\n    glint: '#fff1c1', shadow: '#443020', shadowX: 6, shadowY: 8\n",
    "    caps: false, center: true, x: 145, y: 20, width: 610, lowerWidth: 365, size: 103,\n    shear: .142, vanish: .00052, depth: 9, edgeX: -.44, edgeY: -.20,\n    face: ['#d1a35b','#9d631f','#be8437','#e3b975','#a76f2d'], edges: ['#58351a','#764b22','#ae7837','#d9aa61'],\n    glint: '#ffe4a4', shadow: '#624220', shadowX: -1, shadowY: 15,\n    material: {blur: 2.8, falloff: 7.2, cast: .42, specular: .71, sheen: '#ffebbd', lightX: 283, lightY: 57, glow: '#ffcc73'}\n"
  ],
  [
    "    caps: false, center: true, x: 95, y: 75, width: 545, size: 81,\n    shear: -.015, vanish: -.00007, depth: 13, edgeX: .49, edgeY: -.4,\n    face: ['#d7b478','#bd945b','#9e733e'], edges: ['#402b19','#674729','#916837','#b88a53'],\n    glint: '#f3d399', shadow: '#120904', shadowX: -5, shadowY: 8\n",
    "    caps: false, center: true, x: 99, y: 71, width: 605, lowerWidth: 370, size: 101,\n    shear: .107, vanish: .00050, depth: 10, edgeX: .49, edgeY: -.25,\n    face: ['#c58f40','#8b511f','#bd853d','#e4ad60','#a26729'], edges: ['#38220f','#624016','#a26a2c','#d2a052'],\n    glint: '#ffe2a1', shadow: '#100801', shadowX: -4, shadowY: 19,\n    material: {blur: 2.9, falloff: 8.3, cast: .65, specular: .78, sheen: '#ffe4ae', lightX: 248, lightY: 116, glow: '#fbb254'}\n"
  ],
  [
    "    const words = text.split(' ');\n    const width = line => length(layoutLine(line, glyphs));\n",
    "    const words = text.split(' ');\n    const width = line => length(layoutLine(line, glyphs));\n    const lowerWidth = surface.lowerWidth || surface.width;\n"
  ],
  [
    "        const widest = Math.max(width(left),width(right));\n",
    "        const widest = Math.max(width(left)/surface.width,width(right)/lowerWidth);\n"
  ],
  [
    "  const scale = Math.min(surface.size / 1000, surface.width / Math.max(...rows.map(length)));\n",
    "  const scale = Math.min(surface.size / 1000, ...rows.map((row,index) =>\n    (index && surface.lowerWidth || surface.width) / length(row)));\n"
  ],
  [
    "  };\n  const shadow = [], fronts = [], highlights = [];\n",
    "  };\n  const shadow = [], fronts = [], highlights = [];\n  const material = surface.material;\n"
  ],
  [
    "  const cast = shadow.join('');\n  const edges = sides.map((shade, index) => '<path fill=\"'+surface.edges[index]+'\" d=\"'+shade.join('')+'\"/>').join('');\n",
    "  const cast = shadow.join('');\n  const edges = sides.map((shade, index) => '<path fill=\"'+surface.edges[index]+'\" d=\"'+shade.join('')+'\"/>').join('');\n  if (material) return renderWallMaterial(surface, gradients, cast, edges, fronts, highlights);\n"
  ],
  [
    "    '<path d=\"'+highlights.join('')+'\" fill=\"none\" stroke=\"'+surface.glint+'\" stroke-opacity=\".58\" stroke-width=\".8\" stroke-linecap=\"round\"/></svg>';\n}\n",
    "    '<path d=\"'+highlights.join('')+'\" fill=\"none\" stroke=\"'+surface.glint+'\" stroke-opacity=\".58\" stroke-width=\".8\" stroke-linecap=\"round\"/></svg>';\n}\n\n\nfunction renderWallMaterial(surface, gradients, cast, edges, fronts, highlights) {\n  const {blur,falloff,cast:opacity,specular,sheen,lightX,lightY,glow} = surface.material;\n  const {shadow,shadowX,shadowY} = surface;\n  const pathLayer = (fill, alpha, filter, x=0, y=0) =>\n    '<use href=\"#wall-mounts\" fill=\"'+fill+'\" opacity=\"'+alpha+'\" filter=\"url(#'+filter+')\" transform=\"translate('+x+' '+y+')\"/>';\n  const reflections = '<g id=\"wall-metal-face\">'+fronts.join('')+'</g>';\n  return '<svg class=\"mounted-wall\" viewBox=\"0 0 1672 941\" aria-hidden=\"true\" focusable=\"false\"><defs>'+\n    gradients+'<path id=\"wall-mounts\" d=\"'+cast+'\"/>'+reflections+\n    '<filter id=\"wall-falloff\" x=\"-25%\" y=\"-80%\" width=\"150%\" height=\"260%\"><feGaussianBlur stdDeviation=\"'+falloff+'\"/></filter>'+\n    '<filter id=\"wall-contact\" x=\"-15%\" y=\"-45%\" width=\"130%\" height=\"190%\"><feGaussianBlur stdDeviation=\"'+blur+'\"/></filter>'+\n    '<filter id=\"wall-bevel\" x=\"-10%\" y=\"-20%\" width=\"120%\" height=\"140%\" color-interpolation-filters=\"sRGB\">'+\n    '<feGaussianBlur in=\"SourceAlpha\" stdDeviation=\"1.18\" result=\"height\"/>'+\n    '<feSpecularLighting in=\"height\" surfaceScale=\"4.2\" specularConstant=\"1\" specularExponent=\"11\" lighting-color=\"'+sheen+'\"><feDistantLight azimuth=\"248\" elevation=\"34\"/></feSpecularLighting>'+\n    '<feComposite in2=\"SourceAlpha\" operator=\"in\"/></filter>'+\n    '<clipPath id=\"wall-metal-clip\">'+fronts.join('')+'</clipPath>'+\n    '<radialGradient id=\"wall-sheen\" gradientUnits=\"userSpaceOnUse\" cx=\"'+lightX+'\" cy=\"'+lightY+'\" r=\"245\" gradientTransform=\"rotate(7 '+lightX+' '+lightY+')\">'+\n    '<stop stop-color=\"'+sheen+'\" stop-opacity=\".39\"/><stop offset=\".44\" stop-color=\"'+sheen+'\" stop-opacity=\".12\"/><stop offset=\"1\" stop-color=\"'+sheen+'\" stop-opacity=\"0\"/></radialGradient>'+\n    '</defs>'+\n    (glow ? pathLayer(glow,.64,'wall-falloff',-1,-2) : '')+\n    pathLayer(shadow,opacity,'wall-falloff',shadowX,shadowY)+\n    pathLayer(shadow,opacity*.7,'wall-contact',shadowX*.43,shadowY*.39)+\n    edges+'<use href=\"#wall-metal-face\"/>'+\n    '<rect width=\"1672\" height=\"941\" clip-path=\"url(#wall-metal-clip)\" fill=\"url(#wall-sheen)\"/>'+\n    '<use href=\"#wall-metal-face\" filter=\"url(#wall-bevel)\" opacity=\"'+specular+'\" style=\"mix-blend-mode:screen\"/>'+\n    (glow ? '<path d=\"'+highlights.join('')+'\" fill=\"none\" stroke=\"'+surface.glint+'\" stroke-width=\".85\" stroke-opacity=\".69\" stroke-linecap=\"round\"/>' : '')+\n    '</svg>';\n}\n"
  ]
];

const changes={
  'assets/eden-wall-lettering.js':rendererChanges,
  'assistant-setup/index.html':[
    ['eden-wall-lettering.js?v=template-fonts-1','eden-wall-lettering.js?v=photographic-finish-1'],
    ['<!doctype html>','<!doctype html><!-- '+marker+' -->']
  ]
};
const files=Object.entries(changes).map(([path,edits])=>{
  const before=readFileSync(join(root,path),'utf8');
  if(before.includes(marker))return {path,before,after:before};
  if(!before.includes('Eden original template lettering v1'))
    throw Error('Install the template lettering update before applying this refinement.');
  let after=before;
  for(const [from,to] of edits)after=replace(after,from,to,path);
  return {path,before,after};
});

for(const {path,after} of files){
  const code=path.endsWith('.html')?after.match(/<script type="module">([\s\S]+?)<\/script>/)?.[1]:after;
  if(!code)throw Error('Could not find the setup page script.');
  execFileSync(process.execPath,['--check','--input-type=module'],{input:code,encoding:'utf8'});
}

const changed=files.filter(file=>file.before!==file.after);
if(check||!changed.length){
  console.log('Wall finish check passed. '+changed.length+' file(s) would change.');
}else{
  const backup=mkdtempSync(join(tmpdir(),'eden-wall-finish-'));
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
  console.log('Wall finish updated. Backup: '+backup);
}
