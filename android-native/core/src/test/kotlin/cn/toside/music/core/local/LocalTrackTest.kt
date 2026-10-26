package cn.toside.music.core.local

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 本地曲目构造：对照 RN `listAction.ts#buildLocalMusicInfoByFilePath` /
 * `buildLocalMusicInfo` 与 `utils/common.ts#formatPlayTime2`。
 */
class LocalTrackTest {
    private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

    private fun JsonObject.metaText(key: String): String? =
        ((this["meta"] as? JsonObject)?.get(key) as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

    @Test
    fun `split name and extension follows lastIndexOf dot`() {
        assertEquals("a" to "mp3", LocalTrack.splitNameAndExtension("a.mp3"))
        assertEquals("song.name" to "flac", LocalTrack.splitNameAndExtension("song.name.flac"))
        // 无点：JS substring(0,-1) 归一为 ""，整个名字当扩展名（RN 的怪癖，照抄）
        assertEquals("" to "noext", LocalTrack.splitNameAndExtension("noext"))
        assertEquals("" to "mp3", LocalTrack.splitNameAndExtension(".mp3"))
    }

    @Test
    fun `formatPlayTime2 matches rn truncation and padding`() {
        assertEquals("00:00", LocalTrack.formatPlayTime2(0))
        assertEquals("00:59", LocalTrack.formatPlayTime2(59))
        assertEquals("01:01", LocalTrack.formatPlayTime2(61))
        assertEquals("03:21", LocalTrack.formatPlayTime2(201))
        // 分钟不封顶两位
        assertEquals("60:00", LocalTrack.formatPlayTime2(3600))
        assertEquals("99:59", LocalTrack.formatPlayTime2(5999))
        assertEquals("00:00", LocalTrack.formatPlayTime2(-5))
    }

    @Test
    fun `split artist only keeps first two segments`() {
        assertEquals("周杰伦" to "稻香", LocalTrack.splitArtist("周杰伦 - 稻香"))
        assertEquals("a" to "b", LocalTrack.splitArtist("a-b-c"))
        assertNull(LocalTrack.splitArtist("没有分隔符"))
    }

    @Test
    fun `placeholder matches rn field shape`() {
        val info = LocalTrack.buildPlaceholder("content://doc/song.mp3", "song.mp3")
        assertEquals("content://doc/song.mp3", info.text("id"))
        assertEquals("song", info.text("name"))
        assertEquals("", info.text("singer"))
        assertEquals("local", info.text("source"))
        assertEquals(JsonNull, info["interval"])
        assertEquals("content://doc/song.mp3", info.metaText("filePath"))
        assertEquals("content://doc/song.mp3", info.metaText("songId"))
        assertEquals("", info.metaText("picUrl"))
        assertEquals("mp3", info.metaText("ext"))
        assertEquals("", info.metaText("albumName"))
    }

    @Test
    fun `metadata overrides name singer album duration and keeps id`() {
        val meta =
            LocalTrack.Metadata(
                name = "稻香",
                singer = "周杰伦",
                albumName = "魔杰座",
                durationSec = 201,
                ext = "mp3",
            )
        val info = LocalTrack.buildInfo("content://doc/song.mp3", "song.mp3", meta, coverUri = "file:///c/cover")
        assertEquals("稻香", info.text("name"))
        assertEquals("周杰伦", info.text("singer"))
        assertEquals("03:21", info.text("interval"))
        assertEquals("魔杰座", info.metaText("albumName"))
        assertEquals("file:///c/cover", info.metaText("picUrl"))
        assertEquals("mp3", info.metaText("ext"))
        assertEquals("content://doc/song.mp3", info.text("id"))
    }

    @Test
    fun `blank tag title falls back to file stem so track is not dropped`() {
        val info = LocalTrack.buildInfo("content://doc/x.flac", "x.flac", LocalTrack.Metadata(name = "  "))
        assertEquals("x", info.text("name"))
        assertEquals("flac", info.metaText("ext"))
        assertEquals(JsonNull, info["interval"])
    }

    @Test
    fun `missing metadata behaves like placeholder`() {
        val info = LocalTrack.buildInfo("content://doc/y.wav", "y.wav", metadata = null)
        assertEquals("y", info.text("name"))
        assertEquals("", info.text("singer"))
        assertTrue(info["interval"] is JsonNull)
        assertEquals("wav", info.metaText("ext"))
    }

    @Test
    fun `dedupe key is id`() {
        val info = LocalTrack.buildPlaceholder("content://doc/song.mp3", "song.mp3")
        assertEquals("content://doc/song.mp3", LocalTrack.dedupeKey(info))
    }
}
