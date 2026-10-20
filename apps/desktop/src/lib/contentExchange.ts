import { t as i18n, getLocale } from "../i18n/index.js";
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
  if (!personal.name.trim()) throw new Error(i18n("lib.contentexchange.67a52d762038"));
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
    if (!r.ok) throw new Error(r.reason || i18n("lib.contentexchange.97ca5653783f"));
    const parts = [
      r.vault ? (vaultTarget === 'new' ? i18n("lib.contentexchange.4dc6d8e7a87a") : i18n("lib.contentexchange.17fa33d72406")) : '',
      r.contact ? i18n("lib.contentexchange.fd5394f29856") : '',
      r.org ? i18n("lib.contentexchange.b8fde21bc2ca") : '',
    ].filter(Boolean);
    if (!parts.length) return r.duplicate ? i18n("lib.contentexchange.290e61e70691") : i18n("lib.contentexchange.045720f46a17");
    return r.duplicate
      ? i18n("lib.contentexchange.3bdb847af08f", { contents: new Intl.ListFormat(getLocale(), { style: "long", type: "conjunction" }).format(parts) })
      : i18n("lib.contentexchange.b3cbed6586bd", { contents: new Intl.ListFormat(getLocale(), { style: "long", type: "conjunction" }).format(parts) });
  }
  if (/^ONV[12]\./.test(code)) {
    await installVaultCloudAdapter();
    const r = await importShareCodeAsCurrent(code, vaultTarget);
    if (!r.ok) throw new Error(r.reason || i18n("lib.contentexchange.354191707f33"));
    return vaultTarget === 'new'
      ? i18n("lib.contentexchange.36987ff12d5e", { count: r.imported ?? 0 })
      : i18n("lib.contentexchange.9111f2690fbb", { count: r.imported ?? 0 });
  }
  if (code.startsWith('ONORG1.')) {
    const r = await acceptOrgInvite(code, cardsSnapshot().personal.name || '我');
    if (!r.ok) throw new Error(r.reason || i18n("lib.contentexchange.f69fb628aaab"));
    return i18n("lib.contentexchange.2c608891c3c4");
  }
  throw new Error(i18n("lib.contentexchange.d1957be29bf9"));
}

/** 扫码接收：选一张二维码图片 → 识别 → 统一接收入口（整页/雷达/抽屉共用）。 */
export async function receiveQrImage(file: AttachFile): Promise<string> {
  if (!file.mime.startsWith('image/')) throw new Error(i18n("lib.contentexchange.5ccdc18fde7a"));
  const bytes = await fileToBytes(file, 8 * 1024 * 1024);
  const domFile = file.file ?? new File([bytes], file.name, { type: file.mime });
  const text = await decodeQrFile(domFile);
  if (!text) throw new Error(i18n("lib.contentexchange.ed909fbcd134"));
  return receiveExchangeCode(text);
}

/** 扫码按钮公共流程：用户取消时返回空串（不报错）。 */
export async function pickAndReceiveQr(): Promise<string> {
  if (!qrScanSupported()) throw new Error(i18n("lib.contentexchange.563bc0abe5ef"));
  const f = await pickFile();
  if (!f) return '';
  return receiveQrImage(f);
}

/** 粘贴口令按钮公共流程：空内容明确提示。 */
export async function receivePastedCode(code: string): Promise<string> {
  const text = String(code ?? '').trim();
  if (!text) throw new Error(i18n("lib.contentexchange.39815ac69fb6"));
  return receiveExchangeCode(text);
}
