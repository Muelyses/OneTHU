// OneTHU 悬浮球：恢复入口。
//
// 收三类广播：
//   BOOT_COMPLETED / MY_PACKAGE_REPLACED —— 开机与升级后按持久化开关自动恢复；
//   app.onethu.overlay.RESTART（自排闹钟）—— 服务被 ROM 杀掉后的自救重试。
// 一律先问 OverlayPrefs.shouldAutoRestore：用户点过「本次关闭悬浮球」就永不自动弹回
// （需求 5：重新开启必须回本体 OH 对话界面点开）。
//
// 后台启动前台服务在 Android 12+ 有限制：这里全程 try/catch，失败就当没发生
// （用户下次打开应用时 overlay_show 会补上）。

package app.onethu.overlay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class OverlayBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED &&
            action != OverlayService.ACTION_RESTART
        ) {
            return
        }
        if (!OverlayPrefs.shouldAutoRestore(context)) return
        try {
            // 一律只出球：不沿用上次形态（上次停在面板时不能一恢复就是半屏雾）
            OverlayPrefs.setMode(context, "ball")
            OverlayService.start(context, "ball")
        } catch (e: Throwable) {
            Log.w(OverlayService.TAG, "自动恢复悬浮球失败（后台启动限制？）：${e.message}")
        }
    }
}
