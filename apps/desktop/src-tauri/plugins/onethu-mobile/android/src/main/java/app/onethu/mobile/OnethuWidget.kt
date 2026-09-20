// Android 桌面小组件（AppWidgetProvider）。
//
// 架构是「JS 算、原生画」：小组件进程里既没有 WebView 也没有会话（凭据是 WebCrypto 加密后
// 存在 localStorage 的，原生拿不到明文），因此任何需要网络或解析的逻辑都不可能在小组件里
// 跑。App 在前台刷新数据后把渲染好的快照推到 SharedPreferences，小组件只负责把快照摆到
// RemoteViews 上；用户点小组件 → 广播记下落点 → 打开 App 重算并回写快照。
//
// **内容绑定在「每一块」小组件上**，不是全局：桌面上可以同时放「日程与 DDL」「某门课的详情」
// 「某个收藏夹的图标组」「某个功能页的 1×1 快捷方式」，各显示各的。原生按 appWidgetId 存快照：
//
//   快照 JSON（JS 侧 state/widgetSnapshot.ts 生成，字段变更需同步两端）：
//     { "kind": "list",     "title": "今日", "rows": [{ "text": "10:00 数据结构", "sub": "六教6A215" }],
//                            "footer": "3 节课 · 2 个截止", "target": "today" }
//     { "kind": "grid",     "title": "常用", "items": [{ "label": "网络学堂",
//                            "icon": "data:image/png;base64,…", "target": "learn" }], "target": "folder?folderId=f1" }
//     { "kind": "shortcut", "label": "校园卡", "icon": "data:image/png;base64,…",
//                            "sub": "余额 ¥23.4", "target": "info?infoTab=card" }
//
// 未绑定的实例显示「点一下选择显示内容」，点击落点 widget-config:<appWidgetId>，
// 由应用打开绑定层（也可以长按小组件 → 编辑，走同样的落点）。

package app.onethu.mobile

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

/** 快照存储：SharedPreferences。槽位小组件用全局键，宿主家族按 appWidgetId 一实例一键。 */
object WidgetStore {
    private const val PREFS = "onethu_widget"
    /** 插件槽位内容（全局：槽位 → 内容，由插件声明顺序决定） */
    private const val KEY_SLOTS = "snapshot"
    private const val PREFIX_INSTANCE = "instance:"

    private fun prefs(ctx: Context) =
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** 写一份全局槽位快照（键：slots） */
    fun saveSlots(ctx: Context, json: String) {
        prefs(ctx).edit().putString(KEY_SLOTS, json).apply()
    }

    fun loadSlots(ctx: Context): JSONObject? = parse(prefs(ctx).getString(KEY_SLOTS, null))

    /** 写某一块宿主机小组件的内容（按 appWidgetId） */
    fun saveInstance(ctx: Context, widgetId: Int, json: String) {
        prefs(ctx).edit().putString(PREFIX_INSTANCE + widgetId, json).apply()
    }

    fun loadInstance(ctx: Context, widgetId: Int): JSONObject? =
        parse(prefs(ctx).getString(PREFIX_INSTANCE + widgetId, null))

    /** 小组件被移除后清掉它的内容，避免 appWidgetId 复用时串内容 */
    fun clearInstance(ctx: Context, widgetId: Int) {
        prefs(ctx).edit().remove(PREFIX_INSTANCE + widgetId).apply()
    }

    /** 只保留仍存在的实例（App 推送后调用）：防止历史残留越积越多 */
    fun pruneInstances(ctx: Context, liveIds: Set<Int>) {
        val e = prefs(ctx).edit()
        for (k in prefs(ctx).all.keys) {
            if (!k.startsWith(PREFIX_INSTANCE)) continue
            val id = k.removePrefix(PREFIX_INSTANCE).toIntOrNull() ?: continue
            if (id !in liveIds) e.remove(k)
        }
        e.apply()
    }

