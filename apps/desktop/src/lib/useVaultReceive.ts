import { t as i18n, msg as i18nMsg } from "../i18n/index.js";
import { useCallback, useState } from 'react';
import { openFormModal } from './formModal.js';
import { pickAndReceiveQr, receivePastedCode } from './contentExchange.js';
import { showToast } from '../state/toast.js';

/**
 * 暂存箱各形态（整页/雷达/抽屉）共用的「收进来」：粘贴口令 + 扫码。
 * 统一走 contentExchange 的接收入口，因此新旧口令、箱子/名片/组织/碰一碰全都认。
 */
export function useVaultReceive(): { busy: boolean; paste: () => Promise<void>; scan: () => Promise<void> } {
  const [busy, setBusy] = useState(false);
  const paste = useCallback(async (): Promise<void> => {
    const f = await openFormModal(i18nMsg("lib.usevaultreceive.52099bc955e2"), [{ key: 'code', label: i18nMsg("lib.usevaultreceive.2d15367c7b10"), kind: 'textarea', required: true }]);
    if (!f?.code) return;
    setBusy(true);
    try { showToast(await receivePastedCode(f.code)); }
    catch (e) { showToast(e instanceof Error ? e.message : i18n("lib.usevaultreceive.f4fdedae07d4")); }
    finally { setBusy(false); }
  }, []);
  const scan = useCallback(async (): Promise<void> => {
    setBusy(true);
    try { const message = await pickAndReceiveQr(); if (message) showToast(message); }
    catch (e) { showToast(e instanceof Error ? e.message : i18n("lib.usevaultreceive.669e25e96db0")); }
    finally { setBusy(false); }
  }, []);
  return { busy, paste, scan };
}
