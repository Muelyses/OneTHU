/** Compile the production Rust interpolation and execute its HTML in isolated browsers. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium, webkit } from "playwright";

const source = readFileSync("apps/desktop/src-tauri/src/lib.rs", "utf8");
const start = source.indexOf("let token_json = serde_json::to_string(jwt)");
const end = source.indexOf("let bytes = script.as_bytes();", start);
assert.ok(start > 0 && end > start, "Production venue script has explicit JSON serialization");
const interpolation = source.slice(start, end);
const payloads = [
  "fixture.jwt.value",
  'quote";globalThis.__venueProof=1;//',
  "</script><script>globalThis.__venueProof=1</script>",
  "</ScRiPt><img src=x onerror=globalThis.__venueProof=1>",
  'backslash\\quote"line\nreturn\r\u2028\u2029',
  "<!--<script>double escape</script>-->",
  "中文 & < > ' \"",
  "",
];
const temp = mkdtempSync(join(tmpdir(), "onethu-venue-script-"));
const out = process.env.ONETHU_TEST_OUT ?? "/tmp/onethu-venue-script";
mkdirSync(out, { recursive: true });
const report = { passed: false, checks: [], boundary: "Actual extracted Rust interpolation + Chromium/WebKit HTML parser. Synthetic token strings only; all network blocked." };
const check = (value, label) => { assert.ok(value, label); report.checks.push(label); };
try {
  mkdirSync(join(temp, "src"));
  writeFileSync(join(temp, "Cargo.toml"), '[package]\nname="onethu-venue-script-fixture"\nversion="0.0.0"\nedition="2021"\n[dependencies]\nserde_json="1"\n');
  writeFileSync(join(temp, "src/main.rs"), `fn main() {
    let input: Vec<String> = serde_json::from_reader(std::io::stdin()).unwrap();
    let scripts: Vec<String> = input.iter().map(|jwt| { ${interpolation} script }).collect();
    println!("{}", serde_json::to_string(&scripts).unwrap());
  }`);
  const compiled = spawnSync("cargo", ["run", "--quiet", "--offline", "--manifest-path", join(temp, "Cargo.toml")], {
    input: JSON.stringify(payloads), encoding: "utf8", timeout: 120000,
    env: { ...process.env, CARGO_TARGET_DIR: join(temp, "target") },
  });
  assert.equal(compiled.status, 0, "Actual Rust template compiles: " + compiled.stderr);
  const scripts = JSON.parse(compiled.stdout);
  check(scripts.length === payloads.length, "All synthetic tokens processed by the production Rust template");
  for (const engine of ["chromium", "webkit"]) {
    const browser = await (engine === "webkit" ? webkit : chromium).launch({
      headless: true,
      ...(engine === "chromium" ? { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" } : {}),
    });
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => route.request().isNavigationRequest()
        ? route.fulfill({ contentType: "text/html", body: page.__document })
        : route.abort());
      for (let index = 0; index < scripts.length; index++) {
        page.__document = '<!doctype html><html><head><meta charset="utf-8">' + scripts[index] + "</head><body>Venue fixture</body></html>";
        await page.goto("http://venue.test/" + index);
        const state = await page.evaluate(() => ({
          token: JSON.parse(localStorage.getItem("token")),
          headers: JSON.parse(JSON.parse(localStorage.getItem("headers"))),
          refresh: JSON.parse(localStorage.getItem("refreshToken")),
          proof: globalThis.__venueProof ?? 0,
          scripts: document.scripts.length,
          injectedImage: document.querySelectorAll("img").length,
        }));
        check(state.proof === 0 && state.scripts === 1 && state.injectedImage === 0, `${engine} payload ${index}: token cannot create executable HTML or JS`);
        check(state.token === payloads[index] && state.headers.token === payloads[index] && state.refresh === "", `${engine} payload ${index}: exact token storage contract retained`);
      }
      check(errors.length === 0, engine + ": no parse or runtime errors");
    } finally { await browser.close(); }
  }
  report.passed = true;
  console.log(`Venue inline script: ${report.checks.length} checks passed.`);
} catch (error) {
  report.failure = String(error);
  throw error;
} finally {
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  rmSync(temp, { recursive: true, force: true });
}
