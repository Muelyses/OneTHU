import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PluginError, fail } from './security.mjs';

const LIMIT = 4 * 1024 * 1024;
const worker = fileURLToPath(new URL('./worker.mjs',import.meta.url));
export class PluginProcess {
  constructor({manifest,entry,cwd,onCall,onEvent,workerUrl}) {
    this.manifest=manifest; this.onCall=onCall; this.onEvent=onEvent; this.pending=new Map(); this.seq=0; this.alive=true; this.active=null;
    const env={OH_MCP_PORT:'0'};
    for(const key of ['PATH','HOME','USERPROFILE','SYSTEMROOT','SystemRoot','WINDIR','TMPDIR','TMP','TEMP','LANG','LC_ALL']) if(process.env[key]) env[key]=process.env[key];
    this.child=spawn(manifest.kind==='js'?process.execPath:entry,manifest.kind==='js'?[workerUrl?fileURLToPath(workerUrl):worker]:[],{cwd,env,stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false});
    this.child.on('error',()=>this.stop(new PluginError('PLUGIN_START_FAILED','The local plugin could not start. Check its operating system, architecture and executable format.')));
    this.child.on('exit',()=>this.stop(new PluginError('PLUGIN_EXITED')));
    this.child.stdin.on('error',()=>this.stop(new PluginError('PLUGIN_CONNECTION_CLOSED')));
    let buffer=Buffer.alloc(0), stderrBytes=0;
    this.child.stdout.on('data',chunk=>{
      buffer=Buffer.concat([buffer,chunk]);
      if(buffer.length>LIMIT) return this.stop(new PluginError('PLUGIN_OUTPUT_TOO_LARGE'));
      let end;
      while((end=buffer.indexOf(10))>=0) {
        const line=buffer.subarray(0,end).toString('utf8'); buffer=buffer.subarray(end+1);
        let message; try {message=JSON.parse(line);} catch {return this.stop(new PluginError('PLUGIN_INVALID_PROTOCOL'));}
        void this.receive(message).catch(()=>this.stop(new PluginError('PLUGIN_INVALID_PROTOCOL')));
      }
    });
    this.child.stderr.on('data',chunk=>{
      stderrBytes+=chunk.length; if(stderrBytes>LIMIT) this.stop(new PluginError('PLUGIN_OUTPUT_TOO_LARGE'));
      // Plugin diagnostics may contain user data. Opt-in event sinks own their
      // presentation; never write them into the parent's stdout/stderr.
      else this.event({pluginId:manifest.id,type:'stderr',text:chunk.toString('utf8').slice(0,65536)});
    });
  }
  event(value) { try { this.onEvent?.(value); } catch { /* Diagnostic sinks must not crash the SDK. */ } }
  send(message) {
    if(!this.alive) fail('PLUGIN_EXITED');
    const encoded=JSON.stringify(message);
    if(Buffer.byteLength(encoded)>LIMIT) fail('PLUGIN_MESSAGE_TOO_LARGE');
    this.child.stdin.write(encoded+'\n');
  }
  async receive(message) {
    if(!this.alive) return;
    if(!message || message.jsonrpc!=='2.0') return this.stop(new PluginError('PLUGIN_INVALID_PROTOCOL'));
    if(Object.hasOwn(message,'id') && !(Number.isSafeInteger(message.id) || typeof message.id==='string'&&message.id.length<=128)) return this.stop(new PluginError('PLUGIN_INVALID_PROTOCOL'));
    if(message.method) {
      if(typeof message.method!=='string'||message.method.length>100)return this.stop(new PluginError('PLUGIN_INVALID_PROTOCOL'));
      if(!Object.hasOwn(message,'id')) { this.event({pluginId:this.manifest.id,type:message.method,params:message.params}); return; }
      const active=this.active;
      try {
        if(message.method!=='onethu.call' || !active || active.controller.signal.aborted) fail('PLUGIN_CALL_NOT_ACTIVE');
        const result=await this.onCall(message.params,{signal:active.controller.signal,confirm:active.confirm,beforeWrite:active.beforeWrite});
        if(this.alive && this.active===active && !active.controller.signal.aborted) this.send({jsonrpc:'2.0',id:message.id,result:result??null});
      } catch(error) {
        const code=/^[A-Z][A-Z0-9_]{2,63}$/.test(error?.code??'')?error.code:'PLUGIN_HOST_ERROR';
        if(this.alive) this.send({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:`${code}: Host operation failed.`,data:{code}}});
      }
      return;
    }
    const pending=this.pending.get(message.id); if(!pending) return;
    this.pending.delete(message.id); pending.cleanup();
    if(this.active===pending) this.active=null;
    pending.controller.abort();
    if(Object.hasOwn(message,'error')) {
      const raw=message.error?.data?.code ?? /^([A-Z][A-Z0-9_]{2,63})(?::|\b)/.exec(message.error?.message??'')?.[1];
      pending.reject(new PluginError(/^[A-Z][A-Z0-9_]{2,63}$/.test(raw??'')?raw:'PLUGIN_RUNTIME_ERROR','The plugin reported an error.'));
    } else if(Object.hasOwn(message,'result')) pending.resolve(message.result);
    else pending.reject(new PluginError('PLUGIN_INVALID_PROTOCOL'));
  }
  async call(method,params={},options={}) {
    if(this.active) return Promise.reject(new PluginError('PLUGIN_BUSY'));
    if(!this.alive) return Promise.reject(new PluginError('PLUGIN_EXITED'));
    if(options.signal?.aborted)fail('PLUGIN_STOPPED');
    await options.beforeWrite?.();
    if(options.signal?.aborted||!this.alive)fail('PLUGIN_STOPPED');
    if(this.active)fail('PLUGIN_BUSY');
    const timeout=options.timeoutMs??30000;
    if(!Number.isSafeInteger(timeout)||timeout<1||timeout>150000) return Promise.reject(new PluginError('PLUGIN_INVALID_TIMEOUT'));
    const id=`host:${++this.seq}`;
    return new Promise((resolve,reject)=>{
      const record={resolve,reject,controller:new AbortController(),confirm:options.confirm===true,beforeWrite:options.beforeWrite};
      record.timer=setTimeout(()=>this.stop(new PluginError('PLUGIN_TIMEOUT')),timeout);
      const abort=()=>this.stop(new PluginError('PLUGIN_STOPPED'));
      record.cleanup=()=>{clearTimeout(record.timer);options.signal?.removeEventListener('abort',abort);};
      this.pending.set(id,record); this.active=record;
      options.signal?.addEventListener('abort',abort,{once:true});
      if(options.signal?.aborted){abort();return;}
      try{this.send({jsonrpc:'2.0',id,method,params});}catch(error){this.stop(error);}
    });
  }
  stop(error=new PluginError('PLUGIN_STOPPED')) {
    if(!this.alive) return;
    this.alive=false;
    for(const item of this.pending.values()){item.cleanup();item.controller.abort();item.reject(error);}
    this.pending.clear(); this.active=null;
    this.child.stdin.destroy(); this.child.kill();
    const force=setTimeout(()=>{if(this.child.exitCode===null)this.child.kill('SIGKILL');},500); force.unref();
  }
}
