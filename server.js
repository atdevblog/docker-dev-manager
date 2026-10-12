'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const A = require('./lib/analysis');
const I18N = require('./public/i18n.js');
// API errors carry the message descriptor for the UI plus an English rendering for curl/CLI users.
const EN = I18N.create({vi:require('./public/locales/vi.json'),en:require('./public/locales/en.json')},'en');
const exec = promisify(execFile);
const PORT = Number(process.env.DEV_MANAGER_PORT || 4173);
const HOST = '127.0.0.1';
const CONFIG_DIR = process.env.DEV_MANAGER_CONFIG_DIR || path.join(os.homedir(), '.config', 'docker-dev-manager');
const CONFIG_FILE = path.join(CONFIG_DIR, 'projects.json');
const STATIC_DIR = path.join(__dirname, 'public');
const TOKEN = crypto.randomBytes(24).toString('hex');
const operations = new Set();
const MAX_OUTPUT = 4 * 1024 * 1024;
// Compose project names as they appear in container labels.
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const ACTIONS = {start:['start'],stop:['stop'],restart:['restart'],up:['up','-d'],down:['down']};
const APPS = {finder:null,terminal:'Terminal',vscode:'Visual Studio Code'};
const ACTION_KEYS = {start:'verb.start',stop:'verb.stop',restart:'verb.restart',up:'verb.up',down:'verb.down'};

