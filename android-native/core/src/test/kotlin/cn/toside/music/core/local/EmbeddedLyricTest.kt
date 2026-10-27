package cn.toside.music.core.local

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.nio.charset.Charset

/**
 * 内嵌歌词解析（支持矩阵见 [EmbeddedLyric] 类注释）；字节 fixture 全部代码内构造。
 */
class EmbeddedLyricTest {
    // ---------- fixture 构造 ----------

    private fun be32(value: Int): ByteArray =
        byteArrayOf(
            (value shr 24 and 0xFF).toByte(),
            (value shr 16 and 0xFF).toByte(),
            (value shr 8 and 0xFF).toByte(),
            (value and 0xFF).toByte(),
        )

    private fun syncsafe(value: Int): ByteArray =
        byteArrayOf(
            (value shr 21 and 0x7F).toByte(),
            (value shr 14 and 0x7F).toByte(),
            (value shr 7 and 0x7F).toByte(),
            (value and 0x7F).toByte(),
        )

    private fun be24(value: Int): ByteArray =
        byteArrayOf((value shr 16 and 0xFF).toByte(), (value shr 8 and 0xFF).toByte(), (value and 0xFF).toByte())

    /** unsynchronisation 编码：每个 0xFF 后插一个 0x00（常见写法）。 */
    private fun unsync(bytes: ByteArray): ByteArray {
        val out = java.io.ByteArrayOutputStream(bytes.size)
        for (b in bytes) {
            out.write(b.toInt())
            if (b == 0xFF.toByte()) out.write(0)
        }
        return out.toByteArray()
    }

    private fun id3Tag(
        major: Int,
        frames: ByteArray,
        flags: Int = 0,
    ): ByteArray {
        val stored = if (flags and 0x80 != 0) unsync(frames) else frames
        val header =
            "ID3".toByteArray(Charset.forName("ISO-8859-1")) +
                byteArrayOf(major.toByte(), 0, flags.toByte()) +
                syncsafe(stored.size)
        return header + stored + ByteArray(16) // 模拟帧之后的音频数据
    }

    private fun usltContent(
        encoding: Int,
        textBytes: ByteArray,
    ): ByteArray {
        // 宽编码（UTF-16 系）的描述终止符是两个 0x00，窄编码（Latin-1/UTF-8）是一个
        val terminator = if (encoding == 1 || encoding == 2) byteArrayOf(0, 0) else byteArrayOf(0)
        return byteArrayOf(encoding.toByte()) + "eng".toByteArray(Charset.forName("ISO-8859-1")) + terminator + textBytes
    }

    private fun frame23(
        id: String,
        content: ByteArray,
        major: Int = 3,
    ): ByteArray =
        id.toByteArray(Charset.forName("ISO-8859-1")) +
            (if (major == 4) syncsafe(content.size) else be32(content.size)) +
            byteArrayOf(0, 0) +
            content

    private fun frame22(
        id: String,
        content: ByteArray,
    ): ByteArray = id.toByteArray(Charset.forName("ISO-8859-1")) + be24(content.size) + content

    private fun atom(
        type: String,
        content: ByteArray,
    ): ByteArray = be32(content.size + 8) + type.toByteArray(Charset.forName("ISO-8859-1")) + content

    private fun mp4File(ilstChildren: ByteArray): ByteArray =
        atom("ftyp", ByteArray(8)) +
            atom(
                "moov",
                atom(
                    "udta",
                    atom("meta", byteArrayOf(0, 0, 0, 0) + atom("ilst", ilstChildren)),
                ),
            )

    // ---------- ID3v2 ----------

    @Test
    fun `id3v23 uslt with utf-16 bom`() {
        val text = "零点起风了"
        val content = usltContent(1, byteArrayOf(0xFF.toByte(), 0xFE.toByte()) + text.toByteArray(Charsets.UTF_16LE))
        val bytes = id3Tag(3, frame23("USLT", content))
        assertEquals(text, EmbeddedLyric.parse(bytes))
    }

    @Test
    fun `id3v23 uslt latin-1`() {
        val text = "[00:01.00]hello"
        val content = usltContent(0, text.toByteArray(Charset.forName("ISO-8859-1")))
        val bytes = id3Tag(3, frame23("USLT", content))
        assertEquals(text, EmbeddedLyric.parse(bytes))
    }

    @Test
    fun `id3v24 uslt utf-8 with syncsafe frame size`() {
        val text = "[00:01.00]原生测试"
        val content = usltContent(3, text.toByteArray(Charsets.UTF_8))
        val bytes = id3Tag(4, frame23("USLT", content, major = 4))
        assertEquals(text, EmbeddedLyric.parse(bytes))
    }

