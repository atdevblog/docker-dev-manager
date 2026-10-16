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
// The server writes its platform into the page. Texts that name the Mac, Finder or Activity Monitor
// have their own wording on other systems; on a Mac the original keys stay.
const PLATFORM=document.documentElement.dataset.platform||'darwin',ON_MAC=PLATFORM==='darwin';
const PC_KEYS={'metric.thisMac':'metric.thisComputer','metric.hostTitle':'metric.hostTitlePc','form.intro':'form.introPc','form.pickTitle':'form.pickTitlePc',
 'ports.desc':'ports.descPc','ports.groupProcess':'ports.groupProcessPc','container.folderNone':'container.folderNonePc','advisor.healthEmpty':'advisor.healthEmptyPc',
 'sys.title':'sys.titlePc','sys.netTitle':'sys.netTitlePc'};
const t=(key,params)=>I.t(!ON_MAC&&PC_KEYS[key]||key,params),tr=message=>I.render(message);
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
 renderEngine();updateCounters();renderGroups();renderProjects();renderOverviewLists();renderContainers();renderSuggestions();renderStats();renderSystem();renderNetCheck();
 if(lastPorts)renderPortsData();if(lastDisk)renderDisk(lastDisk);renderAdvisorAll();renderSteps();renderBitbucket();
}
// The choice lives in the config file (survives restarts, upgrades and other URLs such as a local
// proxy domain) and in localStorage only to paint the first frame in the right language.
async function setLanguage(lang,persist=true){
 lang=I18N.valid(lang)?lang:I18N.FALLBACK;
 I=I18N.create(DICTS,lang,key=>{if(!missingKeys.has(key)){missingKeys.add(key);console.warn('Missing translation:',key);}});
 try{localStorage.setItem(LANGUAGE_KEY,lang);}catch{}
 applyStatic();renderChrome();rerender();if(!loaded)renderControls();
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
// Lucide icons live in one inline sprite (index.html); a button may carry one before its words.
const SVG_NS='http://www.w3.org/2000/svg';
function icon(name){const s=document.createElementNS(SVG_NS,'svg'),u=document.createElementNS(SVG_NS,'use');s.setAttribute('class','ic');s.setAttribute('aria-hidden','true');u.setAttribute('href','#i-'+name);s.append(u);return s;}
function button(text,cls,fn,disabled=false,title='',ic=''){const b=el('button','btn '+cls);if(ic)b.append(icon(ic));if(text)b.append(document.createTextNode(text));b.type='button';b.disabled=disabled;if(title)b.title=title;b.addEventListener('click',fn);return b;}
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
 renderEngine();updateCounters();renderGroups();renderProjects();renderOverviewLists();renderContainers();}catch(e){alertMessage(e.message);}
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
 const status=$('healthStatus'),h=opened.has('health')&&advice?.parts?.health?advice.health:null,ring=$('healthRing');
 ring.style.setProperty('--p',h?h.score:0);ring.className='ring'+(h?' '+h.grade:'');
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
 $('navProjectsCount').textContent=projects.length||'';$('navContainersCount').textContent=projects.reduce((n,p)=>n+p.containers.filter(c=>!c.oneoff).length,0)||'';
 $('allCount').textContent=projects.length;$('runningChip').textContent=running.length;$('issuesCount').textContent=projects.filter(hasProblem).length;
 $('managedCount').textContent=projects.filter(p=>p.managed).length;$('discoveredCount').textContent=projects.filter(p=>!p.managed).length;
 // Also the summary of the projects heading, so a collapsed section still tells how things stand.
 $('projectsSummary').textContent=[t('projects.summary',{count:projects.length,running:running.length}),attention?t('metric.attention',{count:attention}):''].filter(Boolean).join(' · ');
 renderOverview();
}
// Both memory tiles express CPU in cores so the Docker share and the whole Mac compare directly.
// This Mac is polled (cheap); container RAM needs `docker stats`, measured on a click.
function renderOverview(){
 renderMemoryChart();
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
// A card reads as a summary: name and status, the one thing that needs attention, how its containers stand.
// The rest waits one click away: the container list opens in place, paths and every problem are in Details.
function projectCard(p){
 const card=el('article','project st-'+p.status),core=p.containers.filter(c=>!c.oneoff);
 // The name opens the details; its tooltip says how the project was found and where it lives.
 const head=el('div','projtitle'),h3=el('h3'),open=el('button','projlink');open.type='button';
 const where=p.directory?`${p.directory}${p.composeFile?' / '+p.composeFile:''}`:p.sources.length>1?t('card.workingDirs',{count:p.sources.length}):t('card.pathUnavailable');
 open.title=`${t('card.openDetails',{project:p.name})}\n${t(p.managed?'card.managed':'card.discovered')} · ${where}`;
 const pic=el('span','projicon');pic.append(icon('box'));open.append(pic,el('span','projname',p.name));open.addEventListener('click',()=>inspectProject(p));h3.append(open);
 head.append(h3,el('span','pill '+p.status,t(STATUS_KEYS[p.status]||'status.unknown')));card.append(head);
 // Every card has the same shape: name, one line, the container bar, the buttons. The line carries the most
 // useful thing to know: a problem, else the description, else where the project lives; tags follow it.
 const sub=el('div','projsub'),part=(ic,text,cls='')=>{const x=el('span',cls);x.append(icon(ic),el('span','',text));sub.append(x);return x;};
 const issue=[...p.issues].sort((a,b)=>issueRank(a.level)-issueRank(b.level))[0];
 if(issue){
  const lead=part(issue.level==='error'?'circle-x':issue.level==='warn'?'triangle-alert':'info',tr(issue.text),'lead problem '+issue.level);lead.title=`${tr(issue.text)}\n${tr(issue.hint)}`;
  if(issue.service&&p.containers.some(c=>c.service===issue.service))sub.append(button(t('action.log'),'link',()=>openLogs(p.name,issue.service)));
  if(p.issues.length>1){const more=button(t('common.more',{count:p.issues.length-1}),'link',()=>inspectProject(p));more.title=t('card.moreIssues',{count:p.issues.length-1});sub.append(more);}
 }else if(p.description)part('info',p.description,'lead').title=p.description;
 else if(p.sources.length<2)part('folder',p.directory?shortPath(p.directory):t('card.pathUnavailable'),'lead').title=where;
 if(p.sources.length>1)part('folder-search',t('card.sources',{count:p.sources.length}),'tagwarn').title=t('card.workingDirs',{count:p.sources.length});
 if(p.managed)part('circle-check',t('card.managed'));
 if(workspace.keepRunning.includes(p.name))part('star',t('card.keepRunning'));
 card.append(sub);
 card.append(...stateRow(p,core),projActions(p));
 return card;
}
// Home folders read as ~ (macOS /Users/name, Linux /home/name).
// Home folders read as ~ (macOS /Users/name, Linux /home/name, Windows C:\Users\name).
const shortPath=dir=>dir.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/,'~').replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/,'~');
const issueRank=level=>level==='error'?0:level==='warn'?1:2;
const stateCounts=list=>{const n={ok:0,warn:0,bad:0,off:0};for(const c of list)n[CHART_STATE[containerState(c)]||'off']++;return n;};
// The same bar as the overview chart. A click opens every container with its own controls, like Docker Desktop;
// cards are rebuilt on every refresh, so the open state is remembered per project.
function stateRow(p,core){
 const usage=usageOf(p.name),text=[t('card.runningOf',{running:p.running,total:p.total}),usage?.memBytes>0?t('metric.ram',{size:fmtBytes(usage.memBytes)}):''].filter(Boolean).join(' · ');
 if(!core.length){const row=el('div','statebar none');row.append(el('span','statetext',t('card.noContainers')));return [row];}
 const n=stateCounts(core),listId='containers-'+p.name.replace(/[^\w-]/g,'_'),toggle=el('button','statebar'),top=el('span','statetop'),bar=el('span','minibar'),list=el('ul','containerlist');
 toggle.type='button';toggle.title=t('container.foldTitle');toggle.setAttribute('aria-controls',listId);list.id=listId;
 top.append(el('span','statetext',text),el('span','srtext',t('container.summary',{count:core.length})),icon('chevron-right'));
 bar.setAttribute('aria-hidden','true');for(const [k] of CHART_SERIES)if(n[k]){const seg=el('span','s-'+k);seg.style.flex=`${n[k]} 1 0`;bar.append(seg);}
 toggle.append(top,bar);
 attachTip(bar,null,()=>[t('container.summary',{count:core.length}),CHART_SERIES.filter(([k])=>n[k]).map(([k,key])=>tipRow('s-'+k,t(key),String(n[k])))]);
 [...core].sort((x,y)=>(x.service||x.name).localeCompare(y.service||y.name)).forEach(c=>list.append(containerRow(p,c)));
 const show=on=>{list.hidden=!on;toggle.setAttribute('aria-expanded',String(on));};show(openFolds.has(p.name));
 toggle.addEventListener('click',()=>{const on=list.hidden;show(on);if(on)openFolds.add(p.name);else openFolds.delete(p.name);storeList('ddm.openFolds',openFolds);});
 return [toggle,list];
}
// One next step in words; the rest are quiet icons with tooltips, shown only when they can do something.
function projActions(p){
 const foot=el('div','cardfoot'),quiet=el('div','quiet'),blocked=busy.has(p.name),full=p.total>0&&p.running===p.total;
 const ghost=(ic,label,fn,{off=false,title=''}={})=>{const b=iconButton(ic,label,fn,off);b.classList.replace('mini','ghost');if(title)b.title=title;return b;};
 if(!p.total&&p.managed)foot.append(button(t('action.up'),'tonal',()=>act('up',[p.name]),blocked,t('card.upTitle'),'circle-arrow-up'));
 else if(full)foot.append(button(t('action.stop'),'tonal neutral',()=>act('stop',[p.name]),blocked,'','square'));
 else if(p.total)foot.append(button(t('action.start'),'tonal',()=>act('start',[p.name]),blocked,t('card.startTitle'),'play'));
 if(p.running&&!full)quiet.append(ghost('square',t('action.stop'),()=>act('stop',[p.name]),{off:blocked}));
 if(p.running)quiet.append(ghost('rotate-cw',t('action.restart'),()=>act('restart',[p.name]),{off:blocked}));
 if(p.total)quiet.append(ghost('scroll-text',t('action.logs'),()=>openLogs(p.name)));
 // Terminal opens at the project's folder (the largest source when it was started from several).
 const dir=[p.directory,...p.sources.map(x=>x.directory)].find(Boolean);
 quiet.append(ghost('square-terminal',t('action.terminal'),()=>openIn(p,'terminal',dir),{off:!dir,title:dir?t('card.terminalTitle',{path:dir}):t('card.noFolder')}),
  ghost('info',t('action.details'),()=>inspectProject(p)));
 foot.append(quiet);return foot;
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
function iconButton(name,label,fn,disabled){const b=button('','mini',fn,disabled,label,name);b.setAttribute('aria-label',label);return b;}
// Docker Desktop-style row controls for one container.
function containerButtons(p,c){
 const name=c.service||c.name,active=['running','restarting','paused'].includes(c.state),blocked=busy.has(p.name)||busyContainers.has(c.id),box=el('span','rowactions');
 const main=active?iconButton('square',t('container.stop',{container:name}),()=>actContainer('stop',p,c),blocked):iconButton('play',t('container.start',{container:name}),()=>actContainer('start',p,c),blocked);
 main.classList.add(active?'act-stop':'act-start');
 box.append(main,
  iconButton('rotate-cw',t('container.restart',{container:name}),()=>actContainer('restart',p,c),blocked||!active),
  iconButton('scroll-text',t('container.logs',{container:name}),()=>openLogs(p.name,c.service),!c.service),
  iconButton('square-terminal',t(c.state==='running'?'container.shell':'container.shellOff',{container:name}),()=>openTerminal(p,c,'shell'),c.state!=='running'),
  iconButton('folder-open',c.sourceDir?t('container.folder',{path:c.sourceDir}):t('container.folderNone',{container:name}),()=>openTerminal(p,c,'folder'),!c.sourceDir));
 return box;
}
// A shell inside the container (docker exec), or Terminal at its source folder on this Mac.
async function openTerminal(p,c,mode){
 try{await api(`/api/projects/${encodeURIComponent(p.name)}/containers/${c.id}/terminal`,'POST',{mode});toast(t(mode==='shell'?'toast.shellOpened':'toast.folderOpened',{container:c.service||c.name,path:c.sourceDir}));}
 catch(e){toast(e.message);}
}
// Host ports open the app in the browser, as Docker Desktop's port links do.
const uniquePorts=c=>[...new Set(c.ports.filter(b=>b.proto==='tcp').map(b=>b.port))].sort((x,y)=>x-y);
function portLink(port){const link=el('a','portlink',String(port));link.href=`${port===443?'https':'http'}://localhost:${port}`;link.target='_blank';link.rel='noopener noreferrer';link.title=t('container.openPort',{port});return link;}
function containerRow(p,c){
 // The name gets the whole first line; state, usage and ports sit under it, so narrow cards never cut the name.
 const row=el('li','containerrow '+stateDot(c)),main=el('div','containermain'),title=el('strong','',c.service||c.name),meta=el('span','containermeta smalltext');title.title=`${c.name} · ${c.image}`;
 meta.append(stateBadge(c));
 const usage=resources?.containers.find(s=>String(s.id).slice(0,12)===c.id);
 if(c.state==='running'&&usage)meta.append(el('span','',t('container.usage',{size:fmtBytes(usage.memBytes),cpu:usage.cpuPercent.toFixed(1)})));
 for(const port of uniquePorts(c))meta.append(portLink(port));
 main.append(title,meta);row.append(main,containerButtons(p,c));
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
function showProject(name){renderProjects();renderContainers();renderOverviewLists();const p=byName(name);if(p&&$('inspectDialog').open&&$('inspectTitle').textContent===name)inspectProject(p);}
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
 if(p.importable&&!p.managed)actions.append(button(t('action.import'),'primary',()=>importProject(p),false,t('details.importTitle'),'plus'));
 if(p.managed)actions.append(button(t('action.up'),'secondary',()=>{close();act('up',[p.name]);},busy.has(p.name)||!p.composeFileOk,'','circle-arrow-up'),button(t('action.edit'),'subtle',()=>{close();openProject(p);},false,'','pencil'),button(t('action.down'),'danger',()=>{close();act('down',[p.name]);},busy.has(p.name)||!p.total||!p.composeFileOk,'','trash-2'));
 const kept=workspace.keepRunning.includes(p.name);
 actions.append(button(t(kept?'action.unkeep':'action.keep'),'subtle',()=>toggleKeep(p.name),false,t('details.keepTitle'),'star'));
 const dirs=[...new Set([p.directory,...p.sources.map(s=>s.directory)].filter(Boolean))];
 // Application names are product names and stay as they are in every language.
 if(dirs.length)[['finder',ON_MAC?'Finder':'File Explorer','folder'],['terminal','Terminal','square-terminal'],['vscode','VS Code','code']].forEach(([app,label,ic])=>actions.append(button(label,'subtle',()=>openIn(p,app,dirs[0]),false,t('details.openTitle',{path:dirs[0]}),ic)));
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
 for(const c of p.commands){const row=el('div','cmdrow');row.append(el('span','smalltext',tr(c.label)),el('code','',c.command),iconButton('copy',t('common.copy'),()=>copy(c.command),false));target.append(row);}
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
  chip.append(iconButton('play',t('groups.startTitle'),()=>act('start',members,{title:t('groups.startPlan',{group:g.name}),review:true}),running.length===members.length),iconButton('square',t('groups.stopTitle'),()=>act('stop',running,{title:t('groups.stopPlan',{group:g.name}),review:true}),!running.length));
  list.append(chip);
 }
}

