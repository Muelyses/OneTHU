import { getLocale as getUiLocale } from "../../i18n/index.js";
import { t as i18n, rich as i18nRich, useLocale as useUiLocale } from "../../i18n/index.js";
import { Btn } from "@onethu/gui";
/**
 * 在线服务（THOS 服务大厅原生化，上游 thu-info-app 5774b4a9 移植）。
 *
 * 数据层 = vendored @onethu/info-lib 的 thos-services 模块：
 *   prepareThosSession（计数+会话校验，roamingWrapper 内嵌登录链自愈）
 *   getThosTasks(kind)（进行中/待办/已办结/草稿/抄送/阶段性）
 *   getThosServices（服务目录）
 * —— 无任何新增登录/2FA/WebVPN 代码，会话随主登录链自愈（上游 docs/online-services.md 定案）。
 *
 * UI 适配：上游 RN ScrollView/TouchableOpacity/AsyncStorage → web div/localStorage；
 * 官方服务页动作走系统浏览器（openExternal）——Tauri webview 与 rust 会话
 * 不共享 cookie，内嵌 webview 的 cookie 桥是后续增强，不阻塞本期。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CollectStar } from "../../components/Collect.js";
import { SEED_KEYWORDS, loadSeedState, pickSeedServices } from "../../lib/thosSeed.js";
import { enc, noteAtomCache } from "../../state/atoms.js";
import { IconPin } from "../../components/Icons.js";
import type {
  ThosCounts,
  ThosPage,
  ThosService,
  ThosTask,
  ThosTaskKind,
} from "@onethu/info-lib";
import { Card, Empty, ErrorNote, PageHead, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { useApp } from "../../state/context.js";

type Tab = ThosTaskKind | "services";

const TASK_KINDS: ThosTaskKind[] = ["active", "todo", "completed", "drafts", "unread", "phases"];
const PRIMARY: ThosTaskKind[] = ["active", "todo", "completed"];

const KIND_LABEL: Record<ThosTaskKind, string> = {
  get active() { return i18n("pages.info.thospage.dc9591e56d50"); },
  get todo() { return i18n("pages.info.thospage.c37f9cc76310"); },
  get completed() { return i18n("pages.info.thospage.3229d61dcb0a"); },
  get drafts() { return i18n("pages.info.thospage.2a2fd29bd27a"); },
  get unread() { return i18n("pages.info.thospage.2934c3ab3025"); },
  get phases() { return i18n("pages.info.thospage.988a99c7772c"); },
};

const STATUS_LABEL: Record<string, string> = {
  get 退回修改() { return i18n("pages.info.thospage.0eb3fb1deb49"); },
  get 待我处理() { return i18n("pages.info.thospage.c37f9cc76310"); },
  get 正在办理() { return i18n("pages.info.thospage.9f829ede589a"); },
  get 已办结() { return i18n("pages.info.thospage.3229d61dcb0a"); },
  get 办理成功() { return i18n("pages.info.thospage.fccb47619552"); },
  get 办理失败() { return i18n("pages.info.thospage.c4b2699a8f46"); },
  get 已撤回() { return i18n("pages.info.thospage.0462a8aa7036"); },
  get 草稿() { return i18n("pages.info.thospage.2a2fd29bd27a"); },
  get 未阅() { return i18n("pages.info.thospage.69c9c65d8f40"); },
  get 已阅() { return i18n("pages.info.thospage.25f4520c3f09"); },
  get 待办理() { return i18n("pages.info.thospage.1fbc49548f86"); },
};

/** 「任务已被XX办理」站方文案（上游 getThosTaskStatusLabel 同款兜底） */
function statusLabel(status: string): string {
  if (STATUS_LABEL[status]) return STATUS_LABEL[status]!;
  // These delimiters come from the server protocol, not the current UI locale.
  const prefix = "任务已被";
  const suffix = "办理";
  if (status.startsWith(prefix) && status.endsWith(suffix)) {
    return i18n("pages.info.thospage.999fe423c060", { value: String(status.slice(prefix.length, status.length - suffix.length)) });
  }
  return status;
}

const PHASE_STATE: Record<string, string> = {
  "0": "待办理",
  "1": "进行中",
  "4": "成功",
  "5": "失败",
};
const phaseLabel = (state: string): string => PHASE_STATE[state] ?? i18n("pages.info.thospage.93e474c68ed5");

