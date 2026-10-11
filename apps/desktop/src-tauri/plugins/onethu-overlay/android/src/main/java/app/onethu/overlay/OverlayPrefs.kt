// OneTHU 悬浮层：原生侧持久化（SharedPreferences）。
//
// 与前端 lib/overlay.ts 的 isOverlayClosedByUser / setOverlayClosedByUser 语义对齐：
//   前端那份在 localStorage（应用内可见、随 webview 数据存亡）；
//   这里这份在原生（进程被 ROM 杀掉 / 开机自启时仍要知道「是否该恢复」）。
// 两份通过两条命令同步：
//   overlay_show（用户在本体 OH 对话界面点「打开悬浮球」）→ enabled=true, closedByUser=false
//   overlay_hide（本次关闭悬浮球 / 通知动作）            → enabled=false, closedByUser=true
// 原生自发关闭（通知「本次关闭」、面板上的按钮）会同时 emit "closed" 事件，
// 前端 GlobalOrb 收到即 setOverlayClosedByUser(true) —— 两边不会各说各话。
object OverlayPrefs {
    private const val FILE = "onethu_overlay"
    private const val K_ENABLED = "enabled"
    private const val K_CLOSED = "closed_by_user"
    private const val K_X = "ball_x"
    private const val K_Y = "ball_y"
    private const val K_SW = "ball_screen_w"
    private const val K_SH = "ball_screen_h"
    private const val K_FMT = "ball_fmt"

    /** 球位置存档格式：0/1 = 只有 x/y（坐标系可能已经变过，一律作废）；2 = 带屏幕尺寸 */
    const val BALL_FMT = 2
    private const val K_MODE = "mode"

    private fun sp(ctx: android.content.Context) =
        ctx.applicationContext.getSharedPreferences(FILE, android.content.Context.MODE_PRIVATE)

    /** 用户是否开启了悬浮球（点过「打开悬浮球」且没点「本次关闭」） */
    fun enabled(ctx: android.content.Context) = sp(ctx).getBoolean(K_ENABLED, false)

    fun setEnabled(ctx: android.content.Context, v: Boolean) {
        sp(ctx).edit().putBoolean(K_ENABLED, v).apply()
    }

    /** 「本次已关闭」：被 ROM 杀掉后**不要**自动弹回来（需求 5 的本次关闭语义） */
    fun closedByUser(ctx: android.content.Context) = sp(ctx).getBoolean(K_CLOSED, false)

    fun setClosedByUser(ctx: android.content.Context, v: Boolean) {
        sp(ctx).edit().putBoolean(K_CLOSED, v).apply()
    }

    /** 上次的球位置（Int.MIN_VALUE = 没存过，按默认右上位置起） */
    fun ballX(ctx: android.content.Context) = sp(ctx).getInt(K_X, Int.MIN_VALUE)

    fun ballY(ctx: android.content.Context) = sp(ctx).getInt(K_Y, Int.MIN_VALUE)

    /**
     * 存球位置。**必须带上当时的屏幕尺寸**：坐标是物理 px，跨「换机 / 分辨率变化 / 旧格式存档」
     * 单独存 x/y 毫无意义（真机实录：旧存档把球钉在屏幕左边缘）。
     */
    fun setBall(ctx: android.content.Context, x: Int, y: Int, screenW: Int, screenH: Int) {
        sp(ctx).edit()
            .putInt(K_X, x)
            .putInt(K_Y, y)
            .putInt(K_SW, screenW)
            .putInt(K_SH, screenH)
            .putInt(K_FMT, BALL_FMT)
            .apply()
    }

    fun ballFormat(ctx: android.content.Context) = sp(ctx).getInt(K_FMT, 0)

    fun ballScreenW(ctx: android.content.Context) = sp(ctx).getInt(K_SW, 0)

    fun ballScreenH(ctx: android.content.Context) = sp(ctx).getInt(K_SH, 0)

    fun mode(ctx: android.content.Context) = sp(ctx).getString(K_MODE, "ball") ?: "ball"

    fun setMode(ctx: android.content.Context, m: String) {
        sp(ctx).edit().putString(K_MODE, m).apply()
    }

    /** 是否应当自动恢复（被 ROM 杀 / 开机）：开了，且用户没点过本次关闭 */
    fun shouldAutoRestore(ctx: android.content.Context) =
        enabled(ctx) && !closedByUser(ctx)
}
