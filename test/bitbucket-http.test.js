'use strict';
// The Bitbucket support tool end to end, in a sandbox: its own ~/.ssh and repositories, offline (no host
// key download, no live ssh test). It never reads or writes the real ~/.ssh.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ROOT=fs.mkdtempSync(path.join(os.tmpdir(),'ddm-bb-'));
const SSH=path.join(ROOT,'ssh'),HOME=path.join(ROOT,'home');
process.env.DEV_MANAGER_CONFIG_DIR=path.join(ROOT,'config');process.env.DEV_MANAGER_SSH_DIR=SSH;process.env.DEV_MANAGER_SCAN_ROOTS=HOME;
const S=require('../server');
test.after(()=>fs.rmSync(ROOT,{recursive:true,force:true}));

const CONFIG=`Host bb-alias
  HostName bitbucket.org
  User git
  IdentityFile ${path.join(ROOT,'no-such-key')}

Host gh
  HostName github.com
`;
function repo(dir,remotes){
 fs.mkdirSync(dir,{recursive:true});execFileSync('git',['init','-q',dir]);
 for(const [name,url] of remotes)execFileSync('git',['-C',dir,'remote','add',name,url]);
}
fs.mkdirSync(SSH,{recursive:true});fs.writeFileSync(path.join(SSH,'config'),CONFIG);
repo(path.join(HOME,'Projects','alias-app'),[['origin','git@bb-alias:team/alias-app.git']]);
repo(path.join(HOME,'Projects','direct-app'),[['origin','git@bitbucket.org:team/direct-app.git'],['mirror','https://bitbucket.org/team/direct-app.git']]);
repo(path.join(HOME,'Projects','github-app'),[['origin','git@gh:me/github-app.git']]);
repo(path.join(HOME,'Projects','web','node_modules','dep'),[['origin','git@bitbucket.org:team/skipped.git']]);
fs.mkdirSync(path.join(HOME,'deploy'),{recursive:true});fs.writeFileSync(path.join(HOME,'deploy','deploy.sh'),'git clone git@bitbucket.org:team/direct-app.git\n');
fs.writeFileSync(path.join(HOME,'deploy','notes.txt'),'git@bitbucket.org is only mentioned in a text file\n');

test('the Bitbucket check and its fixes, from a reviewed preview to a clean second check',async()=>{
 const server=S.startServer(0);await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const token=(await (await fetch(base+'/api/session')).json()).token;
  const post=async(p,body,auth=true)=>{const r=await fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{'X-Dev-Manager-Token':token}:{})},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  assert.equal((await post('/api/bitbucket/check',{connect:false},false)).status,403,'checking needs the session token');
  assert.equal((await post('/api/bitbucket/fix',{action:'sshConfig',apply:true},false)).status,403,'a fix needs the session token');
  assert.deepEqual((await (await fetch(base+'/api/bitbucket')).json()).check,null,'nothing runs before the first click');

  const first=(await post('/api/bitbucket/check',{connect:false})).body.check;
  assert.equal(first.repos,3,'three repositories, the one inside node_modules skipped');assert.equal(first.https,1);assert.equal(first.hostKey,false);
  assert.deepEqual(first.hosts.map(h=>[h.host,h.resolved,h.verdict,h.remotes.length,h.test]),[['bb-alias','bitbucket.org','alias',1,null],['bitbucket.org','bitbucket.org','direct',1,null]],'github is left out');
  assert.deepEqual(first.hardcoded.map(f=>path.relative(HOME,f)),[path.join('deploy','deploy.sh')]);
  assert.equal(first.fixes,3);assert.equal(first.ready,false);

  // ~/.ssh/config: the preview names the one line; applying it keeps a backup of the original.
  const preview=(await post('/api/bitbucket/fix',{action:'sshConfig'})).body.result;
  assert.deepEqual(preview.changes,[{line:2,before:'  HostName bitbucket.org',after:'  HostName ssh.bitbucket.org'}]);
  assert.equal(fs.readFileSync(path.join(SSH,'config'),'utf8'),CONFIG,'a preview writes nothing');
  const applied=(await post('/api/bitbucket/fix',{action:'sshConfig',apply:true})).body.result;
  assert.equal(applied.done,true);assert.equal(fs.readFileSync(applied.backup,'utf8'),CONFIG,'backup holds the original');
  assert.equal(fs.readFileSync(path.join(SSH,'config'),'utf8'),CONFIG.replace('HostName bitbucket.org','HostName ssh.bitbucket.org'));

  // Remotes: only the one that named bitbucket.org itself, whatever the request lists.
  const remotes=(await post('/api/bitbucket/fix',{action:'remotes',items:[{repo:'/etc',remote:'x'}]})).body.result;
  assert.deepEqual(remotes.items.map(r=>[path.basename(r.repo),r.remote,r.url,r.next]),[['direct-app','origin','git@bitbucket.org:team/direct-app.git','git@ssh.bitbucket.org:team/direct-app.git']]);
  const moved=(await post('/api/bitbucket/fix',{action:'remotes',apply:true})).body.result;
  assert.ok(moved.items.every(r=>r.ok));
  const dir=path.join(HOME,'Projects','direct-app');
  assert.equal(execFileSync('git',['-C',dir,'remote','get-url','origin']).toString().trim(),'git@ssh.bitbucket.org:team/direct-app.git');
  assert.equal(execFileSync('git',['-C',dir,'remote','get-url','mirror']).toString().trim(),'https://bitbucket.org/team/direct-app.git','HTTPS remotes stay');
  assert.ok(fs.readdirSync(path.join(dir,'.git')).some(f=>f.startsWith('config.bak-')),'the repository config was backed up');

  const second=(await post('/api/bitbucket/check',{connect:false})).body.check;
  assert.deepEqual(second.hosts.map(h=>[h.host,h.resolved,h.verdict]),[['bb-alias','ssh.bitbucket.org','ok'],['ssh.bitbucket.org','ssh.bitbucket.org','ok']]);
  assert.equal(second.fixes,1,'only the host key is left');
  assert.equal((await post('/api/bitbucket/fix',{action:'nope'})).status,400);
  // The bundled script for servers is served as plain text.
  const script=await fetch(base+'/tools/bitbucket-ssh-check.sh');assert.equal(script.status,200);assert.match(script.headers.get('content-type'),/^text\/plain/);assert.match(await script.text(),/ssh\.bitbucket\.org/);
 }finally{await new Promise(r=>server.close(r));}
});
