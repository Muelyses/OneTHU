/**
 * 全局悬浮球设置（需求 5）：开关 + 授权状态 + 「本次关闭」说明。
 * 真源在原生侧（SharedPreferences，安卓系统悬浮层）/ 悬浮球窗口（桌面），
 * 这里只做入口：打开 = overlayShow()（同时清掉前端的「本次已关闭」标记）。
 */
import { defineSearchRows } from "../state/searchRows.js";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Card, Switch } from "./Layout.js";
import { isOverlayClosedByUser, overlayHide, setOverlayClosedByUser, overlayShow, overlaySupported } from "../lib/overlay.js";
import { hasOverlayPermission, requestOverlayPermission } from "../lib/overlayAndroid.js";


/* task-19：悬浮球设置行注册 */
defineSearchRows([
  { id: "overlay-on", tab: "OneTHU Harness", section: "悬浮球", title: "开启悬浮球", aliases: ["悬浮球", "浮窗", "overlay", "权限"], desc: "浮在其他应用上层的 OH 球；需要悬浮窗权限" , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "悬浮球", "开启悬浮球"], displayRoot: "设置" },
]);

export function OverlaySettingsSection(): ReactNode {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [open, setOpen] = useState<boolean>(!isOverlayClosedByUser());
  const [perm, setPerm] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  void busy; // 开关本身不做禁用态（Switch 无 disabled 属性），并发点击由 toggle 内的 await 自然串行

  useEffect(() => {
    void (async () => {
      setSupported(await overlaySupported());
      setPerm(await hasOverlayPermission().catch(() => null));
    })();
  }, []);

  const toggle = useCallback(async (next: boolean): Promise<void> => {
    setBusy(true);
    try {
      if (next) {
        if (!(await hasOverlayPermission().catch(() => false))) {
          await requestOverlayPermission().catch(() => undefined);
        }
        setOverlayClosedByUser(false);
        await overlayShow();
        setOpen(true);
      } else {
        setOverlayClosedByUser(true);
        await overlayHide();
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  if (supported === false) {
    return (
      <div className="setting-row">
        <div>
          <div className="setting-title">全局悬浮球</div>
          <div className="setting-desc">当前平台不支持在其他应用上层显示（仅安卓与桌面端可用）</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="setting-row">
        <div>
          <div className="setting-title">在其他应用上层显示 OH 悬浮球</div>
          <div className="setting-desc">
            单击展开对话，长按说话；在别的应用里也能用，不会把你拉回 OneTHU。
            {perm === false ? "（需要先授予「显示在其他应用上层」权限）" : ""}
          </div>
        </div>
        <Switch on={open} label="在其他应用上层显示 OH 悬浮球" onChange={(v) => void toggle(v)} />
      </div>
      {open ? (
        <div className="setting-row">
          <div>
            <div className="setting-title">本次关闭悬浮球</div>
            <div className="setting-desc">关闭后不再自动出现，回到这里（或 OH 对话界面）可重新打开</div>
          </div>
          <button className="btn btn-ghost" onClick={() => void toggle(false)}>关闭悬浮球</button>
        </div>
      ) : null}
    </>
  );
}
