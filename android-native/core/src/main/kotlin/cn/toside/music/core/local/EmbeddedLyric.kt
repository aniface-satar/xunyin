package cn.toside.music.core.local

/**
 * 内嵌歌词解析（W5-8 另一半）—— 对照 RN `src/utils/localMediaMetadata.ts#readLyric`
 * 的原生模块行为（RN 侧直接由原生代码读出 USLT 文本，这里用纯 Kotlin 复刻）。
 *
 * ## 支持矩阵
 *
 * | 容器 | 帧 / 原子 | 版本与编码 | 不支持 |
 * |:--|:--|:--|:--|
 * | MP3（ID3v2.2） | `ULT` | 编码 0 Latin-1 / 1 UTF-16 带 BOM | —— |
 * | MP3（ID3v2.3） | `USLT` | 编码 0/1/3，全局 unsynchronisation | 压缩/加密帧（跳过） |
 * | MP3（ID3v2.4） | `USLT` | 编码 0/1/2/3，帧级 unsynchronisation | 同上 |
 * | MP4 / M4A | `©lyr` | `moov/udta/meta/ilst`（meta 含 4 字节 version/flags），UTF-8 | moov 在文件尾 |
 * | ogg / flac | —— | —— | 本波不做，恒 null（Vorbis comment `LYRICS=`） |
 *
 * 只读文件头：输入超过 [MAX_INPUT_BYTES] 立即返回 null 防内存问题；
 * app 侧也只喂前 1 MB。多个 USLT 帧取第一个（RN 同）。
 */
object EmbeddedLyric {
    /** 超过 1 MB 的输入立即返回 null（ID3 标签罕见地超过这个数，防内存问题）。 */
    const val MAX_INPUT_BYTES: Int = 1 shl 20

    fun parse(bytes: ByteArray): String? {
        if (bytes.size > MAX_INPUT_BYTES) return null
        return when {
            bytes.size >= 10 && bytes[0] == 'I'.code.toByte() && bytes[1] == 'D'.code.toByte() && bytes[2] == '3'.code.toByte() ->
                id3Lyric(bytes)
            bytes.size >= 12 && isAtomType(bytes, 4, "ftyp") -> mp4Lyric(bytes)
            else -> null
        }
    }

    // ---------- ID3v2 ----------

    private fun id3Lyric(bytes: ByteArray): String? {
        val major = bytes[3].toInt() and 0xFF
        if (major !in 2..4) return null
        val flags = bytes[5].toInt() and 0xFF
        val tagSize = syncsafe(bytes, 6)
        if (tagSize <= 0) return null
        val tagEnd = minOf(10 + tagSize, bytes.size)
        var pos = 10
        // v2.3/2.4 扩展头：v3 是普通 32 位（不含自身），v4 是 syncsafe（含自身）
        if (major >= 3 && flags and 0x40 != 0) {
            if (major == 4) {
                pos += syncsafe(bytes, pos)
            } else {
                if (pos + 4 > tagEnd) return null
                pos += 4 + bigEndian(bytes, pos)
            }
            if (pos > tagEnd) return null
        }
        // 全局 unsynchronisation：把整个标签体先还原（0xFF 0x00 → 0xFF），
        // 还原后的数组从头开始，帧扫描必须用新偏移
        if (flags and 0x80 != 0) {
            val body = deUnsynchronise(bytes, pos, tagEnd)
            return when (major) {
                2 -> scanFrames22(body, 0, body.size)
                else -> scanFrames(body, 0, body.size, major)
            }
        }
        return when (major) {
            2 -> scanFrames22(bytes, pos, tagEnd)
            else -> scanFrames(bytes, pos, tagEnd, major)
        }
    }

    /** v2.2：帧头 6 字节（id 3 + size 3），歌词帧叫 `ULT`。 */
    private fun scanFrames22(
        bytes: ByteArray,
        start: Int,
        end: Int,
    ): String? {
        var pos = start
        while (pos + 6 <= end) {
            if (bytes[pos].toInt() == 0) return null // padding
            val id = String(bytes, pos, 3, Charsets.ISO_8859_1)
            val size =
                (bytes[pos + 3].toInt() and 0xFF) shl 16 or
                    (bytes[pos + 4].toInt() and 0xFF) shl 8 or
                    (bytes[pos + 5].toInt() and 0xFF)
            val contentStart = pos + 6
            if (size < 0 || contentStart + size > end) return null // 帧长跨界截断
            if (id == "ULT") return parseUsltContent(bytes, contentStart, contentStart + size)
            pos = contentStart + size
        }
        return null
    }

