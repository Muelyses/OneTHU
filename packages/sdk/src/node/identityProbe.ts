/** Read-only identity proof using the same WebVPN bootstrap as the desktop.
 * A fresh SSO session may not have visited Info yet. The cookie endpoint can
 * legitimately return an empty body until that application's entry page loads. */
import { HttpClient, infoUrls, mergeInfoCookieBody, webvpnWrap } from '@onethu/core';
import type { CookieJar, FetchLike } from '@onethu/core';
import { authError } from './storage.js';

const infoEntry = `${infoUrls.INFO_PREFIX}/f/info/gxfw_fg/common/index`;
const loginPage = (body: string) => /<form\b[^>]*action=["'][^"']*(?:login|security_check)|name=["']i_pass["']|id=["']sm2publicKey["']/i.test(body);

export async function probeUniversityIdentity(fetch: FetchLike, jar: CookieJar, check: () => void): Promise<string | null> {
  const http = new HttpClient({ fetch, jar });
  http.webVPNEncoder = webvpnWrap;
  async function cookies(): Promise<{ expired: boolean; csrf?: string }> {
    const response = await http.request(infoUrls.GET_COOKIE_URL());
    const text = await response.text(); check();
    if (response.status === 401 || loginPage(text)) return { expired: true };
    if (!response.ok) throw authError('AUTH_PROBE_UNAVAILABLE');
    return { expired: false, csrf: await mergeInfoCookieBody(http, text, { assertCurrent: check }) };
  }
  let result = await cookies();
  if (result.expired) return null;
  if (!result.csrf) {
    // Exactly one application warm-up, using GET and the existing session.
    // HttpClient also handles the real WebVPN interstitial/cookie dance.
    const entry = await http.text(infoEntry, {}, { validateStatus: true }); check();
    if (loginPage(entry)) return null;
    result = await cookies();
    if (result.expired) return null;
  }
  if (!result.csrf) throw authError('AUTH_PROBE_UNAVAILABLE');
  const url = new URL(infoUrls.INFO_USER_DATA()); url.searchParams.set('_csrf', result.csrf);
  let body: string;
  try { body = await http.text(url.href, {}, { validateStatus: true }); }
  catch (error) {
    if (error instanceof Error && error.message === 'HTTP 401') return null;
    throw error;
  }
  check();
  if (loginPage(body)) return null;
  let data: { result?: unknown; object?: { ryh?: unknown; xh?: unknown }; status?: unknown; code?: unknown };
  try { data = JSON.parse(body); } catch { throw authError('AUTH_PROBE_UNAVAILABLE'); }
  if (data.status === 401 || data.code === 401) return null;
  if (data.result !== undefined && data.result !== 'success') throw authError('AUTH_PROBE_UNAVAILABLE');
  const account = data.object?.ryh ?? data.object?.xh;
  if (typeof account !== 'string' && typeof account !== 'number') throw authError('AUTH_PROBE_UNAVAILABLE');
  const identity = String(account).trim();
  if (!/^\d{5,20}$/.test(identity)) throw authError('AUTH_PROBE_UNAVAILABLE');
  return identity;
}
