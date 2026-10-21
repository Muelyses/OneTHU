import { t as i18n, msg as i18nMsg, useLocale as useUiLocale } from "../i18n/index.js";
import { Btn } from "@onethu/gui";
/**
 * 下载完成提示右侧的「打开文件 / 打开目录」小图标按钮（R23，霖需求）。
 *
 * - 打开文件：系统默认应用打开；
 * - 打开目录：文件管理器定位并选中该文件（Windows 资源管理器 / macOS Finder；Linux 打开所在目录）；
 * - 图标用应用内联线性图标（1.6px 描边 + currentColor），随提示条继承蓝色，不用 emoji；
 * - 仅桌面显示：Android 下载落在应用私有目录，无「定位」语义（isAndroidNavigator 多信号判定）；
 * - 失败降级为 toast 报错，不抛出。
 *
 * 实现走自写 Rust 命令（`lib/localFile.ts`）而非官方 opener 插件：插件的 openPath 需要
 * capability 配路径 scope，只给命令权限会报「Not allowed to open path ...」，而下载位置
 * 由用户决定、白名单覆盖不全（详见 lib/localFile.ts 注释）。
 */
import { ReactNode, useState } from "react";
import { IconFile, IconFolder } from "./Icons.js";
import { isAndroidNavigator } from "../lib/androidHost.js";
import { openLocalPath, revealLocalPath } from "../lib/localFile.js";
import { showToast } from "../state/toast.js";

export function DownloadOpenButtons({ path }: { path: string }): ReactNode {
  const uiLocale = useUiLocale();

  const [busy, setBusy] = useState<"" | "file" | "dir">("");
  if (isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined)) return null;
  if (!path) return null;

  const run = async (kind: "file" | "dir"): Promise<void> => {
    setBusy(kind);
    try {
      if (kind === "file") await openLocalPath(path);
      else await revealLocalPath(path);
    } catch (e) {
      showToast(i18nMsg("components.downloadopenbuttons.ba0f72777540", { value: String(kind === "file" ? i18n("components.downloadopenbuttons.4c8a4e3da39e") : i18n("components.downloadopenbuttons.7d0d5850515d")), value2: String(e instanceof Error ? e.message : String(e)) }));
    } finally {
      setBusy("");
    }
  };

  return (
    <span className="dl-open-btns" role="group" aria-label={i18n("components.downloadopenbuttons.8e41f8c5d046")}>
      <Btn variant="ghost" titleAttr={i18n("components.downloadopenbuttons.ab6abf6a2149")} aria-label={i18n("components.downloadopenbuttons.4c8a4e3da39e")} disabled={busy !== ""} onClick={(e) => {
          e.stopPropagation();
          void run("file");
        }}><IconFile width={14} height={14} /></Btn>
      <Btn variant="ghost" titleAttr={i18n("components.downloadopenbuttons.74e3f19da118")} aria-label={i18n("components.downloadopenbuttons.7d0d5850515d")} disabled={busy !== ""} onClick={(e) => {
          e.stopPropagation();
          void run("dir");
        }}><IconFolder width={14} height={14} /></Btn>
    </span>
  );
}
