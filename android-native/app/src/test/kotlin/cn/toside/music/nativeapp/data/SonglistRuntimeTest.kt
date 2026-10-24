package cn.toside.music.nativeapp.data

import cn.toside.music.core.songlist.PlaylistItem
import cn.toside.music.core.songlist.SonglistPage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `SonglistRuntime` 的纯规则：列表是否到底。
 *
 * total 取法逐项对照 RN `songlistActions.setList`：第 1 页或有数据且有 total
 * 时用返回值，翻页拿到空页/无 total 时按 `limit * page` 兜底。
 */
class SonglistRuntimeTest {
    private fun page(
        total: Int,
        limit: Int = 30,
        size: Int = 0,
    ) = SonglistPage(
        list = List(size) { index -> PlaylistItem(id = "kw_$index", name = "歌单$index", source = "kw") },
        total = total,
        limit = limit,
        page = 1,
        source = "kw",
    )

    @Test
    fun first_page_is_not_end_when_total_exceeds_limit() {
        assertFalse(SonglistRuntime.reachedEnd(page(total = 100), 1))
        assertFalse(SonglistRuntime.reachedEnd(page(total = 100, size = 30), 1))
    }

    @Test
    fun last_page_of_total_is_end() {
        assertTrue(SonglistRuntime.reachedEnd(page(total = 120, size = 30), 4))
        assertFalse(SonglistRuntime.reachedEnd(page(total = 120, size = 30), 3))
    }

    @Test
    fun empty_page_without_total_falls_back_to_limit_times_page() {
        // 第 2 页返回空且 total=0：total 兜底成 60，maxPage=2，当前页即到底
        assertTrue(SonglistRuntime.reachedEnd(page(total = 0), 2))
        // 第 3 页返回空：total=90，maxPage=3
        assertTrue(SonglistRuntime.reachedEnd(page(total = 0), 3))
    }

    @Test
    fun first_page_without_data_is_end() {
        assertTrue(SonglistRuntime.reachedEnd(page(total = 0), 1))
    }

    @Test
    fun zero_limit_falls_back_to_thirty() {
        assertTrue(SonglistRuntime.reachedEnd(page(total = 30, limit = 0, size = 30), 1))
        assertFalse(SonglistRuntime.reachedEnd(page(total = 60, limit = 0, size = 30), 1))
    }

    @Test
    fun source_tables_expose_five_sources_and_sorts() {
        assertEquals(listOf("kw", "kg", "tx", "wy", "mg"), SonglistRuntime.SOURCES.map { it.first })
        assertEquals("5", SonglistRuntime.sort("kg", "5")?.id)
        assertEquals(null, SonglistRuntime.sort("kg", "nope"))
        assertTrue(SonglistRuntime.sorts("tx").isNotEmpty())
        assertTrue(SonglistRuntime.isSupported("mg"))
        assertFalse(SonglistRuntime.isSupported("bd"))
    }
}