// Cheap host figures, polled with the project list.
async function loadHost(){try{hostData=await api('/api/host');renderOverview();renderSystem();}catch{}}
// Network quality, on click only: the server times a connection to Docker Hub and Cloudflare (nothing is
// downloaded). The traffic above says how busy the network is; this says how quick it answers.
let netCheck=null,netChecking=false;
const NET_LEVEL={fast:['sys.netFast','●'],ok:['sys.netOk','●'],slow:['sys.netSlow','▲'],offline:['sys.netOffline','✕']};
function renderNetCheck(){
 const b=$('sysNetCheck'),r=$('sysNetRating');
 b.disabled=netChecking;b.textContent=t(netChecking?'sys.netChecking':netCheck?'sys.netRecheck':'sys.netCheck');b.title=t('sys.netCheckHint');
 if(!netCheck){r.replaceChildren();r.className='netrating';r.title='';return;}
 const [key,glyph]=NET_LEVEL[netCheck.level]||NET_LEVEL.offline,ms=x=>x.ms!=null?t('sys.netTargetMs',{ms:x.ms,level:t(NET_LEVEL[x.level]?.[0]||'sys.netOk')}):t('sys.netUnreachable');
 r.className='netrating lvl-'+netCheck.level;
 r.replaceChildren(el('i','',glyph),document.createTextNode(netCheck.ms!=null?t('sys.netRating',{level:t(key),ms:netCheck.ms}):t(key)));
 r.title=t('sys.netCheckTitle',{targets:netCheck.targets.map(x=>`${x.name} ${ms(x)}`).join(' · '),time:clock(netCheck.checkedAt)});
}
async function checkNetwork(){
 if(netChecking)return;netChecking=true;renderNetCheck();
 try{netCheck=(await api('/api/network-check','POST',{})).check;}catch(e){toast(e.message);}
 finally{netChecking=false;renderNetCheck();renderSystem();}
}
$('sysNetCheck').onclick=checkNetwork;
// Sidebar: the drive of the home folder and the network traffic now. A speed needs two readings, so a
// page that has none yet asks again a few seconds later instead of waiting for the next poll.
const fmtRate=n=>fmtDisk(n)+'/s';
let netRetries=0;
function renderSystem(){
 const host=hostData?.host,d=host?.disk,n=host?.network,diskRow=$('sysDisk'),netRow=$('sysNet');
 // A page newer than the server still running (updated without a restart) gets no such figures at all.
 const stale=!!host&&!('disk' in host),restart=stale?t('sys.restart'):'';
 if(d?.total>0){
  const pct=Math.round(d.used/d.total*100),level=pct>=95?'danger':pct>=85?'warning':'accent',sizes={used:fmtDisk(d.used),total:fmtDisk(d.total),free:fmtDisk(d.free)};
  $('sysDiskValue').textContent=t('sys.diskValue',sizes);setMeter($('sysDiskMeter'),d.used/d.total,level);
  const free=$('sysDiskFree');free.textContent=t('sys.diskFree',sizes);free.className=level==='danger'?'textdanger':level==='warning'?'textwarning':'';
  diskRow.title=[t('sys.diskTitle',{...sizes,pct,path:d.path}),d.purgeable>=1e9?t('sys.diskPurgeable',{size:fmtDisk(d.purgeable)}):''].filter(Boolean).join(' ');
 }else{$('sysDiskValue').textContent='—';setMeter($('sysDiskMeter'),0,'accent');$('sysDiskFree').textContent=restart;$('sysDiskFree').className=stale?'textwarning':'';diskRow.title=restart;}
 if(n&&n.rxPerSec!=null){
  netRetries=0;$('sysDown').textContent=fmtRate(n.rxPerSec);$('sysUp').textContent=fmtRate(n.txPerSec);
  netRow.title=[t('sys.netTitle',{down:fmtRate(n.rxPerSec),up:fmtRate(n.txPerSec),window:n.windowSec}),$('sysNetRating').title].filter(Boolean).join('\n');
 }else{
  $('sysDown').textContent=$('sysUp').textContent=n?'…':'—';netRow.title=stale?restart:t(n?'sys.netMeasuring':'sys.netUnavailable');
  if(n&&netRetries<3){netRetries++;setTimeout(loadHost,3000);}
 }
}
// `docker stats` (~2 s of Docker CPU): only when the user asks.
async function refreshResources(){
 if(working.has('stats'))return;working.add('stats');renderControls();renderOverview();renderSuggestions();
 try{resources=await api('/api/resources');opened.add('stats');staleParts.delete('stats');}
 catch(e){working.delete('stats');renderControls();renderOverview();return renderSuggestions(e.message);}
 working.delete('stats');renderControls();updateCounters();renderSuggestions();renderStats();renderProjects();renderContainers();renderOverviewLists();await compose();
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
function updateStopSelected(){const n=selectedStops.size,b=$('stopSelected');b.disabled=!n;b.replaceChildren(icon('square'),document.createTextNode(n?t('resources.stopN',{count:n}):t('resources.stopSelected')));}
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
const PART_ICON={health:'stethoscope',stats:'gauge',disk:'scan-search'};
// Measurements run from the tiles at the top; the advisor columns below only show their results.
// A tile's button reads its verb before the first run, "…ing" while it runs, and "↻ again" afterwards.
function setPartButton(b,part){
 const [run,busyKey,again]=PART_KEYS[part],now=working.has(part),done=opened.has(part);
 b.replaceChildren(icon(done&&!now?'refresh-cw':PART_ICON[part]),document.createTextNode(now?t(busyKey):done?t(again):t(run)));b.disabled=now;b.classList.toggle('primary',!done&&!now);b.classList.toggle('stalebtn',done&&staleParts.has(part));
 if(done&&!now){b.title=t(again);b.setAttribute('aria-label',t(again));}else{b.removeAttribute('title');b.removeAttribute('aria-label');}
 return b;
}
function renderControls(){
 setPartButton($('checkHealthTile'),'health');setPartButton($('measureTile'),'stats');setPartButton($('diskTile'),'disk');
 // Each page measures from its own header too: Health, Containers.
 setPartButton($('hcCheck'),'health');setPartButton($('hcMeasure'),'stats');setPartButton($('hcDisk'),'disk');setPartButton($('containersMeasure'),'stats');
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
 if(m.resources){resources=m.resources;opened.add('stats');updateCounters();renderSuggestions();renderStats();renderProjects();renderContainers();renderOverviewLists();}
 if(m.disk){renderDisk(m.disk);opened.add('disk');}
 if(m.healthAt)opened.add('health');
 if(opened.size)await compose();
}
// Every advisor action reuses an existing flow, so starting or stopping always goes through the review dialog.
function advisorButton(a){
 const run=a&&{logs:()=>openLogs(a.project,a.service||''),details:()=>{const p=byName(a.project);if(p)inspectProject(p);},start:()=>act('start',a.projects,{review:true}),
  stop:()=>act('stop',a.projects,{title:t('resources.stopPlan'),review:true}),copy:()=>copy(a.command),ports:()=>go('ports'),
  memory:()=>go('resources'),disk:()=>go('cleanup'),refresh:()=>{refresh();checkHealth();}}[a.type];
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
$('hcCheck').onclick=checkHealth;$('hcMeasure').onclick=refreshResources;$('hcDisk').onclick=analyzeDisk;$('containersMeasure').onclick=refreshResources;

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
  for(const c of r.commands){const line=el('div','cmdrow');line.append(el('span','smalltext',tr(c.label)),el('code','',c.command),iconButton('copy',t('common.copy'),()=>copy(c.command),false));todo.append(line);}
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
 target.replaceChildren(...nodes);renderSteps();
}
// Cleanup is a guided path: analyze, review each risk, then copy a command and run it by hand.
function renderSteps(){const done=!!lastDisk;document.querySelectorAll('#cleanupSteps li').forEach(li=>{const s=Number(li.dataset.step);li.classList.toggle('done',s===1&&done);li.classList.toggle('current',done?s===2:s===1);});}

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
$('copyLogCmd').onclick=()=>{const s=$('logService').value;copy(`${PLATFORM==='win32'?'cd $env:TEMP; ':'cd /tmp && '}docker compose -p ${logProject} logs -f --tail 200${s?' '+s:''}`);};

document.querySelectorAll('.closeDialog').forEach(b=>b.onclick=()=>$('projectDialog').close());document.querySelectorAll('.closeLogs').forEach(b=>b.onclick=()=>$('logsDialog').close());
document.querySelectorAll('.closeInspect').forEach(b=>b.onclick=()=>$('inspectDialog').close());
document.querySelectorAll('[data-lang]').forEach(b=>b.onclick=()=>setLanguage(b.dataset.lang));
$('search').addEventListener('input',renderProjects);$('refresh').onclick=()=>{refresh();loadHost();};$('scan').onclick=scanDocker;$('add').onclick=()=>openProject();
$('refreshStats').onclick=refreshResources;$('analyzeDisk').onclick=analyzeDisk;$('stopSelected').onclick=()=>act('stop',[...selectedStops],{title:t('resources.stopPlan'),review:true});
function setProjectFilter(f){filter=f;document.querySelectorAll('.chip[data-filter]').forEach(x=>x.classList.toggle('selected',x.dataset.filter===f));renderProjects();}
document.querySelectorAll('.chip[data-filter]').forEach(b=>b.onclick=()=>setProjectFilter(b.dataset.filter));
// Blocks collapse from their heading (overview cards); the choice is remembered.
const collapsed=new Set(storedList('ddm.collapsed'));
function setCollapsed(section,on){
 section.classList.toggle('collapsed',on);section.querySelector('.collapser').setAttribute('aria-expanded',String(!on));
 if(on)collapsed.add(section.id);else collapsed.delete(section.id);
 storeList('ddm.collapsed',collapsed);
}
document.querySelectorAll('section.block').forEach(sec=>{const b=sec.querySelector('.collapser');if(!b)return;if(collapsed.has(sec.id)){sec.classList.add('collapsed');b.setAttribute('aria-expanded','false');}b.addEventListener('click',()=>setCollapsed(sec,!sec.classList.contains('collapsed')));});

// ---- Pages: one at a time, addressed by #name so a reload stays where you were ----
const PAGES={overview:'nav.overview',projects:'nav.projects',containers:'nav.containers',health:'nav.health',resources:'nav.resources',ports:'nav.ports',cleanup:'nav.cleanup',bitbucket:'nav.bitbucket'};
let page='overview';
function renderChrome(){
 $('crumbPage').textContent=t(PAGES[page]);document.title=`${t(PAGES[page])} · ${t('app.title')}`;
 renderThemeButton();setSidebar($('shell').classList.contains('navcollapsed'),false);
}
function showPage(name){
 page=Object.hasOwn(PAGES,name)?name:'overview';
 document.querySelectorAll('.page').forEach(sec=>{sec.hidden=sec.dataset.page!==page;});
 document.querySelectorAll('.nav[data-page]').forEach(a=>{const on=a.dataset.page===page;a.classList.toggle('active',on);if(on)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
 renderChrome();window.scrollTo(0,0);
 if(page==='ports'&&token)loadPorts($('portInput').value.trim());
 if(page==='health')requestAnimationFrame(updateFades);
 if(page==='bitbucket'&&token&&!bbMeta)loadBitbucket();
}
const go=name=>{if(location.hash.slice(1)===name)showPage(name);else location.hash=name;};
window.addEventListener('hashchange',()=>showPage(location.hash.slice(1)));
// A tile's body opens its page; the button inside it runs that tile's own measurement.
const tileGo=(id,fn)=>$(id).addEventListener('click',e=>{if(!e.target.closest('button'))fn();});
// The logo goes home; a plain click on it stays in this tab even when the Overview is already open.
$('brandHome').addEventListener('click',e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.button)return;e.preventDefault();go('overview');});
tileGo('tileHealth',()=>go('health'));tileGo('tileProjects',()=>go('projects'));
tileGo('memoryMetric',()=>go('resources'));tileGo('hostMetric',()=>go('resources'));tileGo('tileDisk',()=>go('cleanup'));

// ---- Theme: light (Calm Workspace) or dark (graphite). Unset follows macOS; the choice is saved with the language ----
const prefersDark=matchMedia('(prefers-color-scheme: dark)');
const currentTheme=()=>document.documentElement.dataset.theme||(prefersDark.matches?'dark':'light');
function renderThemeButton(){
 const dark=currentTheme()==='dark',b=$('themeToggle'),label=t(dark?'theme.toLight':'theme.toDark');
 b.replaceChildren(icon(dark?'sun':'moon'));b.title=label;b.setAttribute('aria-label',label);
 document.querySelector('meta[name=theme-color]').content=dark?'#151C1A':'#F7F8F6';
}
async function setTheme(theme){
 document.documentElement.dataset.theme=theme;renderThemeButton();
 if(token){try{workspace=await api('/api/workspace','PUT',{...workspace,language:I.lang,theme});}catch(e){toast(e.message);}}
}
$('themeToggle').onclick=()=>setTheme(currentTheme()==='dark'?'light':'dark');
prefersDark.addEventListener('change',renderThemeButton);
// The sidebar folds to icons (their names stay as tooltips); a per-browser choice.
function setSidebar(folded,save=true){
 $('shell').classList.toggle('navcollapsed',folded);
 const b=$('collapseSidebar'),label=t(folded?'nav.expand':'nav.collapse');b.replaceChildren(icon(folded?'panel-left-open':'panel-left-close'));b.title=label;b.setAttribute('aria-label',label);
 if(save)try{localStorage.setItem('ddm.sidebar',folded?'1':'');}catch{}
}
$('collapseSidebar').onclick=()=>setSidebar(!$('shell').classList.contains('navcollapsed'));

// ---- Overview: what needs attention now, and the projects at a glance (from the cheap project list) ----
function renderOverviewLists(){
 if(!loaded)return;
 renderContainerChart();
 const items=projects.flatMap(p=>p.issues.filter(i=>i.level==='error'||i.level==='warn').map(i=>({p,i})))
  .sort((a,b)=>(a.i.level==='error'?0:1)-(b.i.level==='error'?0:1)||a.p.name.localeCompare(b.p.name));
 $('attentionCount').textContent=items.length||'';
 const list=$('attentionList');
 if(!items.length){const li=el('li','allclear'),txt=el('div');txt.append(el('strong','',t('overview.allClear')),el('span','smalltext',t('overview.allClearHint')));li.append(icon('circle-check'),txt);list.replaceChildren(li);}
 else list.replaceChildren(...items.slice(0,6).map(({p,i})=>{
  const li=el('li','attn '+i.level),sev=el('span','sev'),body=el('div'),meta=el('div','attnmeta'),acts=el('div','attnactions');
  sev.append(icon(i.level==='error'?'circle-x':'triangle-alert'),t(i.level==='error'?'overview.sevError':'overview.sevWarn'));
  const proj=el('button','btn link',p.name);proj.type='button';proj.title=t('card.openDetails',{project:p.name});proj.onclick=()=>inspectProject(p);
  meta.append(proj,' · '+tr(i.hint));body.append(el('div','attntext',tr(i.text)),meta);
  if(i.service&&p.containers.some(c=>c.service===i.service))acts.append(button(t('action.log'),'mini',()=>openLogs(p.name,i.service),false,'','scroll-text'));
  li.append(sev,body,acts);return li;
 }),...(items.length>6?[(()=>{const li=el('li','attnmore');li.append(button(t('overview.moreIssues',{count:items.length}),'link',()=>{setProjectFilter('issues');go('projects');}));return li;})()]:[]));
 const recent=$('recentProjects'),sorted=[...projects].sort((a,b)=>Number(b.running>0)-Number(a.running>0)||Number(hasProblem(b))-Number(hasProblem(a))||a.name.localeCompare(b.name));
 if(!sorted.length){recent.replaceChildren(el('li','emptysmall',t('overview.noProjects')));return;}
 recent.replaceChildren(...sorted.slice(0,6).map(p=>{
  const li=el('li','prow st-'+p.status),open=el('button','projlink'),info=el('div'),usage=usageOf(p.name);open.type='button';open.title=t('card.openDetails',{project:p.name});
  open.append(el('span','projname',p.name));open.onclick=()=>inspectProject(p);
  info.append(open,el('div','pmeta',[t('card.runningOf',{running:p.running,total:p.total}),usage?.memBytes>0?t('metric.ram',{size:fmtBytes(usage.memBytes)}):''].filter(Boolean).join(' · ')));
  li.append(el('span','pdot'),info,el('span','pill '+p.status,t(STATUS_KEYS[p.status]||'status.unknown')),iconButton('chevron-right',t('card.openDetails',{project:p.name}),()=>inspectProject(p),false));
  return li;
 }));
}

// ---- Overview charts: containers per project (cheap list) and RAM per project (last measurement) ----
// One tooltip serves every bar: it follows the pointer, or sits under the row a keyboard user focused. Esc hides it.
const tip=el('div','charttip');tip.hidden=true;tip.setAttribute('role','tooltip');document.body.append(tip);
const hideTip=()=>{tip.hidden=true;};
function placeTip(x,y){const w=tip.offsetWidth,h=tip.offsetHeight;tip.style.left=Math.max(8,Math.min(x+14,innerWidth-w-8))+'px';tip.style.top=(y+16+h>innerHeight-8?y-h-12:y+16)+'px';}
function tipRow(cls,label,value){const r=el('div','tiprow');if(cls)r.append(el('i','sw '+cls));r.append(el('span','',label),el('b','',value));return r;}
function attachTip(row,focus,build){
 const fill=()=>{const [title,rows]=build();tip.replaceChildren(el('strong','',title),...rows);tip.hidden=false;};
 row.addEventListener('mouseenter',fill);row.addEventListener('mousemove',e=>placeTip(e.clientX,e.clientY));row.addEventListener('mouseleave',hideTip);
 if(focus){focus.addEventListener('focus',()=>{fill();const r=row.getBoundingClientRect();placeTip(r.left+r.width/3,r.bottom);});focus.addEventListener('blur',hideTip);}
}
addEventListener('scroll',hideTip,{passive:true});addEventListener('keydown',e=>{if(e.key==='Escape')hideTip();});
// The project list is polled every 15 s: a chart is rebuilt only when what it shows changed, so hover and focus survive.
const chartSigs={};
function chartChanged(key,data){const sig=JSON.stringify([I.lang,data]);if(chartSigs[key]===sig)return false;chartSigs[key]=sig;hideTip();return true;}
function chartEmpty(ic,text){const li=el('li','chartempty');li.append(icon(ic),el('span','',text));return li;}
function chartName(name,p){
 if(!p)return el('span','hname',name);
 const b=el('button','hname',name);b.type='button';b.title=t('card.openDetails',{project:name});b.onclick=()=>inspectProject(p);return b;
}
const CHART_ROWS=8;
// Each container counts once, in the order the bar is drawn; `created` reads as stopped.
const CHART_STATE={running:'ok',starting:'ok',unhealthy:'warn',paused:'warn',failed:'bad',restarting:'bad',stopped:'off',created:'off'};
const CHART_SERIES=[['ok','overview.legendRunning'],['warn','overview.legendWarn'],['bad','overview.legendBad'],['off','overview.legendStopped']];
function renderContainerChart(){
 const rows=projects.map(p=>{
  const n={ok:0,warn:0,bad:0,off:0},core=p.containers.filter(c=>!c.oneoff);for(const c of core)n[CHART_STATE[containerState(c)]||'off']++;
  return {name:p.name,n,total:core.length,up:core.filter(c=>c.state==='running').length};
 }).filter(r=>r.total).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));
 const count=rows.reduce((s,r)=>s+r.total,0),up=rows.reduce((s,r)=>s+r.up,0),shown=rows.slice(0,CHART_ROWS);
 if(!chartChanged('containers',[shown,count,up]))return;
 $('containerChartSum').textContent=count?t('overview.chartSum',{running:up,count}):'';
 $('containerChartMore').textContent=rows.length>CHART_ROWS?t('common.more',{count:rows.length-CHART_ROWS}):'';
 const list=$('containerChart');
 if(!rows.length)return list.replaceChildren(chartEmpty('box',t('containers.empty')));
 const max=rows[0].total;
 list.replaceChildren(...shown.map(r=>{
  const p=byName(r.name),row=el('li','hrow'),name=chartName(r.name,p),track=el('div'),bar=el('div','hbar');
  bar.style.width=r.total/max*100+'%';bar.setAttribute('role','img');
  bar.setAttribute('aria-label',t('overview.barContainers',{project:r.name,up:r.up,total:r.total,ok:r.n.ok,warn:r.n.warn,bad:r.n.bad,stopped:r.n.off}));
  for(const [k] of CHART_SERIES)if(r.n[k]){const seg=el('span','s-'+k);seg.style.flex=`${r.n[k]} 1 0`;bar.append(seg);}
  track.append(bar);row.append(name,track,el('span','hval',`${r.up}/${r.total}`));
  attachTip(row,p?name:null,()=>[r.name,CHART_SERIES.filter(([k])=>r.n[k]).map(([k,key])=>tipRow('s-'+k,t(key),String(r.n[k])))]);
  return row;
 }));
}
// Standalone containers have no project; their memory is one muted row so the bars add up to the tile above.
function renderMemoryChart(){
 const list=$('memoryChart');
 if(!resources){
  if(!chartChanged('memory',working.has('stats')))return;
  $('memoryChartSum').textContent='';$('memoryChartMore').textContent='';
  return list.replaceChildren(chartEmpty('gauge',t(working.has('stats')?'metric.measuring':'overview.memNotMeasured')));
 }
 const vmTotal=(hostData?.vm||resources.vm||{}).memTotal||0,loose=resources.containers.filter(c=>!c.project);
 const rows=resources.projects.filter(r=>r.memBytes>0).map(r=>({name:r.name,mem:r.memBytes,cpu:r.cpuPercent,project:true}));
 const looseMem=loose.reduce((s,c)=>s+c.memBytes,0);
 if(looseMem>0)rows.push({name:t('overview.standalone'),mem:looseMem,cpu:Math.round(loose.reduce((s,c)=>s+c.cpuPercent,0)*100)/100,project:false});
 rows.sort((a,b)=>b.mem-a.mem);
 const shown=rows.slice(0,CHART_ROWS);
 if(!chartChanged('memory',[shown,vmTotal,resources.measuredAt,resources.totals.memBytes]))return;
 $('memoryChartSum').textContent=[fmtBytes(resources.totals.memBytes),t('resources.measuredAt',{time:clock(resources.measuredAt)})].join(' · ');
 $('memoryChartMore').textContent=rows.length>CHART_ROWS?t('common.more',{count:rows.length-CHART_ROWS}):'';
 if(!rows.length)return list.replaceChildren(chartEmpty('gauge',t('resources.noRunning')));
 const max=rows[0].mem,share=m=>vmTotal?(m/vmTotal<.01?'<1%':Math.round(m/vmTotal*100)+'%'):'';
 list.replaceChildren(...shown.map(r=>{
  const p=r.project?byName(r.name):null,row=el('li','hrow'),name=chartName(r.name,p),track=el('div'),bar=el('div','hbar'),val=el('span','hval',fmtBytes(r.mem));
  bar.style.width=r.mem/max*100+'%';bar.setAttribute('role','img');bar.setAttribute('aria-label',t('overview.barMemory',{project:r.name,size:fmtBytes(r.mem),pct:share(r.mem)||'—',cpu:r.cpu.toFixed(1)}));
  bar.append(el('span','s-mem'));bar.firstChild.style.flex='1';
  if(vmTotal)val.append(el('small','',share(r.mem)));
  track.append(bar);row.append(name,track,val);
  attachTip(row,p?name:null,()=>[r.name,[tipRow('s-mem',t('overview.tipRam'),fmtBytes(r.mem)),...(vmTotal?[tipRow('',t('overview.tipVm'),share(r.mem))]:[]),tipRow('',t('overview.tipCpu'),r.cpu.toFixed(1)+'%')]]);
  return row;
 }));
}

