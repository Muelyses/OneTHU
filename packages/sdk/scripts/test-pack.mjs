/** Isolated archive smoke test; no university login or network is performed. */
import {mkdtemp,mkdir,writeFile,cp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url)),require=createRequire(import.meta.url);
if(process.argv.length!==3)throw new Error('Usage: node scripts/test-pack.mjs /absolute/path/sdk.tgz');
const artifact=path.resolve(process.argv[2]),dir=await mkdtemp(path.join(os.tmpdir(),'onethu-sdk-consumer-'));
try{
  await writeFile(path.join(dir,'package.json'),JSON.stringify({name:'onethu-sdk-isolated-fixture',private:true,type:'module'}));
  await cp(artifact,path.join(dir,'sdk.tgz'));
  execFileSync(process.platform==='win32'?'npm.cmd':'npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','./sdk.tgz'],{cwd:dir,stdio:'pipe',shell:process.platform==='win32'});
  const installed=JSON.parse(await readFile(path.join(dir,'node_modules/@onethu/sdk/package.json'),'utf8'));
  if(Object.values(installed.dependencies??{}).some(v=>String(v).includes('workspace:')))throw new Error('WORKSPACE_DEPENDENCY_IN_ARCHIVE');
  await writeFile(path.join(dir,'smoke.mjs'),`import {createOneThu,VERSION} from '@onethu/sdk';import path from 'node:path';\nconst app=await createOneThu({dataDir:path.resolve('profile'),fetch:async()=>{throw new Error('UNEXPECTED_NETWORK');}});try{const list=app.list();for(const name of ['learn.resources','library.book','plugins.list','memory.search','services.search'])if(!list.operations.some(op=>op.name===name))throw new Error('MISSING_OPERATION:'+name);if(list.mode!=='standalone')throw new Error('NOT_STANDALONE');console.log(JSON.stringify({version:VERSION,operations:list.operations.length,mode:list.mode,offline:true}));}finally{await app.close();}`);
  const runtime=execFileSync(process.execPath,['smoke.mjs'],{cwd:dir,encoding:'utf8'}).trim();
  await writeFile(path.join(dir,'consumer.ts'),`import {createOneThu,createNodeSession,createLearnService,createPluginHost,type OneThuRuntime,type CallRequest} from '@onethu/sdk';
import {createTaskManager,type TaskDraft} from '@onethu/sdk/tasks';
import {createFileTaskStorage} from '@onethu/sdk/tasks/node';
import {mutationApproval} from '@onethu/sdk/policy';
import {validate,type Schema} from '@onethu/sdk/validation';
import {publicResult} from '@onethu/sdk/public-result';
import {createLearnService as sharedLearn,type LearnServicePorts} from '@onethu/sdk/learn';
const app:OneThuRuntime=await createOneThu({dataDir:'/unused-fixture',fetch:globalThis.fetch});
const request:CallRequest={operation:'learn.currentSemester',args:[]};
await app.call(request,{source:'local',permissions:new Set(['learn:read'])});
await app.auth.login({username:'synthetic',password:'synthetic'});
// @ts-expect-error password requires a string
await app.auth.login({username:'synthetic',password:42});
// @ts-expect-error operation requires a string
await app.call({operation:42});
const session=await createNodeSession({dataDir:'/unused-second-fixture'});
const semester=await session.learn.getCurrentSemester();const id:string=semester.id;
const name:string=app.list().operations[0]!.name;
const draft:TaskDraft={name:'Watch',schedule:{kind:'interval',everyMinutes:30},template:{kind:'operation',operation:name,args:[]}};
const schema:Schema={type:'array'};validate([],schema);publicResult(id);mutationApproval({mutation:true,automatic:false,confirmed:false});
void [createTaskManager,createFileTaskStorage,createLearnService,sharedLearn,createPluginHost,draft];await app.close();\n`);
  await writeFile(path.join(dir,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',strict:true,skipLibCheck:false,noEmit:true},include:['consumer.ts']}));
  execFileSync(process.execPath,[require.resolve('typescript/bin/tsc'),'-p',path.join(dir,'tsconfig.json')],{cwd:dir,stdio:'pipe',maxBuffer:4*1024*1024});
  // Common consumers already have Node types. Check that the self-contained
  // declarations coexist with that normal setup without duplicate globals.
  const nodeTypes=path.dirname(require.resolve('@types/node/package.json'));
  await mkdir(path.join(dir,'node_modules/@types'),{recursive:true});await cp(nodeTypes,path.join(dir,'node_modules/@types/node'),{recursive:true});
  const typeRequire=createRequire(path.join(nodeTypes,'package.json'));
  await cp(path.dirname(typeRequire.resolve('undici-types/package.json')),path.join(dir,'node_modules/undici-types'),{recursive:true});
  execFileSync(process.execPath,[require.resolve('typescript/bin/tsc'),'-p',path.join(dir,'tsconfig.json')],{cwd:dir,stdio:'pipe',maxBuffer:4*1024*1024});
  process.stdout.write(JSON.stringify({artifact,runtime:JSON.parse(runtime),types:'strict NodeNext, skipLibCheck=false',install:'offline; no scripts'})+'\n');
}catch(error){if(error.stdout)process.stderr.write(String(error.stdout).slice(0,16000));if(error.stderr)process.stderr.write(String(error.stderr).slice(0,4000));throw error;}finally{await rm(dir,{recursive:true,force:true});}
