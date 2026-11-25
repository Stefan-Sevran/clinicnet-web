import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {basename, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const {positionals, values} = parseArgs({allowPositionals:true, options:{deploy:{type:'boolean'}}});
if (positionals.length > 1) throw Error('Pass at most one deployed source folder.');
const repository = fileURLToPath(new URL('../', import.meta.url));
const pagePath = 'clinic/index.html';
const baseVersion = '2f020b83c57a';
const baseScriptHash = 'a33955e873036c4592f9023975b461db5e564e8f348692e6d11cf4d764f8ffcd';
const previousScriptBlob = '6e19f6a25fd4f0a9ac3a60978c5d4f9bbd274c28';
function tagsFor(version) { return [
  '<link rel="stylesheet" href="/assets/ask-eden.css?v='+version+'">',
  ...['eden-support-knowledge','ask-eden','clinic']
    .map(name=>'<script defer src="/assets/'+name+'.js?v='+version+'"></script>')
].join('\n'); }
function installedTags(page) {
  const version = page.match(/\/assets\/clinic\.js\?v=([a-f0-9]{12})"/)?.[1];
  const tags = version && tagsFor(version);
  return tags && page.includes(tags) ? tags : null;
}
const requiredFiles = [pagePath,'assets/clinic.js','_worker.js','_headers','index.html',
  'assistant-setup/index.html','assistant-core.js','pearlsmile-cebu/index.html','privacy/index.html','terms/index.html'];
const assets = ['assets/clinic.js','assets/ask-eden.js','assets/ask-eden.css','assets/eden-support-knowledge.js'];

function matchesProduction(folder) {
  if (!requiredFiles.every(file => existsSync(join(folder,file)))) return false;
  const page = readFileSync(join(folder,pagePath),'utf8');
  const script = readFileSync(join(folder,'assets/clinic.js'));
  const blobHash = createHash('sha1').update('blob ' + script.length + '\0').update(script).digest('hex');
  const originalPilot = page.includes(tagsFor(baseVersion)) &&
    createHash('sha256').update(script).digest('hex') === baseScriptHash;
  return installedTags(page) && page.includes('id="clinic-code-form"') &&
    (originalPilot || blobHash === previousScriptBlob) &&
    readFileSync(join(folder,'_worker.js'),'utf8').includes('Serve the Clinic Workspace from Pages assets.');
}

const candidates = positionals.length ? [resolve(positionals[0])] : [
  join(homedir(),'Desktop','clinicnet-voice-preview'),
  ...[...new Set([tmpdir(),'/tmp'])].flatMap(directory =>
    readdirSync(directory,{withFileTypes:true})
      .filter(entry => entry.isDirectory() && /^(?:tmp\.|clinicnet-ask-eden-cebu-)/.test(entry.name))
      .map(entry => join(directory,entry.name)))
];
const source = candidates.filter(matchesProduction)
  .sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs)[0];
if (!source) throw Error('Could not find the currently deployed ClinicNet bundle. Pass the exact folder from the last production upload.');

const staged = mkdtempSync(join(tmpdir(),'clinicnet-ask-eden-cebu-'));
const excluded = /^(?:\.|node_modules$|backups$)|\.(?:pem|key|p12|log|bak|zip)$/i;
cpSync(source,staged,{recursive:true,filter:path=>path===source || !excluded.test(basename(path))});
const page = readFileSync(join(staged,pagePath),'utf8');
const version = createHash('sha256');
for (const path of assets) {
  const asset = readFileSync(join(repository,path));
  version.update(asset);
  writeFileSync(join(staged,path),asset);
}
const revision = version.digest('hex').slice(0,12);
const stylesheet = '<link rel="stylesheet" href="/assets/ask-eden.css?v='+revision+'">';
const scripts = ['eden-support-knowledge','ask-eden','clinic']
  .map(name=>'<script defer src="/assets/'+name+'.js?v='+revision+'"></script>').join('\n');
writeFileSync(join(staged,pagePath),page.replace(installedTags(page),stylesheet+'\n'+scripts));
execFileSync(process.execPath,['--check',join(staged,'assets/clinic.js')],{stdio:'inherit'});
execFileSync(process.execPath,['--check',join(staged,'assets/ask-eden.js')],{stdio:'inherit'});
console.log('Staged the Cebu Ask Eden pilot in '+staged);
if (values.deploy) {
  for (const [route,path] of [['/','index.html'],['/clinic/',pagePath],['/assets/clinic.js','assets/clinic.js'],
    ['/assistant-setup/','assistant-setup/index.html']]) {
    const live = execFileSync('curl',['-fsSL','--max-time','20','https://clinicnet.live'+route]);
    if (!live.equals(readFileSync(join(source,path)))) {
      throw Error('Production changed or the source bundle is stale at '+route+'. Nothing was deployed.');
    }
  }
  // The custom domain rewrites email addresses in HTML. Read the source from
  // the production Pages hostname so the deployment retains the original HTML.
  for (const [name,title] of [['privacy','Privacy Policy'],['terms','Terms of Service']]) {
    const route = '/'+name+'/';
    const live = execFileSync('curl',['-fsSL','--max-redirs','0','--max-time','20',
      'https://clinicnet-web.pages.dev'+route]);
    const html = live.toString('utf8');
    if (!/^\s*<!doctype html>/i.test(html) || !html.includes('<title>'+title+' | Eden Clinic Network</title>') ||
        !html.includes('<link rel="canonical" href="https://clinicnet.live'+route+'">')) {
      throw Error('Could not verify the production policy page at '+route+'. Nothing was deployed.');
    }
    const path = join(staged,name,'index.html');
    if (!live.equals(readFileSync(path))) {
      writeFileSync(path,live);
      console.log('Preserved the current production page at '+route);
    }
  }
  execFileSync('npx',['wrangler','pages','deploy','.','--project-name','clinicnet-web','--branch','main'],
    {cwd:staged,stdio:'inherit'});
}
