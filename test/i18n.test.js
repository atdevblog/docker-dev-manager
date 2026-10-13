'use strict';
// i18n contract: same keys in vi/en, no key used in code is missing, no dead keys, no untranslated
// static HTML, and every message the server builds renders cleanly in both languages.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
process.env.DEV_MANAGER_CONFIG_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'ddm-i18n-'));
const I18N=require('../public/i18n.js'),A=require('../lib/analysis'),S=require('../server');
const vi=require('../public/locales/vi.json'),en=require('../public/locales/en.json'),DICTS={vi,en};
const ROOT=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const SOURCES=['server.js','lib/analysis.js','lib/advisor.js','public/app.js'].map(f=>[f,read(f)]),HTML=read('public/index.html');
const NAMESPACES=new Set(Object.keys(vi)),viKeys=I18N.keys(vi),enKeys=I18N.keys(en);
test.after(()=>fs.rmSync(process.env.DEV_MANAGER_CONFIG_DIR,{recursive:true,force:true}));

// Keys are referenced only as literal strings ('ns.key') or data-i18n attributes, never built dynamically.
function referencedKeys(){
 const refs=new Map();
 for(const [file,src] of SOURCES)for(const m of src.matchAll(/'([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)'/g))
  if(NAMESPACES.has(m[1].split('.')[0])&&!/\.(js|css|json|html|ya?ml)$/.test(m[1]))refs.set(m[1],file);
 for(const m of HTML.matchAll(/data-i18n(?:-placeholder|-aria-label|-title)?="([^"]+)"/g))refs.set(m[1],'public/index.html');
 return refs;
}
test('vi and en define exactly the same keys',()=>{
 assert.deepEqual(viKeys.filter(k=>!enKeys.includes(k)),[],'missing in en');
 assert.deepEqual(enKeys.filter(k=>!viKeys.includes(k)),[],'missing in vi');
});
test('placeholders are the same in both languages',()=>{
 const vars=v=>[...new Set((typeof v==='string'?[v]:Object.values(v)).flatMap(s=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1])))].sort();
 assert.deepEqual(viKeys.filter(k=>vars(I18N.lookup(vi,k)).join()!==vars(I18N.lookup(en,k)).join()),[]);
});
test('every key used in code exists (no missing translation)',()=>{
 assert.deepEqual([...referencedKeys()].filter(([k])=>!viKeys.includes(k)).map(([k,f])=>`${f}: ${k}`),[]);
});
test('every translation key is used (no dead keys)',()=>{
 const used=referencedKeys();assert.deepEqual(viKeys.filter(k=>!used.has(k)),[]);
});
test('static HTML has no text outside data-i18n',()=>{
 const VOID=new Set(['meta','link','input','br','img','hr']),stack=[],bad=[];
 for(const m of HTML.matchAll(/<!--[\s\S]*?-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/gi)){
  if(m[4]!==undefined){const text=m[4].replace(/&nbsp;/g,' ').trim();if(/\p{L}/u.test(text)&&!stack.some(e=>e.translated))bad.push(text);continue;}
  if(!m[2])continue;const tag=m[2].toLowerCase();
  if(m[1]){while(stack.length&&stack.pop().tag!==tag);continue;}
  if(!VOID.has(tag)&&!m[3].endsWith('/'))stack.push({tag,translated:/(^|\s)data-i18n(-skip)?(=|\s|$)/.test(m[3])||['script','style'].includes(tag)});
 }
 assert.deepEqual(bad,[]);
});
test('Vietnamese dictionary has no leftover English sentences',()=>{
 const english=/\b(the|is|was|are|and|with|by|of|for|has|been|cannot|should|please|this|that|your)\b/i;
 assert.deepEqual(viKeys.filter(k=>{const v=I18N.lookup(vi,k);return (typeof v==='string'?[v]:Object.values(v)).some(s=>english.test(s));}),[]);
});
test('t(): Vietnamese default and fallback, plurals, params, lists and technical values',()=>{
 const missing=[],viT=I18N.create(DICTS,'vi'),enT=I18N.create(DICTS,'en',k=>missing.push(k));
 assert.equal(I18N.create(DICTS,'fr').lang,'vi');assert.equal(I18N.create(DICTS,undefined).lang,'vi');
 assert.equal(enT.t('metric.containersRunning',{count:1}),'1 container running');assert.equal(enT.t('metric.containersRunning',{count:3}),'3 containers running');
 assert.equal(viT.t('metric.containersRunning',{count:3}),'3 container đang chạy');
 assert.equal(I18N.create({vi,en:{}},'en').t('action.stop'),'Dừng');
 assert.equal(enT.t('no.such.key'),'no.such.key');assert.deepEqual(missing,['no.such.key']);
 assert.equal(viT.t('ports.chipFree',{port:55432}),'55432 trống');
 assert.equal(enT.render([A.msg('exit.c255'),A.msg('exit.policyNo')]),`${en.exit.c255} ${en.exit.policyNo}`);
 assert.equal(enT.render('Bind for 0.0.0.0:80 failed: port is already allocated'),'Bind for 0.0.0.0:80 failed: port is already allocated');
 assert.equal(viT.t('issue.stoppedHint',{services:['db','redis',A.msg('common.more',{count:2})]}),'Đã dừng trong dự án này: db, redis, +2 khác. Xem nhật ký để biết nó đang chờ gì.');
 assert.equal(enT.t('reason.sources',{count:2,sources:{sep:'; ',items:['a','b']}}),'Containers come from 2 different Compose sources (a; b).');
});

