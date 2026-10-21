/** Language-specific fictional data; never rewrites the rendered application UI. */
export const captureLocale = process.env.ONETHU_CAPTURE_LOCALE ?? 'zh-CN';
if (!['zh-CN','en-US'].includes(captureLocale)) throw new Error('Unsupported capture locale: '+captureLocale);
export const captureEnglish = captureLocale === 'en-US';
export const captureSuffix = captureEnglish ? '/en-US' : '';
const samples = {
 '示例同学':'Demo Student','示例院系':'Demo Department','示例教师':'Demo Instructor',
 '高等数学':'Calculus','设计思维':'Design Thinking','数据结构':'Data Structures',
 '六教 6A101':'Building 6 · 6A101','三教 3200':'Building 3 · 3200','四教 4104':'Building 4 · 4104',
 '第二章习题':'Chapter 2 exercises','整理小组调研笔记':'Review team research notes','树与图的练习':'Trees and graphs',
 '示例作业内容':'Fictional assignment','课程示例作业':'Fictional assignment',
 '本周课堂讨论安排':'This week’s class discussion','示例通知内容':'Fictional notification',
 '示例校园活动：秋日读书会':'Campus reading club: autumn session','2026秋季学期':'Autumn 2026',
 '小组调研的三个方向':'Three research directions','校园空间、日常动线、协作方式。':'Campus spaces, daily routes, and teamwork.',
 '模拟便笺':'Demo note','模拟课程':'Demo course','示例课程':'Sample course','读书会准备清单':'Reading club checklist','准备书目和讨论问题。':'Prepare books and discussion questions.',
 '示例学习小组':'Demo Study Group','一起整理资料，完成每周学习计划':'Collect resources and plan the week together',
 '示例资料整理':'Demo research notes','阅读资料，整理要点与待办。':'Read resources and summarize key points and tasks.',
 '学习助手':'Study assistants','按任务选择专用智能体':'Choose a specialized agent for your task','学习规划助手':'Study planner',
 '梳理学习目标与复习安排':'Organize study goals and revision plans','示例模型':'Demo model','示例技能':'Demo skills','示例':'Demo',
 '可以先按课程整理重点，再把复习任务拆分到每天。你想从哪门课开始？':'Start by listing the key topics for each course, then split revision into daily tasks. Which course would you like to begin with?',
};
export function sample(value, locale = captureLocale) {
 if (locale !== 'en-US') return value;
 if (typeof value==='string') return samples[value] ?? value;
 if (Array.isArray(value)) return value.map(item=>sample(item,locale));
 if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sample(v,locale)]));
 return value;
}
/** Resolve labels through the same dictionary module used by the running UI. */
export async function uiLabel(page, chinese) {
 if (!captureEnglish) return chinese;
 return page.evaluate(async chinese=>{
  const source=await (await fetch('/src/plugins/ChatDock.tsx')).text();
  const path=[...source.matchAll(/"([^" ]+)"/g)].map(m=>m[1]).find(v=>v.startsWith('/src/i18n/index.ts')) ?? '/src/i18n/index.ts';
  const module=await import(path); const keys=Object.entries(module.localeTable('zh-CN')).filter(([,v])=>v===chinese).map(([key])=>key);
  if (!keys.length) throw new Error('No dictionary label for '+chinese);
  const labels=[...new Set(keys.map(key=>module.t(key)))];
  for(let attempt=0;attempt<30;attempt++){
   const visible=[...document.querySelectorAll('body *')].filter(el=>el.getClientRects().length).flatMap(el=>[el.getAttribute('aria-label'),el.textContent?.trim()]);
   const match=labels.find(label=>visible.includes(label));if(match)return match;
   await new Promise(resolve=>setTimeout(resolve,50));
  }
  return labels[0];
 }, chinese);
}
