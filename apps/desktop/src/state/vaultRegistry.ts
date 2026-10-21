import { t as i18n } from "../i18n/index.js";
/**
 * 暂存箱对象类型注册表（Phase 1.5）：kind → 打开方式/展示口径。
 *
 * 来源组件只负责给出 `data-vault-catch`（或调用 addToVault），不要各自实现「点开这个对象」；
 * 打开、失效提示、以后要接入的云盘/文件预览都从这里走。
 */
import { invoke } from "@tauri-apps/api/core";
import type { VaultItem } from "./vault.js";
import { resolveAtom } from "./atoms.js";
import { addContact } from "./nameCard.js";

export interface VaultOpenEnv {
  navigate: (page: string, params?: Record<string, unknown>) => void;
  openBoard?: (boardId: string) => void;
  toast: (msg: string) => void;
}

/** 发起打开/取用；false 表示未启动，异步内容的加载结果由其预览处理。 */
export function openVaultItem(it: VaultItem, env: VaultOpenEnv): boolean {
  if (it.atom) {
    const view = resolveAtom(it.atom);
    if (!view) {
      env.toast(i18n("state.vaultregistry.a56851062d27"));
      return false;
    }
    view.open((page, params) => env.navigate(String(page), params as Record<string, unknown> | undefined));
    return true;
  }
  if (it.board && env.openBoard) {
    env.openBoard(it.board.boardId);
    return true;
  }
  if (it.text) {
    void import("../components/vault/VaultTextPreview.js")
      .then(({ openVaultTextPreview }) => openVaultTextPreview(it.title, it.text!))
      .catch(() => env.toast(i18n("state.vaultregistry.18fb3a6dfa2c")));
    return true;
  }
  if (it.type === "file") {
    if (!it.file) { env.toast(i18n("state.vaultregistry.24ec304b41bb")); return false; }
    const file = it.file;
    const local = async (): Promise<string> => {
      if (file.stagedPath) return file.stagedPath;
      if (file.shareUrl && file.cloudPath) {
        const { materializeSharedFile } = await import("./vaultCloud.js");
        return materializeSharedFile({provider:"seafile",path:"",shareUrl:file.shareUrl,keyRepoId:file.shareKeyRepoId},file.cloudPath,file.name);
      }
      throw new Error(i18n("state.vaultregistry.191e4869147e"));
    };
    void import("../components/FilePreview.js").then(({openFilePreview}) => openFilePreview({
      name:file.name, url:"",
      fetchB64:async()=>{
        let b64:string;
        if(file.cloudRepoId&&file.cloudPath&&!file.shareUrl){
          const cloud=await import("./seafile.js");await cloud.ensureSeafileLoaded();
          b64=await invoke<string>("seafile_read_bytes",{token:cloud.getSeafileToken(),repoId:file.cloudRepoId,path:file.cloudPath,maxBytes:48*1024*1024});
        } else b64=await invoke<string>("read_file_base64",{path:await local(),maxBytes:48*1024*1024});
        return {b64,mime:file.mime||"application/octet-stream"};
      },
      download:async()=>{
        if(file.cloudRepoId&&file.cloudPath&&!file.shareUrl){const cloud=await import("./seafile.js");await cloud.ensureSeafileLoaded();return cloud.seafileDownload(file.cloudRepoId,file.cloudPath);}
        return invoke<string>("save_local_download",{path:await local(),name:file.name});
      },
    })).catch(error=>env.toast(error instanceof Error?error.message:String(error)));
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
      if (r.ok) env.toast(i18n("state.vaultregistry.c5d06fdd2936"));
      else env.toast(r.reason === "duplicate" ? i18n("state.vaultregistry.dcd9b29df966") : i18n("state.vaultregistry.75aa9163a82e"));
      return true;
    }
    const pmeta = it.payload as { routeId?: string; settingTitle?: string; kind?: string; themeId?: string; ref?: string; pluginId?: string } | undefined;
    if (pmeta?.kind === "plugin") {
      env.navigate("plugins");
      env.toast(i18n("state.vaultregistry.94220dc7197e"));
      return true;
    }
    if (pmeta?.kind === "theme") {
      void (async () => {
        const m = await import("./theme.js");
        if (pmeta.themeId) m.activateTheme(pmeta.themeId);
        else m.deactivateTheme();
      })();
      env.toast(i18n("state.vaultregistry.14947083ab6d"));
      return true;
    }
    if (pmeta?.kind === "wallpaper" && pmeta.ref) {
      void (async () => {
        const m = await import("./wallpaper.js");
        m.setGlobalWallpaper(pmeta.ref ?? null);
      })();
      env.toast(i18n("state.vaultregistry.666f4160f861"));
      return true;
    }
    /* ── 长按拖入的页面对象（日程/云盘/课程/新闻/GitLab/标签页/工作区）── */
    const pageMeta = it.payload as {
      kind?: string; repoId?: string; path?: string; date?: string; courseId?: string; itemId?: string;
      url?: string; projectId?: number; page?: string; params?: Record<string, unknown> | null; workspaceId?: string;
    } | undefined;
    const kind = pageMeta?.kind;
    if (kind === "schedule") {
      void import("../lib/vaultRemote.js").then((m) => m.offerScheduleToCalendar(pageMeta as { title?: string; date?: string; startMs?: number; endMs?: number; location?: string; note?: string }));
      return true;
    }
    if (kind === "cloud-file" || kind === "cloud-folder") {
      env.navigate("cloud", pageMeta?.repoId ? { cloudRepo: pageMeta.repoId } : undefined);
      env.toast(i18n("state.vaultregistry.fe7d0003cf59"));
      return true;
    }
    if (kind === "learn-notice") {
      env.navigate("learn-notice-detail", { courseId: pageMeta?.courseId, itemId: pageMeta?.itemId, from: "learn-notices" });
      return true;
    }
    if (kind === "learn-attachment" || kind === "news-file") {
      if (!pageMeta?.url) { env.toast(i18n("state.vaultregistry.7b3408d0e018")); return false; }
      void import("../pages/info/openExternal.js").then((m) => m.openExternal(pageMeta.url!));
      return true;
    }
    if (kind === "gitlab-project" && pageMeta?.projectId != null) {
      env.navigate("gitlab", { gitlabProject: Number(pageMeta.projectId) });
      return true;
    }
    if (kind === "tab" && pageMeta?.page) {
      env.navigate(pageMeta.page, (pageMeta.params ?? undefined) as Record<string, unknown> | undefined);
      return true;
    }
    if (kind === "workspace" && pageMeta?.workspaceId) {
      void import("./explorer.js").then((m) => m.openWorkspace(pageMeta.workspaceId!));
      return true;
    }
    const routeId = pmeta?.routeId ?? pmeta?.settingTitle;
    if (routeId) {
      void (async () => {
        const { allSearchRows, goSearchRow } = await import("./searchRows.js");
        const row = allSearchRows().find((r) => r.id === routeId || r.title === routeId);
        if (row) goSearchRow(row);
        else env.toast(i18n("state.vaultregistry.ab9c4ba06c08"));
      })();
      return true;
    }
  }
  env.toast(i18n("state.vaultregistry.2808a4f9d0f0"));
  return false;
}
