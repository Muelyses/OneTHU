/**
 * 附件动作执行层（需求 7）：把一份附件一键「转存云盘 / 交作业（网络学堂 + 雨课堂）/ 发讨论区」。
 *
 * ## 铁律（改这个文件前先读）
 * 1. **严禁静默提交**：作业类写入必须先经用户确认。`submitHomework` / `postDiscussion`
 *    默认确认钩子 = `lib/confirm.tsx` 的 `confirmOk`；`AttachActionsSheet` 会注入**面板内联确认**
 *    （悬浮窗里也保证有确认 UI，不依赖宿主是否挂了 `<ConfirmHost/>`）。
 * 2. **结构化返回，不向 UI 抛异常**：三个入口一律 `ok / needUi / error / ui`，失败给人话。
 * 3. **绝不自动猜上下文**：云盘库与目录、课程、作业、板块只认显式入参；缺什么就 `needUi:true`
 *    让用户在面板里选（`im/mediaPipe.ts:59` 与 `im/registry.ts:493` 的两次教训：曾把用户附件
 *    存进错误的资料库）。
 * 4. **不碰 OJ**：本文件没有任何 OJ 写入路径（OJ 规则：未经允许不得改 OJ 作业）。
 * 5. 本层**不做 UI 副作用**（不弹 toast、不导航）：结果交给 `AttachActionsSheet` 呈现；
 *    需要回应用本体的场景用 `ui.route` 交给宿主（悬浮层红线：只有用户明确点击才回本体）。
 *
 * ## 线上写入路径的实测状态（2026-10-10；没测过的一律写「未实测」，不许假装）
 * - **转存云盘**：`seafile_mkdir` / `seafile_upload` 是仓库长期在跑的命令（memory/sync.ts、IM 附件
 *   管道），上传行为已实测；本文件新增的只有「内存 File → `write_temp_file` → 上传」这一段，
 *   而 `write_temp_file` 是 Lead 本轮新加的主 crate 命令 → **未实测**。
 * - **网络学堂交作业**：`learn.submitHomework` 就是作业详情页提交按钮的同一个函数
 *   （`pages/learn/AssignmentDetailPage.tsx:227`）→ 页面路径已实测；但「不打开页面 headless 调用」
 *   这段本轮**未实测**（同一函数、同一会话世界：lib/clients.ts 的 learn 单例走 Rust 原生 HTTP +
 *   cookie 仓，不需要页面在场）。
 * - **雨课堂交作业**：**有意不自动提交**（见 `submitHomework` 的 ykt 分支），只返回 `needUi` +
 *   官方作答页兜底 → 无写入路径可实测。
 * - **发讨论区**：`postBbsReply` 由 `pages/learn/Forum.tsx:316` 在用（回复路径页面已实测）；
 *   `postBbsThread` 由 Forum.tsx:518 在用，但 core 注释自述「schema 首版未经真机采样」
 *   （`packages/core/src/learn/client.ts:1410`）→ 本文件保守处理返回包并把服务器原文透出，
 *   **发新话题这一段未实测**。
 */
import { invoke } from "@tauri-apps/api/core";
import { learn, logLine } from "./clients.js";
import { explainNetworkError, isTauri } from "./transport.js";
import { confirmOk } from "./confirm.js";
import { bytesToBase64 } from "./imageSave.js";
import { extForMime, fileToBytes, formatSize, type AttachFile } from "./attach.js";
import { ensureSeafileLoaded, getSeafileToken, refreshDir, type SeafileRepo } from "../state/seafile.js";
import { clearNeedFile, markNeedFile } from "../state/learnAttachmentReq.js";
import { invalidateLearnCache, refreshLearnDataSilently } from "../state/data.js";
import type { LearnNav, Page } from "../state/app.js";

/* ══════════════════════ 公共类型 ══════════════════════ */

/** 写操作前确认：返回 false = 用户取消（取消不算错误，但也不做任何写入） */
export type ConfirmFn = (msg: string) => Promise<boolean>;

