'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const A=require('../lib/analysis'),V=require('../lib/advisor');
function raw(o){
 const running=(o.state||'running')==='running';
 const labels=o.project?{'com.docker.compose.project':o.project,'com.docker.compose.service':o.service||o.name,'com.docker.compose.oneoff':'False','com.docker.compose.project.working_dir':'/w/'+o.project,'com.docker.compose.project.config_files':`/w/${o.project}/compose.yaml`}:{};
 return {Id:(o.id||o.name).padEnd(64,'0'),Name:'/'+o.name,RestartCount:o.restarts||0,State:{Status:o.state||'running',ExitCode:o.exit||0,OOMKilled:!!o.oom,Error:o.error||'',StartedAt:'2026-10-09T00:00:00Z',...(o.health?{Health:{Status:o.health}}:{})},
  Config:{Labels:labels},HostConfig:{RestartPolicy:{Name:o.policy||'no'},PortBindings:{},Memory:o.mem||0},NetworkSettings:{Networks:Object.fromEntries((o.networks||[]).map(n=>[n,{}])),Ports:{}},Mounts:[]};
}
function projects(list,networks=new Map()){const ps=A.summarizeProjects(list.map(raw).map(A.normalizeContainer));A.linkProjects(ps,networks);return ps;}
const ON={available:true,version:'27'},id=n=>n.padEnd(12,'0').slice(0,12);
const keys=list=>list.map(x=>x.rule||x.kind);

