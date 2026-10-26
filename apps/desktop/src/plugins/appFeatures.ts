/** Reviewed app features shared by OH and the desktop public service boundary. */
import type { OnethuApi, PluginPermission } from "./types.js";
import { PluginPermissionError } from "./types.js";
import { session } from "../lib/clients.js";
import { nativeSessionEpoch, assertNativeSessionEpoch } from "../lib/transport.js";
import { experienceMode, experienceRevision } from "../state/experienceMode.js";
import { cardsSnapshot, type ContactCard, type PersonalCard } from "../state/nameCard.js";
import { orgSnapshot, type Org, type OrgProject, type OrgAnnouncement } from "../state/org.js";
import { ensureSeafileLoaded, getSeafileAccount, getSeafileCredentialVersion, getSeafileToken, refreshSeafileAccount, openDir } from "../state/seafile.js";
import { publicResult } from "../cli/publicResult.js";
import type { VaultItem } from "../state/vault.js";
import { invoke } from "@tauri-apps/api/core";
import { isShortCode } from "../lib/shortCode.js";

type Features = Pick<OnethuApi, "contacts" | "organizations" | "xiaoda" | "vault">;
const text = (value: unknown) => typeof value === "string" ? value : "";
const matches = (query: string, ...values: string[]) => !query || values.some(v => v.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
function requireId(value: string) { if (!value?.trim()) throw new Error("INVALID_ARGUMENTS: A real id from the list is required."); return value; }
function field(value: string, limit: number, required = false) {
  if (typeof value !== "string" || value.length > limit || (required && !value.trim())) throw new Error(`INVALID_ARGUMENTS: Text field limit is ${limit} characters.`);
  return value;
}
function contact(row: ContactCard, detail = false) {
  const p = row.card as PersonalCard;
  return { id: row.id, kind: row.kind, name: row.name, note: row.note, addedAt: row.addedAt,
    hasSharedChannel: !!row.shared?.channelId,
    ...(detail ? row.kind === "personal" ? { card: { name: p.name, bio: p.bio, website: p.website, social: p.social, phone: p.phone, cloudEmail: p.cloudEmail } }
      : { card: { name: row.card.name, brief: text((row.card as unknown as Record<string, unknown>).brief) } } : {}) };
}
function organization(row: Org, detail = false) {
  return { id: row.id, name: row.name, brief: row.brief, memberCount: row.members.length,
    projectCount: row.projects?.length ?? 0, announcementCount: row.announcements?.length ?? 0,
    source: row.collaboration ? "remote-index" : "local", updatedAt: row.updatedAt,
    ...(detail ? {
      members: row.members.map(m => ({ id: m.id, name: m.name, email: m.email, role: m.role, username: m.username })),
      libraries: (row.libraries ?? []).map(l => ({ repoId: l.repoId, name: l.name })),
      gitlabRepos: (row.gitlabRepos ?? []).map(r => ({ id: r.id, name: r.name, path: r.path })),
      projects: (row.projects ?? []).map(p => ({ id: p.id, name: p.name, description: p.description, status: p.status, owner: p.owner, updatedAt: p.updatedAt })),
      announcements: (row.announcements ?? []).map(a => ({ id: a.id, title: a.title, body: a.body, pinned: a.pinned, updatedAt: a.updatedAt })),
      verification: row.collaboration ? "live-membership" : "local-only",
    } : {}) };
}
function vaultItem(row: VaultItem, detail = false) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload as Record<string, unknown> : {};
  const fields = ["kind", "title", "body", "description", "date", "location", "note", "courseId", "itemId", "projectId", "repoId", "path", "page"];
  return { id: row.id, type: row.type, title: row.title, sub: row.sub, source: row.source,
    text: row.type === "text" ? row.text : undefined,
    atom: row.atom ? { kind: row.atom.kind, key: row.atom.key } : undefined,
    board: row.board ? { boardId: row.board.boardId, itemId: row.board.itemId } : undefined,
    file: row.file ? { name: row.file.name, size: row.file.size, mime: row.file.mime, cloudRepoId: row.file.cloudRepoId, cloudPath: row.file.cloudPath } : undefined,
    ...(detail ? { payload: Object.fromEntries(fields.filter(key => ["string", "number", "boolean"].includes(typeof payload[key])).map(key => [key, payload[key]])) } : {}),
  };
}

