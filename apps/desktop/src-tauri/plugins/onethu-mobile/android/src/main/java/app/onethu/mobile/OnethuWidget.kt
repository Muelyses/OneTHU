// Android 桌面小组件（AppWidgetProvider）。
//
// 架构是「JS 算、原生画」：小组件进程里既没有 WebView 也没有会话（凭据是 WebCrypto 加密后
// 存在 localStorage 的，原生拿不到明文），因此任何需要网络或解析的逻辑都不可能在小组件里
// 跑。App 在前台刷新数据后把一份渲染好的快照推到 SharedPreferences，小组件只负责把快照
// 摆到 RemoteViews 上；用户点小组件 → 广播记下落点 → 打开 App 重算并回写快照。
//
// 快照 JSON（JS 侧 lib/widgetBridge.ts 生成，字段变更需同步两端）：
//   { "title": "今日", "updatedAt": 1758…, "target": "today",
//     "rows": [{ "text": "10:00 数据结构", "sub": "六教6A215" }, …],
//     "footer": "3 节课 · 2 个截止" }

package app.onethu.mobile

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

/** 快照存储：SharedPreferences 单键 JSON（体积小、读写同步、崩溃不丢）。 */
object WidgetStore {
    private const val PREFS = "onethu_widget"
    private const val KEY_SNAPSHOT = "snapshot"

    fun save(ctx: Context, json: String) {
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_SNAPSHOT, json).apply()
    }

    fun load(ctx: Context): JSONObject? {
        val raw = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_SNAPSHOT, null) ?: return null
        return try {
            JSONObject(raw)
        } catch (e: Exception) {
            null   // 坏快照当作没有：小组件显示占位文案，不崩
        }
    }

    fun clear(ctx: Context) {
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove(KEY_SNAPSHOT).apply()
    }
}

/** 点击落点广播（小组件与通知共用）：PendingIntent 里跑不了代码，
 *  故先把落点写进 LaunchTarget 再拉起 App，App 起来后取走并导航。 */
class OnethuLaunchReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val target = intent.getStringExtra(EXTRA_TARGET) ?: ""
        if (target.isNotEmpty()) LaunchTarget.put(context, target)
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            try {
                context.startActivity(launch)
            } catch (e: Exception) {
                // 拉起失败（ROM 限制）：静默——用户自己点图标也能开，不能因此崩小组件
            }
        }
    }

    companion object {
        const val EXTRA_TARGET = "onethu_widget_target"
    }
}

/**
 * 小组件渲染基类：宿主小组件与插件槽位小组件共用同一套布局与快照读取。
 *
 * 槽位小组件（slotKey 非空）读快照的 `slots["<槽位>"]`——内容由 JS 侧的插件声明解析而来；
 * 槽位无内容时显示引导文案（而不是空白卡片），并指向插件页让用户去看是哪个插件。
 *
 * 为什么是固定槽位而不是每个插件一个 provider：Android 不允许运行时注册 provider，
 * 清单里声明几个就只能有几个。故宿主预留 3 个槽位，插件按声明顺序占位。
 */
