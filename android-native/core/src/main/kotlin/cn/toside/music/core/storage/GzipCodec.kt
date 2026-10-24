package cn.toside.music.core.storage

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream

/**
 * .lxmc 备份文件编解码 —— 对应 RN 侧 handleSaveFile/handleReadFile
 * （utils/tools.ts）：gzip 压缩的 JSON。
 *
 * 等价性（BackupCodecTest 黄金测试锁死）：
 * - unGzip(gzip(x)) == x（RFC 1952 往返）
 * - 与 RN 侧 react-native-file-system 的 gzipFile/unGzipFile 产物互通
 *   （标准 gzip 格式，gzip 头 mtime 可以为 0，解压方不校验）
 */
object GzipCodec {
    fun gzip(bytes: ByteArray): ByteArray {
        val out = ByteArrayOutputStream()
        GZIPOutputStream(out).use { it.write(bytes) }
        return out.toByteArray()
    }

    fun gunzip(bytes: ByteArray): ByteArray = GZIPInputStream(ByteArrayInputStream(bytes)).use { it.readBytes() }

    fun gzipString(text: String): String = String(gzip(text.toByteArray(Charsets.UTF_8)), Charsets.ISO_8859_1)

    fun gunzipString(binary: String): String = gunzip(binary.toByteArray(Charsets.ISO_8859_1)).toString(Charsets.UTF_8)
}