// ---- Bitbucket SSH: Git over SSH moves to ssh.bitbucket.org ----
// The check reads only and runs on click; each fix shows exactly what changes and backs the file up first.
let bb=null,bbMeta=null,bbChecking=false,bbFix=null;
const BB_TEST={ok:'bb.tOk',hostKey:'bb.tHostKey',denied:'bb.tDenied',unreachable:'bb.tUnreachable'};
const BB_VERDICT={ok:['bb.vOk','ok'],alias:['bb.vAlias','fix'],direct:['bb.vDirect','fix']};
async function loadBitbucket(){try{const r=await api('/api/bitbucket');bbMeta=r;bb=r.check;renderBitbucket();}catch{}}
function bbChip(level,text){const c=el('span','bbstate '+level);c.append(el('i','',level==='ok'?'●':level==='fix'?'✕':'–'),document.createTextNode(text));return c;}
function bbStep(n,title,state){const card=el('section','card bbstep'),head=el('div','bbstephead');head.append(el('span','bbnum',String(n)),el('h3','',title));if(state)head.append(state);card.append(head);return card;}
function renderBitbucket(){
 const body=$('bbBody');if(!body)return;
 const b=$('bbCheck');b.disabled=bbChecking;b.replaceChildren(icon('scan-search'),document.createTextNode(t(bbChecking?'bb.checking':bb?'bb.recheck':'bb.check')));
 if(bbMeta){
  const date=new Date(bbMeta.deadline+'T00:00:00Z').toLocaleDateString(I.lang,{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}),days=Math.ceil((Date.parse(bbMeta.deadline+'T00:00:00Z')-Date.now())/86400000);
  $('bbLead').textContent=days>0?t('bb.lead',{date,count:days}):t('bb.leadAfter',{date});
 }
 if(bbChecking&&!bb){const c=el('div','card bbstep');c.append(el('p','smalltext',t('bb.scanning')),el('div','skel line'),el('div','skel line'));return body.replaceChildren(c);}
 if(!bb){
  const c=el('section','card bbstep'),list=el('ul','bbintro');c.append(el('h3','',t('bb.introTitle')));
  for(const k of ['bb.intro1','bb.intro2','bb.intro3','bb.intro4']){const li=el('li');renderRich(li,t(k));list.append(li);}
  c.append(list,el('p','smalltext',t('bb.introNote')));return body.replaceChildren(c);
 }
 const summary=el('div','bbsummary '+(bb.ready?'ok':'fix'));
 summary.append(icon(bb.ready?'circle-check':'triangle-alert'),el('strong','',bb.ready?t('bb.ready'):t('bb.notReady',{count:bb.fixes})),
  el('span','smalltext',t('bb.checkedLine',{time:clock(bb.checkedAt),repos:bb.repos,roots:bb.roots.map(shortPath).join(', ')})));
 // [1] Host key
 const s1=bbStep(1,t('bb.step1'),bbChip(bb.hostKey?'ok':'fix',t(bb.hostKey?'bb.vOk':'bb.vMissing')));
 const p1=el('p');renderRich(p1,t(bb.hostKey?'bb.keyOk':'bb.keyMissing',{file:shortPath(bb.keyFile)}));s1.append(p1);
 if(!bb.hostKey)s1.append(button(t('bb.addKey'),'primary',()=>reviewBitbucket('hostKey'),bbChecking,'','plus'));
 // [2] Repositories reaching Bitbucket over SSH
 const fixHosts=bb.hosts.filter(h=>h.verdict!=='ok'),s2=bbStep(2,t('bb.step2'),bb.hosts.length?bbChip(fixHosts.length?'fix':'ok',fixHosts.length?t('bb.notReady',{count:fixHosts.length}):t('bb.vOk')):bbChip('ok',t('bb.vOk')));
 if(!bb.hosts.length)s2.append(el('p','',t('bb.noSsh')));
 else{
  const wrap=el('div','tablewrap'),table=el('table'),head=el('tr'),tbody=el('tbody');
  for(const k of ['bb.colHost','bb.colResolves','bb.colRemotes','col.state'])head.append(el('th','',t(k)));
  for(const h of bb.hosts){
   const row=el('tr'),[key,level]=BB_VERDICT[h.verdict],repos=el('details','bbrepos'),sum=el('summary','',t('bb.remoteCount',{count:h.remotes.length})),list=el('ul');
   for(const r of h.remotes){const li=el('li');li.append(el('strong','',shortPath(r.repo)),el('code','',`${r.remote} ${r.url}`));list.append(li);}
   repos.append(sum,list);const rc=el('td');rc.append(repos);const sc=el('td');sc.append(bbChip(level,t(key)));
   row.append(el('td','mono',h.host),el('td','mono',h.resolved),rc,sc);tbody.append(row);
  }
  table.append(el('thead'),tbody);table.firstChild.append(head);wrap.append(table);s2.append(wrap);
  const acts=el('div','bbactions');
  if(bb.hosts.some(h=>h.verdict==='alias'))acts.append(button(t('bb.fixConfig'),'primary',()=>reviewBitbucket('sshConfig'),bbChecking,'','pencil'));
  const direct=bb.hosts.filter(h=>h.verdict==='direct').reduce((n,h)=>n+h.remotes.length,0);
  if(direct)acts.append(button(t('bb.fixRemotes',{count:direct}),'primary',()=>reviewBitbucket('remotes'),bbChecking,'','pencil'));
  if(acts.childNodes.length)s2.append(acts);
 }
 if(bb.https)s2.append(el('p','smalltext',t('bb.https',{count:bb.https})));
 const steps=[summary,s1,s2];
 // [3] A real connection through the new hostname
 if(bb.hosts.length){
  const bad=bb.hosts.filter(h=>h.test!=='ok').length,s3=bbStep(3,t('bb.step3'),bbChip(bad?'fix':'ok',bad?t('bb.notReady',{count:bad}):t('bb.vOk'))),list=el('ul','bbtests');
  for(const h of bb.hosts){const li=el('li');li.append(el('span','mono',h.host),bbChip(h.test==='ok'?'ok':'fix',t(BB_TEST[h.test]||'bb.tUnreachable')));list.append(li);}
  s3.append(list);steps.push(s3);
 }
 // [4] Hard-coded old host: shown, never edited
 const found=bb.hardcoded.length||bb.crontab,s4=bbStep(bb.hosts.length?4:3,t('bb.step4'),bbChip(found?'info':'ok',found?t('bb.reviewHand'):t('bb.noneFound')));
 if(found){const list=el('ul','bbfiles');for(const f of bb.hardcoded)list.append(el('li','mono',shortPath(f)));if(bb.crontab){const li=el('li');renderRich(li,t('bb.crontab'));list.append(li);}s4.append(list);}
 steps.push(s4);body.replaceChildren(...steps);
}
async function checkBitbucket(){
 if(bbChecking)return;bbChecking=true;renderBitbucket();
 try{bb=(await api('/api/bitbucket/check','POST',{})).check;}catch(e){toast(e.message);}
 finally{bbChecking=false;renderBitbucket();}
}
// The dialog shows the exact change the server would make; Apply asks it to do just that.
async function reviewBitbucket(action){
 let plan;try{plan=(await api('/api/bitbucket/fix','POST',{action})).result;}catch(e){return toast(e.message);}
 bbFix=action;const body=$('bbDialogBody');body.replaceChildren();let canApply=true;
 if(action==='hostKey'){
  $('bbDialogTitle').textContent=t('bb.reviewKey');renderRich($('bbDialogText'),t('bb.reviewKeyText',{file:shortPath(plan.file)}));
  const tb=el('table'),rows=el('tbody');for(const k of plan.keys){const tr=el('tr');tr.append(el('td','mono',k.type),el('td','mono',k.fingerprint));rows.append(tr);}tb.append(rows);body.append(tb);
 }else if(action==='sshConfig'){
  $('bbDialogTitle').textContent=t('bb.reviewConfig');renderRich($('bbDialogText'),t('bb.reviewConfigText',{file:shortPath(plan.file)}));
  if(!plan.changes.length){canApply=false;const p=el('p','alert');renderRich(p,t('bb.noConfigChange',{file:shortPath(plan.file)}));body.append(p);}
  for(const c of plan.changes){const d=el('div','bbdiff');d.append(el('span','smalltext',t('bb.lineChange',{line:c.line})),el('code','del',c.before.trim()),el('code','add',c.after.trim()));body.append(d);}
 }else{
  $('bbDialogTitle').textContent=t('bb.reviewRemotes');renderRich($('bbDialogText'),t('bb.reviewRemotesText'));
  for(const r of plan.items){const d=el('div','bbdiff');d.append(el('strong','',`${shortPath(r.repo)} · ${r.remote}`),el('code','del',r.url),el('code','add',r.next));body.append(d);}
 }
 if(plan.backup){const p=el('p','smalltext');renderRich(p,t('bb.backup',{file:shortPath(plan.backup)}));body.append(p);}
 $('bbApply').disabled=!canApply;$('bbDialog').showModal();
}
$('bbApply').onclick=async()=>{
 const action=bbFix;$('bbApply').disabled=true;
 try{
  const r=(await api('/api/bitbucket/fix','POST',{action,apply:true})).result;$('bbDialog').close();
  const failed=(r.items||[]).filter(i=>!i.ok);
  toast(failed.length?failed.map(i=>t('bb.remoteFailed',{repo:shortPath(i.repo),error:i.error})).join(' · '):t(r.skipped?'bb.alreadyDone':'bb.applied'));
  await checkBitbucket();
 }catch(e){toast(e.message);$('bbApply').disabled=false;}
};
for(const id of ['bbDialogClose','bbDialogCancel'])$(id).onclick=()=>$('bbDialog').close();
$('bbCheck').onclick=checkBitbucket;

