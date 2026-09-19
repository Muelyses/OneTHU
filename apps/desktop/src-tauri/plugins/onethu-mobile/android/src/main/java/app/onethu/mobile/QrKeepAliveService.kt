// OneTHU 扫码保活前台服务（Android，R18c）
//
// 目标：扫码面板打开期间（二维码就绪 → 成功 / 取消 / 过期）以**前台服务 +
// 常驻通知**把 OneTHU 进程提到 PROC_FOREGROUND 优先级，避免切到微信扫码时被
// MIUI/HyperOS 冻结、掐断雨课堂长轮询（R17b 已让连接被掐后可恢复，但退后台
// 进程/网络被限制时确认仍可能丢失）。
//
// 约束：
// - 仅 dataSync 类型（扫码约 5 分钟，远低于 Android 14 每日累计限额）；
// - 通知渠道「扫码保活」，点击回到 App（launch intent，不依赖具体 Activity 类）；
// - onStartCommand 幂等：重复 start 只是再次 startForeground，安全；
// - 停止走 stopService（插件命令 stopQrKeepAlive），onDestroy 清 running 标记。

package app.onethu.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class QrKeepAliveService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            ensureChannel()
            val notification = buildNotification()
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            running = true
        } catch (e: Exception) {
            // 前台服务启动失败（如 ROM 限制）：静默退出，前端会收到 ok:false 并降级提示
            running = false
            stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        running = false
        super.onDestroy()
    }

    /** API 26+ 通知渠道「扫码保活」；重复调用安全。 */
    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) return
        val mgr = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(CHANNEL_ID, "扫码保活", NotificationManager.IMPORTANCE_LOW).apply {
            description = "扫码期间保持 OneTHU 运行，避免被系统冻结"
            setShowBadge(false)
        }
        mgr.createNotificationChannel(channel)
    }

    /** 常驻通知：点击回到 App（用 launch intent，避免依赖 app 模块的 MainActivity 类）。 */
    private fun buildNotification(): Notification {
        val icon = applicationInfo.icon.takeIf { it != 0 } ?: android.R.drawable.ic_dialog_info
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(icon)
            .setContentTitle("OneTHU 正在等待雨课堂扫码")
            .setContentText("切到微信扫码后回到 OneTHU；扫码期间请勿清理本通知")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
        packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
            builder.setContentIntent(PendingIntent.getActivity(this, 0, launch, flags))
        }
        return builder.build()
    }

    companion object {
        const val CHANNEL_ID = "onethu_qr_keepalive"
        const val NOTIFICATION_ID = 4711

        /** 前台服务是否在跑（插件命令据此做幂等短路）。 */
        @Volatile
        var running: Boolean = false
            private set
    }
}
