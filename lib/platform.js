'use strict';
// Everything that differs between macOS, Windows and Linux, as pure functions: the server runs what
// they return, and test/platform.test.js pins the exact commands per system, so macOS never changes
// by accident when another system is added.
const path=require('node:path');

const SHELL_IN_CONTAINER='command -v bash >/dev/null 2>&1 && exec bash || exec sh';
const MAC_APPS={finder:null,terminal:'Terminal',vscode:'Visual Studio Code'};
function shellQuote(value){return /^[A-Za-z0-9_\/.,:=@%+-]+$/.test(value)?value:`'${String(value).replace(/'/g,`'\\''`)}'`;}

// Linux has no single terminal or file manager to target, so those buttons stay macOS and Windows only.
function supports(platform){const on=platform==='darwin'||platform==='win32';return {terminal:on,pickFolder:on,openIn:on};}

// Docker Desktop on Windows reports bind mounts as its VM sees the drives; the dashboard needs the
// folder as Windows sees it. Paths inside a WSL distro have no drive letter and are left as they are.
function hostPath(p,platform){
  if(platform!=='win32'||typeof p!=='string')return p;
  const m=p.match(/^\/(?:run\/desktop\/mnt\/host|host_mnt|mnt)\/([a-zA-Z])(\/.*)?$/);
  return m?`${m[1].toUpperCase()}:${(m[2]||'/').replace(/\//g,'\\')}`:p;
}

// ---- macOS ----
// A throwaway .command file opens in Terminal without asking for permission to control another app,
// as AppleScript would. Vietnamese Telex rewrites keys with backspace + retype, which a raw container
// shell receives twice; the shell says so when that input source is selected.
function macShellScript({docker,target,hint}){
  return `#!/bin/sh\nclear\nif defaults read com.apple.HIToolbox AppleSelectedInputSources 2>/dev/null | grep -q Vietnamese; then printf '\\033[33m%s\\033[0m\\n\\n' ${shellQuote(hint)}; fi\nexec ${shellQuote(docker)} exec -it ${target} sh -c '${SHELL_IN_CONTAINER}'\n`;
}

// ---- Windows ----
// `start` opens a new console window (Windows Terminal on Windows 11). cmd.exe parses this line
// itself, not with the usual argument rules: every value is double-quoted, which keeps & | < > ^
// literal. " cannot appear in Windows paths and % would expand variables, so both are refused.
// Trailing backslashes are doubled so they cannot escape the closing quote for the program started.
function cmdQuote(value){
  const v=String(value);
  if(/["%\r\n\0]/.test(v))throw Object.assign(new Error(`Unsafe argument: ${v}`),{code:'UNSAFE_ARG'});
  return `"${v.replace(/\\+$/,m=>m+m)}"`;
}
function windowStart(program,args=[],dir=''){
  const line=['start','""',...(dir?['/D',cmdQuote(dir)]:[]),cmdQuote(program),...args.map(cmdQuote)].join(' ');
  return {file:'cmd.exe',args:['/d','/v:off','/c',line],options:{windowsVerbatimArguments:true,timeout:10000}};
}
// The dialog runs in PowerShell; its texts arrive through environment variables, never in the script.
const PICK_SCRIPT=[
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName System.Windows.Forms',
  '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
  '$owner=New-Object System.Windows.Forms.Form -Property @{TopMost=$true;ShowInTaskbar=$false}',
  '$d=New-Object System.Windows.Forms.FolderBrowserDialog',
  '$d.Description=$env:DDM_PROMPT',
  '$d.ShowNewFolderButton=$false',
  'if($env:DDM_START){$d.SelectedPath=$env:DDM_START}',
  'if($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK){[Console]::Out.Write($d.SelectedPath)}',
].join('\n');

// ---- What each system runs ----
// A shell inside a container (`target`, with a script on macOS) or a terminal at `dir`.
function terminalLaunch(platform,{script,dir,target}){
  if(platform==='win32')return dir?windowStart('powershell.exe',['-NoExit'],dir):windowStart('docker',['exec','-it',target,'sh','-c',SHELL_IN_CONTAINER]);
  return {file:'open',args:['-a','Terminal',script||dir],options:{timeout:10000}};
}
// Finder/File Explorer, Terminal or VS Code at a project folder.
function openInLaunch(platform,app,dir,env={}){
  if(platform==='win32'){
    if(app==='finder')return {file:'explorer.exe',args:[dir],options:{timeout:10000},okExitCodes:[1]}; // Explorer exits 1 even when it opened the folder
    if(app==='terminal')return windowStart('powershell.exe',['-NoExit'],dir);
    // Code.exe keeps running as the editor, so it is started detached; `code` is a .cmd script that only cmd.exe can run.
    const candidates=[env.LOCALAPPDATA&&path.win32.join(env.LOCALAPPDATA,'Programs','Microsoft VS Code','Code.exe'),
      env.ProgramFiles&&path.win32.join(env.ProgramFiles,'Microsoft VS Code','Code.exe'),env['ProgramFiles(x86)']&&path.win32.join(env['ProgramFiles(x86)'],'Microsoft VS Code','Code.exe')].filter(Boolean);
    return {candidates,args:[dir],detached:true,fallback:{file:'cmd.exe',args:['/d','/v:off','/c',`code ${cmdQuote(dir)}`],options:{windowsVerbatimArguments:true,windowsHide:true,timeout:15000}}};
  }
  return {file:'open',args:MAC_APPS[app]?['-a',MAC_APPS[app],dir]:[dir],options:{timeout:10000}};
}
function pickFolderLaunch(platform,{prompt,start}){
  if(platform==='win32')return {file:'powershell.exe',args:['-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(PICK_SCRIPT,'utf16le').toString('base64')],
    env:{DDM_PROMPT:prompt,DDM_START:start||''},options:{timeout:600000,windowsHide:true}};
  return {file:'osascript',args:['-e','on run argv','-e','tell me to activate','-e','return POSIX path of (choose folder with prompt (item 1 of argv) default location (POSIX file (item 2 of argv)))','-e','end run',prompt,start],options:{timeout:600000}};
}
// The chosen folder without a trailing separator ('' when the dialog was closed on Windows).
function pickedFolder(platform,stdout){
  const p=String(stdout).trim();
  return platform==='win32'?(/^[A-Za-z]:\\$/.test(p)?p:p.replace(/\\+$/,'')):p.replace(/(.)\/+$/,'$1');
}
function pickCancelled(platform,error){return platform!=='win32'&&/-128|User cancel/i.test(String(error?.stderr||error?.message||''));}
// Commands to paste into a terminal: POSIX shells on macOS and Linux, PowerShell on Windows.
function cliShell(platform){
  return platform==='win32'
    ?{quote:v=>/^[A-Za-z0-9_\\\/.,:=@+-]+$/.test(v)?v:`'${String(v).replace(/'/g,"''")}'`,and:'; ',tmp:'$env:TEMP'}
    :{quote:shellQuote,and:' && ',tmp:'/tmp'};
}

module.exports={supports,hostPath,macShellScript,cmdQuote,terminalLaunch,openInLaunch,pickFolderLaunch,pickedFolder,pickCancelled,cliShell,shellQuote,SHELL_IN_CONTAINER};
