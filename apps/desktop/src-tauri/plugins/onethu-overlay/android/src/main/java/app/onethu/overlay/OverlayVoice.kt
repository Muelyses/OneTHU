// OneTHU 悬浮层：本进程内的语音输入（task-11 ④）。
//
// 设计要点：
//   - **自己进程里的 SpeechRecognizer**（不经过 onethu-speech 插件，避免两条 STT 抢麦：
//     原生条不再回传 hold/release 给前端，前端也就不会去起它自己的识别器）；
//   - 能力探测三段：
//       ① RECORD_AUDIO 是否已授予；
//       ② SpeechRecognizer.isRecognitionAvailable()；
//       ③ 运行时探针——开听后 2.5s 内 rms 始终没动静或直接报音频类错误
//          ⇒ 判定「此环境取不到麦克风」（荣耀/华为是「仅前台麦克风」，后台会被静默）；
//   - 取不到时**绝不静默**：回调 onUnavailable(reason)，由窗口在条里显示
//     「此环境取不到麦克风，点开面板用键盘输入」并自动展开面板；
//   - 拿到最终结果回 onFinal(text)；空文本（没听清）也回调 onFinal("")，由窗口决定提示。

package app.onethu.overlay

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import androidx.core.content.ContextCompat
import java.util.Locale

class OverlayVoice(private val ctx: Context, private val host: Host) {

    interface Host {
        /** 开始取麦：服务据此把 microphone 类型加到前台服务（后台加会被系统拒，服务里回滚兜底） */
        fun onVoiceStart()

        /** 结束取麦：服务摘掉 microphone 类型 */
        fun onVoiceEnd()

        fun onPartial(text: String)

        /** 0..1 输入电平，驱动点点波纹 */
        fun onLevel(level: Float)

        /** 整句结果（可能为空串 = 没听清） */
        fun onFinal(text: String)

        /** 环境取不到麦克风（reason 直接给用户看） */
        fun onUnavailable(reason: String)
    }

    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var listening = false
    private var finishing = false
    private var sawAudio = false
    private var partial = ""
    private var failureSent = false

    private val silenceProbe = Runnable {
        if (!listening || finishing) return@Runnable
        if (!sawAudio) {
            Log.i(OverlayService.TAG, "[VOICE] 2.5s 无电平 → 判定取不到麦克风")
            teardown()
            reportUnavailable(UNAVAILABLE_ROM)
        }
    }

    private val finalGrace = Runnable {
        if (!finishing) return@Runnable
        val text = partial.trim()
        teardown()
        host.onFinal(text)
    }

    /** 能力探测（同步部分）；返回 null = 看起来可用，非 null = 直接给用户看的原因 */
    fun probe(): String? {
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return "还没给 OneTHU 麦克风权限，点开面板用键盘输入"
        }
        if (!SpeechRecognizer.isRecognitionAvailable(ctx)) {
            return "此设备没有系统语音识别服务，点开面板用键盘输入"
        }
        return null
    }

    fun start() {
        val bad = probe()
        if (bad != null) {
            reportUnavailable(bad)
            return
        }
        try {
            host.onVoiceStart()
            failureSent = false
            sawAudio = false
            partial = ""
            finishing = false
            val rec = SpeechRecognizer.createSpeechRecognizer(ctx)
            recognizer = rec
            rec.setRecognitionListener(listener)
            rec.startListening(recognizeIntent())
            listening = true
            main.postDelayed(silenceProbe, SILENCE_MS)
        } catch (e: Throwable) {
            teardown()
            reportUnavailable("启动语音识别失败：${e.message ?: "未知原因"}")
        }
    }

    /** 松手：停止收音，等最终结果（700ms 内没等到就用已有部分转写兜底）。 */
    fun finish() {
        if (recognizer == null) {
            host.onFinal("")
            return
        }
        finishing = true
        main.removeCallbacks(silenceProbe)
        try {
            recognizer?.stopListening()
        } catch (_: Throwable) {
            /* 已经停了 */
        }
        main.postDelayed(finalGrace, FINAL_GRACE_MS)
    }

    /** 上划取消：不发任何内容 */
    fun cancel() {
        finishing = false
        main.removeCallbacks(finalGrace)
        teardown()
    }

    fun destroy() {
        main.removeCallbacks(silenceProbe)
        main.removeCallbacks(finalGrace)
        teardown()
    }

    private fun teardown() {
        listening = false
        finishing = false
        main.removeCallbacks(silenceProbe)
        main.removeCallbacks(finalGrace)
        val rec = recognizer
        recognizer = null
        try {
            rec?.stopListening()
            rec?.destroy()
        } catch (_: Throwable) {
            /* 销毁失败无所谓 */
        }
        host.onVoiceEnd()
    }

    private fun reportUnavailable(reason: String) {
        if (failureSent) return
        failureSent = true
        try {
            host.onUnavailable(reason)
        } catch (_: Throwable) {
            /* 忽略 */
        }
    }

    private fun recognizeIntent(): Intent =
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, ctx.packageName)
        }

    private fun firstText(bundle: Bundle?): String {
        val arr = try {
            bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
        } catch (_: Throwable) {
            null
        }
        if (arr == null || arr.isEmpty()) return ""
        return arr[0]?.trim().orEmpty()
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}

        override fun onBeginningOfSpeech() {
            sawAudio = true
        }

        override fun onRmsChanged(rmsdB: Float) {
            if (rmsdB > 1.5f) sawAudio = true
            val lv = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
            try {
                host.onLevel(lv)
            } catch (_: Throwable) {
                /* 忽略 */
            }
        }

        override fun onBufferReceived(buffer: ByteArray?) {}

        override fun onEndOfSpeech() {}

        override fun onError(error: Int) {
            val micIssue = error == SpeechRecognizer.ERROR_AUDIO ||
                error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ||
                error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY
            if (finishing && !micIssue) {
                // 松手后的收尾错误：用已有部分转写兜底
                val text = partial.trim()
                teardown()
                if (text.isEmpty() && !sawAudio) {
                    reportUnavailable(UNAVAILABLE_ROM)
                } else {
                    host.onFinal(text)
                }
                return
            }
            val hadText = partial.trim().isNotEmpty()
            teardown()
            if (micIssue && !hadText) {
                reportUnavailable(UNAVAILABLE_ROM)
            } else if (finishing) {
                host.onFinal(partial.trim())
            } else {
                reportUnavailable(errorHint(error))
            }
        }

        override fun onResults(results: Bundle?) {
            val text = firstText(results)
            val finalText = if (text.isNotEmpty()) text else partial.trim()
            teardown()
            host.onFinal(finalText)
        }

        override fun onPartialResults(partialResults: Bundle?) {
            val t = firstText(partialResults)
            if (t.isEmpty()) return
            partial = t
            sawAudio = true
            try {
                host.onPartial(t)
            } catch (_: Throwable) {
                /* 忽略 */
            }
        }

        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    private fun errorHint(error: Int): String = when (error) {
        SpeechRecognizer.ERROR_NO_MATCH,
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
        -> "没听清，再说一次"
        SpeechRecognizer.ERROR_NETWORK,
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
        -> "识别服务网络不可用，点开面板用键盘输入"
        else -> "语音识别失败（$error），点开面板用键盘输入"
    }

    companion object {
        const val SILENCE_MS = 2_500L
        const val FINAL_GRACE_MS = 700L

        /** 荣耀/华为「仅前台麦克风」：别的应用在前台时取麦会被系统静默 */
        const val UNAVAILABLE_ROM = "此环境取不到麦克风，点开面板用键盘输入"
    }
}
