import { t as i18n } from "../i18n/index.js";
/**
 * 标签页完整路径标题（dev-explorer）：数据感知的实体级面包屑。
 *
 * 用户拍板（2026-10-12）：tab 上只写「通知/作业」是偷懒——学堂里那么多课程那么多
 * 作业，标题必须能定位到**具体实体**。这里的解析从各数据快照里把实体名查出来拼
 * 完整路径（`一级页 › 课程 › 实体名`）：
 *   learn-course          → 网络学堂 › 高等数学
 *   learn-assignment-det  → 高等数学 › 作业 › 第一次编程作业
 *   folder                → OnePage › 考研资料 › 数学
 *   mail                  → 邮箱 › 收件箱 › Re: 实验安排
 * 数据未就绪时返回静态兜底路径（域清晰，不出现裸「通知」）；快照到位后调用方
 * 重渲染即自动升级为实体级（useTabTitleTick 提供轻量重渲染节拍）。
 */
import type { LearnNav, Page } from "./app.js";
import { useEffect, useState } from "react";
import { titleOf } from "./explorer.js";
import { getLearnSnapshot } from "./data.js";
import { loadFavs } from "./favorites.js";
import { getMailHead } from "./mail.js";
import { seafileRepoName } from "./seafile.js";
import { loadBoard } from "./board.js";

export interface TabTitle {
  /** 短标签（TabStrip 上显示；通常是实体名/末段） */
  label: string;
  /** 完整路径（tooltip / TabDrawer 摘要 / 复制确认用） */
  full: string;
}

/** 课程名查找（id → name；快照未就绪返回 null） */
function courseNameOf(courseId: string | undefined): string | null {
  if (!courseId) return null;
  const snap = getLearnSnapshot();
  return snap?.courses.find((c) => c.id === courseId)?.name ?? null;
}

/** 收藏夹（OnePage）的祖先链：`父 › 子`。
 *  favs 树的子夹是父夹 items 里的 {t:"f", id} 引用（夹节点没有 parent 指针），
 *  所以自底向上：先全表建「子夹 id → 父夹 id」映射，再逐级上溯。 */
function folderChain(folderId: string): Array<string> | null {
  const d = loadFavs();
  const target = d.folders[folderId];
  if (!target) return null;
  const parentOf = new Map<string, string>();
  for (const id of Object.keys(d.folders)) {
    for (const it of d.folders[id]!.items) {
      if (it.t === "f") parentOf.set(it.id, id);
    }
  }
  const chain = [target.title];
  let cur = parentOf.get(folderId);
  let guard = 0;
  while (cur && guard < 6) {
    const title = d.folders[cur]?.title;
    if (!title) break;
    chain.unshift(title);
    cur = parentOf.get(cur);
    guard += 1;
  }
  return chain;
}

/**
 * 解析一个标签页的完整路径。纯同步读快照，不发请求；
 * 查不到实体时逐级兜底（实体名 → 静态页名），绝不出现裸「通知」。
 */
