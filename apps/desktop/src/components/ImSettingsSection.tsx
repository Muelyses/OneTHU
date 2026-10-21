import { t as i18n, rich as i18nRich, useLocale as useUiLocale } from "../i18n/index.js";
import { Input } from "@onethu/gui";
import { Btn } from "@onethu/gui";
/**
 * 设置页「IM 通道」区块：飞书 bot 配置、连接状态、绑定码与微信通道预告。
 *
 * 口径：
 *   · 凭据只以密文落本机（AES-GCM 本地混淆，见 src/im/store.ts 顶部的诚实声明）；
 *   · 连接状态如实展示（connecting/online/error 原文+时间），不假装已连接；
 *   · P0 单主人模型：设置页生成 6 位绑定码 → 在 IM 里给 bot 发「/bind 码」完成绑定，
 *     未绑定者的消息只会收到限频引导，不进入 OH；
 *   · 微信通道（官方 iLink）适配器未实现——如实灰置标注，不做假开关。
 */
import { defineSearchRows } from "../state/searchRows.js";
import { goOhRow } from "./OhSettingsPage.js";
import { useEffect, useState, type ReactNode } from "react";
import { Card } from "./Layout.js"; /* eslint-disable-line @typescript-eslint/no-unused-vars */
import { Switch } from "./Layout.js";
import { QRCodeSVG } from "qrcode.react";
import { loadImConfig, patchImConfig } from "../im/store.js";
import { wechatLoginCancel, wechatLoginPoll, wechatLoginStart } from "../im/wechat.js";
import {
  beginFeishuRegistration, pollFeishuRegistration,
  type FeishuRegSession,
} from "../im/feishuReg.js";
import { newBindCode, reportChannelStatus, useChannelStatus } from "../im/registry.js";
import { openExternal } from "../pages/info/openExternal.js";
import { syncChannels } from "../im/boot.js";
import type { ImConfig } from "../im/store.js";

function fmtAt(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const PHASE_TEXT: Record<string, string> = {
  off: "未启用",
  connecting: "连接中…",
  online: "在线",
  reconnecting: "重连中…",
  suspended: "平台暂停",
  get error() { return i18n("components.imsettingssection.89c4766afc85"); },
};

/** 分档（2026-10-11 用户拍板）：OH 设置页的「基础设置 / 高级配置」两档共用这一份实现——
 *  basic    = 扫码绑定 / 解绑（只这两件事 + 当前状态）
 *  advanced = 通道开关、手工凭据、微信灰置等复杂项
 *  all      = 两档都要（旧调用方的默认值，语义不变） */
export type ImTier = "basic" | "advanced" | "all";


/* task-19：IM 设置行注册（基础档 + 高级档） */
defineSearchRows([
  { id: "im-qr", tab: "OneTHU Harness", section: "IM 基础（扫码绑定 / 解绑）", get title() { return i18n("components.imsettingssection.ecf1cf831460"); }, aliases: ["扫码", "IM", "飞书"], get desc() { return i18n("components.imsettingssection.d5679a030605"); } , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "IM 基础（扫码绑定 / 解绑）", "扫码创建应用（推荐，免手工配置）"], displayRoot: "设置", go: () => goOhRow("im-qr", "basic") },
  { id: "im-owner", tab: "OneTHU Harness", section: "IM 基础（扫码绑定 / 解绑）", get title() { return i18n("components.imsettingssection.f48f46f71775"); }, aliases: ["绑定码", "解绑"], get desc() { return i18n("components.imsettingssection.5f2af850764a"); } , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "IM 基础（扫码绑定 / 解绑）", "绑定主人"], displayRoot: "设置", go: () => goOhRow("im-owner", "basic") },
  { id: "im-wechat", tab: "OneTHU Harness", section: "IM 基础（扫码绑定 / 解绑）", get title() { return i18n("components.imsettingssection.8c9a5097d028"); }, aliases: ["微信", "iLink"], get desc() { return i18n("components.imsettingssection.86b11345bf97"); } , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "IM 基础（扫码绑定 / 解绑）", "微信（iLink 官方 Bot · 扫码即用）"], displayRoot: "设置", go: () => goOhRow("im-wechat", "basic") },
  { id: "im-status", tab: "OneTHU Harness", section: "IM 基础（扫码绑定 / 解绑）", get title() { return i18n("components.imsettingssection.b8f945ea49ff"); }, aliases: ["IM 状态"], get desc() { return i18n("components.imsettingssection.394ee5935d8c"); } , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "IM 基础（扫码绑定 / 解绑）", "连接状态"], displayRoot: "设置", go: () => goOhRow("im-status", "basic") },
  { id: "im-feishu", tab: "OneTHU Harness", section: "IM 通道（进阶）", get title() { return i18n("components.imsettingssection.c432e0322b39"); }, aliases: ["飞书通道"], get desc() { return i18n("components.imsettingssection.3becaa3847a1"); } , breadcrumb: ["插件", "OneTHU Harness", "高级配置", "IM 通道（进阶）", "飞书 bot（P0 通道）"], displayRoot: "设置", go: () => goOhRow("im-feishu", "advanced") },
  { id: "im-creds", tab: "OneTHU Harness", section: "IM 通道（进阶）", get title() { return i18n("components.imsettingssection.8615725de235"); }, aliases: ["App ID", "App Secret"], get desc() { return i18n("components.imsettingssection.7c546888c169"); } , breadcrumb: ["插件", "OneTHU Harness", "高级配置", "IM 通道（进阶）", "应用凭据（手工）"], displayRoot: "设置", go: () => goOhRow("im-creds", "advanced") },
]);

