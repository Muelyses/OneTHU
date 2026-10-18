/** 雷达、名片、扫码与 NFC 共用的内容交换入口。 */
import { cardsSnapshot, type PersonalCard } from '../state/nameCard.js';
import { encodeTouch, importTouchCode } from '../state/touch.js';
import { acceptOrgInvite } from '../state/org.js';
import { allowInlineShare, importShareCodeAsCurrent, mintShareCode } from '../state/vaultShare.js';
import { installVaultCloudAdapter } from '../state/vaultCloud.js';
import type { VaultBox } from '../state/vault.js';

export function personalShareCode(personal: PersonalCard = cardsSnapshot().personal): string {
  if (!personal.name.trim()) throw new Error('请先填写名片上的名字');
  return encodeTouch({ v: 1, kind: 'onethu-touch', issuedAt: Date.now(), personal: { ...personal } });
}

/** NFC 只缩小传送副本的头像，原名片与复制口令保留原图，避免超过 HCE 容量。 */
export async function personalNfcCode(personal: PersonalCard = cardsSnapshot().personal): Promise<string> {
  const original = personalShareCode(personal);
  if (new TextEncoder().encode(original).length <= 30_000) return original;
  if (!personal.avatar.startsWith('data:image/')) throw new Error('名片内容太大，请使用复制名片口令');
  const img = new Image();
  img.src = personal.avatar;
  try { await img.decode(); }
  catch { throw new Error('无法读取名片头像，请换一张头像或复制名片口令'); }
  for (const edge of [96, 64, 48]) {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) break;
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const code = personalShareCode({ ...personal, avatar: canvas.toDataURL('image/webp', 0.75) });
    if (new TextEncoder().encode(code).length <= 30_000) return code;
  }
  throw new Error('名片内容太大，请使用复制名片口令');
}

/** 已生成的口令原样复制，不重复上传。箱子修改后 store 会清掉旧口令。 */
export async function vaultShareCode(box: VaultBox): Promise<string> {
  if (box.lastShareCode) return box.lastShareCode;
  if (!box.items.length) throw new Error('暂存箱还是空的，先收进一些内容');
  const connected = await installVaultCloudAdapter();
  if (!connected && !allowInlineShare()) throw new Error('请先在云盘页连接清华云盘，再分享暂存箱');
  return (await mintShareCode(box)).code;
}

export async function receiveExchangeCode(text: string): Promise<string> {
  const code = text.trim();
  if (code.startsWith('ONTOUCH1.')) {
    await installVaultCloudAdapter();
    const r = await importTouchCode(code, cardsSnapshot().personal.name || '我', 'new');
    if (!r.ok) throw new Error(r.reason || '碰一碰口令无法导入');
    return `已收到 ${[r.vault && '新暂存箱', r.contact && '个人名片', r.org && '组织邀请'].filter(Boolean).join('、')}`;
  }
  if (/^ONV[12]\./.test(code)) {
    await installVaultCloudAdapter();
    const r = await importShareCodeAsCurrent(code, 'new');
    if (!r.ok) throw new Error(r.reason || '暂存箱口令无法导入');
    return `已收到 ${r.imported ?? 0} 项内容，已存入新暂存箱`;
  }
  if (code.startsWith('ONORG1.')) {
    const r = acceptOrgInvite(code, cardsSnapshot().personal.name || '我');
    if (!r.ok) throw new Error(r.reason || '组织邀请无法识别');
    return '已加入组织（本地成员清单）';
  }
  throw new Error('这不是有效的 OneTHU 分享口令');
}