// ---- Containers: every container of every project in one table, with the same controls as the cards ----
let cfilter='all';
const PROBLEM_STATES=new Set(['failed','restarting','unhealthy']);
function renderContainers(){
 if(!loaded)return;
 const q=$('containerSearch').value.trim().toLowerCase(),all=projects.flatMap(p=>p.containers.filter(c=>!c.oneoff).map(c=>({p,c,s:containerState(c)})));
 const isRunning=x=>x.c.state==='running',isProblem=x=>PROBLEM_STATES.has(x.s),isStopped=x=>!isRunning(x)&&!isProblem(x),count=f=>all.filter(f).length;
 $('cAll').textContent=all.length;$('cRunning').textContent=count(isRunning);$('cStopped').textContent=count(isStopped);$('cProblems').textContent=count(isProblem);
 $('containersSummary').textContent=t('containers.summary',{count:all.length,running:count(isRunning)});
 const shown=all.filter(x=>cfilter==='all'||(cfilter==='running'&&isRunning(x))||(cfilter==='stopped'&&isStopped(x))||(cfilter==='problems'&&isProblem(x)))
  .filter(x=>!q||[x.c.service,x.c.name,x.p.name,x.c.image,...x.c.ports.map(b=>String(b.port))].join(' ').toLowerCase().includes(q))
  .sort((a,b)=>Number(isProblem(b))-Number(isProblem(a))||Number(isRunning(b))-Number(isRunning(a))||a.p.name.localeCompare(b.p.name)||(a.c.service||a.c.name).localeCompare(b.c.service||b.c.name));
 const tbody=$('containerRows');
 if(!shown.length)return messageRow(tbody,t(all.length?'containers.none':'containers.empty'),7);
 tbody.replaceChildren(...shown.map(({p,c})=>{
  const row=el('tr',stateDot(c)),name=el('td','cname'),proj=el('td'),st=el('td'),ports=el('td'),act=el('td');
  name.append(el('strong','',c.service||c.name));if(c.service&&c.name!==c.service)name.append(el('span','',c.name));name.title=c.image;
  const pb=el('button','linkish',p.name);pb.type='button';pb.title=t('card.openDetails',{project:p.name});pb.onclick=()=>inspectProject(p);proj.append(pb);
  st.append(stateBadge(c));
  const usage=resources?.containers.find(x=>String(x.id).slice(0,12)===c.id),list=uniquePorts(c);
  const wrap=el('div','ports');list.forEach(port=>wrap.append(portLink(port)));ports.append(list.length?wrap:document.createTextNode('—'));
  act.append(containerButtons(p,c));
  row.append(name,proj,st,el('td','',c.state==='running'&&usage?`${usage.cpuPercent.toFixed(1)}% · ${fmtBytes(usage.memBytes)}`:'—'),ports,
   el('td','smalltext',c.state==='running'?fmtSince(c.startedAt):c.finishedAt?t('cstate.ago',{time:fmtSince(c.finishedAt)}):'—'),act);
  return row;
 }));
}
document.querySelectorAll('.chip[data-cfilter]').forEach(b=>b.onclick=()=>{cfilter=b.dataset.cfilter;document.querySelectorAll('.chip[data-cfilter]').forEach(x=>x.classList.toggle('selected',x===b));renderContainers();});
$('containerSearch').addEventListener('input',renderContainers);
// Only cheap views are polled, and only while the page is visible: the project list (`docker ps` +
// `inspect`, ~0.3 s) and this Mac's memory. Stats, disk and the advisor wait for a click.
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastRefresh>5000){refresh();loadHost();}});
(async()=>{
 try{const [vi,en]=await Promise.all(['vi','en'].map(l=>fetch(`/locales/${l}.json`).then(r=>r.json())));DICTS={vi,en};}catch{}
 // The server writes the saved language into the page; this browser's own copy is only a fallback.
 // Read before setLanguage() writes it, so merely opening the page never creates a config file.
 let folded=false;try{folded=localStorage.getItem('ddm.sidebar')==='1';}catch{}
 setSidebar(folded,false);showPage(location.hash.slice(1));renderSteps();
 const saved=document.documentElement.dataset.savedLang||'',local=storedLanguage();
 await setLanguage(saved||local,false);
 try{
  token=(await api('/api/session')).token;
  workspace=await api('/api/workspace');
  // The config file wins; a choice made before it was saved there (or on another URL) is written once.
  if(workspace.language&&workspace.language!==I.lang)await setLanguage(workspace.language,false);
  else if(!workspace.language&&I18N.valid(local))await setLanguage(I.lang,true);
  await refresh();renderAdvisorAll();loadHost();loadPorts();restoreMeasurements();
  api('/api/network-check').then(r=>{netCheck=r.check;renderNetCheck();},()=>{});
  if(page==='bitbucket')loadBitbucket();
  setInterval(()=>{if(!document.hidden){refresh();loadHost();}},15000);
 }catch(e){alertMessage(e.message);}
})();
