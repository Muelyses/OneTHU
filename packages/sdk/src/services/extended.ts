import type { NodeSession } from '../node/session.js';
import type { RuntimeStore } from '../store.js';
import type { ServiceOperation } from './types.js';
import { check } from './extendedSupport.js';
import { createCloudServices } from './cloud.js';
import { createCalendarServices } from './calendar.js';
import { createMailServices } from './mail.js';
import { createExternalServices } from './external.js';
import { createSelectionServices } from './selection.js';
import { createVisitServices } from './visit.js';

export function createExtendedServices(runtime:NodeSession,store:RuntimeStore):ServiceOperation[]{
  return [...createCloudServices(runtime,store),...createCalendarServices(runtime,store),...createMailServices(runtime,store),...createExternalServices(runtime,store),...createSelectionServices(runtime),...createVisitServices(runtime,store)].map(op=>({...op,async run(args,ctx){
    const epoch=runtime.epoch();check(runtime,ctx,epoch);
    const guarded={...ctx,accountEpoch:epoch,async beforeWrite(){check(runtime,ctx,epoch);await ctx.beforeWrite();check(runtime,ctx,epoch);}};
    const result=await op.run(args,guarded);check(runtime,ctx,epoch);return result;
  }}));
}
