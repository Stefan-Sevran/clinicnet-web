import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const check = args.includes('--check');
const [root = join(homedir(), 'Desktop', 'clinicnet-voice-preview')] = args.filter(arg => arg !== '--check');
const marker = 'Eden signed-in Workspace setup v2';

function replace(source, from, to) {
  const count = typeof from === 'string' ? source.split(from).length - 1 : [...source.matchAll(new RegExp(from, 'g'))].length;
  if (count !== 1) throw Error('Unexpected site version near ' + String(from).slice(0, 105));
  return source.replace(from, () => to);
}

const workspaceAuth = String.raw`/* Eden Workspace sign-in v2 */
const workspaceOrigin='https://clinicnet.live';
const workspaceConfigUrl='https://eden-webhook-ixdd.onrender.com/clinic/public-config';
const workspaceId=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const workspaceCookie='__Host-eden-setup';
const workspaceSessionSeconds=1800;
let workspaceConfigCache;

async function workspaceKey(secret,purpose,id){
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode('eden-workspace-v1:'+purpose+':'+id)))).slice(0,48);
}
// Eden Workspace Worker redirects v1
async function workspaceProject(){
  if(workspaceConfigCache?.expires>Date.now())return workspaceConfigCache.project;
  const response=await fetch(workspaceConfigUrl,{redirect:'manual',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('Workspace configuration unavailable');
  const config=await response.json(), url=new URL(config.supabaseUrl);
  if(url.protocol!=='https:'||!/^[a-z0-9]+\.supabase\.co$/.test(url.hostname)||
      url.href!==url.origin+'/'||!config.publishableKey)throw Error('Workspace configuration unavailable');
  const project={origin:url.origin,key:config.publishableKey};
  workspaceConfigCache={project,expires:Date.now()+300000};
  return project;
}
async function workspaceAccess(auth,accountId,locationId){
  if(!auth?.startsWith('Bearer ')||auth.length>4103||!workspaceId.test(accountId)||!workspaceId.test(locationId))return null;
  const project=await workspaceProject();
  const get=path=>fetch(project.origin+path,{headers:{apikey:project.key,Authorization:auth},redirect:'manual',signal:AbortSignal.timeout(8000)});
  const userResponse=await get('/auth/v1/user');
  if([401,403].includes(userResponse.status))return null;
  if(!userResponse.ok)throw Error('Workspace sign-in unavailable');
  const user=await userResponse.json();
  if(!workspaceId.test(user.id)||!user.email_confirmed_at)return null;
  const roles=new URLSearchParams({select:'role',user_id:'eq.'+user.id,account_id:'eq.'+accountId});
  const locations=new URLSearchParams({select:'id,name',id:'eq.'+locationId,account_id:'eq.'+accountId});
  const [roleResponse,locationResponse]=await Promise.all([
    get('/rest/v1/clinic_memberships?'+roles),get('/rest/v1/clinic_locations?'+locations)
  ]);
  if([401,403].some(code=>code===roleResponse.status||code===locationResponse.status))return null;
  if(!roleResponse.ok||!locationResponse.ok)throw Error('Workspace location access unavailable');
  const [membership]=await roleResponse.json(), [location]=await locationResponse.json();
  return ['owner','admin'].includes(membership?.role)&&location?.id===locationId?{userId:user.id,locationName:location.name}:null;
}

function base64url(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function unbase64url(text){return Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0))}
async function workspaceCipher(env){
  const bytes=await crypto.subtle.digest('SHA-256',enc.encode('eden-workspace-cookie-v2:'+env.PILOT_ADMIN_TOKEN));
  return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);
}
async function sealWorkspace(env,session){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},await workspaceCipher(env),enc.encode(JSON.stringify(session)));
  return base64url(iv)+'.'+base64url(new Uint8Array(data));
}
async function openWorkspace(env,sealed){
  if(!env.PILOT_ADMIN_TOKEN||!/^[\w-]{16}\.[\w-]{20,5600}$/.test(sealed||''))return null;
  try{
    const [iv,ciphertext]=sealed.split('.').map(unbase64url);
    const data=await crypto.subtle.decrypt({name:'AES-GCM',iv},await workspaceCipher(env),ciphertext);
    const session=JSON.parse(new TextDecoder().decode(data));
    return session.expires>Date.now()?session:null;
  }catch{return null}
}
async function workspaceSession(request,env){
  const cookie=request.headers.get('Cookie')?.split(';').map(part=>part.trim()).find(part=>part.startsWith(workspaceCookie+'='));
  const session=await openWorkspace(env,cookie?.slice(workspaceCookie.length+1));
  if(!session)return null;
  const access=await workspaceAccess(session.auth,session.accountId,session.locationId);
  return access?.userId===session.userId?{...session,locationName:access.locationName}:null;
}

async function ensureWorkspaceTables(db){
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS assistant_workspace_locations (account_id TEXT NOT NULL,location_id TEXT NOT NULL,invite_hash TEXT NOT NULL UNIQUE,assistant_id TEXT UNIQUE,PRIMARY KEY(account_id,location_id))'),
    db.prepare('CREATE TABLE IF NOT EXISTS assistant_workspace_tickets (ticket_hash TEXT PRIMARY KEY,sealed TEXT NOT NULL,expires_at INTEGER NOT NULL)')
  ]);
}
async function workspaceBinding(env,session){
  return env.PILOT_DB.prepare('SELECT * FROM assistant_workspace_locations WHERE account_id=? AND location_id=?')
    .bind(session.accountId,session.locationId).first();
}
async function workspaceLink(request,env){
  if(request.headers.get('Origin')!==workspaceOrigin)return json({error:'Open setup from Clinic Workspace.'},403);
  const headers={...JSON_HEADERS,'Access-Control-Allow-Origin':workspaceOrigin,'Vary':'Origin'};
  const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,
    'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});
  if(request.method!=='POST'||!request.headers.get('Content-Type')?.startsWith('application/json'))
    return respond({error:'Open setup from Clinic Workspace.'},405);
  if(!env.PILOT_ADMIN_TOKEN)return respond({error:'Private setup is not configured.'},503);
  try{
    const {accountId,locationId}=await body(request);
    if(!workspaceId.test(accountId)||!workspaceId.test(locationId))return respond({error:'Choose a valid clinic location.'},400);
    const auth=request.headers.get('Authorization');
    const access=await workspaceAccess(auth,accountId,locationId);
    if(!access)return respond({error:'Sign in as an owner or admin of this location to open setup.'},403);
    if(!await limit(env,'workspace-link:'+access.userId,30,3600))return respond({error:'Try opening setup again later.'},429);
    const db=env.PILOT_DB, ticket=random(), stamp=Date.now();
    await ensureWorkspaceTables(db);
    const sealed=await sealWorkspace(env,{auth,accountId,locationId,userId:access.userId,expires:stamp+workspaceSessionSeconds*1000});
    if(sealed.length>3800)return respond({error:'Refresh your Workspace session and try again.'},409);
    await db.batch([
      db.prepare('DELETE FROM assistant_workspace_tickets WHERE expires_at<=?').bind(stamp),
      db.prepare('INSERT INTO assistant_workspace_tickets VALUES (?,?,?)').bind(await sha(ticket),sealed,stamp+90000)
    ]);
    const url=new URL('/assistant-setup/?workspace=1',request.url);
    url.hash='workspace='+ticket;
    return respond({url:url.href});
  }catch(error){
    if(error instanceof SyntaxError||error.message==='Too large')return respond({error:'Invalid setup request.'},400);
    return respond({error:'Private setup is temporarily unavailable. Try again shortly.'},503);
  }
}
async function openWorkspaceSetup(request,env){
  if(!allowPost(request))return json({error:'Open setup from Clinic Workspace.'},403);
  const {ticket}=await body(request);
  let session, sealed;
  if(ticket){
    if(!/^[a-f0-9]{48}$/.test(ticket))return json({error:'Open setup again from Workspace.'},400);
    await ensureWorkspaceTables(env.PILOT_DB);
    const row=await env.PILOT_DB.prepare('DELETE FROM assistant_workspace_tickets WHERE ticket_hash=? AND expires_at>? RETURNING sealed')
      .bind(await sha(ticket),Date.now()).first();
    sealed=row?.sealed;
    const opened=await openWorkspace(env,sealed);
    const access=opened&&await workspaceAccess(opened.auth,opened.accountId,opened.locationId);
    if(access&&access.userId===opened.userId)session={...opened,locationName:access.locationName};
  }else session=await workspaceSession(request,env);
  if(!session)return json({error:'Your setup session expired. Return to Workspace and select Open setup.'},401);

  // Adopt a setup previously created through this location’s Workspace link.
  const inviteToken=await workspaceKey(env.PILOT_ADMIN_TOKEN,'invite',session.accountId+':'+session.locationId);
  const inviteHash=await sha(inviteToken);
  await env.PILOT_DB.prepare(
    'INSERT INTO assistant_workspace_locations (account_id,location_id,invite_hash,assistant_id) VALUES (?,?,?,(SELECT claimed_assistant_id FROM assistant_invites WHERE token_hash=?)) ON CONFLICT(account_id,location_id) DO NOTHING'
  ).bind(session.accountId,session.locationId,inviteHash,inviteHash).run();
  const binding=await workspaceBinding(env,session);
  const destination=new URL('/clinic/',workspaceOrigin);
  destination.search=new URLSearchParams({account:session.accountId,location:session.locationId,setup:'website_chat'});
  const headers={...JSON_HEADERS};
  if(sealed)headers['Set-Cookie']=workspaceCookie+'='+sealed+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+workspaceSessionSeconds;
  return new Response(JSON.stringify({id:binding.assistant_id,locationName:session.locationName,returnUrl:destination.href}),{headers});
}

async function findWorkspaceScope(env,column,value){
  try{
    return await env.PILOT_DB.prepare('SELECT account_id,location_id FROM assistant_workspace_locations WHERE '+column+'=?').bind(value).first();
  }catch(error){
    if(/no such table: assistant_workspace_locations/i.test(error.message))return null;
    throw error;
  }
}
async function owner(request,env,id){
  const token=request.headers.get('Authorization')?.replace(/^Bearer /,'');
  if(!token&&!request.headers.get('Cookie')?.includes(workspaceCookie+'='))return null;
  const scope=await findWorkspaceScope(env,'assistant_id',id);
  if(scope){
    const session=await workspaceSession(request,env);
    if(!session||session.accountId!==scope.account_id||session.locationId!==scope.location_id)return null;
    return env.PILOT_DB.prepare('SELECT * FROM clinic_assistants WHERE id=?').bind(id).first();
  }
  if(!/^[a-f0-9]{48}$/.test(token||''))return null;
  return env.PILOT_DB.prepare('SELECT * FROM clinic_assistants WHERE id=? AND owner_hash=?').bind(id,await sha(token)).first();
}
function closeWorkspaceSetup(request){
  if(!allowPost(request))return json({error:'Open setup from Clinic Workspace.'},403);
  return new Response('{}',{headers:{...JSON_HEADERS,
    'Set-Cookie':workspaceCookie+'=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'}});
}
`;
const createAssistant = String.raw`async function create(request,env){
  if(!allowPost(request))return json({error:'Open setup on this site.'},403);
  const x=await body(request);
  if(!types.has(x.template)||!value(x.clinic,2,70)||!value(x.city,2,80)||!value(x.services,3,700)||
      !value(x.slug,3,50)||!validSlug(x.slug)||!value(x.hours||'',0,160)||!value(x.featuredService||'',0,80)||
      ((x.featuredService||'').trim()&&!splitServices(x.services).includes(x.featuredService.trim())))
    return json({error:'Check clinic details and page address.'},400);
  const lang=['English','English and Filipino','English and Thai','Thai'].includes(x.language)?x.language:'English';
  const mode=['request','information'].includes(x.bookingMode)?x.bookingMode:'request';
  const id=crypto.randomUUID(), stamp=now(), key=random(), db=env.PILOT_DB;
  const fields=[id,await sha(key),x.slug,x.clinic.trim(),x.city.trim(),x.services.trim(),(x.hours||'').trim(),lang,x.template,mode,(x.featuredService||'').trim()||null,stamp,stamp];
  const insert='INSERT INTO clinic_assistants (id,owner_hash,slug,clinic,city,services,hours,language,template,booking_mode,featured_service,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?';
  await ensureWorkspaceTables(db);
  let claim, createRow;
  if(x.workspace===true){
    const session=await workspaceSession(request,env);
    if(!session)return json({error:'Open setup again from Clinic Workspace.'},401);
    const scope=[session.accountId,session.locationId];
    claim=db.prepare('UPDATE assistant_workspace_locations SET assistant_id=? WHERE account_id=? AND location_id=? AND assistant_id IS NULL')
      .bind(id,...scope);
    createRow=db.prepare(insert+' FROM assistant_workspace_locations WHERE account_id=? AND location_id=? AND assistant_id=?')
      .bind(...fields,...scope,id);
  }else{
    if(!/^[a-f0-9]{48}$/.test(x.invite||''))return json({error:'Open setup from Clinic Workspace.'},401);
    const hash=await sha(x.invite);
    claim=db.prepare('UPDATE assistant_invites SET claimed_assistant_id=? WHERE token_hash=? AND claimed_assistant_id IS NULL AND expires_at>? AND NOT EXISTS (SELECT 1 FROM assistant_workspace_locations WHERE invite_hash=?)')
      .bind(id,hash,stamp,hash);
    createRow=db.prepare(insert+' FROM assistant_invites WHERE token_hash=? AND claimed_assistant_id=?')
      .bind(...fields,hash,id);
  }
  try{
    const [claimed,created]=await db.batch([claim,createRow]);
    if(claimed.meta?.changes!==1||created.meta?.changes!==1)
      return json({error:x.workspace?'Setup is already started. Reload to open it.':'Invitation used or expired.'},409);
  }catch(error){
    if(/UNIQUE|constraint/i.test(error.message||''))return json({error:'That page address is already taken. Choose another.'},409);
    throw error;
  }
  return json({id,slug:x.slug,...(x.workspace?{}:{key})});
}
`;

