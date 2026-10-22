import { msg as i18nMsg } from "../i18n/index.js";
import { getLocale as getUiLocale } from "../i18n/index.js";
import { t as i18n, rich as i18nRich, useLocale as useUiLocale } from "../i18n/index.js";
import { Input } from "@onethu/gui";
/**
 * 「软件更新」分区（设置 → 关于，2026-10-12 合并版）。
 *
 * 一节、一个按钮、**双源自动切换**（用户不需要选库/选源）：
 *   主源 GitHub Releases（`releases/latest/download/latest.json`，外网）→
 *   备用 清华云盘官方镜像分享链接（校内可达）→ 结果卡里注明**实际走了哪条**。
 *
 * 流程：检查更新 →（有新版）「下载并安装」→ 用户确认 → 分段下载（进度可见、可取消、
 * sha256 校验）→ **自动拉起系统安装页**（桌面=系统默认方式打开 DMG/EXE；安卓=系统安装器
 * 确认页）。**绝不静默下载/安装**；「忽略此版本」沿用 `lib/update.js` 的 `dismissTag`
 * （与历史启动提醒共用同一份 localStorage 键）。
 *
 * 挂载：`<SoftwareUpdateSection />`（设置 → 关于）。不传 props 即官方双源；
 * 联调时可用 `customManifestUrl` 指向一份 mock 清单。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { formatSize } from "../lib/attach.js";
import { confirmOk } from "../lib/confirm.js";
import { currentVersion, dismissTag, isDismissed } from "../lib/update.js";
import {
  cancelUpdateDownload, checkForUpdate, downloadUpdate, installDownloaded, platformKey,
  PLATFORM_LABEL, SOURCE_LABEL, type UpdateCheckResult, type UpdateProgress,
} from "../lib/updater.js";
import { Btn, Progress, Stack } from "@onethu/gui";

type Phase = "idle" | "checking" | "latest" | "available" | "downloading" | "downloaded" | "error";

export interface SoftwareUpdateSectionProps {
  /** 联调/验收用：直接查这份清单 URL（不填 = 官方双源自动切换） */
  customManifestUrl?: string;
}

