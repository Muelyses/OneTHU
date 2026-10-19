/** 雷达、名片、扫码与 NFC 共用的内容交换入口。 */
import { publishExchangeCode, resolveExchangeCode } from '../state/cloudExchange.js';
import { importShareCodeAsCurrent, shareCodeForBox } from '../state/vaultShare.js';
import { cardsSnapshot, type PersonalCard } from '../state/nameCard.js';
import { encodeTouch, importTouchCode } from '../state/touch.js';
import { acceptOrgInvite } from '../state/org.js';
import { installVaultCloudAdapter } from '../state/vaultCloud.js';
import { decodeQrFile, qrScanSupported } from './qrScan.js';
import { fileToBytes, pickFile, type AttachFile } from './attach.js';
import type { VaultBox } from '../state/vault.js';

export async function personalShareCode(personal: PersonalCard = cardsSnapshot().personal): Promise<string> {
  if (!personal.name.trim()) throw new Error('请先填写名片上的名字');
  /* 名片走稳定分享位：改了就地道更新同一个目录——口令不变，对方读到的永远是最新名片；
   *  没改则复用旧码，不重复上传。 */
  const contentKey = JSON.stringify([personal.name, personal.avatar, personal.website, personal.social, personal.phone, personal.bio, personal.cloudEmail, personal.cover?.updatedAt ?? 0]);
  return publishExchangeCode(encodeTouch({ v: 1, kind: 'onethu-touch', issuedAt: Date.now(), personal: { ...personal } }), contentKey, 'card');
}

/** NFC 与复制口令使用同一联网短码，不再携带头像全文。 */
export const personalNfcCode = personalShareCode;

/** 已生成的口令原样复用，不重复上传。箱子任何变更都会清掉 lastShareCode。 */
export async function vaultShareCode(box: VaultBox): Promise<string> {
  return (await shareCodeForBox(box)).code;
}

/**
 * 统一接收入口：短码/旧码、暂存箱/名片/组织/碰一碰组合全都认。
 *  vaultTarget：'new' = 收到箱子创建新箱、原箱保留（扫码/NFC/雷达/直接交换）；
 *               'current' = 替换当前箱（「导入口令」「收碰一碰」两个旧入口的老行为）。
 */
export async function receiveExchangeCode(text: string, vaultTarget: 'current' | 'new' = 'new'): Promise<string> {
  const code = await resolveExchangeCode(text);
  if (code.startsWith('ONTOUCH1.')) {
    await installVaultCloudAdapter();
    const r = await importTouchCode(code, cardsSnapshot().personal.name || '我', vaultTarget);
    if (!r.ok) throw new Error(r.reason || '碰一碰口令无法导入');
    const parts = [
      r.vault ? (vaultTarget === 'new' ? '新暂存箱' : '当前暂存箱') : '',
      r.contact ? '个人名片' : '',
      r.org ? '组织邀请' : '',
    ].filter(Boolean);
    if (!parts.length) return r.duplicate ? '本地已有这张名片（未重复添加）' : '这个口令里没有新内容';
    return `已收到 ${parts.join('、')}${r.duplicate ? '（部分内容本地已有）' : ''}`;
  }
  if (/^ONV[12]\./.test(code)) {
    await installVaultCloudAdapter();
    const r = await importShareCodeAsCurrent(code, vaultTarget);
    if (!r.ok) throw new Error(r.reason || '暂存箱口令无法导入');
    return vaultTarget === 'new'
      ? `已收到 ${r.imported ?? 0} 项内容，已存入新暂存箱`
      : `已导入 ${r.imported ?? 0} 项，替换为当前暂存箱`;
  }
  if (code.startsWith('ONORG1.')) {
    const r = await acceptOrgInvite(code, cardsSnapshot().personal.name || '我');
    if (!r.ok) throw new Error(r.reason || '组织邀请无法识别');
    return '已加入组织（本地成员清单）';
  }
  throw new Error('这不是有效的 OneTHU 分享口令');
}

/** 扫码接收：选一张二维码图片 → 识别 → 统一接收入口（整页/雷达/抽屉共用）。 */
export async function receiveQrImage(file: AttachFile): Promise<string> {
  if (!file.mime.startsWith('image/')) throw new Error('请选择一张二维码图片');
  const bytes = await fileToBytes(file, 8 * 1024 * 1024);
  const domFile = file.file ?? new File([bytes], file.name, { type: file.mime });
  const text = await decodeQrFile(domFile);
  if (!text) throw new Error('图片里没有识别到二维码');
  return receiveExchangeCode(text);
}

/** 扫码按钮公共流程：用户取消时返回空串（不报错）。 */
export async function pickAndReceiveQr(): Promise<string> {
  if (!qrScanSupported()) throw new Error('当前环境不支持二维码识别');
  const f = await pickFile();
  if (!f) return '';
  return receiveQrImage(f);
}

/** 粘贴口令按钮公共流程：空内容明确提示。 */
export async function receivePastedCode(code: string): Promise<string> {
  const text = String(code ?? '').trim();
  if (!text) throw new Error('先粘贴收到的口令');
  return receiveExchangeCode(text);
}
