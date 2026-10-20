import { t as i18n, rich as i18nRich, msg as i18nMsg, useLocale as useUiLocale } from "../i18n/index.js";
import { Btn } from "@onethu/gui";
/**
 * 小组件绑定层：把「这块小组件显示什么」这件事一次问清。
 *
 * 两个方向共用一个界面：
 *   ① 从实例出发（桌面点未绑定的那块 / 设置页点「换内容」）→ 先问内容（四选一）；
 *   ② 从内容出发（收藏夹页「上桌面」、收藏项长卡「桌」）→ 先问放到哪一块。
 *
 * 为什么必须支持②：桌面上放几块、放多大是用户在自己桌面上决定的，应用无法替他添加
 * 小组件；所以「把收藏夹放上桌面」的落地方式是绑定到某一块已存在的实例上。
 *
 * 界面沿用既有弹层与收藏搜索层；内容候选与清单另用一套卡片样式（wb-*）：这里的选择
 * 不是「浏览一长串搜索结果」，用列表行会把两行字挤成一条灰杠，四类用法反而看不出来。
 */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useExitPhase } from "../lib/useExitPhase.js";
import { FavAtomPicker } from "./FavAtomPicker.js";
import { IconCard, IconFile, IconFolder, IconToday } from "./Icons.js";
import { useFavs } from "../state/favs.js";
import { resolveAtom } from "../state/atoms.js";
import { showToast } from "../state/toast.js";
import { fetchWidgetInstances } from "../state/widgetBridge.js";
import { ensureWidgetRuntime } from "../state/notifySources.js";
import type { WidgetInstanceInfo } from "../state/widgetRuntime.js";
import {
  bindWidgetInstance, describeBinding, loadWidgetInstances, unbindWidgetInstance, type WidgetBinding,
} from "../state/widgetInstances.js";
import { clearWidgetBind, useWidgetBindRequest } from "../state/widgetBindUi.js";
import { useNotifyBackend } from "./useNotifyBackend.js";

/** provider 类名 → 形态标签（原生报回类名，这里给用户看得懂的名字） */
const SHAPES: Record<string, string> = {
  OnethuWidgetShape1Shortcut: "1×1 快捷方式",
  OnethuWidgetShape2Narrow: "2×1 窄条",
  OnethuWidgetShape3Square: "2×2 方块",
  OnethuWidgetShape4Standard: "3×2 标准",
  OnethuWidgetShape5Strip: "4×1 长条",
};

export function shapeLabel(inst: WidgetInstanceInfo): string {
  return SHAPES[inst.provider ?? ""] ?? `${inst.w}×${inst.h}dp`;
}

/** 收藏夹里的收藏项数（子收藏夹不算：图标组里只有收藏项有图标可画） */
function atomsIn(folder: { items: Array<{ t: string }> }): number {
  return folder.items.filter((it) => it.t === "a").length;
}

/** 内容摘要（实例清单与设置页共用） */
export function bindingSummary(binding: WidgetBinding, favs: { folders: Record<string, { title: string }> }): string {
  const names = {
    folder: binding.kind === "folder" ? favs.folders[binding.folderId]?.title : undefined,
    atom: binding.kind === "detail" || binding.kind === "shortcut"
      ? (resolveAtom(binding.atom)?.title ?? i18n("components.widgetbindmodal.73795817b5de"))
      : undefined,
  };
  return describeBinding(binding, names);
}

/** 四类内容的说明（选择界面文案与设置页共用一份口径） */
export const CONTENT_KINDS: Array<{
  kind: "today" | "detail" | "folder" | "shortcut";
  label: string;
  desc: string;
  icon: typeof IconToday;
}> = [
  { kind: "today", get label() { return i18n("components.widgetbindmodal.17a0e39c6089"); }, get desc() { return i18n("components.widgetbindmodal.c8c9de54712b"); }, icon: IconToday },
  { kind: "detail", get label() { return i18n("components.widgetbindmodal.567db422036f"); }, get desc() { return i18n("components.widgetbindmodal.4b0011fadb3e"); }, icon: IconFile },
  { kind: "folder", get label() { return i18n("components.widgetbindmodal.28cea6fbdb23"); }, get desc() { return i18n("components.widgetbindmodal.5d4640f1dbd2"); }, icon: IconFolder },
  { kind: "shortcut", get label() { return i18n("components.widgetbindmodal.6ab335864461"); }, get desc() { return i18n("components.widgetbindmodal.e8748ab06b1a"); }, icon: IconCard },
];

