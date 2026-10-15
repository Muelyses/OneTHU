/**
 * 清小搭（xiaoda.tsinghua.edu.cn 校园 AI 学伴）一级功能页 —— 正式版（2026-10-15）。
 *
 * 协议（全部实测定稿，详见 core/xiaoda/client.ts 与 scripts/xiaoda-roam-check.mts）：
 *  - 对话：GET /api/conversation/create 取对话号 → POST /api/chats/ 原生 SSE 流（逐 token 上屏）；
 *  - 续聊：GET /api/chats/list?convId=… 读回历史消息，沿用同一对话号即可继续；
 *  - 历史：GET /api/conversation/page；智能体：GET /api/group/builtin/list；技能：GET /api/skill/plaza/*。
 * 自带 ITS 登录链与登录状态生命周期（lib/xiaoda.ts），不与其他 OneTHU 功能联动。
 * 样式零旁路：全部 @onethu/gui 组件 —— 无页面 CSS、无内联样式、无裸控件（OneGUI 契约）。
 * 用户侧永不出现智能体编号（9999 / 18xxx 只是内部标识，界面一律用名字）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Avatar, Banner, Btn, Card, Chip, DataList, EmptyState, Inline, List, LoadingBlock, Page,
  Row, SectionCard, Select, Spinner, Stack, StatTile, Surface, Tabs, Text, TextArea,
} from "@onethu/gui";
import type {
  XiaodaAgentGroup, XiaodaChatMessage, XiaodaConversation, XiaodaModel, XiaodaSkillCategory,
  XiaodaSkillItem, XiaodaSkillOverview, XiaodaUser,
} from "@onethu/core";
import { xiaodaClient, xiaodaEnsureLogin } from "../../lib/xiaoda.js";

type Tab = "chat" | "history" | "agents" | "skills";
/** 当前打开的对话（历史点开，或首次发送时新建） */
type ActiveChat = { convId: string; agentId: string };
/** 智能体名录条目（用户侧只认 name） */
type AgentInfo = { id: string; name: string; group?: string; icon?: string };

/** 平台默认助手 = 清小搭本体（路由缺省值，界面不展示编号） */
const DEFAULT_AGENT_ID = "9999";
const DEFAULT_AGENT_NAME = "清小搭";
/** 页面脚注：诚实标注这是 OneTHU 的接入界面，不是学校原版页面 */
const PAGE_NOTE = "清小搭由学校提供，回答仅供参考；本页是 OneTHU 的接入界面。";

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function fmtTime(v: string | number | undefined): string {
  if (v === undefined || v === null || v === "") return "";
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isFinite(n) && n > 1e12) return new Date(n).toLocaleString("zh-CN", { hour12: false });
  if (Number.isFinite(n) && n > 1e9) return new Date(n * 1000).toLocaleString("zh-CN", { hour12: false });
  return String(v);
}

/** 智能体名录：id → 名字/图标（分组名只用于下拉里的区分） */
function useAgentDirectory(): { agents: AgentInfo[]; infoOf: (id: string) => AgentInfo } {
  const [groups, setGroups] = useState<XiaodaAgentGroup[] | null>(null);
  useEffect(() => {
    xiaodaClient
      .builtinGroups()
      .then(setGroups)
      .catch(() => setGroups([]));
  }, []);
  const agents = useMemo<AgentInfo[]>(() => {
    const all: AgentInfo[] = [{ id: DEFAULT_AGENT_ID, name: DEFAULT_AGENT_NAME }];
    for (const g of groups ?? []) {
      for (const m of g.members ?? []) all.push({ id: m.uniqueId, name: m.name, group: g.name, icon: m.icon });
    }
    return all;
  }, [groups]);
  const infoOf = useCallback(
    (id: string): AgentInfo =>
      agents.find((a) => a.id === id) ?? { id, name: id === DEFAULT_AGENT_ID ? DEFAULT_AGENT_NAME : "智能体" },
    [agents],
  );
  return { agents, infoOf };
}

