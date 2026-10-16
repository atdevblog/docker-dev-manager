'use strict';
// Bitbucket's SSH hostname change (bitbucket.org → ssh.bitbucket.org, from 2026-11-12 bitbucket.org
// serves HTTPS only). Pure rules for the support tool: no I/O here, the server runs the checks and
// writes only what the person confirmed. public/tools/bitbucket-ssh-check.sh runs the same check on a server.
const crypto=require('node:crypto');
const NEW_HOST='ssh.bitbucket.org',OLD_HOST='bitbucket.org',DEADLINE='2026-11-12';
// Bitbucket's published host keys (bitbucket.org/site/ssh, checked 2026-10-16). ssh.bitbucket.org uses the
// same three keys; a downloaded key is written to known_hosts only when its fingerprint is one of these.
const FINGERPRINTS={'ssh-ed25519':'SHA256:ybgmFkzwOSotHTHLJgHO0QN8L0xErw6vd0VhFA9m3SM','ecdsa-sha2-nistp256':'SHA256:FC73VB6C4OQLSCrjEayhMp9UMxS97caD/Yyi2bhW/J0','ssh-rsa':'SHA256:46OSHA1Rmj8E8ERTC6xkNcmGOw9oFxYr0WF6zWW8l1E'};

// Host part of an SSH-style Git URL; '' for https, file and local paths (as host_of in the script).
function hostOf(url){
  const u=String(url||'');
  if(/^ssh:\/\//i.test(u)){const auth=u.slice(6).split('/')[0];return auth.slice(auth.lastIndexOf('@')+1).split(':')[0];}
  if(/^[a-z][a-z0-9+.-]*:\/\//i.test(u))return '';
  let m=u.match(/^[^@/]+@([^:/]+):/);if(m)return m[1];
  m=u.match(/^([^/.\\][^:/\\]*):(?!\\)/);if(m&&!/^[a-zA-Z]$/.test(m[1]))return m[1]; // not a Windows drive (C:\…)
  return '';
}
const isHttpsBitbucket=url=>/^https?:\/\//i.test(url)&&/bitbucket\.org/i.test(url); // HTTPS keeps working
// The same remote through the new hostname; only remotes that name bitbucket.org itself change.
function newRemoteUrl(url){
  const u=String(url);
  if(/^ssh:\/\//i.test(u))return u.replace(/^(ssh:\/\/(?:[^@/]+@)?)bitbucket\.org(?=[:/]|$)/i,`$1${NEW_HOST}`);
  return u.replace(/^((?:[^@/]+@)?)bitbucket\.org:/i,`$1${NEW_HOST}:`);
}
// Remotes from a .git/config: [remote "name"] url = … (what `git config --get-regexp remote.*.url` lists).
function gitRemotes(configText){
  const out=[];let remote=null;
  for(const raw of String(configText).split(/\r?\n/)){
    const line=raw.trim();if(!line||line[0]==='#'||line[0]===';')continue;
    const section=line.match(/^\[\s*remote\s+"((?:[^"\\]|\\.)*)"\s*\]$/i);
    if(section){remote=section[1];continue;}
    if(line[0]==='['){remote=null;continue;}
    const kv=remote!==null&&line.match(/^url\s*=\s*(.*)$/i);
    if(kv)out.push({remote,url:kv[1].replace(/^"(.*)"$/,'$1').trim()});
  }
  return out;
}
// ~/.ssh/config: every `HostName bitbucket.org` line (any spacing, `=`, letter case) points to the new
// hostname; alias names, User and IdentityFile stay. Returns the new text and each changed line.
function rewriteSshConfig(text){
  const lines=String(text).split('\n'),changes=[];
  const out=lines.map((line,i)=>{
    const m=line.match(/^(\s*hostname)(\s*=\s*|\s+)bitbucket\.org(\s*)(\r?)$/i);
    if(!m)return line;
    const next=`${m[1]}${m[2]}${NEW_HOST}${m[3]}${m[4]}`;changes.push({line:i+1,before:line.replace(/\r$/,''),after:next.replace(/\r$/,'')});return next;
  });
  return {text:out.join('\n'),changes};
}
// SHA256 fingerprint of an OpenSSH public key blob, as `ssh-keygen -l` prints it.
const fingerprint=b64=>'SHA256:'+crypto.createHash('sha256').update(Buffer.from(b64,'base64')).digest('base64').replace(/=+$/,'');
// bitbucket.org/site/ssh → known_hosts lines for ssh.bitbucket.org. Throws unless exactly the three
// published keys come back, so a tampered download is never trusted.
function knownHostLines(siteText){
  const keys=String(siteText).split(/\r?\n/).map(l=>l.trim().split(/\s+/)).filter(f=>f.length>=3&&f[0]===OLD_HOST);
  const lines=[];
  for(const type of Object.keys(FINGERPRINTS)){
    const k=keys.find(f=>f[1]===type);
    if(!k||fingerprint(k[2])!==FINGERPRINTS[type])throw Object.assign(new Error(`Unexpected Bitbucket host key (${type})`),{code:'BAD_HOST_KEY'});
    lines.push(`${NEW_HOST} ${type} ${k[2]}`);
  }
  return lines;
}
// One verdict per SSH host used by Bitbucket remotes (aliases included), as the script prints them.
function hostVerdict(host,resolved){
  if(String(resolved).toLowerCase()===NEW_HOST)return 'ok';
  return host.toLowerCase()===OLD_HOST?'direct':'alias';
}
// What `ssh -T` against the new hostname answered.
function sshTestResult(output){
  const o=String(output);
  if(/authenticated via/i.test(o))return 'ok';
  if(/verification failed|host key is known|Host key verification/i.test(o))return 'hostKey';
  if(/Permission denied/i.test(o))return 'denied';
  return 'unreachable';
}
const daysLeft=(now=Date.now())=>Math.ceil((Date.parse(DEADLINE+'T00:00:00Z')-now)/86400000);

module.exports={NEW_HOST,OLD_HOST,DEADLINE,FINGERPRINTS,hostOf,isHttpsBitbucket,newRemoteUrl,gitRemotes,rewriteSshConfig,fingerprint,knownHostLines,hostVerdict,sshTestResult,daysLeft};
