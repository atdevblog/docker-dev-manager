'use strict';
// Bitbucket SSH hostname change: the rules behind the support tool (no SSH, Git or network here).
const test=require('node:test');const assert=require('node:assert/strict');
const B=require('../lib/bitbucket');

// bitbucket.org/site/ssh as published (checked 2026-10-16).
const SITE=`bitbucket.org ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDQeJzhupRu0u0cdegZIa8e86EG2qOCsIsD1Xw0xSeiPDlCr7kq97NLmMbpKTX6Esc30NuoqEEHCuc7yWtwp8dI76EEEB1VqY9QJq6vk+aySyboD5QF61I/1WeTwu+deCbgKMGbUijeXhtfbxSxm6JwGrXrhBdofTsbKRUsrN1WoNgUa8uqN1Vx6WAJw1JHPhglEGGHea6QICwJOAr/6mrui/oB7pkaWKHj3z7d1IC4KWLtY47elvjbaTlkN04Kc/5LFEirorGYVbt15kAUlqGM65pk6ZBxtaO3+30LVlORZkxOh+LKL/BvbZ/iRNhItLqNyieoQj/uh/7Iv4uyH/cV/0b4WDSd3DptigWq84lJubb9t/DnZlrJazxyDCulTmKdOR7vs9gMTo+uoIrPSb8ScTtvw65+odKAlBj59dhnVp9zd7QUojOpXlL62Aw56U4oO+FALuevvMjiWeavKhJqlR7i5n9srYcrNV7ttmDw7kf/97P5zauIhxcjX+xHv4M=
bitbucket.org ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBPIQmuzMBuKdWeF4+a2sjSSpBK0iqitSQ+5BM9KhpexuGt20JpTVM7u5BDZngncgrqDMbWdxMWWOGtZ9UgbqgZE=
bitbucket.org ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIazEu89wgQZ4bqs3d63QSMzYVa0MuJ2e2gKTKqu+UUO
`;

