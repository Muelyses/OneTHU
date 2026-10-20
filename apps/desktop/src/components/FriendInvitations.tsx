import { useEffect, useRef, useState } from "react";
import { Btn, Card, IconBtn, IconMail, Inline, Stack, Text } from "@onethu/gui";
import { t, msg, useLocale } from "../i18n/index.js";
import { getSeafileToken, useSeafile } from "../state/seafile.js";
import { acceptFriendInvitation, clearFriendInbox, ignoreFriendInvitation,
  conflictingFriendChannel, refreshFriendInvitations, useFriendInbox } from "../state/friendInbox.js";
import { useCards } from "../state/nameCard.js";
import { confirmOk } from "../lib/confirm.js";
import { showToast } from "../state/toast.js";
import { openTab } from "../state/explorer.js";

/** Mounted once in the full-mode shell. Foreground only; never requests OS push permissions. */
export function FriendInboxMonitor() {
  const { configured, account } = useSeafile();
  const inbox = useFriendInbox();
  const notified = useRef(new Set<string>());
  useEffect(() => {
    let alive = true;
    const check = (): void => {
      if (alive && document.visibilityState === "visible") void refreshFriendInvitations().catch(() => undefined);
    };
    check();
    const timer = setInterval(check, 30_000);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
      clearFriendInbox();
    };
  }, []);
  useEffect(() => {
    if (!getSeafileToken() || (account?.email && inbox.email
      && account.email.trim().toLowerCase() !== inbox.email)) clearFriendInbox();
    void refreshFriendInvitations().catch(() => undefined);
    // Refresh account changes without tearing down a valid inbox when its account
    // metadata first arrives or a Contacts page refreshes the account snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, account?.email]);
  useEffect(() => {
    const unseen = inbox.invitations.filter((i) => !notified.current.has(`${inbox.email}:${i.id}:${i.sentAt}`));
    if (!unseen.length) return;
    unseen.forEach((i) => notified.current.add(`${inbox.email}:${i.id}:${i.sentAt}`));
    showToast(msg("friends.newInvites", { count: inbox.invitations.length }), 8000);
  }, [inbox.email, inbox.invitations]);
  return null;
}

/** Persistent entry in both horizontal and vertical navigation, only when attention is needed. */
export function FriendInboxButton() {
  useLocale();
  const inbox = useFriendInbox();
  if (!inbox.invitations.length) return null;
  return <span className="friend-inbox-entry">
    <IconBtn label={t("friends.inviteCount", { count: inbox.invitations.length })}
      icon={<IconMail size="sm" />}
      onClick={() => openTab("contacts", { section: "cards" }, { title: t("pages.contacts.06657c279571") })} />
    <span className="friend-inbox-badge" aria-hidden="true">{Math.min(99, inbox.invitations.length)}</span>
  </span>;
}

export function FriendInvitations({ onConnected }: { onConnected?: (contactId: string) => void }) {
  useLocale();
  useCards();
  const inbox = useFriendInbox();
  const [busy, setBusy] = useState<string | null>(null);
  const { configured } = useSeafile();
  useEffect(() => { void refreshFriendInvitations(true).catch(() => undefined); }, []);
  async function accept(id: string): Promise<void> {
    const invitation = inbox.invitations.find((item) => item.id === id);
    if (!invitation) return;
    const replace = !!conflictingFriendChannel(invitation);
    if (replace && !await confirmOk(msg("friends.switchConfirm"))) return;
    setBusy(id);
    try {
      const contactId = await acceptFriendInvitation(id, replace);
      showToast(msg("friends.connected"));
      onConnected?.(contactId);
    } catch (e) { showToast(e instanceof Error ? e.message : String(e), 6000); }
    finally { setBusy(null); }
  }
  return <Card className="friend-invitations">
    <Stack gap={3}>
      <Inline justify="between" gap={2} wrap>
        <Text weight="semibold">{t("friends.inviteCount", { count: inbox.invitations.length })}</Text>
        <Btn size="sm" variant="ghost" disabled={inbox.busy}
          onClick={() => void refreshFriendInvitations(true).catch(() => undefined)}>
          {inbox.busy ? t("friends.checking") : t("friends.checkInvites")}
        </Btn>
      </Inline>
      <Text slot="micro" tone="faint">{configured ? t("friends.inboxHint") : t("friends.connectCloud")}</Text>
      {inbox.error && <div role="alert"><Text slot="micro" tone="error">{inbox.error}</Text></div>}
      {inbox.invitations.map((invite) => <div className="friend-invitation" key={invite.id}>
        <Stack gap={1}>
          <Text weight="semibold">{invite.ownerName || invite.ownerEmail}</Text>
          <Text slot="micro" tone="faint">{invite.ownerEmail}</Text>
          <Text slot="micro">{t("friends.inviteDetail")}</Text>
          {conflictingFriendChannel(invite) && <Text slot="micro" tone="faint">{t("friends.duplicateHint")}</Text>}
          {invite.permission !== "rw" && <Text slot="micro" tone="error">{t("friends.readOnlyInvite")}</Text>}
        </Stack>
        <Inline gap={2} wrap>
          <Btn size="sm" variant="solid" disabled={busy !== null || invite.permission !== "rw"} onClick={() => void accept(invite.id)}>
            {busy === invite.id ? t("friends.connecting") : conflictingFriendChannel(invite) ? t("friends.switchChannel") : t("friends.accept")}
          </Btn>
          <Btn size="sm" variant="ghost" disabled={busy !== null} onClick={() => ignoreFriendInvitation(invite.id)}>{t("friends.ignore")}</Btn>
        </Inline>
      </div>)}
    </Stack>
  </Card>;
}
