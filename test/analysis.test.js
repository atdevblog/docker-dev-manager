'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const A=require('../lib/analysis');
const I18N=require('../public/i18n.js');const EN=I18N.create({vi:require('../public/locales/vi.json'),en:require('../public/locales/en.json')},'en'),text=m=>EN.render(m);
// Minimal `docker inspect` object; only the fields the analysis reads.
function raw(o){
 const running=(o.state||'running')==='running';
 const labels=o.project?{'com.docker.compose.project':o.project,'com.docker.compose.service':o.service||o.name,'com.docker.compose.oneoff':o.oneoff?'True':'False',
  'com.docker.compose.project.working_dir':o.dir||'/w/'+o.project,'com.docker.compose.project.config_files':o.files||`/w/${o.project}/compose.yaml`}:{};
 return {Id:(o.id||o.name).padEnd(64,'0'),Name:'/'+o.name,RestartCount:o.restarts||0,
  State:{Status:o.state||'running',ExitCode:o.exit||0,OOMKilled:!!o.oom,Error:o.error||'',StartedAt:'2026-10-09T00:00:00Z',FinishedAt:'0001-01-01T00:00:00Z',...(o.health?{Health:{Status:o.health}}:{})},
  Config:{Image:'img',Labels:{...labels,...(o.labels||{})}},HostConfig:{RestartPolicy:{Name:o.policy||'no'},PortBindings:o.ports||{},Memory:o.mem||0,NanoCpus:0},
  NetworkSettings:{Networks:Object.fromEntries((o.networks||[]).map(n=>[n,{}])),Ports:running?(o.ports||{}):{}},Mounts:[]};
}
const summarize=list=>A.summarizeProjects(list.map(raw).map(A.normalizeContainer));
const kinds=p=>p.issues.map(i=>`${i.kind}:${i.service}`);

