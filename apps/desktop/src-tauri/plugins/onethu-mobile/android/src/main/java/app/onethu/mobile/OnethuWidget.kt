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

class OnethuWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        for (id in appWidgetIds) render(context, manager, id)
    }

    companion object {
        private const val ROW_IDS = 3

        /** App 前台刷新快照后调用：让所有已放置的小组件立刻重画（不等系统 30 分钟轮询）。 */
        fun refreshAll(ctx: Context) {
            val manager = AppWidgetManager.getInstance(ctx) ?: return
            val ids = manager.getAppWidgetIds(ComponentName(ctx, OnethuWidgetProvider::class.java))
            for (id in ids) render(ctx, manager, id)
        }

        private fun render(ctx: Context, manager: AppWidgetManager, widgetId: Int) {
            val views = RemoteViews(ctx.packageName, R.layout.onethu_widget)
            val snap = WidgetStore.load(ctx)
            val rows = snap?.optJSONArray("rows")

            views.setTextViewText(
                R.id.onethu_widget_title,
                snap?.optString("title")?.takeIf { it.isNotEmpty() } ?: "OneTHU",
            )

            val slotIds = intArrayOf(R.id.onethu_widget_row1, R.id.onethu_widget_row2, R.id.onethu_widget_row3)
            for (i in 0 until ROW_IDS) {
                val slot = slotIds[i]
                val row = rows?.optJSONObject(i)
                val text = row?.optString("text").orEmpty()
                if (text.isEmpty()) {
                    views.setViewVisibility(slot, View.GONE)
                    continue
                }
                val sub = row?.optString("sub").orEmpty()
                views.setViewVisibility(slot, View.VISIBLE)
                views.setTextViewText(slot, if (sub.isEmpty()) text else "$text · $sub")
            }

            val footer = snap?.optString("footer").orEmpty()
            views.setViewVisibility(R.id.onethu_widget_footer, if (footer.isEmpty()) View.GONE else View.VISIBLE)
            views.setTextViewText(R.id.onethu_widget_footer, footer)

            // 点击：落点交给广播（存 target 后拉起 App），未配置落点时只打开 App
            val target = snap?.optString("target").orEmpty()
            val clickIntent = Intent(ctx, OnethuLaunchReceiver::class.java)
                .putExtra(OnethuLaunchReceiver.EXTRA_TARGET, target)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            val pending = PendingIntent.getBroadcast(ctx, 0, clickIntent, flags)
            views.setOnClickPendingIntent(R.id.onethu_widget_root, pending)

            manager.updateAppWidget(widgetId, views)
        }
    }
}
