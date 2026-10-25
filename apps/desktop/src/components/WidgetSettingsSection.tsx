import { t as i18n, msg as i18nMsg, rich as i18nRich, useLocale as useUiLocale } from "../i18n/index.js";
import { Btn } from "@onethu/gui";
/**
 * 设置页「桌面小组件」区块：桌面上每一块显示什么，在这里一眼看全并逐个改。
 *
 * 与上一版的关键差别：内容**按块**绑定（以前是一份全局配置，导致桌面上所有 OneTHU 小组件
 * 长得一样）。这里列出原生报回的每一块：形态、当前内容、换内容 / 恢复默认。
 *
 * 平台口径：小组件只有 Android 有承载，桌面端明确不做——非 Android 显示一行说明，不给假开关。
 */
import { defineSearchRows } from "../state/searchRows.js";
import { useEffect, useState, type ReactNode } from "react";
import { useFavs } from "../state/favs.js";
import { isAndroidNavigator } from "../lib/androidHost.js";
import { ensureWidgetRuntime } from "../state/notifySources.js";
import { fetchWidgetStatus, pinWidget, type NativeWidgetStatus } from "../state/widgetBridge.js";
import { showToast } from "../state/toast.js";
import type { WidgetInstanceInfo } from "../state/widgetRuntime.js";
import { fetchWidgetInstances } from "../state/widgetBridge.js";
import {
  bindingOf, loadWidgetInstances, setWidgetFallback, unbindWidgetInstance,
} from "../state/widgetInstances.js";
import { requestWidgetBind } from "../state/widgetBindUi.js";
import { FavAtomPicker } from "./FavAtomPicker.js";
import { bindingSummary, shapeLabel } from "./WidgetBindModal.js";
import { useNotifyBackend } from "./useNotifyBackend.js";

/** 系统报回的 provider 名（宿主 1×1 / 槽位 2）→ 用户看得懂的尺寸名 */
function plainShapeName(name: string): string {
  return name.replace(/^宿主\s*/, "").replace(/^槽位\s*/, "可自选 ");
}


/* task-19：桌面小组件设置行注册 */
defineSearchRows([
  { id: "widget-main", tab: "功能", section: "桌面小组件", get title() { return i18n("components.widgetsettingssection.28b0433b1b95"); }, aliases: ["小组件", "widget", "桌面组件"], get desc() { return i18n("components.widgetsettingssection.796fd26679bc"); } , breadcrumb: ["设置", "功能", "桌面小组件", "桌面小组件"] },
  {
    id: "widget-slots", tab: "功能", section: "桌面小组件", get title() { return i18n("components.widgetsettingssection.ae0f6a0341d8"); }, aliases: ["槽位", "插件小组件"], get desc() { return i18n("components.widgetsettingssection.23c3567bc418"); },
    breadcrumb: ["设置", "功能", "桌面小组件", "小组件槽位"],
    /* 槽位只在 Android 原生承载里存在：桌面端没有这行，别让 goSearchRow 报 row 级命中。 */
    visible: () => isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined),
    fallbackNote: "「小组件槽位」仅 Android 版可用；已到「桌面小组件」。",
  },
]);

