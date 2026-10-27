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

    /** W5-10：本波把 RN `handleFileAction` 的七种扩展名补齐，落点见 [FileKind]。 */
    @Test
    fun `file links map to the three rn branches`() {
        val cases =
            listOf(
                "content://com.android.providers.downloads/document/1/a.json" to FileKind.LIST_BACKUP,
                "file:///storage/emulated/0/Download/lx_list_part_x.lxmc" to FileKind.LIST_BACKUP,
                "content://com.android.providers.downloads/document/1/a.js" to FileKind.USER_API_SCRIPT,
                "file:///storage/emulated/0/Music/a.mp3" to FileKind.AUDIO,
                "file:///storage/emulated/0/Music/a.flac" to FileKind.AUDIO,
                "file:///storage/emulated/0/Music/a.wav" to FileKind.AUDIO,
                "file:///storage/emulated/0/Music/a.ogg" to FileKind.AUDIO,
                // 扩展名大小写不敏感：RN 的 extname 不做小写化，但 SAF 的显示名可能带大写后缀
                "file:///storage/emulated/0/Music/a.MP3" to FileKind.AUDIO,
            )
        cases.forEach { (link, kind) ->
            val file = DeeplinkParser.parse(link) as DeeplinkCommand.OpenFile
            assertEquals(link, kind, file.kind)
            assertEquals(link, link.substringAfterLast('.', "").lowercase(), file.extension)
        }
    }

    @Test
    fun `file links outside the whitelist stay rejected`() {
        val apk = DeeplinkParser.parse("file:///storage/emulated/0/Download/a.apk") as DeeplinkCommand.Invalid
        assertEquals("暂不支持打开 .apk 文件", apk.reason)
        // RN 的 default 分支靠 mime 兜底音频，SAF 侧没有稳定 mime，未白名单一律拒绝
        val m4a = DeeplinkParser.parse("file:///storage/emulated/0/Music/a.m4a") as DeeplinkCommand.Invalid
        assertEquals("暂不支持打开 .m4a 文件", m4a.reason)
    }

    /** RN `handleSearchPlayMusic`：paths 优先，按第一个 `-` 拆「歌名 - 歌手」。 */
    @Test
    fun `music searchPlay splits name and singer from path`() {
        val command =
            DeeplinkParser.parse("lxmusic://music/searchPlay/${encode("晴天 - 周杰伦")}")
                as DeeplinkCommand.SearchPlay
        assertEquals("晴天", command.name)
        assertEquals("周杰伦", command.singer)
        assertEquals("", command.albumName)
        assertNull(command.interval)
        assertEquals(false, command.playLater)
    }

    @Test
    fun `music searchPlay keeps only the first two dash segments`() {
        val command =
            DeeplinkParser.parse("lxmusic://music/searchPlay/${encode("a - b - c")}")
                as DeeplinkCommand.SearchPlay
        assertEquals("a", command.name)
        assertEquals("b", command.singer)
    }

    @Test
    fun `music searchPlay without dash leaves singer empty`() {
        val command = DeeplinkParser.parse("lxmusic://music/searchPlay/${encode("晴天")}") as DeeplinkCommand.SearchPlay
        assertEquals("晴天", command.name)
        assertEquals("", command.singer)
    }

    @Test
    fun `music searchPlay reads data json when no path`() {
        val data = """{"name":"晴天","singer":"周杰伦","albumName":"叶惠美","interval":"04:29","playLater":true}"""
        val command =
            DeeplinkParser.parse("lxmusic://music/searchPlay?data=${encode(data)}") as DeeplinkCommand.SearchPlay
        assertEquals("晴天", command.name)
        assertEquals("周杰伦", command.singer)
        assertEquals("叶惠美", command.albumName)
        assertEquals("04:29", command.interval)
        assertTrue(command.playLater)
    }

    /** RN `if (!info.name) return`：空歌名是静默返回，不是报错 → 解析器返回 null。 */
    @Test
    fun `music searchPlay with empty name is ignored like rn`() {
        assertNull(DeeplinkParser.parse("lxmusic://music/searchPlay/%20"))
        assertNull(DeeplinkParser.parse("lxmusic://music/searchPlay?data=${encode("""{"name":""}""")}"))
    }

    /** `dataVerify` 的 max 规则：超长照样抛（这里折成 Invalid）。 */
    @Test
    fun `music searchPlay enforces rn max lengths`() {
        val longName = "a".repeat(201)
        val invalid =
            DeeplinkParser.parse("lxmusic://music/searchPlay/${encode(longName)}") as DeeplinkCommand.Invalid
        assertEquals("name max length no match", invalid.reason)
        val longAlbum =
            DeeplinkParser.parse(
                "lxmusic://music/searchPlay?data=${encode("""{"name":"a","albumName":"${"b".repeat(65)}"}""")}",
            ) as DeeplinkCommand.Invalid
        assertEquals("albumName max length no match", longAlbum.reason)
    }

    @Test
    fun `music searchPlay without path or data is invalid`() {
        val invalid = DeeplinkParser.parse("lxmusic://music/searchPlay") as DeeplinkCommand.Invalid
        assertEquals("data missing", invalid.reason)
    }

    @Test
    fun `unknown music action stays invalid`() {
        val invalid = DeeplinkParser.parse("lxmusic://music/rewind/a") as DeeplinkCommand.Invalid
        assertEquals("Unknown action: rewind", invalid.reason)
    }

    @Test
    fun `non lxmusic links are ignored`() {
        assertNull(DeeplinkParser.parse("https://example.com/a"))
        assertNull(DeeplinkParser.parse(""))
        assertNull(DeeplinkParser.parse(null))
    }

    // ---------- W8-C 任务 6：五源歌单网页 http(s) 直达 ----------

    @Test
    fun `https songlist links resolve for all five sources`() {
        // 各源用户分享页形态（对照各源 normalizeId 的链接规则）
        val cases =
            mapOf(
                "kw" to "https://www.kuwo.cn/playlist_detail/6597544",
                "kg" to "https://www.kugou.com/yy/special/single/12345.html",
                "tx" to "https://y.qq.com/n/ryqq/playlist/8682232291",
                "wy" to "https://music.163.com/playlist?id=24381616",
                "mg" to "https://music.migu.cn/v3/music/playlist/183033588",
            )
        cases.forEach { (source, url) ->
            val command = songlist(DeeplinkParser.parse(url))
            assertEquals(source, command.source)
            assertTrue("id expected for $url", !command.id.isNullOrEmpty())
            assertNull(command.url)
            assertNull(command.index)
        }
    }

    @Test
    fun `https wy playlist with hash fragment resolves`() {
        // 网易云常见的 #/playlist?id= 形态
        val command = songlist(DeeplinkParser.parse("https://music.163.com/#/playlist?id=24381616"))
        assertEquals("wy", command.source)
        assertEquals("24381616", command.id)
    }

    @Test
    fun `https links outside the host whitelist stay untouched`() {
        // 白名单外：不是本应用的链接（浏览器自己开）
        assertNull(DeeplinkParser.parse("https://www.kuwo.cn.evil.example/playlist_detail/1"))
        assertNull(DeeplinkParser.parse("https://y.qq.com.evil.example/n/ryqq/playlist/1"))
        assertNull(DeeplinkParser.parse("https://api.music.163.com/playlist?id=1"))
    }

    @Test
    fun `https whitelisted host without playlist id stays untouched`() {
        // host 命中但不是歌单页：解析不出 id，留给浏览器
        assertNull(DeeplinkParser.parse("https://www.kuwo.cn/"))
        assertNull(DeeplinkParser.parse("https://music.163.com/"))
    }

    @Test
    fun `http scheme also resolves for whitelisted hosts`() {
        val command = songlist(DeeplinkParser.parse("http://www.kuwo.cn/playlist_detail/6597544"))
        assertEquals("kw", command.source)
        assertEquals("6597544", command.id)
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
