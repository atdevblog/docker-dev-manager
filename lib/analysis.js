'use strict';
// Pure analysis of Docker metadata. No I/O here, so every rule below is unit-testable
// and nothing in this file can start, stop or delete anything.
const L={project:'com.docker.compose.project',service:'com.docker.compose.service',oneoff:'com.docker.compose.oneoff',dir:'com.docker.compose.project.working_dir',files:'com.docker.compose.project.config_files',deps:'com.docker.compose.depends_on'};
const CRASH_RESTARTS=5;
// User-facing text is never built here: every message is a {key, params} descriptor that the UI
// renders in the selected language (public/locales/*.json). Technical values travel as params.
const msg=(key,params={})=>({key,params});
// Exit codes a normal `docker stop` / Docker Desktop quit leaves behind.
const NORMAL_STOP=new Set([0,137,143]);

function validDate(v){return v&&!String(v).startsWith('0001-')?String(v):'';}
function normalizeIp(ip){return !ip||ip==='::'?'0.0.0.0':ip;}
function ipOverlap(a,b){return a==='0.0.0.0'||b==='0.0.0.0'||a===b;}
function portBindings(c){
  // Running containers report the real bindings; stopped ones only keep what they asked for.
  const source=(c.State?.Status==='running'?c.NetworkSettings?.Ports:c.HostConfig?.PortBindings)||{};
  const seen=new Set(),out=[];
  for(const [target,binds] of Object.entries(source))for(const b of binds||[]){
    const port=Number(b.HostPort);if(!Number.isInteger(port)||port<=0)continue;
    const ip=normalizeIp(b.HostIp),proto=target.split('/')[1]||'tcp',key=`${ip}:${port}/${proto}`;
    if(!seen.has(key)){seen.add(key);out.push({ip,port,proto,target});}
  }
  return out;
}
function parseDependsOn(value){return String(value||'').split(',').map(x=>x.split(':')[0].trim()).filter(Boolean);}
function normalizeContainer(c){
  const labels=c.Config?.Labels||{},state=c.State||{},status=state.Status||'unknown';
  return {id:String(c.Id||'').slice(0,12),name:String(c.Name||'').replace(/^\//,''),project:labels[L.project]||'',service:labels[L.service]||'',
    oneoff:labels[L.oneoff]==='True',state:status,exitCode:Number(state.ExitCode)||0,oomKilled:!!state.OOMKilled,error:String(state.Error||''),
    health:status==='running'?(state.Health?.Status||''):'',restartCount:Number(c.RestartCount)||0,restartPolicy:c.HostConfig?.RestartPolicy?.Name||'',
    startedAt:validDate(state.StartedAt),finishedAt:validDate(state.FinishedAt),workingDir:labels[L.dir]||'',
    configFiles:String(labels[L.files]||'').split(',').map(x=>x.trim()).filter(Boolean),dependsOn:parseDependsOn(labels[L.deps]),
    networks:Object.keys(c.NetworkSettings?.Networks||{}),ports:portBindings(c),memLimit:Number(c.HostConfig?.Memory)||0,nanoCpus:Number(c.HostConfig?.NanoCpus)||0,
    binds:(c.Mounts||[]).filter(m=>m.Type==='bind'&&m.Source).map(m=>m.Source),image:c.Config?.Image||''};
}

// Memory in binary units like `docker stats`; disk in SI units like `docker system df`.
function formatBytes(n,si=false){
  if(!Number.isFinite(n)||n<=0)return '0 B';
  const step=si?1000:1024,units=si?['B','kB','MB','GB','TB']:['B','KiB','MiB','GiB','TiB'];let i=0;while(n>=step&&i<units.length-1){n/=step;i++;}
  return `${n>=100||i===0?Math.round(n):n.toFixed(1)} ${units[i]}`;
}
const SIZE_UNITS={b:1,kb:1e3,mb:1e6,gb:1e9,tb:1e12,kib:1024,mib:1024**2,gib:1024**3,tib:1024**4};
function parseSize(value){
  const m=String(value||'').trim().match(/^([\d.]+)\s*([a-zA-Z]*)/);
  if(!m)return 0;const unit=SIZE_UNITS[(m[2]||'b').toLowerCase()];return unit?Math.round(parseFloat(m[1])*unit):0;
}
function parsePercent(value){const n=parseFloat(String(value||'').replace('%',''));return Number.isFinite(n)?n:0;}
// Docker CLI dates look like "2025-12-31 15:32:02.664887219 +0000 UTC".
function parseDockerDate(value){
  const m=String(value||'').match(/^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)(\.\d+)?\s*([+-]\d\d):?(\d\d)/);
  return m?Date.parse(`${m[1]}T${m[2]}${(m[3]||'').slice(0,4)}${m[4]}:${m[5]}`):NaN;
}
function parseLabelString(value){
  const out={};for(const part of String(value||'').split(',')){if(!part)continue;const i=part.indexOf('=');out[i<0?part:part.slice(0,i)]=i<0?'':part.slice(i+1);}return out;
}

