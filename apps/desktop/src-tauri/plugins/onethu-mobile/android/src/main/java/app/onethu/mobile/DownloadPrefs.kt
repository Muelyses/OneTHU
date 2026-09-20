// 下载位置（Android）：SAF 目录树授权 + 文档创建。
//
// Android 没有「随便写一个路径」这回事：应用只能写自己的沙盒，要落到用户可见的位置，
// 要么走 MediaStore（系统「下载」），要么让用户用系统选择器**授权一个目录**（SAF 目录树），
// 再把授权持久化到重启之后。这个对象就管后者的存取与写入；真实路径拿不到（SAF 只给 URI），
// 所以对外只暴露一个「给用户看的名字」。
package app.onethu.mobile

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.OpenableColumns

object DownloadPrefs {
    private const val PREFS = "onethu_download"
    private const val KEY_TREE = "tree_uri"

    private fun prefs(ctx: Context) =
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** 用户授权的目录树 URI；没授权过返回 null（此时用系统「下载」） */
    fun treeUri(ctx: Context): Uri? {
        val raw = prefs(ctx).getString(KEY_TREE, null) ?: return null
        return try {
            Uri.parse(raw)
        } catch (_: Exception) {
            null
        }
    }

    fun setTree(ctx: Context, uri: String) {
        prefs(ctx).edit().putString(KEY_TREE, uri).apply()
    }

    fun clear(ctx: Context) {
        prefs(ctx).edit().remove(KEY_TREE).apply()
    }

    /** 给用户看的当前位置：授权目录的显示名，没授权就是「系统下载」 */
    fun label(ctx: Context): String {
        val tree = treeUri(ctx) ?: return "系统下载"
        val name = documentName(ctx, tree)
        if (!name.isNullOrBlank()) return name
        // 查不到显示名（个别 ROM）：退回目录 id 的最后一段
        val id = try {
            DocumentsContract.getTreeDocumentId(tree)
        } catch (_: Exception) {
            null
        }
        return id?.substringAfterLast(':')?.takeIf { it.isNotBlank() } ?: "已选文件夹"
    }

    /** 在授权目录里建一个文档（同名时系统会自动加序号，不会覆盖已有文件） */
    fun createDocument(ctx: Context, tree: Uri, mime: String, name: String): Uri? {
        return try {
            val parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
            DocumentsContract.createDocument(ctx.contentResolver, parent, mime, name)
        } catch (_: Exception) {
            null
        }
    }

    /** 文档 URI 的显示名（另存为成功后回传给用户看） */
    fun displayName(ctx: Context, uri: Uri): String = documentName(ctx, uri) ?: "已保存"

    private fun documentName(ctx: Context, uri: Uri): String? {
        return try {
            ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            }
        } catch (_: Exception) {
            null
        }
    }
}
