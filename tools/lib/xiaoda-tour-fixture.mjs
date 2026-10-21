/** Isolated data adapter for screenshots/navigation tests. Never contacts the school. */
import { sample } from './public-capture-locale.mjs';
export async function installXiaodaTourFixture(page, locale = 'zh-CN') {
  await page.addInitScript(skills => {
    window.__tourSkills = skills;
    window.__tourSkillInvoke = async (command, args) => {
      if (command === 'skills_action' && args.action === 'list') return structuredClone(window.__tourSkills);
      if (command === 'skills_action' && args.action === 'compute') return { runtime: 'quickjs', executed: true, result: 10 };
      throw new Error('Unimplemented tour fixture command');
    };
  }, locale === 'en-US' ? sample([{ id: 'demo-notes', name: '示例资料整理', description: '阅读资料，整理要点与待办。', sha256: 'fixture', installedAt: 1, enabled: false, compatibility: 'text', requirements: [], files: ['SKILL.md'], expandedBytes: 256 }], locale) : [{ id: 'demo-notes', name: '示例资料整理', description: '阅读资料，整理要点与待办。', sha256: 'fixture', installedAt: 1, enabled: false, compatibility: 'text', requirements: [], files: ['SKILL.md'], expandedBytes: 256 }]);
  await page.route('**/src/lib/skills.ts*', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/import \{ invoke \} from [^;]+;/, 'const invoke = (...args) => window.__tourSkillInvoke(...args);');
    await route.fulfill({ response, body });
  });
  await page.route('**/src/lib/xiaoda.ts*', async route => {
    const response = await route.fetch();
    const source = (await response.text()).replace(/import \{ logLine \} from/, 'import { logLine, session as tourSession } from');
    if (!source.includes('session as tourSession')) throw new Error('Xiaoda fixture must use the actual session import');
    const fixture = `
xiaodaClient.setToken('isolated-tour-token');
xiaodaClient.getUserInfo = async () => { tourSession.username = '2026000000'; tourSession.state = 'ready'; return { uniqueId: 'demo', name: '示例同学', zjh: '2026000000' }; };
xiaodaClient.builtinGroups = async () => [{ uniqueId: 'demo', name: '学习助手', description: '按任务选择专用智能体', members: [{ uniqueId: 'demo-agent', name: '学习规划助手', description: '梳理学习目标与复习安排' }] }];
xiaodaClient.customModels = async () => [{ id: 1, name: '示例模型', isDefault: true }];
xiaodaClient.createConversation = async () => 'demo-conversation';
xiaodaClient.chatNative = async ({ onDelta }) => { onDelta('可以先按课程整理重点，再把复习任务拆分到每天。你想从哪门课开始？'); };
xiaodaClient.conversationPage = async () => ({ dataList: [], page: { totalCount: 0 } });
xiaodaClient.conversationMessages = async () => [];
xiaodaClient.skillOverview = async () => ({ skillCount: 1, contributorCount: 1, downloadCount: 0 });
xiaodaClient.skillCategories = async () => [{ code: 'demo', name: '示例技能', count: 1 }];
xiaodaClient.skillList = xiaodaClient.skillSearch = async () => ({ dataList: [{ id: 'demo-notes', name: '示例资料整理', description: '阅读资料，整理要点与待办。', authorName: '示例', downloadCount: 0 }], page: { totalCount: 1 } });
`;
    const localized = locale === 'en-US' ? fixture.replace(/'([^'\n]*)'/g, (literal, value) => JSON.stringify(sample(value, locale))) : fixture;
    await route.fulfill({ response, body: source + localized });
  });
}
