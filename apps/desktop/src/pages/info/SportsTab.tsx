import { t as i18n, rich as i18nRich, useLocale as useUiLocale } from "../../i18n/index.js";
import { Btn } from "@onethu/gui";
import { Input } from "@onethu/gui";
/**
 * 体育场馆预约 —— SportsTab（thu-info-app sports 系列（sportsDetail/sportsRecord）移植）。
 * 两段式只读 + 预约：
 * ① 场馆 chips + 日期（默认今天）→ 时段 × 场地状态表（绿=可约，点击选中）；
 * ② 底部预约卡：手机号（core 返回预填，可「保存到体育系统」）→ 预约按钮 →
 *    验证码面板（图可点刷新 + 输入框 + 提交，交互复用 NetworkTab usereg 面板；
 *    验证码图由 core 携会话拉 PNG 转 base64，webview 直挂 URL 只会得到登录页）；
 * ③ 我的预约记录列表（含退订，退订需 confirm 确认）。
 * 支付流不接（免费场景 skipPayment=true，返回的支付码弃用），记录只展示状态；
 * 线上支付/稍后支付（paySportsReservation）暂不入口。
 *
 * 错误铁律：ServiceUnavailable → 「体育预约暂不可用，请在「清华体育」App 中预约」
 * 静态提示 + 重试；空记录 → 「暂无预约记录」；绝不自动整页刷新、绝不失登自愈。
 */