export function XiaodaPage(): ReactNode {
  const [phase, setPhase] = useState<"boot" | "logging" | "ready" | "error">("boot");
  const [bootErr, setBootErr] = useState("");
  const [me, setMe] = useState<XiaodaUser | null>(null);
  const [tab, setTab] = useState<Tab>("chat");
  const [agentId, setAgentId] = useState(DEFAULT_AGENT_ID);
  const [active, setActive] = useState<ActiveChat | null>(null);
  const { agents, infoOf } = useAgentDirectory();

  const boot = useCallback(() => {
    setPhase("logging");
    setBootErr("");
    xiaodaEnsureLogin()
      .then((u) => {
        setMe(u);
        setPhase("ready");
      })
      .catch((e: unknown) => {
        setBootErr(errText(e));
        setPhase("error");
      });
  }, []);
  useEffect(boot, [boot]);

  /** 开一段新对话（换智能体也从这里走：新对话才换对象） */
  const startNew = useCallback((nextAgent?: string) => {
    setActive(null);
    if (nextAgent) setAgentId(nextAgent);
    setTab("chat");
  }, []);

  /** 接着历史继续聊：载入该对话的消息，沿用同一对话号 */
  const openHistory = useCallback((c: XiaodaConversation) => {
    const aid = c.agentId || DEFAULT_AGENT_ID;
    setAgentId(aid);
    setActive({ convId: c.convId, agentId: aid });
    setTab("chat");
  }, []);

  const who = me ? (me.zjh ? `${me.name} · ${me.zjh}` : me.name) : "校园 AI 学伴";

  return (
    <Page
      title="清小搭"
      sub={who}
      actions={
        <Btn size="sm" variant="outline" onClick={boot}>
          重新登录
        </Btn>
      }
      tabs={
        <Tabs
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          items={[
            { id: "chat", label: "对话" },
            { id: "history", label: "历史" },
            { id: "agents", label: "智能体" },
            { id: "skills", label: "技能" },
          ]}
        />
      }
    >
      {phase === "boot" || phase === "logging" ? <LoadingBlock rows={4} /> : null}
      {phase === "error" ? (
        <EmptyState
          title="登录失败，请点下方重试"
          hint={bootErr}
          action={
            <Btn variant="outline" onClick={boot}>
              重试
            </Btn>
          }
        />
      ) : null}
      {phase === "ready" ? (
        tab === "chat" ? (
          <ChatTab
            me={me}
            agentId={agentId}
            agents={agents}
            infoOf={infoOf}
            active={active}
            onAgentId={setAgentId}
            onActive={setActive}
            onNew={startNew}
          />
        ) : tab === "history" ? (
          <HistoryTab infoOf={infoOf} onOpen={openHistory} />
        ) : tab === "agents" ? (
          <AgentsTab onPick={(id) => startNew(id)} />
        ) : (
          <SkillsTab />
        )
      ) : null}
    </Page>
  );
}

/* ══════════ 对话 ══════════ */