export function ImSettingsSection({ tier = "all" }: { tier?: ImTier } = {}): ReactNode {
  const uiLocale = useUiLocale();

  const showBasic = tier !== "advanced";
  const showAdvanced = tier !== "basic";
  const [cfg, setCfg] = useState<ImConfig | null>(null);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [wxQr, setWxQr] = useState<string | null>(null);
  const [wxNote, setWxNote] = useState("");
  const [fsReg, setFsReg] = useState<FeishuRegSession | null>(null);
  const [fsNote, setFsNote] = useState("");
  const [fsDomain, setFsDomain] = useState<"feishu" | "lark">("feishu");
  const fs = useChannelStatus("feishu");
  const wechatStatus = useChannelStatus("wechat");

  useEffect(() => {
    void loadImConfig().then((c) => {
      setCfg(c);
      setAppId(c.channels.feishu?.appId ?? "");
      setAppSecret(c.channels.feishu?.appSecret ?? "");
    });
  }, []);

  const flash = (t: string): void => {
    setMsg(t);
    window.setTimeout(() => setMsg(null), 2_600);
  };

  const saveCreds = async (): Promise<void> => {
    await patchImConfig((c) => {
      c.channels.feishu = { appId: appId.trim(), appSecret: appSecret.trim() };
    });
    setCfg(await loadImConfig());
    await syncChannels();
    flash(i18n("components.imsettingssection.54821806e300"));
  };

  /** 解绑：清掉主人绑定（单主人模型）——之后的消息不再进入 OH，通道本身仍可在线 */
  const unbind = async (): Promise<void> => {
    await patchImConfig((c) => {
      c.bindings.feishu = "";
    });
    setCfg(await loadImConfig());
    await syncChannels();
    flash(i18n("components.imsettingssection.a445a63759f6"));
  };

  const toggleEnabled = async (v: boolean): Promise<void> => {
    await patchImConfig((c) => {
      c.enabled.feishu = v;
    });
    setCfg(await loadImConfig());
    await syncChannels();
    flash(v ? i18n("components.imsettingssection.550c7a151569") : i18n("components.imsettingssection.a8c3698b5b8c"));
  };

  // 飞书扫码创建应用轮询（device-code 流：按服务端 interval 节奏；成功后自动填凭据）
  useEffect(() => {
    if (!fsReg) return;
    const t = window.setInterval(
      () => {
        void pollFeishuRegistration(fsReg, fsDomain)
          .then(async (r) => {
            setFsNote(r.note);
            if (r.status === "pending" && r.note.includes("Lark")) setFsDomain("lark");
            if (r.status === "success" && r.appId && r.appSecret) {
              setAppId(r.appId);
              setAppSecret(r.appSecret);
              await patchImConfig((c) => {
                c.channels.feishu = { appId: r.appId!, appSecret: r.appSecret! };
                c.enabled.feishu = true;
                if (r.openId) c.bindings.feishu = r.openId; // 应用所有者默认即主人
              });
              setCfg(await loadImConfig());
              await syncChannels();
              setFsReg(null);
              flash(i18n("components.imsettingssection.e869014f4368"));
            } else if (r.status === "access_denied" || r.status === "expired" || r.status === "error") {
              setFsReg(null);
            }
          })
          .catch(() => undefined);
      },
      Math.max(3, fsReg.intervalSec) * 1_000,
    );
    return () => window.clearInterval(t);
  }, [fsReg, fsDomain]);

  const startFsReg = async (): Promise<void> => {
    setMsg(null);
    setFsDomain("feishu");
    try {
      const sess = await beginFeishuRegistration();
      setFsReg(sess);
      setFsNote(i18n("components.imsettingssection.fea96ff7ab72"));
    } catch (e) {
      flash(i18n("components.imsettingssection.020a11d70b94", { value: String(e instanceof Error ? e.message : String(e)) }));
    }
  };

  // 微信扫码登录轮询（登录会话有效期内 1.5s 一次）
  useEffect(() => {
    if (!wxQr) return;
    const t = window.setInterval(() => {
      void wechatLoginPoll()
        .then(async (r) => {
          setWxNote(r.note);
          if (r.done) {
            setWxQr(null);
            setCfg(await loadImConfig());
            await syncChannels();
            // wechat 无 adapter（syncChannels 跳过启动管理）——轮询由 wechat.ts
            // 自有循环承担，这里把真实状态补进状态机（此前恒显「未启用」）
            reportChannelStatus("wechat", "online");
            flash(i18n("components.imsettingssection.d49461b1f610"));
          } else if (r.status === "expired" || r.status === "verify_code_blocked") {
            setWxQr(null);
            reportChannelStatus("wechat", "off");
          }
        })
        .catch(() => undefined);
    }, 1_500);
    return () => window.clearInterval(t);
  }, [wxQr]);

  const startWxLogin = async (): Promise<void> => {
    setMsg(null);
    try {
      const r = await wechatLoginStart();
      setWxQr(r.imgContent || r.qrcode);
      setWxNote(i18n("components.imsettingssection.516b7af343ed"));
    } catch (e) {
      flash(i18n("components.imsettingssection.3cbb7d58f5e4", { value: String(e instanceof Error ? e.message : String(e)) }));
    }
  };

  const genBind = (): void => {
    setCode(newBindCode());
    flash(i18n("components.imsettingssection.57afe4560634"));
  };

  const bound = cfg?.bindings.feishu;

  return (
    <>
      {/* ── 基础档（OH 设置 → 基础设置）：扫码绑定 / 解绑——**飞书与微信两个通道都在这里** ── */}
      {showBasic ? (
        <>
          <div data-set-id="row-im-qr" className="setting-row">
            <div>
              <div className="setting-title">{i18n("components.imsettingssection.ecf1cf831460")}</div>
              <div className="setting-desc">{i18n("components.imsettingssection.390c8b791bcd")}</div>
            </div>
            <Btn variant="solid" tone="brand" onClick={() => void startFsReg()}>{i18n("components.imsettingssection.1c925e27fa1d")}</Btn>
          </div>

          {fsReg ? (
            <div className="setting-row">
              <div>
                <div style={{ background: "#fff", padding: 10, borderRadius: 10, display: "inline-block" }}>
                  <QRCodeSVG value={fsReg.qrUrl} size={148} />
                </div>
                <div className="setting-desc" style={{ marginTop: 6 }}>{fsNote || i18n("components.imsettingssection.516b7af343ed")}</div>
                <Btn variant="outline" onClick={() => void openExternal(fsReg.qrUrl).catch(() => undefined)}>{i18n("components.imsettingssection.021f76bfa953")}</Btn>
              </div>
              <Btn variant="outline" onClick={() => setFsReg(null)}>{i18n("components.imsettingssection.2cd0f3be8738")}</Btn>
            </div>
          ) : null}

          <div data-set-id="row-im-owner" className="setting-row">
            <div>
              <div className="setting-title">{i18n("components.imsettingssection.f48f46f71775")}</div>
              <div className="setting-desc">
                {bound
                  ? i18n("components.imsettingssection.2217f7c35158", { value: String(bound.slice(0, 12)) })
                  : i18n("components.imsettingssection.0f8c1b732b2c")}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="outline" onClick={genBind}>{i18n("components.imsettingssection.f69e6a2f5669")}</Btn>
              {bound ? (
                <Btn variant="outline" onClick={() => void unbind()}>{i18n("components.imsettingssection.fb3f6cc3047d")}</Btn>
              ) : null}
            </div>
          </div>
          {code ? (
            <div className="setting-row">
              <div>
                <div className="setting-title" style={{ fontSize: 22, letterSpacing: 4 }}>{code}</div>
                <div className="setting-desc">{i18nRich("components.imsettingssection.6ec82af7b630", { code: code })}</div>
              </div>
            </div>
          ) : null}

          {/* 微信（iLink 官方 Bot）：扫码绑定/解绑也放基础档——用户要求两个通道都能直接扫码 */}
          <div data-set-id="row-im-wechat" className="setting-row">
            <div>
              <div className="setting-title">{i18n("components.imsettingssection.8c9a5097d028")}</div>
              <div className="setting-desc">{i18nRich("components.imsettingssection.14087a9867d2", { value: PHASE_TEXT[wechatStatus.phase] ?? wechatStatus.phase, value2: wechatStatus.note ? `：${wechatStatus.note}` : "", value3: cfg?.channels.wechat?.botId ? `（bot ${cfg.channels.wechat.botId.slice(0, 10)}…）` : "" })}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="solid" tone="brand" onClick={() => void startWxLogin()}>{cfg?.channels.wechat?.botToken ? i18n("components.imsettingssection.a379593b5b75") : i18n("components.imsettingssection.378eaca774bb")}</Btn>
              {cfg?.channels.wechat?.botToken ? (
                <Btn variant="outline" onClick={() => {
                    wechatLoginCancel();
                    setWxQr(null);
                  }}>{i18n("components.imsettingssection.fb3f6cc3047d")}</Btn>
              ) : null}
            </div>
          </div>

          {wxQr ? (
            <div className="setting-row">
              <div>
                <div style={{ background: "#fff", padding: 10, borderRadius: 10, display: "inline-block" }}>
                  <QRCodeSVG value={wxQr} size={148} />
                </div>
                <div className="setting-desc" style={{ marginTop: 6 }}>{i18nRich("components.imsettingssection.ee91e7a6f98f", { value: wxNote || i18n("components.imsettingssection.516b7af343ed") })}</div>
              </div>
              <Btn variant="outline" onClick={() => setWxQr(null)}>{i18n("components.imsettingssection.2cd0f3be8738")}</Btn>
            </div>
          ) : null}
        </>
      ) : null}

      {/* 连接状态：两档都看得到（一条只读状态行，不做两套实现） */}
      <div data-set-id="row-im-status" className="setting-row">
        <div>
          <div className="setting-title">{i18n("components.imsettingssection.b8f945ea49ff")}</div>
          <div className="setting-desc">{i18nRich("components.imsettingssection.f779d8072854", { value: PHASE_TEXT[fs.phase] ?? fs.phase, value2: fs.note ? `：${fs.note}` : "", value3: fmtAt(fs.lastInboundAt) })}</div>
        </div>
      </div>

      {/* ── 高级档（OH 设置 → 高级配置）：通道开关 + 手工凭据 ── */}
      {showAdvanced ? (
        <>
          <div data-set-id="row-im-feishu" className="setting-row">
            <div>
              <div className="setting-title">{i18n("components.imsettingssection.c432e0322b39")}</div>
              <div className="setting-desc">{i18n("components.imsettingssection.4a151de9633d")}</div>
            </div>
            <Switch on={Boolean(cfg?.enabled.feishu)} onChange={(v) => void toggleEnabled(v)} label={i18n("components.imsettingssection.a84a8e151194")} />
          </div>

          <div data-set-id="row-im-creds" className="setting-row">
            <div>
              <div className="setting-title">{i18n("components.imsettingssection.8615725de235")}</div>
              <div className="setting-desc">{i18n("components.imsettingssection.28690afd1ecd")}</div>
            </div>
          </div>
          <div className="setting-row">
            <div style={{ flex: 1 }}>
              <Input placeholder={i18n("components.imsettingssection.b35839220413")} value={appId} onChange={(value) => setAppId(value)} />
            </div>
          </div>
          <div className="setting-row">
            <div style={{ flex: 1 }}>
              <Input placeholder="App Secret" type="password" value={appSecret} onChange={(value) => setAppSecret(value)} />
            </div>
            <Btn variant="solid" tone="brand" onClick={() => void saveCreds()}>{i18n("components.imsettingssection.107fecedccba")}</Btn>
          </div>
        </>
      ) : null}

      {msg ? <div className="setting-desc" style={{ opacity: 0.8 }}>{msg}</div> : null}
    </>
  );
}