const EXIT_KEYS={0:'exit.c0',1:'exit.c1',2:'exit.c2',126:'exit.c126',127:'exit.c127',130:'exit.c130',137:'exit.c137',143:'exit.c143',255:'exit.c255'};
function exitHint(code,policy,siblingsRunning){
  const hint=[EXIT_KEYS[code]?msg(EXIT_KEYS[code]):code>128?msg('exit.signal',{signal:code-128}):msg('exit.generic')];
  if(siblingsRunning&&policy==='no')hint.push(msg('exit.policyNo'));
  return hint;
}
const LEVEL={error:0,warn:1,info:2};
function projectIssues(core){
  const issues=[],anyRunning=core.some(c=>c.state==='running');
  const stopped=core.filter(c=>c.state!=='running').map(c=>c.service||c.name);
  const stoppedText=stopped.length?msg('issue.stoppedHint',{services:stopped.length>5?[...stopped.slice(0,5),msg('common.more',{count:stopped.length-5})]:stopped}):msg('issue.keepsExiting');
  for(const c of core){
    const service=c.service||c.name,base={service,container:c.name};
    if(c.state==='restarting')issues.push({...base,level:'error',kind:'crashloop',text:msg('issue.restarting',{service,code:c.exitCode}),hint:stoppedText});
    else if(c.state==='running'&&c.restartCount>=CRASH_RESTARTS)issues.push({...base,level:'error',kind:'crashloop',text:msg('issue.restarted',{service,count:c.restartCount}),hint:stoppedText});
    if(c.state==='dead')issues.push({...base,level:'error',kind:'dead',text:msg('issue.dead',{service}),hint:msg('issue.deadHint')});
    if(c.health==='unhealthy')issues.push({...base,level:'warn',kind:'unhealthy',text:msg('issue.unhealthy',{service}),hint:msg('issue.unhealthyHint')});
    const live=c.state==='running'||c.state==='restarting';
    if(c.oomKilled)issues.push({...base,level:live?'error':'warn',kind:'oom',text:msg(live?'issue.oomLive':'issue.oomPast',{service}),
      hint:c.memLimit?msg('issue.oomLimit',{limit:formatBytes(c.memLimit)}):msg('issue.oomNoLimit')});
    if(c.state!=='exited')continue;
    // Docker records why it could not start a container (port taken, mount missing…).
    if(c.error)issues.push({...base,level:'error',kind:'startfailed',text:msg('issue.startFailed',{service}),hint:c.error});
    // With these policies Docker restarts a container by itself, so an exited one was stopped on purpose.
    else if(['always','unless-stopped'].includes(c.restartPolicy))continue;
    else if(c.exitCode!==0&&(anyRunning||!NORMAL_STOP.has(c.exitCode))&&!c.oomKilled)
      issues.push({...base,level:'warn',kind:'exited',text:msg('issue.exited',{service,code:c.exitCode}),hint:exitHint(c.exitCode,c.restartPolicy,anyRunning),finishedAt:c.finishedAt});
  }
  return issues.sort((a,b)=>LEVEL[a.level]-LEVEL[b.level]);
}
function earliest(dates){return dates.filter(Boolean).sort()[0]||'';}
// Groups containers by Compose project label. Containers without the label are standalone, never a project.
function summarizeProjects(containers){
  const groups=new Map();
  for(const c of containers){if(!c.project)continue;if(!groups.has(c.project))groups.set(c.project,[]);groups.get(c.project).push(c);}
  return [...groups].map(([name,all])=>{
    // One-off `compose run` containers are excluded from counts, like `docker compose ps`.
    const core=all.filter(c=>!c.oneoff),running=core.filter(c=>c.state==='running').length;
    const sources=new Map();
    for(const c of core){const key=c.workingDir+'\n'+c.configFiles.join(',');if(!sources.has(key))sources.set(key,{directory:c.workingDir,files:c.configFiles,containers:0});sources.get(key).containers++;}
    return {name,containers:all,running,total:core.length,oneoffs:all.length-core.length,
      status:!core.length||!running?'stopped':running===core.length?'running':'partial',
      sources:[...sources.values()].sort((a,b)=>b.containers-a.containers),issues:projectIssues(core),
      startedAt:earliest(core.filter(c=>c.state==='running').map(c=>c.startedAt))};
  }).sort((a,b)=>a.name.localeCompare(b.name));
}
// A project depends on another when its containers join a network the other project created
// (an `external` network in Compose). This is verifiable metadata, not a guess from names.
function linkProjects(projects,networks){
  const byName=new Map(projects.map(p=>[p.name,p]));
  for(const p of projects){p.dependsOn=[];p.usedBy=[];p.missingNetworks=[];}
  for(const p of projects){
    const deps=new Map(),missing=new Set();
    for(const c of p.containers.filter(c=>!c.oneoff))for(const n of c.networks){
      if(!networks.has(n)){if(!['bridge','host','none'].includes(n))missing.add(n);continue;}
      const owner=networks.get(n);if(!owner||owner===p.name)continue;
      if(!deps.has(owner))deps.set(owner,{project:owner,networks:new Set(),services:new Set()});
      const d=deps.get(owner);d.networks.add(n);if(c.state==='running')d.services.add(c.service||c.name);
    }
    p.missingNetworks=[...missing];
    p.dependsOn=[...deps.values()].map(d=>({project:d.project,networks:[...d.networks],known:byName.has(d.project),running:(byName.get(d.project)?.running||0)>0}));
  }
  for(const p of projects)for(const d of p.dependsOn){
    const owner=byName.get(d.project);
    if(owner)owner.usedBy.push({project:p.name,networks:d.networks,running:p.running>0});
  }
  return projects;
}
// Groups come from Docker only: a project that joins other projects' networks forms a group with
// every project it needs (transitively), providers first. Unknown providers cannot be started, so
// they are left out; projects that need nothing get no group.
function autoGroups(projects){
  const byName=new Map(projects.map(p=>[p.name,p])),seen=new Set(),groups=[];
  for(const p of projects){
    if(!(p.dependsOn||[]).some(d=>d.known))continue;
    const members=[],visited=new Set();
    const visit=name=>{if(visited.has(name))return;visited.add(name);for(const d of byName.get(name)?.dependsOn||[])if(d.known)visit(d.project);members.push(name);};
    visit(p.name);
    const key=[...members].sort().join('\n');if(seen.has(key))continue;seen.add(key);
    groups.push({name:p.name,projects:members});
  }
  return groups.sort((a,b)=>a.name.localeCompare(b.name));
}
function portConflicts(targets,all,ownProject){
  const busy=all.filter(c=>c.state==='running'&&!(ownProject&&c.project===ownProject));
  const out=[],seen=new Set();
  for(const t of targets)for(const b of t.ports||[])for(const r of busy)for(const rb of r.ports){
    if(rb.port!==b.port||rb.proto!==b.proto||!ipOverlap(rb.ip,b.ip))continue;
    const key=`${b.port}/${b.proto}:${r.name}`;if(seen.has(key))continue;seen.add(key);
    out.push({port:b.port,ip:b.ip,proto:b.proto,service:t.service||t.name,by:r.name,byProject:r.project});
  }
  return out;
}
// Start providers before the projects that join their networks; stop in reverse.
function executionOrder(action,names,projects){
  const byName=new Map(projects.map(p=>[p.name,p])),selected=new Set(names),depth=new Map();
  const visit=(name,trail=new Set())=>{
    if(depth.has(name))return depth.get(name);if(trail.has(name))return 0;trail.add(name);
    const deps=(byName.get(name)?.dependsOn||[]).map(d=>d.project).filter(d=>selected.has(d));
    const value=deps.length?1+Math.max(...deps.map(d=>visit(d,trail))):0;depth.set(name,value);return value;
  };
  const sorted=[...selected].sort((a,b)=>visit(a)-visit(b)||a.localeCompare(b));
  return action==='stop'?sorted.reverse():sorted;
}

