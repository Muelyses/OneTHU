/**
 * 暂存箱对象类型注册表（Phase 1.5）：kind → 打开方式/展示口径。
 *
 * 来源组件只负责给出 `data-vault-catch`（或调用 addToVault），不要各自实现「点开这个对象」；
 * 打开、失效提示、以后要接入的云盘/文件预览都从这里走。
 */
import type { VaultItem } from "./vault.js";
import { resolveAtom } from "./atoms.js";
import { addContact } from "./nameCard.js";

export interface VaultOpenEnv {
  navigate: (page: string, params?: Record<string, unknown>) => void;
  openBoard?: (boardId: string) => void;
  toast: (msg: string) => void;
}

/** 打开暂存箱条目；返回 false 表示该类型还没有打开方式（由 UI 给出说明）。 */
export function openVaultItem(it: VaultItem, env: VaultOpenEnv): boolean {
  if (it.atom) {
    const view = resolveAtom(it.atom);
    if (!view) {
      env.toast("这个对象已失效（可能没有权限或已被删除），可移除后重新收录");
      return true;
    }
    view.open((page, params) => env.navigate(String(page), params as Record<string, unknown> | undefined));
    return true;
  }
  if (it.board && env.openBoard) {
    env.openBoard(it.board.boardId);
    return true;
  }
  if (it.text) {
    env.toast(it.text.length > 90 ? it.text.slice(0, 90) + "…" : it.text);
    return true;
  }
  if (it.type === "file") {
    env.toast("文件预览/下载随统一文件通道接入；当前先保留引用");
    return true;
  }
  if (it.type === "payload") {
    const p = it.payload as { kind?: string; card?: Record<string, unknown>; org?: boolean } | undefined;
    if (p?.kind === "quick-entry") {
      void import("./quickAccess.js").then(m=>m.openQuickEntry((it.payload as {entry:import("./quickAccess.js").QuickEntry}).entry));
      return true;
    }
    if (p?.kind === "namecard" && p.card) {
      const r = addContact(p.org ? "organization" : "personal", p.card as never, it.sub ?? "");
      if (r.ok) env.toast("名片已加入通讯录");
      else env.toast(r.reason === "duplicate" ? "通讯录里已经有这张名片了" : "这是你自己的名片，已在「我的名片」里");
      return true;
    }
    const pmeta = it.payload as { routeId?: string; settingTitle?: string; kind?: string; themeId?: string; ref?: string; pluginId?: string } | undefined;
    if (pmeta?.kind === "plugin") {
      env.navigate("plugins");
      env.toast("已打开插件页；插件引用保留在暂存箱");
      return true;
    }
    if (pmeta?.kind === "theme") {
      void (async () => {
        const m = await import("./theme.js");
        if (pmeta.themeId) m.activateTheme(pmeta.themeId);
        else m.deactivateTheme();
      })();
      env.toast("主题已应用");
      return true;
    }
    if (pmeta?.kind === "wallpaper" && pmeta.ref) {
      void (async () => {
        const m = await import("./wallpaper.js");
        m.setGlobalWallpaper(pmeta.ref ?? null);
      })();
      env.toast("壁纸已应用");
      return true;
    }
    const routeId = pmeta?.routeId ?? pmeta?.settingTitle;
    if (routeId) {
      void (async () => {
        const { allSearchRows, goSearchRow } = await import("./searchRows.js");
        const row = allSearchRows().find((r) => r.id === routeId || r.title === routeId);
        if (row) goSearchRow(row);
        else env.toast("这条设置项在当前版本里找不到了");
      })();
      return true;
    }
  }
  env.toast("这个对象暂不支持直接打开；可以先留在暂存箱里");
  return false;
}
