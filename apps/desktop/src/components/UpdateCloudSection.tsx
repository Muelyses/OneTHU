/**
 * 设置 → 关于 里的「软件更新（清华云盘）」分区（2026-10-12）。
 *
 * 链路：检查更新（读云盘 `OneTHU/release/latest.json`）→ 有新版本 → **用户确认** →
 * 内部下载（进度可见、随时可取消）→ **自动拉起系统安装页**（桌面=系统默认方式打开
 * DMG/EXE；安卓=系统安装器确认页）。**绝不静默下载/安装**：每一次网络与写入都由按钮触发。
 *
 * 挂载：本组件自包含（自带样式与状态），由 Lead/设置页在「关于」分区里挂一次即可：
 *   `import { UpdateCloudSection } from "./UpdateCloudSection.js";` … `<UpdateCloudSection />`
 * 不改 `pages/Settings.tsx`（那是 Lead / ball-ui 的写域）。
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { formatSize } from "../lib/attach.js";
import { confirmOk } from "../lib/confirm.js";
import {
  cancelUpdateDownload, checkCloudUpdate, cloudRepos, downloadUpdate, fileNameFor,
  installDownloaded, platformKey, type CloudCheckResult, type UpdateProgress,
} from "../lib/updater.js";
import { currentVersion } from "../lib/update.js";
import { useSeafile } from "../state/seafile.js";

type Phase = "idle" | "checking" | "latest" | "available" | "downloading" | "downloaded" | "error";

const PLATFORM_LABEL: Record<string, string> = {
  android: "安卓", macos: "macOS", windows: "Windows", linux: "Linux",
};

export interface UpdateCloudSectionProps {
  /** 联调/验收用：覆盖清单路径（默认云盘固定路径 OneTHU/release/latest.json） */
  manifestPath?: string;
}

