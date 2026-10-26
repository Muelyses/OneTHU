/** Private native-to-daemon bridge. Never register these methods in MCP or the
 * public operation catalog: session snapshots and bindings are local secrets. */
import { createHash } from 'node:crypto';
import type { NodeSession } from './node/session.js';
import type { TaskManager, TaskState } from './tasks/index.js';
import type { RuntimeStore } from './store.js';
import type { CallRequest } from './index.js';
import { syncDesktopYuketang, type YuketangSyncInput } from './yuketangSync.js';
export type DesktopFence = {expectedAccount:string|null;expectedEpoch:number};
export type DesktopPolicy = {enabled:boolean;automatic:boolean;configured:boolean;confirmationMode:string};
export function createDesktopBridge(ports:{
  runtime:NodeSession; tasks:TaskManager;store:RuntimeStore; policy:()=>DesktopPolicy;
  setPolicy:(input:{enabled:boolean;automatic:boolean})=>Promise<unknown>;
  stop:()=>Promise<void>;resume:()=>Promise<void>;exclusive:<T>(work:()=>Promise<T>)=>Promise<T>;
  call:(input:CallRequest,beforeWrite:()=>Promise<void>,signal?:AbortSignal)=>Promise<unknown>;
  notifications:()=>Promise<any>;
}) {
  const {runtime}=ports;
  const notificationLedger=(account:string|null)=>'desktop-notifications-'+createHash('sha256').update(account??'').digest('hex');
  const target=(channel:string,config:any)=>JSON.stringify(channel==='feishu'?
    [config.transport??'node',config.appId,config.chatId,config.receiveIdType??'chat_id']:
    [config.transport??'node',config.userId,config.baseUrl??'https://ilinkai.weixin.qq.com']);
  function fence(input:DesktopFence){
    if(!input||!Number.isSafeInteger(input.expectedEpoch)||!(input.expectedAccount===null||typeof input.expectedAccount==='string'))throw new Error('CLI_BRIDGE_INVALID');
    runtime.assertCurrent(input.expectedEpoch);
    if((runtime.session.username||null)!==input.expectedAccount)throw new Error('CLI_ACCOUNT_CHANGED');
  }
  function status(){return {protocolVersion:1 as const,...runtime.desktopStatus(),policy:ports.policy()};}
  return {
    status,
    exportSession(){return {...status(),snapshot:runtime.exportSession().snapshot};},
    yuketangSync(input:DesktopFence & YuketangSyncInput){return ports.exclusive(async()=>{
      fence(input);
      if(!input.expectedAccount||runtime.session.state!=='ready'||!ports.policy().enabled)throw new Error('CLI_DISABLED');
      return syncDesktopYuketang(ports.store,input.expectedAccount,input,()=>{fence(input);if(!ports.policy().enabled)throw new Error('CLI_DISABLED');});
    });},
    adoptSession(input:Parameters<NodeSession['adoptSession']>[0]){return ports.exclusive(async()=>{
      await runtime.adoptSession(input,ports.stop);await ports.resume();return status();
    });},
    logout(input:DesktopFence){return ports.exclusive(async()=>{fence(input);await ports.stop();fence(input);await runtime.logout();return status();});},
    policy(input:DesktopFence & {enabled:boolean;automatic:boolean}){return ports.exclusive(async()=>{
      fence(input);if(typeof input.enabled!=='boolean'||typeof input.automatic!=='boolean')throw new Error('CLI_BRIDGE_INVALID');
      await ports.setPolicy(input);return status();
    });},
    call(input:DesktopFence & CallRequest,options:{signal?:AbortSignal}={}){
      fence(input);if(!ports.policy().enabled)throw new Error('CLI_DISABLED');
      const {expectedAccount,expectedEpoch,...request}=input;
      return ports.call(request,async()=>{fence({expectedAccount,expectedEpoch});if(!ports.policy().enabled)throw new Error('CLI_DISABLED');},options.signal);
    },
    migrateTasks(input:DesktopFence & {origin:string;state:TaskState;channelMap?:Record<string,string>}){return ports.exclusive(async()=>{
      fence(input);const ledger=await ports.store.read<{mapping:Record<string,string>}>(notificationLedger(input.expectedAccount),{mapping:{}});
      for(const [from,to] of Object.entries(input.channelMap??{}))if(ledger.mapping[from]!==to)throw new Error('TASK_CHANNEL_MAPPING_UNVERIFIED');
      if(!input.state||!Array.isArray(input.state.tasks))throw new Error('TASK_STATE_INVALID');
      const available=new Set((await (await ports.notifications()).taskChannels()).filter((row:any)=>row.available).map((row:any)=>row.id));
      const blocked=input.state.tasks.filter(task=>task?.owner===input.expectedAccount&&(task.template?.channels??[]).some(channel=>!available.has(input.channelMap?.[channel]??channel)));
      const blockedIds=new Set(blocked.map(task=>task.id));
      const result=await ports.tasks.importState(input.origin,{...input.state,tasks:input.state.tasks.filter(task=>!blockedIds.has(task?.id))},input.channelMap);
      fence(input);return {...result,conflicts:[...result.conflicts,...blocked.map(task=>({id:task.id,reason:'notification-binding-required'}))]};
    });},
    notificationsSync(input:DesktopFence & {channels:{channel:'feishu'|'wechat';config:Record<string,unknown>|null;legacyId?:string;sourceIdentity?:string;retainLegacyId?:string}[]}){return ports.exclusive(async()=>{
      fence(input);if(!Array.isArray(input.channels)||input.channels.length>2||new Set(input.channels.map(row=>row?.channel)).size!==input.channels.length)throw new Error('CLI_BRIDGE_INVALID');
      const service=await ports.notifications(),channelMap:Record<string,string>={},conflicts:string[]=[];
      const ledger=await ports.store.read<{mapping:Record<string,string>;targets:Record<string,string>}>(notificationLedger(input.expectedAccount),{mapping:{},targets:{}});
      for(const entry of input.channels){
        fence(input);
        if(!['feishu','wechat'].includes(entry.channel))throw new Error('CLI_BRIDGE_INVALID');
        const prior=(await service.configs())[entry.channel];
        if(entry.config===null){
          if(entry.channel==='wechat'&&typeof entry.retainLegacyId==='string'&&prior&&ledger.targets.wechat===target('wechat',prior)){
            const binding=(await service.taskChannels()).find((row:any)=>row.channel==='wechat');
            if(binding&&ledger.mapping[entry.retainLegacyId]===binding.id){channelMap[entry.retainLegacyId]=binding.id;continue;}
          }
          // A desktop disconnect can only revoke the exact binding it synced.
          // A later CLI binding remains owned by the CLI configuration action.
          if(prior&&ledger.targets[entry.channel]){
            if(target(entry.channel,prior)!==ledger.targets[entry.channel]){conflicts.push(entry.channel);continue;}
            await service.remove(entry.channel,{confirm:true,beforeWrite:async()=>fence(input)});
          }
          delete ledger.targets[entry.channel];
          await ports.store.write(notificationLedger(input.expectedAccount),ledger);continue;
        }
        if(!entry.config||typeof entry.config!=='object'||entry.config.transport)throw new Error('CLI_BRIDGE_INVALID');
        const recipient=entry.channel==='feishu'?entry.config.chatId:entry.config.userId;
        const sourceIdentity=entry.channel==='feishu'?entry.config.appId:entry.sourceIdentity;
        if(entry.legacyId){
          const hash=createHash('sha256').update(JSON.stringify([input.expectedAccount,entry.channel,sourceIdentity??'',recipient])).digest('hex');
          if(entry.legacyId!==entry.channel+':'+hash)throw new Error('TASK_NOTIFICATION_BINDING_CHANGED');
        }
        if(prior&&target(entry.channel,prior)!==target(entry.channel,entry.config)){conflicts.push(entry.channel);continue;}
        await service.configure(entry.channel,entry.config,{confirm:true,beforeWrite:async()=>fence(input)});
        const configured=(await service.configs())[entry.channel];
        ledger.targets[entry.channel]=target(entry.channel,configured);
        const binding=(await service.taskChannels()).find((row:any)=>row.channel===entry.channel);
        if(entry.legacyId&&binding){channelMap[entry.legacyId]=binding.id;ledger.mapping[entry.legacyId]=binding.id;}
        await ports.store.write(notificationLedger(input.expectedAccount),ledger);
      }
      return {channelMap,conflicts,channels:await service.taskChannels()};
    });},
  };
}
