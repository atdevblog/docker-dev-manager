'use strict';
const $=id=>document.getElementById(id);
let token='',projects=[],groups=[],workspace={keepRunning:[],language:''},resources=null,editing=null,filter='all',busy=new Set(),logProject=null,rawLogs='',lastRefresh=0;
let loaded=false,dockerState=null,lastPorts=null,lastDisk=null,advice=null,hostData=null;
// Each box runs its own measurement, only on a click: health checks (~0.5 s), `docker stats` (~2 s)
// and `docker system df -v` (~4 s). `opened` holds the parts measured on this page, `working` those
// running now, `staleParts` those taken before the user started or stopped something.
const opened=new Set(),working=new Set(),staleParts=new Set();
const selectedStops=new Set(),busyContainers=new Set(),openFolds=new Set(storedList('ddm.openFolds'));
const ERROR_LINE=/\b(error|err|fatal|exception|panic|critical|crit|fail(ed|ure)?|denied|refused|killed|oom|traceback|uncaught)\b/i;

// ---- i18n: every visible string comes from public/locales/<lang>.json ----
let DICTS={vi:{},en:{}};
const missingKeys=new Set();
let I=I18N.create(DICTS,I18N.FALLBACK);
const t=(key,params)=>I.t(key,params),tr=message=>I.render(message);
const STATUS_KEYS={running:'status.running',partial:'status.partial',stopped:'status.stopped',error:'status.error',unknown:'status.unknown'};
const ACTION_KEYS={start:'action.start',stop:'action.stop',restart:'action.restart',up:'action.up',down:'action.down'};
const VERB_KEYS={start:'verb.start',stop:'verb.stop',restart:'verb.restart',up:'verb.up',down:'verb.down'};
const CONTAINER_KEYS={start:'container.start',stop:'container.stop',restart:'container.restart'};
const JOB_KEYS={pending:['…','job.pending'],running:['⟳','job.running'],done:['✓','job.done'],failed:['✕','job.failed'],skipped:['–','job.skipped'],cancelled:['–','job.cancelled']};
const DOCKER_STATE_KEYS={running:'dockerState.running',exited:'dockerState.exited',created:'dockerState.created',restarting:'dockerState.restarting',paused:'dockerState.paused',dead:'dockerState.dead',removing:'dockerState.removing'};
const PRESSURE_KEYS={normal:'pressure.normal',warning:'pressure.warning',critical:'pressure.critical'};
const RISK={safe:['disk.risk.safe','risksafe'],review:['disk.risk.review','riskreview'],data:['disk.risk.data','riskdata']};
const stateText=s=>DOCKER_STATE_KEYS[s]?t(DOCKER_STATE_KEYS[s]):s;
const LANGUAGE_KEY='ddm.language';
function storedLanguage(){try{return localStorage.getItem(LANGUAGE_KEY)||'';}catch{return '';}}
// Per-browser conveniences (open container lists); the page works the same without them.
function storedList(key){try{const v=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(v)?v.filter(x=>typeof x==='string'):[];}catch{return [];}}
function storeList(key,set){try{localStorage.setItem(key,JSON.stringify([...set]));}catch{}}
// Translations may mark code with backticks; it is rendered as <code>, never as HTML.
function renderRich(node,text){node.replaceChildren(...String(text).split(/`([^`]+)`/).map((part,i)=>i%2?el('code','',part):document.createTextNode(part)));}
function applyStatic(){
 document.documentElement.lang=I.lang;document.documentElement.classList.remove('i18n-pending');
 document.querySelectorAll('[data-i18n]').forEach(n=>{if(n.tagName==='TITLE')document.title=t(n.dataset.i18n);else renderRich(n,t(n.dataset.i18n));});
 document.querySelectorAll('[data-i18n-placeholder]').forEach(n=>{n.placeholder=t(n.dataset.i18nPlaceholder);});
 document.querySelectorAll('[data-i18n-aria-label]').forEach(n=>n.setAttribute('aria-label',t(n.dataset.i18nAriaLabel)));
 document.querySelectorAll('[data-i18n-title]').forEach(n=>{n.title=t(n.dataset.i18nTitle);});
 document.querySelectorAll('[data-lang]').forEach(b=>{b.classList.toggle('selected',b.dataset.lang===I.lang);b.setAttribute('aria-pressed',String(b.dataset.lang===I.lang));});
}
// Re-renders from data already in memory: switching language never refetches or touches Docker.
function rerender(){
 if(!loaded)return;
 renderEngine();updateCounters();renderGroups();renderProjects();renderSuggestions();renderStats();
 if(lastPorts)renderPortsData();if(lastDisk)renderDisk(lastDisk);renderAdvisorAll();
}
// The choice lives in the config file (survives restarts, upgrades and other URLs such as a local
// proxy domain) and in localStorage only to paint the first frame in the right language.
async function setLanguage(lang,persist=true){
 lang=I18N.valid(lang)?lang:I18N.FALLBACK;
 I=I18N.create(DICTS,lang,key=>{if(!missingKeys.has(key)){missingKeys.add(key);console.warn('Missing translation:',key);}});
 try{localStorage.setItem(LANGUAGE_KEY,lang);}catch{}
 applyStatic();rerender();if(!loaded)renderControls();
 if(persist&&token&&workspace.language!==lang){try{workspace=await api('/api/workspace','PUT',{...workspace,language:lang});}catch(e){toast(e.message);}}
}

async function api(url,method='GET',data,retried=false){
 const response=await fetch(url,{method,headers:{...(method==='GET'?{}:{'Content-Type':'application/json','X-Dev-Manager-Token':token})},body:data===undefined?undefined:JSON.stringify(data)});
 // A restarted server has a new session token: fetch it once and try again, so nothing is lost silently.
 if(response.status===403&&method!=='GET'&&!retried){try{token=(await (await fetch('/api/session')).json()).token;}catch{}return api(url,method,data,true);}
 let result;try{result=await response.json();}catch{throw Error(t('error.invalidResponse'));}
 // The message key travels with the error, so a form can point at the field it is about.
 if(!response.ok){const err=Error(result.message?tr(result.message):result.error||`HTTP ${response.status}`);err.key=result.message?.key||'';throw err;}return result;
}
// An open modal dialog covers the page, so the message goes into that dialog to stay visible.
function toast(message){const n=$('toast'),host=[...document.querySelectorAll('dialog[open]')].pop()||document.body;if(n.parentElement!==host)host.append(n);n.textContent=message;n.classList.remove('hidden');clearTimeout(toast.timer);toast.timer=setTimeout(()=>n.classList.add('hidden'),4500);}
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
 const status=$('healthStatus'),h=opened.has('health')&&advice?.parts?.health?advice.health:null;
 if(dockerState&&!dockerState.available){setValue($('healthValue'),0,'/100');setStatus(status,'poor',t('metric.engineOffline'));$('healthSub').textContent=t('engine.startDesktop');}
 else if(!h){setValue($('healthValue'),'—');status.replaceChildren();$('healthSub').textContent=t(working.has('health')?'advisor.checking':'metric.notChecked');}
 else{setValue($('healthValue'),h.score,'/100');setStatus(status,h.grade,t(GRADE_KEYS[h.grade]));
  $('healthSub').textContent=[h.findings.length?t('advisor.sumProblems',{count:h.findings.length}):t('advisor.sumHealthy'),t('advisor.checkedAt',{time:clock(advice.checkedAt)})].join(' · ');}
 if(!(opened.has('disk')&&advice?.parts?.disk)){setValue($('reclaimValue'),'—');$('reclaimSub').textContent=t(working.has('disk')?'advisor.analyzing':'metric.notAnalyzed');return;}
 const disk=advice.waste.filter(w=>w.kind==='disk'),review=disk.filter(w=>w.risk==='review'||w.risk==='data').reduce((n,w)=>n+w.diskBytes,0);
 setValue($('reclaimValue'),advice.totals.diskBytes?'≈ '+fmtDisk(advice.totals.diskBytes):'0 B');
 $('reclaimSub').textContent=[advice.totals.diskBytes?t('metric.reclaimSafe'):t('metric.reclaimNone'),review?t('metric.reclaimReview',{size:fmtDisk(review)}):'',t('advisor.analyzedAt',{time:clock(advice.diskAt)})].filter(Boolean).join(' · ');
}
// Restored measurements may come from an earlier day: the date is shown then.
const clock=iso=>{const d=new Date(iso),hm={hour:'2-digit',minute:'2-digit'};return d.toDateString()===new Date().toDateString()?d.toLocaleTimeString(I.lang,hm):d.toLocaleString(I.lang,{day:'2-digit',month:'2-digit',...hm});};
async function scanDocker(){await refresh();toast(t('toast.scanned',{count:projects.filter(p=>p.total).length}));}
function updateCounters(){
 if(!loaded)return;
 const running=projects.filter(p=>p.running>0);
 const containers=running.reduce((n,p)=>n+p.running,0),attention=projects.filter(hasProblem).length;
 setValue($('runningCount'),running.length,` / ${projects.length}`);
 $('containerCount').textContent=attention?t('metric.runningAttention',{containers,count:attention}):t('metric.containersRunning',{count:containers});
 $('allCount').textContent=projects.length;$('runningChip').textContent=running.length;$('issuesCount').textContent=projects.filter(hasProblem).length;
 $('managedCount').textContent=projects.filter(p=>p.managed).length;$('discoveredCount').textContent=projects.filter(p=>!p.managed).length;
 // Also the summary of the projects heading, so a collapsed section still tells how things stand.
 $('projectsSummary').textContent=[t('projects.summary',{count:projects.length,running:running.length}),attention?t('metric.attention',{count:attention}):''].filter(Boolean).join(' · ');
 renderOverview();
}
// Both memory tiles express CPU in cores so the Docker share and the whole Mac compare directly.
// This Mac is polled (cheap); container RAM needs `docker stats`, measured on a click.
function renderOverview(){
 const vm=hostData?.vm||resources?.vm||{},host=hostData?.host||resources?.host,cores=vm.ncpu||host?.cores||'?';
 if(resources){
  const tot=resources.totals;setValue($('memoryUsed'),fmtBytes(tot.memBytes));
  const share=vm.memTotal?tot.memBytes/vm.memTotal:0;setMeter($('vmMeter'),share,share>=.9?'danger':share>=.7?'warning':'accent');
  $('memoryOf').textContent=[vm.memTotal?t('metric.ofVm',{total:fmtBytes(vm.memTotal),pct:Math.round(share*100)}):t('metric.dockerVm'),t('metric.cpuCores',{used:(tot.cpuPercent/100).toFixed(1),total:cores})].join(' · ');
  const top=[...resources.projects].sort((a,b)=>b.memBytes-a.memBytes)[0];
  $('topConsumer').textContent=[top?.memBytes?t('metric.topConsumer',{project:top.name,size:fmtBytes(top.memBytes)}):'',t('resources.measuredAt',{time:clock(resources.measuredAt)})].filter(Boolean).join(' · ');
 }else{
  setValue($('memoryUsed'),'—');setMeter($('vmMeter'),0,'accent');$('memoryOf').textContent=t(working.has('stats')?'metric.measuring':'metric.notMeasured');$('topConsumer').textContent='';
 }
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
 const card=el('article','project st-'+p.status+(p.issues.some(i=>i.level==='error')?' attention':''));
 // The name is the way into the details, the most common next step after reading a card.
 const head=el('div','projtitle'),h3=el('h3'),open=el('button','projlink');open.type='button';open.title=t('card.openDetails',{project:p.name});
 open.append(el('span','projicon','▣'),el('span','projname',p.name));open.addEventListener('click',()=>inspectProject(p));h3.append(open);
 head.append(h3,el('span','pill '+p.status,t(STATUS_KEYS[p.status]||'status.unknown')));card.append(head);
 const badges=el('div','badgerow');badges.append(el('span','typebadge '+(p.managed?'ismanaged':'isdiscovered'),(p.managed?'● ':'◌ ')+t(p.managed?'card.managed':'card.discovered')),el('span','smalltext',t('card.runningOf',{running:p.running,total:p.total})));
 const usage=usageOf(p.name);if(usage)badges.append(el('span','smalltext',t('metric.ram',{size:fmtBytes(usage.memBytes)})));
 if(p.sources.length>1)badges.append(el('span','typebadge warnbadge',t('card.sources',{count:p.sources.length})));
 if(workspace.keepRunning.includes(p.name))badges.append(el('span','typebadge ismanaged','★ '+t('card.keepRunning')));
 // Only a description someone wrote is shown: the type badge already says how the project was found.
 card.append(badges);if(p.description)card.append(el('p','projdesc',p.description));
 card.append(el('div','path',p.directory?`${p.directory}${p.composeFile?' / '+p.composeFile:''}`:p.sources.length>1?t('card.workingDirs',{count:p.sources.length}):t('card.pathUnavailable')));
 if(p.issues.length){const box=el('div','issues');p.issues.slice(0,3).forEach(i=>box.append(issueLine(p,i)));if(p.issues.length>3)box.append(button(t('card.moreIssues',{count:p.issues.length-3}),'link',()=>inspectProject(p)));card.append(box);}
 const core=p.containers.filter(c=>!c.oneoff);
 if(core.length){
  // Closed: one chip per service as a status glance. Open: every container with its own controls.
  // Cards are rebuilt on every refresh, so the open state is remembered per project.
  const fold=el('details','containerfold'),summary=el('summary'),services=el('span','services');fold.open=openFolds.has(p.name);
  fold.addEventListener('toggle',()=>{if(fold.open)openFolds.add(p.name);else openFolds.delete(p.name);storeList('ddm.openFolds',openFolds);});
  core.slice(0,6).forEach(c=>{const chip=el('span','servicechip',c.service||c.name);chip.prepend(el('i',stateDot(c)));chip.title=stateLabel(c);services.append(chip);});
  if(core.length>6)services.append(el('span','smalltext',t('common.more',{count:core.length-6})));
  summary.title=t('container.foldTitle');summary.append(el('span','foldlabel',t('container.summary',{count:core.length})),services);
  const list=el('ul','containerlist');[...core].sort((x,y)=>(x.service||x.name).localeCompare(y.service||y.name)).forEach(c=>list.append(containerRow(p,c)));
  fold.append(summary,list);card.append(fold);
 }
 const a=el('div','actions'),blocked=busy.has(p.name);
 if(!p.total&&p.managed)a.append(button('⇡ '+t('action.up'),'primary',()=>act('up',[p.name]),blocked,t('card.upTitle')));
 else a.append(button('▶ '+t('action.start'),'primary',()=>act('start',[p.name]),blocked||!p.total||p.running===p.total,t('card.startTitle')));
 a.append(button('■ '+t('action.stop'),'secondary',()=>act('stop',[p.name]),blocked||!p.running),button('↻ '+t('action.restart'),'secondary',()=>act('restart',[p.name]),blocked||!p.running));
 // Terminal opens at the project's folder (the largest source when it was started from several).
 const dir=[p.directory,...p.sources.map(x=>x.directory)].find(Boolean);
 a.append(button('≡ '+t('action.logs'),'secondary',()=>openLogs(p.name),!p.total),button('›_ '+t('action.terminal'),'secondary',()=>openIn(p,'terminal',dir),!dir,dir?t('card.terminalTitle',{path:dir}):t('card.noFolder')),button('ⓘ '+t('action.details'),'secondary',()=>inspectProject(p)));
 card.append(a);return card;
}
// One visual state per container: colour, icon and words together, never colour alone.
// Exit codes of a normal stop (docker stop sends SIGTERM, then SIGKILL) read as stopped, not failed.
const CLEAN_EXIT=new Set([0,130,137,143]);
const CSTATE_ICON={running:'●',starting:'◐',unhealthy:'▲',paused:'‖',restarting:'↻',failed:'✕',stopped:'■',created:'○',busy:'⟳'};
const CSTATE_KEYS={running:'cstate.running',starting:'cstate.starting',unhealthy:'cstate.unhealthy',paused:'cstate.paused',restarting:'cstate.restarting',stopped:'cstate.stopped',created:'cstate.created',busy:'container.working'};
function containerState(c){
 if(c.state==='running')return c.health==='unhealthy'?'unhealthy':c.health==='starting'?'starting':'running';
 if(['paused','restarting','created'].includes(c.state))return c.state;
 if(c.state==='exited'||c.state==='dead')return c.oomKilled||!CLEAN_EXIT.has(c.exitCode)?'failed':'stopped';
 return 'stopped';
}
const visualState=c=>busyContainers.has(c.id)?'busy':containerState(c);
function stateLabel(c){const s=visualState(c);return s==='failed'?t(c.oomKilled?'cstate.oom':'cstate.failed',{code:c.exitCode}):t(CSTATE_KEYS[s]);}
function stateBadge(c){
 const s=visualState(c),badge=el('span','cstate cs-'+s);
 badge.append(el('i','',CSTATE_ICON[s]),document.createTextNode(stateLabel(c)));badge.title=[stateText(c.state),c.state==='running'?'':`exit ${c.exitCode}`].filter(Boolean).join(' · ');
 return badge;
}
const stateDot=c=>'cs-'+containerState(c);
function iconButton(glyph,label,fn,disabled){const b=button(glyph,'mini',fn,disabled,label);b.setAttribute('aria-label',label);return b;}
// Docker Desktop-style row controls for one container.
function containerButtons(p,c){
 const name=c.service||c.name,active=['running','restarting','paused'].includes(c.state),blocked=busy.has(p.name)||busyContainers.has(c.id),box=el('span','rowactions');
 const main=active?iconButton('■',t('container.stop',{container:name}),()=>actContainer('stop',p,c),blocked):iconButton('▶',t('container.start',{container:name}),()=>actContainer('start',p,c),blocked);
 main.classList.add(active?'act-stop':'act-start');
 box.append(main,
  iconButton('↻',t('container.restart',{container:name}),()=>actContainer('restart',p,c),blocked||!active),
  iconButton('≡',t('container.logs',{container:name}),()=>openLogs(p.name,c.service),!c.service),
  iconButton('›_',t(c.state==='running'?'container.shell':'container.shellOff',{container:name}),()=>openTerminal(p,c,'shell'),c.state!=='running'),
  iconButton('⌂',c.sourceDir?t('container.folder',{path:c.sourceDir}):t('container.folderNone',{container:name}),()=>openTerminal(p,c,'folder'),!c.sourceDir));
 return box;
}
// A shell inside the container (docker exec), or Terminal at its source folder on this Mac.
async function openTerminal(p,c,mode){
 try{await api(`/api/projects/${encodeURIComponent(p.name)}/containers/${c.id}/terminal`,'POST',{mode});toast(t(mode==='shell'?'toast.shellOpened':'toast.folderOpened',{container:c.service||c.name,path:c.sourceDir}));}
 catch(e){toast(e.message);}
}
function containerRow(p,c){
 const row=el('li','containerrow '+stateDot(c)),main=el('div','containermain'),head=el('div','containerhead'),title=el('strong','',c.service||c.name),meta=el('span','smalltext');title.title=`${c.name} · ${c.image}`;
 head.append(title,stateBadge(c));
 const usage=resources?.containers.find(s=>String(s.id).slice(0,12)===c.id);
 if(c.state==='running'&&usage)meta.append(t('container.usage',{size:fmtBytes(usage.memBytes),cpu:usage.cpuPercent.toFixed(1)}));
 // Host ports open the app in the browser, as Docker Desktop's port links do.
 for(const port of [...new Set(c.ports.filter(b=>b.proto==='tcp').map(b=>b.port))].sort((x,y)=>x-y)){
  const link=el('a','portlink',String(port));link.href=`${port===443?'https':'http'}://localhost:${port}`;link.target='_blank';link.rel='noopener noreferrer';link.title=t('container.openPort',{port});meta.append(meta.childNodes.length?' ':'',link);
 }
 main.append(head);if(meta.childNodes.length)main.append(meta);row.append(main,containerButtons(p,c));
 return row;
}
// Same preflight as projects: a clean action runs at once, anything with a warning is reviewed first.
async function actContainer(action,p,c){
 const name=c.service||c.name;
 let plan;try{plan=await api(`/api/projects/${encodeURIComponent(p.name)}/containers/${c.id}/plan`,'POST',{action});}catch(e){return alertMessage(e.message);}
 const item=plan.items[0];
 if(item.skip)return toast(`${name}: ${tr(item.info)}`);
 if(!item.warnings.length&&!item.errors.length)return runContainer(action,p,c);
 showPlan(plan,t('plan.titleContainer',{action:t(ACTION_KEYS[action]),container:name,project:p.name}),()=>runContainer(action,p,c),t(CONTAINER_KEYS[action],{container:name}));
}
async function runContainer(action,p,c){
 const name=c.service||c.name;busyContainers.add(c.id);showProject(p.name);
 try{await api(`/api/projects/${encodeURIComponent(p.name)}/containers/${c.id}/${action}`,'POST',{});toast(t('toast.containerDone',{container:name,project:p.name,action:t(VERB_KEYS[action])}));}
 catch(e){alertMessage(`${name}: ${e.message}`);}
 finally{busyContainers.delete(c.id);await refresh();showProject(p.name);afterChange();}
}
// Redraws the cards and, when it shows this project, the open details dialog.
function showProject(name){renderProjects();const p=byName(name);if(p&&$('inspectDialog').open&&$('inspectTitle').textContent===name)inspectProject(p);}
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
 finally{busy.delete(name);await refresh();afterChange();}
}
// After a start or stop only the cheap views refresh; measured figures are kept but marked as older.
function afterChange(){loadHost();if(opened.size){opened.forEach(x=>staleParts.add(x));renderAdvisorAll();}if(resources)renderSuggestions();}
// onRun/runLabel replace the batch run, for a plan about one container.
function showPlan(plan,title,onRun,runLabel){
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
 function update(){const n=selected().length;run.disabled=!n;run.textContent=!n?t('plan.nothing'):runLabel||t('plan.runN',{action:t(ACTION_KEYS[plan.action]),count:n});}
 update();run.hidden=false;run.className='btn '+(plan.action==='down'?'danger':'primary');cancel.disabled=false;cancel.textContent=t('common.cancel');
 cancel.onclick=()=>$('planDialog').close();$('planClose').onclick=()=>$('planDialog').close();
 run.onclick=()=>{const names=selected();if(!names.length)return;
  if(onRun){$('planDialog').close();return onRun();}
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
 await refresh();afterChange();
}

async function importProject(p){
 if(!p.importable)return;
 try{await api('/api/projects','POST',{name:p.name,directory:p.directory,composeFile:p.composeFile,description:t('import.description')});$('inspectDialog').close();toast(t('toast.imported',{project:p.name}));await refresh();}
 catch(e){alertMessage(`${p.name}: ${e.message}`);}
}
async function saveWorkspace(next){try{workspace=await api('/api/workspace','PUT',{...next,language:I.lang});renderGroups();renderProjects();if(resources){for(const r of resources.projects)r.keepRunning=workspace.keepRunning.includes(r.name);renderSuggestions();}if(opened.size)compose();return true;}catch(e){toast(e.message);return false;}}
async function toggleKeep(name){const keep=new Set(workspace.keepRunning);if(keep.has(name))keep.delete(name);else keep.add(name);if(await saveWorkspace({...workspace,keepRunning:[...keep]})){const p=byName(name);if(p)inspectProject(p);}}
async function openIn(p,app,directory){try{await api(`/api/projects/${encodeURIComponent(p.name)}/open`,'POST',{app,directory});if(app==='terminal')toast(t('toast.folderOpened',{path:directory}));}catch(e){toast(e.message);}}
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
   const since=c.state==='running'?t('details.runningFor',{time:fmtSince(c.startedAt)}):c.finishedAt?t('cstate.ago',{time:fmtSince(c.finishedAt)}):'';
   const stateCell=el('td');stateCell.append(stateBadge(c));if(since)stateCell.append(el('div','smalltext',since));
   [`${c.service||c.name}${c.oneoff?' '+t('details.oneoffTag'):''}`,stateCell,c.state==='running'?'—':String(c.exitCode)+(c.oomKilled?' OOM':''),String(c.restartCount),c.health||'—',
    c.ports.map(b=>`${b.ip==='0.0.0.0'?'':b.ip+':'}${b.port}→${b.target}`).join(' ')||'—',[c.memLimit?'RAM '+fmtBytes(c.memLimit):'',c.nanoCpus?`CPU ${c.nanoCpus/1e9}`:''].filter(Boolean).join(' · ')||t('details.noLimit')].forEach(v=>tr_.append(typeof v==='string'?el('td','',v):v));
   const td=el('td');td.append(containerButtons(p,c));tr_.append(td);tbody.append(tr_);
  }
  table.append(el('thead'),tbody);table.firstChild.append(head);wrap.append(table);target.append(wrap);
  target.append(el('p','footnote',t('details.limitsFootnote')));
 }
 target.append(el('h4','detailhead',t('details.terminal')));
 for(const c of p.commands){const row=el('div','cmdrow');row.append(el('span','smalltext',tr(c.label)),el('code','',c.command),button('⧉','mini',()=>copy(c.command),false,t('common.copy')));target.append(row);}
 if(!dialog.open)dialog.showModal();
}
function openProject(p){editing=p?.name||null;$('dialogTitle').textContent=editing?t('form.editTitle',{project:editing}):t('form.addTitle');const f=$('projectForm');f.reset();for(const field of ['name','directory','composeFile','description'])if(p)f.elements[field].value=p[field]||'';f.elements.name.disabled=!!editing;updateDescCount();formError('');$('projectDialog').showModal();}
// Save errors show inside the form, next to the field they are about.
const FIELD_OF={'error.projectName':'name','error.projectExists':'name','error.directoryAbsolute':'directory','error.directoryMissing':'directory','error.composeRelative':'composeFile','error.composeMissing':'composeFile','error.composeOutside':'composeFile','error.description':'description'};
function formError(message,key){
 const f=$('projectForm'),box=$('formError');box.textContent=message;box.classList.toggle('hidden',!message);
 for(const el of f.querySelectorAll('[aria-invalid]'))el.removeAttribute('aria-invalid');
 const field=FIELD_OF[key]&&f.elements[FIELD_OF[key]];if(field){field.setAttribute('aria-invalid','true');field.focus();}
}
$('projectForm').addEventListener('input',e=>{if(e.target.hasAttribute('aria-invalid'))formError('');});
const updateDescCount=()=>{const d=$('projectForm').elements.description;$('descCount').textContent=d.value.length?`${d.value.length} / ${d.maxLength}`:'';};
$('projectForm').elements.description.addEventListener('input',updateDescCount);
// The macOS folder picker fills the path, the Compose file it finds there and, when empty, the name.
$('pickFolder').onclick=async()=>{
 const b=$('pickFolder'),f=$('projectForm');b.disabled=true;b.textContent=t('form.picking');
 try{
  const r=await api('/api/pick-folder','POST',{});if(r.cancelled)return;
  f.elements.directory.value=r.directory;
  if(r.composeFiles.length)f.elements.composeFile.value=r.composeFiles[0];else toast(t('toast.noCompose'));
  if(!editing&&!f.elements.name.value&&r.name)f.elements.name.value=r.name;
 }catch(e){toast(e.message);}
 finally{b.disabled=false;b.textContent=t('form.pick');}
};
$('projectForm').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;const data=Object.fromEntries(new FormData(f));if(editing)data.name=editing;try{await api(editing?`/api/projects/${encodeURIComponent(editing)}`:'/api/projects',editing?'PUT':'POST',data);$('projectDialog').close();toast(t('toast.saved'));await refresh();}catch(e){formError(e.message,e.key);}});

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

