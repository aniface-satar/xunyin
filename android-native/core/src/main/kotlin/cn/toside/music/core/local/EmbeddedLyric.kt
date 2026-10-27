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
 * | MP4 / M4A | `©lyr` | `moov/udta/meta/ilst`（meta 含 4 字节 version/flags），UTF-8；**moov 在文件尾**时走 [parseWithTail] 的尾部探测 | —— |
 * | FLAC | `LYRICS` | METADATA_BLOCK VORBIS_COMMENT（type 4），UTF-8 | —— |
 * | OGG | `LYRICS` | 注释头包（`\x03vorbis`，按 OggS 页 lacing 重组），UTF-8 | Opus/Ogg FLAC 的头结构 |
 *
 * 键名不区分大小写（Vorbis comment 规范：字段名大小写不敏感）；`LYRICS` 优先，
 * 没有时退 `UNSYNCEDLYRICS`（很多转码工具只写后者）。
 *
 * 只读文件头：输入超过 [MAX_INPUT_BYTES] 立即返回 null 防内存问题；
 * app 侧也只喂前 1 MB（尾部探测另喂 [TAIL_PROBE_BYTES]）。多个 USLT 帧取第一个（RN 同）。
 */
object EmbeddedLyric {
    /** 超过 1 MB 的输入立即返回 null（ID3 标签罕见地超过这个数，防内存问题）。 */
    const val MAX_INPUT_BYTES: Int = 1 shl 20

    /** 流式 m4a（moov 在尾）的尾部探测窗口：只回读这么多字节找 `moov`。 */
    const val TAIL_PROBE_BYTES: Int = 1 shl 20

    /** 只给文件头时的解析（等价 [parseWithTail] 的 `tail` 传空）。 */
    fun parse(bytes: ByteArray): String? = parseWithTail(bytes, ByteArray(0))

    /**
     * 头 + 尾两段解析。
     *
     * 流式 m4a（录制/转码工具把 `moov` 写在 `mdat` 之后）的前 1 MB 里只有 `ftyp`/`mdat`，
     * 光看头一定取不到歌词；这时回读文件尾 [TAIL_PROBE_BYTES] 找 `moov`。
     * 尾部起点不是 atom 边界，所以按 `moov` 类型**搜索**原子头，而不是走原子链。
     */
    fun parseWithTail(
        head: ByteArray,
        tail: ByteArray,
    ): String? {
        if (head.size > MAX_INPUT_BYTES || tail.size > MAX_INPUT_BYTES) return null
        parseContainer(head)?.let { return it }
        // 尾部探测只对 MP4 容器做：mp3/flac/ogg 的歌词都在头里，白回读一次尾部没有意义
        if (tail.isNotEmpty() && isMp4Container(head)) return mp4LyricFromTail(tail)
        return null
    }

    /** 头部是不是 MP4 容器（`ftyp` 在偏移 4）——尾部探测只在这种容器上做，省掉无谓的回读。 */
    fun isMp4Container(head: ByteArray): Boolean = head.size >= 12 && isAtomType(head, 4, "ftyp")

    private fun parseContainer(bytes: ByteArray): String? {
        if (bytes.size >= 10 &&
            bytes[0] == 'I'.code.toByte() &&
            bytes[1] == 'D'.code.toByte() &&
            bytes[2] == '3'.code.toByte()
        ) {
            return id3Lyric(bytes)
        }
        if (bytes.size >= 12 && isAtomType(bytes, 4, "ftyp")) return mp4Lyric(bytes)
        if (bytes.size >= 4 && isMagic(bytes, 0, "fLaC")) return flacLyric(bytes)
        if (bytes.size >= 4 && isMagic(bytes, 0, "OggS")) return oggLyric(bytes)
        return null
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
            ((bytes[offset].toInt() and 0x7F) shl 21) or
                ((bytes[offset + 1].toInt() and 0x7F) shl 14) or
                ((bytes[offset + 2].toInt() and 0x7F) shl 7) or
                (bytes[offset + 3].toInt() and 0x7F)
        }

