package app.onethu.tts

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import app.tauri.Logger
import java.util.Locale

/**
 * 系统 TTS 后端：Android 自带 TextToSpeech（华为/荣耀小艺、小爱、Google TTS…），零下载零体积。
 *
 * 能力（对应「设置必须驱动真实音频效果」）：
 *  - setPitch 音高 0.5~2.0、setSpeechRate 语速 0.5~2.0、setVoice 音色（各 ROM 音色集不同，只列中文）
 *  - UtteranceProgressListener.onDone / onError → 状态机 speaking → ready，并经 TtsHub 推事件给 JS
 *
 * 三件必须处理好的事（都是真机上踩过的坑）：
 *  1) **初始化是异步的**：TextToSpeech 的 onInit 随时可能几百毫秒后才来。此期间来的朗读请求
 *     **排队**（只留最后一条，与 QUEUE_FLUSH 语义一致），onInit 成功后自动出声；若 onInit 失败
 *     或超时（[INIT_TIMEOUT_MS]，引擎进程被杀/被冻结的 ROM），回 `error:init|error:timeout` 事件，
 *     不让排队的话永远卡着。
 *  2) **线程**：构造/朗读/读音色都在主线程做（插件命令线程不是主线程，见 OnethuTtsPlugin）。
 *  3) **老回调**：QUEUE_FLUSH 会把上一句顶掉并触发它的 onStop/onError —— 用 utteranceId 过滤，
 *     否则「连着念两句」时第一句的回调会把第二句的 UI 状态误置成「念完了」。
 *
 * 局限如实记录：音质是各 ROM 合成水平（非神经网络）；没装 TTS 引擎/中文语音数据的机器
 * 会停在 state=error 并给出可操作的原因（设置页显示，引导用户去系统里装）。
 */
object SystemTts {

    private const val TAG = "OnethuTts"

    /** onInit 兜底时限：超时即判定「引擎起不来」，不留一个永远 initializing 的状态 */
    private const val INIT_TIMEOUT_MS = 8000L

    /** none | initializing | ready | speaking | error（与前端 lib/tts.ts 的 TtsState 同词表） */
    @Volatile
    var state: String = "none"
        private set

    /** 本机引擎包名（设置页显示「用的哪家引擎」）；空串 = 还没读到 */
    @Volatile
    var engineName: String = ""
        private set

    /** state=error 时给用户一句能看懂的话 */
    @Volatile
    var reason: String = ""
        private set

    /** 非致命提示（如「引擎未声明支持中文，按默认语音念」）——就绪时也可能有 */
    @Volatile
    var note: String = ""
        private set

    /** 念完/被停/出错：reason ∈ done | stopped | error:<code> | error:init | error:timeout */
    var onDone: ((String) -> Unit)? = null

    private val main = Handler(Looper.getMainLooper())

    @Volatile
    private var tts: TextToSpeech? = null
    private var ctx: Context? = null

    @Volatile
    private var started = false

    /** 当前这一句的 utteranceId（过滤被顶掉的老回调） */
    @Volatile
    private var activeId = ""

    private var pending: Pending? = null
    private var watchdog: Runnable? = null

    private data class Pending(val text: String, val speed: Float, val pitch: Float, val voice: String?)

    /** 单次朗读的受理结果：started=已出声；queued=等引擎就绪后自动出声；都不为真时 reason 是原因 */
    data class Outcome(val started: Boolean, val queued: Boolean, val reason: String?)

    fun isReady(): Boolean = state == "ready" || state == "speaking"

    /**
     * 前端问「这台机器到底行不行」。
     * 已就绪/初始化中都算行；引擎被判死 → false；尚未初始化 → 顺手触发初始化并**乐观放行**
     * （init 还没结论就说「本机不支持」，会让刚进设置页的用户看到一句错话）。
     */
    fun supported(): Boolean = when (state) {
        "ready", "speaking", "initializing" -> true
        "none" -> {
            ctx?.let { ensureInit(it) }
            true
        }
        else -> false
    }

    /** 初始化（幂等；异步 onInit 之后 state 才会到 ready / error） */
    fun ensureInit(context: Context) {
        ctx = context.applicationContext
        synchronized(this) {
            if (started) return
            started = true
            state = "initializing"
            reason = ""
            main.post { initOnMain() }
        }
    }