/** 「得让用户去某个界面才能做完」的提示（宿主据此导航 / 打开官方页） */
export interface AttachActionUi {
  /** 应用内路由（回本体是用户明确点击后的例外，见 PLAN §5 红线） */
  route?: Page;
  /** 路由参数（LearnNav 口径，与 navigate(page, params) 一致） */
  params?: LearnNav;
  /** 官方页面直链（雨课堂官方作答页；非应用内路由） */
  officialUrl?: string;
  /** 官方页打开通道：ykt-submit-webview = lib/yktSubmitWebview.openYktSubmitWebview（带会话 Cookie） */
  officialChannel?: "ykt-submit-webview";
  /** 给用户看的一句话（面板直接显示） */
  message: string;
}

export interface AttachActionResult {
  ok: boolean;
  /** 需要用户再操作一步才能完成（此时 error 是原因说明，不是崩溃） */
  needUi?: boolean;
  /** 人话错误（已过 explainNetworkError 收敛） */
  error?: string;
  /** 云盘落点（如「/OH附件/照片.jpg」） */
  path?: string;
  repoId?: string;
  repoName?: string;
  /** 远端确认的字节数（seafile_upload 返回值） */
  size?: number;
  ui?: AttachActionUi;
  /** OH 的答复文本（只有「问 OH」这个动作用；由 AttachActionsSheet 直接显示） */
  answer?: string;
  /** 本次按图像随消息附带的图片数（「问 OH」动作；多模态关时为 0） */
  images?: number;
}

function fail(error: string, extra: Partial<AttachActionResult> = {}): AttachActionResult {
  return { ok: false, error, ...extra };
}

function needUi(error: string, ui: AttachActionUi): AttachActionResult {
  return { ok: false, needUi: true, error, ui };
}

/* ══════════════════════ 附件 → 路径 / File ══════════════════════ */

/**
 * 文件名安全化（远端名 = 本地文件名，见 Rust `seafile_upload_inner`：它用 local_path 的
 * file_name 当远端名）。规则对齐 `im/mediaPipe.ts` 的 safeName，但本模块不 import IM 模块
 * （悬浮窗 chunk 不想拖 IM 那一坨）。
 */
