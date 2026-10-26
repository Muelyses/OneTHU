/** Read-only Rain Classroom surface shared by the graphical host and SDK. */
import { createYuketangSource, YktSessionError } from "./yuketang.js";
import type { FetchLike } from "../http.js";
export interface YuketangQueryPorts {
  credentials(): Promise<{ cookie: string; uvId?: string; days?: number } | null>;
  fetch: FetchLike;
  check(): Promise<void>;
}
function fail(code: string, message: string): never { throw Object.assign(new Error(`${code}: ${message}`), { code }); }
export function createYuketangQueries(ports: YuketangQueryPorts) {
  async function read<T extends object>(days: number | undefined, run: (source: ReturnType<typeof createYuketangSource>) => Promise<T>, classroomId?: string) {
    await ports.check();
    const credential = await ports.credentials();
    if (!credential?.cookie?.trim()) fail("YUKETANG_NOT_CONFIGURED", "Sign in to Rain Classroom / 雨课堂 in Settings → Account using the QR-code option.");
    const windowDays = days ?? credential.days ?? 30;
    if (!Number.isSafeInteger(windowDays) || windowDays < 1 || windowDays > 3660) fail("YUKETANG_INVALID_DAYS", "days must be an integer from 1 to 3660.");
    const check = async () => {
      await ports.check();
      const current = await ports.credentials();
      if (current?.cookie !== credential.cookie || current?.uvId !== credential.uvId) fail("YUKETANG_SESSION_CHANGED", "The Rain Classroom account changed; retry the query.");
    };
    await check();
    const fetch: FetchLike = async (url, init) => { await check(); const response = await ports.fetch(url, init); await check(); return response; };
    const issues: Array<{ code: string; classroomId: string }> = [];
    let result: T;
    try {
      result = await run(createYuketangSource(credential, fetch, windowDays, { query: { classroomId, onIssue: issue => issues.push(issue) } }));
    } catch (error) {
      if (error instanceof YktSessionError) fail("YUKETANG_SESSION_EXPIRED", "Sign in to Rain Classroom again using Settings → Account → Rain Classroom → QR code. Your university sign-in is separate.");
      throw error;
    }
    await check();
    return { ...result, complete: issues.length === 0, issues };
  }
  return {
    async status() {
      await ports.check(); const credential = await ports.credentials(); await ports.check();
      return { source: "yuketang", name: "雨课堂 / Rain Classroom", configured: !!credential?.cookie?.trim(),
        state: credential?.cookie?.trim() ? "configured" : "not-configured", verification: "Use courses to check the live session.",
        login: { page: "settings", section: "exthw", method: "qr-code" } };
    },
    courses: () => read(undefined, async source => ({ source: "yuketang", rows: await source.fetchCourses!() })),
    contents: (classroomId?: string) => read(undefined, async source => ({ source: "yuketang",
      rows: (await source.fetchContents!()).filter(row => !classroomId || row.courseId === classroomId) }), classroomId),
    homework: (classroomId?: string, days?: number) => read(days, async source => ({ source: "yuketang", windowDays: days ?? (await ports.credentials())?.days ?? 30, pastAssignmentsIncluded: true,
      rows: (await source.fetch()).filter(row => !classroomId || row.classroomId === classroomId) }), classroomId),
    homeworkDetail: (classroomId: string, leafTypeId: string) => read(undefined, source => source.getExerciseDetail(leafTypeId, classroomId)),
    leafDetail: (classroomId: string, leafId: string) => read(undefined, source => source.getLeafDetail(classroomId, leafId)),
    noticeDetail: (classroomId: string, noticeIds: string[]) => read(undefined, source => source.getNoticeDetail(classroomId, noticeIds)),
  };
}
