/** 插件加载器：blob 动态 import + 权限门面注入 + 生命周期（安装/启用/停用/删除） */
import { buildApi } from "./facade.js";
import { installTheme, type ThemeDef } from "../state/theme.js";
import { bindRustApi, callRust, disposeRust, spawnRustPlugin, startHarnessEmbedded } from "./rust.js";
import { preflightMadModel, startMadModelPump } from "../state/madmodel.js";
import { forceRemint } from "../state/madmodel.js";
import { addPlugin, addRustPlugin, getPlugin, removePlugin, snapshot, subscribe, updatePlugin } from "./registry.js";
import { logLine } from "../lib/clients.js";
import type { OnethuApi, PluginCommand, PluginContext, PluginManifest, PluginRecord } from "./types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface LivePlugin {
  id: string;
  kind: "js" | "rust";
  mod: any;
  blobUrl: string;
  dispose?: () => void;
}

/** 命令注册表（管理页渲染 + 执行）；id 全局唯一：pluginId:cmdId */
interface LiveCommand extends PluginCommand {
  pluginId: string;
  run: (input: string) => Promise<unknown> | unknown;
}
const liveCommands = new Map<string, LiveCommand>();
const cmdListeners = new Set<() => void>();
/** 缓存快照：变更时重建（getSnapshot 稳定性） */
let cmdCache: LiveCommand[] = [];
function notifyCmds(): void {
  cmdCache = [...liveCommands.values()];
  for (const l of cmdListeners) l();
}
export function subscribeCommands(fn: () => void): () => void {
  cmdListeners.add(fn);
  return () => cmdListeners.delete(fn);
}
export function commandsSnapshot(): LiveCommand[] {
  return cmdCache;
}

const live = new Map<string, LivePlugin>();

/** 校验模块形状：须导出 manifest{...} 与 default(ctx) */
function validateManifest(m: unknown): m is PluginManifest {
  if (!m || typeof m !== "object") return false;
  const v = m as Partial<PluginManifest>;
  return typeof v.id === "string" && v.id.length > 0
    && /^[a-z0-9][a-z0-9.-]*$/i.test(v.id)
    && typeof v.name === "string" && v.name.length > 0
    && typeof v.version === "string"
    && Array.isArray(v.permissions);
}

/** 安装（或更新）插件：校验 → 落库 → 立即激活 */
export async function installPlugin(
  code: string,
  meta?: { repo?: string },
): Promise<PluginManifest> {
  const blobUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  let mod: any;
  try {
    mod = await import(/* @vite-ignore */ blobUrl);
  } catch (e) {
    URL.revokeObjectURL(blobUrl);
    throw new Error(`插件模块加载失败：${String(e).slice(0, 160)}`);
  }
  if (!validateManifest(mod.manifest)) {
    URL.revokeObjectURL(blobUrl);
    throw new Error("插件清单非法：须导出 manifest { id, name, version, permissions[] }");
  }
  const isTheme = mod.manifest?.category === "theme";
  if (typeof mod.default !== "function" && !(isTheme && mod.theme && typeof mod.theme === "object")) {
    URL.revokeObjectURL(blobUrl);
    throw new Error(isTheme
      ? "主题插件须导出 theme: ThemeDef（或另加 default(ctx) 提供命令）"
      : "插件须导出 default(ctx) 激活函数");
  }
  const manifest = mod.manifest as PluginManifest;
  const prev = getPlugin(manifest.id);
  await deactivate(manifest.id).catch(() => undefined);
  addPlugin({
    manifest,
    code,
    enabled: true,
    settings: prev?.settings ?? defaultsOf(manifest),
    installedAt: Date.now(),
    repo: meta?.repo ?? manifest.repo,
  });
  await activate(manifest.id, mod, blobUrl);
  await logLine(`[PLUGIN] 安装并激活 ${manifest.id}@${manifest.version}（${manifest.name}）`);
  return manifest;
}

function defaultsOf(m: PluginManifest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of m.settings ?? []) if (f.default != null) out[f.key] = f.default;
  return out;
}

