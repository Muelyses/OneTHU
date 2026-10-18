/**
 * 通讯录与名片：我的名片、名片夹（好友 / 组织）、组织名片。
 *
 * 数据仍在 state/nameCard.ts，共享云盘 / 留言 / 传文件走 lib/cloudFolder 与 state/friendChannel；
 * 本文件只做展示层重组：拟物纸卡（IdentityCard）+ 卡片夹网格 + Modal 大卡。
 * - 我的名片：settings 浮层「我的 → 我的名片」与通讯录页共用同一套编辑入口；
 * - 名片夹：搜索 / 全部·好友·组织 筛选 / 星标 / 卡片堆叠 / 点击弹出大卡；
 * - 组织名片：建卡、进暂存箱、复制加入方式；组织成员与邀请口令在 OrganizationSection。
 */
import { IdentityCard } from "./IdentityCard.js";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Btn, Card, Chip, EmptyState, IconBtn, IconCamera, IconCloud, IconFile, IconIn, IconMail, IconPen,
  IconPlus, IconStar, IconTrash, Inline, KeyValue, List, Modal, Row, SearchField, Section, Segment,
  Stack, Text,
} from "@onethu/gui";
import { defineSearchRows } from "../state/searchRows.js";
import { getCampusSnapshot, subscribeCampusData } from "../state/data.js";
import {
  ensureSeafileLoaded, refreshSeafileAccount, useSeafile,
} from "../state/seafile.js";
import { goEntry } from "./Layout.js";
import { openFormModal } from "../lib/formModal.js";
import { confirmOk } from "../lib/confirm.js";
import { showToast } from "../state/toast.js";
import { pickFile, fileToBytes } from "../lib/attach.js";
import { bytesToBase64 } from "../lib/imageSave.js";
import { addToVault, vaultSnapshot, type VaultCatch } from "../state/vault.js";
import {
  CARD_LIMITS, addContact, orgCardCatch, personalCardCatch, removeContact, removeOrgCard,
  resolveCloudEmail, savePersonalCard, setContactShare, upsertOrgCard, useCards,
  type ContactCard, type OrgCard, type PersonalCard,
} from "../state/nameCard.js";
import { prepareAndShareFolder } from "../lib/cloudFolder.js";
import {
  openBidirectionalShare, sendFriendFile, sendFriendText, useFriendMessages,
} from "../state/friendChannel.js";
import { stageFromPicker } from "../lib/fileChannel.js";

defineSearchRows([
  {
    id: "set-namecard", tab: "账号", section: "我的名片", title: "我的名片",
    aliases: ["名片", "头像", "个人简介", "社交媒体", "个人网址"], desc: "头像、网址、社交、手机号、简介",
    breadcrumb: ["设置", "账号", "我的名片", "我的名片"],
    go: () => goEntry("profile"),
  },
]);

type ContactFilter = "all" | ContactCard["kind"];

/** 星标好友（纯界面偏好）：与人名片数据解耦，不进同步。 */
const STAR_KEY = "onethu.contacts.starred.v1";

