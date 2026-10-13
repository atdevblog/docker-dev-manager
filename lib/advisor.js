'use strict';
// Health & Resource Advisor. From Docker metadata, live stats, ports and disk usage it answers:
//   1. what is wrong now: a health score made only of explained deductions,
//   2. where resources are wasted,
//   3. what to do now: ranked actions with estimated gain and risk.
// Pure functions: nothing here starts, stops or deletes anything.
const {msg}=require('./analysis');

// Every deduction is one of these rules, shown with its cause and fix. A cap keeps one kind of
// problem from hiding all the others.
const RULES={
  engine:{points:100},crashloop:{points:15,cap:45},oomLive:{points:12,cap:36},unhealthy:{points:10,cap:30},
  startFailed:{points:10,cap:30},memoryNearLimit:{points:8,cap:24},portConflict:{points:6,cap:18},missingNetwork:{points:6,cap:18},
  partialDown:{points:5,cap:15},oomPast:{points:4,cap:12},hostPressureCritical:{points:20},hostPressureWarning:{points:8},vmMemoryHigh:{points:10},
};
const NEAR_LIMIT=.9,VM_HIGH=.9,VM_TIGHT=.8,IDLE_NET_BYTES=256*1024,IDLE_CPU=1,DISK_MIN=500e6;
const PRESSURE_KEYS={normal:'pressure.normal',warning:'pressure.warning',critical:'pressure.critical'};
// Action tiers, most serious first: 1 urgent (broken now), 2 important (degraded or memory pressure),
// 3 recommended (saves resources, past problems), 4 optional (disk housekeeping).
const PRESSURE_RULES=new Set(['hostPressureWarning','hostPressureCritical','vmMemoryHigh']);
const tierOf=f=>f.level==='error'?1:f.rule==='oomPast'?3:2;
const ISSUE_RULES={crashloop:['crashloop','advisor.f.crashloop','logs'],unhealthy:['unhealthy','advisor.f.unhealthy','logs'],startfailed:['startFailed','advisor.f.startFailed','details'],dead:['startFailed','advisor.f.startFailed','details']};

function healthScore({docker,projects=[],containers=[],vm={},host=null,portEntries=[]}){
  const findings=[],used={};
  const add=(rule,finding)=>{
    const r=RULES[rule],before=used[rule]||0,points=r.cap?Math.max(0,Math.min(r.points,r.cap-before)):r.points;
    used[rule]=before+points;findings.push({rule,points,...finding});
  };
  if(!docker?.available){
    add('engine',{level:'error',text:msg('advisor.p.engine'),fix:msg('advisor.f.engine'),detail:docker?.error||'',action:{type:'refresh'}});
    return summarize(findings);
  }
  for(const p of projects)for(const i of p.issues||[]){
    const base={level:i.level,project:p.name,service:i.service,text:i.text,detail:i.hint};
    if(ISSUE_RULES[i.kind]){const [rule,fix,type]=ISSUE_RULES[i.kind];add(rule,{...base,fix:msg(fix),action:type==='logs'?{type,project:p.name,service:i.service}:{type,project:p.name}});}
    else if(i.kind==='oom')add(i.level==='error'?'oomLive':'oomPast',{...base,fix:msg('advisor.f.oom'),action:{type:'details',project:p.name}});
    // An exited service only hurts while the rest of its project runs without it.
    else if(i.kind==='exited'&&p.running>0)add('partialDown',{...base,fix:msg('advisor.f.partialDown'),action:{type:'start',projects:[p.name]}});
  }
  for(const p of projects)for(const network of p.missingNetworks||[])
    add('missingNetwork',{level:'warn',project:p.name,text:msg('advisor.p.missingNetwork',{project:p.name,network}),fix:msg('advisor.f.missingNetwork'),action:{type:'details',project:p.name}});
  const seen=new Set();
  for(const e of portEntries){
    if(e.kind!=='container'||e.running||e.note?.key!=='ports.note.cannotStart'||seen.has(e.container+e.port))continue;seen.add(e.container+e.port);
    add('portConflict',{level:'warn',project:e.project,service:e.service,text:msg('advisor.p.portConflict',{port:String(e.port),service:e.service||e.container,project:e.project||e.container}),detail:e.note,fix:msg('advisor.f.portConflict'),action:{type:'ports'}});
  }
  const limits=new Map();for(const p of projects)for(const c of p.containers||[])if(c.memLimit)limits.set(c.id,{limit:c.memLimit,project:p.name,service:c.service||c.name});
  for(const s of containers){
    const l=limits.get(String(s.id).slice(0,12));if(!l||s.memBytes/l.limit<NEAR_LIMIT)continue;
    add('memoryNearLimit',{level:'warn',project:l.project,service:l.service,text:msg('advisor.p.memoryNearLimit',{service:l.service,project:l.project,pct:Math.round(s.memBytes/l.limit*100),limit:fmt(l.limit)}),fix:msg('advisor.f.memoryNearLimit'),action:{type:'details',project:l.project}});
  }
  const pressure=host?.memory?.pressure;
  if(pressure==='warning'||pressure==='critical')
    add(pressure==='critical'?'hostPressureCritical':'hostPressureWarning',{level:pressure==='critical'?'error':'warn',text:msg('advisor.p.hostPressure',{level:msg(PRESSURE_KEYS[pressure])}),fix:msg('advisor.f.hostPressure'),action:{type:'memory'}});
  const used_=containers.reduce((n,s)=>n+s.memBytes,0);
  if(vm.memTotal&&used_/vm.memTotal>=VM_HIGH)add('vmMemoryHigh',{level:'warn',text:msg('advisor.p.vmMemory',{used:fmt(used_),total:fmt(vm.memTotal),pct:Math.round(used_/vm.memTotal*100)}),fix:msg('advisor.f.vmMemory'),action:{type:'memory'}});
  return summarize(findings);
}
function summarize(findings){
  const score=Math.max(0,100-findings.reduce((n,f)=>n+f.points,0));
  findings.sort((a,b)=>b.points-a.points||(a.level==='error'?-1:1));
  return {score,grade:score>=90?'good':score>=70?'fair':'poor',findings,rules:RULES};
}
function fmt(bytes){const u=['B','KiB','MiB','GiB','TiB'];let i=0;while(bytes>=1024&&i<u.length-1){bytes/=1024;i++;}return `${bytes>=100||!i?Math.round(bytes):bytes.toFixed(1)} ${u[i]}`;}

