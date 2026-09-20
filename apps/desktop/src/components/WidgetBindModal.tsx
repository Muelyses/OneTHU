/**
 * 小组件绑定层：把「这块小组件显示什么」这件事一次问清。
 *
 * 两个方向共用一个界面：
 *   ① 从实例出发（桌面点未绑定的那块 / 设置页点「换内容」）→ 先问内容（四选一）；
 *   ② 从内容出发（收藏夹页「上桌面」、原子长卡「桌」）→ 先问放到哪一块。
 *
 * 为什么必须支持②：桌面上放几块、放多大是用户在自己桌面上决定的，应用无法替他添加
 * 小组件；所以「把收藏夹放上桌面」的落地方式是绑定到某一块已存在的实例上。
 *
 * 界面风格沿用应用既有的弹层（home-modal-mask / home-modal）与收藏搜索层，不再新造一套。
 */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AtomPickerModal } from "./Collect.js";
import { useFavs } from "../state/favs.js";
import { resolveAtom } from "../state/atoms.js";
import { showToast } from "../state/toast.js";
import { fetchWidgetInstances } from "../state/widgetBridge.js";
import type { WidgetInstanceInfo } from "../state/widgetRuntime.js";
import {
  bindWidgetInstance, describeBinding, loadWidgetInstances, unbindWidgetInstance, type WidgetBinding,
} from "../state/widgetInstances.js";
import { clearWidgetBind, useWidgetBindRequest } from "../state/widgetBindUi.js";
import { useNotifyBackend } from "./useNotifyBackend.js";

/** provider 类名 → 形态标签（原生报回类名，这里给用户看得懂的名字） */
const SHAPES: Record<string, string> = {
  OnethuWidgetShortcut: "1×1 快捷方式",
  OnethuWidgetNarrow: "2×1 窄条",
  OnethuWidgetSquare: "2×2 方块",
  OnethuWidgetProvider: "3×2 标准",
  OnethuWidgetStrip: "4×1 长条",
};

export function shapeLabel(inst: WidgetInstanceInfo): string {
  return SHAPES[inst.provider ?? ""] ?? `${inst.w}×${inst.h}dp`;
}

/** 内容摘要（实例清单与设置页共用） */
export function bindingSummary(binding: WidgetBinding, favs: { folders: Record<string, { title: string }> }): string {
  const names = {
    folder: binding.kind === "folder" ? favs.folders[binding.folderId]?.title : undefined,
    atom: binding.kind === "detail" || binding.kind === "shortcut"
      ? (resolveAtom(binding.atom)?.title ?? "（已失效）")
      : undefined,
  };
  return describeBinding(binding, names);
}

/** 四类内容的说明（选择界面文案与设置页共用一份口径） */
export const CONTENT_KINDS: Array<{ kind: "today" | "detail" | "folder" | "shortcut"; label: string; desc: string }> = [
  { kind: "today", label: "日程与 DDL", desc: "今天的课、考试与作业截止（最常用的一块）" },
  { kind: "detail", label: "一个原子占满", desc: "课程、作业、洗衣机…显示它的详情，拉得越高行数越多" },
  { kind: "folder", label: "收藏夹图标组", desc: "把某个收藏夹嵌到桌面：若干原子图标并列，各自可点" },
  { kind: "shortcut", label: "快捷方式", desc: "一个功能页或原子的图标快捷方式（1×1 起）" },
];

