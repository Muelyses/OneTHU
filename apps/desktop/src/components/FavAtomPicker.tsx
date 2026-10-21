import { labelForId } from "../i18n/staticLabels.js";
import { t as i18n, rich as i18nRich, useLocale as useUiLocale } from "../i18n/index.js";
import { Btn } from "@onethu/gui";
/**
 * 「选一个收藏项」的选择层：**先给收藏夹里的收藏项，再给搜索**。
 *
 * 为什么要重做应用原有的收藏项搜索层：那个搜索靠「本机见过的实体缓存」（各页面加载后
 * noteAtomCache 写进去的），于是大量已经收藏进收藏夹的收藏项搜不到——用户被告知「先去对应
 * 页面打开一次」，打开完还是搜不到（有些实体页当时并不写缓存）。这是本末倒置：
 * 收藏夹里明明躺着的东西，凭什么要用户再去搜一遍。
 *
 * 所以这一层的顺序是：收藏夹里的收藏项（直接可点，按收藏夹分组）→ 关键词过滤（收藏优先，
 * 再补全局搜索的命中）。搜得到搜不到都不影响「已经收藏的收藏项一定能选」。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useExitPhase } from "../lib/useExitPhase.js";
import { IconSearch, IconStar } from "./Icons.js";
import { useFavs } from "../state/favs.js";
import { resolveAtom } from "../state/atoms.js";
import { searchAtoms } from "../state/atoms.js";
import type { AtomRef } from "../state/favorites.js";

interface Hit {
  ref: AtomRef;
  title: string;
  sub?: string;
  /** 右侧灰字：来源（收藏夹名 / 收藏项分组） */
  from: string;
  /** 是否在收藏夹里 */
  fav: boolean;
  icon: (p: { width?: number; height?: number; className?: string }) => ReactNode;
}

export function FavAtomPicker({ title, hint, onPick, onClose }: {
  title: string;
  hint?: string;
  onPick: (atom: AtomRef) => void;
  onClose: () => void;
}) {
  const uiLocale = useUiLocale();

  const favs = useFavs();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** 收藏夹里的收藏项（按收藏夹顺序，去重：同一个收藏项可能在多个夹里） */
  const favHits = useMemo<Hit[]>(() => {
    const out: Hit[] = [];
    const seen = new Set<string>();
    for (const folder of Object.values(favs.data.folders)) {
      for (const item of folder.items) {
        if (item.t !== "a") continue;
        const key = `${item.atom.kind}:${item.atom.key}`;
        if (seen.has(key)) continue;
        const view = resolveAtom(item.atom);
        if (!view) continue;
        seen.add(key);
        out.push({ ref: item.atom, title: view.title, sub: view.sub, from: folder.title, fav: true, icon: view.icon });
      }
    }
    return out;
  }, [uiLocale, favs.data]);

  const results = useMemo<Hit[]>(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return favHits;
    const inFav = favHits.filter((h) => h.title.toLowerCase().includes(needle));
    const seen = new Set(inFav.map((h) => `${h.ref.kind}:${h.ref.key}`));
    const extra: Hit[] = searchAtoms(q)
      .filter((h) => !seen.has(`${h.kind}:${h.key}`))
      .slice(0, 30)
      .map((h) => ({ ref: { kind: h.kind, key: h.key }, title: h.title, sub: h.sub, from: labelForId(h.group), fav: false, icon: h.icon }));
    return [...inFav, ...extra];
  }, [uiLocale, q, favHits]);

  const [closing, requestClose] = useExitPhase(onClose);

  return createPortal(
    <div className={"home-modal-mask" + (closing ? " is-closing" : "")} onClick={requestClose}>
      <div className={"home-modal collect-modal" + (closing ? " is-closing" : "")} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="home-modal-head">
          <h3>{title}</h3>
          <Btn variant="ghost" onClick={requestClose}>{i18n("components.favatompicker.3fd47edce45b")}</Btn>
        </div>
        <div className="home-modal-body">
          <div className="collect-search">
            <IconSearch width={15} height={15} />
            <input
              ref={inputRef}
              className="input"
              placeholder={q.trim() ? i18n("components.favatompicker.bf61819dfd14") : i18n("components.favatompicker.92d8c06afc63", { length: String(favHits.length) })}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {q.trim() === "" ? (
            <div className="home-modal-hint">{i18nRich("components.favatompicker.d535b6d96f8e", { value: hint ? <>{hint}<br /></> : null })}</div>
          ) : null}

          {results.length === 0 ? (
            <div className="home-modal-hint">
              {q.trim()
                ? i18n("components.favatompicker.85a9b873ace1")
                : i18n("components.favatompicker.d5f2b81a7e6d")}
            </div>
          ) : (
            <div className="wb-list">
              {results.map((h) => {
                const Icon = h.icon;
                return (
                  <button
                    key={`${h.ref.kind}:${h.ref.key}`}
                    className="wb-row"
                    onClick={() => onPick(h.ref)}
                  >
                    <span className="wb-kind-icon"><Icon width={17} height={17} /></span>
                    <div className="wb-row-main">
                      <div className="wb-row-name">{h.title}</div>
                      {h.sub ? <div className="wb-row-sub">{h.sub}</div> : null}
                    </div>
                    <span className="wb-row-shape">
                      {h.fav ? <><IconStar width={11} height={11} /> {h.from}</> : h.from}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