export function UpdateCloudSection({ manifestPath }: UpdateCloudSectionProps = {}): ReactNode {
  const [phase, setPhase] = useState<Phase>("idle");
  const [res, setRes] = useState<CloudCheckResult | null>(null);
  const [repoId, setRepoId] = useState<string>("");
  const [repos, setRepos] = useState<Array<{ id: string; name: string }>>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [localPath, setLocalPath] = useState("");
  const [busy, setBusy] = useState(false);
  const sf = useSeafile();
  const version = currentVersion();
  const plat = useMemo(() => platformKey(), []);

  /** 需要挑库时把列表拉出来（只在用户点过之后拉，不在挂载时就打网络） */
  const loadRepos = useCallback(async (): Promise<void> => {
    try {
      const list = await cloudRepos();
      setRepos(list);
      if (!repoId && list.length === 1 && list[0]) setRepoId(list[0].id);
    } catch {
      /* 列表拉不到就只提示原因，不阻断 */
    }
  }, [repoId]);

  const check = useCallback(async (): Promise<void> => {
    setBusy(true);
    setPhase("checking");
    setErr("");
    setMsg("");
    setProgress(null);
    setLocalPath("");
    const r = await checkCloudUpdate({ repoId: repoId || undefined, manifestPath });
    setRes(r);
    setBusy(false);
    if (!r.ok) {
      setPhase("error");
      setErr(r.error ?? "检查失败");
      if (r.needUi) void loadRepos();
      return;
    }
    if (r.hasUpdate) {
      setPhase("available");
      setMsg(`发现新版本 v${r.latest}（当前 v${r.current}）`);
    } else {
      setPhase("latest");
      setMsg(`已是最新版（v${r.current}）`);
    }
  }, [loadRepos, manifestPath, repoId]);

  /** 下载 + 拉起安装页（用户已确认过的动作；下载完自动打开安装器，安卓只拉起确认页） */
  const downloadAndInstall = useCallback(async (): Promise<void> => {
    const r = res;
    const asset = r?.asset;
    if (!r?.ok || !asset || !r.repoId) return;
    const name = fileNameFor(asset, r.latest ?? version);
    const sizeText = asset.size ? formatSize(asset.size) : "大小未知";
    const ok = await confirmOk(
      `将从清华云盘下载更新包并交给系统安装器：\n\n`
        + `版本：v${r.latest}\n平台：${PLATFORM_LABEL[plat] ?? plat}\n文件：${name}（${sizeText}）\n`
        + `落点：应用数据目录下的 updates/\n\n`
        + `点「确定」= 开始下载；下载完成后**由系统安装器接手**（安卓会在系统页里再确认一次，不会静默安装）。`,
    );
    if (!ok) return;
    setBusy(true);
    setPhase("downloading");
    setErr("");
    setMsg(`正在下载 ${name}…`);
    setProgress({ phase: "probe", received: 0, total: asset.size ?? 0, percent: 0 });
    const d = await downloadUpdate({
      repoId: r.repoId,
      remotePath: asset.url,
      fileName: name,
      expectSize: asset.size,
      onProgress: setProgress,
    });
    if (!d.ok) {
      setBusy(false);
      setPhase("error");
      setErr(d.cancelled ? "已取消下载（没有留下残缺文件）" : `下载失败：${d.error ?? "未知原因"}`);
      return;
    }
    setLocalPath(d.path ?? "");
    setPhase("downloaded");
    setMsg(`下载完成（${d.size ? formatSize(d.size) : "?"}），正在拉起系统安装页…`);
    const inst = await installDownloaded(d.path ?? "");
    setBusy(false);
    if (inst.ok) {
      setMsg(`已下载到 ${d.path}\n${inst.hint ?? "已拉起系统安装页。"}`);
    } else {
      setPhase("error");
      setErr(`已下载到 ${d.path}，但拉起安装页失败：${inst.error ?? "未知原因"}（可手动打开该文件）`);
    }
  }, [plat, res, version]);

  const cancel = useCallback(async (): Promise<void> => {
    setMsg("正在取消…");
    await cancelUpdateDownload();
  }, []);

  const pct = progress && progress.total > 0 ? progress.percent : progress?.percent ?? 0;
  const showBar = phase === "downloading";
  const sizeNote = res?.asset?.size ? formatSize(res.asset.size) : "";

  return (
    <div className="setting-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
      <div>
        <div className="setting-title">
          软件更新（清华云盘）
          {res?.hasUpdate ? <span className="update-badge">有新版本</span> : null}
        </div>
        <div className="setting-desc">
          当前版本 v{version} · 平台 {PLATFORM_LABEL[plat] ?? plat} · 更新包与清单放在清华云盘
          （清单固定路径 OneTHU/release/latest.json）
        </div>
      </div>

      {res?.needUi || (phase === "error" && repos.length > 0) ? (
        <div>
          <div className="setting-desc">资料库（更新包所在库，不替你猜）</div>
          <select className="input" value={repoId} onChange={(e) => setRepoId(e.target.value)} style={{ width: "100%" }}>
            <option value="">— 请选择 —</option>
            {repos.map((rp) => (
              <option key={rp.id} value={rp.id}>{rp.name}</option>
            ))}
          </select>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void check()}>
          {phase === "checking" ? "检查中…" : "检查更新"}
        </button>
        {phase === "available" || phase === "error" ? (
          <button className="btn" type="button" disabled={busy || !res?.asset} onClick={() => void downloadAndInstall()}>
            {phase === "error" && localPath === "" && res?.hasUpdate ? "重试：下载并安装" : "下载并安装"}
          </button>
        ) : null}
        {showBar ? (
          <button className="btn" type="button" onClick={() => void cancel()}>取消</button>
        ) : null}
        {phase === "downloaded" && localPath ? (
          <button className="btn" type="button" onClick={() => void installDownloaded(localPath)}>再打开一次安装页</button>
        ) : null}
        {sf.configured ? null : <span className="setting-desc">（云盘未连接：先到「云盘」页连接）</span>}
      </div>

      {showBar ? (
        <div>
          <div
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{
              height: 6, borderRadius: 3, overflow: "hidden",
              background: "var(--dsw-alias-bg-layer-2, #f4f4f6)",
              border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))",
            }}
          >
            <div
              style={{
                width: `${Math.max(0, Math.min(100, pct))}%`, height: "100%",
                background: "var(--dsw-alias-brand-primary, #1c1f24)", transition: "width .18s linear",
              }}
            />
          </div>
          <div className="setting-desc">
            {progress?.total
              ? `${Math.round(pct)}%（${formatSize(progress.received)} / ${formatSize(progress.total)}）`
              : `已下载 ${progress ? formatSize(progress.received) : "0"}`}
            {" · 下载中可随时取消"}
          </div>
        </div>
      ) : null}

      {msg ? (
        <div className="setting-desc" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{msg}</div>
      ) : null}
      {err ? (
        <div className="error-note" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{err}</div>
      ) : null}

      {res?.ok && res.hasUpdate ? (
        <div className="setting-desc" style={{ whiteSpace: "pre-wrap" }}>
          {`版本：v${res.latest}${res.releasedAt ? `（${res.releasedAt}）` : ""}`
            + `\n安装包：${res.asset ? res.asset.url : "（清单里没有当前平台的文件）"}${sizeNote ? ` · ${sizeNote}` : ""}`
            + `${res.asset?.sha256 ? `\nsha256：${res.asset.sha256}（本版仅展示，未做哈希校验）` : ""}`
            + `${res.belowMin ? `\n注意：当前版本低于清单要求的 v${res.manifest?.minVersion}，建议尽快更新。` : ""}`
            + `${res.notes ? `\n\n更新说明：\n${res.notes}` : ""}`}
        </div>
      ) : null}

      {plat === "android" && phase !== "idle" ? (
        <div className="setting-desc">
          安卓安装说明：安装包下载完成后由系统安装器接管；首次安装需要在系统提示里允许本应用
          「安装未知应用」（该授权只影响这一次安装，OneTHU 不会静默安装任何东西）。
        </div>
      ) : null}
    </div>
  );
}