function readStars(): string[] {
  try {
    const raw = localStorage.getItem(STAR_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeStars(ids: string[]): void {
  try {
    localStorage.setItem(STAR_KEY, JSON.stringify(ids));
  } catch {
    /* 配额满：星标只留内存态 */
  }
}

function contactBrief(c: ContactCard): string {
  return c.kind === "organization"
    ? (c.card as OrgCard).brief || "组织邀请"
    : (c.card as PersonalCard).bio || "还没有写简介";
}

function contactLink(c: ContactCard): string {
  return c.kind === "organization"
    ? (c.card as OrgCard).joinUrl
    : [(c.card as PersonalCard).website, (c.card as PersonalCard).social, (c.card as PersonalCard).phone]
      .filter(Boolean)
      .join(" · ");
}

function contactCatch(c: ContactCard): VaultCatch {
  return {
    type: "payload",
    title: c.name,
    payload: { kind: "namecard", card: c.card, org: c.kind === "organization" },
    source: "通讯录",
  };
}

/**
 * 云盘账号探测只做一次（整个会话）：ensureSeafileLoaded 已缓存配置，refresh 取一次 email 即可。
 * 浏览器 dev 下没有 Tauri 命令，失败按"未配置"降级，不阻塞名片。
 */
let seafileEmailProbe: Promise<void> | null = null;
function probeSeafileEmail(): Promise<void> {
  seafileEmailProbe ??= ensureSeafileLoaded()
    .then(() => refreshSeafileAccount())
    .catch(() => undefined);
  return seafileEmailProbe;
}

/**
 * 本人清华云盘邮箱：应用本来就能识别（名片已存 → 云盘账号 → 校园数据 → 已配置的 CalDAV），
 * 不再让用户手填。resolveCloudEmail 只读快照；两个订阅只负责在数据到达后触发重渲染。
 */
function useCloudEmail(): string {
  const seafile = useSeafile();
  const [campusEmail, setCampusEmail] = useState(() => (getCampusSnapshot()?.user?.email ?? "").trim());
  useEffect(() => {
    const sync = (): void => setCampusEmail((getCampusSnapshot()?.user?.email ?? "").trim());
    sync();
    return subscribeCampusData(sync);
  }, []);
  useEffect(() => {
    void probeSeafileEmail();
  }, []);
  return resolveCloudEmail() || seafile.account?.email?.trim() || campusEmail;
}

/** 云盘邮箱只自动补一次（整个会话）：用户自己清空后不再覆盖。 */
let autoCloudEmailFilled = false;

/** 我的名片：编辑资料 / 换头像 / 放进暂存箱（浮层与通讯录共用）。 */
function usePersonalActions() {
  const doc = useCards();
  const p = doc.personal;
  const [busy, setBusy] = useState(false);
  const cloudEmail = useCloudEmail();
  useEffect(() => {
    if (autoCloudEmailFilled || !cloudEmail) return;
    autoCloudEmailFilled = true;
    if (!p.cloudEmail) savePersonalCard({ cloudEmail });
  }, [cloudEmail, p.cloudEmail]);

  const edit = useCallback(async (): Promise<void> => {
    const f = await openFormModal("编辑我的名片", [
      { key: "name", label: "名字", required: true, default: p.name },
      { key: "website", label: "个人网址", default: p.website },
      { key: "social", label: "社交媒体", default: p.social },
      { key: "phone", label: "手机号", default: p.phone },
      {
        key: "cloudEmail",
        label: "清华云盘邮箱（已自动识别，可修改）",
        placeholder: "留空则使用应用自动识别的邮箱",
        default: p.cloudEmail || cloudEmail || "",
      },
      { key: "bio", label: "个人简介（≤120 字，碰一碰要短）", kind: "textarea", default: p.bio },
    ]);
    if (f) savePersonalCard(f);
  }, [p, cloudEmail]);

  const pickAvatar = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const f = await pickFile();
      if (!f) return;
      if (!f.mime.startsWith("image/")) throw new Error("只支持图片");
      if (f.size > 200 * 1024) throw new Error("头像请控制在 200KB 以内");
      const bytes = await fileToBytes(f, 200 * 1024);
      savePersonalCard({ avatar: `data:${f.mime};base64,${bytesToBase64(bytes)}` });
      showToast("头像已更新");
    } catch (e) {
      showToast(`头像设置失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const toVault = useCallback((): void => {
    const r = addToVault(personalCardCatch());
    if (r.ok) showToast("名片已放进暂存箱");
    else showToast(r.reason === "duplicate" ? "暂存箱里已经有这张名片了" : "暂存箱暂时不可用");
  }, []);

  return { personal: p, edit, pickAvatar, toVault, busy, cloudEmail };
}

/* ══════════════ 我的名片 ══════════════ */

function cloudEmailText(email: string): string {
  return email || "未识别 · 好友互传时需要";
}

function PersonalCardBlock(): ReactNode {
  const { personal, edit, pickAvatar, toVault, busy, cloudEmail } = usePersonalActions();
  return (
    <div className="identity-panel">
      <div className="identity-panel-show">
        <IdentityCard card={personal} variant="hero" />
        <Inline gap={2} wrap className="identity-panel-actions">
          <Btn variant="solid" tone="brand" icon={<IconPen size="sm" />} onClick={() => void edit()}>
            编辑资料
          </Btn>
          <Btn variant="outline" icon={<IconCamera size="sm" />} disabled={busy} onClick={() => void pickAvatar()}>
            换头像
          </Btn>
          <Btn variant="ghost" icon={<IconIn size="sm" />} onClick={toVault}>
            放进暂存箱
          </Btn>
        </Inline>
      </div>
      <Card className="identity-panel-meta">
        <Section title="名片信息" hint="碰一碰 / 分享口令都用这一张" />
        <KeyValue
          rows={[
            { k: "名字", v: personal.name || "未填写" },
            { k: "个人网址", v: personal.website || "未填写" },
            { k: "社交媒体", v: personal.social || "未填写" },
            { k: "手机号", v: personal.phone || "未填写" },
            { k: "清华云盘邮箱", v: cloudEmailText(cloudEmail) },
          ]}
        />
        <Text slot="micro" tone="faint">
          名片只在你主动分享（放进暂存箱 / 口令 / 碰一碰）时才离开这台设备。
        </Text>
      </Card>
    </div>
  );
}

/* ══════════════ 组织名片 ══════════════ */

export function OrgCardsSection(): ReactNode {
  const doc = useCards();
  const [openId, setOpenId] = useState<string | null>(null);
  const openOrg = doc.orgs.find((o) => o.id === openId) ?? null;
  /* 关闭动画期间还要画上一张卡：内容先留在 ref 里，等 Modal 退场完再自然换掉 */
  const shownRef = useRef<OrgCard | null>(null);
  useEffect(() => {
    if (openOrg) shownRef.current = openOrg;
  }, [openOrg]);
  const shown = openOrg ?? shownRef.current;

  const addOrg = useCallback(async (): Promise<void> => {
    const f = await openFormModal("新建组织名片", [
      { key: "name", label: "组织名称", required: true },
      { key: "brief", label: `一句话简介（≤${CARD_LIMITS.orgBrief} 字）`, kind: "textarea" },
      { key: "joinUrl", label: "加入方式 / 邀请链接" },
    ]);
    if (f?.name) {
      upsertOrgCard({ name: f.name, brief: f.brief, joinUrl: f.joinUrl });
      showToast("组织名片已保存");
    }
  }, []);

  const stageOrg = useCallback((org: OrgCard): void => {
    const r = addToVault(orgCardCatch(org));
    showToast(r.ok ? "组织名片已放进暂存箱" : r.reason === "duplicate" ? "暂存箱里已有了" : "暂存箱暂时不可用");
  }, []);

  const copyJoin = useCallback((org: OrgCard): void => {
    if (!org.joinUrl) return;
    void navigator.clipboard.writeText(org.joinUrl).then(
      () => showToast("加入方式已复制"),
      () => showToast("复制失败，请手动复制"),
    );
  }, []);

  return (
    <div className="org-cards">
      <Section
        className="org-cards-head"
        title="组织名片"
        hint="把组织邀请做成一张递得出去的卡"
        aside={
          <Btn size="sm" variant="outline" icon={<IconPlus size="sm" />} onClick={() => void addOrg()}>
            新建组织名片
          </Btn>
        }
      />
      {doc.orgs.length === 0 ? (
        <EmptyState
          icon={<IconIn size="lg" />}
          title="还没有组织名片"
          hint="写名称、简介和加入方式，就得到一张可以放进暂存箱递给别人的组织卡。"
          action={
            <Btn variant="solid" tone="brand" onClick={() => void addOrg()}>
              新建组织名片
            </Btn>
          }
        />
      ) : (
        <div className="contact-deck">
          {doc.orgs.map((o) => (
            <div className="contact-slot" key={o.id}>
              <Btn
                className="contact-card-pick"
                aria-label={`打开${o.name}的组织名片`}
                data-vault-catch={JSON.stringify(orgCardCatch(o))}
                onClick={() => setOpenId(o.id)}
              >
                <IdentityCard card={o} organization />
              </Btn>
            </div>
          ))}
        </div>
      )}
      <Modal
        open={Boolean(openOrg)}
        onClose={() => setOpenId(null)}
        title="组织名片"
        className="contact-detail-modal"
        size="md"
      >
        {shown ? (
          <div className="contact-detail">
            <div className="contact-detail-stage">
              <IdentityCard card={shown} organization variant="detail" />
            </div>
            <Stack gap={4}>
              <KeyValue
                rows={[
                  { k: "组织", v: shown.name },
                  { k: "简介", v: shown.brief || "未填写" },
                  { k: "加入方式", v: shown.joinUrl || "未填写" },
                ]}
              />
              <Inline gap={2} wrap>
                <Btn size="sm" variant="solid" tone="brand" icon={<IconIn size="sm" />} onClick={() => stageOrg(shown)}>
                  放进暂存箱
                </Btn>
                <Btn size="sm" variant="ghost" disabled={!shown.joinUrl} onClick={() => copyJoin(shown)}>
                  复制加入方式
                </Btn>
                <Btn
                  size="sm"
                  variant="ghost"
                  tone="error"
                  icon={<IconTrash size="sm" />}
                  onClick={() => {
                    void confirmOk(`删除组织名片「${shown.name}」？`).then((ok) => {
                      if (!ok) return;
                      removeOrgCard(shown.id);
                      setOpenId(null);
                      showToast("组织名片已删除");
                    });
                  }}
                >
                  删除
                </Btn>
              </Inline>
            </Stack>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

/* ══════════════ 名片夹 ══════════════ */

export function ContactCabinet(): ReactNode {
  const doc = useCards();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ContactFilter>("all");
  const [starred, setStarred] = useState<ReadonlySet<string>>(() => new Set(readStars()));
  const [onlyStarred, setOnlyStarred] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [selfOpen, setSelfOpen] = useState(false);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);

  const focused = doc.contacts.find((c) => c.id === focusedId) ?? null;
  const shownRef = useRef<ContactCard | null>(null);
  useEffect(() => {
    if (focused) shownRef.current = focused;
  }, [focused]);
  const shown = focused ?? shownRef.current;
  const channelMessages = useFriendMessages(channelId ?? "");

  const toggleStar = useCallback((id: string): void => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeStars([...next]);
      return next;
    });
  }, []);

  const importContacts = useCallback((): void => {
    let ok = 0;
    let dup = 0;
    for (const box of vaultSnapshot().boxes) {
      for (const it of box.items) {
        const payload = it.payload as { kind?: string; card?: Record<string, unknown>; org?: boolean } | undefined;
        if (payload?.kind !== "namecard" || !payload.card) continue;
        const r = addContact(payload.org ? "organization" : "personal", payload.card as never, it.sub ?? "");
        if (r.ok) ok++;
        else if (r.reason === "duplicate") dup++;
      }
    }
    if (ok) showToast(`已加入通讯录：${ok} 张`);
    else showToast(dup ? "这些名片已经在通讯录里了" : "暂存箱里还没有名片：先把名片放进暂存箱");
  }, []);

  const shareCloud = useCallback(async (contactId: string, name: string): Promise<void> => {
    setSharingId(contactId);
    try {
      const share = await prepareAndShareFolder(`/Friends/${contactId}`, `${name} 与我的共享云盘`);
      setContactShare(contactId, {
        repoId: share.repoId, path: share.path, shareUrl: share.shareUrl, shareToken: share.shareToken,
        expiresAt: share.expiresAt, createdAt: Date.now(),
      });
      await navigator.clipboard.writeText(share.shareUrl).catch(() => undefined);
      const twoWay = await openBidirectionalShare(contactId);
      showToast(twoWay.ok ? "共享云盘已创建，并已开通好友双向写入" : "共享云盘已创建：链接已复制；对方填云盘邮箱后可开通双向");
    } catch (e) {
      showToast(`共享云盘创建失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSharingId(null);
    }
  }, []);

  const sendMessage = useCallback(async (): Promise<void> => {
    if (!channelId) return;
    const f = await openFormModal("给好友留言", [{ key: "text", label: "留言（同步写进共享云盘）", kind: "textarea", required: true }]);
    if (!f?.text) return;
    const r = await sendFriendText(channelId, f.text);
    showToast(r.ok ? "留言已写入共享云盘" : `留言只留在本机：${r.reason}`);
  }, [channelId]);

  const sendFile = useCallback(async (): Promise<void> => {
    if (!channelId) return;
    try {
      const staged = await stageFromPicker(true);
      let ok = 0;
      for (const f of staged) {
        const r = await sendFriendFile(channelId, { name: f.name, localPath: f.localPath, size: f.size });
        if (r.ok) ok++;
        else showToast(`「${f.name}」上传失败：${r.reason}`);
      }
      if (ok) showToast(`已把 ${ok} 个文件放进共享云盘`);
    } catch (e) {
      showToast(`文件选择失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [channelId]);

  const { personal, edit, pickAvatar, toVault, busy, cloudEmail } = usePersonalActions();

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return doc.contacts
      .filter((c) => filter === "all" || c.kind === filter)
      .filter((c) => !onlyStarred || starred.has(c.id))
      .filter((c) => !q || `${c.name} ${c.note} ${contactBrief(c)} ${contactLink(c)}`.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => Number(starred.has(b.id)) - Number(starred.has(a.id)) || b.addedAt - a.addedAt);
  }, [doc.contacts, filter, onlyStarred, query, starred]);

  const starButton = useCallback(
    (c: ContactCard, round = true): ReactNode => (
      <IconBtn
        className={round ? "contact-star" : undefined}
        label={`${starred.has(c.id) ? "取消星标：" : "星标："}${c.name}`}
        selected={starred.has(c.id)}
        size="sm"
        icon={<IconStar size="sm" />}
        onClick={(e) => {
          e.stopPropagation();
          toggleStar(c.id);
        }}
      />
    ),
    [starred, toggleStar],
  );

  const closeDetail = useCallback((): void => {
    setFocusedId(null);
    setChannelId(null);
  }, []);

  const filterActive = query.trim() !== "" || onlyStarred || filter !== "all";
  /* 筛选/搜索/只看星标时，自己的名片让位给搜索结果 */
  const showMine = !filterActive;

  return (
    <div className="contact-cabinet">
      <div className="contact-toolbar">
        <SearchField
          className="contact-search"
          value={query}
          onChange={setQuery}
          placeholder="搜索好友、组织或简介"
          aria-label="搜索好友或组织"
        />
        <Inline gap={2} wrap>
          <Segment
            value={filter}
            onChange={(v) => setFilter(v as ContactFilter)}
            options={[
              { value: "all", label: "全部" },
              { value: "personal", label: "好友" },
              { value: "organization", label: "组织" },
            ]}
          />
          <Chip icon={<IconStar size="sm" />} selected={onlyStarred} onClick={() => setOnlyStarred((v) => !v)}>
            星标
          </Chip>
          <Btn variant="outline" icon={<IconIn size="sm" />} onClick={importContacts}>
            从暂存箱收名片
          </Btn>
        </Inline>
      </div>

      <div className="contact-deck">
        {showMine ? (
          <div className="contact-slot is-mine">
            <Btn
              className="contact-card-pick"
              aria-label="打开我的名片"
              data-vault-catch={JSON.stringify(personalCardCatch())}
              onClick={() => setSelfOpen(true)}
            >
              <IdentityCard card={personal} variant="hero" />
            </Btn>
          </div>
        ) : null}
        {list.map((c) => (
          <div className="contact-slot" key={c.id}>
            <Btn
              className="contact-card-pick"
              aria-label={`打开${c.name}的名片`}
              data-vault-catch={JSON.stringify(contactCatch(c))}
              onClick={() => setFocusedId(c.id)}
            >
              <IdentityCard card={c.card} organization={c.kind === "organization"} />
            </Btn>
            {starButton(c)}
          </div>
        ))}
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={<IconIn size="lg" />}
          title={filterActive ? "没有匹配的名片" : "还没有收到别人的名片"}
          hint={
            filterActive
              ? "换个关键词或切回「全部」；星标好友会排在卡片夹最前面。"
              : "名片夹里现在只有你自己的名片；别人的名片（暂存箱 / 分享口令 / 碰一碰）收进来后会排在这里。"
          }
          action={
            <Inline gap={2} wrap>
              <Btn variant="solid" tone="brand" icon={<IconIn size="sm" />} onClick={importContacts}>
                从暂存箱收名片
              </Btn>
              {filterActive ? (
                <Btn variant="ghost" onClick={() => { setQuery(""); setOnlyStarred(false); setFilter("all"); }}>
                  清空筛选
                </Btn>
              ) : null}
            </Inline>
          }
        />
      ) : null}

      {/* 我的名片大卡 */}
      <Modal open={selfOpen} onClose={() => setSelfOpen(false)} title="我的名片" className="contact-detail-modal" size="md">
        <div className="contact-detail">
          <div className="contact-detail-stage">
            <IdentityCard card={personal} variant="detail" />
          </div>
          <Stack gap={4}>
            <KeyValue
              rows={[
                { k: "名字", v: personal.name || "未填写" },
                { k: "简介", v: personal.bio || "未填写" },
                { k: "联系方式", v: [personal.website, personal.social, personal.phone].filter(Boolean).join(" · ") || "未填写" },
                { k: "清华云盘邮箱", v: cloudEmailText(cloudEmail) },
              ]}
            />
            <Inline gap={2} wrap>
              <Btn size="sm" variant="solid" tone="brand" icon={<IconPen size="sm" />} onClick={() => void edit()}>
                编辑资料
              </Btn>
              <Btn size="sm" variant="outline" icon={<IconCamera size="sm" />} disabled={busy} onClick={() => void pickAvatar()}>
                换头像
              </Btn>
              <Btn size="sm" variant="ghost" icon={<IconIn size="sm" />} onClick={toVault}>
                放进暂存箱
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => { setSelfOpen(false); goEntry("profile"); }}>
                在「我的」里管理
              </Btn>
            </Inline>
          </Stack>
        </div>
      </Modal>

      {/* 联系人大卡：详情一律弹出，不塞回页面 */}
      <Modal
        open={Boolean(focused)}
        onClose={closeDetail}
        title={shown ? `${shown.name} · 名片` : "名片"}
        className="contact-detail-modal"
        size="md"
      >
        {shown ? (
          <div className="contact-detail">
            <div className="contact-detail-stage">
              <IdentityCard card={shown.card} organization={shown.kind === "organization"} variant="detail" />
            </div>
            <Stack gap={4}>
              <KeyValue
                rows={[
                  { k: "类型", v: shown.kind === "organization" ? "组织" : "好友" },
                  { k: "备注", v: shown.note || "未填写" },
                  { k: "简介", v: contactBrief(shown) },
                  { k: shown.kind === "organization" ? "加入方式" : "联系方式", v: contactLink(shown) || "未填写" },
                  { k: "共享云盘", v: shown.shared?.shareUrl ? "已创建（链接可复制）" : "未创建" },
                ]}
              />
              <Inline gap={2} wrap>
                <Btn size="sm" variant="solid" tone="brand" icon={<IconIn size="sm" />} onClick={() => {
                  const r = addToVault(contactCatch(shown));
                  showToast(r.ok ? "名片已放进暂存箱" : r.reason === "duplicate" ? "暂存箱里已经有这张名片了" : "暂存箱暂时不可用");
                }}>
                  放进暂存箱
                </Btn>
                {shown.shared?.shareUrl ? (
                  <Btn size="sm" variant="outline" icon={<IconCloud size="sm" />} onClick={() => {
                    void navigator.clipboard.writeText(shown.shared!.shareUrl!).then(
                      () => showToast("共享链接已复制"),
                      () => showToast("复制失败，请手动复制"),
                    );
                  }}>
                    复制共享链接
                  </Btn>
                ) : (
                  <Btn size="sm" variant="outline" icon={<IconCloud size="sm" />} disabled={sharingId === shown.id} onClick={() => void shareCloud(shown.id, shown.name)}>
                    {sharingId === shown.id ? "创建中…" : "共享云盘"}
                  </Btn>
                )}
                {shown.shared && !shown.shared.sharedWith && (shown.card as { cloudEmail?: string }).cloudEmail ? (
                  <Btn size="sm" variant="ghost" onClick={() => void openBidirectionalShare(shown.id).then((r) => showToast(r.ok ? "已开通双向写入" : `开通失败：${r.reason}`))}>
                    开通双向
                  </Btn>
                ) : null}
                <Btn size="sm" variant="ghost" icon={<IconMail size="sm" />} onClick={() => setChannelId(channelId === shown.id ? null : shown.id)}>
                  {channelId === shown.id ? "收起通道" : "好友通道"}
                </Btn>
                {shown.kind === "organization" && (shown.card as OrgCard).joinUrl ? (
                  <Btn size="sm" variant="ghost" onClick={() => {
                    void navigator.clipboard.writeText((shown.card as OrgCard).joinUrl).then(
                      () => showToast("加入方式已复制"),
                      () => showToast("复制失败，请手动复制"),
                    );
                  }}>
                    复制加入方式
                  </Btn>
                ) : null}
                {starButton(shown, false)}
                <Btn size="sm" variant="ghost" tone="error" icon={<IconTrash size="sm" />} onClick={() => {
                  void confirmOk(`从通讯录删除「${shown.name}」？`).then((ok) => {
                    if (!ok) return;
                    removeContact(shown.id);
                    closeDetail();
                  });
                }}>
                  删除
                </Btn>
              </Inline>

              {channelId === shown.id ? (
                <div className="contact-channel">
                  <Inline justify="between" gap={2}>
                    <Text slot="label" weight="semibold">好友通道</Text>
                    <Btn variant="plain" onClick={() => setChannelId(null)}>关闭</Btn>
                  </Inline>
                  {channelMessages.length === 0 ? (
                    <Text slot="micro" tone="faint">
                      还没有留言。留言 / 文件会写进你们的共享云盘；对方通过共享链接查看。
                    </Text>
                  ) : (
                    <List divided>
                      {channelMessages.map((m) => (
                        <Row
                          key={m.id}
                          flush
                          leading={m.kind === "file" ? <IconFile size="sm" /> : <IconMail size="sm" />}
                          title={m.kind === "file" ? "文件：" + m.text : m.text}
                          sub={m.cloudPath ? "已写入共享云盘" : "仅本机"}
                        />
                      ))}
                    </List>
                  )}
                  <Inline gap={2} wrap>
                    <Btn variant="solid" tone="brand" icon={<IconMail size="sm" />} onClick={() => void sendMessage()}>留言</Btn>
                    <Btn variant="ghost" icon={<IconFile size="sm" />} onClick={() => void sendFile()}>传文件</Btn>
                  </Inline>
                </div>
              ) : null}
            </Stack>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

/* ══════════════ 对外入口 ══════════════ */

export function NameCardSection({ view = "all" }: { view?: "all" | "personal" | "contacts" }): ReactNode {
  if (view === "personal") {
    return (
      <Stack gap={6}>
        <PersonalCardBlock />
        <OrgCardsSection />
      </Stack>
    );
  }
  return (
    <Stack gap={6}>
      {view === "all" ? <PersonalCardBlock /> : null}
      <ContactCabinet />
      {view === "all" ? <OrgCardsSection /> : null}
    </Stack>
  );
}