    fun clear(ctx: Context) {
        prefs(ctx).edit().clear().apply()
    }

    private fun parse(raw: String?): JSONObject? {
        if (raw == null) return null
        return try {
            JSONObject(raw)
        } catch (e: Exception) {
            null   // 坏快照当作没有：小组件显示占位文案，不崩
        }
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
 * 小组件渲染基类：宿主小组件（按实例绑内容）与插件槽位小组件（按槽位取内容）共用。
 *
 * 宿主家族有四种子形状（1×1 快捷方式 / 2×1 窄条 / 2×2 方块 / 3×2 标准 / 4×1 长条），
 * 区别只在清单里声明的初始占位；内容与渲染完全一致——放什么由用户绑定的内容决定，
 * 拉多大由用户拖动决定，行数/图标数按实际占位自适应。
 */
abstract class OnethuBaseWidget : AppWidgetProvider() {
    /** 槽位键 "1".."3"；null = 宿主小组件（按 appWidgetId 取内容） */
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

    /** 小组件被移除：清掉它的内容 */
    override fun onDeleted(context: Context, appWidgetIds: IntArray) {
        for (id in appWidgetIds) WidgetStore.clearInstance(context, id)
    }

    companion object {
        /** 列表布局能画几行（row1..row5） */
        private const val ROW_IDS = 5
        /** 图标组布局的格子数（2 行 × 4 列） */
        private const val CELL_IDS = 8

        /**
         * 全部 provider（宿主五种形态 + 三个插件槽位）；新增形态时只改这一处与清单。
         *
         * 为什么宿主有多形态：`targetCellWidth/Height` 是**每个 provider 一份**的静态元信息，
         * 选择器里能直接选的形态数 = provider 数。只声明一种的话，想要一条 2×1 长条的用户
         * 得先放上再拖动改尺寸——多一步且不直观。五种形态共用同一套渲染与同一份实例内容，
         * 只是初始占位不同（放置后照样能自由拖动）。
         */
        private val PROVIDERS = listOf(
            OnethuWidgetShortcut::class.java,   // 1×1 快捷方式
            OnethuWidgetNarrow::class.java,     // 2×1 窄条
            OnethuWidgetSquare::class.java,     // 2×2 方块
            OnethuWidgetProvider::class.java,   // 3×2 标准
            OnethuWidgetStrip::class.java,      // 4×1 长条
            OnethuWidgetSlot1::class.java,
            OnethuWidgetSlot2::class.java,
            OnethuWidgetSlot3::class.java,
        )

        /** 槽位键 / provider 类 / 诊断名（诊断与刷新共用；槽位键 null = 宿主小组件） */
        fun providerEntries(): List<Triple<String?, Class<*>, String>> = listOf(
            Triple(null, OnethuWidgetShortcut::class.java, "宿主 1×1"),
            Triple(null, OnethuWidgetNarrow::class.java, "宿主 2×1"),
            Triple(null, OnethuWidgetSquare::class.java, "宿主 2×2"),
            Triple(null, OnethuWidgetProvider::class.java, "宿主 3×2"),
            Triple(null, OnethuWidgetStrip::class.java, "宿主 4×1"),
            Triple("1", OnethuWidgetSlot1::class.java, "槽位 1"),
            Triple("2", OnethuWidgetSlot2::class.java, "槽位 2"),
            Triple("3", OnethuWidgetSlot3::class.java, "槽位 3"),
        )

        /** 宿主家族的 provider（不含插件槽位） */
        fun hostProviders(): List<Class<*>> = providerEntries().filter { it.first == null }.map { it.second }

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

        /** 某块小组件当前的占位（宽高 dp）：内容行数/图标格子数都按它算 */
        fun sizeOf(manager: AppWidgetManager, widgetId: Int): Pair<Int, Int> {
            val opts = try {
                manager.getAppWidgetOptions(widgetId)
            } catch (e: Exception) {
                null
            }
            val w = opts?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0) ?: 0
            val h = opts?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0) ?: 0
            return w to h
        }

        /**
         * 列表形态能画几行——**同一套布局靠可见性自适应**，不额外声明多套 layout：
         *   · 2×1（矮条）→ 1 行；2×2 → 2 行；3×2 → 3 行；拉更高依次 4、5 行。
         * 尺寸取自 AppWidgetOptions 的 MIN_HEIGHT（dp），系统在拖动与旋转时都会更新。
         */
        private fun rowBudget(h: Int): Int = when {
            h <= 0 -> 3        // 拿不到尺寸（老系统/首次）→ 按默认 3 行渲染
            h < 90 -> 1
            h < 150 -> 2
            h < 200 -> 3
            h < 250 -> 4
            else -> 5
        }

        /** 图标组能放几个：列数按宽度、行数按高度（每格约 56dp），最多 2 行 × 4 列 */
        private fun gridCapacity(w: Int, h: Int): Int {
            if (w <= 0 && h <= 0) return 4
            val cols = if (w <= 0) 3 else ((w + 28) / 56).coerceIn(2, 4)
            val rows = if (h <= 0) 1 else ((h + 20) / 56).coerceIn(1, 2)
            return cols * rows
        }

        private fun renderFor(ctx: Context, manager: AppWidgetManager, widgetId: Int, slot: String?) {
            val (w, h) = sizeOf(manager, widgetId)
            val maxRows = rowBudget(h)
            val snap = WidgetStore.loadSlots(ctx)
            val content = if (slot == null) WidgetStore.loadInstance(ctx, widgetId) else snap?.optJSONObject("slots")?.optJSONObject(slot)
            if (content == null) {
                renderPlaceholder(ctx, manager, widgetId, slot)
                return
            }
            when (content.optString("kind", "list")) {
                "grid" -> renderGrid(ctx, manager, widgetId, content, w, h)
                "shortcut" -> renderShortcut(ctx, manager, widgetId, content)
                else -> renderList(ctx, manager, widgetId, content, maxRows)
            }
        }

        /** 未绑定 / 尚无快照：给一条可读的引导，不留空白 */
        private fun renderPlaceholder(ctx: Context, manager: AppWidgetManager, widgetId: Int, slot: String?) {
            if (slot == null && isShortcutProvider(manager, widgetId)) {
                val views = RemoteViews(ctx.packageName, R.layout.onethu_widget_shortcut)
                views.setTextViewText(R.id.onethu_widget_label, "点一下选择")
                views.setOnClickPendingIntent(R.id.onethu_widget_root, clickPending(ctx, "widget-config:$widgetId", 0))
                manager.updateAppWidget(widgetId, views)
                return
            }
            val views = RemoteViews(ctx.packageName, R.layout.onethu_widget)
            val title = if (slot == null) "OneTHU" else "OneTHU 插件小组件 $slot"
            val line = if (slot == null) "点一下选择显示内容" else "尚无插件占用此槽位"
            views.setTextViewText(R.id.onethu_widget_title, title)
            views.setViewVisibility(R.id.onethu_widget_title, View.VISIBLE)
            views.setTextViewText(R.id.onethu_widget_row1, line)
            views.setViewVisibility(R.id.onethu_widget_row1, View.VISIBLE)
            for (i in 2..ROW_IDS) views.setViewVisibility(rowId(i), View.GONE)
            views.setViewVisibility(R.id.onethu_widget_footer, View.GONE)
            views.setOnClickPendingIntent(
                R.id.onethu_widget_root,
                clickPending(ctx, if (slot == null) "widget-config:$widgetId" else "plugins", 0),
            )
            manager.updateAppWidget(widgetId, views)
        }

        /** 这块小组件是不是 1×1 快捷方式 provider（占位态要按它的布局画） */
        private fun isShortcutProvider(manager: AppWidgetManager, widgetId: Int): Boolean {
            val provider = try {
                manager.getAppWidgetInfo(widgetId)?.provider
            } catch (e: Exception) {
                null
            } ?: return false
            return provider.className == OnethuWidgetShortcut::class.java.name
        }

        /** 列表形态：标题 + 若干行（每行「主文 · 副文」）+ 脚注。用于日程/DDL 与单原子详情 */
        private fun renderList(ctx: Context, manager: AppWidgetManager, widgetId: Int, content: JSONObject, maxRows: Int) {
            val views = RemoteViews(ctx.packageName, R.layout.onethu_widget)
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

            for (i in 0 until ROW_IDS) {
                val viewId = rowId(i + 1)
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
                clickPending(ctx, content.optString("target"), 0),
            )
            manager.updateAppWidget(widgetId, views)
        }

        /** 图标组形态：收藏夹 = 内嵌的文件夹，若干原子图标并列，每个格子各自可点 */
        private fun renderGrid(ctx: Context, manager: AppWidgetManager, widgetId: Int, content: JSONObject, w: Int, h: Int) {
            val views = RemoteViews(ctx.packageName, R.layout.onethu_widget_grid)
            views.setTextViewText(
                R.id.onethu_widget_title,
                content.optString("title").takeIf { it.isNotEmpty() } ?: "收藏",
            )
            val items = content.optJSONArray("items")
            val capacity = gridCapacity(w, h)
            for (i in 0 until CELL_IDS) {
                val cell = cellId(i)
                val item = if (i < capacity) items?.optJSONObject(i) else null
                if (item == null) {
                    views.setViewVisibility(cell, View.GONE)
                    continue
                }
                views.setViewVisibility(cell, View.VISIBLE)
                views.setTextViewText(iconLabelId(i), item.optString("label"))
                val bmp = decodeIcon(item.optString("icon"))
                if (bmp != null) views.setImageViewBitmap(iconViewId(i), bmp)
                else views.setImageViewResource(iconViewId(i), android.R.drawable.ic_menu_compass)
                // 每个格子带自己的落点：这块小组件等于一个迷你收藏夹面板
                views.setOnClickPendingIntent(cell, clickPending(ctx, item.optString("target"), i + 1))
            }
            views.setOnClickPendingIntent(
                R.id.onethu_widget_title,
                clickPending(ctx, content.optString("target"), 0),
            )
            manager.updateAppWidget(widgetId, views)
        }

        /** 快捷方式形态：一个图标 + 一行名称（1×1 用；更大尺寸也能放，图标会居中） */
        private fun renderShortcut(ctx: Context, manager: AppWidgetManager, widgetId: Int, content: JSONObject) {
            val views = RemoteViews(ctx.packageName, R.layout.onethu_widget_shortcut)
            views.setTextViewText(R.id.onethu_widget_label, content.optString("label"))
            val bmp = decodeIcon(content.optString("icon"))
            if (bmp != null) views.setImageViewBitmap(R.id.onethu_widget_icon, bmp)
            else views.setImageViewResource(R.id.onethu_widget_icon, android.R.drawable.ic_menu_compass)
            views.setOnClickPendingIntent(
                R.id.onethu_widget_root,
                clickPending(ctx, content.optString("target"), 0),
            )
            manager.updateAppWidget(widgetId, views)
        }

        /** data URL（base64 PNG）→ Bitmap；坏数据返回 null（渲染处退回系统默认图标） */
        private fun decodeIcon(dataUrl: String): Bitmap? {
            if (dataUrl.isEmpty()) return null
            val comma = dataUrl.indexOf(',')
            if (comma < 0) return null
            return try {
                val bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT)
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            } catch (e: Exception) {
                null
            } catch (e: OutOfMemoryError) {
                null
            }
        }

