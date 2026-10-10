// OneTHU 悬浮球前台服务：悬浮窗的宿主与保活主体。（task-11 返工版）
//
// 前台服务类型为什么是 specialUse（不是 dataSync）：
//   Android 14+ 每种 FGS 类型有额度限制，本仓库曾因 dataSync 超限崩溃。
//   specialUse 无每日额度，适合「用户主动开启、长期可见」的常驻悬浮层，
//   并在 Manifest 里用 PROPERTY_SPECIAL_USE_FGS_SUBTYPE 申报用途。
//   microphone 类型只为「悬浮层里长按说话」保留：仅当 RECORD_AUDIO 已授予、
//   且是在应用仍处前台时加上，后台取麦才被系统放行；加类型失败时回滚，绝不让服务崩。
//
// 本应用在前台时：球/面板/条全部隐藏（用户要求「本体内部不需要出现悬浮球」），
// 由 AppForeground（ActivityLifecycleCallbacks）通知过来，服务转发给窗口层。
//
// 被杀后的恢复入口（三条，都以「用户开着且没点过本次关闭」为闸门）：
//   ① START_STICKY：系统重建服务 → onStartCommand(null) → 恢复成球；
//   ② 自救闹钟：onDestroy/onTaskRemoved 里排 15~20s 后一条广播（ACTION_RESTART）；
//   ③ 开机 / 应用升级：OverlayBootReceiver 收 BOOT_COMPLETED / MY_PACKAGE_REPLACED。
//   ⚠️ Android 15+ 移除了「持有 SYSTEM_ALERT_WINDOW 即可后台启动 FGS」的豁免，
//      ②在 Android 16 上可能被拒（已 try/catch，不循环重排）。
//
// 红线：本服务不启动任何 Activity、不把 OneTHU 主窗口拉到前台。通知点击只切形态。

package app.onethu.overlay

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

class OverlayService : Service() {

