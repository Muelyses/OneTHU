/** 雷达、名片、扫码与 NFC 共用的内容交换入口。 */
import { publishExchangeCode, resolveExchangeCode } from '../state/cloudExchange.js';
import { isShortCode, shortCodeForLink } from './shortCode.js';
import { markVaultShared } from '../state/vault.js';
import { decodeShareAsync } from '../state/vaultShare.js';
import { cardsSnapshot, type PersonalCard } from '../state/nameCard.js';
import { encodeTouch, importTouchCode } from '../state/touch.js';
import { acceptOrgInvite } from '../state/org.js';
import { importShareCodeAsCurrent, mintShareCode } from '../state/vaultShare.js';
import { installVaultCloudAdapter } from '../state/vaultCloud.js';
import type { VaultBox } from '../state/vault.js';

export async function personalShareCode(personal: PersonalCard = cardsSnapshot().personal): Promise<string> {
  if (!personal.name.trim()) throw new Error('请先填写名片上的名字');
  return publishExchangeCode(encodeTouch({ v: 1, kind: 'onethu-touch', issuedAt: Date.now(), personal: { ...personal } }));
}

/** NFC 与复制口令使用同一联网短码，不再携带头像全文。 */
export const personalNfcCode = personalShareCode;

/** 已生成的口令原样复制，不重复上传。箱子修改后 store 会清掉旧口令。 */
export async function vaultShareCode(box: VaultBox): Promise<string> {
  if (box.lastShareCode && isShortCode(box.lastShareCode)) return box.lastShareCode;
  if (box.lastShareCode) {
    const old = await decodeShareAsync(box.lastShareCode);
    if (old.ok && old.payload?.cloud?.shareUrl) {
      const code = shortCodeForLink(old.payload.cloud.shareUrl);
      markVaultShared(box.id, code);
      return code;
    }
  }
  if (!box.items.length) throw new Error('暂存箱还是空的，先收进一些内容');
  const connected = await installVaultCloudAdapter();
  if (!connected) throw new Error('请先在云盘页连接清华云盘，再分享暂存箱');
  return (await mintShareCode(box)).code;
}

export async function receiveExchangeCode(text: string): Promise<string> {
  const code = await resolveExchangeCode(text);
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
    const r = await acceptOrgInvite(code, cardsSnapshot().personal.name || '我');
    if (!r.ok) throw new Error(r.reason || '组织邀请无法识别');
    return '已加入组织（本地成员清单）';
  }
  throw new Error('这不是有效的 OneTHU 分享口令');
}