abstract class OnethuBaseWidget : AppWidgetProvider() {
    /** 槽位键 "1".."3"；null = 宿主小组件（读快照根字段） */
    abstract fun slotKey(): String?

    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        for (id in appWidgetIds) render(context, manager, id)
    }

    /** 用户拖动改尺寸时立刻按新尺寸重排（不重排会留着一屏错位） */
    override fun onAppWidgetOptionsChanged(
        context: Context,
        manager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: android.os.Bundle,
    ) {
        render(context, manager, appWidgetId)
    }

    companion object {
        private const val ROW_IDS = 3

        /**
         * 全部 provider（宿主四种形态 + 三个插件槽位）；新增形态时只改这一处与清单。
         *
         * 为什么宿主有四种形态：`targetCellWidth/Height` 是**每个 provider 一份**的静态元信息，
         * 选择器里能直接选的形态数 = provider 数。只声明一个 3×2 的话，想要一条 2×1 长条的用户
         * 得先放上再拖动改尺寸——多一步且不直观。四种形态共用同一套布局与同一份快照，
         * 只是初始占位不同（放置后照样能自由拖动）。
         */
        private val PROVIDERS = listOf(
            OnethuWidgetProvider::class.java,   // 标准 3×2
            OnethuWidgetSquare::class.java,     // 方块 2×2
            OnethuWidgetNarrow::class.java,     // 窄条 2×1
            OnethuWidgetStrip::class.java,      // 长条 4×1
            OnethuWidgetSlot1::class.java,
            OnethuWidgetSlot2::class.java,
            OnethuWidgetSlot3::class.java,
        )

        /** 槽位键 / provider 类 / 诊断名（诊断与刷新共用；槽位键 null = 宿主小组件） */
        fun providerEntries(): List<Triple<String?, Class<*>, String>> = listOf(
            Triple(null, OnethuWidgetProvider::class.java, "宿主 3×2"),
            Triple(null, OnethuWidgetSquare::class.java, "宿主 2×2"),
            Triple(null, OnethuWidgetNarrow::class.java, "宿主 2×1"),
            Triple(null, OnethuWidgetStrip::class.java, "宿主 4×1"),
            Triple("1", OnethuWidgetSlot1::class.java, "槽位 1"),
            Triple("2", OnethuWidgetSlot2::class.java, "槽位 2"),
            Triple("3", OnethuWidgetSlot3::class.java, "槽位 3"),
        )

        /** App 前台刷新快照后调用：让所有已放置的小组件立刻重画（不等系统 30 分钟轮询） */
        fun refreshAll(ctx: Context) {
            val manager = AppWidgetManager.getInstance(ctx) ?: return
            for (cls in PROVIDERS) {
                val ids = manager.getAppWidgetIds(ComponentName(ctx, cls))
                for (widgetId in ids) renderFor(ctx, manager, widgetId, slotKeyOf(cls))
            }
        }

        private fun slotKeyOf(cls: Class<*>): String? = when (cls) {
            OnethuWidgetSlot1::class.java -> "1"
            OnethuWidgetSlot2::class.java -> "2"
            OnethuWidgetSlot3::class.java -> "3"
            else -> null
        }

        /**
         * 按小组件当前占位决定显示几行——**同一套布局靠可见性自适应**，不额外声明多套 layout：
         *   · 2×1（矮条）  → 标题 + 1 行，无脚注
         *   · 2×2          → 标题 + 2 行 + 脚注
         *   · 3×2 及以上   → 标题 + 3 行 + 脚注
         * 尺寸取自 AppWidgetOptions 的 MIN_HEIGHT（dp），系统在拖动与旋转时都会更新。
         */
        private fun rowBudget(manager: AppWidgetManager, widgetId: Int): Int {
            val opts = try {
                manager.getAppWidgetOptions(widgetId)
            } catch (e: Exception) {
                null
            }
            val h = opts?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0) ?: 0
            return when {
                h <= 0 -> 3        // 拿不到尺寸（老系统/首次）→ 按默认 3 行渲染
                h < 90 -> 1        // 2×1
                h < 150 -> 2       // 2×2
                else -> 3          // 3×2 及以上
            }
        }

        /** 矮条的紧凑内边距：12dp 的留白在 2×1（约 40dp 高）里会把内容挤出可视区 */
        private fun applyCompactPadding(ctx: Context, views: RemoteViews, compact: Boolean) {
            val d = ctx.resources.displayMetrics.density
            val px = { v: Int -> (v * d).toInt() }
            if (compact) views.setViewPadding(R.id.onethu_widget_root, px(8), px(6), px(8), px(6))
            else views.setViewPadding(R.id.onethu_widget_root, px(12), px(12), px(12), px(12))
        }

        private fun renderFor(ctx: Context, manager: AppWidgetManager, widgetId: Int, slot: String?) {
            val maxRows = rowBudget(manager, widgetId)
            val views = RemoteViews(ctx.packageName, R.layout.onethu_widget)
            val snap = WidgetStore.load(ctx)
            val content = if (slot == null) snap else snap?.optJSONObject("slots")?.optJSONObject(slot)

            if (content == null) {
                // 未绑定 / 尚无快照：给一条可读的引导，不留空白（标题保留：槽位小组件要说明是第几个）
                applyCompactPadding(ctx, views, maxRows == 1)
                views.setTextViewText(
                    R.id.onethu_widget_title,
                    if (slot == null) "OneTHU" else "OneTHU 插件小组件 $slot",
                )
                views.setTextViewText(
                    R.id.onethu_widget_row1,
                    if (slot == null) "打开 OneTHU 刷新数据" else "尚无插件占用此槽位",
                )
                views.setViewVisibility(R.id.onethu_widget_row1, View.VISIBLE)
                views.setViewVisibility(R.id.onethu_widget_row2, View.GONE)
                views.setViewVisibility(R.id.onethu_widget_row3, View.GONE)
                views.setViewVisibility(R.id.onethu_widget_footer, View.GONE)
                views.setOnClickPendingIntent(
                    R.id.onethu_widget_root,
                    clickPending(ctx, if (slot == null) "today" else "plugins"),
                )
                manager.updateAppWidget(widgetId, views)
                return
            }

            val rows = content.optJSONArray("rows")
            // 矮条（2×1）里标题是冗余的（用户自己知道放的是什么），把这一行让给内容：
            // 隐藏标题、收紧内边距，于是「一行内容 + 脚注」都放得下，而不是被裁掉半行。
            val compact = maxRows == 1
            applyCompactPadding(ctx, views, compact)
            views.setViewVisibility(R.id.onethu_widget_title, if (compact) View.GONE else View.VISIBLE)
            views.setTextViewText(
                R.id.onethu_widget_title,
                content.optString("title").takeIf { it.isNotEmpty() } ?: "OneTHU",
            )

            val slotIds = intArrayOf(R.id.onethu_widget_row1, R.id.onethu_widget_row2, R.id.onethu_widget_row3)
            for (i in 0 until ROW_IDS) {
                val viewId = slotIds[i]
                val row = if (i < maxRows) rows?.optJSONObject(i) else null
                val text = row?.optString("text").orEmpty()
                if (text.isEmpty()) {
                    views.setViewVisibility(viewId, View.GONE)
                    continue
                }
                val sub = row?.optString("sub").orEmpty()
                views.setViewVisibility(viewId, View.VISIBLE)
                views.setTextViewText(viewId, if (sub.isEmpty()) text else "$text · $sub")
            }

            // 脚注（「3 节课 · 2 个截止」）在矮条里也要留着：那里已经让出了标题行，放得下
            val footer = content.optString("footer").orEmpty()
            views.setViewVisibility(R.id.onethu_widget_footer, if (footer.isEmpty()) View.GONE else View.VISIBLE)
            views.setTextViewText(R.id.onethu_widget_footer, footer)
            views.setOnClickPendingIntent(
                R.id.onethu_widget_root,
                clickPending(ctx, content.optString("target")),
            )
            manager.updateAppWidget(widgetId, views)
        }

        /** 点击：落点交给广播（存 target 后拉起 App） */
        private fun clickPending(ctx: Context, target: String): PendingIntent {
            val intent = Intent(ctx, OnethuLaunchReceiver::class.java)
                .putExtra(OnethuLaunchReceiver.EXTRA_TARGET, target)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            return PendingIntent.getBroadcast(ctx, target.hashCode(), intent, flags)
        }
    }

    private fun render(ctx: Context, manager: AppWidgetManager, widgetId: Int) {
        renderFor(ctx, manager, widgetId, slotKey())
    }
}

