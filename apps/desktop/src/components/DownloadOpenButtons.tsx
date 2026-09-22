/**
 * 下载完成提示右侧的「打开文件 / 打开目录」小图标按钮（R23，霖需求）。
 *
 * - 打开文件：系统默认应用打开（opener.openPath）；
 * - 打开目录：文件管理器定位并选中该文件（opener.revealItemInDir，Windows 资源管理器 /
 *   macOS Finder；Linux 走 xdg-open 目录）；
 * - 仅桌面显示：Android 下载落在应用私有目录，无「定位」语义（isAndroidNavigator 多信号
 *   判定，主窗口 UA 被伪装也不误判）；失败降级为 toast 报错，不抛出。
 */
import { ReactNode, useState } from "react";
import { isAndroidNavigator } from "../lib/androidHost.js";
import { showToast } from "../state/toast.js";

export function DownloadOpenButtons({ path }: { path: string }): ReactNode {
  const [busy, setBusy] = useState<"" | "file" | "dir">("");
  if (isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined)) return null;
  if (!path) return null;

  const run = async (kind: "file" | "dir"): Promise<void> => {
    setBusy(kind);
    try {
      const opener = await import("@tauri-apps/plugin-opener");
      if (kind === "file") await opener.openPath(path);
      else await opener.revealItemInDir(path);
    } catch (e) {
      showToast(`${kind === "file" ? "打开文件" : "打开目录"}失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy("");
    }
  };

  return (
    <span className="dl-open-btns" role="group" aria-label="打开下载的文件">
      <button
        className="btn btn-ghost dl-open-btn"
        title="打开文件（系统默认应用）"
        disabled={busy !== ""}
        onClick={(e) => {
          e.stopPropagation();
          void run("file");
        }}
      >
        📄
      </button>
      <button
        className="btn btn-ghost dl-open-btn"
        title="打开目录（定位到文件）"
        disabled={busy !== ""}
        onClick={(e) => {
          e.stopPropagation();
          void run("dir");
        }}
      >
        📁
      </button>
    </span>
  );
}