    /** v2.3/2.4：帧头 10 字节；v2.4 帧长是 syncsafe，v2.3 是普通 32 位。 */
    private fun scanFrames(
        bytes: ByteArray,
        start: Int,
        end: Int,
        major: Int,
    ): String? {
        var pos = start
        while (pos + 10 <= end) {
            if (bytes[pos].toInt() == 0) return null // padding
            val id = String(bytes, pos, 4, Charsets.ISO_8859_1)
            val size =
                if (major == 4) {
                    syncsafe(bytes, pos + 4)
                } else {
                    bigEndian(bytes, pos + 4)
                }
            if (size < 0) return null
            val contentStart = pos + 10
            if (contentStart + size > end) return null // 帧长跨界截断
            if (id == "USLT") {
                var content = bytes
                var contentEnd = contentStart + size
                var from = contentStart
                // v2.4 帧级 unsynchronisation（v2.3 的 unsync 只在全局头）
                if (major == 4) {
                    val frameFlags = bytes[pos + 9].toInt() and 0xFF
                    val hasDataLength = frameFlags and 0x01 != 0
                    if (frameFlags and 0x02 != 0) {
                        content = deUnsynchronise(bytes, contentStart, contentEnd)
                        from = 0
                        contentEnd = content.size
                    }
                    if (hasDataLength) from += 4
                }
                return parseUsltContent(content, from, contentEnd)
            }
            pos = contentStart + size
        }
        return null
    }

    /**
     * USLT/ULT 内容：编码字节 + 3 字节语言 + 终止符结尾的描述 + 歌词正文。
     * 编码 0 Latin-1 / 1 UTF-16 带 BOM / 2 UTF-16BE / 3 UTF-8。
     */
    private fun parseUsltContent(
        bytes: ByteArray,
        start: Int,
        end: Int,
    ): String? {
        if (start >= end) return null
        val encoding = bytes[start].toInt() and 0xFF
        if (encoding !in 0..3) return null
        var pos = start + 1 + 3 // 编码 + 语言
        pos = skipTerminatedString(bytes, pos, end, wide = encoding == 1 || encoding == 2)
        if (pos < 0 || pos >= end) return null
        val charset =
            when (encoding) {
                0 -> Charsets.ISO_8859_1
                1 -> if (hasUtf16LeBom(bytes, pos)) Charsets.UTF_16LE else Charsets.UTF_16BE
                2 -> Charsets.UTF_16BE
                else -> Charsets.UTF_8
            }
        val bomBytes = if (encoding == 1 && hasUtf16LeBom(bytes, pos)) 2 else 0
        val text = String(bytes, pos + bomBytes, end - pos - bomBytes, charset)
        return text.trim().ifEmpty { null }
    }

    /** 跳过终止符结尾的描述串；找不到终止符时按截断处理（正文取不到）。 */
    private fun skipTerminatedString(
        bytes: ByteArray,
        start: Int,
        end: Int,
        wide: Boolean,
    ): Int {
        var pos = start
        if (wide) {
            while (pos + 1 < end) {
                if (bytes[pos].toInt() == 0 && bytes[pos + 1].toInt() == 0) return pos + 2
                pos += 2
            }
            return end
        }
        while (pos < end) {
            if (bytes[pos].toInt() == 0) return pos + 1
            pos++
        }
        return end
    }

    private fun hasUtf16LeBom(
        bytes: ByteArray,
        pos: Int,
    ): Boolean {
        if (pos + 1 >= bytes.size) return false
        return bytes[pos] == 0xFF.toByte() && bytes[pos + 1] == 0xFE.toByte()
    }