function updateCore(source) {
  if (source.includes(marker)) return source;
  if (!source.includes('Eden unified wall confirmation and owner test v1')) throw Error('Install the wall confirmation and owner test update first.');
  source = replace(source, /async function owner\(request,env,id\)\{[^\n]+\}\n/, '');
  source = replace(source, /\/\* Eden private Workspace setup v1 \*\/[\s\S]+?(?=\/\* Eden Eve owner onboarding v1 \*\/)/,
    '/* '+marker+' */\n'+workspaceAuth+'\n'+createAssistant+'\n');
  source = replace(source, "if(path==='/__eden/assistant-invites'&&request.method==='POST')return invite(request,env);",
    "if(path==='/api/assistants/workspace-session'&&request.method==='POST')return await openWorkspaceSetup(request,env);if(path==='/api/assistants/workspace-close'&&request.method==='POST')return closeWorkspaceSetup(request);if(path==='/__eden/assistant-invites'&&request.method==='POST')return json({error:'Create new invitations from Clinic Workspace.'},410);");
  source = replace(source, "if(request.headers.has('Authorization')){\n    if(!await owner(request,env,a.id))", "if(request.headers.has('Authorization')||request.headers.get('X-Eden-Owner-Test')==='1'){\n    if(!await owner(request,env,a.id))");
  const match = /const receptionistClient\s*=\s*("(?:\\.|[^"\\])*");/;
  const client = JSON.parse(match.exec(source)[1]);
  const revised = replace(replace(replace(client,
    "  if (testKey) {", "  const workspaceTest = location.hash === '#owner-test=workspace';\n  const isOwnerTest = Boolean(testKey || workspaceTest);\n  if (isOwnerTest) {"),
    "...(testKey ? {Authorization:'Bearer '+testKey} : {})", "...(testKey ? {Authorization:'Bearer '+testKey} : workspaceTest ? {'X-Eden-Owner-Test':'1'} : {})"),
    "if (!testKey) {", "if (!isOwnerTest) {")
    .replaceAll("testKey ? 'This", "isOwnerTest ? 'This")
    .replaceAll("testKey ? 'Test complete", "isOwnerTest ? 'Test complete")
    .replaceAll("if (!testKey) requestSent", "if (!isOwnerTest) requestSent");
  return replace(source,match,'const receptionistClient = '+JSON.stringify(revised)+';');
}