export function safeAttachName(raw: string, mime = ""): string {
  const base = (raw || "").split(/[/\\]/).pop() ?? "";
  const cleaned = base
    .replace(/[/\\:*?"<>|]/g, "_")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, "_")
    .trim()
    .replace(/^\.+/, "");
  return cleaned || `附件-${Date.now()}.${extForMime(mime)}`;
}

/**
 * 附件 → 本地文件路径（云盘上传 / 需要吃 path 的通道用）。
 *  - 有真路径（桌面对话框 / 原生桥）：直接用；
 *  - 只有内存 File（`<input>` 选择器给不出路径，见 `lib/attach.ts` 文件头）：字节落一个临时文件。
 *    **依赖 Lead 本轮新增的主 crate 命令 `write_temp_file(name, dataBase64) -> path`**。
 */
export async function localPathForAttach(f: AttachFile, name?: string): Promise<string> {
  if (f.path) return f.path;
  if (!isTauri) throw new Error("当前环境读不到文件内容：请在 OneTHU App 内操作。");
  const bytes = await fileToBytes(f); // 内部：File.arrayBuffer() 或主 crate read_file_base64(path)
  return invoke<string>("write_temp_file", { name: name ?? safeAttachName(f.name, f.mime), dataBase64: bytesToBase64(bytes) });
}

/**
 * 附件 → `File`（网络学堂提交 / 讨论区发帖的 multipart 需要真 File）。
 * 路径分支依赖主 crate `read_file_base64`（`lib/attach.ts:fileToBytes` 已封装该依赖）。
 */
export async function fileFromAttach(f: AttachFile): Promise<File> {
  if (f.file) return f.file;
  const bytes = await fileToBytes(f);
  return new File([bytes], safeAttachName(f.name, f.mime), { type: f.mime || "application/octet-stream" });
}

/* ══════════════════════ ① 转存云盘 ══════════════════════ */

export interface CloudSaveOptions {
  /** 目标资料库 id。**必填**：不传 → needUi 让用户选（绝不自动猜库） */
  repoId?: string;
  /** 目标目录（默认 "/"；不存在会逐级创建） */
  dir?: string;
  /** 同名覆盖（默认 true——附件重复转存不该堆出「x (1).pdf」） */
  replace?: boolean;
  /** 上传前确认（不传 = 不弹：调用方已经把库/目录/文件名摆在用户眼前） */
  confirm?: ConfirmFn;
}

/** 上次用过的云盘落点（面板预选用；**只是默认值，用户看得见也改得动**——库选的仍是用户自己挑的） */
const CLOUD_MEMO_KEY = "onethu.attach.cloud.v1";

export function rememberedCloudTarget(): { repoId: string; dir: string } | null {
  try {
    const raw = globalThis.localStorage?.getItem(CLOUD_MEMO_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { repoId?: unknown; dir?: unknown };
    const repoId = typeof j.repoId === "string" ? j.repoId.trim() : "";
    if (!repoId) return null;
    return { repoId, dir: typeof j.dir === "string" ? j.dir : "/" };
  } catch {
    return null;
  }
}

export function rememberCloudTarget(repoId: string, dir: string): void {
  try {
    globalThis.localStorage?.setItem(CLOUD_MEMO_KEY, JSON.stringify({ repoId, dir }));
  } catch {
    /* 存不下不影响上传 */
  }
}

/** 目录规范化：去重复斜杠、补/去尾斜杠，空 → "/" */
export function normalizeCloudDir(dir: string | undefined): string {
  const raw = (dir ?? "").trim().replace(/\/{2,}/g, "/");
  if (!raw || raw === "/") return "/";
  const lead = raw.startsWith("/") ? raw : `/${raw}`;
  return lead.replace(/\/+$/, "") || "/";
}

interface CloudTarget {
  token: string;
  repo: SeafileRepo;
  dir: string;
}

/** 前置解析（云盘 token + 资料库 + 目录）。失败返回结果对象（不抛）。 */
async function resolveCloudTarget(opts: CloudSaveOptions): Promise<CloudTarget | AttachActionResult> {
  await ensureSeafileLoaded();
  const token = getSeafileToken();
  if (!token) {
    return needUi("云盘还没连接：先到「云盘」页连上清华云盘，再回来转存。", {
      route: "cloud",
      message: "去云盘页连接清华云盘",
    });
  }
  const repoId = (opts.repoId ?? "").trim();
  if (!repoId) {
    return needUi("还没选云盘资料库——请在面板里选一个（不替你猜库，历史上猜错过）。", {
      route: "cloud",
      message: "去云盘页选一个资料库",
    });
  }
  const repos = await invoke<SeafileRepo[]>("seafile_repos", { token });
  const repo = repos.find((r) => r.id === repoId);
  if (!repo) {
    return needUi("这个资料库不在当前账号里（可能已被删除或改名）——请重新选一个。", {
      route: "cloud",
      message: "去云盘页重新选资料库",
    });
  }
  return { token, repo, dir: normalizeCloudDir(opts.dir) };
}

/** mkdir -p（逐级；已存在的报错忽略——上传结果才是真结果，与 memory/sync.ts 同款） */
async function ensureCloudDirs(token: string, repoId: string, dir: string): Promise<void> {
  let cur = "";
  for (const seg of dir.split("/").filter(Boolean)) {
    cur += `/${seg}`;
    try {
      await invoke("seafile_mkdir", { token, repoId, path: cur });
    } catch {
      /* 已存在 / 权限等由上传给出真实结论 */
    }
  }
}

async function uploadOneToCloud(
  t: CloudTarget,
  f: AttachFile,
  name: string,
  replace: boolean,
): Promise<{ path: string; size: number }> {
  const localPath = await localPathForAttach(f, name);
  await ensureCloudDirs(t.token, t.repo.id, t.dir);
  const size = await invoke<number>("seafile_upload", {
    token: t.token,
    repoId: t.repo.id,
    parentDir: t.dir,
    localPath,
    replace,
  });
  // 云盘页/面板即时看到新文件（best-effort：刷新失败不影响上传已成功的事实）
  void refreshDir(t.repo.id, t.dir).catch(() => undefined);
  const remote = `${t.dir === "/" ? "" : t.dir}/${name}`;
  void logLine(`[附件] 转存云盘：库《${t.repo.name}》${remote}（${typeof size === "number" ? size : 0} 字节）`).catch(
    () => undefined,
  );
  return { path: remote, size: typeof size === "number" ? size : 0 };
}

/** 单个附件 → 云盘。headless、无 UI 副作用；库/目录必须由调用方给定。 */
export async function saveToCloud(f: AttachFile, opts: CloudSaveOptions = {}): Promise<AttachActionResult> {
  try {
    const name = safeAttachName(f.name, f.mime);
    const target = await resolveCloudTarget(opts);
    if ("ok" in target) return target;
    if (opts.confirm) {
      const go = await opts.confirm(
        `【转存云盘】\n资料库：${target.repo.name}\n目录：${target.dir}\n文件：${name}（${formatSize(f.size)}）\n\n`
          + "点「确定」= 上传到你的清华云盘；同名文件会被覆盖。",
      );
      if (!go) return fail("已取消（没有上传）");
    }
    const up = await uploadOneToCloud(target, f, name, opts.replace !== false);
    rememberCloudTarget(target.repo.id, target.dir); // 记住这次落点，下次面板预选（用户看得见）
    return { ok: true, path: up.path, size: up.size, repoId: target.repo.id, repoName: target.repo.name };
  } catch (e) {
    return fail(explainNetworkError(e));
  }
}

export interface CloudSaveAllResult extends AttachActionResult {
  uploaded: string[];
  failed: Array<{ name: string; error: string }>;
}

/**
 * 多个附件 → 云盘（同一库/目录，一次确认）。
 * 逐个上传：**中途失败不回滚已传的**，结果里逐条列出成功路径与失败原因（诚实报账）。
 */
export async function saveAllToCloud(
  files: AttachFile[],
  opts: CloudSaveOptions = {},
): Promise<CloudSaveAllResult> {
  const uploaded: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];
  if (files.length === 0) return { ok: false, error: "没有附件可上传", uploaded, failed };
  let target: CloudTarget;
  try {
    const t = await resolveCloudTarget(opts);
    if ("ok" in t) return { ...t, uploaded, failed };
    target = t;
  } catch (e) {
    return { ok: false, error: explainNetworkError(e), uploaded, failed };
  }
  const names = files.map((f) => safeAttachName(f.name, f.mime));
  if (opts.confirm) {
    const head = names.slice(0, 5).map((n, i) => `　${i + 1}. ${n}`).join("\n");
    const more = names.length > 5 ? `\n　…等共 ${names.length} 个` : "";
    const go = await opts.confirm(
      `【转存云盘】\n资料库：${target.repo.name}\n目录：${target.dir}\n文件：\n${head}${more}\n\n`
        + "点「确定」= 逐个上传到你的清华云盘；同名文件会被覆盖。",
    );
    if (!go) return { ok: false, error: "已取消（没有上传）", uploaded, failed };
  }
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!f) continue;
    const name = names[i] ?? safeAttachName(f.name, f.mime);
    try {
      const up = await uploadOneToCloud(target, f, name, opts.replace !== false);
      uploaded.push(up.path);
    } catch (e) {
      failed.push({ name, error: explainNetworkError(e) });
    }
  }
  rememberCloudTarget(target.repo.id, target.dir);
  if (failed.length === 0) {
    return { ok: true, path: uploaded[0], uploaded, failed, repoId: target.repo.id, repoName: target.repo.name };
  }
  return {
    ok: uploaded.length > 0,
    error: `有 ${failed.length} 个文件没传上去：${failed.map((x) => `${x.name}（${x.error}）`).join("；")}`,
    uploaded,
    failed,
    repoId: target.repo.id,
    repoName: target.repo.name,
  };
}