// Stats are point-in-time; nothing here declares a container "idle" from low CPU.
function resourceView(projects,stats,keepRunning=[]){
  const owner=new Map();for(const p of projects)for(const c of p.containers)owner.set(c.id,{project:p.name,service:c.service});
  const containers=stats.map(s=>({...s,...(owner.get(String(s.id).slice(0,12))||{project:'',service:''})}));
  const per=new Map();
  for(const s of containers){if(!s.project)continue;const a=per.get(s.project)||{memBytes:0,cpuPercent:0};a.memBytes+=s.memBytes;a.cpuPercent+=s.cpuPercent;per.set(s.project,a);}
  const rows=projects.filter(p=>p.running>0).map(p=>{
    const a=per.get(p.name)||{memBytes:0,cpuPercent:0},keep=keepRunning.includes(p.name);
    const usedBy=(p.usedBy||[]).filter(u=>u.running).map(u=>u.project),crash=p.issues.find(i=>i.kind==='crashloop'),notes=[];
    if(crash)notes.push(crash.text);
    if(usedBy.length)notes.push(msg('resources.note.usedBy',{projects:usedBy,count:usedBy.length}));
    if(keep)notes.push(msg('resources.note.keep'));
    return {name:p.name,memBytes:a.memBytes,cpuPercent:Math.round(a.cpuPercent*100)/100,running:p.running,total:p.total,since:p.startedAt,keepRunning:keep,usedBy,crashLoop:!!crash,notes};
  }).sort((a,b)=>Number(b.crashLoop)-Number(a.crashLoop)||Number(a.keepRunning)-Number(b.keepRunning)||b.memBytes-a.memBytes);
  const totals=containers.reduce((t,s)=>({memBytes:t.memBytes+s.memBytes,cpuPercent:t.cpuPercent+s.cpuPercent}),{memBytes:0,cpuPercent:0});
  return {containers,projects:rows,totals:{memBytes:totals.memBytes,cpuPercent:Math.round(totals.cpuPercent*100)/100}};
}