function favKey(userId: string): string {
  return `thos-favorites:${userId}`;
}

function recentKey(userId: string): string {
  return `thos-recent:${userId}`;
}

function loadRecent(userId: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(recentKey(userId)) ?? "[]");
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** 预置「常用服务」的一次性标记（只做一次，之后完全由用户增删） */
function seedKey(userId: string): string {
  return `thos-favorites-seeded:${userId}`;
}


function loadFavorites(userId: string): string[] {
  try {
    const raw = localStorage.getItem(favKey(userId));
    const value = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const DATE_LABEL: Record<ThosTaskKind, string> = {
  get completed() { return i18n("pages.info.thospage.46591ce50306"); },
  get drafts() { return i18n("pages.info.thospage.f33047eb02ec"); },
  get active() { return i18n("pages.info.thospage.e9b5d944cc4b"); },
  get todo() { return i18n("pages.info.thospage.e9b5d944cc4b"); },
  get unread() { return i18n("pages.info.thospage.eafda4eeec88"); },
  get phases() { return i18n("pages.info.thospage.e9b5d944cc4b"); },
};

/** 还没匹配上的预置关键词（仅用于日志说明"为什么常用里少一项"） */
function SEED_KEYWORDS_LEFT(done: string[]): string[] {
  return SEED_KEYWORDS.filter((k) => !done.includes(k));
}

export function ThosPage() {
  const uiLocale = useUiLocale();

  const { user, navParams } = useApp();
  const userId = user?.username ?? "";
  const demo = userId === "8888";
  const initialTab = (navParams as { thosTab?: Tab } | null)?.thosTab;

  const [tab, setTab] = useState<Tab>(initialTab ?? "services");
  const [query, setQuery] = useState("");
  const [counts, setCounts] = useState<ThosCounts>();
  const [tasks, setTasks] = useState<Partial<Record<ThosTaskKind, ThosPage<ThosTask>>>>({});
  const [services, setServices] = useState<ThosPage<ThosService>>();
  const [favorites, setFavorites] = useState<string[]>([]);
  /** 最近打开过的服务（排序依据：收藏优先，其次最近使用，其余保持学校原序） */
  const [recent, setRecent] = useState<string[]>([]);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [updated, setUpdated] = useState<number>();
  const generation = useRef(0);

  useEffect(() => {
    setRecent(loadRecent(userId));
  }, [userId]);

  useEffect(() => {
    const list = loadFavorites(userId);
    setFavorites(list);
    // 有常用服务时默认进「常用服务」而不是「全部服务」（用户定案 2026-09-20）
    setOnlyFavorites(list.length > 0);
  }, [userId]);

  const load = useCallback(async () => {
    if (!userId) return;
    const token = ++generation.current;
    const alive = () => token === generation.current;
    setBusy(true);
    setError(undefined);
    setTasks({});
    setServices(undefined);
    setCounts(undefined);
    setUpdated(undefined);
    try {
      const { initInfoLib } = await import("../../lib/infoLib.js");
      const helper = initInfoLib();
      const result = await helper.prepareThosSession();
      if (!alive()) return;
      setCounts(result);
      const warnings: string[] = [];
      for (const kind of TASK_KINDS) {
        if (!alive()) return;
        try {
          const page = await helper.getThosTasks(kind);
          if (!alive()) return;
          setTasks((prev) => ({ ...prev, [kind]: page }));
        } catch {
          warnings.push(i18n("pages.info.thospage.495cf63fdc4b", { value: String(KIND_LABEL[kind]) }));
        }
      }
      if (!alive()) return;
      try {
        const page = await helper.getThosServices();
        if (alive()) setServices(page);
      } catch {
        warnings.push(i18n("pages.info.thospage.0e41d094eba1"));
      }
      if (alive()) {
        setUpdated(Date.now());
        setError(warnings.length ? warnings.join("\n") : undefined);
      }
    } catch {
      if (alive()) setError(i18n("pages.info.thospage.06f80187d7bf"));
    } finally {
      if (alive()) setBusy(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 服务目录就绪 → 写入原子缓存：收藏面板可检索、OH 可一句话命中并打开 */
  useEffect(() => {
    const items = services?.items ?? [];
    if (items.length === 0) return;
    noteAtomCache({
      thosServices: items.map((x) => ({ id: x.id, name: x.name, department: x.department, url: x.url })),
    });
  }, [services]);

  /** 记录一次服务打开（用于"最近使用"排序；与收藏互不影响） */
  const recall = (id: string): void => {
    if (!id) return;
    const next = [id, ...recent.filter((x) => x !== id)].slice(0, 20);
    setRecent(next);
    try {
      localStorage.setItem(recentKey(userId), JSON.stringify(next));
    } catch {
      /* 存不下不影响会话 */
    }
  };

  /** 首启预置：把「亲友（来访/入校报备）」与「缓考」铆进常用服务。
   *  逐关键词记账 + 口语容错匹配（学校侧正式名与用户口语常有出入，见 lib/thosSeed.ts）；
   *  漏掉的关键词不记账，下次进页面继续补；匹配规则升级会重补一次（修本次事故）。 */
  useEffect(() => {
    const items = services?.items ?? [];
    if (!userId || items.length === 0) return;
    const state = loadSeedState(localStorage.getItem(seedKey(userId)));
    const { ids, done } = pickSeedServices(items, favorites, state.done);
    const changed = done.length !== state.done.length;
    if (ids.length === 0) {
      if (changed) {
        try {
          localStorage.setItem(seedKey(userId), JSON.stringify({ v: state.v, done }));
        } catch {
          /* 存不下不影响本次会话 */
        }
      }
      return;
    }
    const next = [...favorites, ...ids];
    setFavorites(next);
    setOnlyFavorites(true);
    // 留痕（不打印服务 id 之外的东西）：预置是"静默功能"，出问题只能靠日志定位
    void import("../../lib/clients.js")
      .then((m) => {
        const names = items.filter((x) => ids.includes(x.id)).map((x) => x.name);
        const pending = SEED_KEYWORDS_LEFT(done);
        return m.logLine(
          i18n("pages.info.thospage.bb2cae6b0875", { value: String(names.join(" / ") || i18n("pages.info.thospage.484d55613910")), value2: String(pending.length ? i18n("pages.info.thospage.b5f8825f95c9", { value: String(pending.join("、")) }) : "") }),
        );
      })
      .catch(() => undefined);
    try {
      localStorage.setItem(favKey(userId), JSON.stringify(next));
      localStorage.setItem(seedKey(userId), JSON.stringify({ v: state.v, done }));
    } catch {
      /* 存不下也不影响本次会话 */
    }
  }, [services, favorites, userId]);

  const favorite = (id: string) => {
    const next = favorites.includes(id) ? favorites.filter((x) => x !== id) : [...favorites, id];
    setFavorites(next);
    if (onlyFavorites && next.length === 0) setOnlyFavorites(false);
    try {
      localStorage.setItem(favKey(userId), JSON.stringify(next));
    } catch {
      setError(i18n("pages.info.thospage.86febfb3e7d2"));
    }
  };

  /** 内嵌官方页：rust 在 webview 内自动完成 THOS 漫游链（id 表单页自动填表
   *  SM2 提交 → thu-oauth callback → webvpn 票落地 webview cookie），随后
   *  top-level 导航到目标页——零二次登录。
   *  R21：这里曾内联复份整条打开链、失败只 setError（横幅不显眼时等于"点了没反应"）；
   *  现委托 openThosInApp——失败 toast 明示 + 回落系统浏览器，打开链全应用只剩一份。 */
  const openOfficial = async (url: string) => {
    try {
      const { logLine } = await import("../../lib/clients.js");
      await logLine(i18n("pages.info.thospage.140a1c482046", { demo: String(demo), value: String(url.slice(0, 60)) }));
    } catch { /* noop */ }
    if (demo || !url) return;
    const { openThosInApp } = await import("../../lib/thosOpen.js");
    await openThosInApp(url);
  };

  const rows = tab === "services" ? [] : (tasks[tab]?.items ?? []);
  const pending = tab === "todo"
    ? [
        ...rows,
        ...(tasks.active?.items ?? []).filter(
          (x) => ["退回修改", "待我处理"].includes(x.status) && !rows.some((item) => item.id === x.id),
        ),
      ]
    : rows;
  const taskRows = useMemo(
    () =>
      pending.filter((x) =>
        `${x.title} ${x.node} ${x.id} ${x.status} ${x.workflowStatus ?? ""} ${x.summary ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uiLocale, pending, query, tab],
  );
  const serviceRows = useMemo(() => {
    const rows = (services?.items ?? []).filter(
      (x) =>
        (!onlyFavorites || favorites.includes(x.id)) &&
        `${x.name} ${x.department}`.toLowerCase().includes(query.toLowerCase()),
    );
    // 可解释排序：已收藏 → 最近打开过 → 其余保持学校原序（稳定排序，不改动同档内相对次序）
    const rank = new Map(recent.map((id, i) => [id, i] as const));
    return [...rows].sort((a, b) => {
      const fa = favorites.includes(a.id) ? 0 : 1;
      const fb = favorites.includes(b.id) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
  }, [uiLocale, services, onlyFavorites, favorites, query, recent]);
  const page = tab === "services" ? services : tasks[tab];
  const complete = page?.complete && (tab !== "todo" || tasks.active?.complete);

  const tabBtn = (id: string, label: React.ReactNode, selected: boolean, onClick: () => void) => (
    <button key={id} role="tab" aria-selected={selected} className={selected ? "is-active" : ""} onClick={onClick}>
      {label}
    </button>
  );

  return (
    <>
      <PageHead
        title={i18n("pages.info.thospage.1760b98532ec")}
        meta={updated ? i18n("pages.info.thospage.e22e82c70130", { value: String(new Date(updated).toLocaleTimeString(getUiLocale())) }) : undefined}
        actions={
          <Btn variant="ghost" onClick={() => void load()} disabled={busy}>{i18n("pages.info.thospage.aee887434131")}</Btn>
        }
      />
      {demo ? (
        <Card>
          <Empty text={i18n("pages.info.thospage.62f90e43bd66")} />
        </Card>
      ) : null}
      <div className="thos-note">
        <div className="thos-note-row">
          <span className="thos-note-tag">{i18n("pages.info.thospage.f64725f34d2f")}</span>
          <span>{i18n("pages.info.thospage.29d3ecc76e82")}</span>
        </div>
        <div className="thos-note-row">
          <span className="thos-note-tag">{i18n("pages.info.thospage.28ff471d9a22")}</span>
          <span>{i18n("pages.info.thospage.878ec8189307")}</span>
        </div>
      </div>
      <input
        className="thos-search"
        aria-label={i18n("pages.info.thospage.331de2fc99b4")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={
          tab === "services"
            ? onlyFavorites
              ? i18n("pages.info.thospage.12c57c59c0e5")
              : i18n("pages.info.thospage.6cec66ddc5bd")
            : i18n("pages.info.thospage.46f58ccc646a")
        }
      />

      <div className="thos-tabs" role="tablist" aria-label={i18n("pages.info.thospage.11176caff12e")}>
        {PRIMARY.map((kind) => tabBtn(kind, `${KIND_LABEL[kind]} ${counts?.[kind as keyof ThosCounts] ?? "—"}`, tab === kind, () => { setTab(kind); setQuery(""); setOnlyFavorites(false); }))}
        {(["drafts", "unread", "phases"] as ThosTaskKind[]).map((kind) =>
          tabBtn(kind, `${KIND_LABEL[kind]} ${(counts as Record<string, number | undefined> | undefined)?.[kind] ?? "—"}`, tab === kind, () => { setTab(kind); setQuery(""); setOnlyFavorites(false); }),
        )}
        {tabBtn("services-fav", i18n("pages.info.thospage.8490af08b937", { length: String(favorites.length) }), tab === "services" && onlyFavorites, () => { setTab("services"); setOnlyFavorites(favorites.length > 0); setQuery(""); })}
        {tabBtn("services-all", i18n("pages.info.thospage.fb5173fe90c7"), tab === "services" && !onlyFavorites, () => { setTab("services"); setOnlyFavorites(false); setQuery(""); })}
      </div>


      {error ? <ErrorNote text={error} onRetry={() => void load()} /> : null}
      {busy && !page ? <SkeletonRows rows={4} /> : null}
      {!(tab === "services" && onlyFavorites) && !complete && page ? (
        <div className="thos-partial">{i18n("pages.info.thospage.d18813b79070")}</div>
      ) : null}
      {busy && page ? <div className="thos-partial">{i18n("pages.info.thospage.7f3c8312816f")}</div> : null}

      {tab === "services" ? (
        <SectionHead title={onlyFavorites ? i18n("pages.info.thospage.33fa02daa93e") : i18n("pages.info.thospage.df883956af9f")} aside={i18n("pages.info.thospage.42e970981c31", { length: String(serviceRows.length) })} />
      ) : (
        <SectionHead title={KIND_LABEL[tab]} aside={i18n("pages.info.thospage.42e970981c31", { length: String(taskRows.length) })} />
      )}

      {tab === "services" ? (
        <div className="thos-grid">
          {serviceRows.map((item) => (
            <Card key={item.id} className="thos-service-card">
              <div className="row" style={{ animation: "none" }}>
                <button
                  className="row-main thos-service-open"
                  aria-label={i18n("pages.info.thospage.4d3041bdd062", { name: String(item.name) })}
                  onClick={() => {
                    recall(item.id);
                    void openOfficial(item.url);
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <strong>{item.name}</strong>
                  </span>
                  <span className="dim">{item.department || i18n("pages.info.thospage.12ccb7addd30")}</span>
                  {item.kind ? (
                    <span className="chip chip-amber">
                      {item.kind === "form" ? i18n("pages.info.thospage.62abf78cc507") : item.kind === "guide" ? i18n("pages.info.thospage.6eadeddb7e70") : item.kind === "integration" ? i18n("pages.info.thospage.4115d63bd549") : i18n("pages.info.thospage.80b6b1b5c91c")}
                    </span>
                  ) : null}
                </button>
                {/* 两个动作语义互不相同，故并列：
                    星号 = 统一收藏原子（收进任意收藏夹）；图钉 = 仅"在常用"（排序置顶） */}
                <span className="thos-service-actions">
                  <CollectStar
                    atom={{ kind: "thos-service", key: enc(item.id, item.name, item.department ?? "") }}
                    title={item.name}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={favorites.includes(item.id) ? i18n("pages.info.thospage.a58e18d60b61", { name: String(item.name) }) : i18n("pages.info.thospage.ee51d7ac2424", { name: String(item.name) })}
                    title={favorites.includes(item.id) ? i18n("pages.info.thospage.f32e91f5b0fb") : i18n("pages.info.thospage.5dc0133c1690")}
                    style={{ color: favorites.includes(item.id) ? "var(--accent, #4176e6)" : "var(--text-3, #999)", flex: "none" }}
                    onClick={() => favorite(item.id)}
                  >
                    <IconPin width={14} height={14} />
                  </button>
                </span>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="thos-list">
          {taskRows.map((item) => (
            <Card key={`${item.kind}:${item.key}`} className="thos-task-card">
              <button
                className="row thos-task-open"
                style={{ animation: "none", width: "100%", textAlign: "left" }}
                onClick={() => openOfficial(item.url)}
                disabled={!item.url || demo}
              >
                <div className="row-main">
                  <strong>{item.title}</strong>
                  <span className="chip chip-amber">{statusLabel(item.status)}</span>
                  {item.workflowStatus ? <span className="chip">{statusLabel(item.workflowStatus)}</span> : null}
                  {item.node ? <span className="dim">{i18nRich("pages.info.thospage.a9b2c95f8b82", { node: item.node })}</span> : null}
                  {item.summary ? <span className="dim">{i18nRich("pages.info.thospage.b6eb3442ad57", { summary: item.summary })}</span> : null}
                  {item.progress !== undefined ? (
                    <span className="thos-progress" aria-label={i18n("pages.info.thospage.fea285d83b06", { progress: String(item.progress) })}>
                      <span className="thos-progress-bar">
                        <span style={{ width: `${Math.min(100, Math.max(0, item.progress))}%` }} />
                      </span>
                      <span className="dim">{item.progress}%</span>
                    </span>
                  ) : null}
                  {item.date ? <span className="dim">{DATE_LABEL[item.kind]}：{item.date}</span> : null}
                </div>
              </button>
            </Card>
          ))}
        </div>
      )}

      {page && (tab === "services" ? serviceRows : taskRows).length === 0 && !busy ? (
        <Card>
          <Empty
            text={
              tab === "services" && onlyFavorites && !query && complete
                ? i18n("pages.info.thospage.2dd0064fe9e5")
                : query
                  ? i18n("pages.info.thospage.8151e8704a7c")
                  : complete
                    ? i18n("pages.info.thospage.994178605d6f")
                    : i18n("pages.info.thospage.497c85690c4c")
            }
          />
        </Card>
      ) : null}

    </>
  );
}