    /** 丢弃当前引擎实例（state=error 后用户可能在系统里刚装好引擎，重试要有意义） */
    fun reset() {
        synchronized(this) {
            cancelWatchdog()
            pending = null
            activeId = ""
            val old = tts
            tts = null
            started = false
            state = "none"
            engineName = ""
            reason = ""
            note = ""
            main.post {
                quiet { old?.stop() }
                quiet { old?.shutdown() }
            }
        }
    }

    /**
     * 朗读（**主线程调用**）。空文本由上层拒绝。
     * 引擎还在初始化 → 排队（返回 queued=true，命令照样算受理）。
     */
    fun speak(text: String, speed: Float, pitch: Float, voiceName: String?): Outcome {
        // 没有 Context 就没法初始化：再排队会永远排下去，直接给原因（正常情况下插件 init 里已给过 activity）
        val c = ctx ?: return Outcome(false, false, "插件未初始化（缺少 Context）")
        if (state == "none") ensureInit(c)
        if (state == "initializing" || state == "none") {
            pending = Pending(text, speed, pitch, voiceName)
            Logger.info(TAG, "引擎尚未就绪，本次朗读排队（${text.length} 字）")
            return Outcome(started = false, queued = true, reason = null)
        }
        val t = tts
        if (t == null || state == "error") {
            return Outcome(false, false, reason.ifBlank { "系统文字转语音引擎不可用" })
        }
        return try {
            t.setSpeechRate(speed.coerceIn(0.5f, 2.0f))
            t.setPitch(pitch.coerceIn(0.5f, 2.0f))
            if (!voiceName.isNullOrBlank()) {
                val v: Voice? = voicesOf(t).firstOrNull { it.name == voiceName }
                if (v != null) t.voice = v else Logger.warn(TAG, "找不到音色 $voiceName，用引擎当前音色")
            }
            val id = "onethu-tts-${System.currentTimeMillis()}"
            activeId = id
            val r = t.speak(text, TextToSpeech.QUEUE_FLUSH, null, id)
            if (r == TextToSpeech.SUCCESS) {
                state = "speaking"
                Outcome(true, false, null)
            } else {
                activeId = ""
                Outcome(false, false, "引擎拒绝朗读（speak 返回 $r）")
            }
        } catch (e: Exception) {
            activeId = ""
            Logger.warn(TAG, "朗读异常：$e")
            Outcome(false, false, "朗读异常：${e.message ?: e}")
        }
    }

    /** 停止（顺手取消排队的那条；只有真的在念才回 stopped 事件，避免无意义的空事件） */
    fun stop() {
        val wasActive = activeId.isNotEmpty() || state == "speaking"
        activeId = ""
        pending = null
        quiet { tts?.stop() }
        if (state == "speaking") state = "ready"
        if (wasActive) onDone?.invoke("stopped")
    }

    /** 中文音色名列表（离线音色排前面；没就绪/没引擎 = 空） */
    fun zhVoices(): List<String> {
        val t = tts ?: return emptyList()
        if (!isReady()) return emptyList()
        return try {
            voicesOf(t)
                .filter { v ->
                    val lang = v.locale?.language
                    lang?.equals("zh", true) == true || v.locale?.toLanguageTag()?.startsWith("zh") == true
                }
                .sortedWith(compareBy({ it.isNetworkConnectionRequired }, { it.name }))
                .map { it.name }
                .filter { it.isNotBlank() }
                .distinct()
        } catch (e: Exception) {
            Logger.warn(TAG, "读取音色列表失败：$e")
            emptyList()
        }
    }

    /** 引擎报的音色集合（未就绪 / 老引擎上 getVoices() 可能是 null） */
    private fun voicesOf(t: TextToSpeech): Set<Voice> {
        val v: Set<Voice>? = t.voices
        return v ?: emptySet()
    }

    // ---------- 内部 ----------

