/**
 * 外部作业源「登录雨课堂」通道弹窗（R11 16.3）。
 *
 * 新手指引横幅的主按钮弹出本 modal，内含两条登录通道：
 *  ① 微信 / 雨豆APP 扫码（复用 core 的 runYuketangQrLogin 状态机）
 *  ② 手机号 + 短信验证码（复用 yuketangSendSmsCode / yuketangVerifyLogin）
 *
 * UI 参考「校园卡充值」弹窗（pages/info/CardTab.tsx RechargeDialog）的遮罩 / 卡片 /
 * 通道单选布局：同一套 mask/panel 视觉与按钮层级，降低新用户认知成本。
 * 登录成功即合并写入凭据（保留其他源）并触发刷新；不涉及任何外部作业拉取逻辑。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import type { YktQrPhase } from "@onethu/core";
import { ensureExtHwCredsLoaded, extHwLogin, refreshExtHw, saveExtHwCreds } from "../state/exthw.js";

/** 与 CardTab 充值弹窗同款遮罩 / 面板（移动端也留出 24px 边距、限高可滚动） */
const maskStyle: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 };
const panelStyle: React.CSSProperties = { width: "100%", maxWidth: 380, maxHeight: "78vh", overflowY: "auto", background: "var(--bg-elev, #ffffff)", color: "var(--text, #1f2329)", borderRadius: 14, boxShadow: "0 18px 50px rgba(0,0,0,.28)", padding: "16px 18px" };

type YktChannel = "qr" | "sms";

const YKT_CHANNELS: Array<{ key: YktChannel; label: string; hint: string }> = [
  { key: "qr", label: "微信扫码", hint: "打开微信或雨豆APP 扫描二维码" },
  { key: "sms", label: "手机验证码", hint: "用雨课堂绑定手机号接收短信" },
];

/** 合并写入雨课堂凭据（保留 TUOJ/Tyche 等既有配置）后刷新 */
async function saveYuketang(cookie: string, phone?: string): Promise<void> {
  const c = await ensureExtHwCredsLoaded();
  const prevPhone = c.yuketang?.phone ?? "";
  await saveExtHwCreds({
    ...c,
    yuketang: { ...(c.yuketang ?? {}), cookie, phone: (phone ?? prevPhone).trim() || undefined },
  });
  void refreshExtHw();
}