// Fixture inspect objects (same shape as test/analysis.test.js).
function raw(o){
 const running=(o.state||'running')==='running';
 const labels=o.project?{'com.docker.compose.project':o.project,'com.docker.compose.service':o.service||o.name,'com.docker.compose.oneoff':'False','com.docker.compose.project.working_dir':o.dir||'/w/'+o.project,'com.docker.compose.project.config_files':o.files||`/w/${o.project}/compose.yaml`}:{};
 return {Id:o.name.padEnd(64,'0'),Name:'/'+o.name,RestartCount:o.restarts||0,State:{Status:o.state||'running',ExitCode:o.exit||0,OOMKilled:!!o.oom,Error:o.error||'',StartedAt:'2026-10-09T00:00:00Z',...(o.health?{Health:{Status:o.health}}:{})},
  Config:{Labels:labels},HostConfig:{RestartPolicy:{Name:o.policy||'no'},PortBindings:o.ports||{},Memory:o.mem||0},NetworkSettings:{Networks:Object.fromEntries((o.networks||[]).map(n=>[n,{}])),Ports:running?(o.ports||{}):{}},
  Mounts:(o.binds||[]).map(Source=>({Type:'bind',Source}))};
}
// Collects every message the server can build for these fixtures: issues, hints, notes, labels, preflight.
async function serverMessages(){
 const fixtures=[{name:'mariadb',project:'fleet',networks:['fleet'],ports:{'3306/tcp':[{HostIp:'127.0.0.1',HostPort:'3306'}]}},
  {name:'api',project:'erp',networks:['fleet'],restarts:9},{name:'db',project:'erp',state:'exited',exit:255},{name:'clam',project:'erp',oom:true,mem:268435456},{name:'fresh',project:'erp',state:'exited',oom:true,policy:'unless-stopped'},
  {name:'web',project:'erp',health:'unhealthy'},{name:'proxy',project:'erp',state:'exited',error:'port is already allocated',policy:'unless-stopped'},{name:'loop',project:'erp',state:'restarting',exit:3},{name:'gone',project:'erp',state:'dead'},
  {name:'job',project:'erp',state:'exited',exit:2},{name:'sig',project:'erp',state:'exited',exit:139},{name:'odd',project:'erp',state:'exited',exit:42},
  {name:'shopdb',project:'shop',state:'exited',dir:'/w/shop',networks:['fleet','vanished'],ports:{'3306/tcp':[{HostIp:'',HostPort:'3306'}]},binds:[path.join(os.homedir(),'ddm-i18n-missing-dir')]},
  {name:'shopq',project:'shop',state:'exited',dir:'/w/shop-worktree',files:'/w/shop/a.yml,/w/shop/b.yml'},
  {name:'multi',project:'multi',files:'/w/multi/a.yml,/w/multi/b.yml'},{name:'loose',ports:{'80/tcp':[{HostIp:'',HostPort:'8080'}]}}];
 const rawList=fixtures.map(raw),containers=rawList.map(A.normalizeContainer),networks=new Map([['fleet','fleet']]);
 const projects=S.mergeManaged(S.discoverFromInspect(rawList,[],networks),[{name:'old',directory:'/w/old',composeFile:'compose.yaml'}]);
 const by=n=>projects.find(p=>p.name===n),out=[];
 for(const p of projects){out.push(p.reason);for(const i of p.issues)out.push(i.text,i.hint);for(const c of p.commands)out.push(c.label);}
 out.push(...A.cliCommands({...by('fleet'),managed:true,directory:'/w/fleet',composeFile:'compose.yaml'}).map(c=>c.label));
 for(const r of A.resourceView(projects,[],['fleet']).projects)out.push(...r.notes);
 const disk=A.diskReport({BuildCache:[{InUse:'false',Shared:'false',Size:'1GB',LastUsedAt:'2020-01-01 00:00:00 +0000 UTC'}],Images:[],Containers:[],Volumes:[]});
 for(const r of disk.rows)out.push(r.label,r.note,...r.commands.map(c=>c.label));
 const inv=A.portInventory(containers,[{pid:1,command:'ControlCenter',ip:'0.0.0.0',port:8080},{pid:2,command:'node',ip:'127.0.0.1',port:4173}],2);for(const e of inv)out.push(e.note);
 const ctx={containers,networks,selected:new Set(),keepRunning:['fleet']};
 const managedEmpty={...by('old'),composeFileOk:true};
 const plans=[['start',by('shop')],['start',by('erp')],['stop',by('fleet')],['down',{...by('fleet'),managed:true}],['up',by('erp')],['up',{...by('old'),composeFileOk:false}],
  ['start',managedEmpty],['start',by('multi')],['restart',by('multi')],['stop',by('shop')],['start',undefined]];
 for(const [action,p] of plans){const item=await S.planItem(action,p,ctx);out.push(...item.errors,...item.warnings,item.info);}
 // Advisor: offline engine, then a busy machine with every kind of finding, idle projects, pressure and disk waste.
 const V=require('../lib/advisor');
 const live=containers.filter(c=>c.state==='running').map(c=>({id:c.id,project:c.project,service:c.service,memBytes:c.name==='clam'?0.95*268435456:80e6,cpuPercent:2}));
 const bigDisk=A.diskReport({BuildCache:[{InUse:'false',Shared:'false',Size:'2GB',LastUsedAt:'2020-01-01 00:00:00 +0000 UTC'}],Images:[{Repository:'<none>',Containers:'0',UniqueSize:'300MB'},{Repository:'node',Containers:'0',UniqueSize:'2GB'}],
  Containers:[{State:'exited',Size:'200MB'}],Volumes:[{Name:'v',Links:'0',Size:'3GB',Labels:''}]});
 const act=idle=>new Map(projects.map(p=>[p.name,{known:p.name!=='multi',idle:idle.includes(p.name),observedMinutes:20}]));
 for(const r of [V.advise({docker:{available:false,error:'Cannot connect'}}),
   V.advise({docker:{available:true},projects,containers:live,vm:{memTotal:1e9},host:{memory:{pressure:'critical'}},keepRunning:['fleet'],portEntries:inv,disk:bigDisk,activity:act(['erp'])}),
   V.advise({docker:{available:true},projects,containers:live,vm:{memTotal:1e12},keepRunning:[],portEntries:inv,disk:bigDisk,activity:act(['erp','fleet'])})]){
  for(const f of r.health.findings)out.push(f.text,f.fix,f.detail);
  for(const a of r.actions)out.push(a.title,...(a.why||[]),a.riskText);
  for(const w of r.waste)out.push(w.text);for(const k of r.keep)out.push(k.reason);
 }
 out.push(A.msg('error.preflight',{details:[A.msg('preflight.noContainers')]}),A.msg('error.action',{actions:['start','stop']}),A.msg('error.needsImport',{action:'up'}),A.msg('error.confirm',{phrase:'down erp'}));
 // Plain strings are Docker's own text (e.g. State.Error) and must pass through unchanged.
 return out.filter(Boolean);
}
test('every server-built message renders in both languages with no raw keys or unfilled placeholders',async()=>{
 const messages=await serverMessages(),keysSeen=new Set(JSON.stringify(messages).match(/"key":"[^"]+"/g));
 assert.ok(keysSeen.size>=90,`only ${keysSeen.size} distinct messages exercised`);
 for(const lang of ['vi','en']){
  const missing=[],R=I18N.create(DICTS,lang,k=>missing.push(k));
  for(const m of messages){const text=R.render(m);assert.doesNotMatch(text,/\{\w+\}/,`${lang}: ${JSON.stringify(m)} -> ${text}`);assert.ok(text.trim(),`${lang}: empty ${JSON.stringify(m)}`);}
  assert.deepEqual(missing,[],lang);
 }
 // Technical names travel untouched through translation.
 const viText=I18N.create(DICTS,'vi').render(messages);
 for(const name of ['mariadb','fleet','shopdb','vanished','3306','port is already allocated'])assert.ok(viText.includes(name),name);
});
