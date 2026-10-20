/** Course names are presentation only; locale changes must not rewrite source data or route identity. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { courseDisplayName, courseSearchNames } from "../apps/desktop/src/lib/learnLanguage.ts";
import { pickHomeworkRoute } from "../apps/desktop/src/lib/yktDetail.ts";

let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const course = Object.freeze({ id: "anonymous-course-id", name: "匿名课程", englishName: "Anonymous Course", courseNumber: "TEST123", courseIndex: 2, teacherName: "Example Teacher", timeAndLocation: [], url: "https://example.invalid/course" });
const before = JSON.stringify(course);
for (const locale of ["zh-CN", "en-US", "fr-FR"]) {
  check(courseDisplayName(course, locale) === (locale === "zh-CN" ? course.name : course.englishName), locale + ": correct display language");
  const search = courseSearchNames(course);
  check(search.includes(course.name) && search.includes(course.englishName), locale + ": both source names remain searchable");
  check(JSON.stringify(course) === before, locale + ": source object remains unchanged");
}
for (const englishName of ["", undefined]) {
  check(courseDisplayName({ ...course, englishName }, "en-US") === course.name, "Missing English name falls back to original name");
  check(courseDisplayName({ ...course, englishName }, "fr-FR") === course.name, "Third language also falls back to original name");
}
check(courseDisplayName(course, "zh-TW") === course.name, "Other Chinese locale retains school original name");
check(courseDisplayName({ ...course, englishName: "  " }, "en-US") === course.name, "Whitespace English title falls back");
check(courseDisplayName(null, "en-US") === undefined, "Missing course remains missing");

// Execute actual JSX row functions and inspect the exact Atom passed to both
// CollectStar and data-vault-catch. Hooks are isolated, while key/route code is real.
const React = createRequire(new URL("../apps/desktop/package.json", import.meta.url))("react");
const extract = (path, name, deps = {}) => {
  const source = readFileSync(path, "utf8"), ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(fn, name + " production declaration exists");
  const code = ts.transpileModule(fn.getText(ast).replace(/^export\s+/, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  return new Function(...Object.keys(deps), code + `;return ${name};`)(...Object.values(deps));
};
const enc = extract("apps/desktop/src/state/atoms.tsx", "enc");
const vaultCatchAttr = extract("apps/desktop/src/components/vault/vaultDrag.ts", "vaultCatchAttr");
const openHomeworkRow = extract("apps/desktop/src/lib/homeworkEntry.ts", "openHomeworkRow", { pickHomeworkRoute });
let calls = [];
const deps = {
  React, enc, vaultCatchAttr, openHomeworkRow,
  useUiLocale: () => "en-US", useApp: () => ({ navigate: (...args) => calls.push(args) }),
  useHwIgnored: () => false, homeworkChip: () => ({ text: "Fixture", cls: "" }), homeworkEntryScoreText: () => "",
  fmtWhenParts: () => ({ date: "01-01", time: "12:00" }), i18n: key => key, i18nRich: () => null,
  isExternalNoticeId: () => false, Btn: "button", CollectStar: "collect-star", IconChevron: "svg",
};
const walk = function* (element) {
  if (!element || typeof element !== "object") return;
  yield element;
  for (const child of React.Children.toArray(element.props?.children)) yield* walk(child);
};
for (const [name, prop, kind, route] of [
  ["HomeworkRow", "h", "assignment", "learn-assignment-detail"],
  ["NoticeRow", "n", "notice", "learn-notice-detail"],
  ["FileRow", "f", "file", "learn-file-detail"],
]) {
  const Row = extract("apps/desktop/src/pages/learn/shared.tsx", name, deps);
  const entity = Object.freeze({ courseId: course.id, id: "anonymous-item", title: "Original item", deadline: "2099-01-01", publishTime: "2099-01-01", uploadTime: "2099-01-01", publisher: "Example publisher", submitted: false });
  const entityBefore = JSON.stringify(entity), emitted = [];
  for (const locale of ["zh-CN", "en-US", "fr-FR"]) {
    calls = [];
    const element = Row({ [prop]: entity, from: "learn", sem: "2099-2100-1", courseName: courseDisplayName(course, locale), identityCourseName: course.name });
    const collected = [...walk(element)].find(e => e.type === "collect-star").props.atom;
    const staged = JSON.parse(element.props["data-vault-catch"]).atom;
    check(collected.kind === kind && collected.key === enc(course.id, entity.id, entity.title, course.name, "2099-2100-1"), name + " " + locale + ": emitted key uses original metadata");
    check(JSON.stringify(staged) === JSON.stringify(collected), name + " " + locale + ": vault and favourite receive identical Atom");
    element.props.onClick();
    check(calls[0][0] === route && calls[0][1].courseId === course.id && calls[0][1].itemId === entity.id, name + " " + locale + ": actual click handler retains course/item IDs");
    emitted.push(collected.key);
  }
  check(new Set(emitted).size === 1 && JSON.stringify(entity) === entityBefore, name + ": every locale emits same persisted key without mutating source");
}
for (const path of ["AssignmentsPage", "FilesPage", "NoticesPage"]) {
  const source = readFileSync(`apps/desktop/src/pages/learn/${path}.tsx`, "utf8");
  check(source.includes("[c.id, c]") && source.includes("identityCourseName={byCourse.get("), path + ": parent keeps original course object and passes identity separately");
}
check(readFileSync("apps/desktop/src/pages/learn/CourseDetailPage.tsx", "utf8").includes("identityCourseName={course?.name}"), "Course detail passes original name separately");
console.log(`Learn language display: ${checks} checks passed (actual row JSX/key/click handlers, frozen anonymous source, no network).`);