// Idle = over at least `idleMinutes` of observation, the project's running containers moved less than
// IDLE_NET_BYTES of network traffic and averaged under IDLE_CPU % CPU. Low CPU alone is never enough.
// `history` maps a container id to stats samples {t, net, cpu} collected while the dashboard is open.
function projectActivity(projects,history,now,idleMinutes){
  const window=idleMinutes*60000,out=new Map();
  for(const p of projects){
    const running=(p.containers||[]).filter(c=>c.state==='running'&&!c.oneoff);if(!running.length)continue;
    let observed=Infinity,net=0,cpu=0,full=true,restarted=false;
    for(const c of running){
      const h=history.get(c.id)||[];
      observed=Math.min(observed,h.length?(now-h[0].t)/60000:0);
      const base=[...h].reverse().find(x=>x.t<=now-window),recent=h.filter(x=>x.t>now-window),last=h[h.length-1];
      if(!base||!recent.length){full=false;continue;}
      if(last.net<base.net)restarted=true;else net+=last.net-base.net;
      cpu+=recent.reduce((n,x)=>n+x.cpu,0)/recent.length;
    }
    out.set(p.name,{known:full,idle:full&&!restarted&&net<IDLE_NET_BYTES&&cpu<IDLE_CPU,observedMinutes:Number.isFinite(observed)?Math.round(observed):0,netBytes:net,cpuPercent:Math.round(cpu*100)/100});
  }
  return out;
}

