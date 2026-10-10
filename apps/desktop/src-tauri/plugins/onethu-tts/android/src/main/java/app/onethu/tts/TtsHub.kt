package app.onethu.tts

import android.content.Context
import app.tauri.Logger

/**
 * TTS 门面：把「用哪个后端」这件事收在一处，并把 SystemTts 的回调汇成一条出口。
 *
 * 本期（wave 1）只有 **system** 后端（Android 自带 TextToSpeech，零下载零体积）。
 * `neural`（神经档，归档里的 sherpa-onnx vits-melo，要下 ~160MB 模型）保留字段但**明确拒绝**：
 * setBackend("neural") 返回一句人话而不是假装切过去了——设置页据此不摆这个选项，
 * 真接了神经档时只需要在 [speak] 里加一个分支，前端与命令面都不用动。
 *
 * 后端选择持久化在 SharedPreferences（`onethu_tts/tts_backend`）：历史版本或手工写过的
 * 非 system 值在加载时就纠正回 system（否则会卡在一个本机用不了的档位上）。
 */
object TtsHub {

    const val BACKEND_SYSTEM = "system"
    const val BACKEND_NEURAL = "neural"

    private const val TAG = "OnethuTts"
    private const val PREFS = "onethu_tts"
    private const val KEY_BACKEND = "tts_backend"

    @Volatile
    var backend: String = BACKEND_SYSTEM
        private set

    /** 统一出口：SystemTts 的念完/出错 → OnethuTtsPlugin → `onethu-tts://done` 事件 */
    var onDone: ((String) -> Unit)? = null

    /** 插件实例化时调用一次（挂事件、加载后端、开始初始化） */
    fun ensureInit(context: Context) {
        loadBackend(context)
        SystemTts.onDone = { r -> onDone?.invoke(r) }
        SystemTts.ensureInit(context)
    }

    /** 初始化 / 重试（error 后先 reset，用户可能刚在系统里装好了引擎） */
    fun prepare(context: Context) {
        if (SystemTts.state == "error") SystemTts.reset()
        SystemTts.ensureInit(context)
    }

    /** 切换后端；返回 null = 成功，否则是给用户看的原因 */
    fun setBackend(context: Context, b: String): String? {
        if (b == BACKEND_NEURAL) {
            return "神经档（neural）本期未实现，请使用系统引擎"
        }
        if (b != BACKEND_SYSTEM) {
            return "未知后端：$b"
        }
        backend = b
        try {
            context.applicationContext
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_BACKEND, b)
                .apply()
        } catch (e: Exception) {
            Logger.warn(TAG, "后端偏好写盘失败：$e")
        }
        SystemTts.ensureInit(context)
        return null
    }

    fun isReady(): Boolean = SystemTts.isReady()

    /** 当前状态词（none/initializing/ready/speaking/error），直接回给前端 */
    fun state(): String = SystemTts.state

    fun speak(text: String, speed: Float, pitch: Float, voiceName: String?): SystemTts.Outcome =
        SystemTts.speak(text, speed, pitch, voiceName)

    fun stop() = SystemTts.stop()

    fun voices(): List<String> = SystemTts.zhVoices()

    /** 历史值自愈：只认 system，其余一律回落并覆盖写回 */
    private fun loadBackend(context: Context) {
        val stored = try {
            context.applicationContext
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_BACKEND, BACKEND_SYSTEM)
        } catch (e: Exception) {
            Logger.warn(TAG, "读取后端偏好失败：$e")
            BACKEND_SYSTEM
        }
        backend = BACKEND_SYSTEM
        if (stored != null && stored != BACKEND_SYSTEM) {
            Logger.info(TAG, "TTS 后端偏好 $stored 本期不可用，已回落 $BACKEND_SYSTEM")
            try {
                context.applicationContext
                    .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString(KEY_BACKEND, BACKEND_SYSTEM)
                    .apply()
            } catch (_: Exception) {
            }
        }
    }
}