    /**
     * 4 字节大端整数；溢出 int 返回 -1。
     *
     * 括号不能省：`a shl 24 or b shl 16 or …` 里的 `shl` 与 `or` 都是中缀函数、
     * 同一优先级左结合，不写括号会算成 `((a shl 24 or b) shl 16 or c) shl 8 or d`
     * —— 高字节为 0 时碰巧对，超过 64 KB 的原子就错（W6-4 尾部探测实测踩到）。
     */
    private fun bigEndian(
        bytes: ByteArray,
        offset: Int,
    ): Int {
        if (offset + 4 > bytes.size) return -1
        val value =
            ((bytes[offset].toInt() and 0xFF) shl 24) or
                ((bytes[offset + 1].toInt() and 0xFF) shl 16) or
                ((bytes[offset + 2].toInt() and 0xFF) shl 8) or
                (bytes[offset + 3].toInt() and 0xFF)
        return if (value < 0) -1 else value
    }

    // ---------- MP4 / M4A ----------

    /** 沿 `moov → udta → meta → ilst` 走原子树，找 `©lyr` 里的 `data`。 */
    private fun mp4Lyric(bytes: ByteArray): String? {
        val ilstRange = findAtomPath(bytes, 0, bytes.size, listOf("moov", "udta", "meta", "ilst")) ?: return null
        return ilstLyric(bytes, ilstRange.first, ilstRange.second)
    }

    /**
     * 尾部探测：在 [tail] 里按 `moov` 类型搜原子头（流式 m4a 的 `moov` 在 `mdat` 之后）。
     *
     * 不校验 CRC / 不走原子链——尾部切片起点不是原子边界，只能搜索。
     * 64 位长度原子（`size == 1`）跳过：那得连 `largesize` 一起读，流式文件里几乎不出现。
     */
    private fun mp4LyricFromTail(tail: ByteArray): String? {
        var pos = 0
        while (pos + 8 <= tail.size) {
            val size = bigEndian(tail, pos)
            if (size >= 8 && pos + size <= tail.size && isAtomType(tail, pos + 4, "moov")) {
                val ilstRange =
                    findAtomPath(tail, pos + 8, pos + size, listOf("udta", "meta", "ilst"))
                        ?: return null
                return ilstLyric(tail, ilstRange.first, ilstRange.second)
            }
            pos += 1
        }
        return null
    }

    /** 在 `ilst` 内容区里按原子逐个找 `©lyr`。 */
    private fun ilstLyric(
        bytes: ByteArray,
        start: Int,
        end: Int,
    ): String? {
        var pos = start
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
    ): Boolean = isMagic(bytes, offset, name)

    private fun isMagic(
        bytes: ByteArray,
        offset: Int,
        name: String,
    ): Boolean {
        if (offset < 0 || offset + name.length > bytes.size) return false
        for ((index, ch) in name.withIndex()) {
            if (bytes[offset + index] != ch.code.toByte()) return false
        }
        return true
    }

    // ---------- FLAC / OGG（Vorbis comment） ----------

    /**
     * FLAC：`fLaC` 之后是一串 METADATA_BLOCK（4 字节头：1 字节 last-flag+type + 3 字节长度），
     * type 4 是 VORBIS_COMMENT。
     */
    private fun flacLyric(bytes: ByteArray): String? {
        var pos = 4
        while (pos + 4 <= bytes.size) {
            val header = bytes[pos].toInt() and 0xFF
            val isLast = header and 0x80 != 0
            val type = header and 0x7F
            val length =
                ((bytes[pos + 1].toInt() and 0xFF) shl 16) or
                    ((bytes[pos + 2].toInt() and 0xFF) shl 8) or
                    (bytes[pos + 3].toInt() and 0xFF)
            val contentStart = pos + 4
            val contentEnd = minOf(contentStart + length, bytes.size)
            if (contentEnd <= contentStart) return null // 坏块，继续走会死循环
            if (type == VORBIS_COMMENT_BLOCK) return vorbisComment(bytes, contentStart, contentEnd)
            if (isLast) return null
            pos = contentEnd
        }
        return null
    }

