/**
 * 清小搭（xiaoda.tsinghua.edu.cn 校园 AI 学伴）实验性一级功能页 —— 纯 OneGUI 复刻试验田。
 *
 * 复刻范围（简陋版，2026-10-15 实测打通，详见 scripts/xiaoda-probe.mts）：
 * - 聊天：POST /v1/chat/completions（OpenAI 兼容 SSE 流式）。该端点只认 UAP 路由
 *   已注册的智能体（model 须 "agent:<id>"）；默认助手 9999 与内置组成员不在其中时
 *   服务端错误原文透传——实验页的诚实行为，不粉饰。
 * - 对话：GET /api/conversation/create 取 convId → POST /api/chats/ 原生（soda）SSE 流
 *   （/v1/chat/completions 是广场/UAP 接入路由，正常聊天用不到，见 core/xiaoda/client.ts）
 * - 历史：GET /api/conversation/page（convId / query / createTime）。
 * - 智能体：GET /api/group/builtin/list（官方智能体分组与成员；选中即设为对话对象）。
 * - 技能：GET /api/skill/plaza/{overview,categories,list}。
 * 独立自治：自带 ITS 登录链与 token 生命周期（lib/xiaoda.ts），不与其他 OneTHU 功能联动。
 * 样式零旁路：全部 @onethu/gui 组件——无页面 CSS、无内联样式、无裸控件（OneGUI 契约）。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Avatar, Banner, Btn, Card, Chip, DataList, EmptyState, Inline, List, LoadingBlock, Page,
  Row, SectionCard, Select, Stack, StatTile, Tabs, Tag, TextArea,
} from "@onethu/gui";
import type {
  XiaodaAgentGroup, XiaodaConversation, XiaodaModel, XiaodaSkillCategory, XiaodaSkillItem,
  XiaodaSkillOverview, XiaodaUser,
} from "@onethu/core";
import { xiaodaClient, xiaodaEnsureLogin } from "../../lib/xiaoda.js";

type Tab = "chat" | "history" | "agents" | "skills";
type ChatMsg = { role: "user" | "assistant"; content: string };

/** SPA 同款默认智能体（chat/:convId/:agentId? 路由缺省值） */
const DEFAULT_AGENT_ID = "9999";

function fmtTime(v: string | number | undefined): string {
  if (v === undefined || v === null || v === "") return "";
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isFinite(n) && n > 1e12) return new Date(n).toLocaleString("zh-CN", { hour12: false });
  if (Number.isFinite(n) && n > 1e9) return new Date(n * 1000).toLocaleString("zh-CN", { hour12: false });
  return String(v);
}

export function XiaodaPage(): ReactNode {
  const [phase, setPhase] = useState<"boot" | "logging" | "ready" | "error">("boot");
  const [bootErr, setBootErr] = useState("");
  const [me, setMe] = useState<XiaodaUser | null>(null);
  const [tab, setTab] = useState<Tab>("chat");
  const [agentId, setAgentId] = useState(DEFAULT_AGENT_ID);

  const boot = useCallback(() => {
    setPhase("logging");
    setBootErr("");
    xiaodaEnsureLogin()
      .then((u) => {
        setMe(u);
        setPhase("ready");
      })
      .catch((e: unknown) => {
        setBootErr(e instanceof Error ? e.message : String(e));
        setPhase("error");
      });
  }, []);
  useEffect(boot, [boot]);

  return (
    <Page
      title="清小搭"
      sub={me ? `${me.name} · ${me.zjh}` : "校园 AI 学伴（实验性复刻）"}
      meta={<Tag tone="warning">实验</Tag>}
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
            { id: "chat", label: "聊天" },
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
          <ChatTab me={me} agentId={agentId} onAgentId={setAgentId} />
        ) : tab === "history" ? (
          <HistoryTab />
        ) : tab === "agents" ? (
          <AgentsTab
            onPick={(id) => {
              setAgentId(id);
              setTab("chat");
            }}
          />
        ) : (
          <SkillsTab />
        )
      ) : null}
    </Page>
  );
}

/* ══════════ 聊天 ══════════ */

