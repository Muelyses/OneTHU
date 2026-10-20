import { t as i18n } from "../i18n/index.js";
import { useEffect, useRef, useState } from 'react';
import { ExchangeFeedback, type ExchangeState } from '../components/ExchangeFeedback.js';
import { nfcReadText, nfcShareText, nfcStatus, type NfcStatus } from './nfc.js';
import { receiveExchangeCode } from './contentExchange.js';

/** NFC 入口共享能力提示、互斥操作和交换动效；ready 只代表发送已就绪。 */
export function useNfcExchange(active = true) {
  const [status, setStatus] = useState<NfcStatus | null>(null);
  const [state, setState] = useState<ExchangeState | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const refresh = () => { void nfcStatus().then(s => { if (live) setStatus(s); }); };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { live = false; window.removeEventListener('focus', refresh); };
  }, [active]);
  const hint = !status ? i18n("lib.usenfcexchange.a4fb7d646812") : !status.available ? i18n("lib.usenfcexchange.113392f6a1c6") : !status.enabled ? i18n("lib.usenfcexchange.68f717a1ed08") : i18n("lib.usenfcexchange.0ae6a92e95dc");
  const available = !!status?.available && status.enabled;
  const run = async (makeCode?: () => string | Promise<string>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setState({ phase: 'reading', message: makeCode ? i18n("lib.usenfcexchange.ffc7745f39e3") : i18n("lib.usenfcexchange.6e17251696e8") });
    try {
      const current = await nfcStatus();
      setStatus(current);
      if (!current.available) throw new Error(i18n("lib.usenfcexchange.810417d87789"));
      if (!current.enabled) throw new Error(i18n("lib.usenfcexchange.1f80dd1ff89a"));
      if (makeCode) {
        await nfcShareText(await makeCode());
        setState({ phase: 'ready', message: i18n("lib.usenfcexchange.7f8924faa4e5") });
      } else {
        const message = await receiveExchangeCode(await nfcReadText());
        setState({ phase: 'success', message });
      }
    } catch (e) {
      setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return {
    available, busy, hint,
    send: (makeCode: () => string | Promise<string>) => run(makeCode),
    receive: () => run(),
    feedback: <ExchangeFeedback state={state} onClose={() => setState(null)} />,
  };
}
