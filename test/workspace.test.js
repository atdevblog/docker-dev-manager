'use strict';
// Runs in its own process (node --test), so the config dir override never touches ~/.config.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const CONFIG_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'ddm-config-'));
process.env.DEV_MANAGER_CONFIG_DIR=CONFIG_DIR;
const S=require('../server');
const FILE=path.join(CONFIG_DIR,'projects.json');
const I18N=require('../public/i18n.js');const EN=I18N.create({vi:require('../public/locales/vi.json'),en:require('../public/locales/en.json')},'en'),text=m=>EN.render(m);
test.after(()=>fs.rmSync(CONFIG_DIR,{recursive:true,force:true}));

test('workspace and projects are saved without dropping each other or unknown keys',()=>{
 // `groups` from older versions is not used any more but must survive writes untouched.
 fs.writeFileSync(FILE,JSON.stringify({projects:[{name:'old',directory:'/x',composeFile:'c.yml'}],groups:[{name:'legacy',projects:['x']}]}));
 S.writeWorkspace({keepRunning:['infra']});
 S.writeConfig([...S.readConfig(),{name:'new',directory:'/y',composeFile:'c.yml'}]);
 const saved=JSON.parse(fs.readFileSync(FILE,'utf8'));
 assert.deepEqual(saved.projects.map(p=>p.name),['old','new']);assert.deepEqual(saved.keepRunning,['infra']);assert.equal(saved.groups[0].name,'legacy');
 assert.deepEqual(Object.keys(S.readWorkspace()).sort(),['keepRunning','language','theme']);
 assert.equal(fs.statSync(FILE).mode&0o777,0o600);
});
test('a corrupt config is never overwritten',()=>{
 fs.writeFileSync(FILE,'{"projects": [');
 assert.throws(()=>S.writeWorkspace({keepRunning:[]}));assert.equal(fs.readFileSync(FILE,'utf8'),'{"projects": [');
 fs.rmSync(FILE);
});
test('workspace validation: keep-running names and language only; groups are never accepted from clients',()=>{
 assert.deepEqual(S.validWorkspace({keepRunning:['infra','infra','db'],groups:[{name:'x',projects:['y']}]}),{keepRunning:['infra','db']});
 const key=k=>e=>e.msg?.key===k;
 assert.throws(()=>S.validWorkspace({keepRunning:['../etc']}),key('error.keepRunningList'));
 assert.throws(()=>S.validWorkspace({keepRunning:'infra'}),key('error.keepRunningList'));
 assert.throws(()=>S.validWorkspace(null),key('error.workspace'));
});
test('batch validation limits actions and scope',()=>{
 assert.deepEqual(S.validBatch({action:'stop',projects:['a','a','b']},['start','stop']),{action:'stop',projects:['a','b']});
 const key=k=>e=>e.msg?.key===k;
 assert.throws(()=>S.validBatch({action:'down',projects:['a']},['start','stop']),key('error.action'));
 assert.throws(()=>S.validBatch({action:'up',projects:['a','b']},['up']),key('error.oneProject'));
 assert.throws(()=>S.validBatch({action:'stop',projects:[]},['stop']),key('error.projects'));
 assert.throws(()=>S.validBatch({action:'stop',projects:['-p']},['stop']),key('error.projects'));
});
test('preflight without Docker data: no containers, already stopped, Up/Down need an imported project',async()=>{
 const ctx={containers:[],networks:new Map(),selected:new Set(),keepRunning:['b']};
 const base={containers:[],sources:[],dependsOn:[],usedBy:[],missingNetworks:[],issues:[]};
 assert.match(text((await S.planItem('start',{...base,name:'a',managed:true},ctx)).errors[0]),/Use Up/);
 assert.equal((await S.planItem('stop',{...base,name:'b'},ctx)).skip,true);
 assert.match(text((await S.planItem('up',{...base,name:'c',managed:false},ctx)).errors[0]),/imported/);
 assert.match(text((await S.planItem('down',{...base,name:'c',managed:false},ctx)).errors[0]),/imported/);
 assert.match(text((await S.planItem('start',undefined,ctx)).errors[0]),/not found/);
});
test('HTTP: new endpoints keep the host, origin and token rules',async()=>{
 const server=S.startServer(0);await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const {token}=await (await fetch(base+'/api/session')).json();
  const send=(url,method,body,headers={})=>fetch(base+url,{method,headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await send('/api/workspace','PUT',{keepRunning:[]})).status,403);
  assert.equal((await send('/api/workspace','PUT',{keepRunning:[]},{'X-Dev-Manager-Token':token,Origin:'https://evil.test'})).status,403);
  assert.equal((await send('/api/batch','POST',{action:'stop',projects:['a']})).status,403);
  // fetch() silently drops a custom Host header, so use http.get for the DNS-rebinding check.
  const hostStatus=await new Promise((resolve,reject)=>require('node:http').get({host:'127.0.0.1',port:server.address().port,path:'/api/state',headers:{Host:'evil.test'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject));
  assert.equal(hostStatus,403);
  const auth={'X-Dev-Manager-Token':token};
  const saved=await send('/api/workspace','PUT',{keepRunning:['infra']},auth);
  assert.equal(saved.status,200);assert.deepEqual((await (await fetch(base+'/api/workspace')).json()).keepRunning,['infra']);
  assert.equal((await send('/api/workspace','PUT',{keepRunning:['bad name']},auth)).status,400);
  assert.equal((await send('/api/plan','POST',{action:'prune',projects:['a']},auth)).status,400);
  assert.equal((await send('/api/batch','POST',{action:'down',projects:['a']},auth)).status,400);
  // Container actions: token required, only start/stop/restart, and only a 12-hex container id.
  assert.equal((await send('/api/projects/a/containers/0123456789ab/stop','POST',{})).status,403);
  assert.equal((await send('/api/projects/a/containers/0123456789ab/plan','POST',{action:'rm'},auth)).status,400);
  assert.equal((await send('/api/projects/a/containers/zzzzzzzzzzzz/stop','POST',{},auth)).status,404);
  assert.equal((await send('/api/projects/a/containers/0123456789AB/kill','POST',{},auth)).status,404);
  assert.equal((await send('/api/projects/a/containers/0123456789ab/terminal','POST',{mode:'shell'})).status,403);
  assert.equal((await send('/api/pick-folder','POST',{})).status,403,'the folder picker needs the session token');
  assert.equal((await send('/api/projects/a/containers/0123456789ab/terminal','POST',{mode:'rm -rf'},auth)).status,400);
  assert.equal((await fetch(base+'/api/jobs/00000000-0000-4000-8000-000000000000')).status,404);
  const adv=await (await fetch(base+'/api/advisor')).json();
  assert.equal(typeof adv.health.score,'number');assert.ok(['good','fair','poor'].includes(adv.health.grade));assert.ok(Array.isArray(adv.actions)&&Array.isArray(adv.waste)&&Array.isArray(adv.keep));
  assert.ok(adv.health.findings.every(f=>f.points>=0&&f.text&&f.fix));assert.ok(!Number.isNaN(Date.parse(adv.checkedAt)));
  // Asking for stats or disk only reuses earlier measurements: the advisor never starts them itself.
  const reuse=await (await fetch(base+'/api/advisor?parts=health,stats,disk')).json();
  assert.equal(reuse.parts.stats,false);assert.equal(reuse.parts.disk,false);assert.equal(reuse.statsAt,null);assert.equal(reuse.diskAt,null);
  const host=await (await fetch(base+'/api/host')).json();assert.ok('vm' in host&&'host' in host);
  const state=await (await fetch(base+'/api/state')).json();
  assert.equal(typeof state.docker.available,'boolean');assert.ok(Array.isArray(state.projects));assert.ok(Array.isArray(state.groups));assert.deepEqual(state.workspace.keepRunning,['infra']);
 }finally{await new Promise(r=>server.close(r));}
});
test('language preference: stored in the config file, kept by other saves, survives a restart, invalid falls back',async()=>{
 assert.deepEqual(S.validWorkspace({language:'en'}),{keepRunning:[],language:'en'});
 assert.throws(()=>S.validWorkspace({language:'fr'}),e=>e.msg?.key==='error.language');
 // Theme: light, dark, or '' to follow macOS; anything else is refused.
 assert.deepEqual(S.validWorkspace({theme:'dark'}),{keepRunning:[],theme:'dark'});assert.deepEqual(S.validWorkspace({theme:''}),{keepRunning:[],theme:''});
 assert.throws(()=>S.validWorkspace({theme:'blue'}),e=>e.msg?.key==='error.theme');
 fs.writeFileSync(FILE,JSON.stringify({projects:[],language:'fr'}));assert.equal(S.readWorkspace().language,'');
 fs.writeFileSync(FILE,JSON.stringify({projects:[{name:'p',directory:'/x',composeFile:'c.yml'}],language:'en'}));
 S.writeWorkspace(S.validWorkspace({keepRunning:['p']}));
 assert.equal(S.readWorkspace().language,'en');assert.deepEqual(S.readConfig().map(p=>p.name),['p']);
 const start=async()=>{const server=S.startServer(0);await new Promise(r=>server.once('listening',r));return {server,base:`http://127.0.0.1:${server.address().port}`};};
 let {server,base}=await start();
 try{
  const {token}=await (await fetch(base+'/api/session')).json(),headers={'Content-Type':'application/json','X-Dev-Manager-Token':token};
  const put=body=>fetch(base+'/api/workspace',{method:'PUT',headers,body:JSON.stringify(body)});
  assert.equal((await put({keepRunning:['p'],language:'vi'})).status,200);
  const bad=await put({keepRunning:[],language:'xx'});assert.equal(bad.status,400);
  const body=await bad.json();assert.equal(body.error,'Language must be vi or en.');assert.equal(body.message.key,'error.language');
 }finally{await new Promise(r=>server.close(r));}
 ({server,base}=await start());
 try{
  const w=await (await fetch(base+'/api/workspace')).json();assert.equal(w.language,'vi');assert.deepEqual(w.keepRunning,['p']);
  // The page carries the saved language, so its first frame is right whatever the browser stored.
  assert.match(await (await fetch(base+'/')).text(),/<html lang="vi" data-saved-lang="vi"/);
  S.writeWorkspace(S.validWorkspace({keepRunning:['p'],theme:'dark'}));assert.match(await (await fetch(base+'/')).text(),/data-saved-lang="vi" data-theme="dark"/);
  S.writeWorkspace(S.validWorkspace({keepRunning:['p'],theme:''}));assert.doesNotMatch(await (await fetch(base+'/')).text(),/data-theme=/);
  const saved=fs.readFileSync(FILE);fs.writeFileSync(FILE,'{broken');
  try{const r=await fetch(base+'/');assert.equal(r.status,200,'a corrupt config never blocks the page');assert.match(await r.text(),/data-saved-lang=""/);}
  finally{fs.writeFileSync(FILE,saved);}
 }
 finally{await new Promise(r=>server.close(r));}
});
test('measurements survive a reload and a restart; week-old ones are dropped',async()=>{
 const MFILE=path.join(path.dirname(FILE),'measurements.json');
 const server=S.startServer(0);await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  await fetch(base+'/api/advisor?parts=health');
  assert.ok(Date.parse((await (await fetch(base+'/api/measured')).json()).healthAt)>0);assert.equal(fs.statSync(MFILE).mode&0o777,0o600);
  // A file left by an earlier run: recent parts come back as they were, a week-old one is dropped.
  const now=Date.now(),at=now-120000,rows=[{key:'buildCache',count:1,size:1,reclaimable:1,risk:'safe',commands:[]}];
  fs.writeFileSync(MFILE,JSON.stringify({healthAt:now-60000,stats:{at:now-8*86400000,value:[]},disk:{at,value:{rows,unusedVolumes:[],generatedAt:new Date(at).toISOString()}},activity:[]}));
  S.loadMeasurements();
  const m=await (await fetch(base+'/api/measured')).json();
  assert.equal(Date.parse(m.healthAt),now-60000);assert.equal(m.disk.rows[0].key,'buildCache');assert.equal(m.resources,null);
 }finally{await new Promise(r=>server.close(r));}
});
test('static files include the i18n runtime, both dictionaries and the icons, nothing else',async()=>{
 const server=S.startServer(0);await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  for(const f of ['/i18n.js','/locales/vi.json','/locales/en.json'])assert.equal((await fetch(base+f)).status,200,f);
  assert.equal((await fetch(base+'/locales/vi.json')).headers.get('content-type'),'application/json; charset=utf-8');
  for(const [f,type] of [['/logo.svg','image/svg+xml'],['/favicon.svg','image/svg+xml'],['/favicon.ico','image/x-icon'],['/apple-touch-icon.png','image/png']]){
   const r=await fetch(base+f);assert.equal(r.status,200,f);assert.equal(r.headers.get('content-type'),type,f);
   assert.deepEqual(Buffer.from(await r.arrayBuffer()),fs.readFileSync(path.join(__dirname,'..','public',f.slice(1))),f+' served byte-for-byte');
  }
  const font=await fetch(base+'/fonts/be-vietnam-pro-400-vietnamese.woff2');assert.equal(font.status,200);assert.equal(font.headers.get('content-type'),'font/woff2');assert.match(font.headers.get('cache-control'),/immutable/);
  for(const f of ['/locales/fr.json','/server.js','/locales/../server.js','/fonts/OFL.txt','/fonts/missing.woff2'])assert.equal((await fetch(base+f)).status,404,f);
 }finally{await new Promise(r=>server.close(r));}
});
