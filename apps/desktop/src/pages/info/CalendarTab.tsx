import { t as i18n, rich as i18nRich, useLocale as useUiLocale } from "../../i18n/index.js";
import { Btn } from "@onethu/gui";
import { Select } from "@onethu/gui";
/**
 * 校历 —— info.getCalendarImageUrl（thu-info-app schoolCalendar.tsx 移植，图片版）。
 * 学年/学期/语言选择 + 图片缩放 +「在浏览器打开原图」（openExternal）。
 * 图片地址为纯拼接（app.cs 公网直连），不抛会话错误；加载失败给友好空态。
 */
import { useCallback, useEffect, useState } from "react";
import { Card, SectionHead } from "../../components/Layout.js";
import { info } from "../../lib/clients.js";
import { useApp } from "../../state/context.js";
import { openExternal } from "./openExternal.js";
import { TabEmpty, isServiceUnavailable, logTabErr, tabErrorText, TabError } from "./tabStates.js";

type Sem = "autumn" | "spring";
type Lang = "zh" | "en";

/** 当前学年（秋季学期起始年份）：7 月起算新学年 */
function currentAcademicYear(): number {
  const now = new Date();
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

export function CalendarTab() {
  const uiLocale = useUiLocale();

  const { status } = useApp();
  const [year, setYear] = useState<number>(currentAcademicYear);
  const [sem, setSem] = useState<Sem>(currentAcademicYear() === new Date().getFullYear() ? "autumn" : "spring");
  const [lang, setLang] = useState<Lang>("zh");
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);
  const [zoom, setZoom] = useState(1);

  const load = useCallback(async () => {
    if (status !== "ready") return;
    setState("loading");
    setUnavailable(false);
    setError(null);
    setImgError(false);
    try {
      // 纯 URL 拼接（不发请求、不依赖会话）；同步返回，包一层以对齐三态
      setSrc(info.getCalendarImageUrl(year, sem, lang));
      setState("ready");
    } catch (err) {
      logTabErr("CALENDAR", err);
      setUnavailable(isServiceUnavailable(err));
      setError(tabErrorText(err));
      setState("error");
    }
  }, [status, year, sem, lang]);

  useEffect(() => {
    void load();
  }, [load]);

  const years = Array.from({ length: 5 }, (_, i) => currentAcademicYear() - i);

  return (
    <>
      <SectionHead title={i18n("pages.info.calendartab.4792ab1440aa")} aside={i18n("pages.info.calendartab.c8c898785e39")} />
      {state === "error" ? (
        <TabError unavailable={unavailable} text={error} onRetry={() => void load()} />
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <Select value={year} onChange={(value) => setYear(Number(value))} aria-label={i18n("pages.info.calendartab.61fd2cb63d18")}>{years.map((y) => (
            <option key={y} value={y}>{i18nRich("pages.info.calendartab.a5e2d45b705a", { y: y, value: y + 1 })}</option>
          ))}</Select>
        <Select value={sem} onChange={(value) => setSem(value as Sem)} aria-label={i18n("pages.info.calendartab.79a4ef019e9c")}><option value="autumn">{i18n("pages.info.calendartab.c81b126c4f9f")}</option><option value="spring">{i18n("pages.info.calendartab.32618426e9ce")}</option></Select>
        <Select value={lang} onChange={(value) => setLang(value as Lang)} aria-label={i18n("pages.info.calendartab.9f6fee1aba17")}><option value="zh">{i18n("pages.info.calendartab.72726d8818f6")}</option><option value="en">English</option></Select>
        {src ? (
          <Btn variant="ghost" onClick={() => void openExternal(src)}>{i18n("pages.info.calendartab.af02486a8a9f")}</Btn>
        ) : null}
      </div>

      {src && !imgError ? (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <Btn variant="ghost" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} disabled={zoom <= 0.5}>−
            </Btn>
            <span style={{ fontSize: 13, color: "var(--text-2)" }}>{Math.round(zoom * 100)}%</span>
            <Btn variant="ghost" onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))} disabled={zoom >= 4}>+
            </Btn>
            <Btn variant="ghost" onClick={() => setZoom(1)}>{i18n("pages.info.calendartab.cb5d682bac3d")}</Btn>
          </div>
          <Card style={{ overflow: "auto", padding: 12 }}>
            <img
              src={src}
              alt={i18n("pages.info.calendartab.36a24c379edf", { year: String(year), value: String(year + 1), value2: String(sem === "autumn" ? i18n("pages.info.calendartab.5a2e5e4b12a4") : i18n("pages.info.calendartab.b3c33b7abaf0")) })}
              onError={() => setImgError(true)}
              style={{ width: `${Math.round(zoom * 100)}%`, maxWidth: zoom === 1 ? "100%" : "none", display: "block", borderRadius: 8 }}
            />
          </Card>
        </>
      ) : state === "ready" ? (
        <TabEmpty text={i18n("pages.info.calendartab.46005af48348")} />
      ) : null}
    </>
  );
}
