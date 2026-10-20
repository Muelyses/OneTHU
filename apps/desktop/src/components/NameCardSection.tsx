import { t as i18n, msg as i18nMsg, useLocale as useUiLocale } from "../i18n/index.js";
import { useOrgs, orgIdentityCard } from "../state/org.js";
import { openTab } from "../state/explorer.js";
/**
 * 通讯录与名片：我的名片、名片夹（好友 / 组织）、组织名片。
 *
 * 数据仍在 state/nameCard.ts，共享云盘 / 留言 / 传文件走 lib/cloudFolder 与 state/friendChannel；
 * 本文件只做展示层重组：拟物纸卡（IdentityCard）+ 卡片夹网格 + Modal 大卡。
 * - 我的名片：settings 浮层「我的 → 我的名片」与通讯录页共用同一套编辑入口；
 * - 名片夹：搜索 / 全部·好友·组织 筛选 / 星标 / 卡片堆叠 / 点击弹出大卡；
 * - 组织名片：建卡、进暂存箱、复制加入方式；组织成员与邀请口令在 OrganizationSection。
 */
import { personalNfcCode, personalShareCode } from "../lib/contentExchange.js";
import { useNfcExchange } from "../lib/useNfcExchange.js";
import { useVaultReceive } from "../lib/useVaultReceive.js";
import { IdentityCard } from "./IdentityCard.js";
import { FriendInvitations } from "./FriendInvitations.js";
import { publishFriendInvitation } from "../state/friendInbox.js";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  Btn, Card, Chip, EmptyState, IconBtn, IconCamera, IconCloud, IconFile, IconIn, IconMail, IconPen,
  IconPlus, IconStar, IconTrash, Inline, KeyValue, List, Modal, Row, SearchField, Section, Segment,
  Stack, Text,
} from "@onethu/gui";
import { defineSearchRows } from "../state/searchRows.js";
import { getCampusSnapshot, subscribeCampusData } from "../state/data.js";
import {
  ensureSeafileLoaded, refreshSeafileAccount, useSeafile, seafileDownload,
} from "../state/seafile.js";
import { goEntry } from "./Layout.js";
import { openFormModal } from "../lib/formModal.js";
import { confirmOk } from "../lib/confirm.js";
import { showToast } from "../state/toast.js";
import { pickFile, fileToBytes } from "../lib/attach.js";
import { bytesToBase64 } from "../lib/imageSave.js";
import { addToVault, vaultSnapshot, type VaultCatch } from "../state/vault.js";
import {
  CARD_LIMITS, addContact, orgCardCatch, personalCardCatch, removeContact,
  resolveCloudEmail, savePersonalCard, upsertOrgCard, useCards,
  type CardCover, type ContactCard, type OrgCard, type PersonalCard,
} from "../state/nameCard.js";
import { deleteCardCover, uploadCardCover } from "../lib/cardCover.js";
import { CardCoverEditor } from "./CardCoverEditor.js";
import {
  refreshFriendMessages, sendFriendFile, sendFriendText, useFriendMessages,
} from "../state/friendChannel.js";
import { stageFromPicker } from "../lib/fileChannel.js";
import { experienceMode, experienceRevision, subscribeExperience, useExperienceMode } from "../state/experienceMode.js";