async function activate(id: string, mod?: any, blobUrl?: string): Promise<void> {
  const rec = getPlugin(id);
  if (!rec) throw new Error(`插件不存在：${id}`);
  let m = mod;
  let url = blobUrl;
  if (!m) {
    url = URL.createObjectURL(new Blob([rec.code], { type: "text/javascript" }));
    m = await import(/* @vite-ignore */ url);
  }
  const perms = new Set<string>(rec.manifest.permissions);
  if (rec.manifest.kind === "rust") {
    bindRustApi(id, perms);
    // 双形态：embedded=App 内嵌核心（Android 内置）；否则 sidecar 二进制（桌面）
    let hand: unknown;
    if (rec.embedded) {
      hand = await startHarnessEmbedded(id);
    } else {
      if (!rec.binPath) throw new Error("rust 插件缺少二进制路径");
      hand = await spawnRustPlugin(id, rec.binPath);
    }
    live.set(id, { id, kind: "rust", mod: null, blobUrl: "" });
    // 约定：activate 应答 { commands: [{id,title,inputLabel?,inputPlaceholder?}] }
    const cmds = (hand as any)?.commands;
    if (Array.isArray(cmds)) {
      for (const c of cmds) {
        if (c?.id && c?.title) {
          liveCommands.set(`${id}:${c.id}`, {
            id: c.id, title: String(c.title), inputLabel: c.inputLabel, inputPlaceholder: c.inputPlaceholder,
            dock: Boolean(c.dock),
            pluginId: id,
            run: async (input: string) => {
              // MadModel 免费档对话前兜底：token 到期即续 + 可达性探针（10 分钟缓存）——
              // 校外时把 reachable=0 写进 settings，Rust config 自动回退自费或出提醒文案
              if (id === "onethu.harness") {
                await preflightMadModel().catch(() => undefined);
              }
              const out = await callRust(id, "run", { command: c.id, input });
              // 漏判兜底：免费档请求仍被 IP 门禁弹掉（307）→ 强制重签 + 刷新可达性
              const errMsg = String((out as { error?: string })?.error ?? "");
              if (id === "onethu.harness" && errMsg.includes("307")) {
                void forceRemint();
              }
              return out;
            },
          });
        }
      }
      notifyCmds();
    }
    return;
  }
  const api: OnethuApi = buildApi(id, perms);
  const ctx: PluginContext = {
    onethu: api,
    registerCommand: (cmd, run) => {
      if (!cmd?.id || typeof run !== "function") return;
      liveCommands.set(`${id}:${cmd.id}`, { ...cmd, pluginId: id, run });
      notifyCmds();
    },
    log: (line: string) => void logLine(`[PLUGIN:${id}] ${line}`),
  };
  // 主题插件：注册主题定义（无 default 时不再调用激活函数）
  if (rec.manifest.category === "theme" && m.theme && typeof m.theme === "object") {
    installTheme(m.theme as ThemeDef, "plugin");
    logLine(`[PLUGIN] 主题已注册 ${(m.theme as ThemeDef).id}（来自插件 ${id}）`);
  }
  if (rec.manifest.category === "theme" && typeof m.default !== "function") {
    live.set(id, { id, kind: "js", mod: m, blobUrl: url ?? "", dispose: undefined });
    return;
  }
  const maybeDispose = await m.default(ctx);
  live.set(id, { id, kind: "js", mod: m, blobUrl: url ?? "", dispose: typeof maybeDispose?.dispose === "function" ? maybeDispose.dispose : undefined });
}

async function deactivate(id: string): Promise<void> {
  const p = live.get(id);
  if (!p) return;
  if (p.kind === "rust") {
    await disposeRust(id).catch(() => undefined);
    for (const k of [...liveCommands.keys()]) if (k.startsWith(`${id}:`)) liveCommands.delete(k);
    notifyCmds();
    live.delete(id);
    return;
  }
  try {
    p.dispose?.();
    p.mod?.dispose?.();
  } catch (e) {
    await logLine(`[PLUGIN] ${id} dispose 异常：${String(e).slice(0, 120)}`);
  }
  for (const k of [...liveCommands.keys()]) if (k.startsWith(`${id}:`)) liveCommands.delete(k);
  for (const l of cmdListeners) l();
  if (p.blobUrl) URL.revokeObjectURL(p.blobUrl);
  live.delete(id);
}

/* ═══ 管理动作（UI 调用） ═══ */
export async function enablePlugin(id: string): Promise<void> {
  updatePlugin(id, { enabled: true });
  try {
    await activate(id);
  } catch (e) {
    updatePlugin(id, { enabled: false });
    throw e;
  }
}
export async function disablePlugin(id: string): Promise<void> {
  updatePlugin(id, { enabled: false });
  await deactivate(id).catch(() => undefined);
}
export async function uninstallPlugin(id: string): Promise<void> {
  await deactivate(id).catch(() => undefined);
  removePlugin(id);
  // 插件目录一并清理（内置插件在 UI 层不可删，不会走到这里）
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("plugin_dir_remove", { id }).catch(() => undefined);
  }
}
export async function runCommand(pluginId: string, cmdId: string, input: string): Promise<unknown> {
  const rec = getPlugin(pluginId);
  if (rec?.manifest.kind === "rust") {
    const out = await callRust(pluginId, "run", { command: cmdId, input });
    return out;
  }
  const c = liveCommands.get(`${pluginId}:${cmdId}`);
  if (!c) throw new Error(`命令未注册或插件未启用：${pluginId}:${cmdId}`);
  return c.run(input);
}
export function isLive(id: string): boolean {
  return live.has(id);
}

