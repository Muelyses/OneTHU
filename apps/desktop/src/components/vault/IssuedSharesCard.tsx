/**
 * 「已发出的口令」管理面板（暂存箱页）。
 *
 * 解决三件事：**保存**（发过的口令都留一条台账）、**删除**（逐条撤销分享，或只清记录）、
 * **授权范围**（这条口令到底能取到什么：箱子名、内容项数与类型分布、有效期）。
 */
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Btn, Card, List, Row, Text } from "@onethu/gui";
import { confirmOk } from "../../lib/confirm.js";
import { showToast } from "../../state/toast.js";
import { revokeShare } from "../../state/vaultShare.js";
import {
  forgetIssuedShare, issuedShareState, issuedSharesSnapshot, markIssuedShareRevoked,
  payloadOfIssuedShare, scopeLabel, subscribeIssuedShares, type IssuedShare,
} from "../../state/vaultShareLog.js";

const STATE_LABEL: Record<string, string> = { active: "有效", revoked: "已撤销", expired: "已过期" };

function timeText(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function IssuedSharesCard(): ReactNode {
  const log = useSyncExternalStore(subscribeIssuedShares, issuedSharesSnapshot, issuedSharesSnapshot);
  const [busy, setBusy] = useState("");

  const revoke = async (e: IssuedShare): Promise<void> => {
    if (!e.cloud?.shareToken) {
      showToast("这条口令没有绑定云盘（旧版本地口令），只能删除记录");
      return;
    }
    if (!(await confirmOk(`撤销「${e.boxName}」的这条口令？撤销后对方将无法再读取。`))) return;
    setBusy(e.id);
    try {
      const ok = await revokeShare(payloadOfIssuedShare(e));
      if (ok) {
        markIssuedShareRevoked(e.id);
        showToast("分享已撤销");
      } else {
        showToast("撤销未完成：请先连接清华云盘");
      }
    } catch (err) {
      showToast(`撤销失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy("");
    }
  };

  const forget = async (e: IssuedShare): Promise<void> => {
    if (issuedShareState(e) === "active" && !(await confirmOk("这条口令还有效，删除记录后对方仍能读取。确定只删记录？"))) return;
    forgetIssuedShare(e.id);
    showToast("记录已删除");
  };

  return (
    <Card>
      <div className="vault-actions">
        <Text slot="label">已发出的口令</Text>
        <Text slot="micro" tone="faint">{log.entries.length ? `共 ${log.entries.length} 条` : "还没有发出过口令"}</Text>
      </div>
      {log.entries.length === 0 ? (
        <Text slot="micro" tone="faint">生成后这里会留下记录：哪个箱子、能取到哪些内容、何时过期，可逐条撤销。</Text>
      ) : (
        <List divided>
          {log.entries.map((e) => {
            const st = issuedShareState(e);
            return (
              <Row
                key={e.id}
                title={`${e.boxName} · ${STATE_LABEL[st] ?? st}`}
                sub={`授权范围：${scopeLabel(e)}　生成于 ${timeText(e.issuedAt)}${e.expiresAt ? `　有效期至 ${timeText(e.expiresAt)}` : "　不过期"}`}
                trailing={
                  <>
                    <Btn size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(e.code).then(() => showToast("口令已复制")).catch(() => showToast("请手动复制"))}>复制</Btn>
                    <Btn size="sm" variant="ghost" tone="error" disabled={busy === e.id || st !== "active"} onClick={() => void revoke(e)}>{busy === e.id ? "撤销中…" : "撤销"}</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => void forget(e)}>删除记录</Btn>
                  </>
                }
              />
            );
          })}
        </List>
      )}
    </Card>
  );
}
