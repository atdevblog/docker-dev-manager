'use strict';
// Commands that differ per operating system. The macOS expectations are the exact commands the
// dashboard ran before Windows support existed: they must never change by accident.
const test=require('node:test');const assert=require('node:assert/strict');
const P=require('../lib/platform'),A=require('../lib/analysis');

test('macOS: Terminal, Finder and VS Code open exactly as before',()=>{
 assert.deepEqual(P.terminalLaunch('darwin',{script:'/tmp/ddm/web-1-ab12cd34.command'}),{file:'open',args:['-a','Terminal','/tmp/ddm/web-1-ab12cd34.command'],options:{timeout:10000}});
 assert.deepEqual(P.terminalLaunch('darwin',{dir:'/Users/me/Projects/shop'}),{file:'open',args:['-a','Terminal','/Users/me/Projects/shop'],options:{timeout:10000}});
 assert.deepEqual(P.openInLaunch('darwin','finder','/Users/me/My Shop'),{file:'open',args:['/Users/me/My Shop'],options:{timeout:10000}});
 assert.deepEqual(P.openInLaunch('darwin','terminal','/Users/me/My Shop'),{file:'open',args:['-a','Terminal','/Users/me/My Shop'],options:{timeout:10000}});
 assert.deepEqual(P.openInLaunch('darwin','vscode','/Users/me/My Shop'),{file:'open',args:['-a','Visual Studio Code','/Users/me/My Shop'],options:{timeout:10000}});
});
test('macOS: the container shell script is unchanged, with the Telex hint and bash when available',()=>{
 assert.equal(P.macShellScript({docker:'/usr/local/bin/docker',target:'shop-web-1',hint:"Gõ tiếng Việt: hãy tắt Telex"}),
  "#!/bin/sh\nclear\nif defaults read com.apple.HIToolbox AppleSelectedInputSources 2>/dev/null | grep -q Vietnamese; then printf '\\033[33m%s\\033[0m\\n\\n' 'Gõ tiếng Việt: hãy tắt Telex'; fi\n"+
  "exec /usr/local/bin/docker exec -it shop-web-1 sh -c 'command -v bash >/dev/null 2>&1 && exec bash || exec sh'\n");
 assert.match(P.macShellScript({docker:'/opt/my docker/docker',target:'abc123def456',hint:"it's"}),/printf '[^\n]*' 'it'\\''s'; fi\nexec '\/opt\/my docker\/docker' exec -it abc123def456 /);
});
test('macOS: the folder picker runs choose folder in osascript, texts passed as arguments',()=>{
 assert.deepEqual(P.pickFolderLaunch('darwin',{prompt:'Chọn thư mục',start:'/Users/me/Projects'}),{file:'osascript',args:['-e','on run argv','-e','tell me to activate','-e','return POSIX path of (choose folder with prompt (item 1 of argv) default location (POSIX file (item 2 of argv)))','-e','end run','Chọn thư mục','/Users/me/Projects'],options:{timeout:600000}});
 assert.equal(P.pickedFolder('darwin','/Users/me/Projects/shop/\n'),'/Users/me/Projects/shop');
 assert.equal(P.pickedFolder('darwin','/\n'),'/');
 assert.ok(P.pickCancelled('darwin',{stderr:'execution error: User canceled. (-128)'}));
 assert.ok(!P.pickCancelled('darwin',{stderr:'osascript: command not found'}));
});
test('macOS and Linux: commands to copy run label mode from /tmp, exactly as before',()=>{
 for(const platform of ['darwin','linux',undefined]){
  assert.deepEqual(A.cliCommands({name:'shop',managed:false,sources:[{directory:'/w/My Shop',files:['/w/My Shop/compose.yaml']}]},platform).map(c=>c.command),[
   'cd /tmp && docker compose -p shop ps -a','cd /tmp && docker compose -p shop logs -f --tail 200','cd /tmp && docker compose -p shop start','cd /tmp && docker compose -p shop stop','cd /tmp && docker compose -p shop restart',
   "cd '/w/My Shop' && docker compose -p shop -f '/w/My Shop/compose.yaml' up -d"]);
  assert.deepEqual(A.cliCommands({name:'erp',managed:true,directory:'/w/erp',composeFile:'docker-compose.yml',sources:[]},platform).map(c=>c.command),[
   'cd /w/erp && docker compose -p erp -f docker-compose.yml ps -a','cd /w/erp && docker compose -p erp -f docker-compose.yml logs -f --tail 200','cd /tmp && docker compose -p erp start','cd /tmp && docker compose -p erp stop',
   'cd /w/erp && docker compose -p erp -f docker-compose.yml up -d','cd /w/erp && docker compose -p erp -f docker-compose.yml down']);
 }
});
test('macOS and Linux: paths reported by Docker are used as they are',()=>{
 for(const platform of ['darwin','linux'])for(const p of ['/Users/me/app','/run/desktop/mnt/host/c/x','/mnt/c/x','/host_mnt/c/x'])assert.equal(P.hostPath(p,platform),p);
 const c={Id:'abc123def456aa',Name:'/shop-web-1',Config:{WorkingDir:'/app/src',Labels:{}},State:{Status:'running'},Mounts:[{Type:'bind',Source:'/Users/me/shop',Destination:'/app'}]};
 assert.equal(A.normalizeContainer(c,'darwin').sourceDir,'/Users/me/shop/src');assert.deepEqual(A.normalizeContainer(c,'darwin').binds,['/Users/me/shop']);
 assert.equal(A.normalizeContainer(c).sourceDir,'/Users/me/shop/src');
});
test('which systems can open terminals, folders and the folder picker',()=>{
 assert.deepEqual(P.supports('darwin'),{terminal:true,pickFolder:true,openIn:true});
 assert.deepEqual(P.supports('win32'),{terminal:true,pickFolder:true,openIn:true});
 assert.deepEqual(P.supports('linux'),{terminal:false,pickFolder:false,openIn:false});
});

// ---- Windows ----
test('Windows: Docker Desktop paths map back to drive letters',()=>{
 assert.equal(P.hostPath('/run/desktop/mnt/host/c/Users/me/shop','win32'),'C:\\Users\\me\\shop');
 assert.equal(P.hostPath('/host_mnt/d/work/api','win32'),'D:\\work\\api');
 assert.equal(P.hostPath('/mnt/c/Users/me','win32'),'C:\\Users\\me');
 assert.equal(P.hostPath('/run/desktop/mnt/host/c','win32'),'C:\\');
 assert.equal(P.hostPath('C:\\Users\\me\\shop','win32'),'C:\\Users\\me\\shop');
 assert.equal(P.hostPath('/home/me/proj','win32'),'/home/me/proj');
 const c={Id:'abc123def456aa',Name:'/shop-web-1',Config:{WorkingDir:'/app/src',Labels:{}},State:{Status:'running'},Mounts:[{Type:'bind',Source:'/run/desktop/mnt/host/c/Users/me/shop',Destination:'/app'}]};
 assert.equal(A.normalizeContainer(c,'win32').sourceDir,'C:\\Users\\me\\shop\\src');assert.deepEqual(A.normalizeContainer(c,'win32').binds,['C:\\Users\\me\\shop']);
});
test('Windows: terminals open in a new console window through start, every value quoted',()=>{
 assert.deepEqual(P.terminalLaunch('win32',{target:'shop-web-1'}),{file:'cmd.exe',
  args:['/d','/v:off','/c','start "" "docker" "exec" "-it" "shop-web-1" "sh" "-c" "command -v bash >/dev/null 2>&1 && exec bash || exec sh"'],
  options:{windowsVerbatimArguments:true,timeout:10000}});
 assert.deepEqual(P.terminalLaunch('win32',{dir:'C:\\Users\\me\\My Shop & Co'}).args,['/d','/v:off','/c','start "" /D "C:\\Users\\me\\My Shop & Co" "powershell.exe" "-NoExit"']);
 assert.equal(P.terminalLaunch('win32',{dir:'C:\\'}).args[3],'start "" /D "C:\\\\" "powershell.exe" "-NoExit"','a trailing backslash cannot escape the closing quote');
 for(const bad of ['C:\\100%\\x','C:\\a"b','C:\\a\nb'])assert.throws(()=>P.terminalLaunch('win32',{dir:bad}),e=>e.code==='UNSAFE_ARG',bad);
});
test('Windows: File Explorer, Terminal and VS Code',()=>{
 assert.deepEqual(P.openInLaunch('win32','finder','C:\\Users\\me\\shop'),{file:'explorer.exe',args:['C:\\Users\\me\\shop'],options:{timeout:10000},okExitCodes:[1]});
 assert.deepEqual(P.openInLaunch('win32','terminal','C:\\Users\\me\\shop').args,['/d','/v:off','/c','start "" /D "C:\\Users\\me\\shop" "powershell.exe" "-NoExit"']);
 const code=P.openInLaunch('win32','vscode','C:\\Users\\me\\shop',{LOCALAPPDATA:'C:\\Users\\me\\AppData\\Local',ProgramFiles:'C:\\Program Files','ProgramFiles(x86)':'C:\\Program Files (x86)'});
 assert.deepEqual(code.candidates,['C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe','C:\\Program Files\\Microsoft VS Code\\Code.exe','C:\\Program Files (x86)\\Microsoft VS Code\\Code.exe']);
 assert.deepEqual(code.args,['C:\\Users\\me\\shop']);assert.equal(code.detached,true);
 assert.deepEqual(code.fallback,{file:'cmd.exe',args:['/d','/v:off','/c','code "C:\\Users\\me\\shop"'],options:{windowsVerbatimArguments:true,windowsHide:true,timeout:15000}});
});
test('Windows: the folder picker is a PowerShell dialog, texts passed through the environment',()=>{
 const l=P.pickFolderLaunch('win32',{prompt:'Chọn "thư mục" $(rm -rf)',start:'C:\\Users\\me\\Projects'});
 assert.equal(l.file,'powershell.exe');assert.deepEqual(l.args.slice(0,6),['-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-EncodedCommand']);
 const script=Buffer.from(l.args[6],'base64').toString('utf16le');
 assert.match(script,/FolderBrowserDialog/);assert.match(script,/\$env:DDM_PROMPT/);assert.ok(!script.includes('rm -rf'),'texts never enter the script');
 assert.deepEqual(l.env,{DDM_PROMPT:'Chọn "thư mục" $(rm -rf)',DDM_START:'C:\\Users\\me\\Projects'});
 assert.equal(l.options.timeout,600000);assert.equal(l.options.windowsHide,true);
 assert.equal(P.pickedFolder('win32','C:\\Users\\me\\shop\r\n'),'C:\\Users\\me\\shop');
 assert.equal(P.pickedFolder('win32','D:\\\r\n'),'D:\\');
 assert.equal(P.pickedFolder('win32','\r\n'),'');
});
test('Windows: commands to copy are PowerShell, from the temp folder',()=>{
 assert.deepEqual(A.cliCommands({name:'shop',managed:false,sources:[{directory:'C:\\w\\My Shop',files:['C:\\w\\My Shop\\compose.yaml']}]},'win32').map(c=>c.command),[
  'cd $env:TEMP; docker compose -p shop ps -a','cd $env:TEMP; docker compose -p shop logs -f --tail 200','cd $env:TEMP; docker compose -p shop start','cd $env:TEMP; docker compose -p shop stop','cd $env:TEMP; docker compose -p shop restart',
  "cd 'C:\\w\\My Shop'; docker compose -p shop -f 'C:\\w\\My Shop\\compose.yaml' up -d"]);
 assert.equal(A.cliCommands({name:'erp',managed:true,directory:"C:\\Bob's\\erp",composeFile:'docker-compose.yml',sources:[]},'win32')[0].command,"cd 'C:\\Bob''s\\erp'; docker compose -p erp -f docker-compose.yml ps -a");
});
test('Windows: listening ports from netstat, process names from tasklist',()=>{
 const netstat=`
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1012
  TCP    127.0.0.1:5432         0.0.0.0:0              ABHÖREN         4420
  TCP    192.168.1.5:52100      140.82.112.4:443       ESTABLISHED     8800
  TCP    [::]:445               [::]:0                 LISTENING       4
  TCP    [::1]:4173             [::]:0                 LISTENING       9000
  UDP    0.0.0.0:5353           *:*                                    2200
`;
 const tasklist='"svchost.exe","1012","Services","0","12,345 K"\r\n"postgres.exe","4420","Console","1","40,000 K"\r\n"System","4","Services","0","100 K"\r\n';
 assert.deepEqual(A.parseNetstat(netstat,A.parseTasklist(tasklist)),[
  {pid:1012,command:'svchost.exe',ip:'0.0.0.0',port:135},{pid:4420,command:'postgres.exe',ip:'127.0.0.1',port:5432},
  {pid:4,command:'System',ip:'0.0.0.0',port:445},{pid:9000,command:'',ip:'::1',port:4173}]);
});

// ---- Network traffic counters for the sidebar ----
test('macOS: network bytes come from the en* link rows of netstat -ibn, loopback and virtual ones left out',()=>{
 const text=`Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0        16384 <Link#1>                      22384578     0 78741018998 22384578     0 78741018998     0
lo0        16384 127           127.0.0.1       22384578     - 78741018998 22384578     - 78741018998     -
en1        1500  <Link#10>   36:fa:25:72:40:40        0     0          0        0     0          0     0
bridge0    1500  <Link#15>   36:fa:25:72:40:40        5     0       5000        5     0       5000     0
en0        1500  <Link#14>   2a:a6:53:97:62:83 244684226     0 307413964015 64979325     0 19700319868     0
en0        1500  172.20.10/28  172.20.10.2     244684226     - 307413964015 64979325     - 19700319868     -
utun3      1380  <Link#22>                          900     0     900000      800     0     800000     0
en7        1500  <Link#30>   aa:bb:cc:dd:ee:ff       10     0       1000       10     0       2000     0`;
 assert.deepEqual(A.parseNetstatIb(text),{rx:307413965015,tx:19700321868});
 assert.equal(A.parseNetstatIb('Name Mtu Network Address\nlo0 16384 <Link#1> 1 0 2 3 0 4 0'),null);
});
test('Linux: network bytes from /proc/net/dev, loopback, Docker and VPN interfaces left out',()=>{
 const text=`Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 9000000   100    0    0    0     0          0         0  9000000   100    0    0    0     0       0          0
  eth0: 123456789  5000    0    0    0     0          0         0 98765432   4000    0    0    0     0       0          0
 wlan0: 1000       10    0    0    0     0          0         0 2000         20    0    0    0     0       0          0
docker0: 5555      5    0    0    0     0          0         0 6666          6    0    0    0     0       0          0
veth12ab: 7777     7    0    0    0     0          0         0 8888          8    0    0    0     0       0          0
   wg0: 4444       4    0    0    0     0          0         0 3333          3    0    0    0     0       0          0`;
 assert.deepEqual(A.parseProcNetDev(text),{rx:123457789,tx:98767432});
});
test('Windows: network bytes from netstat -e, whatever the language of its labels',()=>{
 assert.deepEqual(A.parseNetstatE(`Interface Statistics\r\n\r\n                           Received            Sent\r\n\r\nBytes                    1234567890       987654321\r\nUnicast packets             5000000         4000000\r\n`),{rx:1234567890,tx:987654321});
 assert.deepEqual(A.parseNetstatE(`Schnittstellenstatistik\r\n\r\n                           Empfangen        Gesendet\r\n\r\nBytes                       4242            2121\r\n`),{rx:4242,tx:2121});
 assert.equal(A.parseNetstatE('nothing here'),null);
});
test('network check: middle of three tries per target, rated by the fastest target that answered',()=>{
 assert.equal(A.rateLatency(12),'fast');assert.equal(A.rateLatency(49.9),'fast');assert.equal(A.rateLatency(50),'ok');assert.equal(A.rateLatency(150),'ok');assert.equal(A.rateLatency(151),'slow');
 assert.equal(A.rateLatency(null),'offline');assert.equal(A.rateLatency(Infinity),'offline');
 assert.deepEqual(A.networkCheck([{name:'Docker Hub',host:'registry-1.docker.io',tries:[90,40,300]},{name:'Cloudflare',host:'1.1.1.1',tries:[20,18,25]}]),
  {targets:[{name:'Docker Hub',host:'registry-1.docker.io',ms:90,level:'ok'},{name:'Cloudflare',host:'1.1.1.1',ms:20,level:'fast'}],ms:20,level:'fast'});
 assert.deepEqual(A.networkCheck([{name:'Docker Hub',host:'h',tries:[null,null,null]},{name:'Cloudflare',host:'c',tries:[200,180,null]}]),
  {targets:[{name:'Docker Hub',host:'h',ms:null,level:'offline'},{name:'Cloudflare',host:'c',ms:180,level:'slow'}],ms:180,level:'slow'});
 assert.equal(A.networkCheck([{name:'a',host:'a',tries:[null,null,null]},{name:'b',host:'b',tries:[null]}]).level,'offline');
 assert.equal(A.networkCheck([{name:'a',host:'a',tries:[null,null,null]},{name:'b',host:'b',tries:[null]}]).ms,null);
});
test('disk: macOS free space includes purgeable space, as System Settings shows it',()=>{
 assert.deepEqual(A.diskView({total:994.66e9,free:325.74e9,important:348.18e9,path:'/Users/me'}),{total:994.66e9,free:348.18e9,used:994.66e9-348.18e9,purgeable:348.18e9-325.74e9,path:'/Users/me'});
 assert.deepEqual(A.diskView({total:500e9,free:100e9,important:null,path:'C:\\Users\\me'}),{total:500e9,free:100e9,used:400e9,purgeable:0,path:'C:\\Users\\me'},'Windows and Linux: statfs as it is');
 assert.equal(A.diskView({total:500e9,free:100e9,important:900e9,path:'/'}).free,500e9,'never more free than the drive holds');
 assert.equal(A.diskView({total:0,free:0,important:null,path:'/'}),null);
});
