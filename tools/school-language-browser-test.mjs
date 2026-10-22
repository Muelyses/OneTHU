/** Browser DOMParser branch, using anonymous HTML only and blocking remote network. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";

const base = process.env.ONETHU_TEST_URL ?? "http://127.0.0.1:5180";
const out = process.env.ONETHU_TEST_OUT ?? "/tmp/onethu-school-language";
const engines = (process.env.SCHOOL_TEST_ENGINES ?? "chromium,webkit").split(",");
assert.ok(engines.length && engines.every(x => ["chromium", "webkit"].includes(x)));
mkdirSync(out, { recursive: true });
const files = ["packages/core/src/learn/client.ts", "packages/core/src/zhjwxk/client.ts", "packages/core/src/zhjwxk/html-language.ts", "packages/core/src/zhjwxk/xk-vol.ts", "packages/core/src/http.ts"];
const report = { passed: false, checks: [], engines, errors: [], sources: Object.fromEntries(files.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])), boundary: "Actual core module with browser DOMParser; anonymous structural fixtures. Official English course-selection inner page and homework detail page were not provided, so their exact markup remains unverified. No school network or language preference changes." };
try {
  for (const engine of engines) {
    const browser = await (engine === "webkit" ? webkit : chromium).launch({ headless: true, ...(engine === "chromium" ? { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" } : {}) });
    try {
      const page = await browser.newPage();
      page.on("pageerror", e => report.errors.push(e.message));
      await page.routeWebSocket("**/*", socket => socket.close());
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        return url.origin === new URL(base).origin ? route.continue() : route.abort();
      });
      await page.route(base + "/__test/school-language", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><main>Anonymous parser fixture</main>' }));
      await page.goto(base + "/__test/school-language");
      const checks = await page.evaluate(async root => {
        const { parseXkCatalogPage, parseXkSelectedFull, parseSelectedCourses } = await import(`/@fs${root}/packages/core/src/zhjwxk/client.ts`);
        const { LearnClient } = await import(`/@fs${root}/packages/core/src/learn/client.ts`);
        const checks = [];
        const check = (value, label) => { if (!value) throw Error(label); checks.push(label); };
        // Count actual production use of browser DOMParser; this cannot silently pass through the Node fallback.
        const NativeParser = window.DOMParser;
        let parses = 0;
        window.DOMParser = class extends NativeParser { parseFromString(...args) { parses++; return super.parseFromString(...args); } };
        const table = (heads, rows) => `<table><tr class="trr1">${heads.map(x => `<th>${x}</th>`).join("")}</tr>${rows.map(row => `<tr class="trr2">${row.map(x => `<td>${x}</td>`).join("")}</tr>`).join("")}</table>`;
        try {
          for (const heads of [
            ["Course Title", "Instructor", "Course Code", "Section", "Credits", "Undergraduate Capacity", "Undergraduate Vacancies", "Graduate Capacity", "Graduate Vacancies", "Time and Location", "Department"],
            ["课程名称", "教师", "课号", "课序号", "学分", "本科生容量", "本科生余量", "研究生容量", "研究生余量", "时间地点", "院系"],
          ]) {
            const row = ["Anonymous Course", '<table><tr><td><a href="?m=showJsDetail&p_jsh=fixture-only">Example Teacher</a></td></tr></table>', "TEST123", "02", "3", "80", "12", "20", "5", "Tuesday 08:00-09:35 (Weeks 1-16) Room A", "Example Department"];
            const courses = parseXkCatalogPage(table(heads, [row]));
            check(courses.length === 1 && courses[0].code === "TEST123" && courses[0].seq === "02", heads[0] + ": course identity survives reordered headers");
            check(courses[0].name === "Anonymous Course" && courses[0].teacher === "Example Teacher", heads[0] + ": nested teacher table remains one cell");
            check(courses[0].credits === 3 && courses[0].remaining === 12 && courses[0].gradRemaining === 5, heads[0] + ": credits and both capacity groups remain distinct");
            check(courses[0].time.startsWith("Tuesday"), heads[0] + ": English timetable text is preserved");
          }
          check(parses >= 2, "Actual DOMParser branch executed");
          const selected = table(["", "Course Type", "Preference", "Course Code", "Course Name", "Section", "Class Time", "Instructor", "Credits"], [[`<input value='2099-2100-1;TEST123;02;' name='p_del_id'>`, "Required", "2nd choice", "TEST123", "Anonymous Course", "02", "Tuesday 08:00-09:35", "Example Teacher", "3"]]);
          check(parseXkSelectedFull(selected)[0]?.zy === 2 && parseXkSelectedFull(selected)[0]?.seq === "02", "English selected table keeps exact section and preference");
          check(parseSelectedCourses(selected)[0]?.teacher === "Example Teacher", "Display parser recognizes instructor header");
          for (const label of ["上交作业内容", "Submitted Assignment Content"]) {
            const client = new LearnClient({ text: async url => url.includes("tijiao") ? "<html><p>Submitted assignment</p></html>" : `<div class="left">${label}</div><div class="right">&lt;p&gt;Original answer&lt;/p&gt;</div><!--Homework attachments--><div class="fujian"></div>` });
            client.applyCsrf("fixture-only");
            const detail = await client.getHomeworkPageDetail("anonymous-course", "anonymous-assignment");
            check(detail.submittedContent?.includes("Original answer"), label + ": submitted answer remains readable");
            check(!client.lastPageDetailDebug.includes("Original answer"), label + ": diagnostic contains no answer");
          }
          const unknown = new LearnClient({ postForm: async () => '{"message":"Operation not allowed"}' });
          unknown.applyCsrf("fixture-only");
          check(!(await unknown.submitHomework("anonymous-assignment", {})).ok, "Browser English unknown response never reports submission success");
        } finally { window.DOMParser = NativeParser; }
        return checks;
      }, resolve("."));
      report.checks.push(...checks.map(label => `${engine}: ${label}`));
      console.log(`${engine}: ${checks.length} parser checks passed`);
    } finally { await browser.close(); }
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  writeFileSync(out + "/report.json", JSON.stringify(report, null, 2));
}
console.log(`School language browser: ${report.checks.length} checks passed.`);