test('the SSH host of a Git URL, as the check script reads it',()=>{
 for(const [url,host] of [['git@bitbucket.org:team/a.git','bitbucket.org'],['git@bitbucket-work:team/x.git','bitbucket-work'],['ssh://git@bitbucket.org/team/a.git','bitbucket.org'],
  ['ssh://git@bitbucket.org:22/team/a.git','bitbucket.org'],['ssh://bitbucket.org/a','bitbucket.org'],['bitbucket.org:team/a','bitbucket.org'],
  ['https://user@bitbucket.org/team/a.git',''],['http://bitbucket.org/a',''],['file:///srv/x',''],['/srv/repo',''],['./repo',''],['../repo',''],['C:\\repos\\a',''],['C:/repos/a','']])
  assert.equal(B.hostOf(url),host,url);
 assert.ok(B.isHttpsBitbucket('https://user@bitbucket.org/team/a.git'));assert.ok(!B.isHttpsBitbucket('git@bitbucket.org:team/a.git'));assert.ok(!B.isHttpsBitbucket('https://github.com/a/b'));
});
test('only remotes that name bitbucket.org itself move to ssh.bitbucket.org',()=>{
 assert.equal(B.newRemoteUrl('git@bitbucket.org:team/a.git'),'git@ssh.bitbucket.org:team/a.git');
 assert.equal(B.newRemoteUrl('ssh://git@bitbucket.org/team/a.git'),'ssh://git@ssh.bitbucket.org/team/a.git');
 assert.equal(B.newRemoteUrl('ssh://git@bitbucket.org:22/team/a.git'),'ssh://git@ssh.bitbucket.org:22/team/a.git');
 assert.equal(B.newRemoteUrl('git@bitbucket-work:team/x.git'),'git@bitbucket-work:team/x.git','an alias is fixed in ~/.ssh/config, not in the repo');
 assert.equal(B.newRemoteUrl('git@ssh.bitbucket.org:team/a.git'),'git@ssh.bitbucket.org:team/a.git','already moved');
 assert.equal(B.newRemoteUrl('https://bitbucket.org/team/a.git'),'https://bitbucket.org/team/a.git','HTTPS keeps working');
 assert.equal(B.newRemoteUrl('git@notbitbucket.org:a.git'),'git@notbitbucket.org:a.git');
});
test('remotes come from .git/config sections',()=>{
 assert.deepEqual(B.gitRemotes(`[core]
\trepositoryformatversion = 0
\turl = not-a-remote
[remote "origin"]
\turl = git@bitbucket-work:team/billing.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
\tremote = origin
[remote "backup"]
\turl = "https://bitbucket.org/team/billing.git"
# [remote "old"]
;\turl = git@bitbucket.org:x/y.git
[remote "with space"]
URL=ssh://git@bitbucket.org/team/a.git
`),[{remote:'origin',url:'git@bitbucket-work:team/billing.git'},{remote:'backup',url:'https://bitbucket.org/team/billing.git'},{remote:'with space',url:'ssh://git@bitbucket.org/team/a.git'}]);
});
test('~/.ssh/config: only HostName bitbucket.org lines change; aliases, keys and other hosts stay',()=>{
 const before=`# Bitbucket accounts
Host bitbucket-personal
  HostName bitbucket.org
  User git
  IdentityFile ~/.ssh/bitbucket_personal

Host bitbucket-work
\tHostname=bitbucket.org
\tIdentityFile ~/.ssh/bitbucket_work

Host github.com
  HostName github.com
Host old-mirror
  HostName bitbucket.org.example.com
Host done
  HostName ssh.bitbucket.org
`;
 const {text,changes}=B.rewriteSshConfig(before);
 assert.equal(text,before.replace('  HostName bitbucket.org\n','  HostName ssh.bitbucket.org\n').replace('\tHostname=bitbucket.org','\tHostname=ssh.bitbucket.org'));
 assert.deepEqual(changes,[{line:3,before:'  HostName bitbucket.org',after:'  HostName ssh.bitbucket.org'},{line:8,before:'\tHostname=bitbucket.org',after:'\tHostname=ssh.bitbucket.org'}]);
 assert.deepEqual(B.rewriteSshConfig('Host a\r\n  HostName bitbucket.org\r\n').text,'Host a\r\n  HostName ssh.bitbucket.org\r\n','Windows line endings are kept');
 assert.deepEqual(B.rewriteSshConfig(B.rewriteSshConfig(before).text).changes,[],'running it twice changes nothing more');
});
test('host keys: written only when the download is exactly Bitbucket’s three published keys',()=>{
 for(const line of SITE.trim().split('\n')){const [,type,key]=line.split(' ');assert.equal(B.fingerprint(key),B.FINGERPRINTS[type],type);}
 const lines=B.knownHostLines(SITE);
 assert.deepEqual(lines.map(l=>l.split(' ').slice(0,2).join(' ')),['ssh.bitbucket.org ssh-ed25519','ssh.bitbucket.org ecdsa-sha2-nistp256','ssh.bitbucket.org ssh-rsa']);
 assert.ok(lines.every(l=>SITE.includes(l.split(' ')[2])));
 const tampered=SITE.replace('IIazEu89wgQZ4bqs3d63QSMzYVa0MuJ2e2gKTKqu+UUO','IIazEu89wgQZ4bqs3d63QSMzYVa0MuJ2e2gKTKqu+UUX');
 assert.throws(()=>B.knownHostLines(tampered),e=>e.code==='BAD_HOST_KEY');
 assert.throws(()=>B.knownHostLines(SITE.split('\n').slice(0,2).join('\n')),e=>e.code==='BAD_HOST_KEY','a missing key type is refused');
 assert.throws(()=>B.knownHostLines('<html>login</html>'),e=>e.code==='BAD_HOST_KEY');
});
test('verdicts per host and what ssh -T answered',()=>{
 assert.equal(B.hostVerdict('bitbucket-work','ssh.bitbucket.org'),'ok');assert.equal(B.hostVerdict('bitbucket-work','bitbucket.org'),'alias');
 assert.equal(B.hostVerdict('bitbucket.org','bitbucket.org'),'direct');assert.equal(B.hostVerdict('ssh.bitbucket.org','ssh.bitbucket.org'),'ok');
 assert.equal(B.sshTestResult('authenticated via ssh key.\n\nYou can use git to connect to Bitbucket. Shell access is disabled'),'ok');
 assert.equal(B.sshTestResult('No ED25519 host key is known for ssh.bitbucket.org and you have requested strict checking.\r\nHost key verification failed.'),'hostKey');
 assert.equal(B.sshTestResult('git@ssh.bitbucket.org: Permission denied (publickey).'),'denied');
 assert.equal(B.sshTestResult('ssh: connect to host ssh.bitbucket.org port 22: Operation timed out'),'unreachable');
 assert.equal(B.daysLeft(Date.parse('2026-10-16T09:00:00Z')),27);assert.equal(B.daysLeft(Date.parse('2026-11-12T00:00:00Z')),0);
});
