import { t as i18n, useLocale as useUiLocale } from "../../i18n/index.js";
/**
 * 预约页 —— 页内分栏（segmented）：「图书馆座位」（LibraryTab 原样复用，
 * 自带分区标题与三态重试）/「研讨间」（LibRoomTab，cab.lib ic-web）/
 * 「空教室」（ClassroomTab，教学 Tina 空闲状态只读查询）/
 * 「体育」（VenueSportsTab，体育系统 sports.tsinghua.edu.cn 全套移植：场馆→场次→提交→记录退订，除支付）/
 * 「更多场馆」占位（游泳馆、健身房等陆续接入）。
 * 与 InfoPage 同款交互：每个 tab 首次激活时挂载并保持挂载（visited + hidden）。
 *
 * 子栏直达（首页入口化）：navigate("reserve", { reserveTab }) 指定初始 tab，
 * 契约值 "lib"/"room"/"classroom"/"sports" 映射页内 library/libroom/classroom/sports
 * 栏（缺省图书馆座位），与 InfoPage 的 infoNewsId 同款消费模式（挂载初值 +
 * navParams 身份触发的 effect）；页内切换不回写参数。
 */
import { useEffect, useState } from "react";
import { RootPageStar } from "../../components/Collect.js";
import { SegmentedOverflow, Card, Empty, PageHead } from "../../components/Layout.js";
import type { LearnNav } from "../../state/app.js";
import { useApp } from "../../state/context.js";
import { LibraryTab } from "./LibraryTab.js";
import { LibRoomTab } from "./LibRoomTab.js";
import { ClassroomTab } from "./ClassroomTab.js";
import { VenueSportsTab } from "./VenueSportsTab.js";
import { KongjianTab } from "./KongjianTab.js";
import { VisitTab } from "./VisitTab.js";
import { useTabDirection } from "../../lib/motion.js";

export type ReserveTab = "library" | "libroom" | "classroom" | "sports" | "kongjian" | "visit" | "more";

const TABS: Array<{ id: ReserveTab; label: string }> = [
  { id: "library", get label() { return i18n("pages.info.reservepage.31c17158ebdb"); } },
  { id: "libroom", get label() { return i18n("pages.info.reservepage.e4d40b4d6759"); } },
  { id: "classroom", get label() { return i18n("pages.info.reservepage.ecc11c8afea8"); } },
  { id: "sports", get label() { return i18n("pages.info.reservepage.ef7be5be3c13"); } },
  { id: "kongjian", get label() { return i18n("pages.info.reservepage.e81059e1a712"); } },
  { id: "visit", get label() { return i18n("pages.info.reservepage.3fbaca96ff24"); } },
  { id: "more", get label() { return i18n("pages.info.reservepage.5c82e963dbfd"); } },
];

const TAB_IDS = TABS.map((t) => t.id);

/** LearnNav.reserveTab 契约值 → 页内 tab id（"more" 仅页内可达，不作直达参数） */
const PARAM_TO_TAB: Record<NonNullable<LearnNav["reserveTab"]>, ReserveTab> = {
  lib: "library",
  kongjian: "kongjian",
  visit: "visit",
  room: "libroom",
  classroom: "classroom",
  sports: "sports",
};

export function ReservePage() {
  const uiLocale = useUiLocale();

  const { navParams, navigate } = useApp();
  const direct = navParams?.reserveTab ? PARAM_TO_TAB[navParams.reserveTab] : undefined;
  const [tab, setTab] = useState<ReserveTab>(() => direct ?? "library");
  // 页签切换方向（决定内容从哪一侧滑入）
  const tabDir = useTabDirection(tab ?? null, TAB_IDS);
  /** 已激活过的 tab 保持挂载：切回即显（数据在 hook 里，无需重复请求） */
  const [visited, setVisited] = useState<ReadonlySet<ReserveTab>>(() => new Set([direct ?? "library"]));

  useEffect(() => {
    const p = navParams?.reserveTab;
    if (!p) return; // 无参数导航（侧栏点击等）：不改变当前 tab
    const t = PARAM_TO_TAB[p];
    setTab((cur) => (cur === t ? cur : t));
    setVisited((prev) => (prev.has(t) ? prev : new Set(prev).add(t)));
  }, [navParams]);

  const activate = (id: ReserveTab) => {
    setTab(id);
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  };

  /* 子栏目回写到标签 params（反向映射页内 tab → 契约参数值；"more" 仅页内可达，不回写） */
  useEffect(() => {
    const param = (Object.keys(PARAM_TO_TAB) as Array<keyof typeof PARAM_TO_TAB>).find((k) => PARAM_TO_TAB[k] === tab);
    if (!param || navParams?.reserveTab === param) return;
    navigate("reserve", { reserveTab: param });
  }, [tab, navParams?.reserveTab, navigate]);

  return (
    <>
     <PageHead
       title={i18n("pages.info.reservepage.352cdc807892")}
       actions={<RootPageStar page="reserve" title={i18n("pages.info.reservepage.352cdc807892")} />}
     />
      <SegmentedOverflow ariaLabel={i18n("pages.info.reservepage.2cde685b0f38")} style={{ marginBottom: 14 }}>
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "is-active" : ""}
            onClick={() => activate(id)}
          >
            {label}
          </button>
        ))}
      </SegmentedOverflow>

      {/* LibraryTab 自带「图书馆座位」分区标题，不再叠加模块头 */}
      <div hidden={tab !== "library"} className={tab === "library" ? "tab-anim" : undefined} data-dir={tabDir}>{visited.has("library") ? <LibraryTab deepLib={navParams?.libraryId} deepFloor={navParams?.libraryFloorId} deepSection={navParams?.librarySectionId} /> : null}</div>
      <div hidden={tab !== "libroom"} className={tab === "libroom" ? "tab-anim" : undefined} data-dir={tabDir}>{visited.has("libroom") ? <LibRoomTab deepKind={navParams?.libroomKind} /> : null}</div>
      <div hidden={tab !== "classroom"} className={tab === "classroom" ? "tab-anim" : undefined} data-dir={tabDir}>{visited.has("classroom") ? <ClassroomTab deepBuilding={navParams?.classroomBuilding} deepBuildingName={navParams?.classroomBuildingName} deepRoom={navParams?.classroomRoom} /> : null}</div>
      <div hidden={tab !== "sports"} className={tab === "sports" ? "tab-anim" : undefined} data-dir={tabDir}>{visited.has("sports") ? <VenueSportsTab deepScene={navParams?.sportsScene} /> : null}</div>
      <div hidden={tab !== "kongjian"} className={tab === "kongjian" ? "tab-anim" : undefined} data-dir={tabDir}>{visited.has("kongjian") ? <KongjianTab kongjianSpace={navParams?.kongjianSpace} kongjianRoom={navParams?.kongjianRoom} /> : null}</div>
      <div hidden={tab !== "visit"} className={tab === "visit" ? "tab-anim" : undefined} data-dir={tabDir}>{visited.has("visit") ? <VisitTab /> : null}</div>
      <div hidden={tab !== "more"} className={tab === "more" ? "tab-anim" : undefined} data-dir={tabDir}>
        {visited.has("more") ? (
          <Card>
            <Empty text={i18n("pages.info.reservepage.ab070d2bfaf1")} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
