// OneTHU 悬浮层：本应用前台态（自算，不依赖被 Android 10+ 限制的 getRunningAppProcesses、
// 也不需要 UsageStats 的特殊授权）。
//
// 为什么需要它：用户明确要求「本体内部不需要出现悬浮球」——OneTHU 自己在前台时，
// 悬浮球/面板/条都必须隐藏（应用内已有 OH 悬浮岛），离开本应用再出现。
// 判定方式：注册 ActivityLifecycleCallbacks，用「已 started 的 Activity 数」计数。
//
// 线程：生命周期回调都在主线程；onChange 由服务注册，窗口挂/摘都走它。

package app.onethu.overlay

import android.app.Activity
import android.app.Application
import android.os.Bundle

object AppForeground {
    @Volatile
    var isForeground: Boolean = false
        private set

    /** 前台态变化回调（服务注册） */
    @Volatile
    var onChange: ((Boolean) -> Unit)? = null

    private var startedCount = 0
    private var registered = false

    /** 当前 Activity 的弱引用（moveTaskToBack / 权限请求 / 选择器结果都要它） */
    private var current: java.lang.ref.WeakReference<Activity>? = null

    /** 取当前 Activity（可能为 null：进程里还没有 Activity 活着） */
    fun activity(): Activity? = current?.get()

    fun register(app: Application) {
        if (registered) return
        registered = true
        try {
            app.registerActivityLifecycleCallbacks(
                object : Application.ActivityLifecycleCallbacks {
                    override fun onActivityStarted(activity: Activity) {
                        current = java.lang.ref.WeakReference(activity)
                        startedCount++
                        if (startedCount == 1) publish(true)
                    }

                    override fun onActivityStopped(activity: Activity) {
                        if (startedCount > 0) startedCount--
                        if (startedCount == 0) publish(false)
                    }

                    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}

                    override fun onActivityResumed(activity: Activity) {
                        current = java.lang.ref.WeakReference(activity)
                    }

                    override fun onActivityPaused(activity: Activity) {}

                    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}

                    override fun onActivityDestroyed(activity: Activity) {}
                },
            )
        } catch (_: Throwable) {
            /* 注册失败：恒按「不在前台」处理（宁可多显示球，也不要本体里冒球——
               这里反过来：失败时 isForeground 保留 false = 显示球，与旧行为一致） */
        }
    }

    private fun publish(fg: Boolean) {
        if (isForeground == fg) return
        isForeground = fg
        try {
            onChange?.invoke(fg)
        } catch (_: Throwable) {
            /* 回调异常不影响生命周期分发 */
        }
    }
}