function ChatTab({ me, agentId, onAgentId }: { me: XiaodaUser | null; agentId: string; onAgentId: (id: string) => void }): ReactNode {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [groups, setGroups] = useState<XiaodaAgentGroup[] | null>(null);
  const [models, setModels] = useState<XiaodaModel[]>([]);
  const [modelId, setModelId] = useState("");
  const [sending, setSending] = useState(false);
  const [chatErr, setChatErr] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  /** soda 会话号：首次发送时向后端申请，后续消息复用（服务端按 convId 记住上下文） */
  const convIdRef = useRef("");
  /** 本地停止标记：应用内 nativeFetch 忽略 signal，UI 侧用它兜住后续增量 */
  const stopRef = useRef(false);

  useEffect(() => {
    xiaodaClient
      .builtinGroups()
      .then(setGroups)
      .catch(() => undefined);
    xiaodaClient
      .customModels()
      .then((ms) => {
        setModels(ms);
        const def = ms.find((m) => m.isDefault);
        if (def) setModelId(String(def.id));
      })
      .catch(() => undefined);
  }, []);

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || sending) return;
    setMsgs((prev) => [...prev, { role: "user", content: q }, { role: "assistant", content: "" }]);
    setInput("");
    setSending(true);
    setChatErr("");
    stopRef.current = false;
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      // ① 首次发送先建会话（GET /api/conversation/create → convId）
      if (!convIdRef.current) {
        convIdRef.current = await xiaodaClient.createConversation();
        if (!convIdRef.current) throw new Error("新建对话失败，请点发送重试");
      }
      // ② 原生 soda 流：POST /api/chats/（逐 token 增量）
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
          if (m.convId) convIdRef.current = m.convId;
        },
      });
    } catch (e) {
      setChatErr(e instanceof Error ? e.message : String(e));
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
  }, [input, sending, agentId, modelId]);

  const stop = useCallback(() => {
    stopRef.current = true;
    abortRef.current?.abort();
    if (convIdRef.current) void xiaodaClient.stopChat(convIdRef.current);
  }, []);

  const newConv = useCallback(() => {
    stopRef.current = true;
    convIdRef.current = "";
    setMsgs([]);
    setChatErr("");
  }, []);

  const agentOptions = [
    { value: DEFAULT_AGENT_ID, label: `默认助手（${DEFAULT_AGENT_ID}）` },
    ...(groups ?? []).flatMap((g) =>
      (g.members ?? []).map((m) => ({ value: m.uniqueId, label: `${g.name} · ${m.name}` })),
    ),
  ];
  const modelName = models.find((m) => String(m.id) === modelId)?.name ?? "";

  return (
    <Stack gap={6}>
      <SectionCard title="对话" sub={modelName ? `平台模型：${modelName}` : undefined}>
        {msgs.length === 0 ? (
          <EmptyState
            title="开始对话"
            hint="选好智能体直接发消息；若提示不可用，请到「智能体」页换一个再试"
          />
        ) : (
          <List divided>
            {msgs.map((m, i) => (
              <Row
                key={i}
                leading={<Avatar name={m.role === "user" ? (me?.name ?? "我") : "清小搭"} />}
                title={m.role === "user" ? (me?.name ?? "我") : `智能体 ${agentId}`}
                sub={m.content || (sending && i === msgs.length - 1 ? "正在输入…" : "")}
              />
            ))}
          </List>
        )}
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
            <Btn variant="outline" onClick={newConv} disabled={sending}>
              新对话
            </Btn>
          </Inline>
        </Stack>
      </Card>
    </Stack>
  );
}

/* ══════════ 历史 ══════════ */

function HistoryTab(): ReactNode {
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
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void load(1);
  }, [load]);

  return (
    <SectionCard title="对话历史" sub={total ? `共 ${total} 条` : undefined}>
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
            render={(c) => (
              <Row
                flush
                title={(c.query.split("\n")[0] ?? "").slice(0, 48) || "（空对话）"}
                sub={fmtTime(c.createTime)}
                meta={c.isDeepResearch ? "深度研究" : undefined}
              />
            )}
          />
          {items.length < total ? (
            <Inline gap={2}>
              <Btn variant="outline" disabled={loadingMore} onClick={() => void load(pageNum + 1)}>
                {loadingMore ? "加载中…" : "加载更多"}
              </Btn>
              <Tag>{`${items.length} / ${total}`}</Tag>
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
        setErr(e instanceof Error ? e.message : String(e));
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
                    对话
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
      setErr(e instanceof Error ? e.message : String(e));
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
                <Tag>{`${items.length} / ${total}`}</Tag>
              </Inline>
            ) : null}
          </Stack>
        ) : null}
      </SectionCard>
    </Stack>
  );
}