export function WidgetBindModal(): ReactNode {
  const uiLocale = useUiLocale();

  const [closing, requestClose] = useExitPhase(() => close());
  const req = useWidgetBindRequest();
  const favs = useFavs();
  const backend = useNotifyBackend();
  const [instances, setInstances] = useState<WidgetInstanceInfo[] | null>(null);
  /** 读取失败与「一块都没有」是两回事，不能都说成「正在读取」 */
  const [readFailed, setReadFailed] = useState(false);
  const [picker, setPicker] = useState<null | "detail" | "shortcut">(null);
  /** 收藏夹图标组：先选哪个收藏夹（可能有很多个） */
  const [folderPick, setFolderPick] = useState(false);
  /* 夹选择是模态内的二级视图：它自己的关闭（遮罩/返回）也走退场，不然遮罩先消失、面板还在动 */
  const [pickClosing, requestPickClose] = useExitPhase(() => setFolderPick(false), folderPick);

  useEffect(() => {
    if (!req) return;
    let alive = true;
    void (async () => {
      const list = await fetchWidgetInstances();
      if (!alive) return;
      setReadFailed(list === null);
      setInstances(list ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [req]);

  if (!req || backend !== "android") return null;

  const done = (msg: string): void => {
    showToast(msg);
    clearWidgetBind();
    setPicker(null);
    setFolderPick(false);
  };

  const bind = (id: number | string, binding: WidgetBinding): void => {
    bindWidgetInstance(id, binding);
    // 用户此刻正看着桌面：立刻重推一次，别等订阅链上的防抖。
    // 再补一次：放置流程里系统可能还没把这块登记进 AppWidgetManager（配置活动刚返回），
    // 第一次推送里没有它，补推这一次才不会让用户看到「绑好了但桌面还是占位」。
    void (async () => {
      const rt = await ensureWidgetRuntime();
      await rt.syncNow();
      await new Promise((r) => setTimeout(r, 2500));
      await rt.syncNow();
    })();
    done(i18n("components.widgetbindmodal.40db44fd1071", { value: String(bindingSummary(binding, favs.data)) }));
  };

  const close = (): void => {
    clearWidgetBind();
    setPicker(null);
    setFolderPick(false);
  };

  /* 从内容出发：先选放到哪一块 */
  if (req.to === "pick") {
    const binding = req.binding;
    return createPortal(
      <div className={"home-modal-mask" + (closing ? " is-closing" : "")} onClick={requestClose}>
        <div className={"home-modal" + (closing ? " is-closing" : "")} role="dialog" aria-modal="true" aria-label={i18n("components.widgetbindmodal.aa715722613a")} onClick={(e) => e.stopPropagation()}>
          <div className="home-modal-head">
            <h3>{i18n("components.widgetbindmodal.accde02d15d4")}</h3>
            <Btn variant="ghost" onClick={requestClose}>{i18n("components.widgetbindmodal.3fd47edce45b")}</Btn>
          </div>
          <div className="home-modal-body">
            <div className="wb-current">{i18nRich("components.widgetbindmodal.ea9677c3d21f", { value: bindingSummary(binding, favs.data) })}<br />{i18n("components.widgetbindmodal.7edf6b8c5da0")}</div>
            {readFailed ? (
              <div className="home-modal-hint">{i18n("components.widgetbindmodal.203497c15f75")}</div>
            ) : null}
            {instances === null && !readFailed ? <div className="home-modal-hint">{i18n("components.widgetbindmodal.2a5e99245dd8")}</div> : null}
            {instances?.length === 0 ? (
              <div className="home-modal-hint">{i18n("components.widgetbindmodal.57ba46d6a1b3")}</div>
            ) : null}
            <div className="wb-list">
              {(instances ?? []).map((inst) => (
                <button key={inst.id} className="wb-row" onClick={() => bind(inst.id, binding)}>
                  <span className="wb-kind-icon"><IconCard width={17} height={17} /></span>
                  <div className="wb-row-main">
                    <div className="wb-row-name">{shapeLabel(inst)}</div>
                    <div className="wb-row-sub">{i18nRich("components.widgetbindmodal.5ae60d0c946d", { value: bindingSummary(loadWidgetInstances().byId[String(inst.id)] ?? { kind: "today" }, favs.data) })}</div>
                  </div>
                  <span className="wb-row-shape">{i18n("components.widgetbindmodal.378759fdd1e8")}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  /* 从实例出发：先选内容 */
  const id = req.id;
  const cur = loadWidgetInstances().byId[id] ?? { kind: "today" as const };
  return createPortal(
    <div className={"home-modal-mask" + (closing ? " is-closing" : "")} onClick={requestClose}>
      <div className={"home-modal" + (closing ? " is-closing" : "")} role="dialog" aria-modal="true" aria-label={i18n("components.widgetbindmodal.fce3bfe1b135")} onClick={(e) => e.stopPropagation()}>
        <div className="home-modal-head">
          <h3>{i18n("components.widgetbindmodal.5aaf3005e398")}</h3>
          <Btn variant="ghost" onClick={requestClose}>{i18n("components.widgetbindmodal.3fd47edce45b")}</Btn>
        </div>
        <div className="home-modal-body">
          <div className="wb-current">{i18nRich("components.widgetbindmodal.1d0050cf33ef", { value: bindingSummary(cur, favs.data) })}<br />{i18n("components.widgetbindmodal.ff6541441f00")}</div>
          <div className="wb-kinds">
            {CONTENT_KINDS.map((k) => {
              const Icon = k.icon;
              const active = cur.kind === k.kind;
              return (
                <button
                  key={k.kind}
                  className={"wb-kind" + (active ? " is-active" : "")}
                  onClick={() => {
                    if (k.kind === "today") bind(id, { kind: "today" });
                    else if (k.kind === "folder") {
                      if (Object.keys(favs.data.folders).length === 0) {
                        showToast(i18nMsg("components.widgetbindmodal.6ae61cd0b12a"));
                        return;
                      }
                      setFolderPick(true);
                    } else setPicker(k.kind);
                  }}
                >
                  <span className="wb-kind-icon"><Icon width={17} height={17} /></span>
                  <span className="wb-kind-name">{k.label}</span>
                  <span className="wb-kind-desc">{k.desc}</span>
                </button>
              );
            })}
          </div>

          {cur.kind !== "today" ? (
            <Btn variant="ghost" onClick={() => {
                unbindWidgetInstance(id);
                done(i18n("components.widgetbindmodal.0b38085b73e4"));
              }}>{i18n("components.widgetbindmodal.76d1caab2105")}</Btn>
          ) : null}
        </div>
      </div>

      {folderPick ? (
        <div className={"home-modal-mask" + (pickClosing ? " is-closing" : "")} onClick={requestPickClose}>
          <div className={"home-modal" + (pickClosing ? " is-closing" : "")} role="dialog" aria-modal="true" aria-label={i18n("components.widgetbindmodal.cb2c998643fd")} onClick={(e) => e.stopPropagation()}>
            <div className="home-modal-head">
              <h3>{i18n("components.widgetbindmodal.cb2c998643fd")}</h3>
              <Btn variant="ghost" onClick={requestPickClose}>{i18n("components.widgetbindmodal.572cf45ba436")}</Btn>
            </div>
            <div className="home-modal-body">
              <div className="home-modal-hint">{i18n("components.widgetbindmodal.0d59f4339593")}</div>
              <div className="wb-list">
                {Object.values(favs.data.folders).map((f) => (
                  <button key={f.id} className="wb-row" onClick={() => bind(id, { kind: "folder", folderId: f.id })}>
                    <span className="wb-kind-icon"><IconFolder width={17} height={17} /></span>
                    <div className="wb-row-main">
                      <div className="wb-row-name">{f.title}</div>
                      <div className="wb-row-sub">{i18nRich("components.widgetbindmodal.14b34146dee0", { length: f.items.filter((it) => it.t === "a").length })}</div>
                    </div>
                    <span className="wb-row-shape">{i18nRich("components.widgetbindmodal.86a6223fda86", { value: atomsIn(f) })}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {picker ? (
        <FavAtomPicker
          title={picker === "shortcut" ? i18n("components.widgetbindmodal.96b17d4fdea5") : i18n("components.widgetbindmodal.e177d59e40d1")}
          hint={picker === "shortcut" ? i18n("components.widgetbindmodal.7aba37c0e712") : i18n("components.widgetbindmodal.bf955b4b0454")}
          onPick={(atom) => bind(id, { kind: picker, atom })}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </div>,
    document.body,
  );
}
