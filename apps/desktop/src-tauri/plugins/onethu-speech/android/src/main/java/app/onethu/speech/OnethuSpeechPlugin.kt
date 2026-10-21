// OneTHU 灵动岛语音输入插件（Android）
//
// 会话式长按模型（与 macOS speech.m 同契约）：
// speechStart（麦克风运行时权限 → SpeechRecognizer 启动）→ speechPoll
// （部分转写实时读取）→ speechStop（收最终文本）；speechLevel 供 UI 画音量波纹
// （onRmsChanged 归一化到 0..1）。
//
// 细节：
// - zh-CN + EXTRA_PARTIAL_RESULTS，onPartialResults 持续覆盖当前文本；
// - 识别器因静音超时/无匹配自行结束时保留已识别文本（松手仍能拿到）；
// - 仍在按住期间识别器提前收尾（ERROR_SPEECH_TIMEOUT 等）→ 自动重启一轮，
//   让长按期间可以停顿换气再继续说；
// - 权限被拒 → reject 带原因（JS 侧雾白遮罩上展示）。

package app.onethu.speech

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat
import app.tauri.Logger
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

private const val TAG = "OnethuSpeech"

@TauriPlugin(
  permissions = [
    Permission(
      strings = [Manifest.permission.RECORD_AUDIO],
      alias = "mic",
    ),
  ],
)
class OnethuSpeechPlugin(private val activity: android.app.Activity) : Plugin(activity) {

  @Volatile
  private var text: String = ""

  private var sr: SpeechRecognizer? = null
  /** 用户仍按住（会话期）：识别器意外收尾时自动续一轮 */
  @Volatile
  private var holding: Boolean = false

  /** 输入电平 0..1（onRmsChanged 归一化写入）：JS 每 ~90ms 取一次驱动灵动岛波纹点 */
  @Volatile
  private var level: Float = 0f

  private fun hasMic(): Boolean =
    ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED

  // ---------- 命令 ----------

  @Command
  fun speechSupported(invoke: Invoke) {
    val ok = SpeechRecognizer.isRecognitionAvailable(activity)
    invoke.resolve(JSObject().put("value", ok))
  }

  @Command
  fun speechStart(invoke: Invoke) {
    if (!hasMic()) {
      requestPermissionForAliases(arrayOf("mic"), invoke, "micPermissionCallback")
      return
    }
    activity.runOnUiThread { startListening() } // SpeechRecognizer 必须主线程
    invoke.resolve()
  }

  @PermissionCallback
  fun micPermissionCallback(invoke: Invoke) {
    if (!hasMic()) {
      invoke.reject("无麦克风权限（系统设置 → 应用 → OneTHU → 麦克风）")
      return
    }
    activity.runOnUiThread { startListening() }
    invoke.resolve()
  }

  @Command
  fun speechPoll(invoke: Invoke) {
    invoke.resolve(JSObject().put("text", text))
  }

  /** 当前输入电平 0..1；未在识别/尚无回声一律 0（前端据此退化为时间正弦） */
  @Command
  fun speechLevel(invoke: Invoke) {
    invoke.resolve(JSObject().put("level", level.toDouble()))
  }

  @Command
  fun speechStop(invoke: Invoke) {
    holding = false
    level = 0f // 松手即回落：波纹点收束
    try {
      sr?.stopListening() // 触发 onResults（最终文本）
    } catch (e: Exception) {
      Logger.warn(TAG, "stopListening: $e")
    }
    invoke.resolve()
  }

  // （tauri Plugin 基类无 destroy 生命周期钩：识别器清理在 speechStop 内完成，
  //  Activity 重建最多泄漏一个实例，与 onethu-calendar 同取舍）

  // ---------- 识别会话 ----------

  /**
   * onRmsChanged 的 rmsdB 量纲各家不一（AOSP/Google 常见 -2..10，个别厂商给 0..1）：
   * 统一按 -2..10 线性映射到 0..1 并夹紧；NaN/Inf/负值一律归零（静默）。
   * 这里只保证「有限且单调的 0..1」——平滑与无电平时的正弦兜底在前端做。
   */
  private fun normalizeRms(rmsdB: Float): Float {
    if (rmsdB.isNaN() || rmsdB.isInfinite()) return 0f
    return ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
  }

  private fun startListening() {
    holding = true
    text = ""
    level = 0f
    try {
      sr?.destroy()
    } catch (_: Exception) {
    }
    sr = SpeechRecognizer.createSpeechRecognizer(activity).also { recognizer ->
      recognizer.setRecognitionListener(object : RecognitionListener {
        override fun onPartialResults(partialResults: Bundle?) {
          partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let {
            text = it
          }
        }

        override fun onResults(results: Bundle?) {
          results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let {
            text = it
          }
        }

        override fun onError(error: Int) {
          Logger.warn(TAG, "recognition error $error (text=${text.length} chars)")
          // 还在按住且没识别到东西 → 重启一轮（用户可能停顿换气超过静音窗）
          if (holding && text.isEmpty() && error != SpeechRecognizer.ERROR_CLIENT) {
            restart()
          }
        }

        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {
          level = normalizeRms(rmsdB)
        }
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {
          level = 0f
        }
        override fun onEvent(eventType: Int, params: Bundle?) {}
      })
      recognizer.startListening(
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
          putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
          putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN")
          putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
          putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        },
      )
    }
  }

  private fun restart() {
    activity.runOnUiThread {
      if (!holding) return@runOnUiThread
      try {
        sr?.destroy()
      } catch (_: Exception) {
      }
      sr = null
      startListening()
    }
  }

}
