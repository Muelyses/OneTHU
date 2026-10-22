import { t as i18n, rich as i18nRich, useLocale as useUiLocale } from "../i18n/index.js";
import { Btn, TextArea } from "@onethu/gui";
import { BrandLogo, HardRefreshButton, Slogan } from "../components/Layout.js";
import { useEffect, useState, type FormEvent } from "react";
import type { TwoFactorMethod } from "@onethu/core";
import { isTauri } from "../lib/transport.js";
import { loadRemembered } from "../lib/clients.js";
import { useApp } from "../state/context.js";
import { DESENSITIZE_BUILD } from "../lib/privacy.js";
import { LanguageControl } from "../components/LanguageControl.js";

function LoginErrorPanel({ error }: { error: string }) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState("");
  useEffect(() => { setCopied(false); setManual(""); }, [error]);
  const copyDiagnostics = async () => {
    const { buildDiagnostics } = await import("../lib/diagnostics.js");
    const text = await buildDiagnostics();
    try { await navigator.clipboard.writeText(text); setCopied(true); }
    catch { setManual(text); }
  };
  return <div className="login-error" role="alert">
    <div>{error}</div>
    <Btn variant="ghost" onClick={() => void copyDiagnostics()}>{copied ? i18n("components.devpanel.cce28dd1fcdf") : i18n("components.devpanel.bbce140b7682")}</Btn>
    {manual ? <div onFocusCapture={e => { if (e.target instanceof HTMLTextAreaElement) e.target.select(); }}><TextArea aria-label={i18n("components.devpanel.bbce140b7682")} readOnly value={manual} rows={5} mono /></div> : null}
  </div>;
}

export function LoginPage() {
  const uiLocale = useUiLocale();

  const { login, status, error } = useApp();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // 记住密码：默认勾选；已有存档时预填（本机混淆存储，Settings 可清除）
  const [remember, setRemember] = useState(true);
  useEffect(() => {
    void loadRemembered().then((r) => {
      if (r) {
        setUsername(r.username);
        setPassword(r.password);
      }
    });
  }, []);
  const busy = status === "connecting";

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || !username.trim() || !password) return;
    void login(username.trim(), password, remember);
  };

  return (
    <div className="login-wrap">
      <HardRefreshButton />
      <div className="login-card">
        <LanguageControl compact />
        <div className="login-mark" style={{ flexDirection: "column", alignItems: "flex-start", gap: 12 }}>
          <BrandLogo size={30} />
          <Slogan size={13} />
        </div>

        {!isTauri ? (
          <div className="browser-hint">{i18n("pages.login.294044d5d232")}</div>
        ) : null}
        {error ? <LoginErrorPanel error={error} /> : null}

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="username">{i18n("pages.login.c4d678ef6e37")}</label>
            <input
              id="username"
              autoComplete="username"
              inputMode="numeric"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">{i18n("pages.login.e7b51261e9c9")}</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <label className="trust-row">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />{i18n("pages.login.1cdc0d5b06ff")}</label>
          <Btn type="submit" variant="solid" tone="brand" block disabled={busy || !username || !password}>{busy ? i18n("pages.login.bd7a362053a5") : i18n("pages.login.1e2df9c3075a")}</Btn>
        </form>

        <div className="login-foot">
          <span>{i18n("pages.login.7046d9853c1b")}</span>
        </div>
        {DESENSITIZE_BUILD ? (
          <p className="login-note">{i18n("pages.login.f5d462594d7c")}</p>
        ) : null}
      </div>
    </div>
  );
}

const METHOD_NAMES: Record<string, string> = { get wechat() { return i18n("pages.login.f3943a7b3681"); }, get mobile() { return i18n("pages.login.f87602bd9134"); }, get totp() { return i18n("pages.login.22a686a1c34c"); } };

