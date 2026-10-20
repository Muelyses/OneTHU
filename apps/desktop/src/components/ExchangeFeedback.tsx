import { t as i18n, useLocale as useUiLocale } from "../i18n/index.js";
import {Btn,Modal} from '@onethu/gui';
import {IconCheck} from './Icons.js';
export type ExchangeState={phase:'reading'|'ready'|'success'|'error';message:string};
export function ExchangeFeedback({state,onClose}:{state:ExchangeState|null;onClose:()=>void}){
  const uiLocale = useUiLocale();
return <Modal open={!!state} onClose={onClose} title={state?.phase==='success'?i18n("components.exchangefeedback.fd5604fb98da"):state?.phase==='error'?i18n("components.exchangefeedback.a7ff58014f69"):i18n("components.exchangefeedback.a09140ba2076")} size="sm"><div className={'exchange-feedback is-'+state?.phase} role="status" aria-live="polite"><div className="exchange-stage"><i/><i/><i/>{state?.phase==='success'?<IconCheck width={130} height={130}/>:state?.phase==='error'?<span className="exchange-error">!</span>:<div className="exchange-card"><span>OneTHU</span><b>{i18n("components.exchangefeedback.43c75d0b128e")}</b></div>}</div><p>{state?.message}</p><Btn variant="solid" onClick={onClose}>{state?.phase==='reading'||state?.phase==='ready'?i18n("components.exchangefeedback.b4dc674af8e0"):i18n("components.exchangefeedback.c0b3fbff51cc")}</Btn></div></Modal>;}