export function WidgetBindModal(): ReactNode {
  const req = useWidgetBindRequest();
  const favs = useFavs();
  const backend = useNotifyBackend();
  const [instances, setInstances] = useState<WidgetInstanceInfo[] | null>(null);
  const [picker, setPicker] = useState<null | "detail" | "shortcut">(null);
  /** 收藏夹图标组：先选哪个收藏夹（可能有很多个） */
  const [folderPick, setFolderPick] = useState(false);

  useEffect(() => {
    if (!req) return;
    let alive = true;
    void (async () => {
      const list = await fetchWidgetInstances();
      if (alive) setInstances(list ?? []);
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
    done(`已绑定：${bindingSummary(binding, favs.data)}`);
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
      <div className="home-modal-mask" onClick={close}>
        <div className="home-modal" role="dialog" aria-modal="true" aria-label="放到哪一块小组件" onClick={(e) => e.stopPropagation()}>
          <div className="home-modal-head">
            <h3>放到哪一块小组件？</h3>
            <button className="btn btn-ghost" onClick={close}>关闭</button>
          </div>
          <div className="home-modal-body">
            <div className="home-modal-hint">
              要显示「{bindingSummary(binding, favs.data)}」。桌面上放了几块就列几块——应用不能替你往桌面添加小组件，
              需要更多块就先去桌面长按加一块。
            </div>
            {instances === null ? <div className="home-modal-hint">正在读取桌面上的小组件…</div> : null}
            {instances?.length === 0 ? (
              <div className="home-modal-hint">
                桌面上还没有 OneTHU 小组件。长按桌面 → 小组件 → 选「OneTHU」，放好一块再回来。
              </div>
            ) : null}
            {(instances ?? []).map((inst) => (
              <button key={inst.id} className="btn" style={{ width: "100%", marginBottom: 8 }} onClick={() => bind(inst.id, binding)}>
                {shapeLabel(inst)}
                <span style={{ color: "var(--text-3)", marginLeft: 8 }}>
                  {bindingSummary(loadWidgetInstances().byId[String(inst.id)] ?? { kind: "today" }, favs.data)}
                </span>
              </button>
            ))}
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
    <div className="home-modal-mask" onClick={close}>
      <div className="home-modal" role="dialog" aria-modal="true" aria-label="这块小组件显示什么" onClick={(e) => e.stopPropagation()}>
        <div className="home-modal-head">
          <h3>这块小组件显示什么？</h3>
          <button className="btn btn-ghost" onClick={close}>关闭</button>
        </div>
        <div className="home-modal-body">
          <div className="home-modal-hint">
            当前：{bindingSummary(cur, favs.data)}。桌面上可以同时放多块，各显示各的。
          </div>
          {CONTENT_KINDS.map((k) => (
            <button
              key={k.kind}
              className="btn"
              style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 8 }}
              onClick={() => {
                if (k.kind === "today") bind(id, { kind: "today" });
                else if (k.kind === "folder") {
                  if (Object.keys(favs.data.folders).length === 0) {
                    showToast("还没有收藏夹：先在收藏夹页建一个再放上桌面");
                    return;
                  }
                  setFolderPick(true);
                } else setPicker(k.kind);
              }}
            >
              <strong>{k.label}</strong>
              <span style={{ display: "block", color: "var(--text-3)", fontSize: "var(--text-xs)" }}>{k.desc}</span>
            </button>
          ))}

          {cur.kind !== "today" ? (
            <button
              className="btn btn-ghost"
              onClick={() => {
                unbindWidgetInstance(id);
                done("已恢复为「日程与 DDL」");
              }}
            >
              恢复默认（日程与 DDL）
            </button>
          ) : null}
        </div>
      </div>

      {folderPick ? (
        <div className="home-modal-mask" onClick={() => setFolderPick(false)}>
          <div className="home-modal" role="dialog" aria-modal="true" aria-label="选一个收藏夹" onClick={(e) => e.stopPropagation()}>
            <div className="home-modal-head">
              <h3>选一个收藏夹</h3>
              <button className="btn btn-ghost" onClick={() => setFolderPick(false)}>返回</button>
            </div>
            <div className="home-modal-body">
              <div className="home-modal-hint">夹里的原子会以图标并列显示在这块小组件上（放不下的自动略过）。</div>
              {Object.values(favs.data.folders).map((f) => (
                <button key={f.id} className="btn" style={{ width: "100%", marginBottom: 8 }} onClick={() => bind(id, { kind: "folder", folderId: f.id })}>
                  {f.title}
                  <span style={{ color: "var(--text-3)", marginLeft: 8 }}>{f.items.filter((it) => it.t === "a").length} 个原子</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {picker ? (
        <AtomPickerModal
          title={picker === "shortcut" ? "选一个原子做快捷方式" : "选一个原子显示详情"}
          hint={picker === "shortcut" ? "图标 + 名称，放成 1×1 就像桌面快捷方式。" : "这块小组件会被它占满：拉得越高，显示的行数越多。"}
          onPick={(atom) => bind(id, { kind: picker, atom })}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </div>,
    document.body,
  );
}