    @Test
    fun `id3v22 ult frame`() {
        val text = "[00:01.00]old tag"
        val content = usltContent(0, text.toByteArray(Charset.forName("ISO-8859-1")))
        val bytes = id3Tag(2, frame22("ULT", content))
        assertEquals(text, EmbeddedLyric.parse(bytes))
    }

    @Test
    fun `first uslt wins among several`() {
        val first = usltContent(0, "first".toByteArray(Charset.forName("ISO-8859-1")))
        val second = usltContent(3, "second".toByteArray(Charsets.UTF_8))
        val bytes = id3Tag(3, frame23("USLT", first) + frame23("USLT", second))
        assertEquals("first", EmbeddedLyric.parse(bytes))
    }

    @Test
    fun `global unsynchronisation is reverted before decoding`() {
        // 正文含 0xFF 0x00：unsync 后为 0xFF 0x00 0x00，还原后应解回 0xFF 0x00
        val textBytes = byteArrayOf(0xFF.toByte(), 0x00) + "END".toByteArray(Charset.forName("ISO-8859-1"))
        val content = usltContent(0, textBytes)
        val bytes = id3Tag(3, frame23("USLT", content), flags = 0x80)
        assertEquals("ÿ\u0000END", EmbeddedLyric.parse(bytes))
    }

    @Test
    fun `tag without uslt frame returns null`() {
        val title = byteArrayOf(0) + "TIT2 内容".toByteArray(Charsets.UTF_8)
        val bytes = id3Tag(3, frame23("TIT2", title))
        assertNull(EmbeddedLyric.parse(bytes))
    }

    @Test
    fun `frame size crossing tag boundary returns null`() {
        // 声明的帧长超出标签体（截断/损坏）
        val broken =
            "USLT".toByteArray(Charset.forName("ISO-8859-1")) + be32(1000) + byteArrayOf(0, 0) + ByteArray(8)
        val bytes = id3Tag(3, broken)
        assertNull(EmbeddedLyric.parse(bytes))
    }

    @Test
    fun `unsupported id3 version returns null`() {
        val content = usltContent(0, "x".toByteArray(Charset.forName("ISO-8859-1")))
        val bytes = id3Tag(1, frame23("USLT", content))
        assertNull(EmbeddedLyric.parse(bytes))
    }

    // ---------- MP4 ----------

    @Test
    fun `mp4 lyr atom decodes utf-8`() {
        val text = "[00:01.00]m4a 歌词"
        val data = byteArrayOf(0, 0, 0, 0, 0, 0, 0, 0) + text.toByteArray(Charsets.UTF_8)
        val bytes = mp4File(atom("©lyr", atom("data", data)))
        assertEquals(text, EmbeddedLyric.parse(bytes))
    }

    @Test
    fun `mp4 without lyr atom returns null`() {
        val data = byteArrayOf(0, 0, 0, 0, 0, 0, 0, 0) + "title".toByteArray(Charsets.UTF_8)
        val bytes = mp4File(atom("©nam", atom("data", data)))
        assertNull(EmbeddedLyric.parse(bytes))
    }

    @Test
    fun `mp4 meta version and flags are skipped`() {
        // meta 的 4 字节 version/flags 若未跳过，首个子原子会被读成乱码、找不到 ilst
        val text = "meta flags"
        val data = byteArrayOf(1, 0, 0, 0, 0, 0, 0, 0) + text.toByteArray(Charsets.UTF_8)
        val bytes = mp4File(atom("©lyr", atom("data", data)))
        assertEquals(text, EmbeddedLyric.parse(bytes))
    }

    // ---------- 其他 ----------

    @Test
    fun `non audio bytes return null`() {
        assertNull(EmbeddedLyric.parse("OggS……随机的非音频字节".toByteArray(Charsets.UTF_8)))
        assertNull(EmbeddedLyric.parse(ByteArray(64) { it.toByte() }))
    }

    @Test
    fun `oversized input returns null immediately`() {
        assertNull(EmbeddedLyric.parse(ByteArray(EmbeddedLyric.MAX_INPUT_BYTES + 1)))
    }

    // ---------- 大尺寸（中缀优先级回归：`shl` 与 `or` 同级左结合） ----------

