/**
 * 「搜索与胶囊」设置分节（dev-explorer，explorer-oh 专属；Lead 负责挂进设置页）：
 *  - 点击胶囊默认打开：搜索 / OH（explorerPrefs.capsuleTap）
 *  - 长按语音松手后：直发 OH / 开搜索预填（explorerPrefs.voiceTarget）
 *  - 最近搜索记录：条数展示 + 两次点击确认清空
 * 行式骨架与 .setting-row 一族对齐（不改 Settings.tsx，样式全在 explorer-oh.css）。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SectionHead } from "./Layout.js";
import {
  useExplorerPrefs, setExplorerPrefs, useSearchHistory, clearSearchHistory,
  type CapsuleDefault,
} from "../state/explorerPrefs.js";

/** 二选一分段（搜索 | OH）：即点即存，无确认步骤 */
function PrefSeg({ value, onChange }: { value: CapsuleDefault; onChange: (v: CapsuleDefault) => void }): ReactNode {
  return (
    <span className="ohx-prefseg" role="radiogroup">
      {([
        { v: "search" as const, label: "搜索" },
        { v: "oh" as const, label: "OH" },
      ]).map((o) => (
        <button
          key={o.v}
          role="radio"
          aria-checked={value === o.v}
          className={"ohx-prefseg-btn" + (value === o.v ? " is-active" : "")}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

export function ExplorerPrefsSection(): ReactNode {
  const prefs = useExplorerPrefs();
  const hist = useSearchHistory();
  const [arming, setArming] = useState(false);
  const armTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (armTimer.current) window.clearTimeout(armTimer.current);
  }, []);

  const onClear = (): void => {
    if (!arming) {
      setArming(true);
      if (armTimer.current) window.clearTimeout(armTimer.current);
      armTimer.current = window.setTimeout(() => setArming(false), 2600); // 超时反悔回落
      return;
    }
    if (armTimer.current) window.clearTimeout(armTimer.current);
    setArming(false);
    clearSearchHistory();
  };

  return (
    <section className="ohx-prefsec">
      <SectionHead title="搜索与胶囊" aside="底栏胶囊与悬浮球的二合一入口" />
      <div className="setting-row">
        <div>
          <div className="setting-title">点击胶囊默认打开</div>
          <div className="setting-desc">搜索模式可搜功能/作业/文件并直达；OH 模式直接进对话</div>
        </div>
        <PrefSeg value={prefs.capsuleTap} onChange={(v) => setExplorerPrefs({ capsuleTap: v })} />
      </div>
      <div className="setting-row">
        <div>
          <div className="setting-title">长按语音松手后</div>
          <div className="setting-desc">直发 OH＝识别文本作为消息发出；开搜索＝把文本填进搜索框让你挑</div>
        </div>
        <PrefSeg value={prefs.voiceTarget} onChange={(v) => setExplorerPrefs({ voiceTarget: v })} />
      </div>
      <div className="setting-row">
        <div>
          <div className="setting-title">最近搜索记录</div>
          <div className="setting-desc">{hist.length > 0 ? `保留最近 10 条，当前 ${hist.length} 条` : "暂无记录"}</div>
        </div>
        <button
          className={"btn btn-ghost ohx-clear" + (arming ? " is-arming" : "")}
          onClick={onClear}
          disabled={hist.length === 0}
        >
          {arming ? "再点一次确认清空" : "清空记录"}
        </button>
      </div>
    </section>
  );
}