/* ══════════════════════ ② 交作业 ══════════════════════ */

export interface HomeworkSubmitContext {
  platform: "learn" | "ykt";
  /** 网络学堂：课程 id（wlkcid） */
  courseId?: string;
  /** 网络学堂：作业 id = `Homework.id`（学生侧 xszyid）；雨课堂：leafTypeId */
  assignmentId?: string;
  /** 雨课堂：classroom_id */
  classroomId?: string;
  /** 雨课堂：题目 id（本轮用不到——见 ykt 分支；留给将来接内联插图通道） */
  problemId?: string;
  /** 雨课堂：官方作业直链（兜底打开官方作答页要用） */
  externalUrl?: string;
  /** 作业标题（只进确认文案与提示，不影响请求） */
  title?: string;
  /** 课程名（只进文案） */
  courseName?: string;
  /** 网络学堂：正文 zynr。⚠️ 提交是**整体覆盖**：留空 = 把该作业此前提交的正文清空。 */
  content?: string;
  /** 确认钩子（默认 `confirmOk`）。**作业写入必须确认**，调用方可以换成面板内联确认。 */
  confirm?: ConfirmFn;
}

function clip(s: string, n: number): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** 网络学堂：详情页表单判定 → 用户确认 → headless 提交（submitHomework） */
async function submitToLearn(f: AttachFile, ctx: HomeworkSubmitContext): Promise<AttachActionResult> {
  const courseId = (ctx.courseId ?? "").trim();
  const assignmentId = (ctx.assignmentId ?? "").trim();
  if (!courseId || !assignmentId) {
    return needUi("还没选课程和作业——交作业要明确交到哪一份，请先在面板里选。", {
      route: "learn-assignments",
      message: "去「全部作业」里选一份作业",
    });
  }
  const detailRoute: AttachActionUi = {
    route: "learn-assignment-detail",
    params: { courseId, itemId: assignmentId },
    message: "去这份作业的详情页看一眼",
  };
  // 服务端事实优先：详情页没有提交表单就不发请求（OJ-only / 已过期的作业都被这一枪拦下，
  // 判定细则见 packages/core/src/learn/client.ts:1016-1024）
  const page = await learn.getHomeworkPageDetail(courseId, assignmentId);
  if (!page.hasSubmitForm) {
    return fail(
      "这份作业的详情页里没有提交表单（可能只需在 OJ 提交、已过提交期，或老师没开在线提交）——请到作业页确认。",
      { ui: detailRoute },
    );
  }
  const name = safeAttachName(f.name, f.mime);
  const title = ctx.title?.trim() || assignmentId;
  const content = ctx.content ?? "";
  // 提交是整体覆盖：此前有正文、本次留空 → 明确警告（别让用户以为「只加了个附件」）
  const prevText = (page.submittedContent ?? "").replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/g, " ").trim();
  const wipeWarn = prevText && !content.trim() ? `\n⚠️ 这份作业此前提交里有正文，本次留空会把它清空。` : "";
  const go = await (ctx.confirm ?? confirmOk)(
    `【交作业 · 网络学堂】\n课程：${ctx.courseName?.trim() || courseId}\n作业：${title}\n`
      + `提交附件：${name}（${formatSize(f.size)}）\n正文：${clip(content, 60) || "（空）"}${wipeWarn}\n\n`
      + "点「确定」= 立刻提交，会覆盖这份作业此前的提交（正文与附件以本次为准）。",
  );
  if (!go) return fail("已取消（没有提交任何内容）");

  const file = await fileFromAttach(f);
  const r = await learn.submitHomework(assignmentId, { content, file, remove: false });
  if (!r.ok) {
    const why = r.msg ?? "";
    // 服务端权威判定「必须带附件」：记下来（本页面包已带附件还能被拒，说明是别的限制）
    if (/请上传附件/.test(why)) markNeedFile(assignmentId);
    return fail(why || "提交未成功，请稍后重试", { ui: detailRoute });
  }
  clearNeedFile(assignmentId);
  // 提交后让作业列表/详情看到真实状态（清缓存 + 静默重拉；失败不影响「已提交」这个事实）
  invalidateLearnCache();
  void refreshLearnDataSilently().catch(() => undefined);
  void logLine(`[附件] 网络学堂提交成功：课程 ${courseId} 作业 ${assignmentId} 附件 ${name}`).catch(() => undefined);
  return { ok: true };
}

