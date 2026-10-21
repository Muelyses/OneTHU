import { t as i18n } from "../i18n/index.js";
/**
 * 天气数据层（首页/白板的「天气」组件用）。
 *
 * 数据源：open-meteo 免费接口（免 key、免 THU 会话，直连即可），坐标默认清华。
 * 纪律与仓库一致：不引新依赖、纯 fetch + 模块级缓存 + 订阅；30 分钟 TTL（天气不需要
 * 更勤）；失败保留旧值并给出 reason；绝不阻塞渲染——卡片拿到 null 就显示占位文案。
 *
 * 为什么不进 state/cache.ts：那套 SWR 缓存绑定 THU 会话生命周期（登录清缓存等），
 * 天气与之无关；独立小缓存反而免得被「退出登录」连坐清掉。
 */

export interface WeatherNow {
  temp: number;
  feels: number;
  code: number;
  humidity: number;
  wind: number;
}

export interface WeatherDay {
  date: string; // YYYY-MM-DD
  min: number;
  max: number;
  code: number;
}

export interface WeatherData {
  now: WeatherNow;
  days: WeatherDay[];
  place: string;
  at: number; // 拉取时刻
}

const KEY = "onethu.weather.v1";
const TTL = 30 * 60 * 1000;
/** 清华（北京海淀）坐标；后续要做「自动定位」时改这里的数据来源即可，组件层无感 */
const LAT = 39.996;
const LON = 116.326;
const PLACE = "北京 · 清华园";

/** WMO weather code → 中文短语（用户偏好：不上 emoji，文字干净） */
export function weatherText(code: number): string {
  if (code === 0) return i18n("state.weather.6379ede5c239");
  if (code === 1) return i18n("state.weather.6aec964d8012");
  if (code === 2) return i18n("state.weather.30c379777e5d");
  if (code === 3) return i18n("state.weather.78df214e37ef");
  if (code === 45 || code === 48) return i18n("state.weather.853385be3d5a");
  if (code >= 51 && code <= 57) return i18n("state.weather.a16db8e97c85");
  if (code >= 61 && code <= 65) return i18n("state.weather.124d60580dfa");
  if (code === 66 || code === 67) return i18n("state.weather.86879622e5c9");
  if (code >= 71 && code <= 77) return i18n("state.weather.53058fe2e03c");
  if (code >= 80 && code <= 82) return i18n("state.weather.448c8292f481");
  if (code === 85 || code === 86) return i18n("state.weather.0a9c46115749");
  if (code === 95) return i18n("state.weather.9ddc77d8932a");
  if (code === 96 || code === 99) return i18n("state.weather.6ac58535bcad");
  return "—";
}

interface CacheShape {
  data: WeatherData | null;
  at: number;
  reason?: string;
}

let cache: CacheShape = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as CacheShape;
  } catch {
    /* 脏数据当没有 */
  }
  return { data: null, at: 0 };
})();

const listeners = new Set<() => void>();

function commit(next: CacheShape): void {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* 存储满：天气是可重取的易失数据，静默 */
  }
  listeners.forEach((f) => f());
}

export function subscribeWeather(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function weatherSnapshot(): CacheShape {
  return cache;
}

export function weatherStale(): boolean {
  return !cache.data || Date.now() - cache.at > TTL;
}

let inflight: Promise<void> | null = null;

/** 拉一次天气（进行中则复用同一请求）；force=true 忽略 TTL */
export function refreshWeather(force = false): Promise<void> {
  if (!force && !weatherStale()) return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
        "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m" +
        "&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=Asia%2FShanghai&forecast_days=4";
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12_000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const j = (await res.json()) as {
        current?: Record<string, number>;
        daily?: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; weather_code: number[] };
      };
      const cur = j.current;
      const daily = j.daily;
      if (!cur || typeof cur.temperature_2m !== "number" || !daily?.time?.length) throw new Error(i18n("state.weather.a53568b517c6"));
      const data: WeatherData = {
        now: {
          temp: cur.temperature_2m,
          feels: cur.apparent_temperature ?? cur.temperature_2m,
          code: cur.weather_code ?? 0,
          humidity: cur.relative_humidity_2m ?? 0,
          wind: cur.wind_speed_10m ?? 0,
        },
        days: daily.time.map((d, i) => ({
          date: d,
          min: daily.temperature_2m_min[i] ?? 0,
          max: daily.temperature_2m_max[i] ?? 0,
          code: daily.weather_code[i] ?? 0,
        })),
        place: PLACE,
        at: Date.now(),
      };
      commit({ data, at: data.at });
    } catch (e) {
      // 保留旧值，只记原因（卡片上显示「x 分钟前」+ 刷新钮）
      commit({ ...cache, at: cache.at, reason: e instanceof Error ? e.message : String(e) });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** 拉取时刻的「x 分钟前」文案（卡片角落用） */
export function weatherAgeText(): string {
  if (!cache.at) return "";
  const mins = Math.max(0, Math.round((Date.now() - cache.at) / 60000));
  if (mins < 1) return i18n("state.weather.de6785d99e02");
  if (mins < 60) return i18n("state.weather.4ba0128b1216", { mins: String(mins) });
  return i18n("state.weather.690c01945f17", { value: String(Math.round(mins / 60)) });
}