        private fun rowId(n: Int): Int = when (n) {
            1 -> R.id.onethu_widget_row1
            2 -> R.id.onethu_widget_row2
            3 -> R.id.onethu_widget_row3
            4 -> R.id.onethu_widget_row4
            else -> R.id.onethu_widget_row5
        }

        private fun cellId(i: Int): Int = when (i) {
            0 -> R.id.onethu_widget_cell0
            1 -> R.id.onethu_widget_cell1
            2 -> R.id.onethu_widget_cell2
            3 -> R.id.onethu_widget_cell3
            4 -> R.id.onethu_widget_cell4
            5 -> R.id.onethu_widget_cell5
            6 -> R.id.onethu_widget_cell6
            else -> R.id.onethu_widget_cell7
        }

        private fun iconViewId(i: Int): Int = when (i) {
            0 -> R.id.onethu_widget_cell0_icon
            1 -> R.id.onethu_widget_cell1_icon
            2 -> R.id.onethu_widget_cell2_icon
            3 -> R.id.onethu_widget_cell3_icon
            4 -> R.id.onethu_widget_cell4_icon
            5 -> R.id.onethu_widget_cell5_icon
            6 -> R.id.onethu_widget_cell6_icon
            else -> R.id.onethu_widget_cell7_icon
        }