/**
 * 雨课堂：**本轮不自动提交**，返回 needUi + 官方作答页兜底。
 *
 * 为什么不做：
 *  - `submitYktSubjective` 的 `attachments` 只有 `{fileID, fileName, fileSize, fileType, fileUrl}`——
 *    需要先把文件换成雨课堂 OSS 的 fileUrl，而**附件上传通道全库无实现**（只有正文内联插图
 *    `uploadYktInlineImage`）；硬塞本地路径进 fileUrl 是造假数据，不做。
 *  - 官方接口的语义是「逐题作答覆盖」（`problem_apply`），把一份附件盲提交到某一题会覆盖用户
 *    已有的作答——这需要用户在页面上明确选题目，不是附件面板能替他决定的。
 *  - `state/exthw.ts:846` 的学术红线：提交函数不得被自动化路径触发。本轮把「谁来提交」交回官方页。
 *
 * 兜底路径（两条，都是用户自己点、自己提交）：
 *  ① 应用内雨课堂官方作答页（`lib/yktSubmitWebview.openYktSubmitWebview`，带当前会话 Cookie）；
 *  ② 应用内雨课堂作业原生页（route=learn-ykt-detail），在页内再走 ①。
 * 将来若要真做「附件直交」，正确入口是正文内联插图通道 + 用户在详情页选定题目（需另立任务）。
 */
