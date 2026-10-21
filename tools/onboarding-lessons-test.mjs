/** Pure lesson content: mode boundaries and honest transfer descriptions, without a browser or saved preferences. */
import assert from 'node:assert/strict';
import { FULL_LESSONS, EXTRA_LESSONS, SIMPLE_LESSONS, PRACTICAL_LESSONS, lessonsForMode } from '../apps/desktop/src/lib/onboardingLessons.ts';

let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; console.log('✓ ' + label); };
const ids = lessons => lessons.map(lesson => lesson.id).join(',');
check(ids(FULL_LESSONS) === 'board,vault,code,nfc,organization,xiaoda', 'full mode has the five established workflows followed by Xiaoda');
check(ids(EXTRA_LESSONS) === 'explorer,onego,plugin,customize,campus,data', 'all six former secondary lessons remain optional discoveries');
check(ids(SIMPLE_LESSONS) === 'today,quick', 'simple mode covers only today and the five fixed entries');
check(ids(PRACTICAL_LESSONS) === 'today,more,swap', 'practical mode covers today, the real directory and four replaceable entries');
check(lessonsForMode('simple') === SIMPLE_LESSONS && lessonsForMode('practical') === PRACTICAL_LESSONS && lessonsForMode('full') === FULL_LESSONS, 'mode selection returns the correct lesson collection');
check(new Set([...FULL_LESSONS, ...EXTRA_LESSONS].map(lesson => lesson.id)).size === 12, 'the six primary and six optional lessons expose twelve distinct full-mode topics');
const targets = new Set(['home', 'workspaces', 'vault', 'organization', 'onego', 'plugins', 'appearance', 'learn', 'data', 'practical', 'xiaoda']);
for (const [mode, lessons] of [['full', FULL_LESSONS], ['extra', EXTRA_LESSONS], ['simple', SIMPLE_LESSONS], ['practical', PRACTICAL_LESSONS]]) {
  check(lessons.every(lesson => lesson.title.trim() && lesson.lead.trim() && lesson.steps.length && lesson.steps.every(step => step.trim() && [...step].length <= 42)), mode + ' lessons contain readable, nonempty instructions within the copy limit');
  check(lessons.every(lesson => targets.has(lesson.target) && lesson.action?.trim()), mode + ' lessons expose named real destinations for practice');
}
check([...SIMPLE_LESSONS, ...PRACTICAL_LESSONS].every(lesson => ['home', 'practical'].includes(lesson.target)), 'compact-mode lessons cannot navigate to full-mode-only tools');
check(PRACTICAL_LESSONS.find(lesson => lesson.id === 'more').target === 'practical' && PRACTICAL_LESSONS.find(lesson => lesson.id === 'swap').target === 'practical', 'both practical directory and replacement lessons open the real directory');
const xiaoda = FULL_LESSONS.find(lesson => lesson.id === 'xiaoda');
check(xiaoda.target === 'xiaoda' && xiaoda.steps.some(line => line.includes('智能体')) && xiaoda.steps.some(line => line.includes('OH')) && xiaoda.steps.some(line => line.includes('Python')), 'Xiaoda explains agents, OH skills and unsupported environments with a real destination');
const vault = FULL_LESSONS.find(lesson => lesson.id === 'vault');
check(vault.lead.includes('本机') && vault.lead.includes('分享') && vault.steps.some(step => step.includes('贴在屏幕边缘')) && vault.steps.some(step => step.includes('向内轻滑')), 'vault lesson describes local staging and the current movable edge entry');
const code = FULL_LESSONS.find(lesson => lesson.id === 'code');
check(code.lead.includes('联网') && code.steps.some(step => step.includes('限定邮箱需对应账号')) && !JSON.stringify(code).includes('无需云盘账号'), 'short-code lesson distinguishes connectivity and private-recipient access');
check(FULL_LESSONS.find(lesson => lesson.id === 'organization').lead.includes('创建组织即绑定组织名片'), 'organization card is bound to the created organization');
check(SIMPLE_LESSONS.some(lesson => JSON.stringify(lesson).includes('OH 搜索胶囊') && JSON.stringify(lesson).includes('API')) && PRACTICAL_LESSONS.some(lesson => JSON.stringify(lesson).includes('OH 搜索胶囊') && JSON.stringify(lesson).includes('API')), 'both compact modes retain OH search and custom API guidance');
console.log(`${checks} onboarding lesson assertions passed`);