test('engine offline: score 0 with one explained deduction and a single action',()=>{
 const r=V.advise({docker:{available:false,error:'Cannot connect'}});
 assert.equal(r.health.score,0);assert.deepEqual(keys(r.health.findings),['engine']);assert.equal(r.health.findings[0].detail,'Cannot connect');
 assert.deepEqual(r.actions.map(a=>a.action.type),['refresh']);
});
test('health score: fixed points per rule, caps, and only live problems count',()=>{
 const ps=projects([
  ...['a','b','c','d'].map(n=>({name:'crash-'+n,project:'app',service:'w'+n,restarts:9})),
  {name:'web',project:'app',health:'unhealthy'},{name:'proxy',project:'app',state:'exited',error:'port is already allocated',policy:'unless-stopped'},
  {name:'db',project:'app',state:'exited',exit:255},{name:'clam',project:'app',oom:true,mem:100},
  {name:'job',project:'batch',state:'exited',exit:2},{name:'gone',project:'shop',state:'exited',networks:['vanished']}]);
 const h=V.healthScore({docker:ON,projects:ps,host:{memory:{pressure:'critical'}},vm:{memTotal:1000},containers:[{id:id('x'),project:'app',memBytes:950,cpuPercent:1}]});
 const pts=rule=>h.findings.filter(f=>f.rule===rule).map(f=>f.points);
 assert.deepEqual(pts('crashloop').sort(),[0,15,15,15]);
 assert.deepEqual(pts('unhealthy'),[10]);assert.deepEqual(pts('startFailed'),[10]);assert.deepEqual(pts('oomLive'),[12]);
 assert.deepEqual(pts('partialDown'),[5],'db exited while app runs');assert.equal(pts('partialDown').length,1,'batch is fully stopped: its failed job is not a live problem');
 assert.deepEqual(pts('missingNetwork'),[6]);assert.deepEqual(pts('hostPressureCritical'),[20]);assert.deepEqual(pts('vmMemoryHigh'),[10]);
 assert.equal(h.score,Math.max(0,100-h.findings.reduce((n,f)=>n+f.points,0)));assert.equal(h.score,0);assert.equal(h.grade,'poor');
 for(const f of h.findings){assert.ok(f.text&&f.fix,'every deduction has a cause and a fix');}
});
test('memory near a container limit, port conflicts and a healthy engine',()=>{
 const ps=projects([{name:'db',id:'dbcontainer1',project:'shop',mem:512*1024**2},{name:'web',project:'shop'}]);
 const containers=[{id:'dbcontainer1',project:'shop',memBytes:0.95*512*1024**2,cpuPercent:3}];
 const portEntries=[{kind:'container',running:false,port:6379,project:'blog',service:'redis',container:'blog-redis-1',note:{key:'ports.note.cannotStart',params:{}}},{kind:'container',running:true,port:80,project:'x',container:'x-1'}];
 const h=V.healthScore({docker:ON,projects:ps,containers,portEntries,vm:{memTotal:8*1024**3}});
 assert.deepEqual(keys(h.findings).sort(),['memoryNearLimit','portConflict']);assert.equal(h.score,86);assert.equal(h.grade,'fair');
 assert.equal(V.healthScore({docker:ON,projects:projects([{name:'web',project:'shop'}])}).grade,'good');
});
test('idle needs a full observation window, low traffic AND low CPU; restarts reset it',()=>{
 const ps=projects([{name:'q',id:'quiet',project:'quiet'},{name:'b',id:'busy',project:'busy'},{name:'n',id:'new',project:'new'},{name:'r',id:'restarted',project:'restarted'},{name:'c',id:'cpu',project:'cpu'}]);
 const now=1e9,min=60000,h=new Map();
 const series=(net0,net1,cpu,from=20)=>[{t:now-from*min,net:net0,cpu},{t:now-10*min,net:(net0+net1)/2,cpu},{t:now,net:net1,cpu}];
 h.set(id('quiet'),series(1000,1000+50e3,.2));h.set(id('busy'),series(0,5e6,.2));h.set(id('new'),series(0,0,0,5));h.set(id('restarted'),series(9e6,10,0));h.set(id('cpu'),series(0,0,25));
 const a=V.projectActivity(ps,h,now,15);
 assert.deepEqual(Object.fromEntries([...a].map(([k,v])=>[k,[v.known,v.idle]])),{busy:[true,false],cpu:[true,false],new:[false,false],quiet:[true,true],restarted:[true,false]});
 assert.equal(a.get('quiet').observedMinutes,20);
});
test('advise: stop idle projects with providers that serve only them; keep shared, flagged and active ones',()=>{
 const nets=new Map([['infra','infra'],['cache','cache']]);
 const ps=projects([{name:'db',id:'infradb',project:'infra',networks:['infra']},{name:'web',id:'blogweb',project:'blog',networks:['infra']},
  {name:'r',id:'cacher',project:'cache',networks:['cache']},{name:'api',id:'shopapi',project:'shop',networks:['cache']},{name:'x',id:'reportx',project:'reports'}],nets);
 const idle=new Set(['infra','blog','cache','reports']);
 const activity=new Map(ps.map(p=>[p.name,{known:true,idle:idle.has(p.name),observedMinutes:20}]));
 const containers=[['infradb','infra',300],['blogweb','blog',200],['cacher','cache',100],['shopapi','shop',400],['reportx','reports',50]].map(([i,project,m])=>({id:id(i),project,memBytes:m*1024**2,cpuPercent:0}));
 const r=V.advise({docker:ON,projects:ps,containers,activity,keepRunning:['reports'],vm:{memTotal:8*1024**3}});
 const stop=r.actions.find(a=>a.kind==='stopIdle');
 assert.deepEqual(stop.action.projects.sort(),['blog','infra'],'cache serves the active shop, reports is kept running');
 assert.equal(stop.impact.memBytes,500*1024**2);assert.equal(stop.risk,'low');assert.equal(r.totals.memBytes,500*1024**2);
 assert.deepEqual(Object.fromEntries(r.keep.map(k=>[k.project,k.reason.key])),{cache:'advisor.keep.usedBy',reports:'advisor.keep.flag',shop:'advisor.keep.active'});
 assert.deepEqual(r.waste.filter(w=>w.kind==='idle').map(w=>w.memBytes).sort((a,b)=>a-b),[200*1024**2,300*1024**2]);
});
test('advise: a crash loop next to stopped services suggests starting them first; partial-down is not repeated',()=>{
 const ps=projects([{name:'api',id:'apix',project:'erp',restarts:40},{name:'db',project:'erp',state:'exited',exit:255}]);
 const r=V.advise({docker:ON,projects:ps,containers:[{id:id('apix'),project:'erp',service:'api',memBytes:1,cpuPercent:7.5}]});
 assert.deepEqual(r.actions.map(a=>a.kind),['startStopped'],'one action: start what it waits for, with the log at hand');
 assert.deepEqual(r.actions[0].action,{type:'start',projects:['erp']});assert.deepEqual(r.actions[0].secondary,{type:'logs',project:'erp',service:'api'});
 assert.equal(r.waste.find(w=>w.kind==='churn').cpuPercent,7.5);
});
test('advise: under memory pressure the largest stoppable projects are suggested, as needing review',()=>{
 const ps=projects([{name:'a',id:'big',project:'big'},{name:'b',id:'small',project:'small'},{name:'c',id:'pinned',project:'pinned'}]);
 const containers=[['big','big',900],['small','small',100],['pinned','pinned',2000]].map(([i,project,m])=>({id:id(i),project,memBytes:m*1024**2,cpuPercent:5}));
 const activity=new Map(ps.map(p=>[p.name,{known:true,idle:false,observedMinutes:30}]));
 const r=V.advise({docker:ON,projects:ps,containers,activity,keepRunning:['pinned'],host:{memory:{pressure:'warning'}},vm:{memTotal:16*1024**3}});
 const mem=r.actions.filter(a=>a.kind==='stopForMemory');
 assert.deepEqual(mem.map(a=>a.action.projects[0]),['big','small']);assert.ok(mem.every(a=>a.risk==='review'&&a.riskText.key==='advisor.risk.active'));
 assert.equal(V.advise({docker:ON,projects:ps,containers,activity,vm:{memTotal:16*1024**3}}).actions.filter(a=>a.kind==='stopForMemory').length,0,'no pressure, no suggestion');
});
test('advise: disk reclaim is classified by safety and never offers a volume command',()=>{
 const disk=A.diskReport({BuildCache:[{InUse:'false',Shared:'false',Size:'3GB',LastUsedAt:'2020-01-01 00:00:00 +0000 UTC'},{InUse:'false',Shared:'false',Size:'1GB',LastUsedAt:'2026-10-08 00:00:00 +0000 UTC'}],
  Images:[{Repository:'<none>',Containers:'0',UniqueSize:'300MB'},{Repository:'node',Containers:'0',UniqueSize:'2GB'}],Containers:[],Volumes:[{Name:'db',Links:'0',Size:'4GB',Labels:''}]},new Set(),Date.parse('2026-10-09T00:00:00Z'));
 const r=V.advise({docker:ON,projects:[],disk});
 assert.deepEqual(r.actions.map(a=>[a.kind,a.risk]),[['pruneCacheOld','none'],['pruneDangling','none'],['reviewImages','review'],['reviewVolumes','data']],'safest first, data risk last');
 assert.equal(r.actions[0].impact.diskBytes,3e9);assert.equal(r.actions[0].action.command,'docker builder prune --all --filter until=720h');
 assert.ok(r.actions.filter(a=>a.risk==='data'||a.risk==='review').every(a=>a.action.type==='disk'&&!a.action.command));
 assert.equal(r.totals.diskBytes,3e9+300e6,'only safe categories count as reclaimable');
});
test('actions are ranked by severity: broken now, then memory pressure relief, then past problems, then disk',()=>{
 // The situation from a real report: memory pressure warning, an OOM in a past run, a large stoppable project, old build cache.
 const ps=projects([{name:'clam',project:'av',state:'exited',oom:true,policy:'unless-stopped',mem:256*1024**2},{name:'web',id:'shopweb',project:'shop'},{name:'api',id:'erpapi',project:'erp',restarts:12}]);
 const containers=[{id:id('shopweb'),project:'shop',service:'web',memBytes:3.6*1024**3,cpuPercent:4},{id:id('erpapi'),project:'erp',service:'api',memBytes:1,cpuPercent:9}];
 const disk=A.diskReport({BuildCache:[{InUse:'false',Shared:'false',Size:'16GB',LastUsedAt:'2020-01-01 00:00:00 +0000 UTC'}],Images:[],Containers:[],Volumes:[]});
 const activity=new Map(ps.map(p=>[p.name,{known:false,idle:false,observedMinutes:3}]));
 const r=V.advise({docker:ON,projects:ps,containers,host:{memory:{pressure:'warning'}},vm:{memTotal:8*1024**3},disk,activity});
 assert.deepEqual(r.actions.map(a=>[a.kind,a.tier]),[['crashloop',1],['stopForMemory',2],['stopForMemory',2],['oomPast',3],['pruneCacheOld',4]]);
 assert.equal(r.actions[1].action.projects[0],'shop','the largest relief comes first within its tier');
 assert.ok(!r.actions.some(a=>a.kind==='hostPressureWarning'),'the pressure finding is replaced by concrete stop suggestions');
 assert.ok(r.health.findings.some(f=>f.rule==='hostPressureWarning'),'but it still counts in the score');
 assert.deepEqual(r.waste.map(w=>w.kind),['churn','disk']);
});