function yktSubmitNeedsUi(f: AttachFile, ctx: HomeworkSubmitContext): AttachActionResult {
  const classroomId = (ctx.classroomId ?? "").trim();
  const leafTypeId = (ctx.assignmentId ?? "").trim();
  const url = (ctx.externalUrl ?? "").trim();
  const yktParams: LearnNav["ykt"] = {
    leafTypeId,
    classroomId,
    ...(url ? { externalUrl: url } : {}),
    ...(ctx.title?.trim() ? { title: ctx.title.trim() } : {}),
    ...(ctx.courseName?.trim() ? { courseName: ctx.courseName.trim() } : {}),
    kind: "homework",
  };
  const why =
    "雨课堂没有可用的附件提交通道（官方接口只收已上传的附件条目，本仓库未接附件上传）——"
    + `「${safeAttachName(f.name, f.mime)}」需要在雨课堂官方作答页里随作答一起提交。`;
  if (!classroomId || !leafTypeId) {
    return needUi(`${why}\n另外：这份作业的雨课堂参数不全，请从作业列表重新进入。`, {
      route: "learn-assignments",
      message: "去「全部作业」里选这份雨课堂作业",
    });
  }
  return needUi(why, {
    route: "learn-ykt-detail",
    params: { ykt: yktParams },
    ...(url ? { officialUrl: url, officialChannel: "ykt-submit-webview" as const } : {}),
    message: "打开雨课堂官方作答页，把附件随作答一起提交",
  });
}

/**
 * 交作业（网络学堂 / 雨课堂）。
 *  - learn：headless 走 `learn.submitHomework`（先确认；详见文件头实测状态）；
 *  - ykt：返回 `{ok:false, needUi:true}` + 官方页兜底（有意不自动提交）。
 * 任何情况下**都不会**在没有用户确认时发出写入请求。
 */
export async function submitHomework(f: AttachFile, ctx: HomeworkSubmitContext): Promise<AttachActionResult> {
  try {
    if (!f) return fail("没有附件可提交");
    if (ctx.platform === "ykt") return yktSubmitNeedsUi(f, ctx);
    return await submitToLearn(f, ctx);
  } catch (e) {
    return fail(explainNetworkError(e));
  }
}

/* ══════════════════════ ③ 发讨论区 ══════════════════════ */

export interface DiscussionContext {
  /** 网络学堂课程 id（wlkcid）——发帖/回复都必须有（讨论区挂在课程下） */
  courseId?: string;
  /** 板块 id（bqid）：发**新话题**必填；回复不需要 */
  boardId?: string;
  /** 已有话题 id（tltid）：给了 = 回复该话题；不给 = 发新话题 */
  threadId?: string;
  /** 楼中楼父回复 id（fhhid） */
  replyToId?: string;
  /** 新话题标题（发新话题必填） */
  title?: string;
  /** 正文（纯文本，内部转站点富文本 HTML；见 `textToBbsHtml`） */
  body: string;
  /** 已经是 HTML 的正文（给了就原样用，转义责任归调用方） */
  bodyHtml?: string;
  /** 以下两个只进确认文案 */
  courseName?: string;
  boardName?: string;
  confirm?: ConfirmFn;
}