/** 宿主小组件（标准 3×2）：今日课程与作业截止（快照根字段） */
class OnethuWidgetProvider : OnethuBaseWidget() {
    override fun slotKey(): String? = null
}

/* 宿主小组件的另外三种初始形态：内容与逻辑完全一致（都读快照根字段、都按实际高度决定行数），
   区别只在清单里声明的初始占位尺寸——让选择器直接给出「方块 / 窄条 / 长条」三种选择。 */

/** 方块 2×2 */
class OnethuWidgetSquare : OnethuBaseWidget() {
    override fun slotKey(): String? = null
}

/** 窄条 2×1 */
class OnethuWidgetNarrow : OnethuBaseWidget() {
    override fun slotKey(): String? = null
}

/** 长条 4×1 */
class OnethuWidgetStrip : OnethuBaseWidget() {
    override fun slotKey(): String? = null
}

/** 插件小组件槽位 1..3：内容来自插件声明（JS 侧解析后放进快照的 slots 字段） */
class OnethuWidgetSlot1 : OnethuBaseWidget() {
    override fun slotKey(): String = "1"
}

class OnethuWidgetSlot2 : OnethuBaseWidget() {
    override fun slotKey(): String = "2"
}

class OnethuWidgetSlot3 : OnethuBaseWidget() {
    override fun slotKey(): String = "3"
}
