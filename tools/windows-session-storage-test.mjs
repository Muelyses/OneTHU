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
async function checkAcl(target,directory=false){
  // Get-Acl/ConvertTo-Json also depend on auto-loadable PowerShell modules.
  // Query the real OS descriptor directly so the assertion works from a host
  // whose inherited PSModulePath belongs to a different PowerShell version.
  const {stdout}=await powershell(target,`$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=[System.IO.${directory?'Directory':'File'}]::GetAccessControl($env:ONETHU_ACL_FIXTURE_PATH); $rules=@($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])); $valid=$true; foreach($rule in $rules){ if(($rule.IdentityReference.Value -ne $sid.Value) -or ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) -or (($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne [System.Security.AccessControl.FileSystemRights]::FullControl)){$valid=$false} }; [Console]::WriteLine((@($acl.AreAccessRulesProtected,($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -eq $sid.Value),$rules.Count,$valid) -join ';'))`);
  assert.equal(stdout.trim(),'True;True;1;True');
}
test('Windows session directories and atomic files get an owner-only protected DACL, including existing explicit grants',{skip:process.platform!=='win32',timeout:60000},async t=>{
  const base=await mkdtemp(path.join(tmpdir(),'onethu-acl-'));let store;
  t.after(async()=>{try{await store?.close();}finally{await rm(base,{recursive:true,force:true});}});
  const dir=path.join(base,"有空格 ' [session] profile");
  store=await openSessionStorage(dir);
  await checkAcl(dir,true);await store.save(snapshot);await checkAcl(path.join(dir,'session.json'));
  await store.close();
  await powershell(dir,"$acl=[System.IO.Directory]::GetAccessControl($env:ONETHU_ACL_FIXTURE_PATH); $everyone=[System.Security.Principal.SecurityIdentifier]::new('S-1-1-0'); $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($everyone,[System.Security.AccessControl.FileSystemRights]::ReadAndExecute,[System.Security.AccessControl.AccessControlType]::Allow); $acl.AddAccessRule($rule); [System.IO.Directory]::SetAccessControl($env:ONETHU_ACL_FIXTURE_PATH,$acl)");
  store=await openSessionStorage(dir);await checkAcl(dir,true);assert.deepEqual(JSON.parse(JSON.stringify(await store.load())),snapshot);
  await store.save({...snapshot,epoch:5});await checkAcl(path.join(dir,'session.json'));
  console.log('Windows real DACL, account snapshot, explicit-grant removal and atomic replacement verified');
});
