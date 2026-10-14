/**
 * 「搜索与胶囊」设置分节（dev-explorer，explorer-oh 专属）：
 *  - 点击胶囊默认打开：搜索 / OH（explorerPrefs.capsuleTap）
 *  - 最近搜索记录：条数展示 + 两次点击确认清空（超时反悔回落，原 UX 保留）
 *
 * 2026-10-14 换血：骨架改为 OneGUI（SettingsList / SettingsRow / Segment / Btn），
 * 不再写 .setting-row / .ohx-prefseg / .btn 这些页面私有类；行为与文案一字未改。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Btn, Section, Segment, SettingsList, SettingsRow } from "@onethu/gui";
import {
  useExplorerPrefs, setExplorerPrefs, useSearchHistory, clearSearchHistory,
  type CapsuleDefault,
} from "../state/explorerPrefs.js";

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
    <>
      <Section title="搜索与胶囊" hint="底栏胶囊与悬浮球的二合一入口" />
      <SettingsList>
        <SettingsRow
          title="点击胶囊默认打开"
          sub="搜索模式可搜功能/作业/文件并直达；OH 模式直接进对话"
          control={
            <Segment
              value={prefs.capsuleTap}
              onChange={(v) => setExplorerPrefs({ capsuleTap: v as CapsuleDefault })}
              options={[{ value: "search", label: "搜索" }, { value: "oh", label: "OH" }]}
            />
          }
        />
        {/* voiceTarget 已废弃（用户定案）：胶囊/语音只产生文字，送谁由小窗内的搜索|OH 切换决定 */}
        <SettingsRow
          title="最近搜索记录"
          sub={hist.length > 0 ? `保留最近 10 条，当前 ${hist.length} 条` : "暂无记录"}
          control={
            <Btn variant="ghost" size="sm" disabled={hist.length === 0} onClick={onClear}>
              {arming ? "再点一次确认清空" : "清空记录"}
            </Btn>
          }
        />
      </SettingsList>
    </>
  );
}
