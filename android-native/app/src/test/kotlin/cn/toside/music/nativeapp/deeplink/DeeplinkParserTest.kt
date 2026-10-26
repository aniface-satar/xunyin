package cn.toside.music.nativeapp.deeplink

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * deeplink 解析样本表（任务书验收：`lxmusic://...` 样本进 JVM 单测）。
 *
 * 期望值逐条对照 RN `src/core/init/deeplink/index.ts` + `songlistAction.js` +
 * `playerAction.ts` + `fileAction.ts` 的实际分支，不按直觉写。
 */
class DeeplinkParserTest {
    /** RN 侧是 encodeURIComponent：空格编成 %20 而不是 +（解析器按前者的语义解）。 */
    private fun encode(raw: String): String =
        java.net.URLEncoder
            .encode(raw, "UTF-8")
            .replace("+", "%20")

    private fun songlist(command: DeeplinkCommand?): DeeplinkCommand.SonglistPlay = command as DeeplinkCommand.SonglistPlay

    private fun player(command: DeeplinkCommand?): PlayerActionKind = (command as DeeplinkCommand.PlayerAction).action

    @Test
    fun `songlist play with source url and index`() {
        val command =
            songlist(
                DeeplinkParser.parse("lxmusic://songlist/play/kw/https%3A%2F%2Fexample.com%2Fsonglist%3Fid%3D42/3"),
            )
        assertEquals("kw", command.source)
        assertNull(command.id)
        assertEquals("https://example.com/songlist?id=42", command.url)
        assertEquals(3, command.index)
    }

    @Test
    fun `songlist play reads data json first`() {
        val data = """{"source":"tx","id":"7001","index":2}"""
        val encoded = encode(data)
        val command = songlist(DeeplinkParser.parse("lxmusic://songlist/play?data=$encoded"))
        assertEquals("tx", command.source)
        assertEquals("7001", command.id)
        assertNull(command.url)
        assertEquals(2, command.index)
    }

    @Test
    fun `songlist play without id or url is rejected`() {
        val invalid = DeeplinkParser.parse("lxmusic://songlist/play/kw") as DeeplinkCommand.Invalid
        assertEquals("id or url missing", invalid.reason)
    }

    @Test
    fun `unknown source is rejected like rn sourceVerify`() {
        val invalid = DeeplinkParser.parse("lxmusic://songlist/play/local/abc") as DeeplinkCommand.Invalid
        assertEquals("Source no match", invalid.reason)
    }

    @Test
    fun `index out of range is dropped not rejected`() {
        val command = songlist(DeeplinkParser.parse("lxmusic://songlist/play/kg/abc/9999999"))
        assertNull(command.index)
    }

    @Test
    fun `all player actions map to enum`() {
        val expected =
            mapOf(
                "play" to PlayerActionKind.PLAY,
                "pause" to PlayerActionKind.PAUSE,
                "skipNext" to PlayerActionKind.SKIP_NEXT,
                "skipPrev" to PlayerActionKind.SKIP_PREV,
                "togglePlay" to PlayerActionKind.TOGGLE_PLAY,
                "collect" to PlayerActionKind.COLLECT,
                "uncollect" to PlayerActionKind.UNCOLLECT,
                "dislike" to PlayerActionKind.DISLIKE,
            )
        expected.forEach { (action, kind) ->
            assertEquals(kind, player(DeeplinkParser.parse("lxmusic://player/$action")))
        }
    }

    @Test
    fun `unknown player action is invalid`() {
        // RN 的 switch 没有 default 分支：既不动播控也不报错，这里折成 Invalid 由调用方静默
        val invalid = DeeplinkParser.parse("lxmusic://player/rewind") as DeeplinkCommand.Invalid
        assertEquals("Unknown action: rewind", invalid.reason)
    }