    /** unsynchronisation 还原：`FF 00` → `FF`。 */
    private fun deUnsynchronise(
        bytes: ByteArray,
        start: Int,
        end: Int,
    ): ByteArray {
        val out = ByteArray(end - start)
        var write = 0
        var read = start
        while (read < end) {
            val current = bytes[read]
            out[write++] = current
            if (current == 0xFF.toByte() && read + 1 < end && bytes[read + 1].toInt() == 0) {
                read += 2
            } else {
                read++
            }
        }
        return out.copyOf(write)
    }

    /** 4 字节 syncsafe 整数（每字节只用低 7 位）。 */
    private fun syncsafe(
        bytes: ByteArray,
        offset: Int,
    ): Int =
        if (offset + 4 > bytes.size) {
            -1
        } else {
            (bytes[offset].toInt() and 0x7F) shl 21 or
                (bytes[offset + 1].toInt() and 0x7F) shl 14 or
                (bytes[offset + 2].toInt() and 0x7F) shl 7 or
                (bytes[offset + 3].toInt() and 0x7F)
        }

    /** 4 字节大端整数；溢出 int 返回 -1。 */
    private fun bigEndian(
        bytes: ByteArray,
        offset: Int,
    ): Int {
        if (offset + 4 > bytes.size) return -1
        val value =
            (bytes[offset].toInt() and 0xFF) shl 24 or
                (bytes[offset + 1].toInt() and 0xFF) shl 16 or
                (bytes[offset + 2].toInt() and 0xFF) shl 8 or
                (bytes[offset + 3].toInt() and 0xFF)
        return if (value < 0) -1 else value
    }

    // ---------- MP4 / M4A ----------

    /** 沿 `moov → udta → meta → ilst` 走原子树，找 `©lyr` 里的 `data`。 */
    private fun mp4Lyric(bytes: ByteArray): String? {
        val ilstRange = findAtomPath(bytes, 0, bytes.size, listOf("moov", "udta", "meta", "ilst")) ?: return null
        var pos = ilstRange.first
        val end = ilstRange.second
        while (pos + 8 <= end) {
            val size = bigEndian(bytes, pos)
            if (size < 8 || pos + size > end) return null
            if (isAtomType(bytes, pos + 4, "©lyr")) {
                return dataAtomText(bytes, pos + 8, pos + size)
            }
            pos += size
        }
        return null
    }

    /** `data` 原子：4 字节 version/flags + 4 字节保留，之后是 UTF-8 正文。 */
    private fun dataAtomText(
        bytes: ByteArray,
        start: Int,
        end: Int,
    ): String? {
        var pos = start
        while (pos + 8 <= end) {
            val size = bigEndian(bytes, pos)
            if (size < 8 || pos + size > end) return null
            if (isAtomType(bytes, pos + 4, "data")) {
                val textStart = pos + 16 // size(4) + type(4) + version/flags(4) + reserved(4)
                if (textStart > pos + size) return null
                return String(bytes, textStart, pos + size - textStart, Charsets.UTF_8).trim().ifEmpty { null }
            }
            pos += size
        }
        return null
    }

    /**
     * 在 `[start, end)` 里按 [path] 逐层嵌套找原子的内容区。
     * `meta` 原子头后跟 4 字节 version/flags，进入其子原子前要跳过。
     */
    private fun findAtomPath(
        bytes: ByteArray,
        start: Int,
        end: Int,
        path: List<String>,
    ): Pair<Int, Int>? {
        var pos = start
        var currentEnd = end
        for ((index, name) in path.withIndex()) {
            var found = false
            while (pos + 8 <= currentEnd) {
                val size = bigEndian(bytes, pos)
                if (size < 8 || pos + size > currentEnd) return null
                if (isAtomType(bytes, pos + 4, name)) {
                    val contentStart = pos + 8 + (if (name == "meta") 4 else 0)
                    if (index == path.lastIndex) return contentStart to pos + size
                    pos = contentStart
                    currentEnd = pos + size - 8 - (if (name == "meta") 4 else 0)
                    found = true
                    break
                }
                pos += size
            }
            if (!found) return null
        }
        return null
    }

    private fun isAtomType(
        bytes: ByteArray,
        offset: Int,
        name: String,
    ): Boolean {
        if (offset + name.length > bytes.size) return false
        for ((index, ch) in name.withIndex()) {
            if (bytes[offset + index] != ch.code.toByte()) return false
        }
        return true
    }
}