function ChatTab({
  me, agentId, agents, infoOf, active, onAgentId, onActive, onNew,
}: {
  me: XiaodaUser | null;
  agentId: string;
  agents: AgentInfo[];
  infoOf: (id: string) => AgentInfo;
  active: ActiveChat | null;
  onAgentId: (id: string) => void;
  onActive: (a: ActiveChat) => void;
  onNew: () => void;
}): ReactNode {
  const [msgs, setMsgs] = useState<XiaodaChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [input, setInput] = useState("");
  const [models, setModels] = useState<XiaodaModel[]>([]);
  const [modelId, setModelId] = useState("");
  const [sending, setSending] = useState(false);
  const [chatErr, setChatErr] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const convIdRef = useRef("");
  /** 本地停止标记：应用内 nativeFetch 忽略 signal，UI 侧用它兜住后续增量 */
  const stopRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const who = infoOf(agentId);

  useEffect(() => {
    xiaodaClient
      .customModels()
      .then((ms) => {
        setModels(ms);
        const def = ms.find((m) => m.isDefault);
        if (def) setModelId(String(def.id));
      })
      .catch(() => undefined);
  }, []);

  /* 打开一段对话（含从历史进来）：读回消息，接着聊 */
  useEffect(() => {
    const cid = active?.convId ?? "";
    convIdRef.current = cid;
    stopRef.current = false;
    setChatErr("");
    if (!cid) {
      setMsgs([]);
      return;
    }
    setLoadingMsgs(true);
    xiaodaClient
      .conversationMessages(cid)
      .then(setMsgs)
      .catch((e: unknown) => setChatErr(errText(e)))
      .finally(() => setLoadingMsgs(false));
  }, [active?.convId]);

  /* 新消息/新内容 → 落到最新处 */
  const tail = msgs.length > 0 ? msgs[msgs.length - 1] : null;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [msgs.length, tail?.content, sending]);

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || sending) return;
    const blank: XiaodaChatMessage = {
      id: "", role: "assistant", content: "", thinkContent: "",
      agentId, agentName: who.name, agentIcon: who.icon ?? "",
    };
    setMsgs((prev) => [
      ...prev,
      { ...blank, role: "user", agentName: me?.name ?? "我", agentIcon: "" },
      blank,
    ]);
    setInput("");
    setSending(true);
    setChatErr("");
    stopRef.current = false;
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      if (!convIdRef.current) {
        const cid = await xiaodaClient.createConversation();
        if (!cid) throw new Error("新建对话失败，请点发送重试");
        convIdRef.current = cid;
        onActive({ convId: cid, agentId });
      }
      await xiaodaClient.chatNative({
        agentId,
        query: q,
        convId: convIdRef.current,
        customModelId: modelId ? Number(modelId) : undefined,
        signal: ac.signal,
        onDelta: (d) => {
          if (stopRef.current) return;
          setMsgs((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant") next[next.length - 1] = { ...last, content: last.content + d };
            return next;
          });
        },
        onMeta: (m) => {
          if (m.convId && m.convId !== convIdRef.current) {
            convIdRef.current = m.convId;
            onActive({ convId: m.convId, agentId });
          }
        },
      });
    } catch (e) {
      setChatErr(errText(e));
      setMsgs((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant" && !last.content) next.pop();
        return next;
      });
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }, [input, sending, agentId, modelId, me?.name, onActive, who.icon, who.name]);

  const stop = useCallback(() => {
    stopRef.current = true;
    abortRef.current?.abort();
    if (convIdRef.current) void xiaodaClient.stopChat(convIdRef.current);
  }, []);

  const agentOptions = agents.map((a) => ({ value: a.id, label: a.group ? `${a.group} · ${a.name}` : a.name }));
  const modelName = models.find((m) => String(m.id) === modelId)?.name ?? "";

  return (
    <Stack gap={5}>
      <SectionCard
        title={active ? "继续对话" : "新对话"}
        sub={active ? `已接上此前的内容 · ${who.name}` : `${who.name}${modelName ? ` · ${modelName}` : ""}`}
        aside={
          <Inline gap={2}>
            {active ? (
              <Btn size="sm" variant="outline" onClick={onNew}>
                新对话
              </Btn>
            ) : null}
          </Inline>
        }
      >
        <Stack gap={5}>
          {loadingMsgs ? <LoadingBlock rows={3} /> : null}
          {!loadingMsgs && msgs.length === 0 ? (
            <EmptyState title="说点什么吧" hint="直接输入问题即可；换智能体请到「智能体」页挑一个" />
          ) : null}
          {msgs.map((m, i) => {
            const isUser = m.role === "user";
            const name = isUser ? (me?.name ?? "我") : (m.agentName || who.name);
            const waiting = !isUser && !m.content && sending && i === msgs.length - 1;
            return (
              <Inline key={m.id || `m${i}`} gap={3} vAlign="start" justify={isUser ? "end" : "start"}>
                {!isUser ? <Avatar name={name} src={m.agentIcon || who.icon} size="sm" /> : null}
                <Surface level={isUser ? 2 : 1} pad="md" radius="2xl">
                  <Stack gap={2}>
                    <Text slot="micro" tone="faint">
                      {name}
                    </Text>
                    {m.content ? <Text as="p">{m.content}</Text> : null}
                    {waiting ? (
                      <Inline gap={2}>
                        <Spinner size="sm" />
                        <Text slot="label" tone="faint">
                          正在输入…
                        </Text>
                      </Inline>
                    ) : null}
                  </Stack>
                </Surface>
                {isUser ? <Avatar name={name} size="sm" /> : null}
              </Inline>
            );
          })}
          <div ref={bottomRef} />
        </Stack>
      </SectionCard>

      {chatErr ? (
        <Banner tone="error" title="对话失败，可重发消息或换智能体重试">
          {chatErr}
        </Banner>
      ) : null}

      <Card title="发送">
        <Stack gap={3}>
          <Inline gap={2} wrap>
            <Select value={agentId} onChange={onAgentId} options={agentOptions} aria-label="对话智能体" />
            {models.length > 0 ? (
              <Select
                value={modelId}
                onChange={setModelId}
                options={models.map((m) => ({ value: String(m.id), label: m.name }))}
                aria-label="平台模型"
              />
            ) : null}
          </Inline>
          <TextArea rows={2} value={input} onChange={setInput} placeholder="问点什么…" />
          <Inline gap={2}>
            <Btn variant="solid" onClick={() => void send()} disabled={sending || !input.trim()}>
              发送
            </Btn>
            {sending ? (
              <Btn variant="outline" onClick={stop}>
                停止
              </Btn>
            ) : null}
          </Inline>
          <Text slot="micro" tone="faint">
            {PAGE_NOTE}
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
}