export function resolveTabTitle(page: Page, params: LearnNav | null): TabTitle {
  const snap = getLearnSnapshot();
  switch (page) {
    case "learn-course": {
      const name = courseNameOf(params?.courseId);
      return name
        ? { label: name, full: i18n("state.tabtitles.55203d69afd6", { name: String(name) }) }
        : { label: i18n("state.tabtitles.22519a88484f"), full: i18n("state.tabtitles.b2c656b0a5a4") };
    }
    case "learn-assignment-detail": {
      const hw = snap?.homework.find((h) => h.id === params?.itemId) ?? null;
      const course = courseNameOf(params?.courseId) ?? hw?.courseId ?? null;
      if (hw?.title) {
        const head = course ? i18n("state.tabtitles.f12e9b97b5c4", { course: String(course) }) : i18n("state.tabtitles.7292c38a500b");
        return { label: hw.title, full: `${head} › ${hw.title}` };
      }
      return { label: i18n("state.tabtitles.d4af30a738c7"), full: course ? i18n("state.tabtitles.0fb5334ea170", { course: String(course) }) : i18n("state.tabtitles.04671516a9d5") };
    }
    case "learn-notice-detail": {
      const ntf = snap?.notifications.find((n) => n.id === params?.itemId) ?? null;
      const course = courseNameOf(params?.courseId);
      if (ntf?.title) {
        const head = course ? i18n("state.tabtitles.1bed6f81e9f6", { course: String(course) }) : i18n("state.tabtitles.b543a6b7ca5d");
        return { label: ntf.title, full: `${head} › ${ntf.title}` };
      }
      return { label: i18n("state.tabtitles.483fe390159f"), full: course ? i18n("state.tabtitles.46034b925dd1", { course: String(course) }) : i18n("state.tabtitles.14827749c5db") };
    }
    case "learn-file-detail": {
      const f = snap?.files.find((x) => x.id === params?.itemId) ?? null;
      const course = courseNameOf(params?.courseId);
      if (f?.title) {
        const head = course ? i18n("state.tabtitles.457de67c8142", { course: String(course) }) : i18n("state.tabtitles.57c7c46977b9");
        return { label: f.title, full: `${head} › ${f.title}` };
      }
      return { label: i18n("state.tabtitles.27b6154b3fd3"), full: course ? i18n("state.tabtitles.c7410c8f179d", { course: String(course) }) : i18n("state.tabtitles.668cfd9074b0") };
    }
    case "learn-forum-thread": {
      const course = courseNameOf(params?.courseId);
      return { label: i18n("state.tabtitles.9c92c9d08b05"), full: course ? i18n("state.tabtitles.2d5504d2955c", { course: String(course) }) : i18n("state.tabtitles.714d843bb743") };
    }
    case "learn-ykt-detail": {
      const y = params?.ykt;
      const name = y?.title ?? i18n("state.tabtitles.f0cd4338679e");
      const course = y?.courseName ?? i18n("state.tabtitles.38b9eabcae1b");
      return { label: name, full: `${course} › ${name}` };
    }
    case "board": {
      /* OnePage 有自己的名字与 icon：标签页显示当前打开的那块板，而不是写死的「白板」。 */
      try {
        const doc = loadBoard();
        const b = doc.boards.find((x) => x.id === doc.activeBoardId) ?? null;
        if (b?.name) return { label: b.name, full: `OnePage › ${b.name}` };
      } catch {
        /* 读不到就落静态兜底 */
      }
      return { label: "OnePage", full: "OnePage" };
    }
    case "folder": {
      const chain = params?.folderId ? folderChain(params.folderId) : null;
      if (chain) {
        const label = chain[chain.length - 1] ?? "OnePage";
        return { label, full: `OnePage › ${chain.join(" › ")}` };
      }
      return { label: "OnePage", full: "OnePage" };
    }
    case "mail": {
      const head = params?.mailFolder && params?.mailUid ? getMailHead(params.mailFolder, params.mailUid) : null;
      const folderLabel = params?.mailFolder === "sent" ? i18n("state.tabtitles.60823aaec73b") : i18n("state.tabtitles.63a5e7b73911");
      if (head?.subject) return { label: head.subject, full: i18n("state.tabtitles.9f4769eefab0", { folderLabel: String(folderLabel), subject: String(head.subject) }) };
      return { label: i18n("state.tabtitles.73075237fd0f"), full: i18n("state.tabtitles.6f1c237908f0", { folderLabel: String(folderLabel) }) };
    }
    case "cloud": {
      const name = params?.cloudRepo ? seafileRepoName(params.cloudRepo) : null;
      return name
        ? { label: name, full: i18n("state.tabtitles.3d03c8dd1593", { name: String(name) }) }
        : { label: i18n("state.tabtitles.f75562426e77"), full: i18n("state.tabtitles.f75562426e77") };
    }
    case "learn":
      return { label: i18n("state.tabtitles.aa39cac2b409"), full: i18n("state.tabtitles.aa39cac2b409") };
    case "learn-notices":
      return { label: i18n("state.tabtitles.bdac834d0ba2"), full: i18n("state.tabtitles.0c15bb46b442") };
    case "learn-files":
      return { label: i18n("state.tabtitles.be417b530c04"), full: i18n("state.tabtitles.5caea2aaeece") };
    case "learn-assignments":
      return { label: i18n("state.tabtitles.a1cabc0664cf"), full: i18n("state.tabtitles.859096256da9") };
    case "learn-search":
      return { label: i18n("state.tabtitles.44ce7ae909bb"), full: i18n("state.tabtitles.2ac4206ef92a") };
    default:
      break;
  }
  const t = titleOf(page, params);
  return { label: t, full: t };
}

/** 标题刷新节拍：数据快照跨 store，TabStrip 无法逐个订阅——15s tick + explorer
 *  订阅（切 tab 必渲染）兜住「打开即升级为实体名」的观感。 */
export function useTabTitleTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 15_000);
    return () => window.clearInterval(t);
  }, []);
  return tick;
}