function updateSetup(source) {
  if (source.includes(marker)) return source;
  if (!source.includes('Eden unified wall confirmation and owner test v1')) throw Error('Install the wall confirmation and owner test update first.');
  source = replace(source, '<section id="screen-no-invite" hidden><h2>Open your invitation.</h2><p>This first release requires an Eden invitation link. Ask Eden for a setup invitation, then open that link on this device.</p></section>',
    '<section id="screen-no-invite" hidden><h2>Open setup from Clinic Workspace</h2><p>Sign in, select your clinic location, then choose Website chat → Open setup.</p><a class="btn light" href="https://clinicnet.live/clinic/">Go to Clinic Workspace</a></section>');
  source = replace(source, '<p class="muted">Keep this setup link private. It gives access to this assistant. You can bookmark it before leaving.</p>',
    '<p class="muted" id="legacyAccessHint">Keep this setup link private. It gives access to this assistant. You can bookmark it before leaving.</p>');
  source = replace(source, '<section id="screen-manage" hidden>', '<a class="btn light" id="backToWorkspace" href="https://clinicnet.live/clinic/" hidden>Back to Clinic Workspace</a><section id="screen-manage" hidden>');
  source = replace(source, 'const workspaceInvite=/^#invite=', '/* '+marker+' */\nconst useWorkspace=new URLSearchParams(location.search).get(\'workspace\')===\'1\';\nconst setupTicket=/^#workspace=([a-f0-9]{48})$/.exec(location.hash)?.[1];\nif(setupTicket)history.replaceState(null,\'\',location.pathname+location.search);\nconst workspaceInvite=/^#invite=');
  source = replace(source, "if(!invite){status('createStatus','Open your invitation first.',true);return}const x={invite,template,", "if(!invite&&!useWorkspace){status('createStatus','Open setup from Clinic Workspace.',true);return}const x={invite:useWorkspace?undefined:invite,workspace:useWorkspace,template,");
  source = replace(source, "location.hash=id+'.'+key;await reload()", "if(!useWorkspace)location.hash=id+'.'+key;await reload()");
  source = replace(source, "headers:{Authorization:'Bearer '+key},cache:'no-store'", "headers:key?{Authorization:'Bearer '+key}:{},cache:'no-store'");
  source = replace(source, "if(!assistant?.publicUrl||!key)return;\n  location.assign(assistant.publicUrl+'#owner-test='+key);",
    "if(!assistant?.publicUrl||(!key&&!useWorkspace))return;\n  location.assign(assistant.publicUrl+'#owner-test='+(useWorkspace?'workspace':key));");
  return replace(source, "if(id&&key){activeStep=1;", String.raw`async function startWorkspace(){
  $('backToWorkspace').hidden=false;
  $('legacyAccessHint').hidden=true;
  $('backToWorkspace').onclick=async event=>{
    event.preventDefault();
    try{await api('/api/assistants/workspace-close',{method:'POST',body:'{}',signal:AbortSignal.timeout(2500)})}catch{}
    location.assign($('backToWorkspace').href);
  };
  try{
    const setup=await api('/api/assistants/workspace-session',{method:'POST',body:JSON.stringify({ticket:setupTicket})});
    $('backToWorkspace').href=setup.returnUrl;
    if(setup.id){id=setup.id;activeStep=1;view('screen-manage');await reload()}
    else{
      if(!$('clinic').value&&setup.locationName){
        $('clinic').value=setup.locationName;
        $('clinic').dispatchEvent(new Event('input'));
      }
      view('screen-create');
    }
  }catch(error){
    view('screen-no-invite');
    $('screen-no-invite').querySelector('p').textContent=error.message;
  }
}
if(useWorkspace)void startWorkspace();
else if(id&&key){activeStep=1;`);
}
const files = [
  ['assistant-setup/index.html',updateSetup],
  ['assistant-core.js',updateCore]
].map(([path,transform])=>{
  const before=readFileSync(join(root,path));
  return {path,before,after:Buffer.from(transform(before.toString('utf8')))};
});
const changes=files.filter(({before,after})=>!before.equals(after));
if(check||!changes.length){
  console.log('Signed-in Workspace setup check passed. '+changes.length+' file(s) would change.');
}else{
  const backup=mkdtempSync(join(tmpdir(),'eden-workspace-sign-in-'));
  for(const {path,before} of changes){
    const target=join(backup,path);
    mkdirSync(dirname(target),{recursive:true});
    writeFileSync(target,before);
  }
  const written=[];
  try{
    for(const {path,before,after} of changes){
      const file=join(root,path);
      if(!readFileSync(file).equals(before))throw Error('The site changed during the update. Run the installer again.');
      const temporary=file+'.eden-'+process.pid;
      writeFileSync(temporary,after,{flag:'wx'});
      try{
        renameSync(temporary,file);
        written.push({file,before});
      }finally{rmSync(temporary,{force:true})}
    }
  }catch(error){
    for(const {file,before} of written.reverse())writeFileSync(file,before);
    throw error;
  }
  console.log('Signed-in Workspace setup installed. Backup: '+backup);
}
