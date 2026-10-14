'use strict';
// Real Docker Engine test. Opt-in (`npm run test:docker`) because it creates, starts and stops
// throwaway Compose projects named ddmit<random>-*; it never touches other projects.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');const crypto=require('node:crypto');
const {execFile}=require('node:child_process');const exec=require('node:util').promisify(execFile);
const ENABLED=process.env.DDM_DOCKER_IT==='1';
const CONFIG_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'ddm-it-config-'));
process.env.DEV_MANAGER_CONFIG_DIR=CONFIG_DIR;
const S=require('../server');
const I18N=require('../public/i18n.js');const EN=I18N.create({vi:require('../public/locales/vi.json'),en:require('../public/locales/en.json')},'en'),text=m=>EN.render(m);
const R=crypto.randomBytes(3).toString('hex'),FLEET=`ddmit${R}-fleet`,APP=`ddmit${R}-app`,CRASH=`ddmit${R}-crash`,BROKEN=`ddmit${R}-broken`,HOLDER=`ddmit${R}-holder`,NET=`ddmit${R}-shared`;
// nginx:alpine declares no VOLUME, so the throwaway containers leave no anonymous volumes behind.
const PORT=47391,IMAGE='nginx:alpine',ROOT=fs.mkdtempSync(path.join(os.tmpdir(),'ddm-it-'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const dockerCli=(args,cwd)=>exec('docker',args,{cwd,timeout:120000});
const svc=(name,extra='')=>`  ${name}:\n    image: ${IMAGE}\n    command: ["sh","-c","echo ${name} up; exec sleep 3600"]\n${extra}`;
const stacks={
 [FLEET]:`services:\n${svc('cache','    networks: [shared]\n')}networks:\n  shared:\n    name: ${NET}\n`,
 [APP]:`services:\n${svc('db')}${svc('app',`    depends_on: [db]\n    ports: ["127.0.0.1:${PORT}:6379"]\n    networks: [default, shared]\n`)}networks:\n  shared:\n    external: true\n    name: ${NET}\n`,
 [CRASH]:`services:\n  loop:\n    image: ${IMAGE}\n    command: ["sh","-c","exit 3"]\n    restart: always\n  oneshot:\n    image: ${IMAGE}\n    command: ["sh","-c","exit 2"]\n${svc('keep')}`,
 [BROKEN]:'services: [\n'};
const dirOf=name=>path.join(ROOT,name),compose=(name,args)=>dockerCli(['compose','-p',name,'-f','compose.yaml',...args],dirOf(name));

test('real Docker: discovery, Docker-derived groups, preflight, label-mode actions, logs, cancel, Up/Down',{skip:!ENABLED&&'set DDM_DOCKER_IT=1 (npm run test:docker)'},async t=>{
 for(const [name,yaml] of Object.entries(stacks)){fs.mkdirSync(dirOf(name));fs.writeFileSync(path.join(dirOf(name),'compose.yaml'),yaml);}
 const server=S.startServer(0);await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  await compose(FLEET,['up','-d']);await compose(APP,['up','-d']);await compose(CRASH,['up','-d']);
  const {token}=await (await fetch(base+'/api/session')).json();
  const get=async url=>{const r=await fetch(base+url);return {status:r.status,body:await r.json()};};
  const post=async(url,body={})=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Dev-Manager-Token':token},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  const project=async name=>{await sleep(1100);return (await get('/api/state')).body.projects.find(p=>p.name===name);};
  const plan=async(action,projects)=>(await post('/api/plan',{action,projects})).body;
  const waitJob=async id=>{for(let i=0;i<120;i++){const {job}=(await get('/api/jobs/'+id)).body;if(job.state!=='running')return job;await sleep(500);}throw new Error('job timeout');};

  await t.test('discovers projects, counts and cross-project network dependency',async()=>{
   const app=await project(APP),fleet=await project(FLEET);
   assert.equal(app.managed,false);assert.equal(app.importable,true);assert.equal(app.running,2);assert.equal(app.total,2);assert.equal(app.status,'running');
   assert.deepEqual(app.dependsOn.map(d=>[d.project,d.running]),[[FLEET,true]]);assert.deepEqual(fleet.usedBy.map(u=>u.project),[APP]);
   const groups=(await get('/api/state')).body.groups;assert.deepEqual(groups.find(g=>g.name===APP),{name:APP,projects:[FLEET,APP]});
  });
  await t.test('stopping a provider warns about its running dependents and offers them unticked',async()=>{
   const p=await plan('stop',[FLEET]);
   assert.match(text(p.items[0].warnings),new RegExp(APP));assert.equal(p.items[0].protect,true);assert.equal(p.items[1].project,APP);assert.equal(p.items[1].related,true);
   const group=await plan('stop',[FLEET,APP]);assert.equal(group.items.find(i=>i.project===FLEET).protect,false,'stopping the whole group may stop its provider');
   assert.deepEqual(p.order,[APP,FLEET]);
  });
  await t.test('stop works on a discovered project without importing it (label mode)',async()=>{
   const r=await post(`/api/projects/${APP}/stop`);assert.equal(r.status,200,r.body.error);
   const app=await project(APP);assert.equal(app.running,0);assert.equal(app.total,2);assert.deepEqual(app.issues,[]);
  });
  await t.test('port taken by another container blocks start with the culprit named',async()=>{
   await dockerCli(['run','-d','--name',HOLDER,'-p',`127.0.0.1:${PORT}:6379`,IMAGE,'sleep','600']);
   await sleep(1100);
   const p=await plan('start',[APP]);assert.match(text(p.items[0].errors),new RegExp(`${PORT}.*${HOLDER}`));
   const r=await post(`/api/projects/${APP}/start`);assert.equal(r.status,409);assert.match(r.body.error,/Preflight failed/);
   assert.equal((await project(APP)).running,0);
   await dockerCli(['rm','-f','-v',HOLDER]);
  });
  await t.test('a non-Docker listener on the port is reported as a warning',async()=>{
   const listener=net.createServer().listen(PORT,'127.0.0.1');await new Promise(r=>listener.once('listening',r));
   try{await sleep(1100);const p=await plan('start',[APP]);assert.deepEqual(p.items[0].errors,[]);assert.match(text(p.items[0].warnings),/listener on this Mac/);}
   finally{await new Promise(r=>listener.close(r));}
  });
  await t.test('group start runs providers first and skips what already runs',async()=>{
   const created=await post('/api/batch',{action:'start',projects:[APP,FLEET]});assert.equal(created.status,202);
   const job=await waitJob(created.body.job.id);
   assert.deepEqual(job.items.map(i=>[i.project,i.status]),[[FLEET,'skipped'],[APP,'done']]);
   assert.equal((await project(APP)).running,2);
  });
  await t.test('logs per service through label mode',async()=>{
   // Docker may need a moment to flush the first lines of a container that just started.
   let logs;for(let i=0;i<10;i++){logs=await get(`/api/projects/${APP}/logs?service=app&tail=20`);if(/app up/.test(logs.body.logs||''))break;await sleep(500);}
   assert.equal(logs.status,200);assert.match(logs.body.logs,/app up/);assert.doesNotMatch(logs.body.logs,/db up/);
   assert.equal((await get(`/api/projects/${APP}/logs?service=nope`)).status,400);
  });
  await t.test('one container at a time, like Docker Desktop: dependents named, siblings untouched',async()=>{
   const app=await project(APP),db=app.containers.find(c=>c.service==='db'),web=app.containers.find(c=>c.service==='app');
   const url=(c,verb)=>`/api/projects/${APP}/containers/${c.id}/${verb}`,state=(p,s)=>p.containers.find(c=>c.service===s);
   const stopPlan=(await post(url(db,'plan'),{action:'stop'})).body.items[0];
   assert.deepEqual(stopPlan.containers,['db']);assert.match(text(stopPlan.warnings),/app depends on db/);
   const stopped=await post(url(db,'stop'));assert.equal(stopped.status,200,stopped.body.error);
   let now=await project(APP);assert.equal(state(now,'db').state,'exited');assert.equal(state(now,'app').state,'running');
   // Terminal: no shell in a stopped container, and no folder when nothing is mounted (no window opens).
   if(process.platform==='darwin'){assert.equal((await post(url(db,'terminal'),{mode:'shell'})).status,409);assert.equal((await post(url(web,'terminal'),{mode:'folder'})).status,404);}
   const restarted=await post(url(web,'restart'));assert.equal(restarted.status,200,restarted.body.error);
   now=await project(APP);assert.notEqual(state(now,'app').startedAt,state(app,'app').startedAt);assert.equal(state(now,'db').state,'exited','a container restart never starts its dependencies');
   assert.equal((await post(url(db,'restart'))).body.skipped,true);
   assert.match(text((await post(url(web,'plan'),{action:'start'})).body.items[0].info),/Already running/);
   assert.equal((await post(url(db,'start'))).status,200);assert.equal((await project(APP)).running,2);
   assert.equal((await post(`/api/projects/${APP}/containers/000000000000/stop`)).status,404);
  });
  await t.test('cancel leaves the remaining projects untouched',async()=>{
   const created=await post('/api/batch',{action:'stop',projects:[FLEET,APP]});
   await post(`/api/jobs/${created.body.job.id}/cancel`);
   const job=await waitJob(created.body.job.id);
   assert.equal(job.state,'cancelled');assert.deepEqual(job.items.map(i=>i.project),[APP,FLEET]);assert.equal(job.items[1].status,'cancelled');
   assert.equal((await project(FLEET)).running,1);
  });
  await t.test('crash loop and non-zero exit are reported',async()=>{
   for(let i=0;i<60;i++){const {stdout}=await dockerCli(['inspect','-f','{{.RestartCount}}',`${CRASH}-loop-1`]);if(Number(stdout)>=5)break;await sleep(500);}
   const crash=await project(CRASH);
   assert.ok(crash.issues.some(i=>i.kind==='crashloop'&&i.service==='loop'),JSON.stringify(crash.issues));
   assert.ok(crash.issues.some(i=>i.kind==='exited'&&i.service==='oneshot'&&/code 2/.test(text(i.text))));
   // Each box measures on its own: stats first, then the advisor combines what has been measured.
   assert.ok((await get('/api/resources')).body.containers.some(c=>c.project===CRASH));
   const adv=(await get('/api/advisor?parts=health,stats')).body;
   assert.deepEqual(adv.parts,{health:true,stats:true,disk:false});assert.ok(adv.waste.some(w=>w.kind==='churn'&&/loop/.test(text(w.text))));
   assert.ok(adv.health.findings.some(f=>f.rule==='crashloop'&&f.project===CRASH&&f.points===15),'crash loop deducts 15 points');
   assert.ok(adv.health.score<=85);
   const start=adv.actions.find(a=>a.kind==='startStopped'&&a.action.projects[0]===CRASH);
   assert.ok(start,'suggests starting the stopped services');assert.deepEqual(start.secondary,{type:'logs',project:CRASH,service:'loop'});
  });
  await t.test('Up and Down need an imported project; Up preflight validates Compose config',async()=>{
   assert.equal((await post(`/api/projects/${APP}/down`,{confirm:`down ${APP}`})).status,400);
   assert.equal((await post('/api/projects',{name:APP,directory:dirOf(APP),composeFile:'compose.yaml'})).status,201);
   const up=await plan('up',[APP]);assert.deepEqual(up.items[0].errors,[]);assert.deepEqual(up.items[0].containers.sort(),['app','db']);assert.match(text(up.items[0].warnings),/recreates/);
   assert.equal((await post('/api/projects',{name:BROKEN,directory:dirOf(BROKEN),composeFile:'compose.yaml'})).status,201);
   assert.match(text((await plan('up',[BROKEN])).items[0].errors[0]),/Compose config is invalid/);
   assert.equal((await post(`/api/projects/${APP}/down`,{confirm:'wrong'})).status,400);
   const down=await post(`/api/projects/${APP}/down`,{confirm:`down ${APP}`});assert.equal(down.status,200,down.body.error);
   const app=await project(APP);assert.equal(app.managed,true);assert.equal(app.total,0);
   assert.match(text((await plan('start',[APP])).items[0].errors[0]),/Use Up/);
  });
 }finally{
  await new Promise(r=>server.close(r));
  // -v: the test image declares VOLUME /data, so every throwaway container also left an anonymous volume.
  await dockerCli(['rm','-f','-v',HOLDER]).catch(()=>{});
  for(const name of [APP,CRASH,FLEET])await compose(name,['down','-v','--timeout','2']).catch(()=>{});
  fs.rmSync(ROOT,{recursive:true,force:true});fs.rmSync(CONFIG_DIR,{recursive:true,force:true});
 }
});
