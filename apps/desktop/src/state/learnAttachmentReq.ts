/**
 * 作业「必须带附件」记忆（R21c）。
 *
 * 由来：网络学堂对必交附件的作业，在**无附件提交**时回
 * `{"result":"error","msg":"请上传附件"}`——这是服务端的权威判定，但此前只在
 * 「撤回附件」那条路径上被解释，提交路径把原文抛给用户，用户只能白跑一趟。
 *
 * 做法：服务端一拒，就把该作业记下来；此后本地在提交前拦下（不再发请求），
 * 并在附件区显示「本作业要求必须带附件」。判定只信服务端，不猜字段——
 * 网络学堂的作业 JSON 里没有可靠的「需要附件」标志位（已核对）。
 *
 * 零依赖（只碰 localStorage）：便于真机行为测试直接引入。
 */
const KEY = "onethu.learn.needFile.v1";
/** 只留最近 200 条：作业会不断新增，本地记忆不该无限膨胀 */
const MAX = 200;

function load(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function save(ids: string[]): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(ids.slice(-MAX)));
  } catch {
    /* 存不下不影响提交（只是下次仍可能白跑一趟） */
  }
}

/** 该作业是否已被服务端判定为必须带附件 */
export function isNeedFile(id: string): boolean {
  return Boolean(id) && load().includes(id);
}

/** 服务端以「请上传附件」拒绝后调用 */
export function markNeedFile(id: string): void {
  if (!id) return;
  const ids = load();
  if (ids.includes(id)) return;
  ids.push(id);
  save(ids);
}

/** 带上附件提交成功后调用：要求可能已变（老师改了设置），以最新一次成功为准 */
export function clearNeedFile(id: string): void {
  if (!id) return;
  const ids = load();
  const next = ids.filter((x) => x !== id);
  if (next.length !== ids.length) save(next);
}