export function SoftwareUpdateSection({ customManifestUrl }: SoftwareUpdateSectionProps = {}): ReactNode {
  const uiLocale = useUiLocale();

  const [phase, setPhase] = useState<Phase>("idle");
  const [res, setRes] = useState<UpdateCheckResult | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [localPath, setLocalPath] = useState("");
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [customUrl, setCustomUrl] = useState("");
  const checkController = useRef<AbortController | null>(null);
  const checkSequence = useRef(0);
  const [checkingSource, setCheckingSource] = useState("");
  useEffect(() => () => { checkSequence.current++; checkController.current?.abort(); }, []);
  const version = currentVersion();
  const plat = platformKey();

  const check = useCallback(async (): Promise<void> => {
    if (checkController.current) return;
    const controller = new AbortController();
    checkController.current = controller;
    const sequence = ++checkSequence.current;
    setBusy(true);
    setPhase("checking");
    setErr("");
    setMsg("");
    setProgress(null);
    setRes(null);
    try {
    const r = await checkForUpdate({
      customManifestUrl: (customUrl || customManifestUrl || "").trim() || undefined,
      signal: controller.signal,
      onSource: source => { if (checkSequence.current === sequence) setCheckingSource(SOURCE_LABEL[source]); },
    });
    if (checkSequence.current !== sequence) return;
    setRes(r);
    setBusy(false);
    setCheckedAt(Date.now());
    if (!r.ok) {
      setPhase("error");
      setErr(r.error ?? i18n("components.softwareupdatesection.4f6f06254d16"));
      return;
    }
    setDismissed(Boolean(r.latest && isDismissed(r.latest)));
    if (r.hasUpdate) {
      setPhase("available");
      setMsg(i18n("components.softwareupdatesection.3b98279a2021", { latest: String(r.latest), current: String(r.current) }));
    } else {
      setPhase("latest");
      setMsg("");
    }
    } catch (error) {
      if (checkSequence.current !== sequence) return;
      setPhase("error");
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      if (checkSequence.current === sequence) { setBusy(false); checkController.current = null; }
    }
  }, [customManifestUrl, customUrl]);

  const cancelCheck = (): void => {
    checkSequence.current++;
    checkController.current?.abort(); checkController.current = null;
    setBusy(false); setPhase("idle"); setMsg(i18n("update.checkCancelled"));
  };

  /** 下载 + 拉起安装页（下载完自动打开安装器；安卓只拉起确认页） */
  const downloadAndInstall = useCallback(async (): Promise<void> => {
    const r = res;
    if (!r?.ok || !r.downloadUrl || !r.downloadName) return;
    const asset = r.asset;
    const sizeText = asset?.size ? formatSize(asset.size) : i18n("components.softwareupdatesection.f8f5f153c20d");
    const ok = await confirmOk(
      i18nMsg("components.softwareupdatesection.f22fe456ba20", { value: String(r.sourceLabel ?? i18n("components.softwareupdatesection.4d8c1c5b4283")), latest: String(r.latest), value2: String(PLATFORM_LABEL[plat]), downloadName: String(r.downloadName), sizeText: String(sizeText) }),
    );
    if (!ok) return;
    setBusy(true);
    setPhase("downloading");
    setErr("");
    setMsg(i18n("components.softwareupdatesection.faa2f14dfa0b", { downloadName: String(r.downloadName) }));
    setProgress({ phase: "probe", received: 0, total: asset?.size ?? 0, percent: 0 });
    const d = await downloadUpdate({
      url: r.downloadUrl,
      fileName: r.downloadName,
      expectSize: asset?.size,
      expectSha256: asset?.sha256,
      onProgress: setProgress,
    });
    if (!d.ok) {
      setBusy(false);
      setPhase("error");
      setErr(d.cancelled ? i18n("components.softwareupdatesection.505052ea96fc") : i18n("components.softwareupdatesection.6dd57693b44a", { value: String(d.error ?? i18n("components.softwareupdatesection.a1a9da9ee6ed")) }));
      return;
    }
    setLocalPath(d.path ?? "");
    setPhase("downloaded");
    setMsg(i18n("components.softwareupdatesection.388289c18d09", { value: String(d.size ? formatSize(d.size) : "?"), value2: String(d.verified ? i18n("components.softwareupdatesection.9957c2dd1877") : "") }));
    const inst = await installDownloaded(d.path ?? "");
    setBusy(false);
    if (inst.ok) {
      setMsg(i18n("components.softwareupdatesection.1e178bb2ba4b", { path: String(d.path), value: String(inst.hint ?? i18n("components.softwareupdatesection.78ed0342345e")) }));
    } else {
      setPhase("error");
      setErr(i18n("components.softwareupdatesection.fe8283074c76", { path: String(d.path), value: String(inst.error ?? i18n("components.softwareupdatesection.a1a9da9ee6ed")) }));
    }
  }, [plat, res]);

  const onDismiss = useCallback((): void => {
    if (res?.latest) dismissTag(res.latest);
    setDismissed(true);
  }, [res]);

  const pct = progress?.percent ?? 0;
  const showBar = phase === "downloading";
  const srcLine = res?.sourceLabel ? i18n("components.softwareupdatesection.5b6dd039fc20", { sourceLabel: String(res.sourceLabel) }) : "";
  const shaLine = res?.ok && res.hasUpdate
    ? res.hashAvailable
      ? i18n("components.softwareupdatesection.3c0fc35e4fb6")
      : i18n("components.softwareupdatesection.e18465dcfa9e")
    : "";

  return (
    <div id="row-检查-OneTHU-更新">
      <Stack gap={2}>
      <div>
        <div className="setting-title">{i18nRich("components.softwareupdatesection.c692dd3f13e4", { value: res?.ok && res.hasUpdate ? <span className="update-badge">{i18n("components.softwareupdatesection.daedea385864")}</span> : null })}</div>
        <div className="setting-desc">{i18nRich("components.softwareupdatesection.1aec2113851b", { version: version, value: PLATFORM_LABEL[plat] })}</div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Btn variant="solid" tone="brand" loading={phase === "checking"} disabled={busy} onClick={() => void check()}>
          {phase === "checking" ? i18n("update.checkingSource", { source: checkingSource }) : i18n("components.softwareupdatesection.7f68ebad19ba")}
        </Btn>
        {phase === "checking" ? <Btn variant="outline" onClick={cancelCheck}>{i18n("common.cancel")}</Btn> : null}
        {phase === "available" || (phase === "error" && res?.ok && res.hasUpdate) ? (
          <Btn variant="outline" disabled={busy} onClick={() => void downloadAndInstall()}>
            {phase === "error" ? i18n("components.softwareupdatesection.ea0add721b8e") : i18n("components.softwareupdatesection.ac69f68b7010")}
          </Btn>
        ) : null}
        {showBar ? <Btn variant="ghost" onClick={() => void cancelUpdateDownload()}>{i18n("components.softwareupdatesection.2cd0f3be8738")}</Btn> : null}
        {phase === "downloaded" && localPath ? (
          <Btn variant="outline" onClick={() => void installDownloaded(localPath)}>{i18n("components.softwareupdatesection.20f2c779de7a")}</Btn>
        ) : null}
        {res?.ok && res.hasUpdate && !dismissed ? (
          <Btn variant="ghost" onClick={onDismiss}>{i18n("components.softwareupdatesection.c748fafe62d1")}</Btn>
        ) : null}
      </div>

      {showBar ? (
        <div>
          <Progress value={Math.max(0, Math.min(100, pct)) / 100} aria-label={i18n("components.softwareupdatesection.fad86bf65f72")} />
          <div className="setting-desc">
            {progress?.total
              ? `${Math.round(pct)}%（${formatSize(progress.received)} / ${formatSize(progress.total)}）`
              : i18n("components.softwareupdatesection.165defdf8038", { value: String(progress ? formatSize(progress.received) : "0") })}
            {i18n("components.softwareupdatesection.8314625c2f52")}
          </div>
        </div>
      ) : null}

      {phase === "latest" && res?.ok ? (
        <div className="setting-desc">{i18nRich("components.softwareupdatesection.1b6ff015b8a8", { current: res.current, value: checkedAt ? i18n("components.softwareupdatesection.71ebab125a66", { checkedAt: new Date(checkedAt).toLocaleTimeString(getUiLocale(), { hour: "2-digit", minute: "2-digit" }) }) : "" })}</div>
      ) : null}

      {msg ? <div className="setting-desc" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{msg}</div> : null}
      {err ? <div className="error-note" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{err}</div> : null}

      {res?.ok && res.hasUpdate ? (
        <div className="setting-desc" style={{ whiteSpace: "pre-wrap" }}>
          {i18n("components.softwareupdatesection.d54a23c91b8f", { latest: String(res.latest), value: String(res.releasedAt ? `（${res.releasedAt}）` : "") })
            + `${srcLine ? `\n${srcLine}` : ""}`
            + `${res.fallbackReason ? i18n("components.softwareupdatesection.18697440c895", { fallbackReason: String(res.fallbackReason) }) : ""}`
            + i18n("components.softwareupdatesection.43e805b35d14", { value: String(res.asset?.name ?? res.downloadName), value2: String(res.asset?.size ? ` · ${formatSize(res.asset.size)}` : "") })
            + `${shaLine ? `\n${shaLine}` : ""}`
            + `${res.belowMin ? i18n("components.softwareupdatesection.cffe690b5ead", { minVersion: String(res.manifest?.minVersion) }) : ""}`
            + `${dismissed ? i18n("components.softwareupdatesection.cbb04a6052b1") : ""}`
            + `${res.notes ? i18n("components.softwareupdatesection.e5958649985d", { notes: String(res.notes) }) : ""}`}
        </div>
      ) : null}

      {plat === "android" && phase !== "idle" ? (
        <div className="setting-desc">{i18n("components.softwareupdatesection.b7d7aca618eb")}</div>
      ) : null}

      <details>
        <summary className="setting-desc" style={{ cursor: "pointer" }}>{i18n("components.softwareupdatesection.7e21bf73a0ef")}</summary>
        <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>{<Input placeholder={i18n("components.softwareupdatesection.b71ae82b4fba")} value={customUrl} onChange={(value) => setCustomUrl(value)} />}</div>
          <Btn variant="outline" disabled={busy || !customUrl.trim()} onClick={() => void check()}>{i18n("components.softwareupdatesection.abae77ee2a3f")}</Btn>
          <Btn variant="outline" disabled={busy || !customUrl} onClick={() => { setCustomUrl(""); }}>{i18n("components.softwareupdatesection.4370d1b15447")}</Btn>
        </div>
        <div className="setting-desc" style={{ marginTop: 4 }}>{i18nRich("components.softwareupdatesection.87c4f699e972", { github: SOURCE_LABEL.github, cloud: SOURCE_LABEL.cloud })}</div>
      </details>
    </Stack>    
    </div>
  );
}