    @Test
    fun `music play builds native music info from data`() {
        val data =
            """
            {"name":"晴天","singer":"周杰伦","source":"kw","songmid":"12345","interval":"04:29",
             "img":"https://img.example.com/a.jpg","albumName":"叶惠美",
             "types":[{"type":"128k","size":"4.1M"},{"type":"flac","size":"28M"}]}
            """.trimIndent()
        val encoded = encode(data)
        val command = DeeplinkParser.parse("lxmusic://music/play?data=$encoded") as DeeplinkCommand.MusicPlay
        val info = command.musicInfo
        assertEquals("12345", info.str("id"))
        assertEquals("晴天", info.str("name"))
        assertEquals("周杰伦", info.str("singer"))
        assertEquals("kw", info.str("source"))
        assertEquals("04:29", info.str("interval"))
        val meta = info["meta"]!!.jsonObject
        assertEquals("12345", meta.str("songmid"))
        assertEquals("叶惠美", meta.str("albumName"))
        assertEquals("https://img.example.com/a.jpg", meta.str("picUrl"))
        assertEquals(listOf("128k", "flac"), (meta["qualitys"] as JsonArray).map { (it as JsonPrimitive).content })
        assertEquals("28M", meta["_qualitys"]!!.jsonObject["flac"]!!.jsonObject.str("size"))
        assertEquals(false, command.playLater)
    }

    @Test
    fun `music play keeps playLater flag`() {
        val data = """{"name":"a","singer":"b","source":"wy","songmid":"9","playLater":true}"""
        val encoded = encode(data)
        val command = DeeplinkParser.parse("lxmusic://music/play?data=$encoded") as DeeplinkCommand.MusicPlay
        assertTrue(command.playLater)
    }

    @Test
    fun `music play without data is rejected`() {
        val invalid = DeeplinkParser.parse("lxmusic://music/play/晴天-周杰伦") as DeeplinkCommand.Invalid
        assertEquals("data missing", invalid.reason)
    }

    @Test
    fun `music play rejects unknown source`() {
        val data = """{"name":"a","singer":"b","source":"local","songmid":"9"}"""
        val encoded = encode(data)
        val invalid = DeeplinkParser.parse("lxmusic://music/play?data=$encoded") as DeeplinkCommand.Invalid
        assertEquals("data invalid", invalid.reason)
    }

    @Test
    fun `file links only accept json and lxmc this wave`() {
        val json = DeeplinkParser.parse("content://com.android.providers.downloads/document/1/a.json")
        assertEquals("json", (json as DeeplinkCommand.OpenFile).extension)
        val lxmc = DeeplinkParser.parse("file:///storage/emulated/0/Download/lx_list_part_x.lxmc")
        assertEquals("lxmc", (lxmc as DeeplinkCommand.OpenFile).extension)
        val js = DeeplinkParser.parse("content://com.android.providers.downloads/document/1/a.js") as DeeplinkCommand.Invalid
        assertEquals("暂不支持打开 .js 文件", js.reason)
        val mp3 = DeeplinkParser.parse("file:///storage/emulated/0/Music/a.mp3") as DeeplinkCommand.Invalid
        assertEquals("暂不支持打开 .mp3 文件", mp3.reason)
    }

    @Test
    fun `non lxmusic links are ignored`() {
        assertNull(DeeplinkParser.parse("https://example.com/a"))
        assertNull(DeeplinkParser.parse(""))
        assertNull(DeeplinkParser.parse(null))
    }

    @Test
    fun `percent decoding keeps plus sign`() {
        // decodeURIComponent 不把 + 当空格，URLDecoder 默认会——解析器要对齐前者
        val command = songlist(DeeplinkParser.parse("lxmusic://songlist/play/kw/a+b"))
        assertEquals("a+b", command.url)
    }

    @Test
    fun `query value is truncated at the second equals like rn`() {
        // RN 用 const [key, value] = param.split('=') 解构，值里再出现 = 会被截断
        val command = DeeplinkParser.parse("lxmusic://player/play?x=1=2")
        assertEquals(PlayerActionKind.PLAY, player(command))
    }

    @Test
    fun `music info is a json object after sanitize contract`() {
        val data = """{"name":"a","singer":"b","source":"kg","songmid":"9","hash":"HASH"}"""
        val encoded = encode(data)
        val command = DeeplinkParser.parse("lxmusic://music/play?data=$encoded") as DeeplinkCommand.MusicPlay
        val meta = command.musicInfo["meta"] as JsonObject
        assertEquals("HASH", meta.str("hash"))
        assertTrue(meta.containsKey("songId"))
    }

    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.content
}
