'use strict';
const $=id=>document.getElementById(id);
let token='',projects=[],groups=[],workspace={keepRunning:[],language:''},resources=null,editing=null,filter='all',busy=new Set(),logProject=null,rawLogs='',lastRefresh=0;
let loaded=false,dockerState=null,lastPorts=null,lastDisk=null,advice=null;
const selectedStops=new Set();
const ERROR_LINE=/\b(error|err|fatal|exception|panic|critical|crit|fail(ed|ure)?|denied|refused|killed|oom|traceback|uncaught)\b/i;

// ---- i18n: every visible string comes from public/locales/<lang>.json ----
let DICTS={vi:{},en:{}};
const missingKeys=new Set();
let I=I18N.create(DICTS,I18N.FALLBACK);
const t=(key,params)=>I.t(key,params),tr=message=>I.render(message);
const STATUS_KEYS={running:'status.running',partial:'status.partial',stopped:'status.stopped',error:'status.error',unknown:'status.unknown'};
const ACTION_KEYS={start:'action.start',stop:'action.stop',restart:'action.restart',up:'action.up',down:'action.down'};
const VERB_KEYS={start:'verb.start',stop:'verb.stop',restart:'verb.restart',up:'verb.up',down:'verb.down'};
const JOB_KEYS={pending:['…','job.pending'],running:['⟳','job.running'],done:['✓','job.done'],failed:['✕','job.failed'],skipped:['–','job.skipped'],cancelled:['–','job.cancelled']};
const DOCKER_STATE_KEYS={running:'dockerState.running',exited:'dockerState.exited',created:'dockerState.created',restarting:'dockerState.restarting',paused:'dockerState.paused',dead:'dockerState.dead',removing:'dockerState.removing'};
const PRESSURE_KEYS={normal:'pressure.normal',warning:'pressure.warning',critical:'pressure.critical'};
const RISK={safe:['disk.risk.safe','risksafe'],review:['disk.risk.review','riskreview'],data:['disk.risk.data','riskdata']};
const stateText=s=>DOCKER_STATE_KEYS[s]?t(DOCKER_STATE_KEYS[s]):s;
const LANGUAGE_KEY='ddm.language';
function storedLanguage(){try{return localStorage.getItem(LANGUAGE_KEY)||'';}catch{return '';}}
// Translations may mark code with backticks; it is rendered as <code>, never as HTML.
function renderRich(node,text){node.replaceChildren(...String(text).split(/`([^`]+)`/).map((part,i)=>i%2?el('code','',part):document.createTextNode(part)));}
function applyStatic(){
 document.documentElement.lang=I.lang;
 document.querySelectorAll('[data-i18n]').forEach(n=>{if(n.tagName==='TITLE')document.title=t(n.dataset.i18n);else renderRich(n,t(n.dataset.i18n));});
 document.querySelectorAll('[data-i18n-placeholder]').forEach(n=>{n.placeholder=t(n.dataset.i18nPlaceholder);});
 document.querySelectorAll('[data-i18n-aria-label]').forEach(n=>n.setAttribute('aria-label',t(n.dataset.i18nAriaLabel)));
 document.querySelectorAll('[data-i18n-title]').forEach(n=>{n.title=t(n.dataset.i18nTitle);});
 document.querySelectorAll('[data-lang]').forEach(b=>{b.classList.toggle('selected',b.dataset.lang===I.lang);b.setAttribute('aria-pressed',String(b.dataset.lang===I.lang));});
}
// Re-renders from data already in memory: switching language never refetches or touches Docker.
function rerender(){
 if(!loaded)return;
 renderEngine();updateCounters();renderGroups();renderProjects();
 if(resources){renderSuggestions();renderStats();}else updateStopSelected();
 if(lastPorts)renderPortsData();if(lastDisk)renderDisk(lastDisk);if(advice)renderAdvisor();renderHealthTile();
}
// The choice lives in the config file (survives restarts, upgrades and other URLs such as a local
// proxy domain) and in localStorage only to paint the first frame in the right language.
async function setLanguage(lang,persist=true){
 lang=I18N.valid(lang)?lang:I18N.FALLBACK;
 I=I18N.create(DICTS,lang,key=>{if(!missingKeys.has(key)){missingKeys.add(key);console.warn('Missing translation:',key);}});
 try{localStorage.setItem(LANGUAGE_KEY,lang);}catch{}
 applyStatic();rerender();
 if(persist&&token&&workspace.language!==lang){try{workspace=await api('/api/workspace','PUT',{...workspace,language:lang});}catch(e){toast(e.message);}}
}

async function api(url,method='GET',data){
 const response=await fetch(url,{method,headers:{...(method==='GET'?{}:{'Content-Type':'application/json','X-Dev-Manager-Token':token})},body:data===undefined?undefined:JSON.stringify(data)});
 let result;try{result=await response.json();}catch{throw Error(t('error.invalidResponse'));}
 if(!response.ok)throw Error(result.message?tr(result.message):result.error||`HTTP ${response.status}`);return result;
}
function toast(message){$('toast').textContent=message;$('toast').classList.remove('hidden');setTimeout(()=>$('toast').classList.add('hidden'),4500);}
function alertMessage(message){$('alert').textContent=message;$('alert').classList.remove('hidden');}
function el(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;}
function button(text,cls,fn,disabled=false,title=''){const b=el('button','btn '+cls,text);b.type='button';b.disabled=disabled;if(title)b.title=title;b.addEventListener('click',fn);return b;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function fmtBytes(n){if(!(n>0))return '0 B';const u=['B','KiB','MiB','GiB','TiB'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++;}return `${n>=100||!i?Math.round(n):n.toFixed(1)} ${u[i]}`;}
function fmtDisk(n){if(!(n>0))return '0 B';const u=['B','kB','MB','GB','TB'];let i=0;while(n>=1000&&i<u.length-1){n/=1000;i++;}return `${n>=100||!i?Math.round(n):n.toFixed(1)} ${u[i]}`;}
function fmtSince(iso){const s=(Date.now()-Date.parse(iso))/1000;if(!iso||!(s>=0))return '—';if(s<3600)return t('time.minutes',{count:Math.max(1,Math.round(s/60))});if(s<172800)return t('time.hours',{count:Math.round(s/3600)});return t('time.days',{count:Math.round(s/86400)});}
function copy(text){(navigator.clipboard?navigator.clipboard.writeText(text):Promise.reject()).then(()=>toast(t('toast.copied',{text:text.slice(0,120)})),()=>prompt(t('prompt.copy'),text));}
const byName=name=>projects.find(p=>p.name===name);
const usageOf=name=>resources?.projects.find(r=>r.name===name);
const hasProblem=p=>p.issues.some(i=>i.level==='error'||i.level==='warn');

async function refresh(){
 lastRefresh=Date.now();
 try{const data=await api('/api/state');projects=data.projects;groups=data.groups||[];workspace=data.workspace;dockerState=data.docker;loaded=true;$('alert').classList.add('hidden');
 renderEngine();updateCounters();renderGroups();renderProjects();}catch(e){alertMessage(e.message);}
}
function renderEngine(){
 if(!dockerState)return;const online=dockerState.available;
 $('dockerDot').classList.toggle('ok',online);$('dockerLabel').textContent=t(online?'engine.onlineLabel':'engine.offlineLabel');
 if(!online)alertMessage(dockerState.error?t('engine.offlineAlertDetail',{detail:dockerState.error.split('\n')[0]}):t('engine.offlineAlert'));
 renderHealthTile();
}
// Stat tiles follow one contract: label, value, optional meter, then status (icon + words, never colour alone) and context.
const STATUS_ICON={good:'●',fair:'▲',poor:'✕',normal:'●',warning:'▲',critical:'✕'};
function setStatus(node,level,text){node.className='status '+level;node.replaceChildren(el('i','',STATUS_ICON[level]||'●'),document.createTextNode(text));}
function setMeter(node,ratio,severity){const pct=Math.max(0,Math.min(100,Math.round(ratio*100)));node.className='meter '+severity;node.firstChild.style.width=pct+'%';node.setAttribute('aria-valuenow',String(pct));}
function setValue(node,main,unit){node.replaceChildren(document.createTextNode(String(main)),...(unit?[el('small','',unit)]:[]));}
function renderHealthTile(){
 const status=$('healthStatus');
 if(dockerState&&!dockerState.available){setValue($('healthValue'),0,'/100');setStatus(status,'poor',t('metric.engineOffline'));$('healthSub').textContent=t('engine.startDesktop');return;}
 if(!advice){status.replaceChildren();return;}
 const h=advice.health;setValue($('healthValue'),h.score,'/100');setStatus(status,h.grade,t(GRADE_KEYS[h.grade]));
 $('healthSub').textContent=[h.findings.length?t('advisor.sumProblems',{count:h.findings.length}):t('advisor.sumHealthy'),dockerState?.version?t('engine.version',{version:dockerState.version}):''].filter(Boolean).join(' · ');
 const disk=advice.waste.filter(w=>w.kind==='disk'),review=disk.filter(w=>w.risk==='review'||w.risk==='data').reduce((n,w)=>n+w.diskBytes,0);
 if(advice.diskPending&&!disk.length){setValue($('reclaimValue'),'…');$('reclaimSub').textContent=t('advisor.diskPending');}
 else{setValue($('reclaimValue'),advice.totals.diskBytes?'≈ '+fmtDisk(advice.totals.diskBytes):'0 B');
  $('reclaimSub').textContent=[advice.totals.diskBytes?t('metric.reclaimSafe'):t('metric.reclaimNone'),review?t('metric.reclaimReview',{size:fmtDisk(review)}):''].filter(Boolean).join(' · ');}
}
async function scanDocker(){await refresh();toast(t('toast.scanned',{count:projects.filter(p=>p.total).length}));}
function updateCounters(){
 if(!loaded)return;
 const running=projects.filter(p=>p.running>0);
 const containers=running.reduce((n,p)=>n+p.running,0),attention=projects.filter(hasProblem).length;
 setValue($('runningCount'),running.length,` / ${projects.length}`);
 $('containerCount').textContent=attention?t('metric.runningAttention',{containers,count:attention}):t('metric.containersRunning',{count:containers});
 $('allCount').textContent=projects.length;$('runningChip').textContent=running.length;$('issuesCount').textContent=projects.filter(hasProblem).length;
 $('managedCount').textContent=projects.filter(p=>p.managed).length;$('discoveredCount').textContent=projects.filter(p=>!p.managed).length;
 if(resources)renderOverview();
}
// Both memory tiles express CPU in cores so the Docker share and the whole Mac compare directly.
function renderOverview(){
 const vm=resources.vm,tot=resources.totals,host=resources.host,cores=vm.ncpu||host?.cores||'?';
 setValue($('memoryUsed'),fmtBytes(tot.memBytes));
 const share=vm.memTotal?tot.memBytes/vm.memTotal:0;setMeter($('vmMeter'),share,share>=.9?'danger':share>=.7?'warning':'accent');
 $('memoryOf').textContent=[vm.memTotal?t('metric.ofVm',{total:fmtBytes(vm.memTotal),pct:Math.round(share*100)}):t('metric.dockerVm'),t('metric.cpuCores',{used:(tot.cpuPercent/100).toFixed(1),total:cores})].join(' · ');
 const top=[...resources.projects].sort((a,b)=>b.memBytes-a.memBytes)[0];
 $('topConsumer').textContent=top?.memBytes?t('metric.topConsumer',{project:top.name,size:fmtBytes(top.memBytes)}):'';
 const card=$('hostMetric');
 if(!host){setValue($('hostMem'),'—');$('hostMemOf').textContent=t('metric.hostUnavailable');$('hostCpu').textContent='';$('hostPressure').replaceChildren();card.title='';return;}
 const m=host.memory,level=PRESSURE_KEYS[m.pressure]?m.pressure:'',known=host.cpuPercent!=null;
 setValue($('hostMem'),fmtBytes(m.used));
 // macOS compresses and swaps before RAM looks full, so the meter's colour follows memory pressure, not the percentage.
 setMeter($('hostMeter'),m.total?m.used/m.total:0,level==='critical'?'danger':level==='warning'?'warning':'accent');
 if(level)setStatus($('hostPressure'),level,t('metric.pressureStatus',{level:t(PRESSURE_KEYS[level])}));else $('hostPressure').replaceChildren();
 // Heavy swapping is the cause behind a pressure warning, so it takes the same colour.
 $('hostMemOf').textContent=[t('metric.ofHost',{total:fmtBytes(m.total)}),m.swap.used?t('metric.swap',{size:fmtBytes(m.swap.used)}):''].filter(Boolean).join(' · ');$('hostMemOf').className=level==='critical'?'textdanger':level==='warning'?'textwarning':'';
 $('hostCpu').textContent=t('metric.hostCpu',{pct:known?host.cpuPercent:'—',used:known?(host.cpuPercent*host.cores/100).toFixed(1):'—',total:host.cores});
 card.title=[t('metric.hostTitle',{cache:fmtBytes(m.cached),window:host.cpuWindowSec}),m.pressure&&m.pressure!=='normal'?t('metric.hostPressureTitle',{level:t(PRESSURE_KEYS[m.pressure])}):''].filter(Boolean).join(' ');
}
function renderProjects(){
 if(!loaded)return;
 const grid=$('projectGrid');grid.replaceChildren();const q=$('search').value.trim().toLowerCase();
 const all=[...projects].sort((a,b)=>Number(b.running>0)-Number(a.running>0)||a.name.localeCompare(b.name));
 const filtered=all.filter(p=>[p.name,p.description,p.directory,...p.sources.map(s=>s.directory),...p.containers.map(c=>c.service)].join(' ').toLowerCase().includes(q))
 .filter(p=>filter==='all'||(filter==='managed'&&p.managed)||(filter==='discovered'&&!p.managed)||(filter==='running'&&p.running>0)||(filter==='issues'&&hasProblem(p)));
 if(!filtered.length){const empty=el('div','empty');empty.append(el('h3','',t(all.length?'projects.noMatchesTitle':'projects.emptyTitle')),el('p','',t(all.length?'projects.noMatchesHint':'projects.emptyHint')));grid.append(empty);return;}
 for(const p of filtered)grid.append(projectCard(p));
}
function projectCard(p){
 const card=el('article','project'+(p.issues.some(i=>i.level==='error')?' attention':''));
 const head=el('div','projtitle');head.append(el('span','projicon','▣'),el('h3','',p.name),el('span','pill '+p.status,t(STATUS_KEYS[p.status]||'status.unknown')));card.append(head);
 const badges=el('div','badgerow');badges.append(el('span','typebadge '+(p.managed?'ismanaged':'isdiscovered'),(p.managed?'● ':'◌ ')+t(p.managed?'card.managed':'card.discovered')),el('span','smalltext',t('card.runningOf',{running:p.running,total:p.total})));
 const usage=usageOf(p.name);if(usage)badges.append(el('span','smalltext',t('metric.ram',{size:fmtBytes(usage.memBytes)})));
 if(p.sources.length>1)badges.append(el('span','typebadge warnbadge',t('card.sources',{count:p.sources.length})));
 if(workspace.keepRunning.includes(p.name))badges.append(el('span','typebadge ismanaged','★ '+t('card.keepRunning')));
 card.append(badges,el('p','projdesc',p.description||t(p.managed?'card.descManaged':'card.descDiscovered')));
 card.append(el('div','path',p.directory?`${p.directory}${p.composeFile?' / '+p.composeFile:''}`:p.sources.length>1?t('card.workingDirs',{count:p.sources.length}):t('card.pathUnavailable')));
 if(p.issues.length){const box=el('div','issues');p.issues.slice(0,3).forEach(i=>box.append(issueLine(p,i)));if(p.issues.length>3)box.append(button(t('card.moreIssues',{count:p.issues.length-3}),'link',()=>inspectProject(p)));card.append(box);}
 const services=el('div','services');p.containers.filter(c=>!c.oneoff).slice(0,6).forEach(c=>{const chip=el('span','servicechip',c.service||c.name);chip.prepend(el('i',c.state==='running'?'live':c.state==='restarting'?'bad':''));services.append(chip);});
 if(p.total>6)services.append(el('span','smalltext',t('common.more',{count:p.total-6})));card.append(services);
 const a=el('div','actions'),blocked=busy.has(p.name);
 if(!p.total&&p.managed)a.append(button('⇡ '+t('action.up'),'primary',()=>act('up',[p.name]),blocked,t('card.upTitle')));
 else a.append(button('▶ '+t('action.start'),'primary',()=>act('start',[p.name]),blocked||!p.total||p.running===p.total,t('card.startTitle')));
 a.append(button('■ '+t('action.stop'),'secondary',()=>act('stop',[p.name]),blocked||!p.running),button('↻ '+t('action.restart'),'secondary',()=>act('restart',[p.name]),blocked||!p.running));
 a.append(button('≡ '+t('action.logs'),'secondary',()=>openLogs(p.name),!p.total),button('ⓘ '+t('action.details'),'subtle',()=>inspectProject(p)));
 card.append(a);return card;
}
function issueLine(p,i){
 const row=el('div','issue '+i.level);row.title=tr(i.hint);
 row.append(el('span','issuetext',tr(i.text)));
 if(i.service&&p.containers.some(c=>c.service===i.service))row.append(button(t('action.log'),'link',()=>openLogs(p.name,i.service)));
 return row;
}

// Every action goes through a server-side preflight. A clean single-project action runs at once;
// anything with warnings, errors, several projects, Up or Down is shown for review first.
async function act(action,names,{title,review=false}={}){
 if(!names.length)return;
 let plan;try{plan=await api('/api/plan','POST',{action,projects:names});}catch(e){return alertMessage(e.message);}
 const only=plan.items[0];
 if(!review&&names.length===1&&plan.items.length===1&&!['up','down'].includes(action)&&!only.warnings.length&&!only.errors.length){
  if(only.skip)return toast(`${names[0]}: ${tr(only.info)}`);
  return runSingle(action,names[0]);
 }
 showPlan(plan,title||(names.length===1?t('plan.titleOne',{action:t(ACTION_KEYS[action]),project:names[0]}):t('plan.titleMany',{action:t(ACTION_KEYS[action]),count:names.length})));
}
async function runSingle(action,name,body){
 busy.add(name);renderProjects();
 try{const data=await api(`/api/projects/${encodeURIComponent(name)}/${action}`,'POST',body||{});const last=data.output?.trim().split('\n').pop()||'',verb=t(VERB_KEYS[action]);
  toast(last?t('toast.doneOutput',{project:name,action:verb,output:last.slice(0,100)}):t('toast.done',{project:name,action:verb}));}
 catch(e){alertMessage(`${name}: ${e.message}`);}
 finally{busy.delete(name);await refresh();refreshResources();loadAdvisor();}
}
function showPlan(plan,title){
 const content=$('planContent'),run=$('planRun'),cancel=$('planCancel'),checks=new Map();content.replaceChildren();
 $('planTitle').textContent=title;$('planSummary').textContent=t(plan.items.length>1?'plan.summaryMany':'plan.summaryOne');
 for(const item of plan.items){
  const row=el('div','planitem'+(item.related?' related':'')),head=el('label','planhead'),cb=document.createElement('input');
  cb.type='checkbox';cb.checked=!item.related&&!item.errors.length&&!item.skip&&!item.protect;cb.disabled=!!item.errors.length||item.skip;cb.addEventListener('change',update);checks.set(item.project,cb);
  const what=item.skip?tr(item.info):item.errors.length?t('plan.blocked'):item.containers.length?t('plan.affects',{verb:t(VERB_KEYS[plan.action]),count:item.containers.length,containers:item.containers}):'';
  head.append(cb,el('strong','',item.project),el('span','smalltext',what));row.append(head);
  if(item.related)row.append(el('div','planreason',t('plan.notSelected',{reason:tr(item.reason)})));
  item.errors.forEach(e=>row.append(el('div','issue error',tr(e))));item.warnings.forEach(w=>row.append(el('div','issue warn',tr(w))));
  content.append(row);
 }
 const selected=()=>plan.order.filter(n=>checks.get(n)?.checked);
 function update(){const n=selected().length;run.disabled=!n;run.textContent=n?t('plan.runN',{action:t(ACTION_KEYS[plan.action]),count:n}):t('plan.nothing');}
 update();run.hidden=false;run.className='btn '+(plan.action==='down'?'danger':'primary');cancel.disabled=false;cancel.textContent=t('common.cancel');
 cancel.onclick=()=>$('planDialog').close();$('planClose').onclick=()=>$('planDialog').close();
 run.onclick=()=>{const names=selected();if(!names.length)return;
  if(['up','down'].includes(plan.action)){$('planDialog').close();return runSingle(plan.action,names[0],plan.action==='down'?{confirm:`down ${names[0]}`}:{});}
  runBatch(plan.action,names);};
 $('planDialog').showModal();
}
async function runBatch(action,names){
 const content=$('planContent'),run=$('planRun'),cancel=$('planCancel');
 let job;try{job=(await api('/api/batch','POST',{action,projects:names})).job;}catch(e){return alertMessage(e.message);}
 names.forEach(n=>busy.add(n));renderProjects();run.hidden=true;$('planSummary').textContent=t('plan.running');
 cancel.textContent=t('plan.cancelRemaining');cancel.onclick=async()=>{try{await api(`/api/jobs/${job.id}/cancel`,'POST',{});cancel.disabled=true;cancel.textContent=t('plan.cancelling');}catch(e){toast(e.message);}};
 for(;;){
  content.replaceChildren(...job.items.map(i=>{const row=el('div','planitem'),head=el('div','planhead'),[icon,key]=JOB_KEYS[i.status];head.append(el('span','jobstatus '+i.status,`${icon} ${t(key)}`),el('strong','',i.project));row.append(head);
   if(i.error)row.append(el('div','issue error',tr(i.error)));else if(i.info)row.append(el('div','planreason',tr(i.info)));else if(i.output)row.append(el('pre','joboutput',i.output.split('\n').slice(-4).join('\n')));return row;}));
  if(job.state!=='running')break;
  await sleep(800);try{job=(await api(`/api/jobs/${job.id}`)).job;}catch(e){toast(e.message);break;}
 }
 names.forEach(n=>busy.delete(n));
 const count=s=>job.items.filter(i=>i.status===s).length;
 $('planSummary').textContent=t('plan.result',{done:count('done'),failed:count('failed'),skipped:count('skipped')+count('cancelled')});
 cancel.disabled=false;cancel.textContent=t('common.close');cancel.onclick=()=>$('planDialog').close();
 await refresh();refreshResources();loadAdvisor();
}

async function importProject(p){
 if(!p.importable)return;
 try{await api('/api/projects','POST',{name:p.name,directory:p.directory,composeFile:p.composeFile,description:t('import.description')});$('inspectDialog').close();toast(t('toast.imported',{project:p.name}));await refresh();}
 catch(e){alertMessage(`${p.name}: ${e.message}`);}
}
async function saveWorkspace(next){try{workspace=await api('/api/workspace','PUT',{...next,language:I.lang});renderGroups();renderProjects();refreshResources();return true;}catch(e){toast(e.message);return false;}}
async function toggleKeep(name){const keep=new Set(workspace.keepRunning);if(keep.has(name))keep.delete(name);else keep.add(name);if(await saveWorkspace({...workspace,keepRunning:[...keep]})){const p=byName(name);if(p)inspectProject(p);}}
async function openIn(p,app,directory){try{await api(`/api/projects/${encodeURIComponent(p.name)}/open`,'POST',{app,directory});}catch(e){toast(e.message);}}
function inspectProject(p){
 const dialog=$('inspectDialog'),close=()=>dialog.close();$('inspectTitle').textContent=p.name;
 const actions=$('inspectActions');actions.replaceChildren();
 if(p.importable&&!p.managed)actions.append(button('＋ '+t('action.import'),'primary',()=>importProject(p),false,t('details.importTitle')));
 if(p.managed)actions.append(button('⇡ '+t('action.up'),'secondary',()=>{close();act('up',[p.name]);},busy.has(p.name)||!p.composeFileOk),button('⚙ '+t('action.edit'),'subtle',()=>{close();openProject(p);}),button('⋯ '+t('action.down'),'danger',()=>{close();act('down',[p.name]);},busy.has(p.name)||!p.total||!p.composeFileOk));
 const kept=workspace.keepRunning.includes(p.name);
 actions.append(button((kept?'☆ ':'★ ')+t(kept?'action.unkeep':'action.keep'),'subtle',()=>toggleKeep(p.name),false,t('details.keepTitle')));
 const dirs=[...new Set([p.directory,...p.sources.map(s=>s.directory)].filter(Boolean))];
 // Application names are product names and stay as they are in every language.
 if(dirs.length)[['finder','⌂ Finder'],['terminal','› Terminal'],['vscode','✎ VS Code']].forEach(([app,label])=>actions.append(button(label,'subtle',()=>openIn(p,app,dirs[0]),false,t('details.openTitle',{path:dirs[0]}))));
 const target=$('inspectContent');target.replaceChildren();
 const makeRow=(key,value)=>{const row=el('div','detailrow');row.append(el('strong','',key),el('span','',String(value||'—')));target.append(row);};
 makeRow(t('details.status'),[t('details.statusValue',{status:t(STATUS_KEYS[p.status]||'status.unknown'),running:p.running,total:p.total}),p.oneoffs?t('details.oneoffs',{count:p.oneoffs}):''].filter(Boolean).join(' · '));
 if(p.managed)makeRow(t('details.registered'),`${p.directory} / ${p.composeFile}${p.composeFileOk?'':' '+t('details.missing')}`);
 p.sources.forEach((s,i)=>makeRow(p.sources.length>1?t('details.source',{index:i+1,count:s.containers}):t('details.deployedFrom'),`${s.directory||t('common.unknownDir')}\n${s.files.join('\n')||t('details.noFileLabel')}`));
 if(!p.managed&&!p.importable&&p.reason)makeRow(t('details.import'),tr(p.reason));
 if(p.dependsOn.length)makeRow(t('details.needs'),p.dependsOn.map(d=>t('details.linkValue',{project:d.project,state:t(d.running?'details.linkRunning':'details.linkNotRunning'),networks:d.networks})).join('\n'));
 if(p.usedBy.length)makeRow(t('details.usedBy'),p.usedBy.map(u=>t('details.linkValue',{project:u.project,state:t(u.running?'details.linkRunning':'details.linkStopped'),networks:u.networks})).join('\n'));
 if(p.issues.length){target.append(el('h4','detailhead',t('details.attention')));p.issues.forEach(i=>{const row=issueLine(p,i);row.append(el('div','issuehint',tr(i.hint)));target.append(row);});}
 if(p.containers.length){
  target.append(el('h4','detailhead',t('details.containers')));
  const wrap=el('div','tablewrap'),table=el('table'),head=el('tr');['col.service','col.state','col.exit','col.restarts','col.health','col.ports','col.limits'].forEach(k=>head.append(el('th','',t(k))));head.append(el('th'));
  const tbody=el('tbody');
  for(const c of p.containers){
   const tr_=el('tr');
   [`${c.service||c.name}${c.oneoff?' '+t('details.oneoffTag'):''}`,c.state==='running'?t('details.runningFor',{time:fmtSince(c.startedAt)}):c.finishedAt?t('details.stateAgo',{state:stateText(c.state),time:fmtSince(c.finishedAt)}):stateText(c.state),c.state==='running'?'—':String(c.exitCode)+(c.oomKilled?' OOM':''),String(c.restartCount),c.health||'—',
    c.ports.map(b=>`${b.ip==='0.0.0.0'?'':b.ip+':'}${b.port}→${b.target}`).join(' ')||'—',[c.memLimit?'RAM '+fmtBytes(c.memLimit):'',c.nanoCpus?`CPU ${c.nanoCpus/1e9}`:''].filter(Boolean).join(' · ')||t('details.noLimit')].forEach(v=>tr_.append(el('td','',v)));
   const td=el('td');if(c.service)td.append(button(t('action.log'),'link',()=>openLogs(p.name,c.service)));tr_.append(td);tbody.append(tr_);
  }
  table.append(el('thead'),tbody);table.firstChild.append(head);wrap.append(table);target.append(wrap);
  target.append(el('p','footnote',t('details.limitsFootnote')));
 }
 target.append(el('h4','detailhead',t('details.terminal')));
 for(const c of p.commands){const row=el('div','cmdrow');row.append(el('span','smalltext',tr(c.label)),el('code','',c.command),button('⧉','mini',()=>copy(c.command),false,t('common.copy')));target.append(row);}
 if(!dialog.open)dialog.showModal();
}
function openProject(p){editing=p?.name||null;$('dialogTitle').textContent=editing?t('form.editTitle',{project:editing}):t('form.addTitle');const f=$('projectForm');f.reset();for(const field of ['name','directory','composeFile','description'])if(p)f.elements[field].value=p[field]||'';f.elements.name.disabled=!!editing;$('projectDialog').showModal();}
$('projectForm').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;const data=Object.fromEntries(new FormData(f));if(editing)data.name=editing;try{await api(editing?`/api/projects/${encodeURIComponent(editing)}`:'/api/projects',editing?'PUT':'POST',data);$('projectDialog').close();toast(t('toast.saved'));await refresh();}catch(e){toast(e.message);}});

// Groups are derived by the server from shared Docker networks: an app and the projects it needs.
function renderGroups(){
 if(!loaded)return;
 const list=$('groupList');list.replaceChildren();
 if(!groups.length){list.append(el('span','smalltext',t('groups.empty')));return;}
 for(const g of groups){
  const members=g.projects.filter(byName),running=members.filter(n=>byName(n).running>0),needs=g.projects.filter(n=>n!==g.name);
  const chip=el('div','groupchip');chip.append(el('strong','',g.name),el('span','smalltext',`${t('groups.with',{projects:needs})} · ${t('groups.runningOf',{running:running.length,total:g.projects.length})}`));
  chip.append(button('▶','mini',()=>act('start',members,{title:t('groups.startPlan',{group:g.name}),review:true}),running.length===members.length,t('groups.startTitle')),button('■','mini',()=>act('stop',running,{title:t('groups.stopPlan',{group:g.name}),review:true}),!running.length,t('groups.stopTitle')));
  list.append(chip);
 }
}

async function refreshResources(){
 try{resources=await api('/api/resources');}catch(e){resources=null;return renderSuggestions(e.message);}
 updateCounters();renderSuggestions();renderStats();renderProjects();
}
function messageRow(tbody,text,cols){const row=el('tr'),td=el('td','',text);td.colSpan=cols;row.append(td);tbody.replaceChildren(row);}
function renderSuggestions(error){
 const tbody=$('suggestRows');
 if(error)return messageRow(tbody,error,6);
 if(!resources)return;
 const vm=resources.vm,total=resources.totals.memBytes;
 $('vmLine').textContent=vm.memTotal?t('resources.vmLine',{used:fmtBytes(total),total:fmtBytes(vm.memTotal),pct:Math.round(total/vm.memTotal*100),cpus:vm.ncpu}):t('resources.lead');
 for(const n of [...selectedStops])if(!resources.projects.some(r=>r.name===n&&!r.keepRunning))selectedStops.delete(n);
 updateStopSelected();
 if(!resources.projects.length)return messageRow(tbody,t('resources.noRunning'),6);
 tbody.replaceChildren(...resources.projects.map(r=>{
  const row=el('tr',r.crashLoop?'crashrow':''),check=el('td','checkcol'),cb=document.createElement('input');
  cb.type='checkbox';cb.disabled=r.keepRunning;cb.checked=selectedStops.has(r.name);cb.title=t(r.keepRunning?'resources.keepTitle':'resources.selectTitle');
  cb.onchange=()=>{if(cb.checked)selectedStops.add(r.name);else selectedStops.delete(r.name);updateStopSelected();};check.append(cb);
  const notes=el('td','notes');notes.append(el('span','',r.notes.map(tr).join(' ')||'—'));
  row.append(check,el('td','',r.name),el('td','',fmtBytes(r.memBytes)),el('td','',r.cpuPercent.toFixed(1)+'%'),el('td','',fmtSince(r.since)),notes);return row;
 }));
}
function updateStopSelected(){const n=selectedStops.size;$('stopSelected').disabled=!n;$('stopSelected').textContent='■ '+(n?t('resources.stopN',{count:n}):t('resources.stopSelected'));}
function renderStats(){
 const tbody=$('statsRows');if(!resources.containers.length)return messageRow(tbody,t('resources.noContainers'),6);
 tbody.replaceChildren(...[...resources.containers].sort((a,b)=>b.cpuPercent-a.cpuPercent).map(c=>{const row=el('tr');[c.name,c.project||t('common.standalone'),c.cpu,c.memory,c.memoryPercent,c.netIO].forEach(v=>row.append(el('td','',v||'—')));return row;}));
}

// ---- Health & resource advisor: three answers, each item with its cause, gain, risk and one action ----
const RULE_KEYS={engine:'advisor.rule.engine',crashloop:'advisor.rule.crashloop',oomLive:'advisor.rule.oomLive',unhealthy:'advisor.rule.unhealthy',startFailed:'advisor.rule.startFailed',memoryNearLimit:'advisor.rule.memoryNearLimit',portConflict:'advisor.rule.portConflict',missingNetwork:'advisor.rule.missingNetwork',partialDown:'advisor.rule.partialDown',oomPast:'advisor.rule.oomPast',hostPressureCritical:'advisor.rule.hostPressureCritical',hostPressureWarning:'advisor.rule.hostPressureWarning',vmMemoryHigh:'advisor.rule.vmMemoryHigh'};
const GRADE_KEYS={good:'advisor.grade.good',fair:'advisor.grade.fair',poor:'advisor.grade.poor'};
const RISK_KEYS={none:'advisor.riskLabel.none',low:'advisor.riskLabel.low',review:'advisor.riskLabel.review',data:'advisor.riskLabel.data'};
const RISK_CLASS={none:'risksafe',low:'risksafe',review:'riskreview',data:'riskdata'};
const BTN_KEYS={logs:'advisor.btn.logs',details:'advisor.btn.details',start:'advisor.btn.start',stop:'advisor.btn.stop',copy:'advisor.btn.copy',ports:'advisor.btn.ports',memory:'advisor.btn.memory',disk:'advisor.btn.disk',refresh:'advisor.btn.refresh'};
const TIER_KEYS={1:'advisor.tier.urgent',2:'advisor.tier.important',3:'advisor.tier.recommended',4:'advisor.tier.optional'};
const CHANGES=new Set(['start','stop','copy']);
const riskLevel=r=>r==='safe'?'none':r;
// Long lists scroll inside their card; a fade marks that more content is below.
function updateFades(){document.querySelectorAll('.advisorscroll').forEach(s=>s.classList.toggle('fade',s.scrollHeight-s.scrollTop-s.clientHeight>4));}
document.querySelectorAll('.advisorscroll').forEach(s=>s.addEventListener('scroll',updateFades,{passive:true}));
window.addEventListener('resize',updateFades);
async function loadAdvisor(){try{advice=await api('/api/advisor');renderAdvisor();renderHealthTile();}catch(e){$('advisorSummary').textContent=e.message;}}
// Every advisor action reuses an existing flow, so starting or stopping always goes through the review dialog.
function advisorButton(a){
 const run=a&&{logs:()=>openLogs(a.project,a.service||''),details:()=>{const p=byName(a.project);if(p)inspectProject(p);},start:()=>act('start',a.projects,{review:true}),
  stop:()=>act('stop',a.projects,{title:t('resources.stopPlan'),review:true}),copy:()=>copy(a.command),ports:()=>{go('navPorts','ports');loadPorts($('portInput').value.trim());},
  memory:()=>go('navResources','resources'),disk:()=>{go('navDisk','disk');analyzeDisk();},refresh:()=>{refresh();loadAdvisor();}}[a.type];
 return run?button(t(BTN_KEYS[a.type]),'mini',run):null;
}
function riskChip(r){const level=riskLevel(r);return el('span','risk '+RISK_CLASS[level],t(RISK_KEYS[level]));}
function renderAdvisor(){
 const h=advice.health,score=$('healthScore');score.textContent=h.score;score.className='score '+h.grade;$('healthGrade').textContent=t(GRADE_KEYS[h.grade]);
 $('problemsCount').textContent=h.findings.length||'';$('wasteCount').textContent=advice.waste.length||'';$('actionsCount').textContent=advice.actions.length||'';
 $('advisorSummary').textContent=[h.findings.length?t('advisor.sumProblems',{count:h.findings.length}):t('advisor.sumHealthy'),
  advice.totals.memBytes?t('advisor.sumMem',{size:fmtBytes(advice.totals.memBytes)}):'',advice.totals.diskBytes?t('advisor.sumDisk',{size:fmtDisk(advice.totals.diskBytes)}):''].filter(Boolean).join(' · ');
 const empty=key=>[el('li','emptysmall',t(key))];
 $('advisorProblems').replaceChildren(...(h.findings.length?h.findings.map(f=>{
  const li=el('li','finding '+f.level),head=el('div','findinghead'),points=el('span','points',f.points?`−${f.points}`:'0');if(!f.points)points.title=t('advisor.capped');
  head.append(points,el('span','',tr(f.text)));li.append(head,el('div','smalltext',tr(f.fix)));if(f.detail)li.title=tr(f.detail);
  const b=advisorButton(f.action);if(b)li.append(b);return li;}):empty('advisor.noProblems')));
 $('advisorRules').replaceChildren(...Object.entries(h.rules).map(([k,r])=>{const li=el('li');li.append(el('span','',t(RULE_KEYS[k])),el('span','smalltext',r.cap?t('advisor.ruleEach',{points:r.points,cap:r.cap}):t('advisor.ruleOnce',{points:r.points})));return li;}));
 $('advisorWaste').replaceChildren(...(advice.waste.length?advice.waste.map(w=>{
  const li=el('li','wasteitem'),amount=w.memBytes?t('advisor.impactMem',{size:fmtBytes(w.memBytes)}):w.diskBytes?t('advisor.impactDisk',{size:fmtDisk(w.diskBytes)}):t('advisor.cpuNow',{pct:w.cpuPercent});
  li.append(el('span','wastetext',tr(w.text)),el('span','amount',amount),riskChip(w.risk));return li;}):empty('advisor.noWaste')));
 const notes=[advice.observing?t('advisor.observing',{minutes:advice.observing.minutes}):'',advice.diskPending?t('advisor.diskPending'):''].filter(Boolean);
 $('advisorNotes').textContent=notes.join(' ');$('advisorNotes').classList.toggle('hidden',!notes.length);
 $('advisorActions').replaceChildren(...(advice.actions.length?advice.actions.map(a=>{
  const li=el('li','actionitem tier'+a.tier),chips=el('div','chips');chips.append(el('span','tierchip tier'+a.tier,t(TIER_KEYS[a.tier])));
  if(a.impact?.memBytes)chips.append(el('span','amount',t('advisor.impactMem',{size:fmtBytes(a.impact.memBytes)})));
  if(a.impact?.diskBytes)chips.append(el('span','amount',t('advisor.impactDisk',{size:fmtDisk(a.impact.diskBytes)})));
  // Risk only matters for actions that change something; "open the log" carries none.
  if(a.risk!=='none'||CHANGES.has(a.action?.type))chips.append(riskChip(a.risk));li.append(el('strong','',tr(a.title)),chips);
  for(const w of a.why||[])li.append(el('div','smalltext',tr(w)));if(a.riskText)li.append(el('div','smalltext risknote',tr(a.riskText)));
  const buttons=el('div','actionbuttons');for(const x of [a.action,a.secondary]){const b=advisorButton(x);if(b)buttons.append(b);}li.append(buttons);return li;}):empty('advisor.noActions')));
 const keep=$('advisorKeep');keep.replaceChildren();
 if(advice.keep.length){keep.append(el('div','pickertitle',t('advisor.keepTitle')));for(const k of advice.keep){const row=el('div','keeprow');row.append(el('strong','',k.project),el('span','smalltext',tr(k.reason)),el('span','smalltext',k.memBytes?fmtBytes(k.memBytes):''));keep.append(row);}}
 requestAnimationFrame(updateFades);
}
$('refreshAdvisor').onclick=()=>{refreshResources();loadAdvisor();};

const DEFAULT_PORTS=[80,443,3000,3306,4200,5000,5173,5432,6379,8000,8025,8069,8080,9000];
const bindText=ip=>ip==='0.0.0.0'?t('ports.allInterfaces'):ip;
const holderText=e=>e.kind==='container'?`${e.container}${e.project?` (${e.project})`:''}, ${t(e.running?'ports.stateRunning':'ports.stateReserved')}`:`${e.process}${e.self?' '+t('ports.thisDashboard'):''}, pid ${e.pid}`;
async function loadPorts(check=''){
 try{
  const [defaults,asked]=await Promise.all([api('/api/ports?check='+DEFAULT_PORTS.join(',')),check?api('/api/ports?check='+encodeURIComponent(check)):null]);
  lastPorts={entries:defaults.entries,defaults:defaults.checks,asked:asked?asked.checks:lastPorts?.asked||null};renderPortsData();
 }catch(e){$('portResults').replaceChildren(el('div','alert',e.message));}
}
function renderPortsData(){renderPortTable(lastPorts.entries);renderPortChecks($('portDefaults'),lastPorts.defaults,true);if(lastPorts.asked)renderPortChecks($('portResults'),lastPorts.asked,false);}
function renderPortChecks(target,checks,compact){
 target.replaceChildren(...checks.map(c=>{
  const node=el(compact?'span':'div',`portcheckrow ${c.free?'free':'used'}`);
  const alt=c.alternatives.length?t('ports.freeNearby',{ports:c.alternatives}):t('ports.noneNearby');
  if(compact){node.textContent=c.free?t('ports.chipFree',{port:c.port}):`${c.port} → ${c.alternatives[0]||'—'}`;node.title=c.free?t('ports.freeNow'):`${c.holders.map(holderText).join('; ')||t('ports.invisibleHolder')} · ${alt}`;return node;}
  node.append(el('strong','',String(c.port)),el('span','',' '+(c.free?t('ports.resultFree'):t('ports.resultTaken',{holders:c.holders.map(holderText).join('; ')||t('ports.invisibleHolderLong'),alternatives:alt}))));
  return node;
 }));
}
let portView='project';
try{portView=localStorage.getItem('ddm.portView')||'project';}catch{}
function applyPortView(){
 $('portGroups').classList.toggle('hidden',portView!=='project');$('portTableWrap').classList.toggle('hidden',portView!=='port');
 document.querySelectorAll('.chip[data-portview]').forEach(x=>x.classList.toggle('selected',x.dataset.portview===portView));
}
document.querySelectorAll('.chip[data-portview]').forEach(b=>b.onclick=()=>{portView=b.dataset.portview;try{localStorage.setItem('ddm.portView',portView);}catch{}applyPortView();});
// One card per owner: running projects first, then stopped ones (their ports are reserved), then the rest.
function renderPortGroups(entries){
 const groups=new Map(),label={'~standalone':'ports.groupStandalone','~process':'ports.groupProcess'};
 for(const e of entries){
  if(e.kind==='process'&&e.port>=10000)continue;
  const key=e.kind==='process'?'~process':e.project||'~standalone';
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);
 }
 const rank=([key,list])=>key==='~process'?3:key==='~standalone'?2:list.some(e=>e.running)?0:1;
 $('portGroups').replaceChildren(...[...groups].sort((a,b)=>rank(a)-rank(b)||a[0].localeCompare(b[0])).map(([key,list])=>{
  const running=list.filter(e=>e.running).length;
  const [textKey,cls]=key==='~process'?['ports.notDocker','statelisten']:running===list.length?['status.running','staterun']:running?['ports.partly','statereserved']:['ports.stoppedReserved','statereserved'];
  const card=el('article','portgroup'+(list.some(e=>e.note&&!e.self)?' attention':'')),head=el('div','portgrouphead');
  head.append(el('h3','',label[key]?t(label[key]):key),el('span','risk '+cls,t(textKey)),el('span','smalltext',t('ports.count',{count:list.length})));
  const ul=el('ul','portlist');
  for(const e of list.sort((a,b)=>a.port-b.port)){
   const li=el('li',e.kind==='process'?'proc':e.running?'live':'held'),bind=el('span','portbind'+(e.ip==='0.0.0.0'?' lan':''),bindText(e.ip));
   if(e.ip==='0.0.0.0')bind.title=t('ports.lanTitle');
   li.append(el('span','portnum',`${e.port}${e.proto==='udp'?'/udp':''}`),el('span','portwho',e.kind==='container'?`${e.service||e.container} → ${e.target.replace('/tcp','')}`:`${e.process}${e.self?' '+t('ports.thisDashboard'):''}`),bind);
   if(e.note&&!e.self)li.append(el('div','portnote',tr(e.note)));
   ul.append(li);
  }
  card.append(head,ul);return card;
 }));
}
function renderPortTable(entries){
 renderPortGroups(entries);applyPortView();
 const main=entries.filter(e=>e.kind==='container'||e.port<10000),high=entries.filter(e=>e.kind==='process'&&e.port>=10000);
 const state=e=>e.kind==='process'?['ports.listening','statelisten']:e.running?['ports.stateRunning','staterun']:['ports.reserved','statereserved'];
 $('portRows').replaceChildren(...main.map(e=>{
  const row=el('tr',e.note&&!e.self?'conflictrow':''),st=el('td'),[key,cls]=state(e);st.append(el('span','risk '+cls,t(key)));
  row.append(el('td','',`${e.port}${e.proto==='udp'?'/udp':''}`),el('td','',bindText(e.ip)),el('td','',e.kind==='container'?`${e.container} → ${e.target}`:e.process),el('td','',e.kind==='container'?(e.project||t('common.standalone')):t('ports.notDocker')),st,el('td','notes',tr(e.note)));
  return row;
 }));
 if(!main.length)messageRow($('portRows'),t('ports.none'),6);
 $('highPortsSummary').textContent=t('ports.highSummary',{count:high.length});
 $('highPortRows').replaceChildren(...high.map(e=>{const row=el('tr');[String(e.port),bindText(e.ip),e.process,String(e.pid)].forEach(v=>row.append(el('td','',v)));return row;}));
}
$('portCheck').addEventListener('submit',e=>{e.preventDefault();const v=$('portInput').value.trim();if(v)loadPorts(v);});
$('refreshPorts').onclick=()=>loadPorts($('portInput').value.trim());

async function analyzeDisk(){
 const target=$('diskContent'),btn=$('analyzeDisk');target.replaceChildren(el('p','',t('disk.analyzing')));btn.disabled=true;
 try{renderDisk(await api('/api/disk?refresh=1'));}catch(e){target.replaceChildren(el('div','alert',e.message));}finally{btn.disabled=false;}
}
function renderDisk(d){
 lastDisk=d;
 const target=$('diskContent'),wrap=el('div','tablewrap'),table=el('table'),thead=el('thead'),head=el('tr'),tbody=el('tbody');
 ['col.type','col.count','col.size','col.reclaimable','col.risk','col.todo'].forEach(k=>head.append(el('th','',t(k))));thead.append(head);
 for(const r of d.rows){
  const row=el('tr'),todo=el('td','notes');todo.append(el('div','',tr(r.note)));
  for(const c of r.commands){const line=el('div','cmdrow');line.append(el('span','smalltext',tr(c.label)),el('code','',c.command),button('⧉','mini',()=>copy(c.command),false,t('common.copy')));todo.append(line);}
  row.append(el('td','',tr(r.label)),el('td','',String(r.count)),el('td','',fmtDisk(r.size)),el('td','',r.risk==='data'?'—':fmtDisk(r.reclaimable)));
  const risk=el('td');risk.append(el('span','risk '+RISK[r.risk][1],t(RISK[r.risk][0])));row.append(risk,todo);tbody.append(row);
 }
 table.append(thead,tbody);wrap.append(table);
 const nodes=[wrap];
 if(d.unusedVolumes.length){
  const fold=el('details','fold');fold.append(el('summary','',t('disk.volumesFold',{count:d.unusedVolumes.length})));
  const vt=el('table'),vh=el('tr'),vb=el('tbody');['col.volume','col.project','col.size','col.context'].forEach(k=>vh.append(el('th','',t(k))));
  for(const v of d.unusedVolumes){const row=el('tr');
   const context=t(v.anonymous?'disk.ctx.anonymous':!v.project?'disk.ctx.outside':v.projectHasContainers?'disk.ctx.projectAlive':'disk.ctx.leftover');
   [v.volume||v.name.slice(0,24)+(v.name.length>24?'…':''),v.project||'—',fmtDisk(v.size),context].forEach(x=>row.append(el('td','',x)));row.title=v.name;vb.append(row);}
  const vw=el('div','tablewrap'),foot=el('p','footnote');renderRich(foot,t('disk.inspectFoot'));vt.append(el('thead'),vb);vt.firstChild.append(vh);vw.append(vt);fold.append(vw,foot);nodes.push(fold);
 }
 nodes.push(el('p','footnote',t('disk.measured',{time:new Date(d.generatedAt).toLocaleTimeString(I.lang)})));
 target.replaceChildren(...nodes);
}

async function openLogs(name,service=''){
 const p=byName(name);logProject=name;$('logsTitle').textContent=t('logs.titleFor',{project:name});
 const services=[...new Set((p?.containers||[]).filter(c=>!c.oneoff&&c.service).map(c=>c.service))].sort();
 $('logService').replaceChildren(new Option(t('logs.allServices'),''),...services.map(s=>new Option(s,s)));$('logService').value=service;
 $('logErrors').checked=false;$('logsOutput').textContent=t('common.loading');rawLogs='';if(!$('logsDialog').open)$('logsDialog').showModal();await reloadLogs();
}
async function reloadLogs(){
 if(!logProject)return;const service=$('logService').value;
 // Log content is shown exactly as Docker returns it; only the surrounding labels are translated.
 try{const data=await api(`/api/projects/${encodeURIComponent(logProject)}/logs?tail=${$('logTail').value}${service?'&service='+encodeURIComponent(service):''}`);rawLogs=data.logs.trim();}
 catch(e){rawLogs=t('logs.error',{message:e.message});}
 renderLogs();
}
function renderLogs(){
 const only=$('logErrors').checked,lines=rawLogs?rawLogs.split('\n'):[],shown=only?lines.filter(l=>ERROR_LINE.test(l)):lines,out=$('logsOutput');
 out.textContent=shown.join('\n')||(only?t('logs.noErrors',{count:lines.length}):t('logs.none'));
 $('logsNote').textContent=t(only?'logs.noteErrors':'logs.note',{shown:shown.length,total:lines.length,count:lines.length});out.scrollTop=out.scrollHeight;
}
$('reloadLogs').onclick=reloadLogs;$('logService').onchange=reloadLogs;$('logTail').onchange=reloadLogs;$('logErrors').onchange=renderLogs;
$('copyLogCmd').onclick=()=>{const s=$('logService').value;copy(`cd /tmp && docker compose -p ${logProject} logs -f --tail 200${s?' '+s:''}`);};

document.querySelectorAll('.closeDialog').forEach(b=>b.onclick=()=>$('projectDialog').close());document.querySelectorAll('.closeLogs').forEach(b=>b.onclick=()=>$('logsDialog').close());
document.querySelectorAll('.closeInspect').forEach(b=>b.onclick=()=>$('inspectDialog').close());
document.querySelectorAll('[data-lang]').forEach(b=>b.onclick=()=>setLanguage(b.dataset.lang));
$('search').addEventListener('input',renderProjects);$('refresh').onclick=()=>{refresh();refreshResources();};$('scan').onclick=scanDocker;$('add').onclick=()=>openProject();
$('refreshStats').onclick=refreshResources;$('analyzeDisk').onclick=analyzeDisk;$('stopSelected').onclick=()=>act('stop',[...selectedStops],{title:t('resources.stopPlan'),review:true});
document.querySelectorAll('.chip[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('.chip[data-filter]').forEach(x=>x.classList.toggle('selected',x===b));renderProjects();});
const go=(nav,target)=>{if(target)$(target).scrollIntoView({behavior:'smooth'});else window.scrollTo({top:0,behavior:'smooth'});document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x.id===nav));};
$('navProjects').onclick=()=>go('navProjects');$('navAdvisor').onclick=()=>go('navAdvisor','advisor');$('navResources').onclick=()=>go('navResources','resources');$('navDisk').onclick=()=>go('navDisk','disk');$('navPorts').onclick=()=>{go('navPorts','ports');loadPorts($('portInput').value.trim());};$('memoryMetric').onclick=()=>go('navResources','resources');$('hostMetric').onclick=()=>go('navResources','resources');
$('tileHealth').onclick=()=>go('navAdvisor','advisor');$('tileDisk').onclick=()=>go('navDisk','disk');$('tileProjects').onclick=()=>{$('projectGrid').scrollIntoView({behavior:'smooth'});};
// Polling only while the page is visible keeps the dashboard's own Docker load low.
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastRefresh>5000){refresh();refreshResources();loadAdvisor();}});
(async()=>{
 try{const [vi,en]=await Promise.all(['vi','en'].map(l=>fetch(`/locales/${l}.json`).then(r=>r.json())));DICTS={vi,en};}catch{}
 // Read before setLanguage() writes it, so merely opening the page never creates a config file.
 const local=storedLanguage();
 await setLanguage(local,false);
 try{
  token=(await api('/api/session')).token;
  workspace=await api('/api/workspace');
  // The config file wins; a choice made before it was saved there (or on another URL) is written once.
  if(workspace.language&&workspace.language!==I.lang)await setLanguage(workspace.language,false);
  else if(!workspace.language&&I18N.valid(local))await setLanguage(I.lang,true);
  await refresh();refreshResources();loadAdvisor();loadPorts();
  setInterval(()=>{if(!document.hidden)refresh();},15000);setInterval(()=>{if(!document.hidden){refreshResources();loadAdvisor();}},30000);
 }catch(e){alertMessage(e.message);}
})();
