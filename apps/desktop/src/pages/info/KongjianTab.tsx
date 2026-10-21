import { t as i18n, msg as i18nMsg, useLocale as useUiLocale } from "../../i18n/index.js";
import { Input, Tag, Text, TextArea } from "@onethu/gui";
import { Btn } from "@onethu/gui";
import { Select } from "@onethu/gui";
/**
 * 学生宿舍公共空间预约（myhome 共享家园网 kongjian WebForms 链路）。
 *
 * 交互（对齐官网 kj_yuyue.aspx）：
 * ① 公共空间 chips（54 项）→ ② 房间 chips → ③ 日期 chips（今起 7 天）→
 * ④ 场次胶囊（时间 + 状态；可约的点击出确认卡）→ ⑤ 确认卡（姓名/学号/电话/用途）提交
 * ⑥ 我的预约 + 取消（WebForms 回传）。
 * 首次进入自动过 agreement 协议（core 内处理）。
 */
import { confirmOk } from "../../lib/confirm.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { KongjianPage, KongjianRecord, KongjianSlot } from "@onethu/core";
import { Card, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { SearchSelect } from "../../components/SearchSelect.jsx";
import { info } from "../../lib/clients.js";
import { CollectStar } from "../../components/Collect.js";
import { enc, noteAtomCache } from "../../state/atoms.js";
import { useApp } from "../../state/context.js";
import { cacheGet, cacheSet } from "../../state/cache.js";
import { TabEmpty, isServiceUnavailable, logTabErr, tabErrorText } from "./tabStates.js";

type LoadState = "loading" | "error" | "ready";

const MYHOME_KEY = "onethu.kongjian.profile";

function loadProfile(): { name: string; sid: string; tel: string } {
  try {
    return JSON.parse(localStorage.getItem(MYHOME_KEY) ?? "{}") as { name: string; sid: string; tel: string };
  } catch {
    return { name: "", sid: "", tel: "" };
  }
}

/** 场次可约：有确认链接即视为可约（状态文案服务端给啥显示啥） */
function slotBookable(slot: KongjianSlot): boolean {
  return Boolean(slot.bookUrl);
}

const KJ_SPACES_KEY = "kj:spaces";
const KJ_SPACES_TTL = 5 * 60 * 1000;
const KJ_SLOTS_TTL = 3 * 60 * 1000;

export function KongjianTab({ kongjianSpace, kongjianRoom }: { kongjianSpace?: string; kongjianRoom?: string } = {}) {
  const uiLocale = useUiLocale();

  const { status } = useApp();
  const [page, setPage] = useState<KongjianPage | null>(() => cacheGet<KongjianPage>(KJ_SPACES_KEY)?.data ?? null);
  const [state, setState] = useState<LoadState>(() => (cacheGet<KongjianPage>(KJ_SPACES_KEY) ? "ready" : "loading"));
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string>("");
  const [roomId, setRoomId] = useState<string>("");
  const [date, setDate] = useState<string>("");
  const [picked, setPicked] = useState<KongjianSlot | null>(null);
  const [profile, setProfile] = useState(loadProfile);
  const [purpose, setPurpose] = useState(i18n("pages.info.kongjiantab.9e9bead81498"));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [records, setRecords] = useState<KongjianRecord[] | null>(null);
  const [recState, setRecState] = useState<LoadState>("loading");

  const fail = useCallback((err: unknown, retry?: () => void) => {
    logTabErr("KONGJIAN", err, retry);
    setUnavailable(isServiceUnavailable(err));
    setError(tabErrorText(err));
    setState("error");
  }, []);

  const loadSpaces = useCallback(async (silent = false) => {
    if (status !== "ready") return;
    if (!silent) {
      setState("loading");
      setUnavailable(false);
      setError(null);
    }
    try {
      const p = await info.kongjianPage();
      cacheSet(KJ_SPACES_KEY, p);
      setPage(p);
      noteAtomCache({
        kjSpaces: p.spaces.map((sp) => ({ id: sp.id, name: sp.name })),
        kjRooms: p.rooms.map((rm) => ({ spaceId: p.selectedSpace ?? "", spaceName: p.spaces.find((sp) => sp.id === (p.selectedSpace ?? ""))?.name ?? "", id: rm.id, name: rm.name })),
      });
      setSpaceId(p.selectedSpace ?? "");
      setRoomId(p.selectedRoom ?? "");
      setState("ready");
      if (p.spaces.length === 0) {
        // 空列表多半是门户页兜底未命中：走 logTabErr 的硬刷新守卫（20s 内最多 2 次）
        logTabErr("KONGJIAN", new Error(i18n("pages.info.kongjiantab.9820727211b1")));
      }
    } catch (err) {
      // SWR：有陈旧数据时静默保留，绝不闪错；无数据走 fail（认证错自动重建重拉）
      if (!(silent && page !== null)) fail(err, () => void loadSpaces(true));
    }
  }, [status, fail, page]);

  const loadSlots = useCallback(
    async (sp: string, rm: string, d: string) => {
      // 场次页按 space/room/date 键缓存：重选回来看过的组合 0ms 上屏，过期先亮旧值再静默刷新
      const slotsKey = `kj:slots:${sp}:${rm}:${d}`;
      const cached = cacheGet<KongjianPage>(slotsKey);
      if (cached) {
        setPage(cached.data);
        setState("ready");
        setPicked(null);
        if (Date.now() - cached.at < KJ_SLOTS_TTL) return;
      } else {
        setState("loading");
        setUnavailable(false);
        setError(null);
        setPicked(null);
      }
      try {
        const p = await info.kongjianPage({ spaceId: sp, roomId: rm, date: d });
        cacheSet(slotsKey, p);
        setPage(p);
        setState("ready");
        noteAtomCache({
          kjSpaces: p.spaces.map((x) => ({ id: x.id, name: x.name })),
          kjRooms: p.rooms.map((rm2) => ({ spaceId: sp, spaceName: p.spaces.find((x) => x.id === sp)?.name ?? "", id: rm2.id, name: rm2.name })),
        });
      } catch (err) {
        if (cached) return; // 已亮旧值：不闪红，保留旧场次
        fail(err);
      }
    },
    [fail],
  );

  const loadRecords = useCallback(async () => {
    setRecState("loading");
    try {
      const list = await info.kongjianMy();
      setRecords(list);
      setRecState("ready");
    } catch (err) {
      logTabErr("KONGJIAN-MY", err);
      setRecords([]);
      setRecState("ready"); // 我的预约拉不到不阻塞主流程
    }
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    const cached = cacheGet<KongjianPage>(KJ_SPACES_KEY);
    if (!cached) void loadSpaces(false);
    else if (Date.now() - cached.at > KJ_SPACES_TTL) void loadSpaces(true);
    void loadRecords();
  }, [loadSpaces, loadRecords]);

  const pickSpace = (id: string) => {
    setSpaceId(id);
    setRoomId("");
    setDate("");
    void loadSlots(id, "", "");
  };
  const pickRoom = (id: string) => {
    setRoomId(id);
    void loadSlots(spaceId, id, date);
  };
  const pickDate = (d: string) => {
    setDate(d);
    void loadSlots(spaceId, roomId, d);
  };

  /* 深链：空间/房间原子打开 → 页面就绪后依次 pickSpace → pickRoom（各一次） */
  const spApplied = useRef(false);
  const rmApplied = useRef(false);
  useEffect(() => {
    if (spApplied.current || state !== "ready" || !page || !kongjianSpace) return;
    if (!page.spaces.some((sp) => sp.id === kongjianSpace)) return;
    spApplied.current = true;
    pickSpace(kongjianSpace);
  }, [state, page, kongjianSpace]);
  useEffect(() => {
    if (!spApplied.current || rmApplied.current || state !== "ready" || !page || !kongjianRoom) return;
    if (!page.rooms.some((rm) => rm.id === kongjianRoom)) return;
    rmApplied.current = true;
    pickRoom(kongjianRoom);
  }, [state, page, kongjianRoom]);

  const submit = useCallback(async () => {
    if (!picked?.bookUrl) return;
    setBusy(true);
    setNotice(null);
    try {
      const msg = await info.kongjianBook(picked.bookUrl, {
        name: profile.name,
        sid: profile.sid,
        tel: profile.tel,
        other: purpose,
      });
      localStorage.setItem(MYHOME_KEY, JSON.stringify(profile));
      setNotice(`${msg}：${picked.date} ${picked.time}（${picked.state || i18n("pages.info.kongjiantab.bc37a6110a07")}）`);
      setPicked(null);
      void loadRecords();
    } catch (err) {
      setNotice(i18n("pages.info.kongjiantab.fe4a11b61bf6", { value: String(err instanceof Error ? err.message : String(err)) }));
    } finally {
      setBusy(false);
    }
  }, [picked, profile, purpose, loadRecords]);

  const cancel = useCallback(
    async (rec: KongjianRecord) => {
      if (!rec.cancelTarget) return;
      if (!(await confirmOk(i18nMsg("pages.info.kongjiantab.5e02f649e2b6", { space: String(rec.space), time: String(rec.time) })))) return;
      try {
        await info.kongjianCancel(rec.cancelTarget);
        void loadRecords();
      } catch (err) {
        window.alert(i18n("pages.info.kongjiantab.99ed81157283", { value: String(err instanceof Error ? err.message : String(err)) }));
      }
    },
    [loadRecords],
  );

  const spaces = page?.spaces ?? [];
  /** 生效房间：优先本会话选择，回退服务端页面缺省选中（否则首屏星标不出现） */
  const effRoomId = roomId || page?.selectedRoom || "";
  // 场次按上下午分块展示（对齐体育页风格：块内时间胶囊）
  const slots = page?.slots ?? [];
  const buckets: Array<[string, KongjianSlot[]]> = [
    [i18n("pages.info.kongjiantab.298336ec2c0e"), slots.filter((x) => Number(String(x.time).split(":")[0]) < 12)],
    [i18n("pages.info.kongjiantab.af81dcf37aa8"), slots.filter((x) => { const h = Number(String(x.time).split(":")[0]); return h >= 12 && h < 17; })],
    [i18n("pages.info.kongjiantab.a9b1124b3461"), slots.filter((x) => Number(String(x.time).split(":")[0]) >= 17)],
  ];

  return (
    <>
      <SectionHead title={i18n("pages.info.kongjiantab.f68b28f7f2a2")} aside={i18n("pages.info.kongjiantab.98fde9b93a54")} />
      {state === "error" ? (
        <ErrorNote
          text={unavailable ? i18n("pages.info.kongjiantab.6325654ae002") : (error ?? "")}
          onRetry={() => (spaceId ? void loadSlots(spaceId, roomId, date) : void loadSpaces())}
        />
      ) : null}
      {state === "loading" ? <SkeletonRows rows={4} /> : null}
      {state === "ready" && (page?.spaces.length ?? 0) === 0 ? (
        <TabEmpty text={i18n("pages.info.kongjiantab.a0624ace1039")} />
      ) : null}

      {state === "ready" && page && page.spaces.length > 0 ? (
        <>
          <Card style={{ marginBottom: 12, padding: "12px 14px" }}>
            <div className="field" style={{ marginBottom: 10 }}>
              <label><Text slot="label" tone="faint">{i18n("pages.info.kongjiantab.e81059e1a712")}</Text></label>
              <div className="ss-row" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <SearchSelect
                    value={spaceId}
                    onChange={(v) => pickSpace(v)}
                    placeholder={i18n("pages.info.kongjiantab.58ed0c97a7b1", { length: String(page.spaces.length) })}
                    options={spaces.map((sp) => ({ value: sp.id, label: sp.name }))}
                  />
                </div>
                {spaceId ? (
                  <CollectStar
                    atom={{ kind: "kj-space", key: enc(spaceId, spaces.find((sp) => sp.id === spaceId)?.name ?? "") }}
                    title={spaces.find((sp) => sp.id === spaceId)?.name ?? i18n("pages.info.kongjiantab.e81059e1a712")}
                  />
                ) : null}
              </div>
            </div>
            {page.rooms.length > 0 ? (
              <div style={{ marginBottom: 10 }}>
                <div><Text slot="label" tone="faint">{i18n("pages.info.kongjiantab.96b2d406041b")}</Text></div>
                <div className="ss-row" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                    <SearchSelect
                      value={roomId || page.selectedRoom || ""}
                      onChange={(v) => pickRoom(v)}
                      placeholder={i18n("pages.info.kongjiantab.2ec81db68e25")}
                      options={[{ value: "", label: i18n("pages.info.kongjiantab.6dbaeff68e66") }, ...page.rooms.map((r) => ({ value: r.id, label: r.name }))]}
                    />
                  </div>
                  {effRoomId ? (
                    <CollectStar
                      atom={{ kind: "kj-room", key: enc(spaceId, spaces.find((sp) => sp.id === spaceId)?.name ?? "", effRoomId, page.rooms.find((r) => r.id === effRoomId)?.name ?? "") }}
                      title={page.rooms.find((r) => r.id === effRoomId)?.name ?? i18n("pages.info.kongjiantab.96b2d406041b")}
                    />
                  ) : null}
                </div>
              </div>
            ) : null}
            {page.dates.length > 0 ? (
              <div>
                <div><Text slot="label" tone="faint">{i18n("pages.info.kongjiantab.70d0c1b33626")}</Text></div>
                <Select value={date} onChange={(value) => pickDate(value)}>{page.dates.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}</Select>
              </div>
            ) : null}
            {page.info ? (
              <div style={{ marginTop: 8 }}><Text slot="micro" tone="faint">{page.info}</Text></div>
            ) : null}
          </Card>

          {slots.length === 0 && (spaceId || page.selectedRoom) ? (
            <Card style={{ marginBottom: 12 }}>
              <div className="empty">{i18n("pages.info.kongjiantab.698451e7a267")}</div>
            </Card>
          ) : null}
          {buckets
            .filter(([, list]) => list.length > 0)
            .map(([label, list]) => (
              <Card key={label} style={{ marginBottom: 12, padding: "12px 14px" }}>
                <Text as="div" slot="body" weight="semibold">{label}</Text>
                <div className="slot-grid">
                  {list.map((slot, i) => {
                    const bookable = slotBookable(slot);
                    const pickedNow = picked?.date === slot.date && picked?.time === slot.time;
                    return (
                      <button
                        key={`${slot.date}-${slot.time}-${i}`}
                        className={"slot-cell" + (pickedNow ? " picked" : bookable ? "" : " taken")}
                        title={slot.state}
                        disabled={!bookable}
                        onClick={() => bookable && setPicked(slot)}
                      >
                        <b>{slot.time}</b>
                        <small>{bookable ? i18n("pages.info.kongjiantab.d1d50368fefe") : slot.state || i18n("pages.info.kongjiantab.a4c0233f1d6c")}</small>
                      </button>
                    );
                  })}
                </div>
              </Card>
            ))}

          {picked ? (
            <>
              <SectionHead title={i18n("pages.info.kongjiantab.72944bf6d779")} aside={`${picked.date} ${picked.time}`} />
              <Card style={{ marginBottom: 14, padding: "12px 14px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 120, height: 32, fontSize: 13 }}>{<Input value={profile.name} onChange={(value) => setProfile({ ...profile, name: value })} placeholder={i18n("pages.info.kongjiantab.50b5b1d2abef")} />}</div>
                <div style={{ flex: 1, minWidth: 120, height: 32, fontSize: 13 }}>{<Input value={profile.sid} onChange={(value) => setProfile({ ...profile, sid: value })} placeholder={i18n("pages.info.kongjiantab.c4d678ef6e37")} />}</div>
                <div style={{ flex: 1, minWidth: 120, height: 32, fontSize: 13 }}>{<Input value={profile.tel} onChange={(value) => setProfile({ ...profile, tel: value })} placeholder={i18n("pages.info.kongjiantab.bf8b5d378f01")} />}</div>
              </div>
              <TextArea value={purpose} onChange={(value) => setPurpose(value)} placeholder={i18n("pages.info.kongjiantab.60ac5285aa4d")} rows={2} />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <Btn variant="outline" onClick={() => setPicked(null)}>{i18n("pages.info.kongjiantab.2cd0f3be8738")}</Btn>
                <Btn variant="solid" tone="brand" disabled={busy} onClick={() => void submit()}>{busy ? i18n("pages.info.kongjiantab.18931020ad52") : i18n("pages.info.kongjiantab.da32887460b5")}</Btn>
              </div>
              </Card>
            </>
          ) : null}

          {notice ? (
            <Card style={{ marginBottom: 12 }}>
              <div className="empty">{notice}</div>
            </Card>
          ) : null}

          <SectionHead title={i18n("pages.info.kongjiantab.1a558735ea57")} aside={i18n("pages.info.kongjiantab.434f5b0b9e74")} />
          {recState === "loading" && !records ? <SkeletonRows rows={3} /> : null}
          {records && records.length === 0 ? <TabEmpty text={i18n("pages.info.kongjiantab.c3b180cc0d49")} /> : null}
          {records && records.length > 0 ? (
            records.map((rec, i) => (
              <Card key={i} style={{ marginBottom: 8, padding: "10px 14px" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{rec.space}</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>{rec.time}</div>
                  <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.75 }}>{rec.status}</div>
                </div>
                {rec.cancelTarget ? (
                  <div style={{ marginTop: 6, textAlign: "right" }}>
                    <Btn variant="outline" onClick={() => void cancel(rec)}>{i18n("pages.info.kongjiantab.0afc4fe3d305")}</Btn>
                  </div>
                ) : null}
              </Card>
            ))
          ) : null}
        </>
      ) : null}
    </>
  );
}
