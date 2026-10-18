import type {PersonalCard, OrgCard} from '../state/nameCard.js';
export function IdentityCard({card,organization=false,back=false}:{card:PersonalCard|OrgCard;organization?:boolean;back?:boolean}){
 const p=card as PersonalCard,o=card as OrgCard;
 return <article className={'identity-card'+(organization?' is-organization':'')+(back?' is-back':'')}>
 <div className="identity-card-stock" aria-hidden="true"/><header><span>OneTHU</span><small>{organization?'ORGANIZATION':'PERSONAL CARD'}</small></header>
 <div className="identity-card-person">{p.avatar?<img src={p.avatar} alt=""/>:<span className="identity-monogram">{(card.name||'我').slice(0,1)}</span>}<div><h2>{card.name||'我的名片'}</h2><p>{organization?o.brief:p.bio||'在清华，与你相遇。'}</p></div></div>
 <footer><span>{organization?o.joinUrl:[p.website,p.social,p.phone].filter(Boolean).join(' · ')||'点击编辑，写下你的介绍'}</span><span className="identity-seal" aria-hidden="true">THU</span></footer>
 </article>;
}
