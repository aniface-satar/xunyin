package cn.toside.music.core.songlist

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 粘贴式打开歌单的 id 判定链（对照 RN SongList/HeaderBar/OpenList/Modal + 各源 getListId）。
 *
 * 入口语义：用户先选来源，再粘贴该来源的链接或 id。跨源不猜（RN 提示「不支持跨源打开歌单」）。
 */
class SonglistLinkParserTest {
    @Test
    fun parsesKwDetailLinkAndPlainId() {
        assertEquals(
            ParsedSonglistLink("kw", "2858093057"),
            SonglistLinkParser.parse("https://www.kuwo.cn/playlist_detail/2858093057", "kw"),
        )
        assertEquals(
            ParsedSonglistLink("kw", "2858093057"),
            SonglistLinkParser.parse(" 2858093057 ", "kw"),
        )
    }

    @Test
    fun parsesTxPlaylistLink() {
        assertEquals(
            ParsedSonglistLink("tx", "7011264347"),
            SonglistLinkParser.parse("https://y.qq.com/n/ryqq/playlist/7011264347", "tx"),
        )
        assertEquals(
            ParsedSonglistLink("tx", "7011264347"),
            SonglistLinkParser.parse("https://i.y.qq.com/n2/m/share/details/taoge.html?id=7011264347", "tx"),
        )
    }

    @Test
    fun parsesWyLinkAndKeepsTokenForm() {
        assertEquals(
            ParsedSonglistLink("wy", "24381616"),
            SonglistLinkParser.parse("https://music.163.com/#/playlist?id=24381616", "wy"),
        )
        // ###token 必须原样传给详情层，否则私人雷达拿不到 MUSIC_U
        assertEquals(
            ParsedSonglistLink("wy", "24381616###TOKEN"),
            SonglistLinkParser.parse("24381616###TOKEN", "wy"),
        )
    }

    @Test
    fun parsesKgSpecialLinkButRejectsKugouCode() {
        assertEquals(
            ParsedSonglistLink("kg", "123456"),
            SonglistLinkParser.parse("https://www.kugou.com/yy/special/single/123456.html", "kg"),
        )
        assertEquals(
            ParsedSonglistLink("kg", "123456"),
            SonglistLinkParser.parse("id_123456", "kg"),
        )
        // 纯数字是酷狗码，RN 走 t.kugou.com/command 另一套接口，本波未移植
        assertNull(SonglistLinkParser.parse("123456", "kg"))
    }

    @Test
    fun parsesMgLinks() {
        assertEquals(
            ParsedSonglistLink("mg", "221573417"),
            SonglistLinkParser.parse("https://music.migu.cn/v5/#/playlist?playlistId=221573417", "mg"),
        )
        assertEquals(
            ParsedSonglistLink("mg", "184187437"),
            SonglistLinkParser.parse("https://h5.nf.migu.cn/app/v4/p/share/playlist/index.html?id=184187437", "mg"),
        )
        assertEquals(
            ParsedSonglistLink("mg", "221573417"),
            SonglistLinkParser.parse("221573417", "mg"),
        )
    }

    @Test
    fun rejectsGarbageButDoesNotGuessHost() {
        // RN 的 kw 正则只认 /playlist/<id> 形状，不校验域名（跨源由用户选对来源负责）
        assertEquals(
            ParsedSonglistLink("kw", "7011264347"),
            SonglistLinkParser.parse("https://y.qq.com/n/ryqq/playlist/7011264347", "kw"),
        )
        assertNull(SonglistLinkParser.parse("https://example.com/abc", "kw"))
        assertNull(SonglistLinkParser.parse("https://example.com/abc", "tx"))
        assertNull(SonglistLinkParser.parse("", "kw"))
        assertNull(SonglistLinkParser.parse("   ", "wy"))
    }
}
