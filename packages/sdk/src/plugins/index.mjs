import path from 'node:path';
import { lstat, readdir, rename, rm, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { readBundle } from './archive.mjs';
import { compatibility, GUI_NAMESPACES, validateCommands } from './manifest.mjs';
import { PluginProcess } from './runtime.mjs';
import { PluginError, fail, pluginId, checkPath, ensureDir, readRegular, writeNew, writeJson, requireConfirm } from './security.mjs';
export { PluginError } from './security.mjs';

const keyValid = key => typeof key==='string' && key.length>0 && key.length<=256 && !['__proto__','prototype','constructor'].includes(key);
function jsonCopy(value) { return JSON.parse(JSON.stringify(value)); }
async function exists(file) { try {await lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;} }
function settingsFor(manifest, supplied={}) {
  if(!supplied || typeof supplied!=='object'||Array.isArray(supplied))fail('PLUGIN_INVALID_SETTINGS');
  const result={};
  for(const field of manifest.settings??[])if(field.default!==undefined)result[field.key]=String(field.default);
  for(const [key,value]of Object.entries(supplied)) {
    if(!keyValid(key)||typeof value!=='string'||value.length>65536)fail('PLUGIN_INVALID_SETTINGS'); result[key]=value;
  }
  if(Buffer.byteLength(JSON.stringify(result))>1024*1024)fail('PLUGIN_INVALID_SETTINGS');
  return result;
}

/** Headless plugin host. rootDir must be inside the SDK's exclusively locked
 * data directory. No third-party package is fetched or activated by installation.
 * resolveOperation is the shared SDK catalog's permission/capability lookup;
 * dispatch remains responsible for validation and per-write authorization.
 */
export function createPluginHost(options) { return new PluginHost(options); }
export class PluginHost {
  constructor({rootDir,dispatch,resolveOperation,getSession=()=>({status:'logged-out',username:null}),onEvent,workerUrl}={}) {
    if(typeof rootDir!=='string'||!path.isAbsolute(rootDir)||path.parse(rootDir).root===rootDir)fail('PLUGIN_ABSOLUTE_PATH_REQUIRED');
    this.rootDir=path.resolve(rootDir); this.dispatch=dispatch;this.resolveOperation=resolveOperation;this.getSession=getSession;this.onEvent=onEvent;this.workerUrl=workerUrl;
    this.processes=new Map();this.settings=new Map();this.storageQueues=new Map();this.starting=new Map();this.epochs=new Map();this.mutations=Promise.resolve();this.closed=false;
  }
  paths(id) {pluginId(id);return {directory:path.join(this.rootDir,'packages',id),record:path.join(this.rootDir,'state',`${id}.json`),storage:path.join(this.rootDir,'data',`${id}.json`)};}
  async exclusive(action) {
    if(this.closed)fail('PLUGIN_HOST_CLOSED');
    const next=this.mutations.catch(()=>{}).then(()=>{if(this.closed)fail('PLUGIN_HOST_CLOSED');return action();});
    this.mutations=next;return next;
  }
  async record(id) {
    const target=this.paths(id).record;
    if(!await exists(target))fail('PLUGIN_NOT_INSTALLED');
    let record;try{record=JSON.parse((await readRegular(target,4*1024*1024)).toString('utf8'));}catch(error){if(error instanceof PluginError)throw error;fail('PLUGIN_STATE_INVALID');}
    if(record?.manifest?.id!==id||typeof record.digest!=='string'||typeof record.enabled!=='boolean')fail('PLUGIN_STATE_INVALID');
    return record;
  }
  async sessionSnapshot() {
    const session=await this.getSession();
    return {status:typeof session?.status==='string'?session.status:'logged-out',username:typeof session?.username==='string'?session.username:null};
  }
  async inspect(source) {
    const bundle=await readBundle(typeof source==='string'?source:source?.sourcePath);
    return {manifest:bundle.manifest,sha256:bundle.digest,files:bundle.hashes,compatibility:bundle.compatibility};
  }
  async install(source,options={}) {
    if(typeof source==='object'&&source){options=source;source=source.sourcePath;}
    requireConfirm(options);
    return this.exclusive(async()=>{
      const bundle=await readBundle(source), id=bundle.manifest.id, targets=this.paths(id);
      await checkPath(this.rootDir,true);
      if(await exists(targets.directory)||await exists(targets.record))fail('PLUGIN_ALREADY_INSTALLED','Uninstall the existing plugin explicitly before replacing it.');
      await ensureDir(path.dirname(targets.directory));
      const stage=path.join(path.dirname(targets.directory),`.install-${randomBytes(12).toString('hex')}`);
      await ensureDir(stage);
      let moved=false;
      try{
        for(const [name,bytes]of bundle.files){const dest=path.join(stage,...name.split('/'));await ensureDir(path.dirname(dest));await writeNew(dest,bytes);}
        if(bundle.manifest.kind==='rust')await chmod(path.join(stage,bundle.manifest.bin),0o700);
        await rename(stage,targets.directory);moved=true;
        const record={format:1,manifest:bundle.manifest,digest:bundle.digest,files:bundle.hashes,enabled:false,installedAt:new Date().toISOString()};
        await writeJson(targets.record,record);
        return {...record,compatibility:bundle.compatibility};
      }catch(error){if(moved)await rm(targets.directory,{recursive:true,force:true});throw error;}
      finally{await rm(stage,{recursive:true,force:true});}
    });
  }
  async list() {
    await checkPath(this.rootDir,true);
    const state=path.join(this.rootDir,'state');if(!await exists(state))return[];
    await checkPath(state);
    const records=[];
    for(const entry of await readdir(state,{withFileTypes:true})){
      if(!entry.name.endsWith('.json'))continue;
      if(!entry.isFile()||entry.isSymbolicLink())fail('PLUGIN_STATE_INVALID');
      const record=await this.record(entry.name.slice(0,-5));
      records.push({...record,running:this.processes.get(record.manifest.id)?.process.alive===true,compatibility:compatibility(record.manifest)});
    }
    return records.sort((a,b)=>a.manifest.id.localeCompare(b.manifest.id));
  }
  async storage(id,method,args,context) {
    const file=this.paths(id).storage;
    const operation=async()=>{
      if(context.signal?.aborted)fail('PLUGIN_STOPPED');
      let data=Object.create(null);
      if(await exists(file)){try{data=JSON.parse((await readRegular(file,4*1024*1024)).toString('utf8'));}catch(error){if(error instanceof PluginError)throw error;fail('PLUGIN_STORAGE_INVALID');}}
      if(!data||typeof data!=='object'||Array.isArray(data))fail('PLUGIN_STORAGE_INVALID');
      if(method==='keys')return Object.keys(data);
      if(method==='snapshot')return data;
      if(!keyValid(args[0]))fail('PLUGIN_INVALID_STORAGE_KEY');
      if(method==='get')return Object.hasOwn(data,args[0])?data[args[0]]:null;
      if(method==='set')data[args[0]]=jsonCopy(args[1]);
      else if(method==='remove')delete data[args[0]];
      else fail('PLUGIN_OPERATION_UNAVAILABLE');
      if(Buffer.byteLength(JSON.stringify(data))>4*1024*1024)fail('PLUGIN_STORAGE_TOO_LARGE');
      if(context.signal?.aborted)fail('PLUGIN_STOPPED');
      await context.beforeWrite?.();
      if(context.signal?.aborted)fail('PLUGIN_STOPPED');
      await writeJson(file,data);return null;
    };
    const prior=this.storageQueues.get(id)??Promise.resolve();
    const next=prior.catch(()=>{}).then(operation);this.storageQueues.set(id,next);
    try{return await next;}finally{if(this.storageQueues.get(id)===next)this.storageQueues.delete(id);}
  }
  async bridge(record,params,context) {
    if(context.signal.aborted||this.closed)fail('PLUGIN_STOPPED');
    await context.beforeWrite?.();
    if(context.signal.aborted||this.closed)fail('PLUGIN_STOPPED');
    const {ns,method,args}=params??{};
    if(typeof ns!=='string'||typeof method!=='string'||!/^[a-zA-Z][\w]*$/.test(ns)||!/^[a-zA-Z][\w]*$/.test(method)||['constructor','prototype','__proto__'].includes(method)||!Array.isArray(args)||args.length>32)fail('PLUGIN_INVALID_CALL');
    const permissions=record.manifest.permissions;
    if(GUI_NAMESPACES.has(ns))fail('PLUGIN_CAPABILITY_UNAVAILABLE');
    if(ns==='settings'&&method==='get')return {...this.settings.get(record.manifest.id)};
    if(ns==='session'&&['status','username'].includes(method)){const session=await this.sessionSnapshot();return method==='status'?session.status:session.username;}
    if(ns==='storage'){
      if(!permissions.includes('storage'))fail('PLUGIN_PERMISSION_DENIED');
      return this.storage(record.manifest.id,method,args,context);
    }
    const operation=`${ns}.${method}`;
    const capability=await this.resolveOperation?.(operation);
    if(!capability||capability.supported===false||typeof this.dispatch!=='function')fail('PLUGIN_OPERATION_UNAVAILABLE');
    if(capability.capability==='gui'||capability.guiOnly)fail('PLUGIN_CAPABILITY_UNAVAILABLE');
    if(typeof capability.permission!=='string'||!permissions.includes(capability.permission))fail('PLUGIN_PERMISSION_DENIED');
    if(capability.mutation===true&&context.confirm!==true)fail('PLUGIN_CONFIRMATION_REQUIRED');
    if(context.signal.aborted)fail('PLUGIN_STOPPED');
    await context.beforeWrite?.();
    if(context.signal.aborted)fail('PLUGIN_STOPPED');
    return this.dispatch(operation,args,{pluginId:record.manifest.id,permissions:[...permissions],signal:context.signal,confirm:context.confirm,beforeWrite:context.beforeWrite});
  }
  async start(record,options={}) {
    const id=record.manifest.id;
    const epoch=options.expectedEpoch??this.epochs.get(id)??0;
    if(epoch!==(this.epochs.get(id)??0))fail('PLUGIN_STOPPED');
    if(this.starting.has(id))return this.starting.get(id);
    const existing=this.processes.get(id);if(existing?.process.alive)return existing;
    if(existing){await existing.process.waitForExit();if(this.starting.has(id))return this.starting.get(id);}
    const pending=this.startProcess(record,options,epoch);this.starting.set(id,pending);
    try{return await pending;}finally{if(this.starting.get(id)===pending)this.starting.delete(id);}
  }
  async startProcess(record,options,epoch) {
    const id=record.manifest.id;
    const bundle=await readBundle(this.paths(id).directory);
    if(bundle.digest!==record.digest)fail('PLUGIN_PACKAGE_CHANGED','Installed plugin files changed after approval; reinstall and review the package.');
    record={...record,manifest:bundle.manifest};
    if(!bundle.compatibility.supported)fail(bundle.compatibility.reason);
    const entry=path.join(this.paths(id).directory,bundle.manifest.kind==='rust'?bundle.manifest.bin:bundle.manifest.entry);
    this.settings.set(id,settingsFor(bundle.manifest,options.settings??this.settings.get(id)));
    const session=await this.sessionSnapshot();
    const storage=record.manifest.permissions.includes('storage')?await this.storage(id,'snapshot',[],{}):{};
    await options.beforeWrite?.();
    if(options.signal?.aborted)fail('PLUGIN_STOPPED');
    if(this.closed)fail('PLUGIN_HOST_CLOSED');
    if(epoch!==(this.epochs.get(id)??0))fail('PLUGIN_STOPPED');
    const runtime=new PluginProcess({manifest:bundle.manifest,entry,cwd:this.paths(id).directory,onCall:(params,context)=>this.bridge(record,params,context),onEvent:this.onEvent,workerUrl:this.workerUrl});
    const live={process:runtime,commands:[]};this.processes.set(id,live);
    try{
      const reply=await runtime.call('activate',{entry,manifest:bundle.manifest,permissions:bundle.manifest.permissions,settings:this.settings.get(id),session,storage},{timeoutMs:options.timeoutMs,signal:options.signal,beforeWrite:options.beforeWrite});
      live.commands=validateCommands(reply?.commands);
      return live;
    }catch(error){runtime.stop();await runtime.waitForExit();this.processes.delete(id);throw error;}
  }
  async enable(id,options={}) {
    requireConfirm(options);
    return this.exclusive(async()=>{
      const expectedEpoch=this.epochs.get(id)??0;
      const record=await this.record(id);
      if(options.settings!==undefined){const previous=this.processes.get(id)?.process;previous?.stop();await previous?.waitForExit();this.processes.delete(id);}
      const live=await this.start(record,{...options,expectedEpoch});
      if(this.closed||expectedEpoch!==(this.epochs.get(id)??0))fail('PLUGIN_STOPPED');
      await options.beforeWrite?.();
      if(options.signal?.aborted)fail('PLUGIN_STOPPED');
      record.enabled=true;await writeJson(this.paths(id).record,record);
      return {id,enabled:true,commands:live.commands,compatibility:compatibility(record.manifest)};
    });
  }
  async disable(id) {
    // Stop immediately so in-flight callbacks lose their authorization signal.
    this.epochs.set(id,(this.epochs.get(id)??0)+1);
    const previous=this.processes.get(id)?.process;previous?.stop();this.processes.delete(id);this.settings.delete(id);
    return this.exclusive(async()=>{await previous?.waitForExit();const record=await this.record(id);record.enabled=false;await writeJson(this.paths(id).record,record);return{id,enabled:false};});
  }
  async commands(id) {
    const record=await this.record(id);
    if(!record.enabled)fail('PLUGIN_DISABLED');
    const live=this.processes.get(id);
    // Listing never starts third-party code. Explicit enable or call starts it.
    return {id,running:live?.process.alive===true,commands:live?.commands??[]};
  }
  async call(id,command,input='',options={}) {
    if(this.closed)fail('PLUGIN_HOST_CLOSED');
    await options.beforeWrite?.();
    if(options.signal?.aborted)fail('PLUGIN_STOPPED');
    const expectedEpoch=this.epochs.get(id)??0;
    const record=await this.record(id);if(!record.enabled)fail('PLUGIN_DISABLED');
    if(typeof command!=='string'||typeof input!=='string'||Buffer.byteLength(input)>1024*1024)fail('PLUGIN_INVALID_COMMAND');
    const live=await this.start(record,{...options,expectedEpoch});
    if(!live.commands.some(item=>item.id===command))fail('PLUGIN_COMMAND_NOT_FOUND');
    return live.process.call('run',{command,input,session:await this.sessionSnapshot()},options);
  }
  async uninstall(id,options={}) {
    requireConfirm(options);pluginId(id);
    this.epochs.set(id,(this.epochs.get(id)??0)+1);
    const previous=this.processes.get(id)?.process;previous?.stop();this.processes.delete(id);this.settings.delete(id);
    return this.exclusive(async()=>{
      await previous?.waitForExit();
      await this.record(id);const targets=this.paths(id);
      await this.storageQueues.get(id)?.catch(()=>{});
      for(const target of [targets.directory,targets.record,targets.storage]){
        await checkPath(target,true);await rm(target,{recursive:target===targets.directory,force:true});
      }
      return{id,uninstalled:true};
    });
  }
  async close() {
    this.closed=true;
    const exiting=[...this.processes.values()].map(live=>{live.process.stop();return live.process.waitForExit();});
    this.processes.clear();this.settings.clear();
    await Promise.all(exiting);
    await Promise.allSettled([...this.storageQueues.values(),this.mutations,...this.starting.values()]);
  }
}