/* ══════════ 历史 ══════════ */

function HistoryTab({
  infoOf, onOpen,
}: {
  infoOf: (id: string) => AgentInfo;
  onOpen: (c: XiaodaConversation) => void;
}): ReactNode {
  const [items, setItems] = useState<XiaodaConversation[] | null>(null);
  const [err, setErr] = useState("");
  const [pageNum, setPageNum] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (page: number) => {
    setLoadingMore(true);
    try {
      const r = await xiaodaClient.conversationPage(page, 10);
      const list = r.dataList ?? [];
      setTotal(r.page?.totalCount ?? list.length);
      setItems((prev) => (page === 1 ? list : [...(prev ?? []), ...list]));
      setPageNum(page);
      setErr("");
    } catch (e) {
      setErr(errText(e));
    } finally {
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void load(1);
  }, [load]);

  return (
    <SectionCard title="对话历史" sub={total ? `共 ${total} 段，点「接着聊」可继续` : undefined}>
      {err ? (
        <Stack gap={3}>
          <Banner tone="error" title="历史加载失败，请点重试">
            {err}
          </Banner>
          <Inline gap={2}>
            <Btn variant="outline" onClick={() => void load(1)}>
              重试
            </Btn>
          </Inline>
        </Stack>
      ) : null}
      {items === null && !err ? <LoadingBlock rows={5} /> : null}
      {items !== null && items.length === 0 && !err ? <EmptyState title="还没有对话记录" /> : null}
      {items !== null && items.length > 0 ? (
        <Stack gap={3}>
          <DataList
            items={items}
            keyOf={(c) => c.convId}
            render={(c) => {
              const info = infoOf(c.agentId ?? DEFAULT_AGENT_ID);
              return (
                <Row
                  flush
                  leading={<Avatar name={info.name} src={info.icon} size="sm" />}
                  title={(c.query.split("\n")[0] ?? "").slice(0, 40) || "（空对话）"}
                  sub={[info.name, fmtTime(c.createTime)].filter(Boolean).join(" · ")}
                  meta={c.isDeepResearch ? "深度研究" : undefined}
                  trailing={
                    <Btn size="sm" variant="outline" onClick={() => onOpen(c)}>
                      接着聊
                    </Btn>
                  }
                />
              );
            }}
          />
          {items.length < total ? (
            <Inline gap={2}>
              <Btn variant="outline" disabled={loadingMore} onClick={() => void load(pageNum + 1)}>
                {loadingMore ? "加载中…" : "加载更多"}
              </Btn>
              <Text slot="label" tone="faint">{`${items.length} / ${total}`}</Text>
            </Inline>
          ) : null}
        </Stack>
      ) : null}
    </SectionCard>
  );
}

/* ══════════ 智能体 ══════════ */

