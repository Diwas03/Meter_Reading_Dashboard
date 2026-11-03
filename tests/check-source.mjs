import {execFileSync} from 'node:child_process';
import {readFileSync,statSync} from 'node:fs';
import assert from 'node:assert/strict';
const files=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean))];
const problems=[];
for(const path of files){
 if(!statSync(path).isFile())continue;
 const source=readFileSync(path,'utf8');
 if(/sb_secret_[A-Za-z0-9_-]{12,}|mg_[a-f0-9]{64}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(source))problems.push(path);
 for(const match of source.matchAll(/(?:WIFI_(?:PASSWORD|SSID)|THINGSPEAK_WRITE_KEY)\s*=\s*"([^"]+)"/g))if(!/^YOUR_|REPLACE_|\[REDACTED\]/.test(match[1]))problems.push(path);
 for(const match of source.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g))try{if(JSON.parse(Buffer.from(match[1],'base64url').toString()).role==='service_role')problems.push(path);}catch{}
}
assert.equal(problems.length,0,'Potential credentials in current source files: '+[...new Set(problems)].join(', '));
console.log('PASS: current source tree credential patterns; ignored local files and old Git history excluded');