// Figures match `docker system df`: reclaimable cache = unused and unshared records,
// reclaimable images = unique size of images no container uses, volumes = no container links.
function diskReport(df,liveProjects=new Set(),now=Date.now()){
  const images=df.Images||[],cache=df.BuildCache||[],containers=df.Containers||[];
  const unusedImages=images.filter(i=>Number(i.Containers)===0),dangling=unusedImages.filter(i=>i.Repository==='<none>');
  const sum=(list,field)=>list.reduce((n,x)=>n+parseSize(x[field]),0);
  const freeCache=cache.filter(b=>String(b.InUse)!=='true'&&String(b.Shared)!=='true');
  const monthOld=freeCache.filter(b=>{const t=parseDockerDate(b.LastUsedAt||b.CreatedAt);return Number.isFinite(t)&&now-t>30*864e5;});
  const volumes=(df.Volumes||[]).map(v=>{const labels=parseLabelString(v.Labels);
    return {name:v.Name,size:parseSize(v.Size),links:Number(v.Links)||0,project:labels[L.project]||'',volume:labels['com.docker.compose.volume']||'',anonymous:'com.docker.volume.anonymous' in labels};});
  const unusedVolumes=volumes.filter(v=>v.links===0).map(v=>({...v,projectHasContainers:!!v.project&&liveProjects.has(v.project)})).sort((a,b)=>b.size-a.size);
  const stopped=containers.filter(c=>['exited','created','dead'].includes(String(c.State||'')));
  return {rows:[
    {key:'buildCache',label:msg('disk.row.buildCache'),count:freeCache.length,size:sum(cache,'Size'),reclaimable:sum(freeCache,'Size'),risk:'safe',
      note:msg('disk.note.buildCache'),
      commands:[{label:msg('disk.cmd.monthOld',{size:formatBytes(sum(monthOld,'Size'),true)}),command:'docker builder prune --all --filter until=720h'},{label:msg('disk.cmd.allCache'),command:'docker builder prune --all'}]},
    {key:'dangling',label:msg('disk.row.dangling'),count:dangling.length,size:sum(dangling,'UniqueSize'),reclaimable:sum(dangling,'UniqueSize'),risk:'safe',
      note:msg('disk.note.dangling'),commands:[{label:msg('disk.cmd.dangling'),command:'docker image prune'}]},
    {key:'unusedImages',label:msg('disk.row.unusedImages'),count:unusedImages.length-dangling.length,size:sum(unusedImages,'UniqueSize')-sum(dangling,'UniqueSize'),reclaimable:sum(unusedImages,'UniqueSize')-sum(dangling,'UniqueSize'),risk:'review',
      note:msg('disk.note.unusedImages'),commands:[]},
    {key:'stoppedContainers',label:msg('disk.row.stoppedContainers'),count:stopped.length,size:sum(stopped,'Size'),reclaimable:sum(stopped,'Size'),risk:'review',
      note:msg('disk.note.stoppedContainers'),commands:[]},
    {key:'unusedVolumes',label:msg('disk.row.unusedVolumes'),count:unusedVolumes.length,size:unusedVolumes.reduce((n,v)=>n+v.size,0),reclaimable:0,risk:'data',
      note:msg('disk.note.unusedVolumes'),commands:[]}],
    unusedVolumes:unusedVolumes.slice(0,25)};
}