function advise({docker,projects=[],containers=[],vm={},host=null,keepRunning=[],portEntries=[],disk=null,activity=new Map(),idleMinutes=15}){
  const health=healthScore({docker,projects,containers,vm,host,portEntries});
  const fromFinding=f=>({kind:f.rule,tier:tierOf(f),weight:f.points,title:f.text,why:[f.fix,f.detail].filter(Boolean),risk:'none',action:f.action});
  if(!docker?.available)return {health,waste:[],actions:health.findings.map(fromFinding),keep:[],observing:null,totals:{memBytes:0,diskBytes:0}};
  const byName=new Map(projects.map(p=>[p.name,p]));
  const mem=new Map();for(const s of containers)if(s.project)mem.set(s.project,(mem.get(s.project)||0)+s.memBytes);
  const memOf=list=>list.reduce((n,x)=>n+(mem.get(x)||0),0);
  const kept=n=>keepRunning.includes(n),idle=n=>activity.get(n)?.idle===true;
  const users=n=>(byName.get(n)?.usedBy||[]).filter(u=>u.running).map(u=>u.project);
  const running=projects.filter(p=>p.running>0);
  // Adds providers that serve only the given set and may be stopped with it.
  const withProviders=(names,allowProvider)=>{
    const set=new Set(names);
    for(let grew=true;grew;){grew=false;for(const n of [...set])for(const d of byName.get(n)?.dependsOn||[])
      if(d.known&&d.running&&!set.has(d.project)&&!kept(d.project)&&allowProvider(d.project)&&users(d.project).every(u=>set.has(u))){set.add(d.project);grew=true;}}
    return [...set];
  };

  const actions=[],waste=[];
  // 1. Fix what is broken. A crash loop next to stopped services usually waits for them, so starting them comes first.
  const startedFor=new Set();
  for(const f of health.findings){
    if(f.rule==='crashloop'){
      const p=byName.get(f.project),stopped=(p?.containers||[]).filter(c=>!c.oneoff&&c.state!=='running').map(c=>c.service||c.name);
      if(stopped.length&&!startedFor.has(f.project)){
        startedFor.add(f.project);
        actions.push({kind:'startStopped',tier:1,weight:100,title:msg('advisor.r.startStopped',{project:f.project,services:stopped}),why:[msg('advisor.why.crashStopped',{service:f.service,services:stopped})],risk:'low',action:{type:'start',projects:[f.project]},secondary:f.action});
      }
      const cpu=containers.filter(s=>s.project===f.project&&s.service===f.service).reduce((n,s)=>n+s.cpuPercent,0);
      waste.push({kind:'churn',text:msg('advisor.w.churn',{service:f.service,project:f.project}),cpuPercent:Math.round(cpu*10)/10,risk:'none'});
    }
    // Already covered by the start action above (which also carries the log button).
    if((f.rule==='partialDown'||f.rule==='crashloop')&&startedFor.has(f.project))continue;
    actions.push(fromFinding(f));
  }
  // 2. Free memory: idle projects (and providers used only by them), then the largest projects under memory pressure.
  const idleApps=running.map(p=>p.name).filter(n=>idle(n)&&!kept(n)&&users(n).every(idle));
  const idleSet=withProviders(idleApps,idle);
  for(const n of idleSet)waste.push({kind:'idle',text:msg('advisor.w.idle',{project:n,minutes:activity.get(n).observedMinutes}),memBytes:mem.get(n)||0,risk:'low'});
  const pressure=host?.memory?.pressure,vmShare=vm.memTotal?containers.reduce((n,s)=>n+s.memBytes,0)/vm.memTotal:0;
  const tight=pressure==='warning'||pressure==='critical'||vmShare>=VM_TIGHT;
  if(idleSet.length)actions.push({kind:'stopIdle',tier:tight?2:3,weight:memOf(idleSet)/2**20,title:idleSet.length>1?msg('advisor.r.stopIdleMany',{count:idleSet.length,projects:idleSet}):msg('advisor.r.stopIdleOne',{project:idleSet[0]}),
    why:idleSet.map(n=>msg('advisor.why.idle',{project:n,minutes:activity.get(n).observedMinutes})),impact:{memBytes:memOf(idleSet)},risk:'low',riskText:msg('advisor.risk.kept'),action:{type:'stop',projects:idleSet}});
  if(tight){
    const why=pressure==='warning'||pressure==='critical'?msg('advisor.why.pressure',{level:msg(PRESSURE_KEYS[pressure])}):msg('advisor.why.vm',{pct:Math.round(vmShare*100)});
    running.map(p=>p.name).filter(n=>!idleSet.includes(n)&&!kept(n)&&!users(n).length)
      .map(n=>({n,set:withProviders([n],idle)})).sort((a,b)=>memOf(b.set)-memOf(a.set)).slice(0,2).filter(x=>memOf(x.set)>0)
      .forEach(({n,set})=>actions.push({kind:'stopForMemory',tier:pressure==='critical'?1:2,weight:memOf(set)/2**20,title:set.length>1?msg('advisor.r.stopGroup',{project:n,others:set.filter(x=>x!==n)}):msg('advisor.r.stopForMemory',{project:n}),
        why:[why],impact:{memBytes:memOf(set)},risk:'review',riskText:activity.get(n)?.known?msg('advisor.risk.active'):msg('advisor.risk.unknownActivity'),action:{type:'stop',projects:set}}));
  }
  // 3. Disk. Only safe categories get a command; volumes are listed, never deleted.
  if(disk){
    const row=k=>disk.rows.find(r=>r.key===k)||{};
    const cache=row('buildCache'),dangling=row('dangling'),images=row('unusedImages'),volumes=row('unusedVolumes'),stopped=row('stoppedContainers');
    if(cache.oldReclaimable>=DISK_MIN)actions.push({kind:'pruneCacheOld',tier:4,weight:3,title:msg('advisor.r.pruneCacheOld'),why:[msg('advisor.why.cache')],impact:{diskBytes:cache.oldReclaimable},risk:'none',action:{type:'copy',command:'docker builder prune --all --filter until=720h'}});
    else if(cache.reclaimable>=DISK_MIN)actions.push({kind:'pruneCacheAll',tier:4,weight:3,title:msg('advisor.r.pruneCacheAll'),why:[msg('advisor.why.cache')],impact:{diskBytes:cache.reclaimable},risk:'low',action:{type:'copy',command:'docker builder prune --all'}});
    if(dangling.reclaimable>=DISK_MIN/5)actions.push({kind:'pruneDangling',tier:4,weight:3,title:msg('advisor.r.pruneDangling'),why:[msg('advisor.why.dangling')],impact:{diskBytes:dangling.reclaimable},risk:'none',action:{type:'copy',command:'docker image prune'}});
    if(images.reclaimable>=2*DISK_MIN)actions.push({kind:'reviewImages',tier:4,weight:2,title:msg('advisor.r.reviewImages',{count:images.count}),why:[msg('advisor.why.images')],impact:{diskBytes:images.reclaimable},risk:'review',action:{type:'disk'}});
    if(volumes.count&&volumes.size>=DISK_MIN)actions.push({kind:'reviewVolumes',tier:4,weight:1,title:msg('advisor.r.reviewVolumes',{count:volumes.count}),why:[msg('advisor.why.volumes')],impact:{diskBytes:volumes.size},risk:'data',action:{type:'disk'}});
    for(const r of [cache,dangling,images,stopped,volumes]){
      const bytes=r.key==='unusedVolumes'?r.size:r.reclaimable;
      if(r.key&&bytes>=DISK_MIN/5)waste.push({kind:'disk',text:r.label,diskBytes:bytes,risk:r.risk});
    }
  }
  // A memory-pressure finding only says "free memory"; when concrete stop suggestions exist they replace it.
  const relief=actions.some(a=>a.kind==='stopForMemory'||(a.kind==='stopIdle'&&tight));
  const ranked=actions.filter(a=>!(relief&&PRESSURE_RULES.has(a.kind)));
  const size=a=>(a.impact?.memBytes||0)+(a.impact?.diskBytes||0);
  ranked.sort((a,b)=>a.tier-b.tier||b.weight-a.weight||size(b)-size(a));
  // Waste: memory first (largest first), then CPU churn, then disk from safest to riskiest, largest first.
  const RISK_ORDER={safe:0,none:0,low:1,review:2,data:3},KIND_ORDER={idle:0,churn:1,disk:2};
  waste.sort((a,b)=>KIND_ORDER[a.kind]-KIND_ORDER[b.kind]||(b.memBytes||0)-(a.memBytes||0)||(RISK_ORDER[a.risk]??9)-(RISK_ORDER[b.risk]??9)||(b.diskBytes||0)-(a.diskBytes||0));

  // Projects to keep running, with the reason, so "what can I stop" never hides "what must stay".
  const stopping=new Set(ranked.filter(a=>a.action?.type==='stop').flatMap(a=>a.action.projects));
  const keep=running.filter(p=>!stopping.has(p.name)).map(p=>{
    const a=activity.get(p.name),u=users(p.name);
    const reason=kept(p.name)?msg('advisor.keep.flag'):u.length?msg('advisor.keep.usedBy',{projects:u}):a?.known?msg('advisor.keep.active'):msg('advisor.keep.observing');
    return {project:p.name,memBytes:mem.get(p.name)||0,reason};
  });
  const pending=running.map(p=>activity.get(p.name)).filter(a=>a&&!a.known).map(a=>Math.max(1,idleMinutes-a.observedMinutes));
  const freeable=ranked.filter(a=>a.kind==='stopIdle').reduce((n,a)=>n+a.impact.memBytes,0);
  const diskSafe=ranked.filter(a=>a.risk==='none'||a.risk==='low').reduce((n,a)=>n+(a.impact?.diskBytes||0),0);
  return {health,waste,actions:ranked,keep,observing:pending.length?{minutes:Math.max(...pending),idleMinutes}:null,totals:{memBytes:freeable,diskBytes:diskSafe}};
}

module.exports={RULES,healthScore,projectActivity,advise,IDLE_NET_BYTES,IDLE_CPU};