defineSearchRows([
  {
    id: "set-namecard", tab: "账号", section: "我的名片", get title() { return i18n("components.namecardsection.487e926379fe"); },
    aliases: ["名片", "头像", "个人简介", "社交媒体", "个人网址"], get desc() { return i18n("components.namecardsection.728a0cd5f147"); },
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
    ? (c.card as OrgCard).brief || i18n("components.namecardsection.b8fde21bc2ca")
    : (c.card as PersonalCard).bio || i18n("components.namecardsection.140181c90ccb");
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
    const f = await openFormModal(i18nMsg("components.namecardsection.87e6ed03c487"), [
      { key: "name", label: i18nMsg("components.namecardsection.6773310492a9"), required: true, default: p.name },
      { key: "website", label: i18nMsg("components.namecardsection.22530f991560"), default: p.website },
      { key: "social", label: i18nMsg("components.namecardsection.ed7ece7d61a0"), default: p.social },
      { key: "phone", label: i18nMsg("components.namecardsection.6f52cc94db65"), default: p.phone },
      {
        key: "cloudEmail",
        label: i18nMsg("components.namecardsection.cf09399631a7"),
        placeholder: i18nMsg("components.namecardsection.7a456447d1df"),
        default: p.cloudEmail || cloudEmail || "",
      },
      { key: "bio", label: i18nMsg("components.namecardsection.d35e72f2cbcf"), kind: "textarea", default: p.bio },
    ]);
    if (f) savePersonalCard(f);
  }, [p, cloudEmail]);

  const pickAvatar = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const f = await pickFile();
      if (!f) return;
      if (!f.mime.startsWith("image/")) throw new Error(i18n("components.namecardsection.c747909af9bf"));
      if (f.size > 200 * 1024) throw new Error(i18n("components.namecardsection.032ff20471ee"));
      const bytes = await fileToBytes(f, 200 * 1024);
      savePersonalCard({ avatar: `data:${f.mime};base64,${bytesToBase64(bytes)}` });
      showToast(i18nMsg("components.namecardsection.a938ed15b3e5"));
    } catch (e) {
      showToast(i18nMsg("components.namecardsection.e5aeb36dd793", { value: String(e instanceof Error ? e.message : String(e)) }));
    } finally {
      setBusy(false);
    }
  }, []);

  const toVault = useCallback((): void => {
    const r = addToVault(personalCardCatch());
    if (r.ok) showToast(i18nMsg("components.namecardsection.98a4e5fe3ab0"));
    else showToast(r.reason === "duplicate" ? i18nMsg("components.namecardsection.9e7804614304") : i18nMsg("components.namecardsection.57ce97c584ca"));
  }, []);

  return { personal: p, edit, pickAvatar, toVault, busy, cloudEmail };
}

/* ══════════════ 我的名片 ══════════════ */

function cloudEmailText(email: string): string {
  return email || i18n("components.namecardsection.2b80886afc39");
}

