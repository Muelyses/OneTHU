package app.onethu.mobile

import android.nfc.NdefMessage
import android.nfc.NdefRecord
import android.nfc.cardemulation.HostApduService
import android.os.Bundle

/**
 * 碰一碰发送端：把当前 OneTHU 口令模拟成 NDEF 标签（HCE）。
 *
 * 协议：NDEF tag application AID D2760000850101；对象 1 = CC 文件 E103，对象 2 = NDEF 文件 E104。
 * 只做最小只读实现（SELECT/READ BINARY）；写入由对方读取端完成。
 */
class NfcHceService : HostApduService() {
    companion object {
        @Volatile
        var payload: String = ""

        private val NDEF_AID = byteArrayOf(
            0xD2.toByte(), 0x76, 0x00, 0x00, 0x85.toByte(), 0x01, 0x01,
        )
        private val CC = byteArrayOf(
            0x00, 0x0F, 0x20, 0x00, 0x3B, 0x04, 0x06, 0xE1.toByte(), 0x04, 0x7F, 0x7F, 0x00, 0x00, 0x00, 0x00,
        )

        private fun messageBytes(): ByteArray {
            if (payload.isEmpty()) return ByteArray(0)
            return try {
                NdefMessage(arrayOf(NdefRecord.createTextRecord("en", payload))).toByteArray()
            } catch (_: Exception) {
                ByteArray(0)
            }
        }

        private fun sw(code: Int): ByteArray = byteArrayOf(((code shr 8) and 0xFF).toByte(), (code and 0xFF).toByte())
        private fun ok(data: ByteArray): ByteArray = data + sw(0x9000)
    }

    private var selected: Int = 0 // 0=none 1=CC 2=NDEF

    override fun processCommandApdu(commandApdu: ByteArray?, extras: Bundle?): ByteArray {
        val a = commandApdu ?: return sw(0x6F00)
        if (a.size < 4) return sw(0x6F00)
        val ins = a[1].toInt() and 0xFF
        if (ins == 0xA4) {
            // SELECT AID
            if (a.size >= 12 && a[2].toInt() == 0x04 && (a[5].toInt() and 0xFF) == 0xD2 && a.copyOfRange(5, 12).contentEquals(NDEF_AID)) {
                selected = 0
                return sw(0x9000)
            }
            // SELECT FILE E103 / E104
            if (a.size >= 7 && a[2].toInt() == 0x00) {
                val hi = a[5].toInt() and 0xFF
                val lo = a[6].toInt() and 0xFF
                if (hi == 0xE1 && lo == 0x03) { selected = 1; return sw(0x9000) }
                if (hi == 0xE1 && lo == 0x04) { selected = 2; return sw(0x9000) }
            }
            return sw(0x6A82)
        }
        if (ins == 0xB0) {
            if (a.size < 5) return sw(0x6B00)
            val offset = ((a[2].toInt() and 0xFF) shl 8) or (a[3].toInt() and 0xFF)
            val le = a[4].toInt() and 0xFF
            val data: ByteArray = when (selected) {
                1 -> CC
                2 -> {
                    val msg = messageBytes()
                    val nlen = msg.size.coerceAtMost(0x7FFF)
                    val buf = ByteArray(2 + nlen)
                    buf[0] = ((nlen shr 8) and 0xFF).toByte()
                    buf[1] = (nlen and 0xFF).toByte()
                    msg.copyInto(buf, 2, 0, nlen)
                    buf
                }
                else -> return sw(0x6982)
            }
            if (offset < 0 || offset > data.size) return sw(0x6B00)
            val end = if (le == 0) data.size else minOf(data.size, offset + le)
            return ok(data.copyOfRange(offset, end))
        }
        return sw(0x6D00)
    }

    override fun onDeactivated(reason: Int) {
        selected = 0
    }
}
