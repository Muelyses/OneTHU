// OneTHU 悬浮层：附件选择器（拍照 / 相册 / 上传，需求 6）。
//
// 三个入口全部走**系统选择器**，因此：
//   - 应用**不需要**存储权限（SAF/Photo Picker 由系统授予单次访问）；
//   - 也**不需要**相机权限：ACTION_IMAGE_CAPTURE 只有在应用自己声明了 CAMERA 时才要求授权，
//     本应用未声明（真机 `dumpsys package` 已确认）；
//   - 拍照需要 FileProvider 把 cacheDir 的出图路径交给相机应用写（见 AndroidManifest + res/xml）。
//
// 结果统一「物化」成 cacheDir 里的真实文件（JS 侧 attachFromPath 认路径，content:// 它读不了）。

package app.onethu.overlay

import android.app.Activity
import android.content.Intent
import android.content.res.AssetFileDescriptor
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Log
import androidx.core.content.FileProvider
import java.io.File

object OverlayPicker {

    /** 一次选择计划：要拉起的 Intent + 拍照时的出图文件 */
    class Plan(val intent: Intent, val outFile: File?)

    private const val TAG = "OnethuOverlay"

    fun authority(activity: Activity): String =
        // 复用宿主 app 已有的 FileProvider（app/src/main/AndroidManifest.xml 里 ${applicationId}.fileprovider，
        // 它的 res/xml/file_paths.xml 已含 <cache-path path="."/>，覆盖我们的 cacheDir 出图）；
        // 本插件**不再**自带 provider —— 同名 provider 会在 manifest 合并时报 authorities/meta-data 冲突。
        "${activity.packageName}.fileprovider"

    fun plan(activity: Activity, kind: String): Plan = when (kind) {
        "camera" -> {
            val f = File(activity.cacheDir, "overlay_cam_${System.currentTimeMillis()}.jpg")
            val uri: Uri = FileProvider.getUriForFile(activity, authority(activity), f)
            Plan(
                Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                    putExtra(MediaStore.EXTRA_OUTPUT, uri)
                    addFlags(
                        Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION,
                    )
                },
                f,
            )
        }
        "gallery" -> {
            val i = if (Build.VERSION.SDK_INT >= 33) {
                // Android 13+ 的照片选择器（无需任何权限，只给用户选中的那张）
                Intent(MediaStore.ACTION_PICK_IMAGES).apply { type = "image/*" }
            } else {
                Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI).apply {
                    type = "image/*"
                }
            }
            Plan(i, null)
        }
        else -> Plan(docIntent("*/*"), null)
    }

    /** 相册选择器不可用（部分 ROM 精简掉）时的退路：文档选择器，同样零权限 */
    fun planFallback(): Plan = Plan(docIntent("image/*"), null)

    private fun docIntent(mime: String): Intent =
        Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mime
        }

    /**
     * 把选择结果落成 cacheDir 里的真实文件：
     *   - 拍照：相机已写进我们给的 FileProvider 文件（校验存在且非空）；
     *   - 相册/上传：把 content:// 流拷进 cacheDir（用原文件名，加时间戳前缀防重名）。
     */
    fun materialize(activity: Activity, kind: String, outFile: File?, data: Intent?): File? {
        if (kind == "camera") {
            return outFile?.takeIf { it.exists() && it.length() > 0L }
        }
        val uri = data?.data ?: return null
        val name = displayName(activity, uri) ?: "attach_${System.currentTimeMillis()}"
        val safe = name.replace(Regex("[^\\p{L}\\p{N}._-]"), "_").takeLast(64)
        val dst = File(activity.cacheDir, "overlay_attach_${System.currentTimeMillis()}_$safe")
        try {
            val input = activity.contentResolver.openInputStream(uri) ?: return null
            input.use { i -> dst.outputStream().use { o -> i.copyTo(o) } }
        } catch (e: Throwable) {
            Log.w(TAG, "读取选择结果失败：${e.message}")
            return null
        }
        return dst.takeIf { it.exists() && it.length() > 0L }
    }

    /** content:// 的显示名（失败返回 null） */
    fun displayName(activity: Activity, uri: Uri): String? {
        var c: Cursor? = null
        return try {
            c = activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            if (c != null && c.moveToFirst()) {
                val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (idx >= 0) c.getString(idx) else null
            } else {
                uri.lastPathSegment
            }
        } catch (_: Throwable) {
            uri.lastPathSegment
        } finally {
            try {
                c?.close()
            } catch (_: Throwable) {
                /* 忽略 */
            }
        }
    }

    /** 按扩展名猜 mime（拿不到就用 application/octet-stream） */
    fun mimeOf(f: File): String {
        val n = f.name.lowercase()
        return when {
            n.endsWith(".jpg") || n.endsWith(".jpeg") -> "image/jpeg"
            n.endsWith(".png") -> "image/png"
            n.endsWith(".webp") -> "image/webp"
            n.endsWith(".gif") -> "image/gif"
            n.endsWith(".heic") -> "image/heic"
            n.endsWith(".pdf") -> "application/pdf"
            n.endsWith(".txt") -> "text/plain"
            n.endsWith(".zip") -> "application/zip"
            else -> "application/octet-stream"
        }
    }

    /** 兜底：拿文件大小（AssetFileDescriptor 有时比 File.length 准，但 cache 文件用 File 即可） */
    @Suppress("unused")
    fun sizeViaFd(activity: Activity, uri: Uri): Long = try {
        val afd: AssetFileDescriptor? = activity.contentResolver.openAssetFileDescriptor(uri, "r")
        val n = afd?.length ?: -1L
        afd?.close()
        if (n < 0) 0L else n
    } catch (_: Throwable) {
        0L
    }
}
