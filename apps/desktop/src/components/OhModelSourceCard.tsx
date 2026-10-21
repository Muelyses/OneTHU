import { t as i18n, msg as i18nMsg, useLocale as useUiLocale } from "../i18n/index.js";
/**
 * 小 OH 模型源卡片（设置里通用，完整/极简/实用模式共用）：
 *  - 选择模型源：学校 MadModel 免费档 / 自己的 API；
 *  - 免费档下显示有效期与「一键续签」（仅更新登录凭证）；
 *  - 自费档下给出 API Key 配置状态与入口。
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Btn, Card, Inline, Segment, Stack, Text } from "@onethu/gui";
import { getPlugin, subscribe, updatePlugin } from "../plugins/registry.js";
import { ensureMadModelToken, jwtExpiresAt, madmodelActive } from "../state/madmodel.js";
import { showToast } from "../state/toast.js";

const HARNESS_ID = "onethu.harness";

function patchHarnessSettings(patch: Record<string, unknown>): void {
  const rec = getPlugin(HARNESS_ID);
  if (!rec) return;
  updatePlugin(HARNESS_ID, { settings: { ...(rec.settings ?? {}), ...patch } as typeof rec.settings });
}

function expireText(token: string): string {
  const exp = jwtExpiresAt(token);
  if (!exp) return i18n("components.ohmodelsourcecard.2a0bbb86011e");
  if (exp <= Date.now()) return i18n("components.ohmodelsourcecard.d11b082f9ce4");
  const h = Math.max(1, Math.round((exp - Date.now()) / 3600_000));
  return h >= 24 ? i18n("components.ohmodelsourcecard.68ec985f4e52", { value: String(Math.floor(h / 24)) }) : i18n("components.ohmodelsourcecard.904cae8267a3", { h: String(h) });
}

export function OhModelSourceCard(): ReactNode {
  const uiLocale = useUiLocale();

  const [, force] = useState(0);
  useEffect(() => subscribe(() => force((v) => v + 1)), []);
  /* 插件设置是可变单例：订阅 registry 变化后直接读，不用对象快照（快照每次新对象会死循环）。 */
  const settings = (getPlugin(HARNESS_ID)?.settings ?? {}) as Record<string, unknown>;
  const [busy, setBusy] = useState(false);
  const isMad = madmodelActive();
  const token = String(settings.madmodelToken ?? "");
  const apiKey = String(settings.apiKey ?? "");
  const model = String(isMad ? (settings.madmodelModel || "DeepSeek-V4.1-Flash") : (settings.model || "deepseek-chat"));

  const renew = useCallback((): void => {
    setBusy(true);
    void ensureMadModelToken(true)
      .then(() => {
        force((v) => v + 1);
        showToast(i18nMsg("components.ohmodelsourcecard.2c8fd279faba"));
      })
      .catch((e) => {
        showToast(i18nMsg("components.ohmodelsourcecard.d58d1914534e", { value: String(e instanceof Error ? e.message : String(e)) }));
      })
      .finally(() => setBusy(false));
  }, []);

  return (
    <Card className="oh-model-source">
      <Stack gap={3}>
        <Inline gap={2} wrap justify="between">
          <Stack gap={1}>
            <Text slot="title">{i18n("components.ohmodelsourcecard.f3230e3c122f")}</Text>
            <Text slot="micro" tone="faint">
              {isMad ? i18n("components.ohmodelsourcecard.760af7198e4d", { model: String(model) }) : i18n("components.ohmodelsourcecard.54e8c9587c83", { value: String(model || i18n("components.ohmodelsourcecard.a0e70984b929")) })}
            </Text>
          </Stack>
          {isMad ? (
            <Btn variant="solid" tone="brand" disabled={busy} onClick={renew}>{busy ? i18n("components.ohmodelsourcecard.35843c4cc623") : i18n("components.ohmodelsourcecard.a2b21883b5f3")}</Btn>
          ) : (
            <Btn variant="ghost" onClick={() => patchHarnessSettings({ provider: "madmodel" })}>{i18n("components.ohmodelsourcecard.621e4cb3a245")}</Btn>
          )}
        </Inline>
        <Segment
          value={isMad ? "madmodel" : "custom"}
          onChange={(v) => patchHarnessSettings({ provider: v })}
          options={[
            { value: "madmodel", label: i18n("components.ohmodelsourcecard.23f0474b0502") },
            { value: "custom", label: i18n("components.ohmodelsourcecard.ef1b0e23a0a5") },
          ]}
        />
        <Text slot="micro" tone="faint">
          {isMad
            ? i18n("components.ohmodelsourcecard.7d44e665e640", { value: String(expireText(token)) })
            : apiKey
              ? i18n("components.ohmodelsourcecard.279475c2940d")
              : i18n("components.ohmodelsourcecard.b5ad43409b01")}
        </Text>
      </Stack>
    </Card>
  );
}
