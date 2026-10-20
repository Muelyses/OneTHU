import { t as i18n, rich as i18nRich, useLocale as useUiLocale } from "../../i18n/index.js";
import { Btn, Text } from "@onethu/gui";
/**
 * 校园网 —— usereg 自服务（thu-info-app network.tsx 移植 + 用户示例页增强）。
 * 数据：账号/状态/用户组（/users+/home）、流量/时长（/home w3 计费组表）、
 * 设备数（/user/online-num）。管理：改终端连接数、改 Tsinghua-Secure 密码、
 * 在线设备下线。usereg 需验证码登录（密码=INFO 密码）——检测到验证码门时展示
 * 登录面板，验证码图经 core 会话拉取转 base64。失败一律静态提示+重试，
 * 绝不自动整页刷新、绝不失登自愈。
 */
import { useCallback, useEffect, useState } from "react";
import { Card, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { info } from "../../lib/clients.js";
import { useApp } from "../../state/context.js";
import { TabEmpty, logTabErr, isAuthExpired } from "./tabStates.js";
import type { NetworkDevice } from "@onethu/core";

type LoadState = "loading" | "error" | "ready" | "captcha";
type NetworkRow = [string, string];

const NEED_CAPTCHA = /需要验证码登录/;

export function NetworkTab() {
  const uiLocale = useUiLocale();

  const { status } = useApp();
  const [rows, setRows] = useState<NetworkRow[] | null>(null);
  const [devices, setDevices] = useState<NetworkDevice[] | null>(null);
  const [devCount, setDevCount] = useState<number | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  /* —— 验证码登录面板 —— */
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [code, setCode] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);

  /* —— 管理操作 —— */
  const [newCount, setNewCount] = useState("");
  const [countBusy, setCountBusy] = useState(false);
  const [countMsg, setCountMsg] = useState<string | null>(null);
  const [showPwd, setShowPwd] = useState(false);
  const [pwd1, setPwd1] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);

  const refreshCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    setLoginErr(null);
    try {
      setCaptcha(await info.getNetworkVerificationImage());
    } catch (err) {
      logTabErr("NETWORK-CAPTCHA", err);
      setLoginErr(i18n("pages.info.networktab.edb3f8bb40a5", { value: String(err instanceof Error ? err.message : String(err)) }));
      setCaptcha(null);
    } finally {
      setCaptchaLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    if (status !== "ready") return;
    setState("loading");
    try {
      const [acc, bal, devs, cnt] = await Promise.allSettled([
        info.getNetworkAccountInfo(),
        info.getNetworkBalance(),
        info.getOnlineDevices(),
        info.getNetworkDeviceCount(),
      ]);
      const out: NetworkRow[] = [];
      if (acc.status === "fulfilled") {
        const a = acc.value;
        out.push(
          [i18n("pages.info.networktab.311bb313fdec"), a.username || "–"],
          [i18n("pages.info.networktab.50b5b1d2abef"), a.realName || "–"],
          [i18n("pages.info.networktab.6320b4a8722a"), a.status || "–"],
          [i18n("pages.info.networktab.963ead08d78d"), a.userGroup || "–"],
        );
      }
      if (bal.status === "fulfilled") {
        const b = bal.value;
        out.push([i18n("pages.info.networktab.decb065f369c"), b.usedBytes || "–"], [i18n("pages.info.networktab.e4e1122260bc"), b.usedSeconds || "–"]);
      }
      if (cnt.status === "fulfilled") {
        setDevCount(cnt.value);
        out.push([i18n("pages.info.networktab.32c49e5592c4"), String(cnt.value)]);
      } else if (acc.status === "fulfilled") {
        const a = acc.value;
        if (a.allowedDevices != null) out.push([i18n("pages.info.networktab.cca768b12e76"), String(a.allowedDevices)]);
      }
      setDevices(devs.status === "fulfilled" ? devs.value : null);
      const accErr = acc.status === "rejected" ? acc.reason : null;
      const balErr = bal.status === "rejected" ? bal.reason : null;
      const cntErr = cnt.status === "rejected" ? cnt.reason : null;
      if (accErr) logTabErr("NETWORK-ACC", accErr);
      if (balErr) logTabErr("NETWORK-BAL", balErr);
      if (cntErr) logTabErr("NETWORK-CNT", cntErr);
      // 校园网与统一身份相互独立：未登录是常态，不是故障
      setNeedLogin([accErr, balErr, cntErr].some((e) => isAuthExpired(e)));
      setRows(out);
      const needCaptcha =
        out.length === 0 &&
        [accErr, balErr, cntErr].some((e) => e instanceof Error && NEED_CAPTCHA.test(e.message));
      if (needCaptcha) {
        setState("captcha");
        void refreshCaptcha();
      } else {
        setState(out.length > 0 ? "ready" : "error");
      }
    } catch (err) {
      logTabErr("NETWORK", err);
      setRows(null);
      setState("error");
    }
  }, [status, refreshCaptcha]);

  useEffect(() => {
    void load();
  }, [load]);

  const doLogin = useCallback(
    async (c: string) => {
      if (!c || loginBusy) return;
      setLoginBusy(true);
      setLoginErr(null);
      try {
        await info.loginUsereg(c);
        setCode("");
        await load();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setLoginErr(msg);
        logTabErr("NETWORK-LOGIN", err);
        void refreshCaptcha();
      } finally {
        setLoginBusy(false);
      }
    },
    [loginBusy, load, refreshCaptcha],
  );

  const doSetCount = useCallback(async () => {
    const n = Number(newCount);
    if (!Number.isInteger(n) || n <= 0 || countBusy || devCount == null) return;
    setCountBusy(true);
    setCountMsg(null);
    try {
      await info.setNetworkDeviceCount(n);
      setCountMsg(i18n("pages.info.networktab.6de4ef1bdc04", { n: String(n) }));
      setDevCount(n);
    } catch (err) {
      setCountMsg(err instanceof Error ? err.message : String(err));
      logTabErr("NETWORK-SETCNT", err);
    } finally {
      setCountBusy(false);
    }
  }, [newCount, countBusy, devCount]);

  const doChpwd = useCallback(async () => {
    if (pwdBusy) return;
    setPwdMsg(null);
    if (pwd1 !== pwd2) {
      setPwdMsg(i18n("pages.info.networktab.355fc1ddcfad"));
      return;
    }
    if (!/^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^*().~])[^\s]{8,19}$/.test(pwd1)) {
      setPwdMsg(i18n("pages.info.networktab.ee38ec30b36a"));
      return;
    }
    setPwdBusy(true);
    try {
      await info.changeNetworkPassword(pwd1);
      setPwdMsg(i18n("pages.info.networktab.be8995021004"));
      setPwd1("");
      setPwd2("");
      setShowPwd(false);
    } catch (err) {
      setPwdMsg(err instanceof Error ? err.message : String(err));
      logTabErr("NETWORK-CHPWD", err);
    } finally {
      setPwdBusy(false);
    }
  }, [pwd1, pwd2, pwdBusy]);

  const doLogoutDevice = useCallback(
    async (d: NetworkDevice) => {
      try {
        await info.logoutNetwork(d);
        await load();
      } catch (err) {
        logTabErr("NETWORK-LOGOUT", err);
      }
    },
    [load],
  );

  return (
    <>
      <SectionHead title={i18n("pages.info.networktab.dd94488f5269")} aside={i18n("pages.info.networktab.aed9c158c9ae")} />
      {state === "error" ? (
        needLogin ? (
          <ErrorNote text={i18n("pages.info.networktab.f37abc08ae82")} onRetry={() => void load()} />
        ) : (
          <ErrorNote text={i18n("pages.info.networktab.d48b614e9571")} onRetry={() => void load()} />
        )
      ) : null}

      {state === "captcha" ? (
        <Card style={{ marginBottom: 20, padding: 18 }}>
          <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>{i18n("pages.info.networktab.cd24d9aacefa")}</div>
          <div style={{ marginBottom: 14, lineHeight: 1.6 }}>
            <Text as="div" slot="label" tone="quiet">{i18n("pages.info.networktab.8494fa9c8467")}</Text>
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
            <div
              onClick={() => !captchaLoading && void refreshCaptcha()}
              style={{
                width: 150,
                height: 48,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid var(--og-line-2)",
                borderRadius: 8,
                cursor: "pointer",
                overflow: "hidden",
                flexShrink: 0,
              }}
              title={i18n("pages.info.networktab.6baa450e31c0")}
            >
              {captchaLoading ? (
                <Text slot="label" tone="faint">{i18n("pages.info.networktab.4927a53bcc88")}</Text>
              ) : captcha ? (
                <img src={captcha} alt={i18n("pages.info.networktab.bb015c60bafc")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <Text slot="label" tone="faint">{i18n("pages.info.networktab.965fb250e5fd")}</Text>
              )}
            </div>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void doLogin(code.trim());
              }}
              placeholder={i18n("pages.info.networktab.bb015c60bafc")}
              style={{ width: 130, height: 38, padding: "0 10px", borderRadius: 8, border: "1px solid var(--og-line-2)", fontSize: 14 }}
            />
            <Btn variant="outline" onClick={() => void doLogin(code.trim())} disabled={loginBusy || !code.trim()}>{loginBusy ? i18n("pages.info.networktab.3f06ed8f8c38") : i18n("pages.info.networktab.4cd6b2e0e4c4")}</Btn>
          </div>
          {loginErr ? (
            <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.5, color: "var(--og-error)" }}>{loginErr}</div>
          ) : null}
        </Card>
      ) : null}

      {state === "loading" ? (
        <SkeletonRows rows={3} />
      ) : state === "ready" && rows ? (
        <>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{i18n("pages.info.networktab.79f326be4409")}</th>
                  <th className="num">{i18n("pages.info.networktab.e7028601e7da")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([k, v], i) => (
                  <tr key={`${k}-${i}`} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                    <td className="cell-title">{k}</td>
                    <td className="num">{v || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {devices && devices.length > 0 ? (
            <>
              <SectionHead title={i18n("pages.info.networktab.ef611c008f80")} aside={i18n("pages.info.networktab.66265029155c", { length: String(devices.length) })} />
              <Card style={{ padding: 0, overflow: "hidden" }}>
                <div className="list">
                  {devices.map((d, i) => (
                    <div className="row" key={`${d.key}-${i}`}>
                      <div className="row-main">
                        <div className="row-title" style={{ fontFamily: "monospace", fontWeight: 600 }}>
                          {d.ip4 || "–"}
                          {d.ip6 ? <Text slot="micro" tone="faint"> · {d.ip6}</Text> : null}
                        </div>
                        <div className="row-sub">
                          {[d.mac ? `MAC ${d.mac}` : "", d.loggedAt ? i18n("pages.info.networktab.63d5dc2e839a", { loggedAt: String(d.loggedAt) }) : ""].filter(Boolean).join(" · ") || "–"}
                        </div>
                      </div>
                      <button className="chip chip-offline" onClick={() => void doLogoutDevice(d)}>{i18n("pages.info.networktab.9da8e7301f4e")}</button>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          ) : null}

          <SectionHead title={i18n("pages.info.networktab.bb6d995724f4")} aside={i18n("pages.info.networktab.21ef4abafb6f")} />
          <Card style={{ padding: 18 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 13 }}>{i18nRich("pages.info.networktab.71534747219b", { value: devCount ?? "–" })}</span>
              <input
                value={newCount}
                onChange={(e) => setNewCount(e.target.value.replace(/[^\d]/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void doSetCount();
                }}
                placeholder={i18n("pages.info.networktab.e6a28243ce79")}
                type="number"
                min={1}
                style={{ width: 90, height: 34, padding: "0 10px", borderRadius: 8, border: "1px solid var(--og-line-2)" }}
              />
              <Btn variant="outline" onClick={() => void doSetCount()} disabled={countBusy || !newCount}>{countBusy ? i18n("pages.info.networktab.18931020ad52") : i18n("pages.info.networktab.37090f456516")}</Btn>
              <Text slot="label" tone="faint">{i18n("pages.info.networktab.6d9f04d2e157")}</Text>
            </div>
            {countMsg ? <div style={{ marginTop: 8, fontSize: 13, color: "var(--og-info)" }}>{countMsg}</div> : null}

            <div style={{ borderTop: "1px solid var(--og-line-1)", margin: "16px 0", opacity: 0.5 }} />
            {!showPwd ? (
              <Btn variant="ghost" onClick={() => setShowPwd(true)}>{i18n("pages.info.networktab.9bc45ac6f5f0")}</Btn>
            ) : (
              <div style={{ display: "grid", gap: 12, maxWidth: 420 }}>
                <input
                  type="password"
                  value={pwd1}
                  onChange={(e) => setPwd1(e.target.value)}
                  placeholder={i18n("pages.info.networktab.515e9c7cf7b2")}
                  style={{ height: 38, padding: "0 12px", borderRadius: 8, border: "1px solid var(--og-line-2)" }}
                />
                <input
                  type="password"
                  value={pwd2}
                  onChange={(e) => setPwd2(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void doChpwd();
                  }}
                  placeholder={i18n("pages.info.networktab.6fde05a916c6")}
                  style={{ height: 38, padding: "0 12px", borderRadius: 8, border: "1px solid var(--og-line-2)" }}
                />
                <div style={{ fontSize: 12, opacity: 0.7, lineHeight: 1.6 }}>{i18n("pages.info.networktab.04cb682d2b8d")}</div>
                <div style={{ display: "flex", gap: 10 }}>
                  <Btn variant="outline" onClick={() => void doChpwd()} disabled={pwdBusy || !pwd1}>{pwdBusy ? i18n("pages.info.networktab.18931020ad52") : i18n("pages.info.networktab.08a85f4ab4ba")}</Btn>
                  <Btn variant="ghost" onClick={() => setShowPwd(false)}>{i18n("pages.info.networktab.2cd0f3be8738")}</Btn>
                </div>
              </div>
            )}
            {pwdMsg ? <div style={{ marginTop: 10, fontSize: 13, color: "var(--og-info)" }}>{pwdMsg}</div> : null}
          </Card>
        </>
      ) : null}
    </>
  );
}