    /**
     * OGG：按 OggS 页重组 packet（lacing：段值 < 255 表示该 packet 结束），
     * 取 `\x03vorbis` 那个注释包（第 2 个包，跨页也认）。
     */
    private fun oggLyric(bytes: ByteArray): String? {
        for (packet in oggPackets(bytes)) {
            if (packet.size > 7 && packet[0] == 0x03.toByte() && isMagic(packet, 1, "vorbis")) {
                val text = vorbisComment(packet, 7, packet.size)
                if (!text.isNullOrEmpty()) return text
            }
        }
        return null
    }

    /** 只取够用的前几个包（识别头 + 注释头），后面的音频数据不读。 */
    private fun oggPackets(bytes: ByteArray): List<ByteArray> {
        val packets = mutableListOf<ByteArray>()
        var current = java.io.ByteArrayOutputStream()
        var pos = 0
        while (pos + 27 <= bytes.size) {
            if (!isMagic(bytes, pos, "OggS")) break
            val segmentCount = bytes[pos + OGG_SEGMENT_COUNT_OFFSET].toInt() and 0xFF
            val tableStart = pos + 27
            if (tableStart + segmentCount > bytes.size) break
            var payloadLength = 0
            for (index in 0 until segmentCount) {
                payloadLength += bytes[tableStart + index].toInt() and 0xFF
            }
            val payloadStart = tableStart + segmentCount
            val payloadEnd = minOf(payloadStart + payloadLength, bytes.size)
            var cursor = payloadStart
            for (index in 0 until segmentCount) {
                val length = bytes[tableStart + index].toInt() and 0xFF
                val sliceEnd = minOf(cursor + length, payloadEnd)
                if (sliceEnd > cursor) current.write(bytes, cursor, sliceEnd - cursor)
                cursor = sliceEnd
                if (length < 255) {
                    packets.add(current.toByteArray())
                    current = java.io.ByteArrayOutputStream()
                    if (packets.size >= OGG_PACKET_LIMIT) return packets
                }
                if (cursor >= payloadEnd) break
            }
            pos = payloadEnd
        }
        return packets
    }

    /**
     * Vorbis comment 区：vendor 长度 + vendor + 条目数 + 逐条 `长度 + KEY=VALUE`（**小端**长度）。
     * FLAC 的 METADATA_BLOCK VORBIS_COMMENT 与 OGG 注释包是同一套布局。
     */
    private fun vorbisComment(
        bytes: ByteArray,
        start: Int,
        end: Int,
    ): String? {
        if (end - start < 8) return null
        var pos = start
        val vendorLength = littleEndian(bytes, pos) ?: return null
        pos += 4 + vendorLength
        if (vendorLength < 0 || pos + 4 > end) return null
        val count = littleEndian(bytes, pos) ?: return null
        pos += 4
        var unsynced: String? = null
        for (index in 0 until count) {
            if (pos + 4 > end) return unsynced
            val length = littleEndian(bytes, pos) ?: return unsynced
            pos += 4
            if (length < 0) return unsynced
            val valueEnd = minOf(pos + length, end)
            if (valueEnd <= pos) break
            val entry = String(bytes, pos, valueEnd - pos, Charsets.UTF_8)
            pos = valueEnd
            val separator = entry.indexOf('=')
            if (separator <= 0) continue
            val key = entry.substring(0, separator)
            val value = entry.substring(separator + 1).trim().ifEmpty { null } ?: continue
            if (key.equals("LYRICS", ignoreCase = true)) return value
            if (unsynced == null && key.equals("UNSYNCEDLYRICS", ignoreCase = true)) unsynced = value
        }
        return unsynced
    }

    /** 4 字节小端整数；越界或溢出返回 null。 */
    private fun littleEndian(
        bytes: ByteArray,
        offset: Int,
    ): Int? {
        if (offset + 4 > bytes.size) return null
        val value =
            (bytes[offset].toInt() and 0xFF) or
                ((bytes[offset + 1].toInt() and 0xFF) shl 8) or
                ((bytes[offset + 2].toInt() and 0xFF) shl 16) or
                ((bytes[offset + 3].toInt() and 0xFF) shl 24)
        return if (value < 0) null else value
    }

    private const val VORBIS_COMMENT_BLOCK: Int = 4
    private const val OGG_SEGMENT_COUNT_OFFSET: Int = 26
    private const val OGG_PACKET_LIMIT: Int = 4
}