// Host overview. macOS: Activity Monitor's "Memory Used" = app (anonymous − purgeable) + wired + compressed;
// os.freemem() only counts completely free pages and looks alarming on a healthy Mac.
function parseVmStat(text){
  const page=Number((String(text).match(/page size of (\d+) bytes/)||[])[1])||4096;
  const n=label=>Number((String(text).match(new RegExp(label+':\\s+(\\d+)'))||[])[1])||0;
  const app=Math.max(0,n('Anonymous pages')-n('Pages purgeable')),wired=n('Pages wired down'),compressed=n('Pages occupied by compressor');
  return {used:(app+wired+compressed)*page,cached:(n('File-backed pages')+n('Pages purgeable'))*page};
}
// `sysctl vm.swapusage`: "total = 19456.00M  used = 18413.00M  free = 1043.00M  (encrypted)"
function parseSwap(text){
  const v=k=>{const m=String(text).match(new RegExp(k+' = ([\\d.]+)([KMGT])'));return m?Math.round(parseFloat(m[1])*{K:1024,M:1024**2,G:1024**3,T:1024**4}[m[2]]):0;};
  return {total:v('total'),used:v('used')};
}
function parseMeminfo(text){
  const kb=k=>Number((String(text).match(new RegExp('^'+k+':\\s+(\\d+)','m'))||[])[1])*1024||0;
  return {total:kb('MemTotal'),used:kb('MemTotal')-kb('MemAvailable'),cached:kb('Cached'),swap:{total:kb('SwapTotal'),used:kb('SwapTotal')-kb('SwapFree')}};
}
const PRESSURE={1:'normal',2:'warning',4:'critical'};
// Busy share of all cores between two os.cpus() snapshots.
function cpuPercent(prev,next){
  let idle=0,total=0;
  next.forEach((c,i)=>{const p=prev?.[i]?.times;if(!p)return;const d=k=>c.times[k]-p[k];idle+=d('idle');total+=d('user')+d('nice')+d('sys')+d('idle')+d('irq');});
  return total>0?Math.round((1-idle/total)*1000)/10:null;
}