        private fun iconLabelId(i: Int): Int = when (i) {
            0 -> R.id.onethu_widget_cell0_label
            1 -> R.id.onethu_widget_cell1_label
            2 -> R.id.onethu_widget_cell2_label
            3 -> R.id.onethu_widget_cell3_label
            4 -> R.id.onethu_widget_cell4_label
            5 -> R.id.onethu_widget_cell5_label
            6 -> R.id.onethu_widget_cell6_label
            else -> R.id.onethu_widget_cell7_label
        }

        /** 矮条的紧凑内边距：12dp 的留白在 2×1（约 40dp 高）里会把内容挤出可视区 */
        private fun applyCompactPadding(ctx: Context, views: RemoteViews, compact: Boolean) {
            val d = ctx.resources.displayMetrics.density
            val px = { v: Int -> (v * d).toInt() }
            if (compact) views.setViewPadding(R.id.onethu_widget_root, px(8), px(6), px(8), px(6))
            else views.setViewPadding(R.id.onethu_widget_root, px(12), px(12), px(12), px(12))
        }

        /** 点击：落点交给广播（存 target 后拉起 App）；seq 用于同一落点的多个格子互不覆盖 */
        private fun clickPending(ctx: Context, target: String, seq: Int): PendingIntent {
            val intent = Intent(ctx, OnethuLaunchReceiver::class.java)
                .putExtra(OnethuLaunchReceiver.EXTRA_TARGET, target)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            return PendingIntent.getBroadcast(ctx, target.hashCode() * 31 + seq, intent, flags)
        }
    }

    private fun render(ctx: Context, manager: AppWidgetManager, widgetId: Int) {
        renderFor(ctx, manager, widgetId, slotKey())
    }
}

/* ══════════ 宿主小组件的五种初始形态 ══════════
   内容与渲染完全一致（内容由用户绑定的东西决定、行数与图标数按占位自适应），
   区别只在清单里声明的初始占位尺寸——让选择器直接给出各种形状。 */

/** 1×1 快捷方式：一个图标 + 名称（功能页 / 原子） */
class OnethuWidgetShortcut : OnethuBaseWidget() {
    override fun slotKey(): String? = null
}

/** 2×1 窄条 */
class OnethuWidgetNarrow : OnethuBaseWidget() {
    override fun slotKey(): String? = null
}

/** 2×2 方块 */
class OnethuWidgetSquare : OnethuBaseWidget() {
    override fun slotKey(): String? = null
}

/** 3×2 标准（日程与 DDL 的常见形态） */
class OnethuWidgetProvider : OnethuBaseWidget() {
    override fun slotKey(): String? = null
}

/** 4×1 长条 */
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