function PersonalCardBlock(): ReactNode {
  const uiLocale = useUiLocale();

  const { personal, edit, pickAvatar, toVault, busy, cloudEmail } = usePersonalActions();
  const nfc = useNfcExchange();
  /* 通讯录也应当能直接收名片：粘贴对方的名片口令（或扫码）就进名片夹，不必绕去暂存箱。 */
  const receive = useVaultReceive();
  const [copying, setCopying] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const copyCard = async (): Promise<void> => {
    if (copying) return;
    setCopying(true);
    try { await navigator.clipboard.writeText(await personalShareCode(personal)); showToast(i18nMsg("components.namecardsection.d71efdfa0d21")); }
    catch (e) { showToast(e instanceof Error ? e.message : i18nMsg("components.namecardsection.86ee28991b99")); }
    finally { setCopying(false); }
  };
  const saveCover = (cover: CardCover): void => {
    savePersonalCard({ cover });
    showToast(i18nMsg("components.namecardsection.8791b9f80795"));
    /* 云盘备份异步进行：失败只说备份失败，本地卡面不受影响。 */
    void (async () => {
      try {
        const cloud = await uploadCardCover(cover.src);
        savePersonalCard({ cover: { ...cover, cloud } });
        showToast(i18nMsg("components.namecardsection.6b70038c3f75"));
      } catch {
        showToast(i18nMsg("components.namecardsection.2da6ab45cd99"));
      }
    })();
  };
  const removeCover = (): void => {
    const old = personal.cover?.cloud;
    savePersonalCard({ cover: null });
    if (old) void deleteCardCover(old);
    showToast(i18nMsg("components.namecardsection.a3c0025dd64c"));
  };

  return (
    <div className="identity-panel">
      <div className="identity-panel-show">
        <IdentityCard card={personal} variant="hero" />
        {/* 两排等宽按钮：编辑一排、分享一排；手机端各自两列，桌面端各四列，排版一致不参差 */}
        <div className="identity-panel-actions identity-panel-actions--edit">
          <Btn variant="solid" tone="brand" icon={<IconPen size="sm" />} onClick={() => void edit()}>{i18n("components.namecardsection.6e7ecbfdeb6c")}</Btn>
          <Btn variant="outline" icon={<IconCamera size="sm" />} disabled={busy} onClick={() => void pickAvatar()}>{i18n("components.namecardsection.fb17c85750c7")}</Btn>
          <Btn variant="outline" onClick={() => setCoverOpen(true)}>{personal.cover ? i18n("components.namecardsection.8af2bc38c6a7") : i18n("components.namecardsection.bc6b27e11f11")}</Btn>
          <Btn variant="ghost" onClick={toVault}>{i18n("components.namecardsection.8e5ba1de0a5c")}</Btn>
        </div>
        <div className="identity-panel-exchange">
          <div className="identity-panel-actions identity-panel-actions--share">
            <Btn variant="outline" disabled={copying || nfc.busy} onClick={() => void copyCard()}>{copying ? i18n("components.namecardsection.a8b8730c9611") : i18n("components.namecardsection.353e57027d77")}</Btn>
            <Btn variant="outline" disabled={receive.busy || nfc.busy} onClick={() => void receive.paste()}>{i18n("components.namecardsection.63b79babcb32")}</Btn>
            <Btn variant="solid" disabled={!nfc.available || nfc.busy || copying} onClick={() => void nfc.send(() => personalNfcCode(personal))}>{i18n("components.namecardsection.70c95a778953")}</Btn>
            <Btn variant="ghost" disabled={receive.busy || nfc.busy} onClick={() => void receive.scan()}>{i18n("components.namecardsection.48659c30cb24")}</Btn>
          </div>
          <Text slot="micro" tone="faint">{nfc.hint}</Text>
        </div>
      </div>
      {nfc.feedback}
      <CardCoverEditor
        open={coverOpen}
        card={personal}
        onClose={() => setCoverOpen(false)}
        onSave={saveCover}
        onRemove={removeCover}
      />
      <Card className="identity-panel-meta">
        <Section title={i18n("components.namecardsection.381574fa5f7b")} hint={i18n("components.namecardsection.f8802d448332")} />
        <KeyValue
          rows={[
            { k: i18n("components.namecardsection.6773310492a9"), v: personal.name || i18n("components.namecardsection.7f05190592e5") },
            { k: i18n("components.namecardsection.22530f991560"), v: personal.website || i18n("components.namecardsection.7f05190592e5") },
            { k: i18n("components.namecardsection.ed7ece7d61a0"), v: personal.social || i18n("components.namecardsection.7f05190592e5") },
            { k: i18n("components.namecardsection.6f52cc94db65"), v: personal.phone || i18n("components.namecardsection.7f05190592e5") },
            { k: i18n("components.namecardsection.daa435b57879"), v: cloudEmailText(cloudEmail) },
          ]}
        />
        <Text slot="micro" tone="faint">{i18n("components.namecardsection.80e5b5076b66")}</Text>
      </Card>
    </div>
  );
}

/* ══════════════ 组织名片 ══════════════ */

/** 自己创建的组织 + 历史独立组织名片（并集，新组织优先）。 */
export function myOrgCards(legacy: OrgCard[], organizations: ReturnType<typeof useOrgs>): OrgCard[] {
  return [...organizations.orgs.map(orgIdentityCard), ...legacy.filter((c) => !organizations.orgs.some((o) => o.id === c.id))];
}

