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

    companion object {
        private const val ROW_IDS = 3

        /** 全部 provider（宿主 + 三个插件槽位）；新增槽位时只改这一处与清单 */
        private val PROVIDERS = listOf(
            OnethuWidgetProvider::class.java,
            OnethuWidgetSlot1::class.java,
            OnethuWidgetSlot2::class.java,
            OnethuWidgetSlot3::class.java,
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

        private fun renderFor(ctx: Context, manager: AppWidgetManager, widgetId: Int, slot: String?) {
            val views = RemoteViews(ctx.packageName, R.layout.onethu_widget)
            val snap = WidgetStore.load(ctx)
            val content = if (slot == null) snap else snap?.optJSONObject("slots")?.optJSONObject(slot)

            if (content == null) {
                // 未绑定 / 尚无快照：给一条可读的引导，不留空白
                views.setTextViewText(
                    R.id.onethu_widget_title,
                    if (slot == null) "OneTHU" else "OneTHU 插件小组件 $slot",
                )
                views.setTextViewText(R.id.onethu_widget_row1, if (slot == null) "打开 OneTHU 刷新数据" else "尚无插件占用此槽位")
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
            views.setTextViewText(
                R.id.onethu_widget_title,
                content.optString("title").takeIf { it.isNotEmpty() } ?: "OneTHU",
            )

            val slotIds = intArrayOf(R.id.onethu_widget_row1, R.id.onethu_widget_row2, R.id.onethu_widget_row3)
            for (i in 0 until ROW_IDS) {
                val viewId = slotIds[i]
                val row = rows?.optJSONObject(i)
                val text = row?.optString("text").orEmpty()
                if (text.isEmpty()) {
                    views.setViewVisibility(viewId, View.GONE)
                    continue
                }
                val sub = row?.optString("sub").orEmpty()
                views.setViewVisibility(viewId, View.VISIBLE)
                views.setTextViewText(viewId, if (sub.isEmpty()) text else "$text · $sub")
            }

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

/** 宿主小组件：今日课程与作业截止（快照根字段） */
class OnethuWidgetProvider : OnethuBaseWidget() {
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
