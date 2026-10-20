/** Offline compile of the actual widget renderer against the Android SDK, plus JVM execution
 * of the actual template helper and widgetPush body with in-memory native storage adapters.
 * No launcher/device/account writes. Configure GRADLE_USER_HOME, ANDROID_HOME and JAVA_HOME as needed. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'onethu-widget-kotlin-'));
const source = 'apps/desktop/src-tauri/plugins/onethu-mobile/android/src/main/java/app/onethu/mobile/';
const cache = process.env.GRADLE_USER_HOME || (fs.existsSync('/Volumes/OneTHUBuild/gradle-home') ? '/Volumes/OneTHUBuild/gradle-home' : path.join(os.homedir(), '.gradle'));
const sdk = process.env.ANDROID_HOME || '/Volumes/OneTHUBuild/oh-android-sdk';
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/java') : '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home/bin/java';
function jar(group, artifact, version) {
  const dir = path.join(cache, 'caches/modules-2/files-2.1', group, artifact, version);
  for (const hash of fs.readdirSync(dir)) for (const name of fs.readdirSync(path.join(dir, hash))) if (name.endsWith('.jar')) return path.join(dir, hash, name);
  throw new Error('Missing cached Kotlin dependency: ' + dir);
}
const stdlib = jar('org.jetbrains.kotlin', 'kotlin-stdlib', '1.9.25');
const annotations = jar('org.jetbrains', 'annotations', '13.0');
const compiler = [jar('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', '1.9.25'), stdlib, annotations, jar('org.jetbrains.kotlin', 'kotlin-script-runtime', '1.9.25'), jar('org.jetbrains.kotlin', 'kotlin-reflect', '1.6.10'), jar('org.jetbrains.intellij.deps', 'trove4j', '1.0.20200330')].join(path.delimiter);
const compile = (files, output, extra = []) => execFileSync(java, ['-cp', compiler, 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-jvm-target', '1.8', '-classpath', [stdlib, annotations, ...extra].join(path.delimiter), '-d', output, ...files], { stdio: 'inherit', timeout: 120000 });
const kt = fs.readFileSync(source + 'OnethuWidget.kt', 'utf8');
const resources = {};
for (const match of kt.matchAll(/R\.(\w+)\.(\w+)/g)) (resources[match[1]] ??= new Set()).add(match[2]);
fs.writeFileSync(path.join(temp, 'CompileStubs.kt'), `package app.onethu.mobile\nobject R {\n${Object.entries(resources).map(([group, names]) => `object ${group} { ${[...names].map((name, i) => `const val ${name} = ${i + 1}`).join('; ')} }`).join('\n')}\n}\nobject OnethuNotifyReceiver { fun canExact(ctx: android.content.Context) = false }\nobject LaunchTarget { fun put(ctx: android.content.Context, target: String) {} }\n`);
compile([source + 'OnethuWidget.kt', source + 'WidgetText.kt', path.join(temp, 'CompileStubs.kt')], path.join(temp, 'widget.jar'), [path.join(sdk, 'platforms/android-36/android.jar')]);
console.log('✓ Actual OnethuWidget + WidgetText compile against Android API 36 (resource IDs and unrelated notification permission helper stubbed)');
const plugin = fs.readFileSync(source + 'OnethuMobilePlugin.kt', 'utf8');
const start = plugin.indexOf('    @Command\n    fun widgetPush(');
const end = plugin.indexOf('\n    /** 桌面上每一块', start);
if (start < 0 || end < 0) throw new Error('Cannot isolate actual widgetPush command');
const push = plugin.slice(start, end);
const legacy = JSON.parse(fs.readFileSync('apps/desktop/src-tauri/plugins/onethu-mobile/android/src/main/assets/onethu-widget-zh.json', 'utf8'));
const kotlin = value => JSON.stringify(value).replaceAll('$', '\\$');
const legacyMap = 'mapOf(' + Object.entries(legacy).map(([key, value]) => `${kotlin(key)} to ${kotlin(value)}`).join(',\n') + ')';
const lookup = kt.match(/val content = if \(slot == null\)[^\n]+/)[0];
const test = `package app.onethu.mobile
annotation class Command
class Context
class Activity { val applicationContext = Context(); fun runOnUiThread(action: () -> Unit) = action() }
open class JSONObject() {
  val entries = mutableMapOf<String, Any>()
  constructor(raw: String) : this() { entries.putAll(registry.getValue(raw).entries) }
  fun put(key: String, value: Any): JSONObject { entries[key] = value; return this }
  fun opt(key: String) = entries[key]
  fun keys() = entries.keys.iterator()
  fun optJSONObject(key: String) = entries[key] as? JSONObject
  fun getJSONObject(key: String) = entries[key] as JSONObject
  fun optString(key: String) = entries[key] as? String ?: ""
  fun optBoolean(key: String, fallback: Boolean) = entries[key] as? Boolean ?: fallback
  override fun toString(): String { val key = "json:" + registry.size; registry[key] = this; return key }
  companion object { val registry = mutableMapOf<String, JSONObject>() }
}
class JSObject : JSONObject()
class WidgetPushArgs(val snapshot: String)
class Invoke(val root: JSONObject) {
  var result: JSONObject? = null
  @Suppress("UNCHECKED_CAST") fun <T> parseArgs(type: Class<T>): T = WidgetPushArgs(root.toString()) as T
  fun resolve(value: JSONObject) { result = value }
}
object WidgetStore {
  val instances = mutableMapOf<Int, String>(); var slots = ""; var prunes = 0
  fun saveInstance(ctx: Context, id: Int, raw: String) { instances[id] = raw }
  fun loadInstance(ctx: Context, id: Int): JSONObject? = instances[id]?.let { JSONObject(it) }
  fun saveSlots(ctx: Context, raw: String) { slots = raw }
  fun pruneInstances(ctx: Context, live: Set<Int>) { prunes++; instances.keys.retainAll(live) }
}
object OnethuBaseWidget { fun refreshAll(ctx: Context) {} }
class Plugin { val activity = Activity()
${push}
}
fun selectContent(snap: JSONObject?, slot: String?, widgetId: Int): JSONObject? {
 val ctx = Context()
 ${lookup}
 return content
}
fun main() {
 var checks = 0
 fun verify(ok: Boolean, label: String) { check(ok) { label }; checks++; println("✓ " + label) }
 val legacy = ${legacyMap}
 val en = legacy + mapOf("title" to "Today {month}/{day}", "hours.one" to "{count} hour left", "hours.other" to "{count} hours left", "eventRow" to "Event {title}")
 var requestedLocale = ""
 val language = WidgetText("en-US", en, legacy) { locale, n -> requestedLocale = locale; if (n == 1L) "one" else "other" }
 verify(language.left(3600000) == "1 hour left", "English singular template executes in real Kotlin")
 verify(language.left(7200000) == "2 hours left", "English plural template executes in real Kotlin")
 verify(requestedLocale == "en-US", "Plural resolver receives saved locale, not OS/global language")
 verify(language.text("title", mapOf("month" to 10, "day" to 20)) == "Today 10/20", "Named date template executes in Kotlin")
 verify(language.text("eventRow", mapOf("title" to "{count} <b>Original</b>")) == "Event {count} <b>Original</b>", "Kotlin substitution is literal, never recursive")
 verify(WidgetText("", emptyMap(), legacy) { _, _ -> "other" }.left(3600000) == legacy.getValue("hours.other").replace("{count}", "1"), "Legacy snapshot falls back to generated Chinese")
 verify(WidgetText("en-US", mapOf("hours.other" to "remaining {count}"), legacy) { _, _ -> "one" }.left(3600000) == "remaining 1", "Partial dictionary uses its own other template")
 verify(WidgetText("ar", mapOf("hours.two" to "two-hours"), legacy) { _, _ -> "two" }.left(7200000) == "two-hours", "Additional CLDR categories pass through without source changes")
 val plugin = Plugin()
 val content = JSONObject().put("title", "original user title")
 val slotMap = JSONObject().put("1", content)
 WidgetStore.instances[8] = content.toString()
 val root = JSONObject().put("locale", "en-US").put("widgetText", JSONObject().put("today", "Today")).put("slots", slotMap).put("instances", JSONObject().put("7", content)).put("prune", false)
 val invoke = Invoke(root); plugin.widgetPush(invoke)
 verify(invoke.result?.optBoolean("ok", false) == true && WidgetStore.instances.keys == setOf(7, 8), "Actual widgetPush preserves previous instances when prune=false")
 val stored = JSONObject(WidgetStore.slots)
 verify(stored.optString("locale") == "en-US" && stored.optJSONObject("widgetText")?.optString("today") == "Today", "Actual widgetPush persists the small locale dictionary for placeholders")
 verify(selectContent(stored, "1", 0)?.optString("title") == "original user title", "Actual renderer lookup finds wrapped new slots")
 verify(selectContent(slotMap, "1", 0)?.optString("title") == "original user title", "Actual renderer lookup retains legacy bare slot maps")
 plugin.widgetPush(Invoke(JSONObject().put("slots", slotMap).put("prune", true)))
 verify(WidgetStore.instances.keys == setOf(7, 8), "Missing instance enumeration never prunes even with a true flag")
 root.put("prune", true); plugin.widgetPush(Invoke(root))
 verify(WidgetStore.instances.keys == setOf(7), "Explicit successful enumeration still prunes removed instances")
 println("widget native Kotlin: " + checks + " checks passed")
}
`;
fs.writeFileSync(path.join(temp, 'WidgetTest.kt'), test);
compile([source + 'WidgetText.kt', path.join(temp, 'WidgetTest.kt')], path.join(temp, 'test.jar'));
execFileSync(java, ['-cp', [path.join(temp, 'test.jar'), stdlib].join(path.delimiter), 'app.onethu.mobile.WidgetTestKt'], { stdio: 'inherit', timeout: 30000 });
console.log('Temporary compiler outputs: ' + temp);
