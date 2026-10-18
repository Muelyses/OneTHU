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
  const hint = !status ? '正在检测 NFC…' : !status.available ? '此设备不支持 NFC，可复制口令分享' : !status.enabled ? '请先在系统设置开启 NFC，返回后重试' : '传送方开启 NFC 传送，接收方开启 NFC 接收，再将手机背面靠近';
  const available = !!status?.available && status.enabled;
  const run = async (makeCode?: () => string | Promise<string>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setState({ phase: 'reading', message: makeCode ? '正在准备要分享的内容…' : '正在等待 NFC 内容，请将手机背面靠近（10 秒内）' });
    try {
      const current = await nfcStatus();
      setStatus(current);
      if (!current.available) throw new Error('此设备不支持 NFC，请使用复制口令');
      if (!current.enabled) throw new Error('NFC 未开启，请到系统设置中开启后重试');
      if (makeCode) {
        await nfcShareText(await makeCode());
        setState({ phase: 'ready', message: '传送已就绪，请让对方开启 NFC 接收并靠近；这里尚未收到对方确认。' });
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
