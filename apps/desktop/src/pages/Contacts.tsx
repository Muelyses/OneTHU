import {useState} from 'react';
import {Segment} from '@onethu/gui';
import {PageHead} from '../components/Layout.js';
import {PageAtomStar} from '../components/Collect.js';
import {NameCardSection} from '../components/NameCardSection.js';
import {OrganizationSection} from '../components/OrganizationSection.js';
export function ContactsPage(){const [tab,setTab]=useState('cards');return <div className="contacts-page"><PageHead title="通讯录" meta="交换一张名片，让联结留在这里。" actions={<PageAtomStar atomKey="contacts" title="通讯录"/>}/><Segment value={tab} onChange={setTab} options={[{value:'cards',label:'名片夹'},{value:'orgs',label:'我的组织'}]}/>{tab==='cards'?<NameCardSection view="contacts"/>:<OrganizationSection/>}</div>;}
