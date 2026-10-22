/** Actual InfoClient + HttpClient, anonymous responses; no school/network access. */
import assert from 'node:assert/strict';
import { HttpClient } from '../packages/core/src/http.ts';
import { InfoClient } from '../packages/core/src/info/client.ts';
import { INFO_PREFIX } from '../packages/core/src/info/urls.ts';
import { newsLanguage, newsCacheKey, todayNewsCacheKey, newsMetadataForLanguage } from '../apps/desktop/src/lib/newsLanguage.ts';

globalThis.fetch = async () => { throw Error('Live network forbidden'); };
const defer = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log('✓ ' + name); }
function fixture() {
  let language = 'en', failSwitch = false, heldRead = null;
  const calls = [];
  const http = new HttpClient({ fetch: async (raw, init) => {
    const url = new URL(raw);
    calls.push({ path: url.pathname, query: url.searchParams, body: init.body, language });
    if (url.pathname.endsWith('/f/lang/change')) {
      if (failSwitch) return new Response('Unavailable', { status: 503 });
      language = url.searchParams.get('websiteShowLanguage') === 'en_US' ? 'en' : 'zh';
      return new Response('{}');
    }
    if (heldRead) { const held = heldRead; heldRead = null; await held.promise; }
    const source = language === 'zh' ? '示例单位' : 'Example Office';
    const item = { xxid: 'example-id', bt: '学校原始标题 Example', time: '2099-01-01', dwmc_show: source, yxzd: '', lmid: 'LM_JWGG' };
    let object;
    if (url.pathname.endsWith('/template/more')) object = { dataList: [item] };
    else if (url.pathname.endsWith('/getMobilePageList')) object = { resultsList: [item] };
    else if (url.pathname.endsWith('/querySubscribeInfomationPageList')) object = { resultList: [item] };
    else if (url.pathname.endsWith('/querySubscribeInformationUnitList')) object = [{ id: 'example-office', text: source }];
    else if (url.pathname.endsWith('/querySubscribeConditionNameList/XXFB')) object = [{ id: 'example-condition', fbdwmcList: [source], titile: source }];
    else if (url.pathname.endsWith('/template/detail')) object = { xxDto: { bt: '学校原始标题 Example', nr: '<p>学校原始正文 Example Office</p>' } };
    else throw Error('Unexpected fixture URL ' + url.pathname);
    return new Response(JSON.stringify({ object }));
  } });
  http.jar.setRaw(new URL(INFO_PREFIX + '/'), 'XSRF-TOKEN=fixture-only; Path=/');
  return { client: new InfoClient(http), calls, failSwitch: v => { failSwitch = v; }, hold: v => { heldRead = v; } };
}

await test('Chinese reads replace an inherited English portal session, keeping original title', async () => {
  const f = fixture(), item = (await f.client.getNews())[0];
  assert.equal(item.source, '示例单位');
  assert.equal(item.name, '学校原始标题 Example');
  assert.equal(f.calls[0].query.get('websiteShowLanguage'), 'awefawef');
  assert.equal(f.calls.length, 2);
});
for (const language of ['zh', 'en']) {
  await test(language + ': list, search, subscription feed, unit picker and saved conditions agree', async () => {
    const f = fixture(), source = language === 'zh' ? '示例单位' : 'Example Office';
    const results = await Promise.all([
      f.client.getNews(2, 10, language), f.client.searchNews('学校', 1, false, language),
      f.client.getNewsListBySubscription(1, 'example-condition', language),
      f.client.getNewsSourceList(language), f.client.getNewsSubscriptionList(language),
    ]);
    assert.deepEqual(results.map((rows, i) => i === 3 ? rows[0].sourceName : rows[0].source), Array(5).fill(source));
    assert.equal(results[3][0].sourceId, 'example-office');
    assert.equal(results[4][0].id, 'example-condition');
    assert.equal(results[0][0].name, '学校原始标题 Example');
    const feed = f.calls.find(c => c.path.endsWith('/querySubscribeInfomationPageList'));
    assert.equal(new URLSearchParams(feed.body).get('dyid'), 'example-condition');
    const search = f.calls.find(c => c.path.endsWith('/getMobilePageList'));
    assert.equal(JSON.parse(new URLSearchParams(search.body).get('esParamClass')).params.bt, '学校');
    assert.equal(f.calls.length, 10);
  });
}
await test('concurrent opposite-language readers hold language until their response completes', async () => {
  const f = fixture(), held = defer(); f.hold(held);
  const zh = f.client.getNews(1, 20, 'zh');
  while (f.calls.length < 2) await new Promise(resolve => setTimeout(resolve, 0));
  const en = f.client.getNews(1, 20, 'en');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(f.calls.length, 2, 'English cannot change the session while Chinese read is pending');
  held.resolve();
  assert.equal((await zh)[0].source, '示例单位');
  assert.equal((await en)[0].source, 'Example Office');
});
await test('a failed language switch does not read mislabeled data or poison subsequent reads', async () => {
  const f = fixture(); f.failSwitch(true);
  await assert.rejects(f.client.getNews(), /HTTP 503/);
  assert.equal(f.calls.length, 1);
  f.failSwitch(false);
  assert.equal((await f.client.getNews(1, 20, 'en'))[0].source, 'Example Office');
});
await test('article content is unchanged and does not switch the portal language', async () => {
  const f = fixture(), detail = await f.client.getNewsDetail('example-id');
  assert.equal(detail.html, '<p>学校原始正文 Example Office</p>');
  assert.equal(detail.title, '学校原始标题 Example');
  assert.equal(f.calls.length, 1);
});
await test('cache keys separate languages, pages and legacy unlabeled values', async () => {
  assert.equal(newsLanguage('zh-CN'), 'zh'); assert.equal(newsLanguage('zh-TW'), 'zh');
  assert.equal(newsLanguage('en-US'), 'en'); assert.equal(newsLanguage('fr-FR'), 'en');
  const keys = ['zh-CN', 'en-US'].flatMap(locale => [1, 2].map(page => newsCacheKey(locale, page, 20)));
  assert.equal(new Set(keys).size, 4);
  assert.ok(!keys.includes('news:1:20'));
  assert.notEqual(todayNewsCacheKey('zh-CN', 'Example Office'), todayNewsCacheKey('en-US', 'Example Office'));
  assert.notEqual(todayNewsCacheKey('zh-CN', ''), 'todaynews:');
});
await test('search and subscribed details recover localized metadata without reusing the previous language', async () => {
  const item = Object.freeze({xxid:'off-main-page',name:'原始标题',source:'示例单位'});
  const old = Object.freeze({...item,source:'Example Office'});
  for (const from of [1,2]) {
    const pages = [{language:'zh',items:[]},{language:'en',items:[old]},{language:'en',items:[old]}];
    assert.equal(newsMetadataForLanguage(item.xxid,'zh',pages),undefined);
    pages[from]={language:'zh',items:[item]};
    assert.equal(newsMetadataForLanguage(item.xxid,'zh',pages),item);
    assert.equal(old.source,'Example Office');
  }
});
console.log(`News language: ${checks} behavioral cases passed.`);