/** 雨课堂扫码登录面板（微信 / 雨豆APP）——与设置页共用同一实现 */
export function YktQrPanel({ onSuccess, onCancel }: { onSuccess: (cookie: string) => void; onCancel: () => void }) {
  const [qr, setQr] = useState<{ qrContent: string; expireAt: number } | null>(null);
  const [status, setStatus] = useState<"loading" | "waiting" | "expired" | "error">("loading");
  const [err, setErr] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const runId = useRef(0);
  // onSuccess 由父组件内联传入、每次渲染都会变 —— 用 ref 固定，避免 effect 反复重启
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  useEffect(() => {
    const id = ++runId.current;
    const ctrl = new AbortController();
    setStatus("loading");
    setErr(null);
    setQr(null);
    void extHwLogin
      .yuketangQr({
        signal: ctrl.signal,
        onPhase: (p: YktQrPhase) => {
          if (id !== runId.current) return;
          if (p.phase === "qr") {
            setQr({ qrContent: p.qrContent, expireAt: p.expireAt });
            setStatus("waiting");
          } else if (p.phase === "expired") {
            setStatus("expired");
          }
        },
      })
      .then((r) => {
        if (id !== runId.current || r.aborted) return;
        if (r.done && r.cookie) {
          onSuccessRef.current(r.cookie);
          return;
        }
        setStatus("error");
        setErr(r.message ?? "登录未完成");
      });
    return () => {
      // 卸载 / 刷新 / 取消：中止长轮询，不留悬挂请求
      ctrl.abort();
    };
  }, [nonce]);

  const statusText =
    status === "loading"
      ? "正在获取二维码…"
      : status === "expired"
        ? "二维码已过期，正在刷新…"
        : status === "error"
          ? null
          : "请用微信或雨豆APP 扫描二维码";

  return (
    <div
      style={{
        marginTop: 10,
        padding: 12,
        border: "1px solid var(--border, #e5e5e5)",
        borderRadius: 10,
        background: "var(--bg-2, rgba(0,0,0,0.02))",
      }}
    >
      <div style={{ textAlign: "center" }}>
        {qr ? (
          <div style={{ background: "#fff", display: "inline-block", padding: 10, borderRadius: 10 }}>
            <QRCodeSVG value={qr.qrContent} size={176} level="M" />
          </div>
        ) : (
          <div
            style={{
              width: 196,
              height: 196,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#fff",
              borderRadius: 10,
              color: "var(--text-2)",
            }}
          >
            {status === "error" ? "—" : "加载中…"}
          </div>
        )}
        {statusText ? <div style={{ fontSize: 13, marginTop: 8 }}>{statusText}</div> : null}
        {qr && status === "waiting" ? (
          <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>二维码约 5 分钟有效，过期自动刷新</div>
        ) : null}
        {err ? <div style={{ color: "var(--danger, #c04848)", fontSize: 12, marginTop: 8 }}>{err}</div> : null}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
        <button className="btn" onClick={() => setNonce((n) => n + 1)}>
          刷新二维码
        </button>
        <button className="btn btn-ghost" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}

export function ExtHwLoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [channel, setChannel] = useState<YktChannel>("qr");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (!open) return null;

  const close = () => {
    setBusy(null);
    setMsg(null);
    onClose();
  };

  const onSend = () => {
    setBusy("send");
    setMsg(null);
    void extHwLogin
      .yuketangSendSms(phone)
      .then(() => setMsg("验证码已发送，请查收短信（若收不到，可能被风控拦截）。"))
      .catch((e: unknown) => setMsg(`发送验证码失败：${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setBusy(null));
  };

  const onVerify = () => {
    setBusy("verify");
    setMsg(null);
    void extHwLogin
      .yuketangVerify(phone, code)
      .then(async (r) => {
        await saveYuketang(r.cookie, phone);
        setCode("");
        close();
      })
      .catch((e: unknown) => setMsg(`雨课堂登录失败：${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setBusy(null));
  };

  return createPortal(
    <div style={maskStyle} onClick={close}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <b>登录雨课堂</b>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={close}>✕</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {YKT_CHANNELS.map((c) => (
            <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
              <input type="radio" checked={channel === c.key} onChange={() => { setChannel(c.key); setMsg(null); }} />
              <span>
                <b>{c.label}</b>
                <span style={{ opacity: 0.6 }}> · {c.hint}</span>
              </span>
            </label>
          ))}
        </div>

        {channel === "qr" ? (
          <YktQrPanel
            onCancel={close}
            onSuccess={(cookie) => {
              void saveYuketang(cookie).then(close);
            }}
          />
        ) : (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input className="input" style={{ minWidth: 140, flex: 1 }} inputMode="tel" placeholder="手机号" value={phone} onChange={(e) => setPhone(e.target.value.trim())} />
              <button className="btn" disabled={busy !== null || !phone.trim()} onClick={onSend}>
                {busy === "send" ? "发送中…" : "发送验证码"}
              </button>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input" style={{ minWidth: 140, flex: 1 }} inputMode="numeric" placeholder="短信验证码" value={code} onChange={(e) => setCode(e.target.value.trim())} />
              <button className="btn btn-primary" disabled={busy !== null || !phone.trim() || !code.trim()} onClick={onVerify}>
                {busy === "verify" ? "登录中…" : "登录"}
              </button>
            </div>
            {msg ? <div style={{ fontSize: 12, opacity: 0.75, marginTop: 8 }}>{msg}</div> : null}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