// `lsof -nP -iTCP -sTCP:LISTEN +c 0 -F pcn`: p<pid>, c<command>, n<addr:port> records.
function parseLsof(text){
  const out=[],seen=new Set();let pid=0,command='';
  for(const line of String(text).split('\n')){
    const tag=line[0],value=line.slice(1);
    if(tag==='p'){pid=Number(value);command='';}
    else if(tag==='c')command=value.replace(/\\x([0-9a-f]{2})/gi,(_,h)=>String.fromCharCode(parseInt(h,16)));
    else if(tag==='n'){
      const m=value.match(/^(.*):(\d+)$/);if(!m)continue;
      const raw=m[1].replace(/^\[|\]$/g,''),ip=raw==='*'?'0.0.0.0':normalizeIp(raw),port=Number(m[2]),key=`${pid}|${ip}|${port}`;
      if(!seen.has(key)){seen.add(key);out.push({pid,command,ip,port});}
    }
  }
  return out;
}
// Ports above this are handed out at random by macOS (ephemeral range): never pick them for a project.
const EPHEMERAL_START=49152;
// Every host TCP/UDP port someone holds now (running container, other process) or will need again
// (a stopped container keeps its binding and fails to start if the port is taken meanwhile).
function portInventory(containers,listeners,selfPid){
  const entries=[];
  for(const c of containers)for(const b of c.ports)entries.push({port:b.port,proto:b.proto,ip:b.ip,kind:'container',running:c.state==='running',project:c.project,service:c.service,container:c.name,target:b.target});
  // Docker Desktop's own forwarders mirror the container ports listed above.
  for(const l of listeners)if(!/^com\.docker/.test(l.command))entries.push({port:l.port,proto:'tcp',ip:l.ip,kind:'process',running:true,process:l.command,pid:l.pid,self:l.pid===selfPid});
  for(const e of entries){
    const others=entries.filter(o=>o!==e&&o.port===e.port&&o.proto===e.proto&&ipOverlap(o.ip,e.ip));
    const holder=others.find(o=>o.running);
    const holderMsg=h=>h.kind!=='container'?msg('ports.holder.process',{process:h.process}):h.project?msg('ports.holder.containerIn',{container:h.container,project:h.project}):msg('ports.holder.container',{container:h.container});
    if(!e.running&&holder)e.note=msg('ports.note.cannotStart',{holder:holderMsg(holder)});
    else if(!e.running&&others.some(o=>!o.running))e.note=msg('ports.note.alsoReserved',{containers:others.filter(o=>!o.running).map(o=>o.container)});
    else if(e.self)e.note=msg('ports.note.dashboard');
  }
  return entries.sort((a,b)=>a.port-b.port||Number(b.running)-Number(a.running)||String(a.project||a.process).localeCompare(String(b.project||b.process)));
}
function nextFreePorts(desired,entries,count=3){
  const taken=new Set(entries.map(e=>e.port)),out=[];
  for(let p=desired;p<EPHEMERAL_START&&out.length<count;p++)if(!taken.has(p))out.push(p);
  return out;
}

function shellQuote(value){return /^[A-Za-z0-9_\/.,:=@%+-]+$/.test(value)?value:`'${String(value).replace(/'/g,`'\\''`)}'`;}
// Commands a developer can paste into a terminal to do by hand what the dashboard does.
function cliCommands(p){
  const out=[],add=(label,command)=>out.push({label,command});
  // Label mode must run where no compose file can be picked up from the current directory.
  const labels=`cd /tmp && docker compose -p ${p.name}`;
  if(p.managed&&p.directory&&p.composeFile){
    const file=`cd ${shellQuote(p.directory)} && docker compose -p ${p.name} -f ${shellQuote(p.composeFile)}`;
    add(msg('cli.status'),`${file} ps -a`);add(msg('cli.followLogs'),`${file} logs -f --tail 200`);add(msg('cli.start'),`${labels} start`);add(msg('cli.stop'),`${labels} stop`);add(msg('cli.up'),`${file} up -d`);add(msg('cli.down'),`${file} down`);
  }else{
    add(msg('cli.status'),`${labels} ps -a`);add(msg('cli.followLogs'),`${labels} logs -f --tail 200`);add(msg('cli.start'),`${labels} start`);add(msg('cli.stop'),`${labels} stop`);add(msg('cli.restart'),`${labels} restart`);
    const s=p.sources||[];
    if(s.length===1&&s[0].directory&&s[0].files.length)add(msg('cli.upAsDeployed'),`cd ${shellQuote(s[0].directory)} && docker compose -p ${p.name} ${s[0].files.map(f=>'-f '+shellQuote(f)).join(' ')} up -d`);
  }
  return out;
}

module.exports={msg,normalizeContainer,summarizeProjects,linkProjects,autoGroups,portConflicts,executionOrder,resourceView,diskReport,cliCommands,shellQuote,
  parseLsof,portInventory,nextFreePorts,EPHEMERAL_START,parseVmStat,parseSwap,parseMeminfo,cpuPercent,PRESSURE,projectIssues,exitHint,parseSize,parsePercent,parseDockerDate,parseLabelString,formatBytes,normalizeIp,ipOverlap,CRASH_RESTARTS};