test('groups by Compose label, ignores standalone containers and one-off runs',()=>{
 const [p,...rest]=summarize([{name:'a-db-1',project:'a',service:'db'},{name:'a-api-1',project:'a',service:'api',state:'exited'},{name:'a-run-1',project:'a',service:'api',oneoff:true},{name:'loose'}]);
 assert.equal(rest.length,0);assert.equal(p.name,'a');assert.equal(p.total,2);assert.equal(p.running,1);assert.equal(p.oneoffs,1);assert.equal(p.status,'partial');
});
test('one project name deployed from several directories is reported, not merged silently',()=>{
 const [p]=summarize([{name:'nginx',project:'fleet',dir:'/w/fleet',files:'/w/fleet/compose.yaml'},{name:'queue',project:'fleet',dir:'/w/other',files:'/w/other/compose.yaml',state:'exited'},{name:'redis',project:'fleet',dir:'/w/fleet',files:'/w/fleet/compose.yaml'}]);
 assert.equal(p.sources.length,2);assert.deepEqual(p.sources.map(s=>s.containers),[2,1]);assert.equal(p.total,3);
});
test('crash loop and the stopped services around it are flagged',()=>{
 const [p]=summarize([{name:'api',project:'erp',restarts:864},{name:'db',project:'erp',state:'exited',exit:255},{name:'redis',project:'erp',state:'exited',exit:255}]);
 const crash=p.issues.find(i=>i.kind==='crashloop');
 assert.equal(crash.level,'error');assert.match(text(crash.text),/864/);assert.match(text(crash.hint),/db, redis/);
 const db=p.issues.find(i=>i.service==='db');assert.match(text(db.hint),/Docker Desktop/);assert.match(text(db.hint),/Restart policy is "no"/);
});
test('containers stopped on purpose are not reported as failures',()=>{
 // unless-stopped/always: Docker would have restarted it, so an exited one was stopped deliberately.
 const [a]=summarize([{name:'web',project:'a'},{name:'queue',project:'a',state:'exited',exit:137,policy:'unless-stopped'},{name:'horizon',project:'a',state:'exited',exit:131,policy:'always'}]);
 assert.deepEqual(a.issues,[]);
 // A fully stopped project with normal stop codes is quiet; a real error code is still shown.
 const [b]=summarize([{name:'web',project:'b',state:'exited',exit:137},{name:'job',project:'b',state:'exited',exit:2}]);
 assert.deepEqual(kinds(b),['exited:job']);
});
test('OOM, unhealthy and failed starts are reported with severity',()=>{
 const [p]=summarize([{name:'clam',project:'a',oom:true,mem:268435456},{name:'fresh',project:'a',state:'exited',oom:true,policy:'unless-stopped'},{name:'web',project:'a',health:'unhealthy'},{name:'old',project:'a',state:'exited',health:'unhealthy',policy:'unless-stopped'},{name:'proxy',project:'a',state:'exited',error:'Bind for 0.0.0.0:80 failed: port is already allocated',policy:'unless-stopped'}]);
 assert.equal(p.issues[0].level,'error');
 assert.equal(p.issues.find(i=>i.service==='clam').level,'error');assert.match(text(p.issues.find(i=>i.service==='clam').hint),/256 MiB/);
 assert.equal(p.issues.find(i=>i.service==='fresh').level,'warn');
 assert.ok(p.issues.some(i=>i.kind==='unhealthy'&&i.service==='web'));assert.ok(!p.issues.some(i=>i.service==='old'));
 assert.match(text(p.issues.find(i=>i.kind==='startfailed').hint),/already allocated/);
});
test('cross-project dependencies come from shared Compose networks',()=>{
 const ps=summarize([{name:'mariadb',project:'fleet',networks:['fleet']},{name:'api',project:'erp',networks:['erp_default','fleet']},{name:'web',project:'shop',state:'exited',networks:['shop_default','fleet','gone']},{name:'x',project:'solo',networks:['bridge']}]);
 A.linkProjects(ps,new Map([['fleet','fleet'],['erp_default','erp'],['shop_default','shop'],['bridge','']]));
 const by=Object.fromEntries(ps.map(p=>[p.name,p]));
 assert.deepEqual(by.erp.dependsOn,[{project:'fleet',networks:['fleet'],known:true,running:true}]);
 assert.deepEqual(by.fleet.usedBy.map(u=>[u.project,u.running]),[['erp',true],['shop',false]]);
 assert.deepEqual(by.shop.missingNetworks,['gone']);assert.deepEqual(by.solo.missingNetworks,[]);
});
test('port conflicts respect bind addresses and ignore the project itself',()=>{
 const all=[raw({name:'redis',project:'fleet',ports:{'6379/tcp':[{HostIp:'127.0.0.1',HostPort:'6379'}]}}),raw({name:'lan',ports:{'8080/tcp':[{HostIp:'192.168.1.5',HostPort:'8080'}]}}),
  raw({name:'self',project:'erp',ports:{'9000/tcp':[{HostIp:'',HostPort:'9000'}]}}),raw({name:'old',project:'x',state:'exited',ports:{'5432/tcp':[{HostIp:'',HostPort:'5432'}]}})].map(A.normalizeContainer);
 const target=A.normalizeContainer(raw({name:'erp-redis',project:'erp',service:'redis',state:'exited',ports:{'6379/tcp':[{HostIp:'',HostPort:'6379'}],'8080/tcp':[{HostIp:'127.0.0.1',HostPort:'8080'}],'9000/tcp':[{HostIp:'',HostPort:'9000'}],'5432/tcp':[{HostIp:'',HostPort:'5432'}]}}));
 const conflicts=A.portConflicts([target],all,'erp');
 assert.deepEqual(conflicts.map(c=>[c.port,c.by,c.byProject]),[[6379,'redis','fleet']]);
});
test('execution order starts providers first and stops them last',()=>{
 const projects=[{name:'fleet',dependsOn:[]},{name:'erp',dependsOn:[{project:'fleet'}]},{name:'shop',dependsOn:[{project:'erp'},{project:'fleet'}]}];
 assert.deepEqual(A.executionOrder('start',['shop','erp','fleet'],projects),['fleet','erp','shop']);
 assert.deepEqual(A.executionOrder('stop',['fleet','shop','erp'],projects),['shop','erp','fleet']);
 assert.deepEqual(A.executionOrder('start',['a','b'],[{name:'a',dependsOn:[{project:'b'}]},{name:'b',dependsOn:[{project:'a'}]}]).sort(),['a','b']);
});
test('resource view sums stats per project and explains why not to stop',()=>{
 const ps=summarize([{id:'aaaaaaaaaaaa',name:'mariadb',project:'fleet',networks:['fleet']},{id:'bbbbbbbbbbbb',name:'api',project:'erp',networks:['fleet'],restarts:9},{id:'cccccccccccc',name:'odoo',project:'gm'},{id:'dddddddddddd',name:'db',project:'gm'}]);
 A.linkProjects(ps,new Map([['fleet','fleet']]));
 const view=A.resourceView(ps,[{id:'aaaaaaaaaaaa',memBytes:300,cpuPercent:1},{id:'bbbbbbbbbbbb',memBytes:100,cpuPercent:20},{id:'cccccccccccc',memBytes:500,cpuPercent:0.5},{id:'dddddddddddd',memBytes:250,cpuPercent:0.25},{id:'eeeeeeeeeeee',memBytes:50,cpuPercent:0}],['gm']);
 assert.deepEqual(view.projects.map(r=>[r.name,r.memBytes]),[['erp',100],['fleet',300],['gm',750]]);
 assert.equal(view.projects[0].crashLoop,true);assert.match(view.projects[1].notes.map(text).join(' '),/erp joins its network/);assert.equal(view.projects[2].keepRunning,true);
 assert.equal(view.totals.memBytes,1200);assert.equal(view.containers.find(c=>c.id==='eeeeeeeeeeee').project,'');
});
test('disk report matches docker system df accounting and never offers volume deletion',()=>{
 const df={Images:[{Repository:'<none>',Containers:'0',UniqueSize:'500MB'},{Repository:'php',Containers:'0',UniqueSize:'1GB'},{Repository:'pg',Containers:'2',UniqueSize:'300MB'}],
  BuildCache:[{InUse:'false',Shared:'false',Size:'2GB',LastUsedAt:'2025-01-01 00:00:00 +0000 UTC'},{InUse:'false',Shared:'true',Size:'5GB'},{InUse:'true',Shared:'false',Size:'1GB'},{InUse:'false',Shared:'false',Size:'1GB',LastUsedAt:'2026-10-08 00:00:00 +0000 UTC'}],
  Containers:[{State:'exited',Size:'24.1MB'},{State:'running',Size:'4kB'}],
  Volumes:[{Name:'a_db',Links:'0',Size:'3GB',Labels:'com.docker.compose.project=a,com.docker.compose.volume=db'},{Name:'f00',Links:'0',Size:'1GB',Labels:'com.docker.volume.anonymous='},{Name:'live',Links:'1',Size:'9GB',Labels:''}]};
 const r=A.diskReport(df,new Set(['a']),Date.parse('2026-10-09T00:00:00Z')),row=k=>r.rows.find(x=>x.key===k);
 assert.equal(row('buildCache').size,9e9);assert.equal(row('buildCache').reclaimable,3e9);assert.match(text(row('buildCache').commands[0].label),/2\.0 GB/);
 assert.equal(row('dangling').reclaimable,5e8);assert.equal(row('unusedImages').reclaimable,1e9);assert.equal(row('stoppedContainers').count,1);
 assert.equal(row('unusedVolumes').risk,'data');assert.equal(row('unusedVolumes').commands.length,0);assert.equal(row('unusedVolumes').size,4e9);
 assert.deepEqual(r.unusedVolumes.map(v=>[v.name,v.projectHasContainers,v.anonymous]),[['a_db',true,false],['f00',false,true]]);
});
test('size, date and shell helpers',()=>{
 assert.equal(A.parseSize('4.5MiB'),Math.round(4.5*1024**2));assert.equal(A.parseSize('22.06GB (53%)'),22.06e9);assert.equal(A.parseSize('0B'),0);assert.equal(A.parseSize('junk'),0);
 assert.equal(A.parseDockerDate('2025-12-31 15:32:02.664887219 +0000 UTC'),Date.parse('2025-12-31T15:32:02.664Z'));assert.equal(A.parseDockerDate('2026-10-02 09:35:59 +0700 +07'),Date.parse('2026-10-02T02:35:59Z'));
 assert.equal(A.shellQuote('/Users/me/My Projects/it\'s'),"'/Users/me/My Projects/it'\\''s'");assert.equal(A.shellQuote('/w/a.yml'),'/w/a.yml');
 assert.equal(A.formatBytes(1536),'1.5 KiB');assert.equal(A.formatBytes(21.47e9,true),'21.5 GB');
});
test('CLI commands: label mode runs outside any compose directory, managed mode uses the registered file',()=>{
 const discovered=A.cliCommands({name:'shop',managed:false,sources:[{directory:'/w/My Shop',files:['/w/My Shop/compose.yaml']}]});
 assert.ok(discovered.every(c=>/^cd /.test(c.command)));assert.equal(discovered.find(c=>text(c.label)==='Stop').command,'cd /tmp && docker compose -p shop stop');
 assert.match(discovered.at(-1).command,/^cd '\/w\/My Shop' && docker compose -p shop -f '\/w\/My Shop\/compose.yaml' up -d$/);
 const managed=A.cliCommands({name:'erp',managed:true,directory:'/w/erp',composeFile:'docker-compose.yml',sources:[]});
 assert.equal(managed.find(c=>text(c.label)==='Down').command,'cd /w/erp && docker compose -p erp -f docker-compose.yml down');
 assert.ok(!A.cliCommands({name:'fleet',managed:false,sources:[{directory:'/a',files:['/a/c.yml']},{directory:'/b',files:['/b/c.yml']}]}).some(c=>/up -d/.test(c.command)));
});
test('host overview: memory like Activity Monitor, swap, Linux meminfo and CPU share',()=>{
 const vm='Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:                               4512.\nPages wired down:                             263881.\nPages purgeable:                                   4.\nFile-backed pages:                            239955.\nAnonymous pages:                              468024.\nPages occupied by compressor:                1066781.\n';
 const m=A.parseVmStat(vm);assert.equal(m.used,(468020+263881+1066781)*16384);assert.equal(m.cached,239959*16384);
 assert.deepEqual(A.parseSwap('total = 19456.00M  used = 18413.00M  free = 1043.00M  (encrypted)'),{total:19456*1024**2,used:18413*1024**2});
 assert.deepEqual(A.parseSwap(''),{total:0,used:0});
 const linux=A.parseMeminfo('MemTotal:       16000000 kB\nMemFree:  100 kB\nMemAvailable:    6000000 kB\nCached:   2000000 kB\nSwapTotal:  1000 kB\nSwapFree:  400 kB\n');
 assert.equal(linux.used,10000000*1024);assert.deepEqual(linux.swap,{total:1000*1024,used:600*1024});
 const snap=(user,idle)=>({times:{user,nice:0,sys:0,idle,irq:0}});
 assert.equal(A.cpuPercent([snap(100,900),snap(100,900)],[snap(400,1600),snap(100,1900)]),15);
 assert.equal(A.cpuPercent(null,[snap(1,1)]),null);assert.equal(A.PRESSURE[2],'warning');
});
test('ports: lsof parsing, reserved ports of stopped containers, conflicts and free suggestions',()=>{
 const lsof='p727\ncControlCenter\nf10\nn*:5000\nf11\nn*:5000\np69506\nccom.docker.backend\nf20\nn127.0.0.1:3306\np4242\ncCode\\x20Helper\nf5\nn[::1]:23383\np99\ncnode\nf3\nn127.0.0.1:4173\n';
 const listeners=A.parseLsof(lsof);
 assert.deepEqual(listeners.map(l=>[l.command,l.ip,l.port]),[['ControlCenter','0.0.0.0',5000],['com.docker.backend','127.0.0.1',3306],['Code Helper','::1',23383],['node','127.0.0.1',4173]]);
 const containers=[raw({name:'mariadb',project:'fleet',ports:{'3306/tcp':[{HostIp:'127.0.0.1',HostPort:'3306'}]}}),raw({name:'shop-db',project:'shop',state:'exited',ports:{'3306/tcp':[{HostIp:'',HostPort:'3306'}]}}),
  raw({name:'web-a',project:'a',state:'exited',ports:{'80/tcp':[{HostIp:'',HostPort:'4200'}]}}),raw({name:'web-b',project:'b',state:'exited',ports:{'80/tcp':[{HostIp:'127.0.0.1',HostPort:'4200'}]}}),
  raw({name:'api',project:'a',state:'exited',ports:{'5000/tcp':[{HostIp:'',HostPort:'5000'}]}})].map(A.normalizeContainer);
 const inv=A.portInventory(containers,listeners,99),find=(name)=>inv.find(e=>e.container===name||e.process===name);
 assert.ok(!inv.some(e=>e.process==='com.docker.backend'));
 assert.match(text(find('shop-db').note),/mariadb \(fleet\)/);assert.match(text(find('api').note),/process ControlCenter/);
 assert.match(text(find('web-a').note),/web-b/);assert.equal(text(find('node').note),'This dashboard.');assert.equal(find('mariadb').note,undefined);
 assert.deepEqual(inv.map(e=>e.port),[...inv.map(e=>e.port)].sort((a,b)=>a-b));
 assert.deepEqual(A.nextFreePorts(3306,inv,3),[3307,3308,3309]);assert.deepEqual(A.nextFreePorts(4199,inv,2),[4199,4201]);
 assert.deepEqual(A.nextFreePorts(49150,[],5),[49150,49151]);
});
test('groups are derived from shared networks only: app plus everything it needs, providers first',()=>{
 const ps=summarize([{name:'nginx',project:'proxy',networks:['proxy']},{name:'db',project:'infra',networks:['infra','proxy']},{name:'web',project:'shop',networks:['infra']},
  {name:'api',project:'blog',state:'exited',networks:['infra','ghost_net']},{name:'odoo',project:'solo'},{name:'a',project:'loop-a',networks:['loop-b']},{name:'b',project:'loop-b',networks:['loop-a']}]);
 A.linkProjects(ps,new Map([['proxy','proxy'],['infra','infra'],['ghost_net','ghost'],['loop-a','loop-a'],['loop-b','loop-b']]));
 assert.deepEqual(A.autoGroups(ps),[
  {name:'blog',projects:['proxy','infra','blog']},{name:'infra',projects:['proxy','infra']},{name:'loop-a',projects:['loop-b','loop-a']},{name:'shop',projects:['proxy','infra','shop']}]);
});