export function TwoFactorPage() {
  const uiLocale = useUiLocale();

  const { twoFactor, submit2FA, send2FA, sendLearn2FA, error, status, backToLogin } = useApp();
  const round = twoFactor?.round ?? 1;
  const doSend = round === 2 ? sendLearn2FA : send2FA;
  const [stage, setStage] = useState<"select" | "code">("select");
  const [methods] = useState<TwoFactorMethod[]>(twoFactor?.methods ?? []);
  const [selected, setSelected] = useState<string>("");
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(true);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  // 防重复提交：submit2FA（app.tsx）全程不动 status，busy 恒 false——
  // 网络往返期间按钮可点，误触第二下=验证码已被消费→直接报错（用户实录）。
  // 本地闸门：提交瞬间置位，落定前按钮冻结 + onSubmit 防重入。
  const [submitting, setSubmitting] = useState(false);
  const busy = status === "connecting";

  if (!twoFactor) return <LoginPage />;

  const current = methods.find((m) => m.type === selected);
  const isTotp = selected === "totp";
  const nameOf = (t: string) => METHOD_NAMES[t] ?? t;

  const onSend = async () => {
    if (!selected) return;
    setSending(true);
    try {
      await doSend(selected);
      setSent(true);
    } catch {
      // The app state exposes the localized error; do not mark an unsent code as sent.
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!selected || !code.trim() || submitting || busy) return;
    setSubmitting(true);
    void submit2FA(selected, code, trust).finally(() => setSubmitting(false));
  };

  if (stage === "select") {
    return (
      <div className="login-wrap">
      <HardRefreshButton />
        <div className="login-card">
          <LanguageControl compact />
          <div className="login-mark">
            <BrandLogo size={26} />
            <div>
              <div className="login-title">{i18n("pages.login.98fc3e737ae3")}</div>
              <div className="login-sub">{i18nRich("pages.login.718e9b90bf7d", { username: twoFactor.username })}</div>
            </div>
          </div>

          {error ? <LoginErrorPanel error={error} /> : null}

          <div className="field">
            <div className="method-list">
              {methods.map((m) => (
                <label key={m.type} className={"method-item" + (selected === m.type ? " is-selected" : "")}>
                  <input
                    type="radio"
                    name="twofa-method"
                    value={m.type}
                    checked={selected === m.type}
                    onChange={() => setSelected(m.type)}
                  />
                  <span className="method-radio" aria-hidden />
                  <span className="method-text">
                    <b>{METHOD_NAMES[m.type] ?? m.name ?? m.type}</b>
                    {m.detail ? <i>{m.detail}</i> : null}
                  </span>
                </label>
              ))}
              {methods.length === 0 ? <span className="empty" style={{ padding: "8px 0" }}>{i18n("pages.login.64f2052d09f0")}</span> : null}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <Btn variant="ghost" onClick={backToLogin}>{i18n("pages.login.747b0f9082e6")}</Btn>
            <Btn type="submit" variant="solid" tone="brand" block disabled={!selected} onClick={() => setStage("code")}>{i18n("pages.login.acfc4e74a650")}</Btn>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <HardRefreshButton />
      <div className="login-card">
        <LanguageControl compact />
        <div className="login-mark">
          <BrandLogo size={26} />
          <div>
            <div className="login-title">{nameOf(selected)}</div>
            <div className="login-sub">
              {isTotp ? i18n("pages.login.213f02f73129") : sent ? i18n("pages.login.702cf0e136eb") : i18n("pages.login.91f1e4b13d58")}
            </div>
          </div>
        </div>

        {error ? <LoginErrorPanel error={error} /> : null}

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="code">{i18n("pages.login.bb015c60bafc")}</label>
            <input
              id="code"
              inputMode="numeric"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <label className="trust-row">
            <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />{i18n("pages.login.572898d767b6")}</label>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            {!isTotp ? (
              <Btn variant="outline" onClick={() => void onSend()} disabled={sending || !selected}>{sending ? i18n("pages.login.364970d8168c") : sent ? i18n("pages.login.9287ac799e54") : i18n("pages.login.4656fed515ae")}</Btn>
            ) : null}
            <Btn type="submit" variant="solid" tone="brand" block disabled={busy || submitting || (!isTotp && !sent) || !code.trim()}>{busy || submitting ? i18n("pages.login.fee0b2ceff3f") : i18n("pages.login.4e34537e5d0c")}</Btn>
          </div>
        </form>

        <div className="login-foot">
          <Btn variant="ghost" disabled={submitting || sending} onClick={() => { setStage("select"); setCode(""); setSent(false); }}>{i18n("pages.login.8875d1e9f0a3")}</Btn>
          <Btn variant="ghost" disabled={submitting || sending} onClick={backToLogin}>{i18n("pages.login.747b0f9082e6")}</Btn>
        </div>
      </div>
    </div>
  );
}