/** 纯文本 → 讨论区富文本（CKEditor 同源口径：段落 <p>、段内换行 <br/>；**先转义**再包装） */
export function textToBbsHtml(text: string): string {
  const esc = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return (text ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

/**
 * 从用户粘贴的东西里取出话题 id（tltid）：
 * 纯数字原样返回；站点链接（`viewTlById?...&tltid=123&...`）取 `tltid=` 参数。
 * 认不出来返回空串（调用方据此提示，绝不瞎填一个 id 去发帖）。
 */
export function parseBbsThreadId(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  if (/^\d+$/.test(s)) return s;
  const m = /[?&]tltid=([0-9A-Za-z_-]+)/.exec(s);
  return m?.[1] ?? "";
}

/**
 * 发讨论区：`f = null` 可只发正文；给了附件则随帖上传（站点表单只有一个 fileupload 字段 → 只取附件本身，
 * 多附件请调用方分批调用；面板已限制为第一个）。
 * 回复走 `postBbsReply`（页面已实测），新话题走 `postBbsThread`（core 自述 schema 未真机采样 → 未实测）。
 * 两条路径都必须先确认（公开发布，全班可见）。
 */
export async function postDiscussion(f: AttachFile | null, ctx: DiscussionContext): Promise<AttachActionResult> {
  try {
    const courseId = (ctx.courseId ?? "").trim();
    if (!courseId) {
      return needUi("还没选课程——讨论区挂在课程下，请先选课程。", {
        route: "learn",
        message: "去网络学堂选一门课",
      });
    }
    const threadId = parseBbsThreadId(ctx.threadId ?? "");
    const rawThread = (ctx.threadId ?? "").trim();
    if (rawThread && !threadId) {
      return fail("话题 id 没认出来：请填话题页地址里的 tltid（纯数字），或直接粘贴话题链接。");
    }
    const boardId = (ctx.boardId ?? "").trim();
    const title = (ctx.title ?? "").trim();
    const html = (ctx.bodyHtml ?? "").trim() || textToBbsHtml(ctx.body);
    const plain = html.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/g, " ").trim();
    if (!plain && !f) return fail("正文是空的，也没有附件——没什么可发的");
    if (!threadId && !boardId) {
      return needUi("发新话题要先选板块（每个板块的可见范围不同，不能替你猜）。", {
        route: "learn-forum-thread",
        params: { courseId },
        message: "去课程的讨论区选一个板块",
      });
    }
    if (!threadId && !title) return fail("发新话题要写标题");
    const file = f ? await fileFromAttach(f) : null;
    const attachNote = f ? `${safeAttachName(f.name, f.mime)}（${formatSize(f.size)}）` : "无";
    const head = threadId
      ? `【回复讨论区 · 网络学堂】\n课程：${ctx.courseName?.trim() || courseId}\n话题 id：${threadId}`
      : `【发新话题 · 网络学堂】\n课程：${ctx.courseName?.trim() || courseId}\n`
        + `板块：${ctx.boardName?.trim() || boardId}\n标题：${title}`;
    const go = await (ctx.confirm ?? confirmOk)(
      `${head}\n正文：${clip(plain, 80) || "（无文字）"}\n附件：${attachNote}\n\n点「确定」= 立刻发布（全班可见，撤不回来）。`,
    );
    if (!go) return fail("已取消（没有发布）");

    if (threadId) {
      await learn.postBbsReply(courseId, threadId, html, ctx.replyToId?.trim() || undefined, file);
    } else {
      await learn.postBbsThread(courseId, { bqid: boardId, title, html, file });
    }
    void logLine(`[附件] 讨论区${threadId ? "回复" : "新话题"}已提交：课程 ${courseId} 附件 ${attachNote}`).catch(
      () => undefined,
    );
    return { ok: true };
  } catch (e) {
    return fail(explainNetworkError(e));
  }
}
