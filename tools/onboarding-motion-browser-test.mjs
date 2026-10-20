/**
 * Compatibility entry after manual simulation became automatic choreography.
 * The old 902-check manual suite and evidence remain in Git history and
 * docs/onegui/onboarding-motion-2026-10-20; those counts do not describe this suite.
 * Real destinations, keyboard and mode coverage stay in onboarding-browser-test.mjs.
 */
const obsolete = ['ONETHU_TEST_MOTION_ONLY', 'ONETHU_TEST_REPLAY_ONLY', 'ONETHU_TEST_PERFORMANCE_ONLY',
  'ONETHU_TEST_SKIP_STUDIO_PROBE', 'ONETHU_TEST_SKIP_RECORDINGS', 'ONETHU_TEST_SKIP_PERFORMANCE'].filter(name => process.env[name]);
if (obsolete.length) throw new Error(`Manual-animation flags retired: ${obsolete.join(', ')}. Use ONETHU_AUTOPLAY_SCOPE=cycles|lifecycle|recordings|all; sizes and report filename still work.`);
console.log('Automatic guide acceptance: onboarding-autoplay-browser-test.mjs; prior manual-animation evidence is historical.');
await import('./onboarding-autoplay-browser-test.mjs');
