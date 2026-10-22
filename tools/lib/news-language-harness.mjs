import React from '__REACT_URL__';
import Client from '/node_modules/.vite/deps/react-dom_client.js';
import { Ctx } from '/src/state/context.ts';
import { useNews, useTodayNewsFeed } from '/src/state/data.ts';
import { cacheSet, cacheGet } from '/src/state/cache.ts';
import { info } from '/src/lib/clients.ts';
import { setLocale } from '/src/i18n/index.ts';
import { newsCacheKey, todayNewsCacheKey } from '/src/lib/newsLanguage.ts';
const h = React.createElement;
const held = new Set(), pending = [];
window.__calls = [];
window.__hold = language => held.add(language);
window.__release = language => { held.delete(language); for (const item of pending.splice(0)) item.language === language ? item.resolve() : pending.push(item); };
const item = (language, page = 1) => ({xxid:'example-' + page,name:'原始标题 Example',source:language === 'zh' ? '示例单位' : 'Example Office',date:'2099-01-01'});
info.getNews = async (page, length, language) => {
  window.__calls.push({method:'news',page,language});
  if (held.has(language)) await new Promise(resolve => pending.push({language,resolve}));
  return [item(language,page)];
};
info.getNewsSubscriptionList = async language => {
  window.__calls.push({method:'conditions',language});
  return [{id:'stable-condition',source:item(language).source,title:item(language).source}];
};
info.getNewsListBySubscription = async (page, id, language) => {
  window.__calls.push({method:'feed',id:id ?? null,language});
  return [item(language)];
};
cacheSet('news:1:20',[item('en')],false);
cacheSet('todaynews:Old English Label',{list:[item('en')],from:'subs',subCount:1},false);
window.__locale = setLocale;
window.__cache = locale => ({list:cacheGet(newsCacheKey(locale,1,20)),feed:cacheGet(todayNewsCacheKey(locale,'Old English Label'))});
function App() {
  const [page,setPage] = React.useState(1);
  window.__page = setPage;
  const news = useNews(page,20), feed = useTodayNewsFeed(['Old English Label']);
  window.__snapshot = () => ({news:{data:news.data,state:news.state},feed:{data:feed.data,state:feed.state}});
  return h('div',{id:'snapshot'},JSON.stringify(window.__snapshot()));
}
Client.createRoot(document.getElementById('root')).render(h(React.StrictMode,null,
  h(Ctx.Provider,{value:{status:'ready',navigate:()=>{}}},h(App))));
