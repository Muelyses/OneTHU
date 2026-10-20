import { t as i18n, useLocale as useUiLocale } from "../../i18n/index.js";
import { Btn } from "@onethu/gui";
/**
 * 电子发票 —— info.getInvoiceList（thu-info-app invoice.tsx 移植，分页列表只读）。
 * 数据源：财务综合服务 dzpj（getList.do，webvpn 会话）；PDF 原件需 getInvoicePDF
 * 会话拉取，本页仅列表。空数据/维护态铁律见 tabStates.tsx；绝不自动整页刷新。
 */
import { useCallback, useEffect, useState } from "react";
import { Card, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { info } from "../../lib/clients.js";
import { useApp } from "../../state/context.js";
import { TabEmpty, TabError, isServiceUnavailable, logTabErr, tabErrorText } from "./tabStates.js";

type LoadState = "loading" | "error" | "ready";
/** core getInvoiceList(page) → { data: Invoice[]; count: number }（limit=20） */
type InvoicePageT = Awaited<ReturnType<typeof info.getInvoiceList>>;
type InvoiceRow = InvoicePageT["data"][number];
const PAGE_SIZE = 20;

export function InvoiceTab() {
  const uiLocale = useUiLocale();

  const { status } = useApp();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<InvoicePageT | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (status !== "ready") return;
    setState("loading");
    setUnavailable(false);
    setError(null);
    try {
      setData(await info.getInvoiceList(page));
      setState("ready");
    } catch (err) {
      logTabErr("INVOICE p" + page, err);
      setUnavailable(isServiceUnavailable(err));
      setError(tabErrorText(err));
      setState("error");
    }
  }, [status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.data ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <SectionHead
        title={i18n("pages.info.invoicetab.92341cf02c56")}
        aside={total > 0 ? i18n("pages.info.invoicetab.2beeb89ed47a", { total: String(total), page: String(page), totalPages: String(totalPages) }) : i18n("pages.info.invoicetab.6d110ca94c48")}
      />
      {state === "error" ? (
        <TabError unavailable={unavailable} text={error} onRetry={() => void load()} />
      ) : null}

      {state === "loading" && !data ? (
        <SkeletonRows rows={5} />
      ) : rows.length === 0 ? (
        <TabEmpty text={i18n("pages.info.invoicetab.4008bdf12187")} />
      ) : (
        <Card className="list">
          {rows.map((r, i) => (
            <div className="row" key={`${r.uuid}-${i}`} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
              <div className="row-when">
                <b>{(r.inv_date ?? "").slice(0, 5)}</b>
                <span>{(r.inv_date ?? "").slice(5)}</span>
              </div>
              <div className="row-main">
                <div className="row-title">{r.financial_item_name || r.inv_typeStr || i18n("pages.info.invoicetab.92341cf02c56")}</div>
                <div className="row-sub">
                  {r.financial_dept_name || ""}
                  {r.inv_note ? ` · ${r.inv_note}` : ""}
                </div>
              </div>
              <div className="row-amount">
                <b>¥{(r.inv_amount ?? 0).toFixed(2)}</b>
              </div>
            </div>
          ))}
        </Card>
      )}

      {totalPages > 1 && state === "ready" ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
          <Btn variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>{i18n("pages.info.invoicetab.c9b9ae7a6144")}</Btn>
          <span style={{ fontSize: 13, color: "var(--text-2)" }}>
            {page} / {totalPages}
          </span>
          <Btn variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>{i18n("pages.info.invoicetab.8a8542f69648")}</Btn>
        </div>
      ) : null}
    </>
  );
}
