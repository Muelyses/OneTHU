import { createHash } from 'node:crypto';
import type { NodeSession } from '../node/session.js';
import type { RuntimeStore } from '../store.js';
import type { Schema } from '../validation.js';
import catalog from '../catalog.json';
import type { OperationContext, ServiceOperation } from './types.js';

export type ExtendedContext = OperationContext & {accountEpoch?:number};
export type ExtendedOperation = ServiceOperation;
export const string = (maxLength=1024):Schema => ({type:'string',maxLength});
export const integer = (minimum=0,maximum=10000):Schema => ({type:'integer',minimum,maximum});
export const tuple = (items:Schema[]=[],minItems=items.length):Schema => ({type:'array',items,minItems,maxItems:items.length,additionalItems:false});
export const object = (properties:Record<string,Schema>,required=Object.keys(properties)):Schema => ({type:'object',properties,required,additionalProperties:false});
export function fail(code:string):never { throw Object.assign(new Error(code),{code}); }
export function accountKey(runtime:NodeSession, name:string):string {
  const owner=runtime.session.username;
  if(!owner)fail('AUTH_REQUIRED');
  return `${name}-${createHash('sha256').update(owner).digest('hex').slice(0,24)}`;
}
export function check(runtime:NodeSession,ctx:ExtendedContext,epoch:number):void {
  runtime.assertCurrent(epoch);
  if(ctx.signal?.aborted)fail('CLI_CANCELLED');
  if(Date.now()>=ctx.deadline)fail('CLI_DEADLINE_EXCEEDED');
}
export function operation(name:string,permission:string,run:ExtendedOperation['run'],extra:Partial<ExtendedOperation>={}):ExtendedOperation {
  const original=catalog.find(op=>op.name===name);
  return {name,description:original?.description??name,parameters:original?.parameters??tuple(),mutation:original?.mutation??false,permission,authenticated:true,run,...extra};
}
export function requestFetch(runtime:NodeSession,ctx:ExtendedContext,epoch=ctx.accountEpoch??runtime.epoch()):typeof runtime.fetch {
  return async (url,init={})=>{
    check(runtime,ctx,epoch);
    const signal=init.signal?AbortSignal.any([init.signal,ctx.signal]):ctx.signal;
    const response=await runtime.fetch(url,{...init,signal,timeoutMs:Math.max(1,Math.min(45_000,ctx.deadline-Date.now()))} as RequestInit);
    check(runtime,ctx,epoch);return response;
  };
}
export async function save(runtime:NodeSession,store:RuntimeStore,name:string,value:unknown,ctx:ExtendedContext,epoch=ctx.accountEpoch??runtime.epoch()) {
  const key=accountKey(runtime,name);await ctx.beforeWrite();check(runtime,ctx,epoch);await store.write(key,value);check(runtime,ctx,epoch);
}
export async function checkedJson(response:Response):Promise<any> {
  if(!response.ok)throw Object.assign(new Error(`SERVICE_HTTP_${response.status}`),{code:`SERVICE_HTTP_${response.status}`,status:response.status});
  try{return await response.json();}catch{fail('SERVICE_RESPONSE_UNEXPECTED');}
}
export function email(value:string):string {
  const clean=value.trim();if(!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:mails\.)?tsinghua\.edu\.cn$/i.test(clean))fail('MAIL_ADDRESS_INVALID');return clean;
}
export function secret(value:string):string { if(!value||value.length>16384||/[\x00-\x1f\x7f]/.test(value))fail('CREDENTIAL_INVALID');return value; }