import { confirmOk } from "../../lib/confirm.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { sportsIdInfoList, type SportsIdInfo } from "@onethu/core";
import { Card, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { info } from "../../lib/clients.js";
import { useApp } from "../../state/context.js";
import { TabEmpty, isServiceUnavailable, logTabErr, tabErrorText } from "./tabStates.js";

type LoadState = "idle" | "loading" | "error" | "ready";
/** core getSportsResources → { count, init, phone, data }（lib SportsResourcesInfo 同源） */
type SportsResourcesInfoT = Awaited<ReturnType<typeof info.getSportsResources>>;
type SportsResourceT = SportsResourcesInfoT["data"][number];
type SportsRecordT = Awaited<ReturnType<typeof info.getSportsReservationRecords>>[number];

/** 场馆元数据表 = core sportsIdInfoList（lib sportsIdInfoList 逐字，index.ts 再导出） */
const SPORTS_VENUES: SportsIdInfo[] = sportsIdInfoList;

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 可预约判定：无 bookId、未锁定、允许网络预约 */
function bookable(r: SportsResourceT): boolean {
  return !r.bookId && !r.locked && r.canNetBook;
}

const SPORTS_UNAVAILABLE = "体育预约暂不可用，请在「清华体育」App 中预约";
const PHONE_RE = /^(1[3-9][0-9]|15[036789]|18[89])\d{8}$/;

export function SportsTab() {
  const uiLocale = useUiLocale();

  const { status } = useApp();

  /* —— 场馆/日期选择 —— */
  const [venue, setVenue] = useState(SPORTS_VENUES[0]!);
  const [date, setDate] = useState(todayStr);

  /* —— 资源（时段×场地） —— */
  const [res, setRes] = useState<SportsResourcesInfoT | null>(null);
  const [resState, setResState] = useState<LoadState>("idle");
  const [resUnavailable, setResUnavailable] = useState(false);
  const [resError, setResError] = useState<string | null>(null);

  /* —— 选中场地 —— */
  const [picked, setPicked] = useState<SportsResourceT | null>(null);

  /* —— 预约表单 + 验证码面板 —— */
  const [phone, setPhone] = useState("");
  const [phoneMsg, setPhoneMsg] = useState<string | null>(null);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [captchaErr, setCaptchaErr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [booking, setBooking] = useState(false);

  /* —— 我的预约记录 —— */
  const [records, setRecords] = useState<SportsRecordT[] | null>(null);
  const [recState, setRecState] = useState<LoadState>("loading");
  const [recUnavailable, setRecUnavailable] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [unsubbing, setUnsubbing] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  /* —— 资源加载 —— */
  const loadResources = useCallback(
    async (v: { gymId: string; itemId: string }, d: string) => {
      setResState("loading");
      setResUnavailable(false);
      setResError(null);
      setPicked(null);
      setCaptchaOpen(false);
      try {
        const data = await info.getSportsResources(v.gymId, v.itemId, d);
        setRes(data);
        setPhone(data.phone ?? "");
        setResState("ready");
      } catch (err) {
        logTabErr("SPORTS-RES", err);
        setResUnavailable(isServiceUnavailable(err));
        setResError(tabErrorText(err));
        setResState("error");
      }
    },
    [],
  );

  useEffect(() => {
    if (status === "ready") void loadResources(venue, date);
    // 仅挂载时拉一次；场馆/日期变化由交互回调触发（日期输入中途不连发请求）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  /* —— 我的预约记录 —— */
  const fetchRecords = useCallback(async () => {
    setRecState("loading");
    setRecUnavailable(false);
    setRecError(null);
    try {
      setRecords(await info.getSportsReservationRecords());
      setRecState("ready");
    } catch (err) {
      logTabErr("SPORTS-RECORDS", err);
      setRecUnavailable(isServiceUnavailable(err));
      setRecError(tabErrorText(err));
      setRecState("error");
    }
  }, []);

  useEffect(() => {
    if (status === "ready") void fetchRecords();
  }, [status, fetchRecords]);

  /* —— 退订（confirm 确认后调用） —— */
  const unsubscribe = useCallback(
    async (bookId: string) => {
      setUnsubbing(bookId);
      setNoticeMsg(null);
      try {
        await info.unsubscribeSportsReservation(bookId);
        setNoticeMsg(i18n("pages.info.sportstab.81ec63d2a4cc"));
        await Promise.all([
          fetchRecords(),
          loadResources(venue, date),
        ]);
      } catch (err) {
        logTabErr("SPORTS-UNSUB", err);
        setNoticeMsg(isServiceUnavailable(err) ? SPORTS_UNAVAILABLE : i18n("pages.info.sportstab.2759ad2a6b6c", { value: String(tabErrorText(err)) }));
      } finally {
        setUnsubbing(null);
      }
    },
    [fetchRecords, loadResources, venue, date],
  );

  /* —— 手机号保存（updateSportsPhoneNumber；core 侧同样校验格式） —— */
  const savePhone = useCallback(async () => {
    const p = phone.trim();
    if (!PHONE_RE.test(p)) {
      setPhoneMsg(i18n("pages.info.sportstab.722df4de2e57"));
      return;
    }
    setPhoneBusy(true);
    setPhoneMsg(null);
    try {
      await info.updateSportsPhoneNumber(p);
      setPhoneMsg(i18n("pages.info.sportstab.5e119f7a81fe"));
    } catch (err) {
      logTabErr("SPORTS-PHONE", err);
      setPhoneMsg(isServiceUnavailable(err) ? SPORTS_UNAVAILABLE : i18n("pages.info.sportstab.a3299407580e", { value: String(tabErrorText(err)) }));
    } finally {
      setPhoneBusy(false);
    }
  }, [phone]);

  /* —— 验证码面板（图可点刷新） —— */
  const refreshCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    setCaptchaErr(null);
    try {
      // core 携 webvpn 会话拉 PNG → base64 data URL（getSportsCaptchaUrlMethod）
      setCaptcha(await info.getSportsCaptchaUrlMethod());
    } catch (err) {
      logTabErr("SPORTS-CAPTCHA", err);
      setCaptcha(null);
      setCaptchaErr(isServiceUnavailable(err) ? SPORTS_UNAVAILABLE : i18n("pages.info.sportstab.edb3f8bb40a5", { value: String(tabErrorText(err)) }));
    } finally {
      setCaptchaLoading(false);
    }
  }, []);

  const openCaptcha = useCallback(() => {
    if (!picked) return;
    setCaptchaOpen(true);
    setCode("");
    setCaptchaErr(null);
    void refreshCaptcha();
  }, [picked, refreshCaptcha]);

  /* —— 提交预约（下单段；免费/跳过支付时 core 不走支付链） —— */
  const doBook = useCallback(async () => {
    if (!picked || !code.trim()) return;
    setBooking(true);
    setCaptchaErr(null);
    try {
      // makeSportsReservation(totalCost, phone, receiptTitle, gymId, itemId, date, captcha, resHashId, skipPayment)
      await info.makeSportsReservation(
        picked.cost ?? 0,
        phone.trim(),
        undefined, // 收据抬头仅线上申领发票用；免费场景不接支付流
        venue.gymId,
        venue.itemId,
        date,
        code.trim(),
        picked.resHash,
        true, // skipPayment：用户场景免费，不接支付流
      );
      setNoticeMsg(i18n("pages.info.sportstab.208514882cd8", { name: String(venue.name), date: String(date), timeSession: String(picked.timeSession), fieldName: String(picked.fieldName) }));
      setCaptchaOpen(false);
      setCode("");
      await Promise.all([loadResources(venue, date), fetchRecords()]);
    } catch (err) {
      logTabErr("SPORTS-BOOK", err);
      setCaptchaErr(isServiceUnavailable(err) ? SPORTS_UNAVAILABLE : i18n("pages.info.sportstab.210e2fea0238", { value: String(tabErrorText(err)) }));
      void refreshCaptcha();
    } finally {
      setBooking(false);
    }
  }, [picked, code, phone, venue, date, loadResources, fetchRecords, refreshCaptcha]);

  /* 时段分组（按起始时间排序） */
  const sessions = useMemo(() => {
    const bySession = new Map<string, SportsResourceT[]>();
    for (const r of res?.data ?? []) {
      const list = bySession.get(r.timeSession);
      if (list) list.push(r);
      else bySession.set(r.timeSession, [r]);
    }
    return [...bySession.entries()].sort((a, b) => {
      const ta = a[0].split("-")[0]?.trim() ?? "";
      const tb = b[0].split("-")[0]?.trim() ?? "";
      return ta.localeCompare(tb, "zh-Hans-CN", { numeric: true });
    });
  }, [uiLocale, res]);

  const closed = res !== null && res.init <= 0;
  const phoneOk = PHONE_RE.test(phone.trim());

  return (
    <>
      <SectionHead title={i18n("pages.info.sportstab.ed8263515e2f")} aside={res?.count ? i18n("pages.info.sportstab.d814910bfbc4", { count: String(res.count) }) : i18n("pages.info.sportstab.5d220af4df4c")} />
      <div className="chips" style={{ marginBottom: 10 }}>
        {SPORTS_VENUES.map((v) => (
          <button
            key={v.itemId}
            className={"chip" + (venue.itemId === v.itemId ? " chip-blue" : "")}
            onClick={() => {
              setVenue(v);
              void loadResources(v, date);
            }}
          >
            {v.name}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
        <input
          className="input"
          style={{ width: 170 }}
          type="date"
          value={date}
          onChange={(e) => {
            const d = e.target.value;
            setDate(d);
            if (d) void loadResources(venue, d);
          }}
          aria-label={i18n("pages.info.sportstab.35bc4552c921")}
        />
        <Btn variant="ghost" onClick={() => void loadResources(venue, date)} disabled={resState === "loading"}>{i18n("pages.info.sportstab.aee887434131")}</Btn>
      </div>

      <SectionHead title={i18n("pages.info.sportstab.d328b0d4ae31", { name: String(venue.name) })} aside={closed ? i18n("pages.info.sportstab.70d143e6729b") : undefined} />
      {resState === "error" ? (
        resUnavailable ? (
          <ErrorNote text={SPORTS_UNAVAILABLE} onRetry={() => void loadResources(venue, date)} />
        ) : (
          <ErrorNote text={resError ?? ""} onRetry={() => void loadResources(venue, date)} />
        )
      ) : null}
      {resState === "loading" ? (
        <SkeletonRows rows={5} />
      ) : resState === "ready" && sessions.length === 0 ? (
        <TabEmpty text={i18n("pages.info.sportstab.0e9546c6723c")} />
      ) : resState === "ready" ? (
        <>
          {closed ? (
            <Card style={{ marginBottom: 12 }}>
              <div className="empty">{i18n("pages.info.sportstab.b172e1bbb00d")}</div>
            </Card>
          ) : null}
          {sessions.map(([session, fields]) => (
            <div key={session} style={{ marginBottom: 14 }}>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{session}</th>
                      <th className="num">{i18n("pages.info.sportstab.6320b4a8722a")}</th>
                      <th className="num">{i18n("pages.info.sportstab.7fe8603c084e")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((r, i) => (
                      <tr
                        key={r.resId || i}
                        style={{ animationDelay: `${Math.min(i, 12) * 25}ms`, cursor: bookable(r) ? "pointer" : "default" }}
                        onClick={() => bookable(r) && setPicked(r)}
                      >
                        <td className="cell-title">{r.fieldName}</td>
                        <td className="num">
                          <span
                            className={
                              picked?.resId === r.resId
                                ? "chip chip-blue"
                                : bookable(r)
                                  ? "chip chip-green"
                                  : "chip chip-gray"
                            }
                          >
                            {picked?.resId === r.resId ? i18n("pages.info.sportstab.7ecf1cde6486") : r.bookId ? i18n("pages.info.sportstab.82c6a357291a") : r.locked ? i18n("pages.info.sportstab.ff9872a023e3") : bookable(r) ? i18n("pages.info.sportstab.d1d50368fefe") : i18n("pages.info.sportstab.a4c0233f1d6c")}
                          </span>
                        </td>
                        <td className="num">{r.cost === undefined ? "–" : r.cost === 0 ? i18n("pages.info.sportstab.649a0fc7237e") : `¥${r.cost}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          ))}
        </>
      ) : null}

      {/* 预约卡（选中场地后出现） */}
      {picked ? (
        <>
          <SectionHead title={i18n("pages.info.sportstab.352cdc807892")} aside={`${venue.name} · ${date} · ${picked.timeSession} · ${picked.fieldName}`} />
          <Card style={{ marginBottom: 16 }}>
            <div className="field">
              <label htmlFor="sports-phone">{i18n("pages.info.sportstab.56a0480f18eb")}</label>
              <div style={{ display: "flex", gap: 8 }}>
                <Input value={phone} onChange={(value) => setPhone(value)} placeholder={i18n("pages.info.sportstab.2f332d18c42d")} inputMode="numeric" />
                <Btn variant="ghost" onClick={() => void savePhone()} disabled={phoneBusy || !phoneOk} titleAttr={i18n("pages.info.sportstab.9b0dac77aebd")}>{phoneBusy ? i18n("pages.info.sportstab.ff509c9ba052") : i18n("pages.info.sportstab.a3030bf8f16d")}</Btn>
              </div>
            </div>
            {phoneMsg ? <div style={{ marginTop: -6, marginBottom: 8, fontSize: 12, color: "var(--text-3)" }}>{phoneMsg}</div> : null}
            <Btn variant="solid" tone="brand" onClick={openCaptcha} disabled={!phoneOk}>{phoneOk ? i18n("pages.info.sportstab.08eb78cf3163") : i18n("pages.info.sportstab.dbb234c0abe9")}</Btn>
          </Card>
        </>
      ) : null}

      {/* 验证码面板（交互复用 NetworkTab usereg 验证码面板：图可点刷新 + 输入 + 提交） */}
      {captchaOpen && picked ? (
        <Card style={{ marginBottom: 16, padding: 18 }}>
          <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>{i18n("pages.info.sportstab.d851993c4e6a")}</div>
          <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 14, lineHeight: 1.6 }}>{i18nRich("pages.info.sportstab.a4d97ae215ba", { name: venue.name, date: date, timeSession: picked.timeSession, fieldName: picked.fieldName, value: picked.cost ? ` · ¥${picked.cost}` : i18n("pages.info.sportstab.705fc6e91775") })}</div>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
            <div
              onClick={() => !captchaLoading && void refreshCaptcha()}
              style={{
                width: 150,
                height: 48,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid var(--border, #ccc)",
                borderRadius: 8,
                cursor: "pointer",
                overflow: "hidden",
                flexShrink: 0,
              }}
              title={i18n("pages.info.sportstab.6baa450e31c0")}
            >
              {captchaLoading ? (
                <span style={{ fontSize: 12, opacity: 0.6 }}>{i18n("pages.info.sportstab.4927a53bcc88")}</span>
              ) : captcha ? (
                <img src={captcha} alt={i18n("pages.info.sportstab.bb015c60bafc")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span style={{ fontSize: 12, opacity: 0.6 }}>{i18n("pages.info.sportstab.965fb250e5fd")}</span>
              )}
            </div>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void doBook();
              }}
              placeholder={i18n("pages.info.sportstab.bb015c60bafc")}
              style={{ width: 130, height: 38, padding: "0 10px", borderRadius: 8, border: "1px solid var(--border, #ccc)", fontSize: 14 }}
            />
            <Btn variant="solid" tone="brand" onClick={() => void doBook()} disabled={booking || !code.trim()}>{booking ? i18n("pages.info.sportstab.18931020ad52") : i18n("pages.info.sportstab.72944bf6d779")}</Btn>
            <Btn variant="ghost" onClick={() => { setCaptchaOpen(false); setCode(""); }}>{i18n("pages.info.sportstab.2cd0f3be8738")}</Btn>
          </div>
          {captchaErr ? <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.5, color: "#d33" }}>{captchaErr}</div> : null}
        </Card>
      ) : null}

      <SectionHead title={i18n("pages.info.sportstab.1a558735ea57")} aside={i18n("pages.info.sportstab.4401db92a33a")} />
      {recState === "error" ? (
        recUnavailable ? (
          <ErrorNote text={SPORTS_UNAVAILABLE} onRetry={() => void fetchRecords()} />
        ) : (
          <ErrorNote text={recError ?? ""} onRetry={() => void fetchRecords()} />
        )
      ) : null}
      {recState === "loading" && !records ? (
        <SkeletonRows rows={4} />
      ) : (records?.length ?? 0) === 0 ? (
        <TabEmpty text={i18n("pages.info.sportstab.c3b180cc0d49")} />
      ) : (
        <>
          {noticeMsg ? (
            <Card style={{ marginBottom: 10 }}>
              <div className="empty">{noticeMsg}</div>
            </Card>
          ) : null}
          <Card className="list">
            {records!.map((r, i) => (
              <div className="row" key={`${r.name}-${r.time}-${i}`} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                <span className={/未支付/.test(r.method) ? "chip chip-amber" : "chip chip-green"}>{r.method || i18n("pages.info.sportstab.82c6a357291a")}</span>
                <div className="row-main">
                  <div className="row-title">{r.name} · {r.field}</div>
                  <div className="row-sub">{r.time}{r.price ? ` · ¥${r.price}` : ""}</div>
                </div>
                {r.bookId ? (
                  <Btn variant="ghost" disabled={unsubbing !== null} onClick={() => {
                      if (globalThis.confirm?.(i18n("pages.info.sportstab.8353d850c8c6", { name: String(r.name), field: String(r.field), time: String(r.time) }))) {
                        void unsubscribe(r.bookId!);
                      }
                    }}>{unsubbing === r.bookId ? i18n("pages.info.sportstab.4e3d949d0cda") : i18n("pages.info.sportstab.660aa1f65abc")}</Btn>
                ) : null}
              </div>
            ))}
          </Card>
        </>
      )}
    </>
  );
}
