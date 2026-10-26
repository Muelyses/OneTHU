// Keep this file beside runtime.mjs in source and built SDK distributions.
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { format } from 'node:util';

const send = value => process.stdout.write(JSON.stringify(value) + '\n');
for (const method of ['log','info','warn','error','debug']) console[method] = (...args) => process.stderr.write(format(...args).slice(0,65536) + '\n');
const pending = new Map(), commands = new Map();
let sequence = 0, disposer, activating = false, settings = {}, session = {}, storage = {}, storageWrites = [], permissions = [];
function call(ns, method, args) {
  const id = `worker:${++sequence}`;
  return new Promise((resolve,reject) => {
    pending.set(id,{resolve,reject});
    send({jsonrpc:'2.0', id, method:'onethu.call', params:{ns,method,args}});
  });
}
function unavailable(capability) { throw Object.assign(new Error(`PLUGIN_CAPABILITY_UNAVAILABLE: ${capability} requires the desktop GUI.`), {code:'PLUGIN_CAPABILITY_UNAVAILABLE'}); }
function storageCall(method, key, value) {
  if (!permissions.includes('storage')) throw new Error('PLUGIN_PERMISSION_DENIED');
  if (method === 'get') return Object.hasOwn(storage,key) ? structuredClone(storage[key]) : null;
  if (method === 'keys') return Object.keys(storage);
  if (typeof key !== 'string' || !key || key.length > 256 || ['__proto__','constructor','prototype'].includes(key)) throw new Error('PLUGIN_INVALID_STORAGE_KEY');
  if (method === 'set') storage[key] = structuredClone(value); else delete storage[key];
  const queued = call('storage',method,method === 'set' ? [key,value] : [key]);
  queued.catch(() => {}); storageWrites.push(queued);
}
const api = new Proxy(Object.create(null), {get(_target, ns) {
  if (ns === 'then' || typeof ns !== 'string') return undefined;
  if (ns === 'settings') return {get:() => ({...settings})};
  if (ns === 'session') return {status:() => session.status ?? 'logged-out', username:() => session.username ?? null};
  if (ns === 'storage') return {get:key=>storageCall('get',key), keys:()=>storageCall('keys'), set:(key,value)=>storageCall('set',key,value), remove:key=>storageCall('remove',key)};
  return new Proxy(Object.create(null), {get(_target, method) {
    if (method === 'then' || typeof method !== 'string') return undefined;
    return (...args) => call(ns,method,args);
  }});
}});
async function request(method, params) {
  if (method === 'activate') {
    if (activating) throw new Error('PLUGIN_ALREADY_ACTIVE'); activating = true;
    settings = params.settings ?? {}; session = params.session ?? {}; permissions = params.permissions ?? []; storage = Object.assign(Object.create(null), params.storage ?? {});
    // A data: module matches the existing single-file ES module contract and
    // avoids package.json changing .js to CommonJS. Relative imports explicitly
    // require a future module-bundle contract; built-in Node imports still work.
    const source = await readFile(params.entry,'utf8');
    const mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    if (!mod.manifest || mod.manifest.id !== params.manifest.id || mod.manifest.version !== params.manifest.version
      || JSON.stringify([...(mod.manifest.permissions ?? [])].sort()) !== JSON.stringify([...params.manifest.permissions].sort()) || typeof mod.default !== 'function') throw new Error('PLUGIN_MANIFEST_MISMATCH');
    const context = {onethu:api,
      registerCommand(command, run) {
        if (!command || typeof command.id !== 'string' || commands.has(command.id) || typeof run !== 'function') throw new Error('PLUGIN_INVALID_COMMANDS');
        commands.set(command.id,{...command,run});
      },
      registerTab:()=>unavailable('tabs'), registerCss:()=>unavailable('CSS'), registerAtom:()=>unavailable('atoms'), registerWidget:()=>unavailable('widgets'),
      log:line=>send({jsonrpc:'2.0',method:'log',params:{line:String(line).slice(0,65536)}}),
    };
    disposer = await mod.default(context);
    await Promise.all(storageWrites.splice(0));
    return {commands:[...commands.values()].map(({run,...command})=>command)};
  }
  if (method === 'run') {
    session = params.session ?? session;
    const command = commands.get(params.command); if (!command) throw new Error('PLUGIN_COMMAND_NOT_FOUND');
    const result = await command.run(params.input ?? '');
    await Promise.all(storageWrites.splice(0));
    return result ?? null;
  }
  if (method === 'dispose') {
    if (typeof disposer === 'function') await disposer();
    else if (typeof disposer?.dispose === 'function') await disposer.dispose();
    await Promise.all(storageWrites.splice(0));
    return null;
  }
  throw new Error('PLUGIN_PROTOCOL_METHOD_UNSUPPORTED');
}
const input = createInterface({input:process.stdin,crlfDelay:Infinity});
input.on('line', line => {
  let message; try { message=JSON.parse(line); } catch { return; }
  if (!message.method) {
    const item=pending.get(message.id); if (!item) return; pending.delete(message.id);
    if (message.error) item.reject(Object.assign(new Error(String(message.error.message ?? 'PLUGIN_HOST_ERROR')),{code:message.error.data?.code}));
    else item.resolve(message.result); return;
  }
  if (!Object.hasOwn(message,'id')) { if (message.method === 'interrupt') process.exit(1); return; }
  Promise.resolve().then(()=>request(message.method,message.params ?? {})).then(result=>send({jsonrpc:'2.0',id:message.id,result}),
    error=>send({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:String(error?.message ?? 'PLUGIN_RUNTIME_ERROR').slice(0,1500),data:{code:error?.code}}}));
});
input.on('close',()=>process.exit(0));
