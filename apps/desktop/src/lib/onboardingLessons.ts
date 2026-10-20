/** Mode-specific lessons. Pure content: importing this file never reads or writes saved preferences. */
import type { ExperienceMode } from "../state/experienceMode.js";

export type TourTarget = "home" | "workspaces" | "vault" | "organization" | "onego" | "plugins" | "appearance" | "learn" | "data" | "practical";
export interface Lesson {
  id: string;
  title: string;
  lead: string;
  steps: string[];
  target?: TourTarget;
  action?: string;
}

/** Full mode teaches its five distinctive workflows; secondary tools remain discoverable at the end. */
export const FULL_LESSONS: Lesson[] = [
  {
    id: "board", title: "白板与 OnePage：首页由你摆", lead: "首页是一块自由画布，组件的位置和大小随手调。",
    steps: ["点「＋」添加组件；按住拖动调整位置。", "右键或长按组件，选择「改变大小」或固定。", "双击便笺与文字编辑；OnePage 可另建白板。"],
    target: "home", action: "去看看白板",
  },
  {
    id: "vault", title: "暂存箱：什么都能先收进来", lead: "文件先留在本机，需要分享时再连接云盘。",
    steps: ["暂存箱贴在屏幕边缘，可拖动换位。", "点箱子预览；手机向内轻滑打开管理。", "长按内容拖进箱子；日程先存快照，按需加入。"],
    target: "vault", action: "打开暂存箱",
  },
  {
    id: "code", title: "一个短口令，传递一组内容", lead: "生成短口令后发送，对方联网接收这组内容。",
    steps: ["先确认箱内内容，再生成并复制分享口令。", "接收可粘贴口令或识别二维码；限定邮箱需对应账号。", "已发出口令可改接收范围或撤销；已接收副本保留。"],
    target: "vault", action: "查看收发入口",
  },
  {
    id: "nfc", title: "碰一碰：名片与内容接力", lead: "支持 NFC 的设备可以贴近传递口令，也能用二维码。",
    steps: ["先打开收发入口，点「接收」查看设备支持。", "两端选 NFC 传送与接收，成功后再分开。", "接收内容仍需联网；不支持时改用口令或二维码。"],
    target: "vault", action: "打开收发入口",
  },
  {
    id: "organization", title: "组织：人、文件、项目一处管", lead: "创建组织即绑定组织名片，成员按权限协作。",
    steps: ["邀请成员时可用口令，并设有效期。", "在组织中管理成员、资料库、项目和公告。", "成员身份与访问权限由服务器确认。"],
    target: "organization", action: "打开组织",
  },
];

/** Optional full-mode discoveries retain every existing real destination. */
export const EXTRA_LESSONS: Lesson[] = [
  {
    id: "explorer", title: "标签页与工作区：多任务不打架", lead: "每个页面都是一枚标签，工作区保存一组页面。",
    steps: ["点顶栏＋或搜索开新标签，拖动可换序。", "在 OneGO! 保存工作区，下次一键恢复。", "标签栏可横排或竖排，按使用习惯切换。"],
    target: "workspaces", action: "打开工作区入口",
  },
  {
    id: "onego", title: "OneGO!：全局入口与自动化", lead: "OneGO! 收好常用页面、工作区与 OneFlow。",
    steps: ["⌘/Ctrl+K 唤出搜索，直跳页面或内容。", "OneFlow 把一串操作固化成步骤。", "可按需触发：手动、定时或事件。"],
    target: "onego", action: "打开 OneGO!",
  },
  {
    id: "plugin", title: "插件与 OH：把能力装进来", lead: "装插件扩展组件、主题与 MCP 工具。",
    steps: ["插件页安装管理，给 OH 配模型源。", "悬浮球可在 OH 设置中开启或关闭。", "可给本机应用开放 OH MCP（默认关闭）。", "自制内容可发布为 OnePage 或组件。", "OH 支持语音、多模态与 IM 接入。"],
    target: "plugins", action: "看看插件页",
  },
  {
    id: "customize", title: "外观与工作台：全都可调", lead: "主题、壁纸、密度和入口排布都能改。",
    steps: ["设置→外观与布局：主题、壁纸、字号。", "组件、一级功能区、标签栏、OneShot 可调。", "改坏可恢复默认布局，不动数据。"],
    target: "appearance", action: "打开外观设置",
  },
  {
    id: "campus", title: "校园服务：完整模式的聚合", lead: "学习、生活、预约、云盘、GitLab 汇在一起。",
    steps: ["学习：作业、通知、文件、成绩、讨论。", "生活：校园卡、电费网费、洗衣、场馆。", "云盘、邮箱、GitLab、寻迹也能直接打开。"],
    target: "learn", action: "去学习页",
  },
  {
    id: "data", title: "数据与同步：跨设备继续", lead: "按需连接日历、分享内容，在其他设备继续。",
    steps: ["日程支持云日历与系统日历同步。", "口令与 NFC 让内容跨设备接力。", "切换模式不清数据，设置里可导出。"],
    target: "data", action: "查看数据设置",
  },
];

export const SIMPLE_LESSONS: Lesson[] = [
  {
    id: "today", title: "首页，只关心今天", lead: "打开就看到今日待办与要上的课程，无需整理页面。",
    steps: ["点待办查看详情，点课程进入课程内容。", "随时点左上角「首页」回到今天。", "需要更多功能时，可在设置里切换模式。"],
    target: "home", action: "看看今天",
  },
  {
    id: "quick", title: "五个功能，固定在手边", lead: "学习、预约、生活、课表、信息，固定在底部。",
    steps: ["学习看课程与作业；预约找场馆、研讨间与来访报备。", "生活与信息汇集校园服务；课表看时间安排。", "OH 搜索胶囊始终可用；可在设置里填自己的 API。"],
    target: "home", action: "看看底部五入口",
  },
];

export const PRACTICAL_LESSONS: Lesson[] = [
  {
    id: "today", title: "首页，只关心今天", lead: "今日待办与要上的课程就在首页，所有基础功能仍可用。",
    steps: ["点待办查看详情，点课程进入课程内容。", "随时点左上角「首页」回到今天。", "OH 搜索胶囊始终可用；自己的 API 在设置里填写。"],
    target: "home", action: "看看今天",
  },
  {
    id: "more", title: "更多功能：所有基础功能都在这里", lead: "第五格「更多功能」展开真实目录，点名称直接打开。",
    steps: ["按学习、日程、生活、预约等目录寻找，也可以搜索。", "暂存箱、组织、白板与插件属于完整模式，可在设置切换。"],
    target: "practical", action: "展开更多功能",
  },
  {
    id: "swap", title: "四个入口，随你安排", lead: "学习、预约、生活、课表默认在下排，常用功能可以换进去。",
    steps: ["在「更多功能」里点功能右侧的 + 号。", "选择替换入口 1 到 4，该功能就固定在底部。", "换过的入口会保留；切换模式不改其他模式的安排。"],
    target: "practical", action: "调整常用入口",
  },
];

export function lessonsForMode(mode: ExperienceMode): Lesson[] {
  return mode === "simple" ? SIMPLE_LESSONS : mode === "practical" ? PRACTICAL_LESSONS : FULL_LESSONS;
}
