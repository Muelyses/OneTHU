// OneTHU 语音合成插件（Android）：TTS 命令面 + 事件桥。
//
// 命令（与 Rust src/commands.rs 一一对应；Kotlin 方法名就是 run_mobile_plugin 的第一参）：
//   ttsSupported / ttsPrepare / ttsSpeak / ttsStop / ttsStatus / ttsVoices / ttsSetBackend
// 事件（Tauri trigger → JS listen）：
//   onethu-tts://done { reason }   reason ∈ done | stopped | error:<code> | error:init | error:timeout
//
// 两个刻意的取舍：
//  - **不需要任何运行时权限**，所以没有 @TauriPlugin(permissions=[...]) 也没有权限回调
//    （麦克风是 STT 的事）。Android 11+ 的 TTS 引擎包可见性靠 AndroidManifest 的 <queries>。
//  - **不定义 @InvokeArg 参数类**：参数就用 invoke.getArgs().optString/optDouble 现读，
//    少一层 R8（release 下 "no Creators" 的经典坑就是参数类没标 @InvokeArg）。
package app.onethu.tts

import app.tauri.Logger
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray

private const val TAG = "OnethuTts"

@TauriPlugin
class OnethuTtsPlugin(private val activity: android.app.Activity) : Plugin(activity) {

    init {
        // 事件桥：引擎真源（SystemTts）→ Tauri 事件 → JS。实例化即挂钩，早于 WebView 加载。
        TtsHub.onDone = { reason ->
            val payload = JSObject()
            payload.put("reason", reason)
            trigger("onethu-tts://done", payload)
        }
        TtsHub.ensureInit(activity)
    }

    /**
     * 插件命令线程不是主线程（PluginManager 由 JNI 调进来），而 TextToSpeech 的构造、朗读、
     * 音色读取都要在主线程做（与 onethu-speech 的 SpeechRecognizer 同理）——统一 post 到
     * 主线程执行，并在主线程 resolve/reject（权限回调也是这么做的）。
     */
    private fun onUi(invoke: Invoke, block: () -> Unit) {
        activity.runOnUiThread {
            try {
                block()
            } catch (e: Exception) {
                Logger.warn(TAG, "${invoke.command} 异常：$e")
                invoke.reject(e.message ?: e.toString())
            }
        }
    }

    // ---------- 命令 ----------

    @Command
    fun ttsSupported(invoke: Invoke) {
        invoke.resolve(JSObject().put("value", SystemTts.supported()))
    }

    /** 初始化引擎（返回 ≠ 就绪：onInit 异步，前端 ttsPrepare 会轮询 status 到有结论） */
    @Command
    fun ttsPrepare(invoke: Invoke) {
        onUi(invoke) {
            TtsHub.prepare(activity)
            invoke.resolve()
        }
    }

    /** 朗读：{text, speed, pitch, voice}；speed/pitch 由前端按偏好传入（Kotlin 再收 0.5~2.0） */
    @Command
    fun ttsSpeak(invoke: Invoke) {
        val args = invoke.getArgs()
        val text = args.optString("text", "")
        val speed = args.optDouble("speed", 1.0).toFloat()
        val pitch = args.optDouble("pitch", 1.0).toFloat()
        val voice = args.optString("voice", "")
        if (text.isBlank()) {
            invoke.reject("空文本")
            return
        }
        onUi(invoke) {
            val outcome = TtsHub.speak(text, speed, pitch, voice.ifBlank { null })
            when {
                // queued 也算受理：引擎初始化完成后会自动出声（失败/超时经事件回告）
                outcome.started || outcome.queued -> invoke.resolve()
                else -> invoke.reject(outcome.reason ?: "朗读未开始")
            }
        }
    }

    @Command
    fun ttsStop(invoke: Invoke) {
        onUi(invoke) {
            TtsHub.stop()
            invoke.resolve()
        }
    }

    /** 引擎状态：{ready, backend, state, engine, reason, note}（前三个是契约字段，后三个是补充说明） */
    @Command
    fun ttsStatus(invoke: Invoke) {
        val obj = JSObject()
        obj.put("ready", TtsHub.isReady())
        obj.put("backend", TtsHub.backend)
        obj.put("state", TtsHub.state())
        obj.put("engine", SystemTts.engineName)
        obj.put("reason", SystemTts.reason)
        obj.put("note", SystemTts.note)
        invoke.resolve(obj)
    }

    /** 中文音色名列表（引擎没就绪/没引擎 = 空数组，前端据此禁用下拉） */
    @Command
    fun ttsVoices(invoke: Invoke) {
        onUi(invoke) {
            val arr = JSONArray()
            TtsHub.voices().forEach { arr.put(it) }
            invoke.resolve(JSObject().put("voices", arr))
        }
    }

    /** 切换后端：system 成功；neural 明确拒绝（本期未实现） */
    @Command
    fun ttsSetBackend(invoke: Invoke) {
        val b = invoke.getArgs().optString("backend", TtsHub.BACKEND_SYSTEM)
        val err = TtsHub.setBackend(activity, b)
        if (err == null) invoke.resolve() else invoke.reject(err)
    }
}