function AgentsTab({ onPick }: { onPick: (id: string) => void }): ReactNode {
  const [groups, setGroups] = useState<XiaodaAgentGroup[] | null>(null);
  const [err, setErr] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setErr("");
    xiaodaClient
      .builtinGroups()
      .then(setGroups)
      .catch((e: unknown) => {
        setGroups(null);
        setErr(errText(e));
      });
  }, [reload]);

  return (
    <Stack gap={6}>
      {err ? (
        <Stack gap={3}>
          <Banner tone="error" title="智能体加载失败，请点重试">
            {err}
          </Banner>
          <Inline gap={2}>
            <Btn variant="outline" onClick={() => setReload((n) => n + 1)}>
              重试
            </Btn>
          </Inline>
        </Stack>
      ) : null}
      {groups === null && !err ? <LoadingBlock rows={5} /> : null}
      {groups !== null && groups.length === 0 && !err ? <EmptyState title="暂无智能体分组" /> : null}
      {groups?.map((g) => (
        <SectionCard key={g.uniqueId} title={g.name} sub={g.description}>
          <List divided>
            {(g.members ?? []).map((m) => (
              <Row
                key={m.uniqueId}
                leading={<Avatar name={m.name} src={m.icon} />}
                title={m.name}
                sub={(m.description ?? "").slice(0, 80)}
                trailing={
                  <Btn size="sm" variant="outline" onClick={() => onPick(m.uniqueId)}>
                    找它聊
                  </Btn>
                }
              />
            ))}
          </List>
        </SectionCard>
      ))}
    </Stack>
  );
}

/* ══════════ 技能 ══════════ */

function SkillsTab(): ReactNode {
  const [overview, setOverview] = useState<XiaodaSkillOverview | null>(null);
  const [cats, setCats] = useState<XiaodaSkillCategory[]>([]);
  const [items, setItems] = useState<XiaodaSkillItem[]>([]);
  const [pageNum, setPageNum] = useState(1);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    xiaodaClient.skillOverview().then(setOverview).catch(() => undefined);
    xiaodaClient.skillCategories().then(setCats).catch(() => undefined);
  }, []);

  const load = useCallback(async (page: number) => {
    setLoadingMore(true);
    try {
      const r = await xiaodaClient.skillList(page, 10);
      const list = r.dataList ?? [];
      setTotal(r.page?.totalCount ?? list.length);
      setItems((prev) => (page === 1 ? list : [...prev, ...list]));
      setPageNum(page);
      setErr("");
    } catch (e) {
      setErr(errText(e));
    } finally {
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void load(1);
  }, [load]);

  return (
    <Stack gap={6}>
      {overview ? (
        <Inline gap={3} wrap>
          <StatTile label="技能" value={overview.skillCount} />
          <StatTile label="贡献者" value={overview.contributorCount} />
          <StatTile label="总下载" value={overview.downloadCount} />
        </Inline>
      ) : null}
      {cats.length > 0 ? (
        <Card title="分类">
          <Inline gap={2} wrap>
            {cats.map((c) => (
              <Chip key={c.code}>{`${c.name} · ${c.count}`}</Chip>
            ))}
          </Inline>
        </Card>
      ) : null}
      <SectionCard title="技能广场" sub={total ? `共 ${total} 个` : undefined}>
        {err ? (
          <Stack gap={3}>
            <Banner tone="error" title="技能加载失败，请点重试">
              {err}
            </Banner>
            <Inline gap={2}>
              <Btn variant="outline" onClick={() => void load(1)}>
                重试
              </Btn>
            </Inline>
          </Stack>
        ) : null}
        {items.length === 0 && !err ? <LoadingBlock rows={5} /> : null}
        {items.length > 0 ? (
          <Stack gap={3}>
            <DataList
              items={items}
              keyOf={(s) => s.id}
              render={(s) => (
                <Row
                  flush
                  leading={<Avatar name={s.name} src={s.icon} />}
                  title={s.name}
                  sub={(s.description ?? "").slice(0, 64)}
                  meta={`${s.downloadCount ?? 0} 次下载 · ${s.authorName ?? ""}`}
                />
              )}
            />
            {items.length < total ? (
              <Inline gap={2}>
                <Btn variant="outline" disabled={loadingMore} onClick={() => void load(pageNum + 1)}>
                  {loadingMore ? "加载中…" : "加载更多"}
                </Btn>
                <Text slot="label" tone="faint">{`${items.length} / ${total}`}</Text>
              </Inline>
            ) : null}
          </Stack>
        ) : null}
      </SectionCard>
    </Stack>
  );
}
