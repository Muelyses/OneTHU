/** Real React/OneGUI hosts in an isolated same-origin harness; no app accounts or API calls. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { closeTestBrowser } from "./lib/onboarding-browser-steps.mjs";
const base = process.env.ONETHU_TEST_URL ?? "http://127.0.0.1:5180";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, args: ["--disable-updater-scheduler"],
});
let checks = 0;
const errors = [];
const check = (condition, label) => { assert.ok(condition, label); checks++; console.log("✓ " + label); };
const harness = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div>
<script type="module">
import RefreshRuntime from "/@react-refresh";
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;
window.__vite_plugin_react_preamble_installed__=true;
const ReactModule=await import("/node_modules/.vite/deps/react.js");
const React=ReactModule.default ?? ReactModule;
const DOMModule=await import("/node_modules/.vite/deps/react-dom_client.js");
const DOM=DOMModule.default ?? DOMModule;
const providerSource=await (await fetch("/src/i18n/I18nProvider.tsx")).text();
const i18nUrl=providerSource.match(/from "([^"]*[/]src[/]i18n[/]index[.]ts[^"]*)"/)[1];
const i18n=await import(i18nUrl);
const {I18nProvider}=await import("/src/i18n/I18nProvider.tsx");
const confirm=await import("/src/lib/confirm.tsx");
const form=await import("/src/lib/formModal.tsx");
const toast=await import("/src/state/toast.ts");
const nav=await import("/src/state/navStack.ts");
const h=React.createElement;
window.api={i18n,confirm,form,toast,nav}; window.mountCount=0; window.answers={};
const labels=i18n.localizedList(["common.cancel","common.confirm"]);
function Probe(){
  const {locale,t}=i18n.useI18n(); const [draft,setDraft]=React.useState("");
  React.useEffect(()=>{window.mountCount++},[]);
  const notice=toast.useToastHost();
  return h("section",null,
    h("output",{id:"locale"},locale),
    h("input",{id:"draft",value:draft,onChange:e=>setDraft(e.target.value)}),
    h("span",{id:"label"},labels[0]),
    h("span",{id:"notice"},i18n.resolveMessage(notice.msg)),
    h("button",{id:"en",onClick:()=>i18n.setLocale("en-US")},"English"),
    h("button",{id:"zh",onClick:()=>i18n.setLocale("zh-CN")},"中文"),
    h("span",{id:"translated"},t("common.confirm"))
  );
}
DOM.createRoot(document.getElementById("root")).render(h(I18nProvider,null,h(Probe),h(confirm.ConfirmHost),h(form.FormModalHost)));
window.ready=true;
</script></body></html>`;
async function open(context) {
  const page = await context.newPage();
  page.on("pageerror", error => { errors.push(error.message); console.error("Harness error:", error.message); });
  await page.routeWebSocket("**/*", socket => socket.close());
  await page.route("**/__i18n_runtime_harness", route => route.fulfill({ contentType: "text/html", body: harness }));
  await page.goto(base + "/__i18n_runtime_harness");
  await page.waitForFunction(() => window.ready && document.querySelector("#locale")?.textContent);
  return page;
}
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await open(context), b = await open(context);
  await a.locator("#draft").fill("Unsent 用户草稿");
  const mounts = await a.evaluate(() => window.mountCount);
  await a.locator("#en").click();
  await b.waitForFunction(() => document.documentElement.lang === "en-US" && document.querySelector("#locale").textContent === "en-US").catch(async error => {
    console.error("locale-debug", await Promise.all([a,b].map(page=>page.evaluate(()=>({locale:window.api.i18n.getLocale(),lang:document.documentElement.lang,text:document.querySelector("#locale")?.textContent,storage:localStorage.getItem("onethu.locale"),body:document.body.innerText,modules:performance.getEntriesByType("resource").map(r=>r.name).filter(n=>n.includes("i18n/index"))}))))); throw error;
  });
  check(await b.locator("#translated").innerText() === "Confirm", "Second real document receives locale without reload");
  check(await a.locator("#draft").inputValue() === "Unsent 用户草稿" && await a.evaluate(() => window.mountCount) === mounts, "Locale subscription preserves mounted component and draft");
  check(await a.locator("#label").innerText() === "Cancel", "Module-level label array updates in a subscribed component");
  const c = await open(context);
  check(await c.locator("#locale").innerText() === "en-US", "New window restores the stored language");
  await a.evaluate(() => {
    const {i18n,confirm}=window.api;
    void confirm.confirmDanger(i18n.msg("confirm.dropCourseTitle"),{
      title:i18n.msg("confirm.dangerTitle"),confirmText:i18n.msg("confirm.dropCourseAction"),
    }).then(value=>window.answers.danger=value);
  });
  const danger = a.locator(".shared-confirm-modal");
  await danger.getByRole("button", {name:"Drop course",exact:true}).waitFor();
  await b.locator("#zh").click();
  await danger.getByRole("button", {name:"确认退选",exact:true}).waitFor();
  check((await danger.innerText()).includes("此操作不可撤销"), "Open dangerous confirmation changes language with warning intact");
  check(await danger.locator(".shared-confirm-warning").count() === 1, "Danger indication remains present");
  await danger.getByRole("button", {name:"取消",exact:true}).click();
  await a.waitForFunction(() => window.answers.danger === false);
  check(true, "Changing language does not settle the confirmation promise");
  await a.evaluate(() => {
    const {i18n,confirm}=window.api;
    void confirm.promptText(i18n.msg("prompt.input"),{placeholder:i18n.msg("common.submit"),initial:"原始名称"}).then(value=>window.answers.prompt=value);
  });
  const prompt = a.locator(".shared-prompt-modal");
  await prompt.locator("input").fill("Edited 名称");
  await b.locator("#en").click();
  await prompt.getByRole("button", {name:"Confirm",exact:true}).waitFor();
  check(await prompt.locator("input").inputValue() === "Edited 名称", "Open prompt keeps edited text across locale change");
  check(await prompt.locator("input").getAttribute("placeholder") === "Submit", "Prompt descriptor placeholder updates");
  await prompt.getByRole("button", {name:"Confirm",exact:true}).click();
  await a.waitForFunction(() => window.answers.prompt === "Edited 名称");
  check(true, "Prompt submits the original edited value");
  await a.evaluate(() => {
    const {i18n,form}=window.api;
    void form.openFormModal(i18n.msg("confirm.title"),[
      {key:"name",label:i18n.msg("prompt.input"),placeholder:i18n.msg("common.submit"),required:true},
      {key:"body",kind:"textarea",label:"User-owned raw label",default:"initial"},
      {key:"choice",kind:"select",label:i18n.msg("confirm.title"),options:[
        {value:"keep-id",label:i18n.msg("common.cancel")},{value:"other-id",label:i18n.msg("common.confirm")}
      ]},
    ]).then(value=>window.answers.form=value);
  });
  const form = a.locator(".plg-form-modal");
  await form.locator("input").fill("Kept value");
  await form.locator("textarea").fill("Kept multiline\n用户内容");
  await b.locator("#zh").click();
  await form.getByRole("button",{name:"提交",exact:true}).waitFor();
  check(await form.locator("input").inputValue() === "Kept value" && await form.locator("textarea").inputValue() === "Kept multiline\n用户内容", "Structured form preserves text and textarea drafts");
  check((await form.innerText()).includes("User-owned raw label"), "Plugin or user labels stay raw");
  check(await form.locator("input").getAttribute("placeholder") === "提交", "Structured form translates descriptor placeholders in place");
  await form.getByRole("button",{name:"提交",exact:true}).click();
  await a.waitForFunction(() => window.answers.form !== undefined);
  const result = await a.evaluate(() => window.answers.form);
  check(result.name === "Kept value" && result.body === "Kept multiline\n用户内容" && result.choice === "keep-id", "Form result retains field IDs, selected option value and drafts");
  await a.evaluate(() => window.api.toast.showToast(window.api.i18n.msg("common.submit"), 60000));
  await a.locator("#notice").filter({hasText:"提交"}).waitFor();
  await b.locator("#en").click();
  await a.locator("#notice").filter({hasText:"Submit"}).waitFor();
  check(true, "Already-open toast stores a descriptor and resolves the new locale");
  await a.evaluate(() => window.api.toast.hideToast());
  await a.evaluate(() => {
    const {confirm}=window.api;
    void confirm.confirmOk("Untranslated user message").then(value=>window.answers.raw=value);
  });
  await a.locator(".shared-confirm-modal").getByRole("button",{name:"Cancel",exact:true}).click();
  await a.waitForFunction(() => window.answers.raw === false);
  check(true, "Raw string confirmation remains supported");
  check(errors.length === 0, "No runtime or React errors: " + errors.join("; "));
} finally {
  await closeTestBrowser(browser);
}
console.log(`i18n runtime browser: ${checks} checks passed; browser cleanup completed`);