/** 应用启动时恢复：激活全部 enabled 插件（失败逐个记日志，不阻塞启动） */
export async function activateInstalledPlugins(): Promise<void> {
  for (const rec of snapshot()) {
    if (!rec.enabled) continue;
    try {
      await activate(rec.manifest.id);
      await logLine(`[PLUGIN] 恢复激活 ${rec.manifest.id}`);
    } catch (e) {
      await logLine(`[PLUGIN] 恢复失败 ${rec.manifest.id}：${String(e).slice(0, 140)}`);
    }
  }
}

/* registry 订阅转发（UI 单一来源） */
export { subscribe, snapshot as installedPlugins };


/* ═══ Android 内置：Harness 核心编进 App（src-tauri harness_embed），开机种入 ═══ */
const EMBEDDED_HARNESS_MANIFEST: PluginManifest = {
  id: "onethu.harness",
  kind: "rust",
  name: "OneTHU Harness",
  version: "0.1.1",
  author: "smartThise",
  description: "大模型驱动的清华校园助手（Rust 骨干·内嵌核心）：对话式查课表/日程/成绩/新闻/空教室/校园卡/电费/校园网，日程云同步（查/建/改/删），图书馆座位与研讨间查询预约（两段式确认），左下角常驻对话面板，实时进度与打断，多会话历史与上下文导出，token 用量与预算控制。",
  permissions: [
    "user:read", "info:read", "card:read", "dorm:read",
    "library:read", "library:book", "network:read",
    "learn:read", "learn:write", "venue:read", "venue:book", "xk:read", "kongjian:book",
    "cal:read", "cal:write", "mail:read", "mail:write", "cloud:read", "cloud:write",
    "nav", "ui", "storage", "net:external", "llm",
  ],
  settings: [
    { key: "provider", label: "模型源", type: "select", default: "", options: [
      { value: "madmodel", label: "清华 MadModel 免费（DeepSeek-V4-Flash · 校园网/VPN · 自动续期）" },
      { value: "custom", label: "自费 API（下方 Key/Endpoint/Model 生效）" },
      { value: "", label: "默认（自动：填了 Key 走自费，没填走 MadModel）" },
    ] },
    { key: "apiKey", label: "API Key（自费模式用）", type: "password", placeholder: "sk-…" },
    { key: "baseUrl", label: "API Endpoint（OpenAI 兼容，/v1 结尾）", type: "text", default: "https://api.deepseek.com/v1" },
    { key: "model", label: "模型（自费模式用；免费档固定 DeepSeek-V4-Flash）", type: "text", default: "deepseek-chat" },
    { key: "thinking", label: "思考模式（DeepSeek 自动切 reasoner）", type: "text", default: "off" },
    { key: "maxContext", label: "上下文预算（tokens，超出裁剪）", type: "text", default: "24000" },
    { key: "stream", label: "流式输出（off 回退非流式）", type: "text", default: "on" },
    { key: "priceIn", label: "输入价格 $/1M tokens（自费模式）", type: "text", default: "0.27" },
    { key: "priceOut", label: "输出价格 $/1M tokens（自费模式）", type: "text", default: "1.10" },
    { key: "budget", label: "Token 预算（USD，到量停；自费模式）", type: "text", default: "2" },
    { key: "maxSteps", label: "单次任务最大步数", type: "text", default: "16" },
    { key: "madmodelToken", label: "MadModel Token（自动维护，勿手改）", type: "text", default: "" },
    { key: "madmodelAt", label: "MadModel 签发时刻（自动维护，勿手改）", type: "text", default: "" },
  ],
};

// MadModel 免费档续期泵：模块加载即启动（启动即试一枚 + 10 分钟巡检）
startMadModelPump();

/* Android 判定（2026-09-19 重写）：主 WebView UA 被 tauri.conf.json 硬编码成
 * Windows Chrome 79（wengine 指纹，Android 同样被覆盖）——UA 判定恒 false，
 * 内嵌种入/自愈分支在真机上从未执行。改用 Rust 编译期命令 os_is_android，
 * invoke 不可用时才退回 UA 兜底。结果缓存（平台一次定，无需反复问）。 */
