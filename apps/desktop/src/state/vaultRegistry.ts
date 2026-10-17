/**
 * 暂存箱对象类型注册表（Phase 1.5）：kind → 打开方式/展示口径。
 *
 * 来源组件只负责给出 `data-vault-catch`（或调用 addToVault），不要各自实现「点开这个对象」；
 * 打开、失效提示、以后要接入的云盘/文件预览都从这里走。
 */
import type { VaultItem } from "./vault.js";
import { resolveAtom } from "./atoms.js";

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
    const routeId = (it.payload as { routeId?: string } | undefined)?.routeId;
    if (routeId) {
      void (async () => {
        const { allSearchRows, goSearchRow } = await import("./searchRows.js");
        const row = allSearchRows().find((r) => r.id === routeId);
        if (row) goSearchRow(row);
        else env.toast("这条设置项在当前版本里找不到了");
      })();
      return true;
    }
  }
  env.toast("这个对象暂不支持直接打开；可以先留在暂存箱里");
  return false;
}
