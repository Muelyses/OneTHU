import assert from 'node:assert/strict';
const { calendarDraftRange } = await import('../apps/desktop/src/lib/calendarDraft.ts');
const valid={date:'2026-10-20',endDate:'2026-10-21',start:'22:00',end:'04:00',allDay:false};
assert.deepEqual(calendarDraftRange(valid),{start:Date.parse('2026-10-20T22:00:00+08:00'),end:Date.parse('2026-10-21T04:00:00+08:00')});
for(const change of [{date:''},{endDate:''},{start:''},{end:''},{date:'2026-02-30'},{start:'24:00'},{end:'04:61'},{endDate:'2026-10-19'}]) assert.throws(()=>calendarDraftRange({...valid,...change}));
assert.equal(calendarDraftRange({...valid,allDay:true,start:'',end:''}).end,Date.parse('2026-10-22T00:00:00+08:00'));
console.log('Calendar editor validates empty/invalid fields, cross-day range and Shanghai timestamps independently of device zone');