let androidFlag: boolean | null = null;
async function isAndroid(): Promise<boolean> {
  if (androidFlag != null) return androidFlag;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    androidFlag = await invoke<boolean>("os_is_android");
  } catch {
    androidFlag = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
  }
  return androidFlag;
}

// 模块加载即种（先于 activateInstalledPlugins 的恢复激活）；管理页删除后下次开机自动回来。
// 桌面端同样内置：sidecar 二进制随 App 资源打包，开机复制进插件目录
// appData/plugins/onethu.harness/ 并注册（builtin，用户不可删——它就是 App 的一部分）。
// R10 架构：桌面所有插件（导入 + 内置）统一住在 appData/plugins/<id>/。
/* Android 内嵌种入/自愈移入 seedBuiltinHarness（isAndroid 现为异步编译期判定，
 * 模块顶层同步分支无法用；boot 序列 main.tsx 在激活前 await 它，时序不变） */

/** 桌面内置 OH：sidecar 从打包资源落进插件目录，注册/迁移注册表指向。
 *  在 activateInstalledPlugins 之前调用一次；无打包资源（开发未构建）则静默跳过。 */
export async function seedBuiltinHarness(): Promise<void> {
  if (await isAndroid()) {
    // 内嵌核心（编进 App 进程）：种入/自愈内置 manifest。APK 更新=内置清单可能变
    // （新设置字段/权限），老注册表不清则设置 sheet 永远看不到新字段。
    const prev = getPlugin("onethu.harness");
    if (!prev) {
      addRustPlugin(EMBEDDED_HARNESS_MANIFEST, "", true);
      await logLine("[PLUGIN] 内嵌 OH 已种入").catch(() => undefined);
    } else if (JSON.stringify(prev.manifest) !== JSON.stringify(EMBEDDED_HARNESS_MANIFEST)) {
      // 用户 settings 全程保留（历史实锤：removePlugin 会连 settings 一起清）
      const prevSettings = { ...prev.settings };
      removePlugin("onethu.harness");
      addRustPlugin(EMBEDDED_HARNESS_MANIFEST, "", true);
      if (Object.keys(prevSettings).length > 0) {
        updatePlugin("onethu.harness", { settings: prevSettings });
      }
      await logLine(`[PLUGIN] 内嵌 OH 清单已随 APK 刷新（settings 保留 ${Object.keys(prevSettings).length} 项）`).catch(() => undefined);
    }
    return;
  }
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const binPath = await invoke<string | null>("builtin_sidecar_install");
    if (!binPath) {
      await logLine("[PLUGIN] 内置 OH sidecar 资源缺失（先跑 build:harness），跳过种入");
      return;
    }
    const rec = getPlugin("onethu.harness");
    if (!rec) {
      addRustPlugin(EMBEDDED_HARNESS_MANIFEST, binPath);
      await logLine(`[PLUGIN] 内置 OH 已注册：${binPath}`);
    } else {
      // 权限快照自愈：装机清单缺新权限（如 learn:read/xk:read）时以内置清单为准并入，
      // 免「重装才能用新功能」（R10 实录：扩展权限后 dock 报未获授权）
      const perms = new Set(rec.manifest.permissions ?? []);
      let changed = false;
      for (const p of EMBEDDED_HARNESS_MANIFEST.permissions ?? []) {
        if (!perms.has(p)) { perms.add(p); changed = true; }
      }
      // settings 清单自愈同款（2026-09-19）：内置清单新增字段（如 MadModel 的
      // provider 下拉）时老注册表还是旧 manifest——设置 sheet 永远看不到新字段
      const settingsChanged =
        JSON.stringify(rec.manifest.settings ?? []) !== JSON.stringify(EMBEDDED_HARNESS_MANIFEST.settings ?? []);
      if (changed || settingsChanged || rec.binPath !== binPath) {
        // ⚠️ 重注册必须保住用户填的 settings（API Key/模型/预算…）——
        // removePlugin 会连 settings 一起清，历史实锤：每次扩展权限清单
        // （mail:read→cloud:read 两轮）用户都得重新粘贴 deepseek key
        const prevSettings = { ...rec.settings };
        removePlugin("onethu.harness");
        addRustPlugin(
          { ...EMBEDDED_HARNESS_MANIFEST, permissions: [...perms] },
          binPath,
        );
        if (Object.keys(prevSettings).length > 0) {
          updatePlugin("onethu.harness", { settings: prevSettings });
        }
        await logLine(`[PLUGIN] 内置 OH 已刷新（权限${settingsChanged ? "/设置清单" : ""}/路径迁移，settings 保留）：${binPath}`);
      }
    }
  } catch (e) {
    await logLine(`[PLUGIN] 内置 OH 种入失败：${String(e).slice(0, 140)}`);
  }
}