function respond(res, code, value) {
  const body = JSON.stringify(value);
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(body);
}
function fail(res,code,message) { respond(res,code,typeof message==='string'?{error:message}:{error:EN.render(message),message}); }
function appError(key,params) { const e=new Error(key); e.msg=A.msg(key,params); return e; }
const why = e => e.msg || e.message;
function readStore() {
  try {
    const content = JSON.parse(fs.readFileSync(CONFIG_FILE,'utf8'));
    return content && typeof content==='object' && !Array.isArray(content) ? content : {};
  } catch (e) {if (e.code==='ENOENT') return {}; throw e;}
}
function readConfig() { const c=readStore(); return Array.isArray(c.projects) ? c.projects : []; }
// language is '' when unset or no longer valid: the UI then falls back to Vietnamese.
function readWorkspace() { const c=readStore(); return {keepRunning:Array.isArray(c.keepRunning)?c.keepRunning:[],language:I18N.valid(c.language)?c.language:''}; }
function validProject(p) {
  if (!p || typeof p!=='object' || typeof p.name!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,49}$/.test(p.name)) throw appError('error.projectName');
  if (typeof p.directory !== 'string' || !path.isAbsolute(p.directory)) throw appError('error.directoryAbsolute');
  if (!fs.existsSync(p.directory) || !fs.statSync(p.directory).isDirectory()) throw appError('error.directoryMissing');
  if (typeof p.composeFile !== 'string' || !p.composeFile || path.isAbsolute(p.composeFile)) throw appError('error.composeRelative');
  const root = fs.realpathSync(p.directory);
  const resolved = path.resolve(root,p.composeFile);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw appError('error.composeMissing');
  if (!fs.realpathSync(resolved).startsWith(root+path.sep)) throw appError('error.composeOutside');
  if (typeof p.description!=='undefined' && (typeof p.description!=='string'||p.description.length>240)) throw appError('error.description');
  return {name:p.name,directory:root,composeFile:path.relative(root,fs.realpathSync(resolved)),description:p.description||''};
}
function validWorkspace(w) {
  if (!w || typeof w!=='object') throw appError('error.workspace');
  if (w.language!==undefined && !I18N.valid(w.language)) throw appError('error.language');
  const keep=w.keepRunning===undefined?[]:w.keepRunning;
  if (!Array.isArray(keep) || keep.length>100 || keep.some(n=>typeof n!=='string'||!NAME.test(n))) throw appError('error.keepRunningList');
  return {keepRunning:[...new Set(keep)],...(w.language!==undefined?{language:w.language}:{})};
}
function writeStore(store) {
  fs.mkdirSync(CONFIG_DIR,{recursive:true,mode:0o700});
  const tmp = CONFIG_FILE+'.'+process.pid+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(store,null,2)+'\n',{mode:0o600});
  fs.renameSync(tmp,CONFIG_FILE);
}
// Each writer replaces only its own keys; everything else in the file is preserved.
function writeConfig(projects) { writeStore({...readStore(),projects}); }
function writeWorkspace(workspace) { writeStore({...readStore(),...workspace}); }
function docker(args,opts={}) {
  return exec('docker',args,{cwd:opts.cwd,timeout:opts.timeout||20000,maxBuffer:MAX_OUTPUT,env:opts.env||{...process.env,COMPOSE_ANSI:'never'}});
}
function composeArgs(project, command) { return ['compose','-p',project.name,'-f',project.composeFile,...command]; }
function dockerError(e) {return String(e.stderr || e.message || e).slice(0,1200).trim();}
// "Label mode": `docker compose -p NAME start|stop|restart|logs` rebuilds the project, including
// depends_on order, from container labels alone, so it needs no Compose file and works for
// multi-file stacks. Compose would still load a compose file found in the working directory or
// any parent, so it runs in an empty directory with no COMPOSE_* overrides.
const COMPOSE_NAMES = ['compose.yaml','compose.yml','docker-compose.yaml','docker-compose.yml'];
function labelMode() {
  const dir = path.join(os.tmpdir(),'docker-dev-manager-label-mode');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  for (let d=fs.realpathSync(dir);;d=path.dirname(d)) {
    for (const f of COMPOSE_NAMES) if (fs.existsSync(path.join(d,f))) throw appError('error.labelMode',{file:path.join(d,f)});
    if (path.dirname(d)===d) break;
  }
  const env = {...process.env,COMPOSE_ANSI:'never'};
  for (const k of ['COMPOSE_FILE','COMPOSE_PROFILES','COMPOSE_PROJECT_NAME','COMPOSE_PATH_SEPARATOR','COMPOSE_ENV_FILES']) delete env[k];
  return {cwd:fs.realpathSync(dir),env};
}
function labelCompose(name,args,timeout=120000) { return docker(['compose','-p',name,...args],{...labelMode(),timeout}); }
// Shares one in-flight load between concurrent callers and reuses the result for `ttl` ms.
function cached(ttl,load) {
  let at=0,value,pending=null;
  const get=async(maxAge=ttl)=>{
    if (at && Date.now()-at<maxAge) return value;
    if (!pending) pending=load().then(v=>{value=v;at=Date.now();pending=null;return v;},e=>{pending=null;throw e;});
    return pending;
  };
  get.invalidate=()=>{at=0;};
  return get;
}
// `docker version` costs about 1/20 of the host CPU of `docker info`, which also enumerates CLI plugins.
const dockerInfo = cached(10000, async()=>{
  try {const {stdout}=await docker(['version','--format','{{json .Server.Version}}'],{timeout:5000});return {available:true,version:JSON.parse(stdout.trim())};}
  catch(e){return {available:false,error:dockerError(e)};}
});
const vmInfo = cached(600000, async()=>{
  const {stdout}=await docker(['info','--format','{{json .MemTotal}} {{json .NCPU}}'],{timeout:10000});
  const [memTotal,ncpu]=stdout.trim().split(' ').map(Number);
  return {memTotal:memTotal||0,ncpu:ncpu||0};
});
async function inspectAll(ids) {
  const all=[];
  for(let i=0;i<ids.length;i+=75){
    try {const {stdout:json}=await docker(['inspect',...ids.slice(i,i+75)],{timeout:20000});all.push(...JSON.parse(json));}
    // A container removed between `ps` and `inspect` fails the batch; keep the ones Docker returned.
    catch(e){let partial;try{partial=JSON.parse(e.stdout||'');}catch{throw e;}all.push(...partial);}
  }
  return all;
}
// One `ps` + `inspect` + `network ls` feeds discovery, state, preflight and resources.
const dockerSnapshot = cached(2000, async()=>{
  const [{stdout:ids},{stdout:nets}]=await Promise.all([
    docker(['ps','-a','-q','--no-trunc'],{timeout:12000}),
    docker(['network','ls','--format','{{.Name}}\t{{.Label "com.docker.compose.project"}}'],{timeout:12000})]);
  const raw=await inspectAll(ids.trim().split(/\s+/).filter(Boolean));
  const networks=new Map(nets.split('\n').filter(Boolean).map(line=>{const [n,owner='']=line.split('\t');return [n,owner];}));
  return {raw,containers:raw.map(A.normalizeContainer),networks};
});
function importability(p) {
  const s=p.sources,labelsWork=A.msg('reason.labelsWork');
  if(s.length>1)return {reason:[A.msg('reason.sources',{count:s.length,sources:{sep:'; ',items:s.map(x=>A.msg('reason.source',{files:x.files.map(f=>path.basename(f)).join(' + ')||A.msg('common.unknownFile'),directory:x.directory||A.msg('common.unknownDir'),count:x.containers}))}}),labelsWork]};
  if(!s[0]||!s[0].directory||!s[0].files.length)return {reason:[A.msg('reason.noMeta'),labelsWork]};
  if(s[0].files.length!==1)return {reason:[A.msg('reason.multiFile',{count:s[0].files.length,files:s[0].files}),labelsWork]};
  if(!path.isAbsolute(s[0].directory)||!path.isAbsolute(s[0].files[0]))return {reason:A.msg('reason.notAbsolute')};
  try{return {importable:true,composeFile:validProject({name:p.name,directory:s[0].directory,composeFile:path.relative(s[0].directory,s[0].files[0])}).composeFile};}
  catch(e){return {reason:[why(e),labelsWork]};}
}
// Docker Compose metadata is advisory; discovery NEVER executes a Compose project.
function discoverFromInspect(containers, registered = [], networks = null) {
  const projects=A.summarizeProjects(containers.map(A.normalizeContainer));
  if(networks)A.linkProjects(projects,networks);
  return projects.map(p=>{
    const exists=registered.some(r=>r.name===p.name),check=importability(p),s=p.sources;
    return {...p,registered:exists,importable:!!check.importable&&!exists,reason:check.reason||'',composeFile:check.composeFile||'',
      directory:s.length===1?s[0].directory:'',files:s.length===1?s[0].files:[...new Set(s.flatMap(x=>x.files))]};
  });
}
function composeFileOk(reg) {try{return fs.statSync(path.resolve(reg.directory,reg.composeFile)).isFile();}catch{return false;}}
function mergeManaged(discovered, registered) {
  const map=new Map(discovered.map(p=>[p.name,{...p,managed:false,description:''}]));
  for(const reg of registered){
    const p=map.get(reg.name)||{name:reg.name,containers:[],running:0,total:0,oneoffs:0,status:'stopped',sources:[],issues:[],startedAt:'',dependsOn:[],usedBy:[],missingNetworks:[],files:[],reason:''};
    const fileOk=composeFileOk(reg);
    Object.assign(p,{managed:true,registered:true,importable:false,directory:reg.directory,composeFile:reg.composeFile,description:reg.description||'',composeFileOk:fileOk});
    if(!fileOk){
      p.issues=[...p.issues,{level:'warn',kind:'composefile',service:'',container:'',text:A.msg('issue.composeMissing'),hint:A.msg('issue.composeMissingHint',{path:path.join(reg.directory,reg.composeFile)})}];
      if(!p.total)p.status='error';
    }
    map.set(reg.name,p);
  }
  return [...map.values()].map(p=>({...p,commands:A.cliCommands(p)})).sort((a,b)=>a.name.localeCompare(b.name));
}
async function currentProjects(maxAge) {
  const snapshot=await dockerSnapshot(maxAge),registered=readConfig();
  return {snapshot,projects:mergeManaged(discoverFromInspect(snapshot.raw,registered,snapshot.networks),registered)};
}
async function stateView() {
  const docker=await dockerInfo(),workspace=readWorkspace(),offline=error=>({docker:{available:false,error},projects:mergeManaged([],readConfig()).map(p=>({...p,status:'unknown'})),groups:[],standalone:[],workspace});
  if(!docker.available)return offline(docker.error);
  try{
    const {snapshot,projects}=await currentProjects();
    const standalone=snapshot.containers.filter(c=>!c.project).map(c=>({name:c.name,state:c.state,image:c.image,ports:c.ports,exitCode:c.exitCode}));
    return {docker,projects,groups:A.autoGroups(projects),standalone,workspace};
  }catch(e){dockerInfo.invalidate();return offline(dockerError(e));}
}
async function stats() {
  const {stdout}=await docker(['stats','--no-stream','--format','{{json .}}'],{timeout:20000});
  return stdout.split('\n').filter(Boolean).flatMap(line=>{try {const p=JSON.parse(line);return [{id:p.ID,name:p.Name,cpu:p.CPUPerc,memory:p.MemUsage,memoryPercent:p.MemPerc,netIO:p.NetIO,
    cpuPercent:A.parsePercent(p.CPUPerc),memBytes:A.parseSize(String(p.MemUsage||'').split('/')[0])}];}catch{return [];}});
}
const statsCached = cached(5000, stats);
// CPU is averaged since the previous resources call (the UI asks every 30s), or since server start.
// It is sampled before this call starts its own docker commands so it does not measure itself.
let lastCpus = os.cpus(), lastCpuAt = Date.now();
function hostCpu() {
  const prev=lastCpus,elapsed=Date.now()-lastCpuAt;
  lastCpus=os.cpus();lastCpuAt=Date.now();
  return {cpuPercent:A.cpuPercent(prev,lastCpus),cpuWindowSec:Math.round(elapsed/1000)};
}
async function hostMemory() {
  const total=os.totalmem();
  if(process.platform==='darwin'){
    const [{stdout:vm},{stdout:sys}]=await Promise.all([exec('/usr/bin/vm_stat',[],{timeout:5000}),exec('/usr/sbin/sysctl',['-n','kern.memorystatus_vm_pressure_level','vm.swapusage'],{timeout:5000})]);
    const [level,swap='']=sys.trim().split('\n');
    return {total,...A.parseVmStat(vm),swap:A.parseSwap(swap),pressure:A.PRESSURE[Number(level)]||''};
  }
  try{return {...A.parseMeminfo(fs.readFileSync('/proc/meminfo','utf8')),pressure:''};}
  catch{return {total,used:total-os.freemem(),cached:0,swap:{total:0,used:0},pressure:''};}
}
async function hostInfo(cpu) {
  return {cores:os.cpus().length,...cpu,memory:await hostMemory()};
}
async function resourcesView() {
  const cpu=hostCpu();
  const [{projects},containers,vm,host]=await Promise.all([currentProjects(10000),statsCached(),vmInfo().catch(()=>({memTotal:0,ncpu:0})),hostInfo(cpu).catch(()=>null)]);
  return {vm,host,...A.resourceView(projects,containers,readWorkspace().keepRunning)};
}
// Listening TCP sockets of this user's processes (~0.1s). Root-owned listeners are invisible to lsof,
// so a port check also probes the port directly.
async function hostListeners() {
  for (const bin of ['lsof','/usr/sbin/lsof','/usr/bin/lsof']) {
    try {const {stdout}=await exec(bin,['-nP','-iTCP','-sTCP:LISTEN','+c','0','-F','pcn'],{timeout:8000,maxBuffer:MAX_OUTPUT});return A.parseLsof(stdout);}
    // lsof exits 1 when it cannot read some processes but still prints the rest.
    catch(e){if(e.code==='ENOENT')continue;if(e.stdout)return A.parseLsof(e.stdout);return [];}
  }
  return [];
}
const portEntries = cached(5000, async()=>{
  const [{snapshot},listeners]=await Promise.all([currentProjects(5000),hostListeners()]);
  return A.portInventory(snapshot.containers,listeners,process.pid);
});
async function portsView(check) {
  const entries=await portEntries();
  const checks=[];
  for(const port of check){
    const holders=entries.filter(e=>e.port===port);
    const alternatives=[];
    for(const p of A.nextFreePorts(port+1,entries,6)){if(alternatives.length===3)break;if(!(await listening(p)))alternatives.push(p);}
    const probed=!holders.length&&await listening(port);
    checks.push({port,free:!holders.length&&!probed,holders,probed,alternatives});
  }
  return {entries,checks,ephemeralStart:A.EPHEMERAL_START};
}
const diskReport = cached(60000, async()=>{
  const [{stdout},{snapshot}]=await Promise.all([docker(['system','df','-v','--format','{{json .}}'],{timeout:90000}),currentProjects(10000)]);
  return {...A.diskReport(JSON.parse(stdout),new Set(snapshot.containers.map(c=>c.project).filter(Boolean))),generatedAt:new Date().toISOString()};
});
// Connect, never bind: binding 0.0.0.0 here would trigger the macOS firewall prompt.
function listening(port) {
  const attempt=host=>new Promise(resolve=>{
    const socket=net.connect({host,port});
    const done=v=>{clearTimeout(timer);socket.destroy();resolve(v);};
    const timer=setTimeout(()=>done(false),300);
    socket.once('connect',()=>done(true));socket.once('error',()=>done(false));
  });
  return Promise.all([attempt('127.0.0.1'),attempt('::1')]).then(r=>r.some(Boolean));
}
async function composeConfig(p) {
  const {stdout}=await docker(composeArgs(p,['config','--format','json']),{cwd:p.directory,timeout:20000});
  // The resolved config contains interpolated environment values: only ports and network names are read from it.
  const cfg=JSON.parse(stdout);
  return {services:Object.entries(cfg.services||{}).map(([service,s])=>({service,ports:(s.ports||[]).map(x=>({ip:A.normalizeIp(x.host_ip),port:Number(x.published),proto:x.protocol||'tcp'})).filter(x=>Number.isInteger(x.port)&&x.port>0)})),
    external:Object.values(cfg.networks||{}).filter(n=>n.external).map(n=>n.name)};
}
const portText=c=>A.msg(c.byProject?'preflight.portTaken':'preflight.portTakenStandalone',{port:c.ip==='0.0.0.0'?String(c.port):`${c.ip}:${c.port}`,service:c.service,container:c.by,project:c.byProject});
async function hostPortWarnings(targets,containers) {
  // Ports held by a running container are reported from Docker metadata; a listener on any other port is a non-Docker process.
  const held=new Set(containers.filter(c=>c.state==='running').flatMap(c=>c.ports.map(b=>b.port)));
  const ports=[...new Set(targets.flatMap(t=>t.ports||[]).filter(b=>['0.0.0.0','127.0.0.1','::1'].includes(b.ip)&&!held.has(b.port)).map(b=>b.port))];
  const out=[];
  for(const port of ports)if(await listening(port))out.push(A.msg('preflight.hostListener',{port:String(port)}));
  return out;
}
// Preflight for one project. Errors block the action (Docker would fail anyway); warnings inform.
async function planItem(action,p,ctx) {
  const item={project:p?.name||'',action,containers:[],warnings:[],errors:[],skip:false,info:''};
  if(!p){item.errors.push(A.msg('error.projectNotFound'));return item;}
  const core=p.containers.filter(c=>!c.oneoff),running=core.filter(c=>c.state==='running'),services=list=>list.map(c=>c.service||c.name);
  if(p.sources.length>1&&!['up','down'].includes(action))item.warnings.push(A.msg('preflight.sharedSources',{count:p.sources.length,directories:p.sources.map(s=>s.directory||A.msg('common.unknownDir')),action:A.msg(ACTION_KEYS[action]),total:core.length}));
  if(action==='start'||action==='restart'){
    if(!core.length){item.errors.push(A.msg(p.managed?'preflight.noContainersManaged':'preflight.noContainers'));return item;}
    const targets=action==='start'?core.filter(c=>c.state!=='running'):core;
    if(!targets.length){item.skip=true;item.info=A.msg('preflight.alreadyRunning');return item;}
    item.containers=services(targets);
    for(const n of p.missingNetworks)item.errors.push(A.msg('preflight.missingNetwork',{network:n}));
    for(const d of p.dependsOn)if(!d.running)item.warnings.push(A.msg('preflight.providerStopped',{networks:d.networks,project:d.project}));
    if(action==='start'){
      const conflicts=A.portConflicts(targets,ctx.containers,p.name);
      item.errors.push(...conflicts.map(portText));
      item.warnings.push(...await hostPortWarnings(targets,ctx.containers));
      const home=os.homedir();
      for(const src of new Set(targets.flatMap(t=>t.binds)))if(src.startsWith(home+path.sep)&&!fs.existsSync(src))item.warnings.push(A.msg('preflight.bindMissing',{path:src}));
    }
    return item;
  }
  if(action==='stop'||action==='down'){
    if(action==='down'&&!p.managed){item.errors.push(A.msg('preflight.downNeedsImport'));return item;}
    if(action==='stop'&&!running.length){item.skip=true;item.info=A.msg('preflight.alreadyStopped');return item;}
    item.containers=services(action==='stop'?running:core);
    const users=p.usedBy.filter(u=>u.running&&!ctx.selected.has(u.project));
    if(users.length)item.warnings.push(A.msg(action==='down'?'preflight.dependentsDown':'preflight.dependents',{projects:users.map(u=>u.project),count:users.length,networks:[...new Set(users.flatMap(u=>u.networks))]}));
    if(ctx.keepRunning.includes(p.name))item.warnings.push(A.msg('preflight.keepRunning'));
    // Shared or protected projects are listed but left unticked: stopping them must be a deliberate choice.
    item.protect=users.length>0||ctx.keepRunning.includes(p.name);
    if(action==='down')item.warnings.push(A.msg('preflight.downInfo'));
    return item;
  }
  if(action==='up'){
    if(!p.managed){item.errors.push(A.msg('preflight.upNeedsImport'));return item;}
    if(!p.composeFileOk){item.errors.push(A.msg('issue.composeMissing'));return item;}
    let cfg;try{cfg=await composeConfig(p);}catch(e){item.errors.push(A.msg('preflight.composeInvalid',{detail:dockerError(e)}));return item;}
    item.containers=cfg.services.map(s=>s.service);
    for(const n of cfg.external)if(!ctx.networks.has(n))item.errors.push(A.msg('preflight.externalNetwork',{network:n}));
    item.errors.push(...A.portConflicts(cfg.services,ctx.containers,p.name).map(portText));
    item.warnings.push(...await hostPortWarnings(cfg.services,ctx.containers));
    item.warnings.push(A.msg('preflight.upRecreates'));
  }
  return item;
}
async function planFor(action,names) {
  if(!(await dockerInfo()).available)return {action,items:names.map(n=>({project:n,action,containers:[],warnings:[],errors:[A.msg('error.dockerOffline')],skip:false,info:''})),order:names};
  const {snapshot,projects}=await currentProjects(1000);
  const byName=new Map(projects.map(p=>[p.name,p])),selected=new Set(names),related=new Map();
  for(const n of names){
    const p=byName.get(n);if(!p)continue;
    // Only verified links are offered, and only as unticked options: nothing outside the selection runs by default.
    if(action==='start')for(const d of p.dependsOn)if(d.known&&!d.running&&!selected.has(d.project))related.set(d.project,A.msg('plan.relatedProvider',{project:n}));
    if(action==='stop')for(const u of p.usedBy)if(u.running&&!selected.has(u.project))related.set(u.project,A.msg('plan.relatedDependent',{project:n}));
  }
  const ctx={containers:snapshot.containers,networks:snapshot.networks,selected,keepRunning:readWorkspace().keepRunning},items=[];
  for(const n of names)items.push(await planItem(action,byName.get(n),ctx));
  const wider={...ctx,selected:new Set([...names,...related.keys()])};
  for(const [n,reason] of related)items.push({...await planItem(action,byName.get(n),wider),related:true,reason});
  return {action,items,order:A.executionOrder(action,[...names,...related.keys()],projects)};
}
async function execute(action,p) {
  const {stdout,stderr}=action==='up'||action==='down'
    ?await docker(composeArgs(p,ACTIONS[action]),{cwd:p.directory,timeout:120000})
    :await labelCompose(p.name,ACTIONS[action]);
  return (stdout+'\n'+stderr).slice(-6000);
}
const jobs = new Map();
function publicJob(j) {return {id:j.id,action:j.action,state:j.state,items:j.items,createdAt:j.createdAt,finishedAt:j.finishedAt||null};}
// Projects run one after another so a provider is up before its dependents; cancel skips what has not started.
async function runJob(job) {
  for(const item of job.items){
    if(job.cancel){item.status='cancelled';continue;}
    if(operations.has(item.project)){item.status='failed';item.error=A.msg('error.busy');continue;}
    operations.add(item.project);item.status='running';
    try{
      const {snapshot,projects}=await currentProjects(0),p=projects.find(x=>x.name===item.project);
      const plan=await planItem(job.action,p,{containers:snapshot.containers,networks:snapshot.networks,selected:new Set(job.items.map(i=>i.project)),keepRunning:[]});
      if(plan.errors.length){item.status='failed';item.error=plan.errors;}
      else if(plan.skip){item.status='skipped';item.info=plan.info;}
      else{item.output=(await execute(job.action,p)).trim().slice(-1500);item.status='done';}
    }catch(e){item.status='failed';item.error=e.msg||dockerError(e);}
    finally{operations.delete(item.project);dockerSnapshot.invalidate();}
  }
  job.state=job.cancel?'cancelled':job.items.some(i=>i.status==='failed')?'failed':'done';job.finishedAt=Date.now();
}
function startJob(action,names) {
  for(const [id,j] of jobs)if(j.finishedAt&&Date.now()-j.finishedAt>600000)jobs.delete(id);
  const job={id:crypto.randomUUID(),action,state:'running',cancel:false,createdAt:Date.now(),items:names.map(project=>({project,status:'pending',output:'',error:'',info:''}))};
  jobs.set(job.id,job);
  runJob(job).catch(e=>{job.state='failed';job.error=e.message;job.finishedAt=Date.now();});
  return job;
}
function validBatch(b,actions) {
  if(!b||!actions.includes(b.action))throw appError('error.action',{actions});
  if(!Array.isArray(b.projects)||!b.projects.length||b.projects.length>50||b.projects.some(n=>typeof n!=='string'||!NAME.test(n)))throw appError('error.projects');
  if(['up','down'].includes(b.action)&&b.projects.length!==1)throw appError('error.oneProject',{action:b.action});
  return {action:b.action,projects:[...new Set(b.projects)]};
}
async function readBody(req) {
  let size=0,chunks=[];
  for await (const chunk of req) {size+=chunk.length;if(size>32768)throw appError('error.tooLarge');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw appError('error.invalidJson');}
}
function authorization(req) {
  const host=req.headers.host||'';
  if (!/^((127\.0\.0\.1)|(localhost))(\:\d+)?$/.test(host)) return false;
  if(req.method!=='GET' && req.method!=='HEAD') {
    const origin=req.headers.origin;
    if(origin && ![`http://localhost:${PORT}`,`http://127.0.0.1:${PORT}`].includes(origin))return false;
    if(req.headers['x-dev-manager-token']!==TOKEN)return false;
  }
  return true;
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.png':'image/png','.ico':'image/x-icon'};
const STATIC_FILES=['index.html','app.js','style.css','i18n.js','locales/vi.json','locales/en.json','logo.svg','favicon.svg','favicon.ico','apple-touch-icon.png'];
function staticFile(req,res,urlPath){
  const target=urlPath==='/'?'index.html':urlPath.slice(1);
  if (!STATIC_FILES.includes(target)){res.writeHead(404);res.end();return;}
  const content=fs.readFileSync(path.join(STATIC_DIR,target));
  res.writeHead(200,{'Content-Type':mime[path.extname(target)],'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});
  res.end(content);
}
async function route(req,res){
  if(!authorization(req)){fail(res,403,A.msg('error.forbidden'));return;}
  const url=new URL(req.url,'http://localhost');
  const pathname=url.pathname;
  if (pathname==='/api/session' && req.method==='GET')return respond(res,200,{token:TOKEN});
  if (pathname==='/api/health' && req.method==='GET')return respond(res,200,await dockerInfo());
  if (pathname==='/api/state' && req.method==='GET')return respond(res,200,await stateView());
  if (pathname==='/api/projects' && req.method==='GET')return respond(res,200,{projects:readConfig()});
  if (pathname==='/api/resources' && req.method==='GET'){
    try{return respond(res,200,await resourcesView());}catch(e){return fail(res,503,dockerError(e));}
  }
  if (pathname==='/api/disk' && req.method==='GET'){
    // `system df -v` takes seconds: never polled, and a forced refresh still reuses a result younger than 10s.
    try{return respond(res,200,await diskReport(url.searchParams.get('refresh')==='1'?10000:60000));}catch(e){return fail(res,503,dockerError(e));}
  }
  if (pathname==='/api/ports' && req.method==='GET'){
    const check=[...new Set((url.searchParams.get('check')||'').split(/[\s,]+/).filter(Boolean).map(Number))];
    if(check.length>20||check.some(p=>!Number.isInteger(p)||p<1||p>65535))return fail(res,400,A.msg('error.portsCheck'));
    try{return respond(res,200,await portsView(check));}catch(e){return fail(res,503,dockerError(e));}
  }
  if (pathname==='/api/workspace' && req.method==='GET')return respond(res,200,readWorkspace());
  if (pathname==='/api/workspace' && req.method==='PUT'){
    let w;try{w=validWorkspace(await readBody(req));}catch(e){return fail(res,400,why(e));}
    writeWorkspace(w);return respond(res,200,w);
  }
  if (pathname==='/api/plan' && req.method==='POST'){
    let b;try{b=validBatch(await readBody(req),Object.keys(ACTIONS));}catch(e){return fail(res,400,why(e));}
    try{return respond(res,200,await planFor(b.action,b.projects));}catch(e){return fail(res,503,dockerError(e));}
  }
  if (pathname==='/api/batch' && req.method==='POST'){
    let b;try{b=validBatch(await readBody(req),['start','stop','restart']);}catch(e){return fail(res,400,why(e));}
    if(!(await dockerInfo()).available)return fail(res,503,A.msg('error.dockerOffline'));
    const {projects}=await currentProjects(1000),unknown=b.projects.filter(n=>!projects.some(p=>p.name===n));
    if(unknown.length)return fail(res,404,A.msg('error.projectsNotFound',{projects:unknown}));
    return respond(res,202,{job:publicJob(startJob(b.action,A.executionOrder(b.action,b.projects,projects)))});
  }
  const jobMatch=pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})(\/cancel)?$/);
  if(jobMatch){
    const job=jobs.get(jobMatch[1]);if(!job)return fail(res,404,A.msg('error.jobNotFound'));
    if(jobMatch[2]&&req.method==='POST'){job.cancel=true;return respond(res,200,{job:publicJob(job)});}
    if(!jobMatch[2]&&req.method==='GET')return respond(res,200,{job:publicJob(job)});
  }
  if(pathname==='/api/projects' && req.method==='POST') {
    let p;try{p=validProject(await readBody(req));}catch(e){return fail(res,400,why(e));}
    const ps=readConfig();if(ps.some(x=>x.name===p.name))return fail(res,409,A.msg('error.projectExists'));
    ps.push(p);writeConfig(ps);return respond(res,201,{project:p});
  }
  const match=pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)(?:\/(\w+))?$/);
  if(match){
    const [,name,action]=match;
    const ps=readConfig(),index=ps.findIndex(p=>p.name===name);
    if(!action&&(req.method==='PUT'||req.method==='DELETE')){
      if(index<0)return fail(res,404,A.msg('error.projectNotFound'));
      if(req.method==='PUT'){let edit;try{edit=validProject({...await readBody(req),name});}catch(e){return fail(res,400,why(e));}
        ps[index]=edit;writeConfig(ps);return respond(res,200,{project:edit});}
      ps.splice(index,1);writeConfig(ps);return respond(res,200,{ok:true});
    }
    if(!(await dockerInfo()).available)return fail(res,503,A.msg('error.dockerOffline'));
    const {snapshot,projects}=await currentProjects(1000),p=projects.find(x=>x.name===name);
    if(!p)return fail(res,404,A.msg('error.projectNotFound'));
    if(req.method==='GET'&&action==='logs'){
      const tail=Math.min(500,Math.max(10,Number(url.searchParams.get('tail'))||150)),service=url.searchParams.get('service')||'';
      if(service&&!p.containers.some(c=>c.service===service))return fail(res,400,A.msg('error.unknownService'));
      try{const {stdout,stderr}=await labelCompose(name,['logs','--no-color','--tail',String(tail),'--timestamps',...(service?['--',service]:[])],15000);return respond(res,200,{logs:(stdout+'\n'+stderr).slice(-250000)});}
      catch(e){return fail(res,503,e.msg||dockerError(e));}
    }
    if(req.method==='POST'&&action==='open'){
      if(process.platform!=='darwin')return fail(res,501,A.msg('error.macOnly'));
      let b;try{b=await readBody(req);}catch(e){return fail(res,400,why(e));}
      if(!Object.hasOwn(APPS,b.app))return fail(res,400,A.msg('error.unknownApp'));
      // Only directories Docker or the registry already associate with this project can be opened.
      const known=[p.directory,...p.sources.map(s=>s.directory)].filter(d=>d&&path.isAbsolute(d)),dir=b.directory||known[0];
      if(!dir||!known.includes(dir))return fail(res,400,A.msg('error.directoryUnknown'));
      if(!fs.existsSync(dir)||!fs.statSync(dir).isDirectory())return fail(res,404,A.msg('error.directoryNotFound',{path:dir}));
      try{await exec('open',APPS[b.app]?['-a',APPS[b.app],dir]:[dir],{timeout:10000});return respond(res,200,{ok:true});}
      catch(e){return fail(res,500,dockerError(e));}
    }
    if(req.method==='POST' && ACTIONS[action]){
      if(operations.has(name))return fail(res,409,A.msg('error.busy'));
      if(['up','down'].includes(action)&&!p.managed)return fail(res,400,A.msg('error.needsImport',{action}));
      if(action==='down'){
        const b=await readBody(req).catch(()=>({}));if(b.confirm!==`down ${name}`)return fail(res,400,A.msg('error.confirm',{phrase:`down ${name}`}));
      }
      operations.add(name);
      try {
        if(['start','restart','up'].includes(action)){
          const plan=await planItem(action,p,{containers:snapshot.containers,networks:snapshot.networks,selected:new Set([name]),keepRunning:[]});
          if(plan.errors.length)return fail(res,409,A.msg('error.preflight',{details:plan.errors}));
        }
        return respond(res,200,{ok:true,output:await execute(action,p)});
      }
      catch(e){return fail(res,503,e.msg||dockerError(e));}finally{operations.delete(name);dockerSnapshot.invalidate();}
    }
  }
  if(req.method==='GET' && !pathname.startsWith('/api/'))return staticFile(req,res,pathname);
  return fail(res,404,A.msg('error.notFound'));
}
function startServer(port=PORT){
  const server=http.createServer((req,res)=>{route(req,res).catch(e=>fail(res,500,e.message));});
  server.listen(port,HOST,()=>console.log(`Docker Dev Manager: http://localhost:${server.address().port}\nConfig: ${CONFIG_FILE}`));
  return server;
}
if(require.main===module)startServer();
module.exports={validProject,validWorkspace,validBatch,readConfig,writeConfig,readWorkspace,writeWorkspace,startServer,authorization,discoverFromInspect,mergeManaged,planItem};