export function WidgetSettingsSection(): ReactNode {
  const uiLocale = useUiLocale();

  const favs = useFavs();
  const backend = useNotifyBackend();
  const [instances, setInstances] = useState<WidgetInstanceInfo[] | null>(null);
  /** null = 读取失败（与「读到 0 块」是两回事，不能都显示成「正在读取」） */
  const [readFailed, setReadFailed] = useState(false);
  const [status, setStatus] = useState<NativeWidgetStatus | null>(null);
  const [map, setMap] = useState(() => loadWidgetInstances());
  const [msg, setMsg] = useState<string | null>(null);
  /** 默认内容选「快捷方式」时要挑收藏项 */
  const [fallbackPicker, setFallbackPicker] = useState(false);

  const android = backend === "android";

  const refresh = async (): Promise<void> => {
    const list = await fetchWidgetInstances();
    setReadFailed(list === null);
    setInstances(list ?? []);
    setMap(loadWidgetInstances());
    setStatus(await fetchWidgetStatus());
  };

  useEffect(() => {
    if (android) void refresh();
  }, [android]);

  const pushNow = async (): Promise<void> => {
    const rt = await ensureWidgetRuntime();
    const okNow = await rt.syncNow();
    await refresh();
    setMsg(okNow ? i18n("components.widgetsettingssection.6a46a714e7c0") : i18n("components.widgetsettingssection.23a5d87729b6"));
  };

  if (!android) {
    return (
      <div data-set-id="row-widget-main" className="setting-row">
        <div>
          <div className="setting-title">{i18n("components.widgetsettingssection.28b0433b1b95")}</div>
          <div className="setting-desc">{i18n("components.widgetsettingssection.651c36e836dd")}</div>
        </div>
      </div>
    );
  }

  return (
    <section className="widget-settings">
      <div className="setting-row">
        <div>
          <div className="setting-title">{i18n("components.widgetsettingssection.a73b70af248d")}</div>
          <div className="setting-desc">
            {readFailed
              ? i18n("components.widgetsettingssection.d6a437ad7912")
              : instances === null
                ? i18n("components.widgetsettingssection.86b6d0d63062")
                : instances.length === 0
                  ? i18n("components.widgetsettingssection.021377fb5c78")
                  : i18n("components.widgetsettingssection.dea5a08f19a0", { length: String(instances.length) })}
          </div>
        </div>
        <div className="widget-settings-actions">
          {/* R21c：ColorOS 等启动器上「绑定完桌面上没有」——直接请求系统放一块，
              绕开各家行为不一致的选择器；不支持时给出明确的手动路径。 */}
          <Btn variant="outline" titleAttr={i18n("components.widgetsettingssection.ac32b4f647b8")} onClick={() => {
              void (async () => {
                const r = await pinWidget();
                if (r.requested) {
                  showToast(i18nMsg("components.widgetsettingssection.f607db600fe1"));
                  void refresh();
                } else if (r.supported) {
                  showToast(i18nMsg("components.widgetsettingssection.da34afed35d2"), 6000);
                } else {
                  showToast(i18nMsg("components.widgetsettingssection.5321a21a1d1c"), 6000);
                }
              })();
            }}>{i18n("components.widgetsettingssection.d1b082232f2a")}</Btn>
          <Btn variant="ghost" onClick={() => void pushNow()}>{i18n("components.widgetsettingssection.130123e01753")}</Btn>
          <Btn variant="ghost" onClick={() => void refresh()}>{i18n("components.widgetsettingssection.35588dcb9be3")}</Btn>
        </div>
      </div>

      {/* 形态登记情况：选择器里「看不到某个尺寸」时，先确认系统到底登记了哪几个尺寸 */}
      {status ? (
        <div className="setting-row">
          <div>
            <div className="setting-title">{i18n("components.widgetsettingssection.cf91efc66059")}</div>
            <div className="setting-desc">
              {status.providersRegistered.length === 0
                ? i18n("components.widgetsettingssection.174b9ff2e902")
                : i18n("components.widgetsettingssection.15eb664681a3", { length: String(status.providersRegistered.length), value: String(status.providersRegistered.map(plainShapeName).join("、")) })}
              <span style={{ color: "var(--text-3)" }}>{i18n("components.widgetsettingssection.a5f712b24b56")}</span>
              {status.romSignals ? (
                <>
                  <br />
                  <span style={{ color: "var(--text-3)" }}>{i18nRich("components.widgetsettingssection.83b518207df9", { rom: status.rom, romSignals: status.romSignals })}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* task-22 检索直达：小组件槽位 = 每一块的「换内容」行集合；display:contents 不改布局 */}
      <div data-set-id="row-widget-slots" style={{ display: "contents" }}>
      {(instances ?? []).map((inst) => (
        <div className="setting-row" key={inst.id}>
          <div>
            <div className="setting-title">{shapeLabel(inst)}</div>
            <div className="setting-desc">
              {bindingSummary(bindingOf(inst.id, map), favs.data)}
              {inst.bound === false ? <span style={{ color: "var(--text-3)" }}>{i18n("components.widgetsettingssection.502498767131")}</span> : null}
            </div>
          </div>
          <div className="widget-settings-actions">
            <Btn variant="outline" onClick={() => requestWidgetBind({ to: "instance", id: String(inst.id) })}>{i18n("components.widgetsettingssection.ddfbdc2f2337")}</Btn>
            {map.byId[String(inst.id)] ? (
              <Btn variant="ghost" onClick={() => {
                  unbindWidgetInstance(inst.id);
                  setMap(loadWidgetInstances());
                  void pushNow();
                }}>{i18n("components.widgetsettingssection.ba2e93e73037")}</Btn>
            ) : null}
          </div>
        </div>
      ))}
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-title">{i18n("components.widgetsettingssection.e4f9bcd60944")}</div>
          <div className="setting-desc">{i18nRich("components.widgetsettingssection.2a85a7e5a3ad", { value: bindingSummary(map.fallback, favs.data) })}<span style={{ color: "var(--text-3)" }}>{i18n("components.widgetsettingssection.b85432068f08")}</span>
          </div>
        </div>
        <div className="widget-settings-actions">
          {(["today", "shortcut"] as const).map((k) => (
            <Btn
              key={k}
              variant={map.fallback.kind === k ? "solid" : "ghost"}
              onClick={() => {
                if (k === "today") {
                  setWidgetFallback({ kind: "today" });
                  setMap(loadWidgetInstances());
                  void pushNow();
                } else {
                  setFallbackPicker(true);
                }
              }}
            >
              {k === "today" ? i18n("components.widgetsettingssection.17a0e39c6089") : i18n("components.widgetsettingssection.b016c8cdb0fd")}
            </Btn>
          ))}
        </div>
      </div>

      {msg ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-3)", padding: "6px 2px" }}>{msg}</div> : null}

      {fallbackPicker ? (
        <FavAtomPicker
          title={i18n("components.widgetsettingssection.770e44c4c483")}
          hint={i18n("components.widgetsettingssection.d1eb26fb94e9")}
          onPick={(atom) => {
            setFallbackPicker(false);
            setWidgetFallback({ kind: "shortcut", atom });
            setMap(loadWidgetInstances());
            void pushNow();
          }}
          onClose={() => setFallbackPicker(false)}
        />
      ) : null}
    </section>
  );
}