    @Test
    fun `id3 tag larger than 16k still scans frames`() {
        // syncsafe 长度跨到第二个字节：拼错优先级会算错标签长度、一个帧都扫不到
        val content = usltContent(3, "big tag".toByteArray(Charsets.UTF_8))
        val padding = frame23("TIT2", byteArrayOf(0) + ByteArray(20_000))
        val bytes = id3Tag(3, padding + frame23("USLT", content))
        assertEquals("big tag", EmbeddedLyric.parse(bytes))
    }

    @Test
    fun `mp4 atom larger than 64k still walks the tree`() {
        val text = "[00:01.00]big atom"
        val data = byteArrayOf(0, 0, 0, 0, 0, 0, 0, 0) + text.toByteArray(Charsets.UTF_8)
        val bytes =
            atom("ftyp", ByteArray(8)) +
                atom(
                    "moov",
                    atom("free", ByteArray(70_000)) +
                        atom(
                            "udta",
                            atom("meta", byteArrayOf(0, 0, 0, 0) + atom("ilst", atom("©lyr", atom("data", data)))),
                        ),
                )
        assertEquals(text, EmbeddedLyric.parse(bytes))
    }

    // ---------- FLAC / OGG / 流式 m4a（W6-4，落盘 fixture） ----------

    /**
     * fixture 说明（`core/src/test/resources/embedded-lyric/`）：
     * - `flac-*.bin`：**真实 flac 文件头切片**（`fLaC` + 真实 STREAMINFO 块，取自本机
     *   `浆果 - TINY7.flac`）+ 自造短 VORBIS_COMMENT 块（真实文件里的歌词正文不入库）；
     * - `ogg-*.bin`：按 OggS 页规范构造（识别头 + 注释头，注释头**跨两页**）；
     * - `m4a-*.bin`：`ftyp/mdat/moov` 原子链，`tail-moov` 把 `moov` 放在文件尾（流式）。
     */
    private fun fixture(name: String): ByteArray =
        requireNotNull(javaClass.classLoader.getResourceAsStream("embedded-lyric/$name")) { "fixture missing: $name" }
            .use { it.readBytes() }

    private val embeddedLyricText = "[00:00.000] 第一行\n[00:12.34] 第二行 with 中文"

    @Test
    fun `flac vorbis comment lyrics`() {
        assertEquals(embeddedLyricText, EmbeddedLyric.parse(fixture("flac-lyrics.bin")))
    }

    @Test
    fun `flac without lyrics key returns null`() {
        assertNull(EmbeddedLyric.parse(fixture("flac-nolyrics.bin")))
    }

    @Test
    fun `flac unsyncedlyrics is the fallback key`() {
        assertEquals(embeddedLyricText, EmbeddedLyric.parse(fixture("flac-unsynced.bin")))
    }

    @Test
    fun `ogg comment header spanning two pages`() {
        assertEquals(embeddedLyricText, EmbeddedLyric.parse(fixture("ogg-lyrics.bin")))
    }

    @Test
    fun `ogg without lyrics key returns null`() {
        assertNull(EmbeddedLyric.parse(fixture("ogg-nolyrics.bin")))
    }

    @Test
    fun `streaming m4a with moov at file tail`() {
        val bytes = fixture("m4a-tail-moov.bin")
        // 模拟 app 侧的两段读法：头 1 MB 里只有 ftyp/mdat，尾部切片里才有 moov
        val head = bytes.copyOfRange(0, minOf(512, bytes.size))
        val tail = bytes.copyOfRange((bytes.size - 512).coerceAtLeast(0), bytes.size)
        assertNull(EmbeddedLyric.parse(head))
        org.junit.Assert.assertTrue(EmbeddedLyric.isMp4Container(head))
        assertEquals(embeddedLyricText, EmbeddedLyric.parseWithTail(head, tail))
    }

    @Test
    fun `m4a with moov in head needs no tail probe`() {
        assertEquals(embeddedLyricText, EmbeddedLyric.parse(fixture("m4a-head-moov.bin")))
    }

    @Test
    fun `tail probe on non mp4 head is skipped`() {
        // 尾部探测只对 MP4 容器做：mp3 不会因为回读尾部而误判
        val mp3 = id3Tag(3, frame23("TIT2", byteArrayOf(0) + "title".toByteArray(Charsets.UTF_8)))
        org.junit.Assert.assertFalse(EmbeddedLyric.isMp4Container(mp3))
        assertNull(EmbeddedLyric.parseWithTail(mp3, fixture("m4a-tail-moov.bin")))
    }

    @Test
    fun `oversized tail returns null immediately`() {
        assertNull(EmbeddedLyric.parseWithTail(ByteArray(16), ByteArray(EmbeddedLyric.MAX_INPUT_BYTES + 1)))
    }
}
