package cn.toside.music.core.songlist

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 五源共用工具与 id 归一化：
 * - 格式化函数对照 RN `formatPlayCount/sizeFormate/formatPlayTime/dateFormat`；
 * - 各源 `normalizeId` / kw `splitTag` 的边界（粘贴链接、`###token`、`id_` 前缀）。
 */
class SonglistUtilsTest {
    @Test
    fun `formatPlayCount keeps RN thresholds`() {
        assertEquals("1234", SonglistUtils.formatPlayCount(1_234))
        assertEquals("1.2万", SonglistUtils.formatPlayCount(12_345))
        assertEquals("1753万", SonglistUtils.formatPlayCount(17_530_000))
        assertEquals("1.2亿", SonglistUtils.formatPlayCount(123_456_789))
        assertEquals("1亿", SonglistUtils.formatPlayCount(100_000_001))
    }

    @Test
    fun `formatSize keeps two decimals and units`() {
        assertEquals("0 B", SonglistUtils.formatSize(0))
        assertEquals("1.00 KiB", SonglistUtils.formatSize(1024))
        assertEquals("2.52 MiB", SonglistUtils.formatSize(2_644_053))
        assertEquals("52.83 MiB", SonglistUtils.formatSize(55_395_000))
    }

    @Test
    fun `formatPlayTime renders mm ss and placeholder`() {
        assertEquals("--/--", SonglistUtils.formatPlayTime(0))
        assertEquals("02:43", SonglistUtils.formatPlayTime(163))
        assertEquals("60:00", SonglistUtils.formatPlayTime(3600))
    }

    @Test
    fun `formatDate renders local Y-M-D`() {
        val millis = 1_600_000_000_000L
        val calendar =
            java.util.Calendar
                .getInstance()
                .apply { timeInMillis = millis }
        val expected =
            String.format(
                java.util.Locale.US,
                "%04d-%02d-%02d",
                calendar.get(java.util.Calendar.YEAR),
                calendar.get(java.util.Calendar.MONTH) + 1,
                calendar.get(java.util.Calendar.DAY_OF_MONTH),
            )
        assertEquals(expected, SonglistUtils.formatDate(millis))
        assertEquals("", SonglistUtils.formatDate(0))
    }

    @Test
    fun `kw splitTag and normalizeId`() {
        assertEquals("2189" to "10000", KwSonglist.splitTag("2189-10000"))
        assertEquals("1" to "43", KwSonglist.splitTag("1-43"))
        assertEquals(null to null, KwSonglist.splitTag(null))
        assertEquals("123", KwSonglist.normalizeId("https://www.kuwo.cn/playlist_detail/123"))
        assertEquals("123", KwSonglist.normalizeId("https://m.kuwo.cn/h5app/playlist/123?t=qqfriend"))
        assertEquals("digest-8__456", KwSonglist.normalizeId("digest-8__456"))
    }

    @Test
    fun `kw list urls encode tag type and page`() {
        assertTrue(KwSonglist.listUrl("new", null, null, 2).contains("getRcmPlayList"))
        assertTrue(KwSonglist.listUrl("new", null, null, 2).endsWith("pn=2&rn=36&order=new"))
        assertTrue(KwSonglist.listUrl("hot", "2189", "10000", 1).contains("getTagPlayList"))
        assertTrue(KwSonglist.listUrl("hot", "1", "43", 1).contains("er.s?type=get_pc_qz_data"))
        assertTrue(KwSonglist.detailUrl("42", 2).contains("pid=42&pn=1&rn=1000"))
    }

    @Test
    fun `tx normalizeId accepts share links`() {
        assertEquals("7707261125", TxSonglist.normalizeId("https://y.qq.com/n/ryqq/playlist/7707261125"))
        assertEquals(
            "7707261125",
            TxSonglist.normalizeId(
                "https://i.y.qq.com/n2/m/share/details/taoge.html?platform=11&appshare=android_qq&id=7707261125&ADTAG=qfshare",
            ),
        )
        assertEquals("7707261125", TxSonglist.normalizeId("7707261125"))
        // playsquare 链接 RN 靠跟一次重定向解析（handleParseId），本波未接 → 明确失败
        assertTrue(
            runCatching {
                TxSonglist.normalizeId("https://y.qq.com/n/yqq/playsquare/7707261125.html")
            }.isFailure,
        )
    }

    @Test
    fun `wy normalizeId splits token and extracts numeric id`() {
        assertEquals("123" to null, WySonglist.normalizeId("123"))
        assertEquals(
            "123" to "MUSIC_U=token",
            WySonglist.normalizeId("https://music.163.com/playlist?id=123&userid=1###token"),
        )
        assertEquals("123" to null, WySonglist.normalizeId("https://music.163.com/playlist?id=123&userid=1"))
        assertEquals("123" to null, WySonglist.normalizeId("https://music.163.com/#/playlist/123/456/abc"))
        // 只有一个数字段（无 `id=`）的链接 RN 靠跟重定向解析，本波未接 → 明确失败
        assertTrue(
            runCatching {
                WySonglist.normalizeId("https://music.163.com/playlist/123/")
            }.isFailure,
        )
    }

    @Test
    fun `kg normalizeId accepts list ids and special links only`() {
        assertEquals("3339907", KgSonglist.normalizeId("id_3339907"))
        assertEquals(
            "3339907",
            KgSonglist.normalizeId("https://www.kugou.com/yy/special/single/3339907.html"),
        )
        // 纯数字是酷狗码（另一套接口），本波不支持
        assertTrue(runCatching { KgSonglist.normalizeId("3339907") }.isFailure)
        assertTrue(
            runCatching {
                KgSonglist.normalizeId("https://www.kugou.com/yy/special/single/abc.html")
            }.isFailure,
        )
    }

    @Test
    fun `sources table keeps RN ordering and labels`() {
        assertEquals(
            listOf("kw", "kg", "tx", "wy", "mg"),
            Songlists.SOURCES.map { it.first },
        )
        assertEquals("酷我音乐", Songlists.SOURCES.first().second)
        assertEquals("咪咕音乐", Songlists.SOURCES.last().second)
        assertEquals(30, Songlists.LIST_LOAD_LIMIT)
    }
}