    private fun initOnMain() {
        if (tts != null && isReady()) return // 已就绪就别重建（prepare 会被反复调用）
        val c = ctx
        if (c == null) {
            state = "error"
            reason = "缺少 Context（插件未初始化）"
            failPending("error:init")
            return
        }
        try {
            tts = TextToSpeech(c) { status -> onInitDone(status) }
        } catch (e: Exception) {
            state = "error"
            reason = "系统文字转语音引擎起不来：${e.message ?: e}"
            Logger.warn(TAG, "TextToSpeech 构造失败：$e")
            failPending("error:init")
            return
        }
        val wd = Runnable {
            if (state == "initializing") {
                state = "error"
                reason = "系统文字转语音引擎初始化超时（${INIT_TIMEOUT_MS / 1000} 秒）"
                Logger.warn(TAG, "onInit 超时")
                failPending("error:timeout")
            }
        }
        watchdog = wd
        main.postDelayed(wd, INIT_TIMEOUT_MS)
    }

    private fun onInitDone(status: Int) {
        cancelWatchdog()
        if (status != TextToSpeech.SUCCESS) {
            state = "error"
            reason = "系统文字转语音引擎初始化失败（status=$status）"
            Logger.warn(TAG, "TTS 初始化失败（status=$status）")
            failPending("error:init")
            return
        }
        val t = tts
        if (t == null) {
            state = "error"
            reason = "引擎实例丢失"
            failPending("error:init")
            return
        }
        engineName = t.defaultEngine ?: ""
        note = applyChinese(t)
        t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {}

            override fun onDone(utteranceId: String?) {
                if (isStale(utteranceId)) return
                activeId = ""
                if (state == "speaking") state = "ready"
                onDone?.invoke("done")
            }

            /** API 21 之前的回调（API 24+ 走下面带 errorCode 的那个），编译器要求覆写 */
            @Deprecated("API 21 之前的回调，仍要覆写")
            @Suppress("OVERRIDE_DEPRECATION")
            override fun onError(utteranceId: String?) {
                finishError(utteranceId, "error")
            }

            override fun onError(utteranceId: String?, errorCode: Int) {
                finishError(utteranceId, "error:$errorCode")
            }

            override fun onStop(utteranceId: String?, interrupted: Boolean) {
                // 手动 stop() 已在 stop() 里回过事件；这里只收拾「被新的一句顶掉」的残留状态，
                // 不回事件（否则连念两句时第一句的残留会把第二句的 UI 误判成已结束）。
                if (isStale(utteranceId)) return
                activeId = ""
                if (state == "speaking") state = "ready"
            }
        })
        state = "ready"
        val voice = try {
            t.voice?.name
        } catch (_: Exception) {
            null
        }
        Logger.info(TAG, "系统 TTS 就绪（engine=$engineName, voice=$voice）$note")
        flushPending()
    }

    /** 设置中文；引擎没有中文数据时如实记 note（不判死——很多 ROM 仍能用默认语音念中文） */
    private fun applyChinese(t: TextToSpeech): String = try {
        val r = t.setLanguage(Locale.SIMPLIFIED_CHINESE)
        if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
            val r2 = t.setLanguage(Locale.CHINA)
            if (r2 == TextToSpeech.LANG_MISSING_DATA || r2 == TextToSpeech.LANG_NOT_SUPPORTED) {
                "本机引擎未声明支持中文，按引擎默认语音朗读"
            } else ""
        } else ""
    } catch (e: Exception) {
        "设置中文语音失败：${e.message ?: e}"
    }

    private fun flushPending() {
        val p = pending ?: return
        pending = null
        val r = speak(p.text, p.speed, p.pitch, p.voice)
        if (!r.started && !r.queued) {
            Logger.warn(TAG, "排队的话没能出声：${r.reason}")
            onDone?.invoke("error:init")
        }
    }

    private fun failPending(code: String) {
        if (pending == null) return
        pending = null
        onDone?.invoke(code)
    }

    private fun isStale(utteranceId: String?): Boolean =
        utteranceId != null && utteranceId != activeId

    private fun finishError(utteranceId: String?, code: String) {
        if (isStale(utteranceId)) return
        activeId = ""
        if (state == "speaking") state = "ready"
        Logger.warn(TAG, "TTS 出错：$code")
        onDone?.invoke(code)
    }

    private fun cancelWatchdog() {
        watchdog?.let { main.removeCallbacks(it) }
        watchdog = null
    }

    private inline fun quiet(block: () -> Unit) {
        try {
            block()
        } catch (_: Exception) {
        }
    }
}
