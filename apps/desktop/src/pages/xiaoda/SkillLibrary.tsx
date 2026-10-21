import { useCallback, useEffect, useRef, useState } from "react";
import { Banner, Btn, Chip, Inline, Modal, Row, SectionCard, Stack, Text } from "@onethu/gui";
import type { XiaodaSkillItem } from "@onethu/core";
import { t, useLocale } from "../../i18n/index.js";
import { computeSkill, deleteSkill, exportSkill, importSkill, listSkills, setSkillEnabled, skillError, type InstalledSkill } from "../../lib/skills.js";
import { xiaodaClient } from "../../lib/xiaoda.js";

export function SkillLibrary({ selected, onClose }: { selected: XiaodaSkillItem | null; onClose: () => void }) {
  useLocale();
  const [items, setItems] = useState<InstalledSkill[]>([]);
  const [local, setLocal] = useState<InstalledSkill | null>(null);
  const [detail, setDetail] = useState<XiaodaSkillItem | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const running = useRef(false);
  const requirements: Record<string, string> = {
    python: t("skills.requirement.python"), node: t("skills.requirement.node"), native: t("skills.requirement.native"),
    installer: t("skills.requirement.installer"), "external-service": t("skills.requirement.external-service"),
    "unknown-file": t("skills.requirement.unknown-file"),
  };
  const active = selected ?? local;
  const installed = items.find(item => item.id === active?.id);
  const refresh = useCallback(async () => setItems(await listSkills()), []);
  useEffect(() => { void refresh().catch(e => setError(skillError(e))); }, [refresh]);
  useEffect(() => {
    setError(""); setNotice(""); setDetail(null);
    if (!selected) return;
    let live = true;
    void xiaodaClient.skillDetail(selected.id).then(value => { if (live) setDetail(value); }).catch(() => undefined);
    return () => { live = false; };
  }, [selected]);
  const run = async (fn: () => Promise<unknown>) => {
    if (running.current) return;
    running.current = true; setBusy(true); setError(""); setNotice("");
    try { await fn(); await refresh(); } catch (e) { setError(skillError(e)); }
    finally { running.current = false; setBusy(false); }
  };
  const close = () => { if (!running.current) { onClose(); setLocal(null); setError(""); setNotice(""); } };
  return <>
    <SectionCard title={t("skills.library")} sub={t("skills.runtime")}>
      <Stack gap={3}>
        <Text>{t("skills.runtimeBody")}</Text>
        <Inline gap={2} wrap>
          <Chip>{t("skills.compatible")}</Chip><Chip>{t("skills.javascript")}</Chip>
          <Btn variant="outline" disabled={busy} onClick={() => void run(async () => {
            const result = await computeSkill("input.values.reduce((a,b)=>a+b,0)", { values: [2, 3, 5] }) as { result?: unknown };
            if (result.result !== 10) throw new Error(t("skills.error.runtime"));
            setChecked(true);
          })}>{checked ? t("skills.checked") : t("skills.check")}</Btn>
        </Inline>
        <Text tone="faint">{t("skills.runtimeLimits")}</Text>
        <Text tone="faint">{t("skills.externalBody")}</Text>
        {!active && error ? <Banner tone="error" title={t("skills.failed")}>{error}</Banner> : null}
        {items.length === 0 ? <Text tone="faint">{t("skills.empty")}</Text> : items.map(item => <Row key={item.id}
          title={item.name} sub={item.description} onClick={() => { setLocal(item); setError(""); setNotice(""); }}
          meta={item.compatibility === "external-agent" ? t("skills.external") : item.enabled ? t("skills.enabled") : t("skills.disabled")} />)}
      </Stack>
    </SectionCard>
    <Modal open={!!active} onClose={close} title={active?.name ?? t("skills.library")}>
      {active ? <Stack gap={4}>
        <Text>{detail?.description ?? active.description ?? ""}</Text>
        {detail?.version ? <Text tone="faint">{t("skills.version", { version: detail.version })}</Text> : null}
        {error ? <Banner tone="error" title={t("skills.failed")}>{error}</Banner> : null}
        {notice ? <Banner tone="info" title={t("skills.saved")}>{notice}</Banner> : null}
        {installed ? <>
          <Inline gap={2} wrap>
            <Chip>{installed.compatibility === "javascript" ? t("skills.javascript") : installed.compatibility === "text" ? t("skills.compatible") : t("skills.external")}</Chip>
            <Chip>{t("skills.fileCount", { count: installed.files.length })}</Chip>
          </Inline>
          {installed.compatibility !== "external-agent" ? <Text>{t("skills.enableBody")}</Text> : <Stack gap={2}>
            <Text>{t("skills.externalBody")}</Text>
            <Inline gap={2} wrap>{installed.requirements.map(reason => <Chip key={reason}>{requirements[reason] ?? t("skills.requirement.unknown-file")}</Chip>)}</Inline>
          </Stack>}
          <Inline gap={2} wrap>
            {installed.compatibility !== "external-agent" ? <Btn disabled={busy} variant={installed.enabled ? "outline" : "solid"}
              onClick={() => void run(() => setSkillEnabled(installed.id, !installed.enabled))}>
              {installed.enabled ? t("skills.disable") : t("skills.enable")}
            </Btn> : null}
            <Btn disabled={busy} variant="outline" onClick={() => void run(async () => {
              const path = await exportSkill(installed.id);
              if (path) setNotice(t("skills.exported", { path }));
            })}>{t("skills.export")}</Btn>
            <Btn disabled={busy} variant="ghost" onClick={() => void run(async () => {
              await deleteSkill(installed.id); setLocal(null); onClose();
            })}>{t("skills.delete")}</Btn>
          </Inline>
          <Text tone="faint">{t("skills.exportHelp")}</Text>
          <Text tone="faint">{t("skills.localOnly")}</Text>
        </> : <Stack gap={3}>
          <Text>{t("skills.importBody")}</Text>
          <Btn disabled={busy} variant="solid" onClick={() => void run(() => importSkill(active))}>
            {busy ? t("skills.importing") : t("skills.import")}
          </Btn>
        </Stack>}
      </Stack> : null}
    </Modal>
  </>;
}