// Cheap host figures, polled with the project list.
async function loadHost(){try{hostData=await api('/api/host');renderOverview();}catch{}}
// `docker stats` (~2 s of Docker CPU): only when the user asks.
async function refreshResources(){
 if(working.has('stats'))return;working.add('stats');renderControls();renderOverview();renderSuggestions();
 try{resources=await api('/api/resources');opened.add('stats');staleParts.delete('stats');}
 catch(e){working.delete('stats');renderControls();renderOverview();return renderSuggestions(e.message);}
 working.delete('stats');renderControls();updateCounters();renderSuggestions();renderStats();renderProjects();await compose();
}
function messageRow(tbody,text,cols){const row=el('tr'),td=el('td','',text);td.colSpan=cols;row.append(td);tbody.replaceChildren(row);}
function renderSuggestions(error){
 const tbody=$('suggestRows');
 if(error)return messageRow(tbody,error,6);
 if(working.has('stats')&&!resources)return messageRow(tbody,t('resources.measuring'),6);
 if(!resources){updateStopSelected();return messageRow(tbody,t('resources.notMeasured'),6);}
 const vm=resources.vm,total=resources.totals.memBytes;
 $('vmLine').textContent=[vm.memTotal?t('resources.vmLine',{used:fmtBytes(total),total:fmtBytes(vm.memTotal),pct:Math.round(total/vm.memTotal*100),cpus:vm.ncpu}):t('resources.lead'),t('resources.measuredAt',{time:clock(resources.measuredAt)})].join(' · ');
 // A project stopped since the measurement drops out instead of showing old figures.
 const rows=resources.projects.filter(r=>(byName(r.name)?.running||0)>0);
 for(const n of [...selectedStops])if(!rows.some(r=>r.name===n&&!r.keepRunning))selectedStops.delete(n);
 updateStopSelected();
 if(!rows.length)return messageRow(tbody,t('resources.noRunning'),6);
 tbody.replaceChildren(...rows.map(r=>{
  const row=el('tr',r.crashLoop?'crashrow':''),check=el('td','checkcol'),cb=document.createElement('input');
  cb.type='checkbox';cb.disabled=r.keepRunning;cb.checked=selectedStops.has(r.name);cb.title=t(r.keepRunning?'resources.keepTitle':'resources.selectTitle');
  cb.onchange=()=>{if(cb.checked)selectedStops.add(r.name);else selectedStops.delete(r.name);updateStopSelected();};check.append(cb);
  const notes=el('td','notes');notes.append(el('span','',r.notes.map(tr).join(' ')||'—'));
  row.append(check,el('td','',r.name),el('td','',fmtBytes(r.memBytes)),el('td','',r.cpuPercent.toFixed(1)+'%'),el('td','',fmtSince(r.since)),notes);return row;
 }));
}
function updateStopSelected(){const n=selectedStops.size;$('stopSelected').disabled=!n;$('stopSelected').textContent='■ '+(n?t('resources.stopN',{count:n}):t('resources.stopSelected'));}
function renderStats(){
 const tbody=$('statsRows');if(!resources)return messageRow(tbody,t('resources.notMeasured'),6);if(!resources.containers.length)return messageRow(tbody,t('resources.noContainers'),6);
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
const PART_KEYS={health:['advisor.check','advisor.checking','advisor.recheck'],stats:['advisor.measure','metric.measuring','advisor.remeasure'],disk:['advisor.analyze','advisor.analyzing','advisor.reanalyze']};
const PART_NAME_KEYS={health:'advisor.partHealth',stats:'advisor.partStats',disk:'advisor.partDisk'};
// Measurements run from the tiles at the top; the advisor columns below only show their results.
// A tile's button reads its verb before the first run, "…ing" while it runs, and "↻ again" afterwards.
function setPartButton(b,part){
 const [run,busyKey,again]=PART_KEYS[part],now=working.has(part),done=opened.has(part);
 b.textContent=now?t(busyKey):done?'↻ '+t(again):t(run);b.disabled=now;b.classList.toggle('primary',!done&&!now);b.classList.toggle('stalebtn',done&&staleParts.has(part));
 if(done&&!now){b.title=t(again);b.setAttribute('aria-label',t(again));}else{b.removeAttribute('title');b.removeAttribute('aria-label');}
 return b;
}
function renderControls(){
 setPartButton($('checkHealthTile'),'health');setPartButton($('measureTile'),'stats');setPartButton($('diskTile'),'disk');
 $('refreshStats').disabled=working.has('stats');$('analyzeDisk').disabled=working.has('disk');
}
// Cheap: recombines the parts already measured. It never starts `docker stats` or `system df` itself.
async function compose(){
 if(opened.size){try{advice=await api('/api/advisor?parts='+[...opened].join(','));if(opened.has('health'))staleParts.delete('health');}catch(e){alertMessage(e.message);}}
 renderAdvisorAll();
}
async function checkHealth(){
 if(working.has('health'))return;working.add('health');opened.add('health');renderAdvisorAll();
 try{await compose();}finally{working.delete('health');renderAdvisorAll();}
}
function renderAdvisorAll(){renderControls();renderHealthTile();renderAdvisor();}
// The server keeps the last measurements, so a reload shows them again with their time. Only the
// cheap health check runs again, so its problems are current; Measure and Analyze wait for a click.
async function restoreMeasurements(){
 let m;try{m=await api('/api/measured');}catch{return;}
 if(m.resources){resources=m.resources;opened.add('stats');updateCounters();renderSuggestions();renderStats();renderProjects();}
 if(m.disk){renderDisk(m.disk);opened.add('disk');}
 if(m.healthAt)opened.add('health');
 if(opened.size)await compose();
}
// Every advisor action reuses an existing flow, so starting or stopping always goes through the review dialog.
function advisorButton(a){
 const run=a&&{logs:()=>openLogs(a.project,a.service||''),details:()=>{const p=byName(a.project);if(p)inspectProject(p);},start:()=>act('start',a.projects,{review:true}),
  stop:()=>act('stop',a.projects,{title:t('resources.stopPlan'),review:true}),copy:()=>copy(a.command),ports:()=>{go('navPorts','ports');loadPorts($('portInput').value.trim());},
  memory:()=>go('navResources','resources'),disk:()=>go('navDisk','disk'),refresh:()=>{refresh();checkHealth();}}[a.type];
 return run?button(t(BTN_KEYS[a.type]),'mini',run):null;
}
function riskChip(r){const level=riskLevel(r);return el('span','risk '+RISK_CLASS[level],t(RISK_KEYS[level]));}
function renderAdvisor(){
 const a=advice,has=part=>opened.has(part)&&!!a?.parts?.[part],empty=key=>[el('li','emptysmall',t(key))];
 // Until something is measured the columns only hold a hint, so they shrink to fit it.
 $('advisorGrid').classList.toggle('waiting',!opened.size);
 const sum=a?[has('health')?(a.health.findings.length?t('advisor.sumProblems',{count:a.health.findings.length}):t('advisor.sumHealthy')):'',
  has('stats')&&a.totals.memBytes?t('advisor.sumMem',{size:fmtBytes(a.totals.memBytes)}):'',has('disk')&&a.totals.diskBytes?t('advisor.sumDisk',{size:fmtDisk(a.totals.diskBytes)}):''].filter(Boolean):[];
 $('advisorSummary').replaceChildren(sum.length?sum.join(' · '):t('advisor.notAnalyzed'),...(staleParts.size?[' · ',el('span','textwarning',t('advisor.stale'))]:[]));
 // 1. What is wrong? Health checks only.
 const score=$('healthScore');
 if(has('health')){
  const h=a.health;score.textContent=h.score;score.className='score '+h.grade;$('healthGrade').textContent=[t(GRADE_KEYS[h.grade]),t('advisor.checkedAt',{time:clock(a.checkedAt)})].join(' · ');$('problemsCount').textContent=h.findings.length||'';
  $('advisorProblems').replaceChildren(...(h.findings.length?h.findings.map(f=>{
   const li=el('li','finding '+f.level),head=el('div','findinghead'),points=el('span','points',f.points?`−${f.points}`:'0');if(!f.points)points.title=t('advisor.capped');
   head.append(points,el('span','',tr(f.text)));li.append(head,el('div','smalltext',tr(f.fix)));if(f.detail)li.title=tr(f.detail);
   const b=advisorButton(f.action);if(b)li.append(b);return li;}):empty('advisor.noProblems')));
 }else{score.textContent='—';score.className='score';$('healthGrade').textContent='';$('problemsCount').textContent='';$('advisorProblems').replaceChildren(...empty(working.has('health')?'advisor.checking':'advisor.healthEmpty'));}
 if(a)$('advisorRules').replaceChildren(...Object.entries(a.health.rules).map(([k,r])=>{const li=el('li');li.append(el('span','',t(RULE_KEYS[k])),el('span','smalltext',r.cap?t('advisor.ruleEach',{points:r.points,cap:r.cap}):t('advisor.ruleOnce',{points:r.points})));return li;}));
 // 2. Where is waste? From the RAM/CPU and disk measurements made on the tiles.
 const waste=a?a.waste:[];$('wasteCount').textContent=waste.length||'';
 $('advisorWaste').replaceChildren(...(waste.length?waste.map(w=>{
  const li=el('li','wasteitem'),amount=w.memBytes?t('advisor.impactMem',{size:fmtBytes(w.memBytes)}):w.diskBytes?t('advisor.impactDisk',{size:fmtDisk(w.diskBytes)}):t('advisor.cpuNow',{pct:w.cpuPercent});
  li.append(el('span','wastetext',tr(w.text)),el('span','amount',amount),riskChip(w.risk));return li;}):empty(has('stats')||has('disk')?'advisor.noWaste':'advisor.wasteEmpty')));
 const wasteMissing=['stats','disk'].filter(x=>!has(x)),notes=[a?.observing&&has('stats')?t('advisor.observing',{minutes:a.observing.minutes,idle:a.observing.idleMinutes}):'',
  wasteMissing.length===1?t('advisor.notCovered',{parts:wasteMissing.map(x=>t(PART_NAME_KEYS[x]))}):''].filter(Boolean);
 $('advisorNotes').textContent=notes.join(' ');$('advisorNotes').classList.toggle('hidden',!notes.length);
 // 3. What to do now? Built only from the parts measured above.
 const actions=a&&opened.size?a.actions:[];$('actionsCount').textContent=actions.length||'';
 $('advisorActions').replaceChildren(...(actions.length?actions.map(x=>{
  const li=el('li','actionitem tier'+x.tier),chips=el('div','chips');chips.append(el('span','tierchip tier'+x.tier,t(TIER_KEYS[x.tier])));
  if(x.impact?.memBytes)chips.append(el('span','amount',t('advisor.impactMem',{size:fmtBytes(x.impact.memBytes)})));
  if(x.impact?.diskBytes)chips.append(el('span','amount',t('advisor.impactDisk',{size:fmtDisk(x.impact.diskBytes)})));
  // Risk only matters for actions that change something; "open the log" carries none.
  if(x.risk!=='none'||CHANGES.has(x.action?.type))chips.append(riskChip(x.risk));li.append(el('strong','',tr(x.title)),chips);
  for(const w of x.why||[])li.append(el('div','smalltext',tr(w)));if(x.riskText)li.append(el('div','smalltext risknote',tr(x.riskText)));
  const buttons=el('div','actionbuttons');for(const y of [x.action,x.secondary]){const b=advisorButton(y);if(b)buttons.append(b);}li.append(buttons);return li;}):empty(opened.size?'advisor.noActions':'advisor.actionsEmpty')));
 const missing=['health','stats','disk'].filter(x=>!has(x)),showMissing=opened.size>0&&missing.length>0;
 $('actionsNote').textContent=showMissing?t('advisor.notCovered',{parts:missing.map(x=>t(PART_NAME_KEYS[x]))}):'';$('actionsNote').classList.toggle('hidden',!showMissing);
 const keep=$('advisorKeep');keep.replaceChildren();
 if(a?.keep?.length){keep.append(el('div','pickertitle',t('advisor.keepTitle')));for(const k of a.keep){const row=el('div','keeprow');row.append(el('strong','',k.project),el('span','smalltext',tr(k.reason)),el('span','smalltext',k.memBytes?fmtBytes(k.memBytes):''));keep.append(row);}}
 requestAnimationFrame(updateFades);
}
$('checkHealthTile').onclick=checkHealth;$('measureTile').onclick=refreshResources;$('diskTile').onclick=analyzeDisk;

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

// `docker system df -v` (several seconds): only when the user asks.
async function analyzeDisk(){
 if(working.has('disk'))return;working.add('disk');renderAdvisorAll();
 const target=$('diskContent');if(!lastDisk)target.replaceChildren(el('p','',t('disk.analyzing')));
 try{renderDisk(await api('/api/disk?refresh=1'));opened.add('disk');staleParts.delete('disk');}catch(e){target.replaceChildren(el('div','alert',e.message));}
 finally{working.delete('disk');renderControls();}
 await compose();
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
$('search').addEventListener('input',renderProjects);$('refresh').onclick=()=>{refresh();loadHost();};$('scan').onclick=scanDocker;$('add').onclick=()=>openProject();
$('refreshStats').onclick=refreshResources;$('analyzeDisk').onclick=analyzeDisk;$('stopSelected').onclick=()=>act('stop',[...selectedStops],{title:t('resources.stopPlan'),review:true});
document.querySelectorAll('.chip[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('.chip[data-filter]').forEach(x=>x.classList.toggle('selected',x===b));renderProjects();});
// Sections collapse from their heading; the summary line stays visible and the choice is remembered.
const collapsed=new Set(storedList('ddm.collapsed'));
function setCollapsed(section,on){
 section.classList.toggle('collapsed',on);section.querySelector('.collapser').setAttribute('aria-expanded',String(!on));
 if(on)collapsed.add(section.id);else{collapsed.delete(section.id);requestAnimationFrame(updateFades);}
 storeList('ddm.collapsed',collapsed);
}
document.querySelectorAll('section.block').forEach(sec=>{const b=sec.querySelector('.collapser');if(collapsed.has(sec.id)){sec.classList.add('collapsed');b.setAttribute('aria-expanded','false');}b.addEventListener('click',()=>setCollapsed(sec,!sec.classList.contains('collapsed')));});
// Jumping to a section opens it first when it is collapsed.
const go=(nav,target)=>{
 if(target){const el=$(target),sec=el.closest('section.block');if(sec?.classList.contains('collapsed'))setCollapsed(sec,false);el.scrollIntoView({behavior:'smooth'});}
 else window.scrollTo({top:0,behavior:'smooth'});
 document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x.id===nav));
};
$('navProjects').onclick=()=>go('navProjects','projects');$('navAdvisor').onclick=()=>go('navAdvisor','advisor');$('navResources').onclick=()=>go('navResources','resources');$('navDisk').onclick=()=>go('navDisk','disk');$('navPorts').onclick=()=>{go('navPorts','ports');loadPorts($('portInput').value.trim());};
// A tile's body opens its section; the button inside it runs that tile's own measurement.
const tileGo=(id,fn)=>$(id).addEventListener('click',e=>{if(!e.target.closest('button'))fn();});
tileGo('tileHealth',()=>go('navAdvisor','advisor'));tileGo('tileProjects',()=>go('navProjects','projects'));
tileGo('memoryMetric',()=>go('navResources','resources'));tileGo('hostMetric',()=>go('navResources','resources'));tileGo('tileDisk',()=>go('navDisk','disk'));
// Only cheap views are polled, and only while the page is visible: the project list (`docker ps` +
// `inspect`, ~0.3 s) and this Mac's memory. Stats, disk and the advisor wait for a click.
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastRefresh>5000){refresh();loadHost();}});
(async()=>{
 try{const [vi,en]=await Promise.all(['vi','en'].map(l=>fetch(`/locales/${l}.json`).then(r=>r.json())));DICTS={vi,en};}catch{}
 // The server writes the saved language into the page; this browser's own copy is only a fallback.
 // Read before setLanguage() writes it, so merely opening the page never creates a config file.
 const saved=document.documentElement.dataset.savedLang||'',local=storedLanguage();
 await setLanguage(saved||local,false);
 try{
  token=(await api('/api/session')).token;
  workspace=await api('/api/workspace');
  // The config file wins; a choice made before it was saved there (or on another URL) is written once.
  if(workspace.language&&workspace.language!==I.lang)await setLanguage(workspace.language,false);
  else if(!workspace.language&&I18N.valid(local))await setLanguage(I.lang,true);
  await refresh();renderAdvisorAll();loadHost();loadPorts();restoreMeasurements();
  setInterval(()=>{if(!document.hidden){refresh();loadHost();}},15000);
 }catch(e){alertMessage(e.message);}
})();
