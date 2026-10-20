import { t as i18n, rich as i18nRich, useLocale as useUiLocale } from "../../i18n/index.js";
/**
 * 临时来访人员报备（预约页 · 来访报备栏）。
 *
 * 官方出处：行在清华小程序的「临时来访人员报备」入口 → visit.tsinghua.edu.cn/visitor/mobile
 * 里的「亲友来访报备」。本页把那份表单搬到应用内：登录用统一身份直连（与清小搭同一套凭据），
 * 表单结构、下拉选项、必填要求都以服务端下发的表单模型为准，不自己编。
 *
 * 三条守则：
 *  ① 提交是**真写**（校外人员据此可入校）：默认只有用户点「提交报备」并在确认框里再点一次才会发出；
 *     OH 默认只填草稿（见 state/visitDraft.ts）；用户显式要求「自动报备」时，OH 可带 submit 请求，
 *     本页在草稿填好后自动提交（2026-10-19 用户拍板）；OH 侧工具为 Harness 的 visit_fill。
 *  ② 样式零旁路：全部 @onethu/gui 组件 —— 无页面 CSS、无内联样式、无自造控件。
 *  ③ 卡片区只读官方：我的报备列表按服务端返回原样显示，不做状态文案推测。
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  Banner, Btn, Card, Checkbox, Divider, EmptyState, Field, Inline, Input, Modal, NumberField,
  Row, Select, Stack, Text, TextArea,
} from "@onethu/gui";
import {
  VISIT_MOBILE_ENTRY, VISIT_REPORT_FLOW, VisitApiError, VisitAuthRequiredError, VisitLoginError,
  type VisitFormModel, type VisitOption, type VisitReportDraft, type VisitReportRow, type VisitVisitorInput,
} from "@onethu/core";
import { clearVisitDraft, peekVisitAutoSubmit, peekVisitDraft, subscribeVisitDraft, visitDraftVersion } from "../../state/visitDraft.js";
import { visitClient, visitEnsureLogin, visitHasSession } from "../../lib/visit.js";
import { logLine } from "../../lib/clients.js";
import { openExternal } from "./openExternal.js";

const PAGE_HINT = () => i18n("pages.info.visittab.35ad08711b68");
const LOGIN_HINT = () => i18n("pages.info.visittab.0a2bc74c4275");
const LOGIN_HINT_2 = () => i18n("pages.info.visittab.861a76f9d065");
const SUBMIT_HINT = () => i18n("pages.info.visittab.b72e3073880e");
// Notes starting with "@" hold a message key and re-resolve on locale switch.
// Known keys are spelled out so the i18n checker can verify every message reference.
const resolveNote = (n: string | null): string | null => {
  if (n === "@pages.info.visittab.af16cc0b5325") return i18n("pages.info.visittab.af16cc0b5325");
  if (n === "@pages.info.visittab.65897f00fbc6") return i18n("pages.info.visittab.65897f00fbc6");
  if (n === "@pages.info.visittab.e22da1c2173d") return i18n("pages.info.visittab.e22da1c2173d");
  return n;
};
const DRAFT_FROM_OH = "pages.info.visittab.af16cc0b5325";
const AUTO_SUBMIT_FROM_OH = "pages.info.visittab.65897f00fbc6";
const CONFIRM_TITLE = () => i18n("pages.info.visittab.f733797ef61a");
const LOAD_FAIL = () => i18n("pages.info.visittab.8d66f991153b");
const SUBMIT_FAIL = () => i18n("pages.info.visittab.0b0682ac2f83");

type Phase = "need_login" | "loading" | "ready" | "error";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function prettyTime(raw: string): string {
  return raw.length >= 16 ? raw.slice(0, 16) : raw;
}
function emptyVisitor(): VisitVisitorInput {
  return { idCard: "", mobile: "" };
}
function emptyDraft(): VisitReportDraft {
  return { visitDate: today(), category: "2", reason: "5", visitors: [emptyVisitor()], confirmed: false };
}

export function VisitTab() {
  const uiLocale = useUiLocale();

  const [phase, setPhase] = useState<Phase>(() => (visitHasSession() ? "loading" : "need_login"));
  const [model, setModel] = useState<VisitFormModel | null>(null);
  const [catalogs, setCatalogs] = useState<Record<string, VisitOption[]>>({});
  const [rows, setRows] = useState<VisitReportRow[] | null>(null);
  const [mineNote, setMineNote] = useState<string | null>(null);
  const [form, setForm] = useState<VisitReportDraft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [askSubmit, setAskSubmit] = useState(false);
  /** OH 请求了自动提交：等表单/模型就绪后直接走 submit()，不弹确认框 */
  const [autoSubmit, setAutoSubmit] = useState(false);

  /** OH 送来的草稿：只填不提交；勾选确认一律由用户自己完成 */
  const draftVersion = useSyncExternalStore(subscribeVisitDraft, visitDraftVersion);
  useEffect(() => {
    const patch = peekVisitDraft();
    const wantAuto = peekVisitAutoSubmit();
    if (!patch) return;
    setForm((f) => ({
      ...f,
      ...patch,
      /* 自动报备：勾选确认由系统代表用户完成（用户已显式要求自动提交） */
      confirmed: wantAuto ? true : false,
      visitors: patch.visitors?.length ? patch.visitors : f.visitors,
    }));
    setNote(wantAuto ? `@${AUTO_SUBMIT_FROM_OH}` : `@${DRAFT_FROM_OH}`);
    if (wantAuto) setAutoSubmit(true);
    clearVisitDraft();
  }, [draftVersion]);

  const load = useCallback(async (): Promise<void> => {
    setPhase("loading");
    setError(null);
    try {
      await visitEnsureLogin();
      const m = await visitClient.formModel(VISIT_REPORT_FLOW.formDid, {
        mBizId: VISIT_REPORT_FLOW.mBizId,
        pdid: VISIT_REPORT_FLOW.pdid,
        adid: VISIT_REPORT_FLOW.adid,
      });
      setModel(m);
      // 服务端预填值（preLoad 给的）优先：这几项官方页面也是预置好的，别让用户重挑一遍
      setForm((f) => ({
        ...f,
        category: m.prefilled.mfield1 ?? f.category,
        reason: m.prefilled.mfield16 ?? f.reason,
        area: m.prefilled.mfield13 ?? f.area,
      }));
      const wanted = [...m.fields, ...m.visitorFields].filter((f) => f.catalogId);
      const pairs = await Promise.all(
        wanted.map(async (f) => [f.key, await visitClient.catalogOptions(f.key, String(f.catalogId))] as const),
      );
      setCatalogs(Object.fromEntries(pairs));
      setPhase("ready");
      try {
        const mine = await visitClient.myReports();
        setRows(mine.rows);
      } catch (e) {
        setRows([]);
        setMineNote(i18n("pages.info.visittab.727f5033a84b", { value: String(e instanceof Error ? e.message : i18n("pages.info.visittab.cc06059ac1bf")) }));
      }
    } catch (e) {
      if (e instanceof VisitLoginError) {
        setPhase("need_login");
        setNote(e.message);
        return;
      }
      if (e instanceof VisitAuthRequiredError) {
        setPhase("need_login");
        setNote(e.message);
        return;
      }
      setPhase("error");
      setError(e instanceof VisitApiError ? e.message : LOAD_FAIL());
      void logLine(i18n("pages.info.visittab.085419250804", { value: String(String(e)) }));
    }
  }, []);

  useEffect(() => {
    if (phase === "loading" && !model) void load();
  }, [phase, model, load]);

  const options = useMemo(() => ({
    category: catalogs.mfield1 ?? [],
    area: catalogs.mfield13 ?? [],
    reason: catalogs.mfield16 ?? [],
    personType: catalogs.mfield4 ?? [],
    gate: catalogs.sfield6 ?? [],
  }), [uiLocale, catalogs]);

  const setVisitor = (i: number, patch: Partial<VisitVisitorInput>): void => {
    setForm((f) => ({ ...f, visitors: f.visitors.map((v, j) => (j === i ? { ...v, ...patch } : v)) }));
  };

  const submit = async (): Promise<void> => {
    if (!model) return;
    setAskSubmit(false);
    setBusy(true);
    setNote(null);
    try {
      await visitClient.submitReport(form, model);
      setNote("@pages.info.visittab.e22da1c2173d");
      setForm(emptyDraft());
      const mine = await visitClient.myReports();
      setRows(mine.rows);
      setMineNote(null);
    } catch (e) {
      setError(e instanceof VisitApiError ? e.message : SUBMIT_FAIL());
    } finally {
      setBusy(false);
    }
  };

  /** 草稿要求自动提交：模型就绪后提交一次（submit 内部会 setAskSubmit(false)/清理提示） */
  useEffect(() => {
    if (!autoSubmit || phase !== "ready" || !model || busy) return;
    setAutoSubmit(false);
    void submit();
  }, [autoSubmit, phase, model, busy, submit]);

  if (phase === "need_login") {
    return (
      <Stack gap={3}>
        <Banner tone="info" title={i18n("pages.info.visittab.370f63b02317")}>
          {LOGIN_HINT()}
        </Banner>
        <Card>
          <Stack gap={2}>
            <Text>{LOGIN_HINT_2()}</Text>
            <Inline gap={2}>
              <Btn variant="solid" onClick={() => void load()}>{i18n("pages.info.visittab.fd9918edd55e")}</Btn>
              <Btn onClick={() => void openExternal(VISIT_MOBILE_ENTRY)}>{i18n("pages.info.visittab.1ecea7d51b20")}</Btn>
            </Inline>
            {note ? <Text tone="quiet">{resolveNote(note)}</Text> : null}
          </Stack>
        </Card>
      </Stack>
    );
  }

  if (phase === "loading" && !model) {
    return (
      <Card>
        <Text>{i18n("pages.info.visittab.6ab2a47b49be")}</Text>
      </Card>
    );
  }

  if (phase === "error") {
    return (
      <Card>
        <Stack gap={2}>
          <Text>{error ?? LOAD_FAIL()}</Text>
          <Inline gap={2}>
            <Btn variant="solid" onClick={() => void load()}>{i18n("pages.info.visittab.7bdd5ce1e298")}</Btn>
            <Btn onClick={() => void openExternal(VISIT_MOBILE_ENTRY)}>{i18n("pages.info.visittab.1ecea7d51b20")}</Btn>
          </Inline>
        </Stack>
      </Card>
    );
  }

  const gateOptions = options.gate;
  const visitors = form.visitors;

  return (
    <Stack gap={3}>
      <Banner tone="info" title={i18n("pages.info.visittab.99f047c591bb")}>{PAGE_HINT()}</Banner>
      {note ? <Banner tone="success" title={i18n("pages.info.visittab.f56c6c82203b")}>{resolveNote(note)}</Banner> : null}

      <Card>
        <Stack gap={3}>
          <Text weight="semibold">{model?.formName ?? i18n("pages.info.visittab.247ae62767cc")}</Text>

          <Inline gap={3} align="start">
            <Field label={i18n("pages.info.visittab.6a4658f8a7e1")} required>
              <Input value={form.visitDate} placeholder="2026-10-16" onChange={(v) => setForm((f) => ({ ...f, visitDate: v }))} />
            </Field>
            <Field label={i18n("pages.info.visittab.65f83437c9a8")}>
              <Select value={form.category ?? ""} options={options.category} placeholder={i18n("pages.info.visittab.095b00fc092b")} onChange={(v) => setForm((f) => ({ ...f, category: v }))} aria-label={i18n("pages.info.visittab.65f83437c9a8")} />
            </Field>
          </Inline>

          <Inline gap={3} align="start">
            <Field label={i18n("pages.info.visittab.b0861c591f25")}>
              <Select value={form.area ?? ""} options={options.area} placeholder={i18n("pages.info.visittab.8b34c0fd32be")} onChange={(v) => setForm((f) => ({ ...f, area: v }))} aria-label={i18n("pages.info.visittab.b0861c591f25")} />
            </Field>
            <Field label={i18n("pages.info.visittab.af29f087cc77")}>
              <Select value={form.reason ?? ""} options={options.reason} placeholder={i18n("pages.info.visittab.082be97daf88")} onChange={(v) => setForm((f) => ({ ...f, reason: v }))} aria-label={i18n("pages.info.visittab.af29f087cc77")} />
            </Field>
          </Inline>

          <Field label={i18n("pages.info.visittab.a8f4cf665a0d")}>
            <TextArea value={form.reasonText ?? ""} rows={2} placeholder={i18n("pages.info.visittab.b35fb6eff43f")} onChange={(v) => setForm((f) => ({ ...f, reasonText: v }))} />
          </Field>
        </Stack>
      </Card>

      <Card>
        <Stack gap={3}>
          <Text weight="semibold">{i18n("pages.info.visittab.50fcc24a609a")}</Text>
          <Inline gap={3} align="start">
            <Field label={i18n("pages.info.visittab.50b5b1d2abef")}>
              <Input value={form.inviterName ?? ""} onChange={(v) => setForm((f) => ({ ...f, inviterName: v }))} />
            </Field>
            <Field label={i18n("pages.info.visittab.6f52cc94db65")}>
              <Input value={form.inviterMobile ?? ""} type="tel" onChange={(v) => setForm((f) => ({ ...f, inviterMobile: v }))} />
            </Field>
          </Inline>
          <Inline gap={3} align="start">
            <Field label={i18n("pages.info.visittab.7cde84399a2c")}>
              <Input value={form.inviterIdCard ?? ""} onChange={(v) => setForm((f) => ({ ...f, inviterIdCard: v }))} />
            </Field>
            <Field label={i18n("pages.info.visittab.2a4c86ea2def")}>
              <NumberField value={form.quota ?? 1} min={1} max={20} onChange={(n) => setForm((f) => ({ ...f, quota: n }))} />
            </Field>
          </Inline>
          <Field label={i18n("pages.info.visittab.f265a7b34089")} hint={i18n("pages.info.visittab.94b9ec80f3bb")}>
            <Input value={form.passcode ?? ""} onChange={(v) => setForm((f) => ({ ...f, passcode: v }))} />
          </Field>
        </Stack>
      </Card>

      <Card>
        <Stack gap={3}>
          <Inline justify="between" align="center">
            <Text weight="semibold">{i18n("pages.info.visittab.a90002b0961c")}</Text>
            <Btn size="sm" onClick={() => setForm((f) => ({ ...f, visitors: [...f.visitors, emptyVisitor()] }))}>{i18n("pages.info.visittab.421d678098ad")}</Btn>
          </Inline>
          {visitors.map((v, i) => (
            <Stack key={i} gap={2}>
              {i > 0 ? <Divider /> : null}
              <Inline gap={3} align="start">
                <Field label={i18n("pages.info.visittab.178375c36ece")}>
                  <Input value={v.name ?? ""} onChange={(x) => setVisitor(i, { name: x })} />
                </Field>
                <Field label={i18n("pages.info.visittab.c425e1cfd31d")} required>
                  <Input value={v.idCard} onChange={(x) => setVisitor(i, { idCard: x })} />
                </Field>
              </Inline>
              <Inline gap={3} align="start">
                <Field label={i18n("pages.info.visittab.6f52cc94db65")} required>
                  <Input value={v.mobile} type="tel" onChange={(x) => setVisitor(i, { mobile: x })} />
                </Field>
                <Field label={i18n("pages.info.visittab.4018b809d4b2")} hint={i18n("pages.info.visittab.7a8f9a9b056c")}>
                  <Input value={v.plate ?? ""} onChange={(x) => setVisitor(i, { plate: x })} />
                </Field>
              </Inline>
              <Inline gap={3} align="start">
                <Field label={i18n("pages.info.visittab.7b5d518d3cfe")}>
                  <Select value={v.gate ?? ""} options={gateOptions} placeholder={i18n("pages.info.visittab.9b68dcff364d")} onChange={(x) => setVisitor(i, { gate: x })} aria-label={i18n("pages.info.visittab.7b5d518d3cfe")} />
                </Field>
                <Field label={i18n("pages.info.visittab.af72f5d45ca1")}>
                  <Input value={v.org ?? ""} onChange={(x) => setVisitor(i, { org: x })} />
                </Field>
              </Inline>
              {visitors.length > 1 ? (
                <Inline>
                  <Btn size="sm" onClick={() => setForm((f) => ({ ...f, visitors: f.visitors.filter((_, j) => j !== i) }))}>{i18n("pages.info.visittab.70db7ae136ad")}</Btn>
                </Inline>
              ) : null}
            </Stack>
          ))}
          <Checkbox
            checked={form.confirmed}
            onChange={(on) => setForm((f) => ({ ...f, confirmed: on }))}
            label={model?.confirmLabel || i18n("pages.info.visittab.eda19ba6e037")}
          />
          <Inline gap={2}>
            <Btn variant="solid" disabled={!form.confirmed || busy} loading={busy} onClick={() => setAskSubmit(true)}>{i18n("pages.info.visittab.f7c356bbe1c2")}</Btn>
            <Btn onClick={() => void openExternal(VISIT_MOBILE_ENTRY)}>{i18n("pages.info.visittab.1ecea7d51b20")}</Btn>
          </Inline>
          <Text tone="quiet" size="sm">{SUBMIT_HINT()}</Text>
          {error ? <Text tone="error">{error}</Text> : null}
        </Stack>
      </Card>

      <Card>
        <Stack gap={2}>
          <Text weight="semibold">{i18n("pages.info.visittab.83a23e30465b")}</Text>
          {mineNote ? <Text tone="quiet">{mineNote}</Text> : null}
          {rows === null ? (
            <Text tone="quiet">{i18n("pages.info.visittab.86b6d0d63062")}</Text>
          ) : rows.length === 0 ? (
            <EmptyState title={i18n("pages.info.visittab.50d72b73d567")} hint={i18n("pages.info.visittab.609175d34db8")} />
          ) : (
            <Stack gap={1}>
              {rows.map((r) => (
                <Row
                  key={r.mBizId}
                  title={prettyTime(r.visitDate)}
                  sub={i18n("pages.info.visittab.1fe96980cdde", { value: String(prettyTime(r.createdAt)) })}
                  trailing={<Text tone="quiet">{i18nRich("pages.info.visittab.7ca7f03d80cd", { status: r.status })}</Text>}
                />
              ))}
            </Stack>
          )}
        </Stack>
      </Card>

      <Modal
        open={askSubmit}
        onClose={() => setAskSubmit(false)}
        title={CONFIRM_TITLE()}
        foot={
          <Inline gap={2} justify="end">
            <Btn onClick={() => setAskSubmit(false)}>{i18n("pages.info.visittab.d8bd7eda6680")}</Btn>
            <Btn variant="solid" onClick={() => void submit()}>{i18n("pages.info.visittab.9ebe36f8cf23")}</Btn>
          </Inline>
        }
      >
        <Stack gap={2}>
          <Text>{i18n("pages.info.visittab.67f6b1d5a484", { visitDate: String(form.visitDate), length: String(form.visitors.length) })}</Text>
          <Text tone="quiet">{SUBMIT_HINT()}</Text>
        </Stack>
      </Modal>
    </Stack>
  );
}
