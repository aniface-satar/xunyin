package cn.toside.music.core.list

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 外部歌单与自建歌单同认判据（对照 RN SonglistDetail/listAction.ts#isSameSourceList）。
 *
 * sourceListId 历史上有两种写法：裸 id（`handleImportAsList`）与 `source__id`
 * （`handlePlay` 的临时列表元信息）；两种都要认作同一张歌单。
 */
class SourceListMatchTest {
    private fun info(
        id: String,
        source: String?,
        sourceListId: String?,
    ) = ListStore.UserListInfo(id = id, name = id, source = source, sourceListId = sourceListId)

    @Test
    fun rawSourceListIdMatches() {
        assertTrue(SourceListMatch.isSame(info("u1", "kw", "2858093057"), "kw", "2858093057"))
    }

    @Test
    fun compositeSourceListIdMatches() {
        assertTrue(SourceListMatch.isSame(info("u1", "kw", "kw__2858093057"), "kw", "2858093057"))
    }

    @Test
    fun differentSourceOrIdDoesNotMatch() {
        assertFalse(SourceListMatch.isSame(info("u1", "kg", "2858093057"), "kw", "2858093057"))
        assertFalse(SourceListMatch.isSame(info("u1", "kw", "1"), "kw", "2858093057"))
        assertFalse(SourceListMatch.isSame(info("u1", null, null), "kw", "2858093057"))
    }

    @Test
    fun findPicksFirstMatchingList() {
        val lists =
            listOf(
                info("u1", "tx", "1"),
                info("u2", "kw", "kw__2858093057"),
                info("u3", "kw", "2858093057"),
            )
        assertEquals("u2", SourceListMatch.find(lists, "kw", "2858093057")?.id)
        assertNull(SourceListMatch.find(lists, "wy", "2858093057"))
    }
}
