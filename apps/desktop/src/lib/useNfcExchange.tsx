import { t as i18n } from "../i18n/index.js";
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ExchangeFeedback, type ExchangeState } from '../components/ExchangeFeedback.js';
import { nfcReadText, nfcShareText, nfcStatus, type NfcStatus } from './nfc.js';
import { receiveExchangeCode } from './contentExchange.js';
import { experienceRevision, subscribeExperience, useExperienceMode } from '../state/experienceMode.js';
import { fullModeReceiveSession } from './fullModeReceive.js';

/** NFC 入口共享能力提示、互斥操作和交换动效；ready 只代表发送已就绪。 */
export function useNfcExchange(active = true) {
  const mode = useExperienceMode();
  const revision = useSyncExternalStore(subscribeExperience, experienceRevision, experienceRevision);
  const enabled = active && mode === 'full';
  const [status, setStatus] = useState<NfcStatus | null>(null);
  const [state, setState] = useState<ExchangeState | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<symbol | null>(null);
  useEffect(() => {
    pending.current = null;
    setBusy(false);
    setState(null);
    if (!enabled) return;
    let live = true;
    const receiving = fullModeReceiveSession();
    const refresh = () => {
      if (!live || !receiving.isCurrent()) return;
      void nfcStatus().then(s => { if (live && receiving.isCurrent()) setStatus(s); });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      live = false;
      pending.current = null;
      window.removeEventListener('focus', refresh);
    };
  }, [enabled, revision]);
  const statusHint = !status ? i18n("lib.usenfcexchange.a4fb7d646812") : !status.available ? i18n("lib.usenfcexchange.113392f6a1c6") : !status.enabled ? i18n("lib.usenfcexchange.68f717a1ed08") : i18n("lib.usenfcexchange.0ae6a92e95dc");
  const hint = `${i18n("nfc.unstableNotice")} ${statusHint}`;
  const available = enabled && !!status?.available && status.enabled;
  const run = async (makeCode?: () => string | Promise<string>) => {
    const receiving = fullModeReceiveSession();
    if (!enabled || !receiving.isCurrent() || pending.current) return;
    const operation = Symbol();
    pending.current = operation;
    const currentOperation = () => receiving.isCurrent() && pending.current === operation;
    setBusy(true);
    setState({ phase: 'reading', message: makeCode ? i18n("lib.usenfcexchange.ffc7745f39e3") : i18n("lib.usenfcexchange.6e17251696e8") });
    try {
      const current = await nfcStatus();
      if (!currentOperation()) return;
      setStatus(current);
      if (!current.available) throw new Error(i18n("lib.usenfcexchange.810417d87789"));
      if (!current.enabled) throw new Error(i18n("lib.usenfcexchange.1f80dd1ff89a"));
      if (makeCode) {
        const code = await makeCode();
        if (!currentOperation()) return;
        await nfcShareText(code);
        if (!currentOperation()) return;
        setState({ phase: 'ready', message: i18n("lib.usenfcexchange.7f8924faa4e5") });
      } else {
        const text = await nfcReadText();
        if (!currentOperation()) return;
        const message = await receiveExchangeCode(text);
        if (!currentOperation()) return;
        setState({ phase: 'success', message });
      }
    } catch (e) {
      if (currentOperation()) setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      if (pending.current === operation) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  return {
    available, busy, hint,
    send: (makeCode: () => string | Promise<string>) => run(makeCode),
    receive: () => run(),
    feedback: enabled ? <ExchangeFeedback state={state} onClose={() => setState(null)} /> : null,
  };
}
