/**
 * 「已发出的口令」管理面板（暂存箱页）。
 *
 * 解决三件事：**保存**（发过的口令都留一条台账）、**删除**（逐条撤销分享，或只清记录）、
 * **授权范围**（这条口令到底能取到什么：箱子名、内容项数与类型分布、有效期）。
 */
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Btn, Card, List, Row, Text } from "@onethu/gui";
import { confirmOk } from "../../lib/confirm.js";
import { openFormModal } from "../../lib/formModal.js";
import { showToast } from "../../state/toast.js";
import { hasPendingShareRotation, revokeShare, updateShareMeta } from "../../state/vaultShare.js";
import {
  forgetIssuedShare, issuedShareState, issuedShareTitle, issuedSharesSnapshot, markIssuedShareRevoked,
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

  /** 改口令名：云盘清单就地更新，口令本身不变。 */
  const rename = async (e: IssuedShare): Promise<void> => {
    const f = await openFormModal("给这条口令起个名字", [
      { key: "label", label: "口令名（留空 = 用箱子名）", default: e.label ?? "" },
    ]);
    if (!f) return;
    setBusy(e.id);
    try {
      const r = await updateShareMeta(e.code, { label: f.label ?? "" });
      showToast(r.ok ? (f.label ? `已改名为「${f.label}」` : "已恢复用箱子名") : r.reason ?? "改名失败：先连接清华云盘再试");
    } finally {
      setBusy("");
    }
  };

  /** 限定接收邮箱：只有这个云盘账号能打开；留空 = 谁拿到都能收。 */
  const restrict = async (e: IssuedShare): Promise<void> => {
    const f = await openFormModal("限定接收邮箱", [
      {
        key: "allowEmail",
        label: "只允许这个清华云盘邮箱接收（留空 = 不限制）",
        default: e.allowEmail ?? "",
      },
    ]);
    if (!f) return;
    const email = (f.allowEmail ?? "").trim();
    setBusy(e.id);
    try {
      const r = await updateShareMeta(e.code, { allowEmail: email });
      if(r.ok&&r.code)await navigator.clipboard.writeText(r.code).catch(()=>undefined);
      showToast(r.ok ? (r.code?"接收范围已更新，新口令已生成，旧口令已撤销":email ? `已限定为 ${email} 接收` : "已取消邮箱限制") : r.reason ?? "设置失败：先连接清华云盘再试");
    } finally {
      setBusy("");
    }
  };

  const copy = async (entry:IssuedShare):Promise<void> => {
    setBusy(entry.id);
    try {
      let code=entry.code;
      if(hasPendingShareRotation(code)||(entry.allowEmail&&!entry.cloud?.keyRepoId)){
        const result=await updateShareMeta(code,entry.allowEmail&&!entry.cloud?.keyRepoId?{allowEmail:entry.allowEmail}:{});
        if(!result.ok){showToast(result.reason??"分享升级未完成，请重试");return;}
        code=result.code??code;
      }
      await navigator.clipboard.writeText(code);
      showToast(code===entry.code?"口令已复制":"私密分享已升级，新口令已复制");
    }catch(error){showToast(error instanceof Error?error.message:"复制失败，请重试");}
    finally{setBusy("");}
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
        <Text slot="micro" tone="faint">生成后这里会留下记录：能取到哪些内容、限定谁接收、何时过期，也能逐条改名或撤销。</Text>
      ) : (
        <List divided>
          {log.entries.map((e) => {
            const st = issuedShareState(e);
            return (
              <Row
                key={e.id}
                title={`${issuedShareTitle(e)} · ${STATE_LABEL[st] ?? st}${e.label ? `（箱子「${e.boxName}」）` : ""}`}
                sub={`能取到：${scopeLabel(e)}　接收人：${e.allowEmail ?? "任何人"}　生成于 ${timeText(e.issuedAt)}${e.expiresAt ? `　有效期至 ${timeText(e.expiresAt)}` : "　不过期"}`}
                trailing={
                  <>
                    <Btn size="sm" variant="ghost" disabled={busy === e.id} onClick={() => void rename(e)}>改名</Btn>
                    <Btn size="sm" variant="ghost" disabled={busy === e.id || st !== "active"} onClick={() => void restrict(e)}>限定邮箱</Btn>
                    <Btn size="sm" variant="ghost" disabled={busy === e.id || st !== "active"} onClick={() => void copy(e)}>{e.allowEmail&&!e.cloud?.keyRepoId?"升级并复制":"复制"}</Btn>
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
