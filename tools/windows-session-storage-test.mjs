/** Real Windows DACL and session persistence; no school requests or real profile. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openSessionStorage} from '../packages/sdk/src/node/storage.ts';
const exec=promisify(execFile);
const snapshot={version:1,epoch:4,explicitLogout:false,device:{account:'90000001',fingerprint:'c'.repeat(32)},session:{username:'90000001',fingerprint:'c'.repeat(32),cookiesJson:'[]',savedAt:1}};
async function powershell(target,script){
  return exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; "+script],{windowsHide:true,timeout:15000,env:{...process.env,ONETHU_ACL_FIXTURE_PATH:target}});
}
async function checkAcl(target){
  const {stdout}=await powershell(target,"$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=Get-Acl -LiteralPath $env:ONETHU_ACL_FIXTURE_PATH; $rules=@($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])); @{protected=$acl.AreAccessRulesProtected; ownerMatches=($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -eq $sid.Value); rules=@($rules | ForEach-Object { @{own=($_.IdentityReference.Value -eq $sid.Value); allow=($_.AccessControlType -eq 'Allow'); full=(($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl)} })} | ConvertTo-Json -Depth 4 -Compress");
  const actual=JSON.parse(stdout.trim());
  assert.equal(actual.protected,true);assert.equal(actual.ownerMatches,true);assert.equal(actual.rules.length,1);
  assert.deepEqual(actual.rules[0],{allow:true,full:true,own:true});
}
test('Windows session directories and atomic files get an owner-only protected DACL, including existing explicit grants',{skip:process.platform!=='win32',timeout:60000},async t=>{
  const base=await mkdtemp(path.join(tmpdir(),'onethu-acl-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const dir=path.join(base,"有空格 ' [session] profile");
  let store=await openSessionStorage(dir);t.after(()=>store.close());
  await checkAcl(dir);await store.save(snapshot);await checkAcl(path.join(dir,'session.json'));
  await store.close();
  await powershell(dir,"$acl=Get-Acl -LiteralPath $env:ONETHU_ACL_FIXTURE_PATH; $everyone=[System.Security.Principal.SecurityIdentifier]::new('S-1-1-0'); $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($everyone,[System.Security.AccessControl.FileSystemRights]::ReadAndExecute,[System.Security.AccessControl.AccessControlType]::Allow); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $env:ONETHU_ACL_FIXTURE_PATH -AclObject $acl");
  store=await openSessionStorage(dir);await checkAcl(dir);assert.deepEqual(await store.load(),snapshot);
  await store.save({...snapshot,epoch:5});await checkAcl(path.join(dir,'session.json'));
  console.log('Windows real DACL, account snapshot, explicit-grant removal and atomic replacement verified');
});