    private var windows: OverlayWindows? = null
    private val main = Handler(Looper.getMainLooper())
    private var micTyped = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        live = this
        windows = OverlayWindows(this, object : OverlayWindows.Host {
            override fun onCloseRequested() {
                closeEverywhere()
            }

            override fun onSubmitText(text: String) {
                // 语音整句与键盘输入都从这里出去（task-11 ④：同一条发送通道）
                OverlayEvents.emit("submit", 0, 0, text)
            }

            override fun onVoiceStart() {
                ensureMicType()
            }

            override fun onVoiceEnd() {
                dropMicType()
            }
        })
        // 本体前台态：前台时全部隐藏，离开本应用再只出球
        AppForeground.onChange = { fg ->
            main.post {
                windows?.setSuspended(fg)
                updateNotification()
            }
        }
        AppForeground.register(application)
        windows?.setSuspended(AppForeground.isForeground)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: ACTION_START
        if (action == ACTION_CLOSE) {
            closeEverywhere()
            return START_NOT_STICKY
        }
        if (!startForegroundCompat(notifTypes())) {
            running = false
            stopSelf()
            return START_NOT_STICKY
        }
        running = true
        if (action == ACTION_START) {
            // 应用仍在前台时的启动：麦克风权限已给就顺手把 microphone 类型拿到手，
            // 这样切到别的应用后长按说话才有机会取到麦（后台再加会被系统拒）。
            ensureMicTypeIfGranted()
        }
        when (action) {
            ACTION_TOGGLE -> {
                // 通知点击只切形态（红线：绝不拉起 OneTHU 本体）；本体在前台时它没意义
                if (!AppForeground.isForeground) {
                    val w = windows
                    w?.setMode(if (w.mode() == "panel") "ball" else "panel")
                }
            }
            ACTION_MODE -> {
                val m = intent?.getStringExtra(EXTRA_MODE) ?: "ball"
                windows?.setMode(m)
            }
            else -> {
                // 恢复默认：**只出球**（task-11 ③）
                val m = intent?.getStringExtra(EXTRA_MODE)
                if (m == "panel" || m == "bar") windows?.setMode(m) else windows?.showBallOnly()
                updateNotification()
            }
        }
        return START_STICKY
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        windows?.onUiModeChanged()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        if (OverlayPrefs.shouldAutoRestore(this)) scheduleSelfRescue(this, 15_000L)
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        running = false
        live = null
        AppForeground.onChange = null
        windows?.destroy()
        windows = null
        if (OverlayPrefs.shouldAutoRestore(this)) {
            scheduleSelfRescue(this, 20_000L)
        }
        super.onDestroy()
    }

    /** 面板上的「本次关闭悬浮球」与通知「本次关闭」都走这里（需求 5 的本次关闭语义） */
    private fun closeEverywhere() {
        OverlayPrefs.setEnabled(this, false)
        OverlayPrefs.setClosedByUser(this, true)
        windows?.hide()
        OverlayEvents.emit("closed", 0, 0)
        try {
            @Suppress("DEPRECATION")
            stopForeground(true)
        } catch (_: Throwable) {
            /* 已不在前台 */
        }
        stopSelf()
    }

    /* ────────────────────── 前端推来的界面状态 ────────────────────── */

    /** overlay_push_ui 落到这里：渲染消息（本机语音不再依赖它，故不再由此调 FGS 类型） */
    fun postUi(stateJson: String) {
        main.post { windows?.pushUi(stateJson) }
    }

    fun currentMode(): String = if (windowShowing()) windows?.mode() ?: "hidden" else "hidden"

    private fun windowShowing(): Boolean = windows?.isShowing() == true

    /* ────────────────────── 前台服务 / 麦克风类型 ────────────────────── */

    private fun hasMic(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    private fun ensureMicTypeIfGranted() {
        if (hasMic()) setMicType(true)
    }

    /** 说话开始：尝试把 microphone 类型加到前台服务上 */
    private fun ensureMicType() {
        if (!hasMic()) return
        setMicType(true)
    }

    private fun dropMicType() {
        setMicType(false)
    }

    private fun setMicType(on: Boolean) {
        if (on == micTyped) return
        if (on && !hasMic()) return
        micTyped = on
        if (!startForegroundCompat(notifTypes())) {
            // 回滚：Android 14+/15+ 在后台加 while-in-use 类型会抛，保持原类型继续跑
            micTyped = !on
            startForegroundCompat(notifTypes())
            Log.w(TAG, "mic 类型切换被拒（后台限制？），已回滚")
        }
    }

    private fun notifTypes(): Int {
        var t = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        if (micTyped) t = t or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        return t
    }

    private fun startForegroundCompat(types: Int): Boolean {
        return try {
            ensureChannel()
            val n = buildNotification()
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, n, types)
            } else {
                startForeground(NOTIFICATION_ID, n)
            }
            true
        } catch (e: Throwable) {
            Log.w(TAG, "startForeground 失败（ROM 限制？）：${e.message}")
            false
        }
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) return
        val mgr = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
        val ch = NotificationChannel(CHANNEL_ID, "悬浮球", NotificationManager.IMPORTANCE_LOW).apply {
            description = "保持 OneTHU 悬浮球浮在其他应用上层；关掉本通知不会关闭悬浮球"
            setShowBadge(false)
            setSound(null, null)
        }
        mgr.createNotificationChannel(ch)
    }

    /** 常驻通知：点按只切换形态（绝不拉起 OneTHU 本体），另给一个「本次关闭」动作 */
    private fun buildNotification(): Notification {
        val icon = applicationInfo.icon.takeIf { it != 0 } ?: android.R.drawable.ic_dialog_info
        val body = if (AppForeground.isForeground) {
            "回到桌面或其他应用即可看到球"
        } else {
            "点按切换对话面板；长按球说话"
        }
        val b = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(icon)
            .setContentTitle("OneTHU 悬浮球已开启")
            .setContentText(body)
            .setOngoing(true)
            .setShowWhen(false)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
        b.setContentIntent(PendingIntent.getService(this, REQ_TOGGLE, intent(ACTION_TOGGLE), flags))
        b.addAction(0, "本次关闭", PendingIntent.getService(this, REQ_CLOSE, intent(ACTION_CLOSE), flags))
        return b.build()
    }

    private fun intent(action: String): Intent =
        Intent(this, OverlayService::class.java).setAction(action)

    private fun updateNotification() {
        try {
            val mgr = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            mgr.notify(NOTIFICATION_ID, buildNotification())
        } catch (_: Throwable) {
            /* 通知权限被拒：服务照跑 */
        }
    }

    companion object {
        const val TAG = "OnethuOverlay"
        const val CHANNEL_ID = "onethu_overlay"
        const val NOTIFICATION_ID = 4712
        const val REQ_TOGGLE = 47120
        const val REQ_CLOSE = 47121
        const val REQ_RESCUE = 47122

        const val ACTION_START = "app.onethu.overlay.START"
        const val ACTION_MODE = "app.onethu.overlay.MODE"
        const val ACTION_TOGGLE = "app.onethu.overlay.TOGGLE"
        const val ACTION_CLOSE = "app.onethu.overlay.CLOSE"
        const val ACTION_RESTART = "app.onethu.overlay.RESTART"
        const val EXTRA_MODE = "mode"

        /** 前台服务是否在跑（插件命令据此做幂等短路）；live 用于同进程直推界面状态 */
        @Volatile
        var running: Boolean = false
            private set

        @Volatile
        private var live: OverlayService? = null

        fun currentModeOrNull(): String? = live?.currentMode()

        /** 显示悬浮层（只出球）。应用在前台时也不会显示——由 AppForeground 开关 */
        fun start(ctx: Context, mode: String) {
            val i = Intent(ctx, OverlayService::class.java)
                .setAction(ACTION_START)
                .putExtra(EXTRA_MODE, mode)
            ContextCompat.startForegroundService(ctx, i)
        }

        /** 形态切换等轻命令：服务在跑就直接投递，没跑且用户开着才拉起（避免后台启动异常） */
        fun command(ctx: Context, action: String, mode: String? = null) {
            try {
                if (running) {
                    ctx.startService(
                        Intent(ctx, OverlayService::class.java).setAction(action).apply {
                            if (mode != null) putExtra(EXTRA_MODE, mode)
                        },
                    )
                } else if (OverlayPrefs.shouldAutoRestore(ctx)) {
                    val i = Intent(ctx, OverlayService::class.java).setAction(action)
                    if (mode != null) i.putExtra(EXTRA_MODE, mode)
                    ContextCompat.startForegroundService(ctx, i)
                }
            } catch (e: Throwable) {
                Log.w(TAG, "命令投递失败：${e.message}")
            }
        }

        /** 同进程直推界面状态（不经过 Intent，避免高频电平更新打爆 binder） */
        fun pushUi(json: String) {
            live?.postUi(json)
        }

        fun isLive(): Boolean = live != null

        fun stop(ctx: Context) {
            try {
                ctx.stopService(Intent(ctx, OverlayService::class.java))
            } catch (_: Throwable) {
                /* 本来就没跑 */
            }
        }

        /** 自救闹钟：不额外申请精确闹钟权限，晚一点也比永远不回来好 */
        fun scheduleSelfRescue(ctx: Context, delayMs: Long) {
            try {
                val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                    (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
                val pi = PendingIntent.getBroadcast(
                    ctx,
                    REQ_RESCUE,
                    Intent(ctx, OverlayBootReceiver::class.java).setAction(ACTION_RESTART),
                    flags,
                )
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + delayMs, pi)
            } catch (e: Throwable) {
                Log.w(TAG, "自救闹钟排程失败：${e.message}")
            }
        }
    }
}
