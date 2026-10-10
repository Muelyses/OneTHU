// OneTHU 悬浮球前台服务：悬浮窗的宿主与保活主体。
//
// 前台服务类型为什么是 specialUse（不是 dataSync）：
//   Android 14+ 每种 FGS 类型有额度限制，本仓库曾因 dataSync 超限崩溃。
//   specialUse 无每日额度，适合「用户主动开启、长期可见」的常驻悬浮层，
//   并在 Manifest 里用 PROPERTY_SPECIAL_USE_FGS_SUBTYPE 申报用途。
//   microphone 类型只为「悬浮层里长按说话」保留：仅当 RECORD_AUDIO 已授予、
//   且服务是在应用仍处前台时启动的，后台取麦才被系统放行；加类型失败时回滚，
//   绝不让它把整个服务带崩（Android 14 后台不允许加 while-in-use 类型）。
//
// 被杀后的恢复入口（三条，都不需要用户手动点）：
//   ① START_STICKY：系统重建服务 → onStartCommand 收到 null intent → 按持久化开关恢复；
//   ② 自救闹钟：onDestroy/onTaskRemoved 里排 20s 后一条广播（ACTION_RESTART）；
//   ③ 开机 / 应用升级：OverlayBootReceiver 收 BOOT_COMPLETED / MY_PACKAGE_REPLACED。
//   三条都只在「用户开着且没点过本次关闭」时生效（OverlayPrefs.shouldAutoRestore）。
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
                // 面板输入框 → 前端（GlobalOrb 收到 submit 后走 askOh）
                OverlayEvents.emit("submit", 0, 0, text)
            }
        })
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: ACTION_START
        if (action == ACTION_CLOSE) {
            // 通知「本次关闭」：服务可能已不存在，这里最多是重复关闭，幂等
            closeEverywhere()
            return START_NOT_STICKY
        }
        if (!startForegroundCompat(notifTypes())) {
            running = false
            stopSelf()
            return START_NOT_STICKY
        }
        running = true
        // 应用仍在前台时的启动：如果麦克风权限已给，就顺手把 microphone 类型拿到手，
        // 这样切到别的应用后长按说话才有机会取到麦（后台再加类型会被系统拒）。
        if (action == ACTION_START) {
            maybeAddMicType()
        }
        when (action) {
            ACTION_TOGGLE -> {
                val w = windows
                val next = if (w != null && w.mode() == "panel") "ball" else "panel"
                w?.setMode(next)
                updateNotification()
            }
            ACTION_MODE -> {
                val m = intent?.getStringExtra(EXTRA_MODE) ?: "ball"
                windows?.setMode(m)
                updateNotification()
            }
            else -> {
                val stored = intent?.getStringExtra(EXTRA_MODE) ?: OverlayPrefs.mode(this)
                val mode = if (stored == "panel" || stored == "bar") stored else "ball"
                val dark = intent?.getBooleanExtra(EXTRA_DARK, false) ?: false
                windows?.show(mode, dark)
                updateNotification()
            }
        }
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // 用户划掉最近任务：服务不停（stopWithTask=false），但顺手排一条自救广播
        if (OverlayPrefs.shouldAutoRestore(this)) scheduleSelfRescue(this, 15_000L)
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        running = false
        live = null
        windows?.destroy()
        windows = null
        if (OverlayPrefs.shouldAutoRestore(this)) {
            // 被 ROM 杀掉 / 服务被停但用户没关：20s 后自救一次（幂等，不循环重排）
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

    /** overlay_push_ui 落到这里：渲染 + 按 listening 调整前台服务类型 */
    fun postUi(stateJson: String) {
        main.post {
            windows?.pushUi(stateJson)
            val listening = try {
                org.json.JSONObject(stateJson).optBoolean("listening", false)
            } catch (_: Throwable) {
                false
            }
            setMicType(listening)
        }
    }

    fun currentMode(): String = windows?.mode() ?: "hidden"

    /** 正在说话 → 尝试把 microphone 类型加到前台服务上；结束 → 摘掉 */
    private fun setMicType(on: Boolean) {
        if (on == micTyped) return
        if (on) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) !=
                PackageManager.PERMISSION_GRANTED
            ) {
                return
            }
            micTyped = true
        } else {
            micTyped = false
        }
        if (!startForegroundCompat(notifTypes())) {
            // 回滚：Android 14 在后台加 while-in-use 类型会抛，保持原类型继续跑
            micTyped = !micTyped
            startForegroundCompat(notifTypes())
        }
    }

    private fun maybeAddMicType() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            setMicType(true)
        }
    }

    /* ────────────────────── 前台服务 / 通知 ────────────────────── */

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
        val b = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(icon)
            .setContentTitle("OneTHU 悬浮球已开启")
            .setContentText("点按切换对话面板；长按悬浮球说话")
            .setOngoing(true)
            .setShowWhen(false)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
        // 点通知 = 悬浮层内切换球/面板（不进应用）
        b.setContentIntent(
            PendingIntent.getService(this, REQ_TOGGLE, intent(ACTION_TOGGLE), flags),
        )
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
        const val EXTRA_DARK = "dark"

        /** 前台服务是否在跑（插件命令据此做幂等短路）；live 同时用于同进程直推界面状态 */
        @Volatile
        var running: Boolean = false
            private set

        @Volatile
        private var live: OverlayService? = null

        fun currentModeOrNull(): String? = live?.currentMode()

        /** 显示悬浮球（应用在前台时调；缺权限时插件已提前挡掉） */
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
                    ctx.startService(Intent(ctx, OverlayService::class.java).setAction(action).apply {
                        if (mode != null) putExtra(EXTRA_MODE, mode)
                    })
                } else if (OverlayPrefs.shouldAutoRestore(ctx)) {
                    val i = Intent(ctx, OverlayService::class.java).setAction(action)
                    if (mode != null) i.putExtra(EXTRA_MODE, mode)
                    ContextCompat.startForegroundService(ctx, i)
                }
            } catch (e: Throwable) {
                Log.w(TAG, "命令投递失败：${e.message}")
            }
        }

        /** 同进程直推界面状态（不经过 Intent，避免 180ms 一次的电平更新打爆 binder） */
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
