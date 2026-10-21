import assert from 'node:assert/strict';
import { scheduleHomework } from '../apps/desktop/src/lib/scheduleHomework.ts';
const hw = (id, deadline, extra = {}) => ({id, title: id, courseId: 'c1', deadline, ...extra});
const records = scheduleHomework([
  hw('iso', '2026-10-20T15:30:00+08:00'), hw('midnight', '2026-10-20 00:00'),
  hw('early', '2026-10-20 00:30'), hw('seconds', 1792483200),
  hw('invalid', 'no date'), hw('ignored', '2026-10-20 12:00'),
  hw('audited', '2026-10-20 12:00', {audited:true}),
  hw('submitted', '2026-10-20 12:00', {submitted:true}), hw('iso', '2026-10-21 12:00'),
], new Map([['ignored', {}]]));
assert.equal(records.length, 5);
assert.equal(records.find(r => r.homework.id === 'iso').time, '15:30');
assert.equal(records.find(r => r.homework.id === 'iso').date, '2026-10-20');
for (const id of ['midnight', 'early']) {
 const r = records.find(r => r.homework.id === id);
 assert.equal(r.startTime, '00:00'); assert.ok(r.endTime > r.startTime);
 assert.equal(r.date, '2026-10-20');
}
assert.equal(records.find(r => r.homework.id === 'midnight').time, '00:00');
assert.equal(records.find(r => r.homework.id === 'submitted').homework.submitted, true);
assert.equal(scheduleHomework([], new Map()).length, 0);
console.log('Schedule homework: ISO/local/epoch deadlines, midnight marker, ignore/audit/dedup/submission passed');

