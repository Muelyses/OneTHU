/** Seafile 11 has no per-user public-link ACL. Public links therefore hold only
 * AES-GCM ciphertext; the random key lives in a separate, account-shared library.
 * Revocation removes the key grant and link. Neither a shortcode nor a forged
 * client-side email can obtain the key without Seafile accepting its account. */
import { invoke } from "@tauri-apps/api/core";
import { ensureSeafileLoaded, getSeafileToken, repoOwnerEmail, setRepoUserPermission } from "./seafile.js";
import { bytesToBase64 } from "../lib/imageSave.js";
export interface SealedEnvelope {
    v: 1;
    kind: "onethu-sealed";
    keyRepoId: string;
    keyPath: "/key.json";
    iv: string;
    data: string;
}
export interface ShareKey {
    repoId: string;
    key: CryptoKey;
}
const decode = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export async function writeShareText(token: string, repoId: string, parentDir: string, name: string, text: string) {
    await invoke("seafile_upload_text", { token, repoId, parentDir, name, content: text });
}
export async function newShareKey(token: string, email: string): Promise<ShareKey> {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const repo = await invoke<{
        id: string;
    }>("seafile_create_repo", { token, name: "OneTHU 私密分享 " + crypto.randomUUID() });
    try {
        await writeShareText(token, repo.id, "/", "key.json", JSON.stringify({ v: 1, key: bytesToBase64(raw) }));
        const owner = await repoOwnerEmail(repo.id);
        if (owner.toLowerCase() !== email.toLowerCase())
            await setRepoUserPermission(repo.id, email, "r");
        return { repoId: repo.id, key: await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]) };
    }
    catch (e) {
        await invoke("seafile_delete_repo", { token, repoId: repo.id }).catch(() => undefined);
        throw e;
    }
}
export async function sealBytes(bytes: Uint8Array, shared: ShareKey): Promise<SealedEnvelope> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, shared.key, new Uint8Array(bytes).buffer);
    return { v: 1, kind: "onethu-sealed", keyRepoId: shared.repoId, keyPath: "/key.json", iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(data)) };
}
export function isSealed(p: unknown): p is SealedEnvelope { return !!p && typeof p === "object" && (p as SealedEnvelope).kind === "onethu-sealed"; }
export async function readShareKey(envelope: SealedEnvelope): Promise<ShareKey> {
    if (envelope.v !== 1 || !/^[\da-f-]{36}$/i.test(envelope.keyRepoId) || envelope.keyPath !== "/key.json")
        throw new Error("私密分享格式不正确");
    await ensureSeafileLoaded();
    const token = getSeafileToken();
    if (!token)
        throw new Error("这是私密分享，请用获授权的邮箱连接清华云盘");
    let b64: string;
    try {
        b64 = await invoke<string>("seafile_read_bytes", { token, repoId: envelope.keyRepoId, path: envelope.keyPath, maxBytes: 4096 });
    }
    catch {
        throw new Error("当前云盘账号无权读取这条分享，或分享已被撤销");
    }
    const stored = JSON.parse(new TextDecoder().decode(decode(b64)));
    if (stored.v !== 1 || typeof stored.key !== "string")
        throw new Error("分享密钥损坏");
    const raw = decode(stored.key);
    if (raw.length !== 32)
        throw new Error("分享密钥损坏");
    return { repoId: envelope.keyRepoId, key: await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]) };
}
export async function unsealBytes(envelope: SealedEnvelope, shared?: ShareKey): Promise<Uint8Array> {
    const k = shared ?? await readShareKey(envelope);
    if (k.repoId !== envelope.keyRepoId || envelope.data.length > 180 * 1024 * 1024)
        throw new Error("分享内容格式不正确或过大");
    try {
        return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(envelope.iv) }, k.key, decode(envelope.data)));
    }
    catch {
        throw new Error("分享内容校验失败，请让发送者重新分享");
    }
}
export async function readSharedJson(text: string): Promise<unknown> {
    const data: unknown = JSON.parse(text);
    return isSealed(data) ? JSON.parse(new TextDecoder().decode(await unsealBytes(data))) : data;
}