export function OrgCardsSection(): ReactNode {
  const uiLocale = useUiLocale();

  const legacy = useCards();
  const organizations = useOrgs();
  const orgs = myOrgCards(legacy.orgs, organizations);
  return (
    <div className="org-cards">
      <Section
        className="org-cards-head"
        title={i18n("components.namecardsection.b1bd19b13336")}
        hint={i18n("components.namecardsection.16b12866400d")}
        aside={<Btn size="sm" variant="outline" onClick={() => openTab("contacts", { section: "orgs" } as never)}>{i18n("components.namecardsection.4dd6695c0a10")}</Btn>}
      />
      {orgs.length === 0 ? (
        <EmptyState
          icon={<IconIn size="lg" />}
          title={i18n("components.namecardsection.9196d03dd121")}
          hint={i18n("components.namecardsection.faf7ec668417")}
        />
      ) : (
        <div className="contact-deck">
          {orgs.map((o) => (
            <div className="contact-slot" key={o.id}>
              <Btn
                className="contact-card-pick"
                aria-label={i18n("components.namecardsection.e84dedddc8c4", { name: String(o.name) })}
                data-vault-catch={JSON.stringify(orgCardCatch(o))}
                onClick={() => openTab("org", { orgId: o.id }, { title: o.name })}
              >
                <IdentityCard card={o} organization />
              </Btn>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════ 名片夹 ══════════════ */

export function ContactCabinet(): ReactNode {
  const uiLocale = useUiLocale();
  const full = useExperienceMode() === "full";
  const modeRevision = useSyncExternalStore(subscribeExperience, experienceRevision, experienceRevision);

  const doc = useCards();
  const organizations = useOrgs();
  /** 名片夹同一个牌堆里还有自己的组织名片（2026-10-19 用户点名「应该和其他名片夹在一起」）。 */
  const myOrgs = myOrgCards(doc.orgs, organizations);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ContactFilter>("all");
  const [starred, setStarred] = useState<ReadonlySet<string>>(() => new Set(readStars()));
  const [onlyStarred, setOnlyStarred] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [selfOpen, setSelfOpen] = useState(false);
  /** 「接收名片」小面板：粘贴口令 / 扫码 / 从暂存箱收 —— 三个收名片入口收成一个按钮，工具条不拥挤。 */
  const [recvOpen, setRecvOpen] = useState(false);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);

  const focused = doc.contacts.find((c) => c.id === focusedId) ?? null;
  const shownRef = useRef<ContactCard | null>(null);
  useEffect(() => {
    if (focused) shownRef.current = focused;
  }, [focused]);
  const shown = focused ?? shownRef.current;
  const channelMessages = useFriendMessages(channelId ?? "");
  const [channelError, setChannelError] = useState<string | null>(null);
  useEffect(() => {
    // Preserve the cards, not their transient portals. Restoring a card modal
    // while the mode picker is still open would cover Settings with its scrim.
    setFocusedId(null);
    setSelfOpen(false);
    setRecvOpen(false);
    setChannelId(null);
    setChannelError(null);
    shownRef.current = null;
  }, [modeRevision]);
  useEffect(() => {
    if (!full || !channelId) { setChannelError(null); return; }
    const revision = modeRevision;
    const current = (): boolean => experienceMode() === "full" && experienceRevision() === revision;
    let alive = true;
    let running = false;
    const refresh = async (): Promise<void> => {
      if (!alive || !current() || running || document.visibilityState !== "visible") return;
      running = true;
      try {
        const r = await refreshFriendMessages(channelId);
        if (alive && current()) setChannelError(r.ok ? null : r.reason ?? null);
      } finally { running = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 15_000);
    const focus = (): void => { void refresh(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => { alive = false; clearInterval(timer); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [channelId, full, modeRevision]);

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
    if (ok) showToast(i18nMsg("components.namecardsection.9fc6a0e68737", { ok: String(ok) }));
    else showToast(dup ? i18nMsg("components.namecardsection.4a49d50fc1ad") : i18nMsg("components.namecardsection.0c557ff432a7"));
  }, []);

  const shareCloud = useCallback(async (contactId: string): Promise<void> => {
    const old = doc.contacts.find((c) => c.id === contactId)?.shared;
    if (old?.shareUrl && !await confirmOk(i18nMsg("friends.upgradeLegacy"))) return;
    setSharingId(contactId);
    try {
      await publishFriendInvitation(contactId);
      showToast(i18nMsg("friends.published"), 7000);
    } catch (e) {
      showToast(i18nMsg("components.namecardsection.a24929811487", { value: String(e instanceof Error ? e.message : String(e)) }));
    } finally {
      setSharingId(null);
    }
  }, [doc.contacts]);

  const sendMessage = useCallback(async (): Promise<void> => {
    if (!channelId) return;
    const f = await openFormModal(i18nMsg("components.namecardsection.385d439d3e16"), [{ key: "text", label: i18nMsg("components.namecardsection.1aadd1661e1d"), kind: "textarea", required: true }]);
    if (!f?.text) return;
    const r = await sendFriendText(channelId, f.text);
    showToast(r.ok ? i18nMsg("components.namecardsection.bc398485aa6a") : i18nMsg("components.namecardsection.f272a8187531", { reason: String(r.reason) }));
  }, [channelId]);

  const sendFile = useCallback(async (): Promise<void> => {
    if (!channelId) return;
    try {
      const staged = await stageFromPicker(true);
      let ok = 0;
      for (const f of staged) {
        const r = await sendFriendFile(channelId, { name: f.name, localPath: f.localPath, size: f.size });
        if (r.ok) ok++;
        else showToast(i18nMsg("components.namecardsection.a3dd578bcf36", { name: String(f.name), reason: String(r.reason) }));
      }
      if (ok) showToast(i18nMsg("components.namecardsection.fb1cbf2a96f7", { ok: String(ok) }));
    } catch (e) {
      showToast(i18nMsg("components.namecardsection.c779c2d1fbe9", { value: String(e instanceof Error ? e.message : String(e)) }));
    }
  }, [channelId]);

  const { personal, edit, pickAvatar, toVault, busy, cloudEmail } = usePersonalActions();
  /* 通讯录里直接收名片：粘贴对方的名片口令或扫码，不用先绕去暂存箱。 */
  const receive = useVaultReceive();

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return doc.contacts
      .filter((c) => filter === "all" || c.kind === filter)
      .filter((c) => !onlyStarred || starred.has(c.id))
      .filter((c) => !q || `${c.name} ${c.note} ${contactBrief(c)} ${contactLink(c)}`.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => Number(starred.has(b.id)) - Number(starred.has(a.id)) || b.addedAt - a.addedAt);
  }, [uiLocale, doc.contacts, filter, onlyStarred, query, starred]);

  const starButton = useCallback(
    (c: ContactCard, round = true): ReactNode => (
      <IconBtn
        className={round ? "contact-star" : undefined}
        label={`${starred.has(c.id) ? i18n("components.namecardsection.a619ae87fda9") : i18n("components.namecardsection.70d929b3b1f6")}${c.name}`}
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
  /* 组织名片同理：搜索/星标时让位；按「好友」筛选时不出现，按「组织」或「全部」时出现。 */
  const showOrgs = !query.trim() && !onlyStarred && (filter === "all" || filter === "organization");

  return (
    <div className="contact-cabinet">
      {full && <FriendInvitations onConnected={(id) => { setFocusedId(id); setChannelId(id); }} />}
      <div className="contact-toolbar">
        <SearchField
          className="contact-search"
          value={query}
          onChange={setQuery}
          placeholder={i18n("components.namecardsection.6d434210c5bf")}
          aria-label={i18n("components.namecardsection.f3c602ccaabb")}
        />
        <Inline gap={2} wrap>
          <Segment
            value={filter}
            onChange={(v) => setFilter(v as ContactFilter)}
            options={[
              { value: "all", label: i18n("components.namecardsection.5c55a67935af") },
              { value: "personal", label: i18n("components.namecardsection.b9b1480dd6ec") },
              { value: "organization", label: i18n("components.namecardsection.b4d203dea5b9") },
            ]}
          />
          <Chip icon={<IconStar size="sm" />} selected={onlyStarred} onClick={() => setOnlyStarred((v) => !v)}>{i18n("components.namecardsection.dff9e5a876ae")}</Chip>
          <Btn variant="outline" icon={<IconIn size="sm" />} onClick={() => setRecvOpen(true)}>{i18n("components.namecardsection.365d7c6687b0")}</Btn>
        </Inline>
      </div>

      <div className="contact-deck">
        {showMine ? (
          <div className="contact-slot is-mine">
            <Btn
              className="contact-card-pick"
              aria-label={i18n("components.namecardsection.3e21bceb6dc5")}
              data-vault-catch={JSON.stringify(personalCardCatch())}
              onClick={() => setSelfOpen(true)}
            >
              <IdentityCard card={personal} variant="hero" />
            </Btn>
          </div>
        ) : null}
        {showOrgs
          ? myOrgs.map((o) => (
              <div className="contact-slot" key={o.id}>
                <Btn
                  className="contact-card-pick"
                  aria-label={i18n("components.namecardsection.e84dedddc8c4", { name: String(o.name) })}
                  data-vault-catch={JSON.stringify(orgCardCatch(o))}
                  onClick={() => openTab("org", { orgId: o.id }, { title: o.name })}
                >
                  <IdentityCard card={o} organization />
                </Btn>
              </div>
            ))
          : null}
        {list.map((c) => (
          <div className="contact-slot" key={c.id}>
            <Btn
              className="contact-card-pick"
              aria-label={i18n("components.namecardsection.16c88a1bd8a9", { name: String(c.name) })}
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
          title={filterActive ? i18n("components.namecardsection.3816a0cab667") : i18n("components.namecardsection.6eeeec8e5551")}
          hint={
            filterActive
              ? i18n("components.namecardsection.f2af14b00970")
              : i18n("components.namecardsection.2506df7b2e41")
          }
          action={
            <Inline gap={2} wrap>
              <Btn variant="solid" tone="brand" icon={<IconIn size="sm" />} onClick={() => setRecvOpen(true)}>{i18n("components.namecardsection.365d7c6687b0")}</Btn>
              {filterActive ? (
                <Btn variant="ghost" onClick={() => { setQuery(""); setOnlyStarred(false); setFilter("all"); }}>{i18n("components.namecardsection.d62e64a05006")}</Btn>
              ) : null}
            </Inline>
          }
        />
      ) : null}

      <Modal open={full && recvOpen} onClose={() => setRecvOpen(false)} title={i18n("components.namecardsection.365d7c6687b0")} size="sm">
        <Stack gap={3}>
          <Text slot="micro" tone="faint">{i18n("components.namecardsection.a9f6d3616710")}</Text>
          <Inline gap={2} wrap>
            <Btn variant="solid" tone="brand" disabled={receive.busy} onClick={() => { setRecvOpen(false); void receive.paste(); }}>{i18n("components.namecardsection.63b79babcb32")}</Btn>
            <Btn variant="outline" disabled={receive.busy} onClick={() => { setRecvOpen(false); void receive.scan(); }}>{i18n("components.namecardsection.6ebb64384907")}</Btn>
            <Btn variant="ghost" onClick={() => { setRecvOpen(false); importContacts(); }}>{i18n("components.namecardsection.1da923d22b2f")}</Btn>
          </Inline>
        </Stack>
      </Modal>

      {/* 我的名片大卡 */}
      <Modal open={full && selfOpen} onClose={() => setSelfOpen(false)} title={i18n("components.namecardsection.487e926379fe")} className="contact-detail-modal" size="md">
        <div className="contact-detail">
          <div className="contact-detail-stage">
            <IdentityCard card={personal} variant="detail" />
          </div>
          <Stack gap={4}>
            <KeyValue
              rows={[
                { k: i18n("components.namecardsection.6773310492a9"), v: personal.name || i18n("components.namecardsection.7f05190592e5") },
                { k: i18n("components.namecardsection.8131eafd0239"), v: personal.bio || i18n("components.namecardsection.7f05190592e5") },
                { k: i18n("components.namecardsection.323a881ebd47"), v: [personal.website, personal.social, personal.phone].filter(Boolean).join(" · ") || i18n("components.namecardsection.7f05190592e5") },
                { k: i18n("components.namecardsection.daa435b57879"), v: cloudEmailText(cloudEmail) },
              ]}
            />
            <Inline gap={2} wrap>
              <Btn size="sm" variant="solid" tone="brand" icon={<IconPen size="sm" />} onClick={() => void edit()}>{i18n("components.namecardsection.6e7ecbfdeb6c")}</Btn>
              <Btn size="sm" variant="outline" icon={<IconCamera size="sm" />} disabled={busy} onClick={() => void pickAvatar()}>{i18n("components.namecardsection.fb17c85750c7")}</Btn>
              <Btn size="sm" variant="ghost" icon={<IconIn size="sm" />} onClick={toVault}>{i18n("components.namecardsection.8e5ba1de0a5c")}</Btn>
              <Btn size="sm" variant="ghost" onClick={() => { setSelfOpen(false); goEntry("profile"); }}>{i18n("components.namecardsection.b41cbf11b07d")}</Btn>
            </Inline>
          </Stack>
        </div>
      </Modal>

      {/* 联系人大卡：详情一律弹出，不塞回页面 */}
      <Modal
        open={full && Boolean(focused)}
        onClose={closeDetail}
        title={shown ? i18n("components.namecardsection.a12513e5d0fd", { name: String(shown.name) }) : i18n("components.namecardsection.9e3899a169a0")}
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
                  { k: i18n("components.namecardsection.ba40014ff496"), v: shown.kind === "organization" ? i18n("components.namecardsection.b4d203dea5b9") : i18n("components.namecardsection.b9b1480dd6ec") },
                  { k: i18n("components.namecardsection.daede9881787"), v: shown.note || i18n("components.namecardsection.7f05190592e5") },
                  { k: i18n("components.namecardsection.8131eafd0239"), v: contactBrief(shown) },
                  { k: shown.kind === "organization" ? i18n("components.namecardsection.b52ea6d355c2") : i18n("components.namecardsection.323a881ebd47"), v: contactLink(shown) || i18n("components.namecardsection.7f05190592e5") },
                  { k: i18n("components.namecardsection.79d504ee7bef"), v: shown.shared?.acceptedAt
                    ? i18n("friends.connected") : shown.shared?.invitationPublishedAt ? i18n("friends.awaitingPeer")
                    : shown.shared ? i18n("friends.legacyChannel") : i18n("components.namecardsection.90b310149a74") },
                ]}
              />
              <Inline gap={2} wrap>
                <Btn size="sm" variant="solid" tone="brand" icon={<IconIn size="sm" />} onClick={() => {
                  const r = addToVault(contactCatch(shown));
                  showToast(r.ok ? i18nMsg("components.namecardsection.98a4e5fe3ab0") : r.reason === "duplicate" ? i18nMsg("components.namecardsection.9e7804614304") : i18nMsg("components.namecardsection.57ce97c584ca"));
                }}>{i18n("components.namecardsection.8e5ba1de0a5c")}</Btn>
                {shown.shared && <Btn size="sm" variant="outline" icon={<IconCloud size="sm" />}
                  onClick={() => openTab("cloud", { cloudRepo: shown.shared!.repoId, cloudPath: shown.shared!.path })}>
                  {i18n("friends.openFiles")}
                </Btn>}
                {shown.kind === "personal" && (!shown.shared?.acceptedAt || shown.shared.ownerEmail === shown.shared.accountEmail) && (
                  <Btn size="sm" variant="outline" icon={<IconMail size="sm" />} disabled={sharingId === shown.id}
                    onClick={() => void shareCloud(shown.id)}>
                    {sharingId === shown.id ? i18n("components.namecardsection.56b63def0e29")
                      : shown.shared ? i18n("friends.resend") : i18n("friends.create")}
                  </Btn>
                )}
                <Btn size="sm" variant="ghost" icon={<IconMail size="sm" />} onClick={() => setChannelId(channelId === shown.id ? null : shown.id)}>
                  {channelId === shown.id ? i18n("components.namecardsection.e1bb8719dfa4") : i18n("components.namecardsection.1ce1f2806523")}
                </Btn>
                {shown.kind === "organization" && (shown.card as OrgCard).joinUrl ? (
                  <Btn size="sm" variant="ghost" onClick={() => {
                    void navigator.clipboard.writeText((shown.card as OrgCard).joinUrl).then(
                      () => showToast(i18nMsg("components.namecardsection.c5c9b9b48b9c")),
                      () => showToast(i18nMsg("components.namecardsection.97f4308501ff")),
                    );
                  }}>{i18n("components.namecardsection.12f63705ed44")}</Btn>
                ) : null}
                {starButton(shown, false)}
                <Btn size="sm" variant="ghost" tone="error" icon={<IconTrash size="sm" />} onClick={() => {
                  void confirmOk(i18nMsg("components.namecardsection.6a7ab670dbb4", { name: String(shown.name) })).then((ok) => {
                    if (!ok) return;
                    removeContact(shown.id);
                    closeDetail();
                  });
                }}>{i18n("components.namecardsection.2f9daa828907")}</Btn>
              </Inline>

              {channelId === shown.id ? (
                <div className="contact-channel">
                  <Inline justify="between" gap={2}>
                    <Text slot="label" weight="semibold">{i18n("components.namecardsection.1ce1f2806523")}</Text>
                    <Inline gap={2}>
                      <Btn size="sm" variant="ghost" onClick={() => void refreshFriendMessages(shown.id).then((r) => setChannelError(r.ok ? null : r.reason ?? null))}>{i18n("friends.refreshMessages")}</Btn>
                      <Btn variant="plain" onClick={() => setChannelId(null)}>{i18n("components.namecardsection.3fd47edce45b")}</Btn>
                    </Inline>
                  </Inline>
                  {channelError && <div role="alert"><Text slot="micro" tone="error">{channelError}</Text></div>}
                  {channelMessages.length === 0 ? (
                    <Text slot="micro" tone="faint">{i18n("components.namecardsection.2a7be7efb999")}</Text>
                  ) : (
                    <List divided>
                      {channelMessages.map((m) => (
                        <Row
                          key={m.id}
                          flush
                          leading={m.kind === "file" ? <IconFile size="sm" /> : <IconMail size="sm" />}
                          title={m.kind === "file" ? i18n("components.namecardsection.9491ade2781f") + m.text : m.text}
                          sub={(m.mine ? i18n("friends.fromMe") : shown.name) + " · " + (m.cloudPath ? i18n("components.namecardsection.28603f7d8ab4") : i18n("components.namecardsection.5a51f9817528"))}
                          trailing={m.kind === "file" && m.cloudPath && shown.shared ? <Btn size="sm" variant="ghost"
                            onClick={() => void seafileDownload(shown.shared!.repoId, m.cloudPath!).catch((e) => showToast(String(e)))}>{i18n("friends.download")}</Btn> : undefined}
                        />
                      ))}
                    </List>
                  )}
                  <Inline gap={2} wrap>
                    <Btn variant="solid" tone="brand" icon={<IconMail size="sm" />} onClick={() => void sendMessage()}>{i18n("components.namecardsection.2335399f1fa8")}</Btn>
                    <Btn variant="ghost" icon={<IconFile size="sm" />} onClick={() => void sendFile()}>{i18n("components.namecardsection.d909fbc0d1e8")}</Btn>
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
  const uiLocale = useUiLocale();

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
