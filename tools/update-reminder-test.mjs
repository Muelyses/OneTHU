/** Exercise the real persisted reminder policy across fresh module instances. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync('apps/desktop/src/lib/updateReminder.ts','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
let run=0, checks=0, writesBlocked=false;
const data=new Map();
globalThis.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>{if(writesBlocked)throw Error('storage full');data.set(k,String(v));},removeItem:k=>data.delete(k)};
globalThis.window=new EventTarget();
const fresh=()=>import('data:text/javascript;base64,'+Buffer.from(compiled+'\n// instance '+run++).toString('base64'));
const ok=(value,label)=>{assert.ok(value,label);checks++;console.log('✓ '+label);};
let policy=await fresh(); const now=1_800_000_000_000;
ok(policy.updateReminderDelay('0.11.3',now)===0,'new version is immediately eligible');
for(const [duration,ms] of Object.entries(policy.UPDATE_SNOOZE_MS)){
 policy.snoozeUpdate('v0.11.3',duration,now);
 ok(policy.updateReminderDelay('0.11.3',now)===ms,duration+' preserves its selected deadline');
 policy=await fresh();
 ok(policy.updateReminderDelay('v0.11.3',now+123)===ms-123,duration+' survives app restart and v-prefix normalization');
 ok(policy.updateReminderDelay('0.11.3',now+ms)===0,duration+' expires at its deadline in the same session');
 ok(policy.updateReminderDelay('0.11.4',now)===0,duration+' does not suppress a newer release');
}
data.set(policy.LEGACY_KEY,'v0.11.3');data.delete(policy.SNOOZE_KEY);
ok(policy.updateReminderDelay('0.11.3',now)===Infinity,'legacy explicit release skip remains respected');
policy.snoozeUpdate('0.11.3','hour',now);
ok(policy.updateReminderDelay('0.11.3',now)===3_600_000&&!data.has(policy.LEGACY_KEY),'choosing a reminder replaces a legacy permanent skip');
for(const bad of ['broken','null','{}','{"version":1,"until":9000000000000}','{"version":"0.11.3","until":"forever"}']){
 data.set(policy.SNOOZE_KEY,bad); policy=await fresh();
 ok(policy.updateReminderDelay('0.11.3',now)===0,'invalid persisted state recovers: '+bad);
}
data.set(policy.SNOOZE_KEY,JSON.stringify({version:'0.11.3',until:now+policy.UPDATE_SNOOZE_MS.week*3}));
ok(policy.updateReminderDelay('0.11.3',now)===policy.UPDATE_SNOOZE_MS.week,'clock skew bounds reminder timer to one week');
let notifications=0;window.addEventListener(policy.UPDATE_REMINDER_CHANGED,()=>notifications++);
writesBlocked=true;policy.snoozeUpdate('0.11.3','day',now);
ok(policy.updateReminderDelay('0.11.3',now)===86_400_000,'storage failure still snoozes for the current session');
ok(notifications===1,'one reminder-change event per explicit action');
const review={ok:true,current:'0.11.2',latest:'0.11.3',hasUpdate:true,downloadUrl:'https://example.invalid/update'};
policy.stageUpdateReview(review);
ok(policy.consumeUpdateReview()===review&&policy.consumeUpdateReview()===null,'review hands off the checked result once without downloading');
console.log(`${checks} reminder policy checks passed`);
