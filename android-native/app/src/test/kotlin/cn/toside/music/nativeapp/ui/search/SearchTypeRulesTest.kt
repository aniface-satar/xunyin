package cn.toside.music.nativeapp.ui.search

import cn.toside.music.nativeapp.data.SearchTypes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 类型 tab 状态与置灰规则的纯逻辑用例（W6 laneB 段4）。
 *
 * 规则（对照 RN sources 收集：只收真有该能力的源）：
 * - 歌曲/歌单/专辑：五源 + all 全可用；
 * - 歌手：tx 实测不可用（RN 快照无 artist.js、综合搜索 singer 分区恒空，lane 报告留证）→ 置灰；
 * - 切到歌手类型时若当前源是 tx，必须回落到 kw。
 */
class SearchTypeRulesTest {
    @Test
    fun `four tabs are exposed with stable labels`() {
        assertEquals(listOf("music", "songlist", "album", "artist"), SearchTypes.ALL)
        assertEquals("歌曲", SearchTypes.label(SearchTypes.MUSIC))
        assertEquals("歌单", SearchTypes.label(SearchTypes.SONGLIST))
        assertEquals("专辑", SearchTypes.label(SearchTypes.ALBUM))
        assertEquals("歌手", SearchTypes.label(SearchTypes.ARTIST))
    }

    @Test
    fun `music songlist album enable every source`() {
        SearchTypes.ALL
            .filter { it != SearchTypes.ARTIST }
            .forEach { type ->
                val sources = SearchTypes.enabledSources(type)
                assertEquals(setOf("kw", "kg", "tx", "wy", "mg", "all"), sources)
            }
    }

    @Test
    fun `artist type greys out tx`() {
        val sources = SearchTypes.enabledSources(SearchTypes.ARTIST)
        assertTrue(!sources.contains("tx"))
        assertTrue(sources.containsAll(setOf("kw", "kg", "wy", "mg", "all")))
        assertFalse(SearchTypes.isSourceEnabled(SearchTypes.ARTIST, "tx"))
        assertTrue(SearchTypes.isSourceEnabled(SearchTypes.ARTIST, "kw"))
    }

    @Test
    fun `switching to artist from tx falls back to kw`() {
        assertEquals("kw", SearchTypes.effectiveSource(SearchTypes.ARTIST, "tx"))
        assertEquals("kw", SearchTypes.effectiveSource(SearchTypes.ARTIST, "kw"))
        assertEquals("all", SearchTypes.effectiveSource(SearchTypes.ARTIST, "all"))
        // 全源类型不回落
        assertEquals("tx", SearchTypes.effectiveSource(SearchTypes.ALBUM, "tx"))
        assertEquals("all", SearchTypes.effectiveSource(SearchTypes.MUSIC, "all"))
    }

    @Test
    fun `unknown type defaults to every source`() {
        assertEquals(setOf("kw", "kg", "tx", "wy", "mg", "all"), SearchTypes.enabledSources("unknown"))
        assertEquals("unknown label falls back to 歌曲", "歌曲", SearchTypes.label("unknown"))
    }

    @Test
    fun `artist runtime capability matrix matches greying rules`() {
        // 源清单与置灰规则同口径（tx 缺席）
        val expectedSources = SearchTypes.enabledSources(SearchTypes.ARTIST).sorted()
        val runtimeSources =
            cn.toside.music.nativeapp.data.ArtistSearchRuntime.SOURCES
                .map { it.first }
                .sorted()
        assertEquals(expectedSources, runtimeSources)
        // 详情能力：kw/kg/wy 可开，mg 仅搜索，tx 无搜索
        val runtime = cn.toside.music.nativeapp.data.ArtistSearchRuntime
        assertTrue(runtime.canOpenDetail("kw"))
        assertTrue(runtime.canOpenDetail("kg"))
        assertTrue(runtime.canOpenDetail("wy"))
        assertFalse(runtime.canOpenDetail("mg"))
        assertFalse(runtime.canOpenDetail("tx"))
    }
}