export function buildAppFeatures(perms: Set<string>, beforeWrite?: () => Promise<void>): Features {
  async function begin(permission: PluginPermission, profile = false) {
    const owner = session.username, revision = experienceRevision(), version = getSeafileCredentialVersion();
    const check = () => {
      if (!perms.has(permission)) throw new PluginPermissionError(permission, "app features");
      if (!owner || session.username !== owner || session.state !== "ready") throw new Error("AUTH_SESSION_CHANGED");
      if (experienceMode() !== "full" || experienceRevision() !== revision) throw new Error("FULL_MODE_REQUIRED: Switch to full mode to use this feature.");
      if (profile && getSeafileCredentialVersion() !== version) throw new Error("PROFILE_ACCOUNT_CHANGED");
    };
    check();
    const epoch = await nativeSessionEpoch(); check();
    if (profile) {
      await ensureSeafileLoaded();
      if (getSeafileToken() && !getSeafileAccount()) await refreshSeafileAccount();
      check();
      const bound = localStorage.getItem("onethu.profile.owner.v1");
      const email = getSeafileAccount()?.email?.trim().toLowerCase();
      if (bound && (bound === "__none__" || bound !== email)) throw new Error("PROFILE_ACCOUNT_PENDING: The current account's profile is still loading.");
    }
    return { check, async finish<T>(value: T): Promise<T> { check(); await assertNativeSessionEpoch(epoch); check(); return publicResult(value) as T; } };
  }
  async function xiaoda(permission: PluginPermission = "xiaoda:read") {
    const guard = await begin(permission);
    const api = await import("../lib/xiaoda.js");
    const user = await api.xiaodaEnsureLogin(); guard.check();
    if (user.zjh !== session.username) throw new Error("XIAODA_ACCOUNT_MISMATCH: Open Qingxiaoda and sign in with the current account.");
    return { ...guard, client: api.xiaodaClient, user };
  }
  async function vaultWrite(id?: string) {
    const g = await begin("vault:write");
    const api = await import("../state/vault.js");
    const box = () => {
      g.check(); const row = api.vaultSnapshot().boxes.find(b => b.id === requireId(id!));
      if (!row) throw new Error("VAULT_NOT_FOUND");
      return row;
    };
    await beforeWrite?.(); g.check(); await g.finish(null);
    if (id !== undefined) box();
    return { ...g, api, box };
  }
  async function orgWrite(id: string) {
    const g = await begin("org:write", true);
    const api = await import("../state/org.js");
    const sync = await import("../state/orgSync.js");
    let row = orgSnapshot().orgs.find(o => o.id === requireId(id));
    if (!row) throw new Error("ORGANIZATION_NOT_FOUND");
    if (row.collaboration) {
      if (!perms.has("gitlab:write")) throw new PluginPermissionError("gitlab:write", "organizations.write");
      row = await sync.refreshRemoteOrg(id, g.check);
    } else {
      const email = getSeafileAccount()?.email?.trim().toLowerCase();
      if (!email || !row.members.some(m => m.role === "owner" && m.email.trim().toLowerCase() === email)) throw new Error("ORGANIZATION_OWNER_UNVERIFIED: Verify your owner record in the organization page.");
    }
    const binding = row.collaboration ? JSON.stringify([row.collaboration.groupId, row.collaboration.projectId, row.collaboration.adminBranch, row.collaboration.contentBranch]) : null;
    const check = () => {
      g.check();
      const current = orgSnapshot().orgs.find(o => o.id === id);
      if (!current) throw new Error("ORGANIZATION_NOT_FOUND");
      const currentBinding = current.collaboration ? JSON.stringify([current.collaboration.groupId, current.collaboration.projectId, current.collaboration.adminBranch, current.collaboration.contentBranch]) : null;
      if (currentBinding !== binding) throw new Error("ORGANIZATION_BINDING_CHANGED");
      if (!binding && !current.members.some(m => m.role === "owner" && m.email.trim().toLowerCase() === getSeafileAccount()?.email?.trim().toLowerCase())) throw new Error("ORGANIZATION_OWNER_UNVERIFIED");
    };
    const commit = async () => { check(); await beforeWrite?.(); await g.finish(null); check(); };
    await commit();
    return { ...g, api, sync, row, guard: { check, beforeWrite: commit } };
  }
  async function saveContent(id: string, collection: "projects" | "announcements", itemId: string | undefined, build?: (id: string) => OrgProject | OrgAnnouncement) {
    const g = await orgWrite(id);
    const items = g.row[collection] ?? [];
    const before = itemId ? items.find(p => p.id === itemId) : undefined;
    if (itemId && !before) throw new Error("ORGANIZATION_ITEM_NOT_FOUND");
    const after = build?.(itemId || crypto.randomUUID());
    if (g.row.collaboration) await g.sync.saveRemoteContent(id, collection, before, after, g.guard);
    else {
      await g.guard.beforeWrite();
      const current = orgSnapshot().orgs.find(o => o.id === id)?.[collection]?.find(p => p.id === itemId);
      if (JSON.stringify(current) !== JSON.stringify(before)) throw new Error("ORGANIZATION_ITEM_CHANGED");
      if (collection === "projects") {
        if (after) g.api.saveOrgProject(id, after as OrgProject); else g.api.deleteOrgProject(id, itemId!);
      } else {
        if (after) g.api.saveOrgAnnouncement(id, after as OrgAnnouncement); else g.api.deleteOrgAnnouncement(id, itemId!);
      }
    }
    return g.finish({ ok: true, scope: g.row.collaboration ? "shared-organization" : "local-only", ...(after ? { item: after } : { removed: true }) });
  }
  return {
    contacts: {
      async list(query = "", kind = "personal") {
        if (!["personal", "organization", "all"].includes(kind)) throw new Error("INVALID_ARGUMENTS: contact kind");
        const g = await begin("contacts:read", true);
        const rows = cardsSnapshot().contacts.filter(c => (kind === "all" || c.kind === kind) && matches(query, c.name, c.note)).map(c => contact(c));
        return g.finish({ source: "onethu-contacts", scope: "local-account-index", total: rows.length, rows });
      },
      async get(id) {
        const g = await begin("contacts:read", true);
        const row = cardsSnapshot().contacts.find(c => c.id === requireId(id));
        if (!row) throw new Error("CONTACT_NOT_FOUND");
        return g.finish(contact(row, true));
      },
    },
    organizations: {
      async list(query = "") {
        const g = await begin("org:read", true);
        const rows = orgSnapshot().orgs.filter(o => matches(query, o.name, o.brief)).map(o => organization(o));
        return g.finish({ source: "onethu-organizations", scope: "local-account-index", total: rows.length, rows });
      },
      async get(id) {
        const g = await begin("org:read", true);
        let row = orgSnapshot().orgs.find(o => o.id === requireId(id));
        if (!row) throw new Error("ORGANIZATION_NOT_FOUND");
        if (row.collaboration) {
          if (!perms.has("gitlab:read")) throw new PluginPermissionError("gitlab:read", "organizations.get");
          row = await (await import("../state/orgSync.js")).refreshRemoteOrg(id, g.check);
        }
        return g.finish(organization(row, true));
      },
      async create(name, brief = "") {
        field(name, 60, true); field(brief, 200);
        const g = await begin("org:write", true), api = await import("../state/org.js");
        const email = getSeafileAccount()?.email;
        if (!email) throw new Error("PROFILE_ACCOUNT_PENDING");
        await beforeWrite?.(); await g.finish(null);
        const row = api.createOrg({ name, brief, ownerName: cardsSnapshot().personal.name || session.username, ownerEmail: email });
        return g.finish({ ...organization(row), scope: "local-only", collaboration: "Enable shared collaboration explicitly in the organization page." });
      },
      async update(id, patch) {
        if (!patch || Object.keys(patch).some(k => k !== "name" && k !== "brief")) throw new Error("INVALID_ARGUMENTS: organization patch");
        if (patch.name !== undefined) field(patch.name, 60, true);
        if (patch.brief !== undefined) field(patch.brief, 200);
        const g = await orgWrite(id);
        if (g.row.collaboration) {
          const before = { name: g.row.name, brief: g.row.brief, joinUrl: g.row.joinUrl };
          await g.sync.updateRemoteOrg(id, before, { ...before, ...patch }, g.guard);
        } else { await g.guard.beforeWrite(); g.api.updateOrg(id, patch); }
        return g.finish(organization(orgSnapshot().orgs.find(o => o.id === id)!));
      },
      async saveProject(id, name, description, status, owner, projectId) {
        field(name, 120, true); field(description, 4000); field(owner, 120);
        if (!["planned", "active", "done"].includes(status)) throw new Error("INVALID_ARGUMENTS: project status");
        return saveContent(id, "projects", projectId, item => ({ id: item, name, description, status, owner, updatedAt: Date.now() }));
      },
      async removeProject(id, projectId) { return saveContent(id, "projects", requireId(projectId)); },
      async saveAnnouncement(id, title, body, pinned = false, announcementId) {
        field(title, 120, true); field(body, 10000);
        if (typeof pinned !== "boolean") throw new Error("INVALID_ARGUMENTS: pinned");
        return saveContent(id, "announcements", announcementId, item => ({ id: item, title, body, pinned, updatedAt: Date.now() }));
      },
      async removeAnnouncement(id, announcementId) { return saveContent(id, "announcements", requireId(announcementId)); },
    },
    xiaoda: {
      async status() { const g = await xiaoda(); return g.finish({ authenticated: true, name: g.user.name }); },
      async agents() { const g = await xiaoda(); return g.finish(await g.client.builtinGroups()); },
      async models() { const g = await xiaoda(); return g.finish(await g.client.customModels()); },
      async balance() { const g = await xiaoda(); return g.finish(await g.client.dadouBalance()); },
      async conversations(page = 1) {
        if (!Number.isSafeInteger(page) || page < 1) throw new Error("INVALID_ARGUMENTS: page");
        const g = await xiaoda(); return g.finish(await g.client.conversationPage(page, 20));
      },
      async conversation(id) { const g = await xiaoda(); return g.finish(await g.client.conversationMessages(requireId(id))); },
      async skills(query = "", page = 1) {
        if (!Number.isSafeInteger(page) || page < 1) throw new Error("INVALID_ARGUMENTS: page");
        const g = await xiaoda();
        return g.finish(query ? await g.client.skillSearch(query, page, 20) : await g.client.skillList(page, 20));
      },
      async skill(id) { const g = await xiaoda(); return g.finish(await g.client.skillDetail(requireId(id))); },
      async installed() {
        const g = await begin("xiaoda:read");
        const rows = await (await import("../lib/skills.js")).listSkills();
        return g.finish(rows.map(({ id, name, description, enabled, compatibility, requirements, files, installedAt }) => ({ id, name, description, enabled, compatibility, requirements, files, installedAt })));
      },
      async importSkill(id) {
        const g = await xiaoda("xiaoda:manage");
        const item = await g.client.skillDetail(requireId(id)); g.check();
        const skills = await import("../lib/skills.js");
        await beforeWrite?.(); g.check();
        await g.finish(null);
        return g.finish(await skills.importSkill(item));
      },
      async enableSkill(id, enabled) {
        if (typeof enabled !== "boolean") throw new Error("INVALID_ARGUMENTS: enabled");
        const g = await begin("xiaoda:manage");
        const skills = await import("../lib/skills.js");
        await beforeWrite?.(); g.check(); await g.finish(null);
        return g.finish(await skills.setSkillEnabled(requireId(id), enabled));
      },
      async removeSkill(id) {
        const g = await begin("xiaoda:manage"); const skills = await import("../lib/skills.js");
        if (!(await skills.listSkills()).some(skill => skill.id === requireId(id))) throw new Error("SKILL_NOT_FOUND");
        await beforeWrite?.(); await g.finish(null);
        await skills.deleteSkill(id); return g.finish({ removed: true });
      },
      async ask(agentId, question) {
        field(question, 30000, true);
        const g = await xiaoda("xiaoda:chat");
        const groups = await g.client.builtinGroups(); g.check();
        if (!groups.some(group => group.members?.some(agent => agent.uniqueId === requireId(agentId)))) throw new Error("XIAODA_AGENT_NOT_FOUND: Use an actual agent id from xiaoda.agents.");
        await beforeWrite?.(); await g.finish(null);
        const convId = await g.client.createConversation();
        await beforeWrite?.(); await g.finish(null);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120000);
        const watch = setInterval(() => { try { g.check(); } catch { controller.abort(); } }, 250);
        try {
          const result = await g.client.chatNative({ agentId, query: question, convId, signal: controller.signal, onDelta: () => g.check() });
          return g.finish({ content: result.content, convId: result.convId, provider: "qingxiaoda" });
        } finally { clearTimeout(timer); clearInterval(watch); }
      },
    },
    vault: {
      async list() {
        const g = await begin("vault:read");
        const doc = (await import("../state/vault.js")).vaultSnapshot();
        return g.finish({ activeId: doc.activeId, rows: doc.boxes.map(b => ({ id: b.id, name: b.name, count: b.items.length, updatedAt: b.updatedAt })) });
      },
      async items(id) {
        const g = await begin("vault:read");
        const box = (await import("../state/vault.js")).vaultSnapshot().boxes.find(b => b.id === requireId(id));
        if (!box) throw new Error("VAULT_NOT_FOUND");
        return g.finish({ id: box.id, name: box.name, total: box.items.length, rows: box.items.map(i => vaultItem(i)) });
      },
      async item(id, itemId) {
        const g = await begin("vault:read");
        const box = (await import("../state/vault.js")).vaultSnapshot().boxes.find(b => b.id === requireId(id));
        const item = box?.items.find(i => i.id === requireId(itemId));
        if (!item) throw new Error("VAULT_ITEM_NOT_FOUND");
        return g.finish(vaultItem(item, true));
      },
      async readText(id, itemId, offset = 0, maxChars = 12000) {
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 60000) throw new Error("INVALID_ARGUMENTS: offset >= 0, maxChars between 1 and 60000");
        const g = await begin("vault:read", true);
        const box = (await import("../state/vault.js")).vaultSnapshot().boxes.find(b => b.id === requireId(id));
        const item = box?.items.find(i => i.id === requireId(itemId));
        if (!item) throw new Error("VAULT_ITEM_NOT_FOUND");
        let content = item.text;
        if (content === undefined) {
          const file = item.file;
          if (!file) throw new Error("VAULT_TEXT_UNAVAILABLE: Follow the saved atom or page reference to query its source.");
          let base64: string;
          if (file.stagedPath) base64 = await invoke("read_file_base64", { path: file.stagedPath, maxBytes: 8 * 1024 * 1024 });
          else {
            if (!perms.has("cloud:read")) throw new PluginPermissionError("cloud:read", "vault.readText");
            if (file.cloudRepoId && file.cloudPath && !file.shareUrl) {
              await ensureSeafileLoaded(); g.check();
              base64 = await invoke("seafile_read_bytes", { token: getSeafileToken(), repoId: file.cloudRepoId, path: file.cloudPath, maxBytes: 8 * 1024 * 1024 });
            } else if (file.shareUrl && file.cloudPath) {
              const { materializeSharedFile } = await import("../state/vaultCloud.js");
              const path = await materializeSharedFile({ provider: "seafile", path: "", shareUrl: file.shareUrl, keyRepoId: file.shareKeyRepoId }, file.cloudPath, file.name);
              g.check(); base64 = await invoke("read_file_base64", { path, maxBytes: 8 * 1024 * 1024 });
            } else throw new Error("VAULT_FILE_NOT_CACHED");
          }
          try { content = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(base64), c => c.charCodeAt(0))); }
          catch { throw new Error("VAULT_BINARY_FILE_USE_PREVIEW: This is not a UTF-8 text file."); }
          if (content.includes("\0")) throw new Error("VAULT_BINARY_FILE_USE_PREVIEW");
        }
        const chars = Array.from(content), end = Math.min(chars.length, offset + maxChars);
        return g.finish({ id: itemId, name: item.title, text: chars.slice(offset, end).join(""), offset, nextOffset: end, totalChars: chars.length, complete: end >= chars.length });
      },
      async create(name) {
        if (!name?.trim()) throw new Error("INVALID_ARGUMENTS: box name");
        const g = await vaultWrite(); const box = g.api.createVault(name.trim());
        return g.finish({ id: box.id, name: box.name });
      },
      async rename(id, name) {
        if (!name?.trim()) throw new Error("INVALID_ARGUMENTS: box name");
        const g = await vaultWrite(id); g.api.renameVault(id, name.trim());
        return g.finish({ id, name: g.box().name });
      },
      async addText(id, title, value) {
        if (!value?.trim()) throw new Error("INVALID_ARGUMENTS: text");
        const g = await vaultWrite(id);
        const result = g.api.addToVault({ type: "text", title: title.trim() || value.slice(0, 60), text: value, source: "OH" }, id);
        return g.finish({ ok: result.ok, reason: result.reason, item: result.item ? vaultItem(result.item) : undefined });
      },
      async addAtom(id, kind, key) {
        const atoms = await import("../state/atoms.js");
        const g = await vaultWrite(id), view = atoms.resolveAtom({ kind, key });
        if (!view) throw new Error("ATOM_NOT_FOUND");
        const result = g.api.addToVault({ type: "atom", title: view.title, sub: view.sub, atom: { kind, key }, source: "OH" }, id);
        return g.finish({ ok: result.ok, reason: result.reason, item: result.item ? vaultItem(result.item) : undefined });
      },
      async addFile(id, repoId, path) {
        if (!perms.has("cloud:read")) throw new PluginPermissionError("cloud:read", "vault.addFile");
        if (!path?.startsWith("/") || path.includes("\\") || path.split("/").some(p => p === ".." || p === ".")) throw new Error("INVALID_ARGUMENTS: absolute cloud file path required");
        const g = await vaultWrite(id);
        await ensureSeafileLoaded(); g.check();
        if (!getSeafileToken()) throw new Error("CLOUD_NOT_CONNECTED");
        const version = getSeafileCredentialVersion();
        const name = path.slice(path.lastIndexOf("/") + 1), parent = path.slice(0, path.lastIndexOf("/")) || "/";
        const file = (await openDir(requireId(repoId), parent, true)).find(f => f.kind === "file" && f.name === name);
        if (!file) throw new Error("CLOUD_FILE_NOT_FOUND");
        await beforeWrite?.(); await g.finish(null);
        if (getSeafileCredentialVersion() !== version) throw new Error("PROFILE_ACCOUNT_CHANGED");
        const result = g.api.addToVault({ type: "file", title: file.name, file: { name: file.name, size: file.size, cloudRepoId: repoId, cloudPath: path }, source: "OH" }, id);
        return g.finish({ ok: result.ok, reason: result.reason, item: result.item ? vaultItem(result.item) : undefined });
      },
      async removeItem(id, itemId) {
        const g = await vaultWrite(id);
        if (!g.box().items.some(i => i.id === requireId(itemId))) throw new Error("VAULT_ITEM_NOT_FOUND");
        g.api.removeFromVault(id, itemId); return g.finish({ removed: true });
      },
      async share(id) {
        if (!perms.has("cloud:write")) throw new PluginPermissionError("cloud:write", "vault.share");
        const g = await vaultWrite(id), snapshot = g.box();
        if (snapshot.items.some(item => (item.text?.length ?? 0) > 4096)) throw new Error("VAULT_SHARE_TEXT_TOO_LONG: Existing exchange readers support 4096 characters per text item. Store long text as a file before sharing; no content was shared or truncated.");
        const cloud = await import("../state/vaultCloud.js");
        if (!await cloud.installVaultCloudAdapter({ cleanup: false })) throw new Error("CLOUD_NOT_CONNECTED");
        const token = getSeafileToken(), version = getSeafileCredentialVersion();
        const guard = async () => {
          await beforeWrite?.(); await g.finish(null);
          if (getSeafileCredentialVersion() !== version || getSeafileToken() !== token) throw new Error("PROFILE_ACCOUNT_CHANGED");
          const current = g.box();
          if (current.items !== snapshot.items || current.name !== snapshot.name) throw new Error("VAULT_CHANGED: Review current contents before sharing.");
        };
        const share = await import("../state/vaultShare.js"); await guard();
        if (snapshot.lastShareCode && share.hasPendingShareRotation(snapshot.lastShareCode)) throw new Error("SHARE_ROTATION_PENDING: Finish the pending recipient change in the sharing page first.");
        if (snapshot.lastShareCode && isShortCode(snapshot.lastShareCode)) {
          const existing = await share.decodeShareAsync(snapshot.lastShareCode); await guard();
          if (existing.ok && existing.payload) return g.finish({ code: snapshot.lastShareCode, reused: true, expiresAt: existing.payload.expiresAt ?? existing.payload.cloud?.expiresAt });
        }
        const result = await share.mintShareCode(snapshot, undefined, undefined, guard);
        return g.finish({ code: result.code, reused: false, expiresAt: result.payload.cloud?.expiresAt });
      },
      async importCode(code) {
        const g = await vaultWrite();
        const cloud = await import("../state/vaultCloud.js"); await cloud.installVaultCloudAdapter({ cleanup: false });
        const share = await import("../state/vaultShare.js");
        const commit = async () => { await beforeWrite?.(); await g.finish(null); };
        const result = await share.importShareCodeAsCurrent(code, "new", commit);
        return g.finish(result);
      },
    },
  };
}
