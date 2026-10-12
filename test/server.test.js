'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {validProject,authorization,startServer}=require('../server');
test('accept valid compose project',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ddm-'));try{fs.writeFileSync(path.join(dir,'compose.yaml'),'services: {}');const p=validProject({name:'test_api',directory:dir,composeFile:'compose.yaml'});assert.equal(p.name,'test_api');}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('reject invalid project names and traversal',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ddm-'));try{fs.writeFileSync(path.join(dir,'compose.yaml'),'x');assert.throws(()=>validProject({name:'../foo',directory:dir,composeFile:'compose.yaml'}));assert.throws(()=>validProject({name:'foo',directory:dir,composeFile:'../outside.yml'}));}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('host and token requirement',()=>{assert.equal(authorization({method:'GET',headers:{host:'attacker.com'}}),false);assert.equal(authorization({method:'POST',headers:{host:'localhost:4173'}}),false);assert.equal(authorization({method:'GET',headers:{host:'localhost:4173'}}),true);});
test('local http serves UI',async()=>{const server=startServer(0);await new Promise(resolve=>server.once('listening',resolve));try{const addr=server.address();const res=await fetch(`http://127.0.0.1:${addr.port}/`);assert.equal(res.status,200);assert.match(await res.text(),/Development workspace/);}finally{await new Promise(resolve=>server.close(resolve));}});
const {discoverFromInspect}=require('../server');
test('discovers Compose apps and groups containers without modifying them',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ddm-discover-'));
 try{
  const f=path.join(dir,'compose.yaml');fs.writeFileSync(f,'services: {}');
  const labels={'com.docker.compose.project':'sample','com.docker.compose.service':'web','com.docker.compose.project.working_dir':dir,'com.docker.compose.project.config_files':f};
  const groups=discoverFromInspect([{Name:'/sample-web-1',Id:'1234567890ab',State:{Status:'running'},Config:{Labels:labels}}, {Name:'/other',State:{Status:'exited'},Config:{Labels:{}}}],[]);
  assert.equal(groups.length,1);assert.equal(groups[0].name,'sample');assert.equal(groups[0].importable,true);assert.equal(groups[0].composeFile,'compose.yaml');assert.equal(groups[0].running,1);
  assert.equal(discoverFromInspect([{Config:{Labels:labels}}],[{name:'sample'}])[0].importable,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('unverified or multiple Compose files are not importable',()=>{
 const d=discoverFromInspect([{Name:'/api',State:{Status:'running'},Config:{Labels:{'com.docker.compose.project':'multi','com.docker.compose.project.working_dir':'/tmp','com.docker.compose.project.config_files':'/tmp/one.yml,/tmp/two.yml'}}}],[]);
 assert.equal(d[0].importable,false);assert.equal(d[0].total,1);
});
