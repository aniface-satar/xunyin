package cn.toside.music.core.songlist

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 推荐官方内容通道的冷启动选择规则（RN tabSections.ts 去掉画像后的子集）。
 * 全部纯函数，不触网。
 */
class RecommendSelectionTest {
    @Test
    fun `new song boards prefer shortest new-song name`() {
        val boards =
            listOf(
                RecommendBoard("kw", "kw__290", "ACG新歌榜"),
                RecommendBoard("kw", "kw__17", "新歌榜"),
                RecommendBoard("kw", "kw__153", "网红新歌榜"),
                RecommendBoard("kw", "kw__16", "热歌榜"),
            )
        assertEquals("kw__17", RecommendSelection.pickNewSongBoard(boards)?.id)
        // 名字长度：新歌榜(3) < 网红新歌榜(5) < ACG新歌榜(6)
        assertEquals(listOf("kw__17", "kw__153", "kw__290"), RecommendSelection.newSongBoardCandidates(boards).map { it.id })
    }

    @Test
    fun `falls back to rising boards when no new-song board`() {
        val boards =
            listOf(
                RecommendBoard("kg", "kg__8888", "TOP500"),
                RecommendBoard("kg", "kg__6666", "飙升榜"),
            )
        assertEquals("kg__6666", RecommendSelection.pickNewSongBoard(boards)?.id)
    }

    @Test
    fun `no new or rising board yields null`() {
        val boards = listOf(RecommendBoard("wy", "wy__1", "热歌榜"), RecommendBoard("wy", "wy__2", "欧美榜"))
        assertNull(RecommendSelection.pickNewSongBoard(boards))
        assertNull(RecommendSelection.pickNewSongBoard(emptyList()))
    }

    @Test
    fun `english new keyword is matched case-insensitively`() {
        val boards = listOf(RecommendBoard("tx", "tx__26", "NEW TOP 100"))
        assertEquals("tx__26", RecommendSelection.pickNewSongBoard(boards)?.id)
    }

    @Test
    fun `hot sort wins over the first sort`() {
        val sorts =
            listOf(
                SonglistSort("5", "推荐", "recommend"),
                SonglistSort("6", "最热", "hot"),
            )
        assertEquals("6", RecommendSelection.pickHotSort(sorts)?.id)
    }

    @Test
    fun `hot sort matches tid when the name does not`() {
        val sorts = listOf(SonglistSort("hot", "推荐", "hot"), SonglistSort("new", "最新", "new"))
        assertEquals("hot", RecommendSelection.pickHotSort(sorts)?.id)
    }

    @Test
    fun `hot sort falls back to the first sort`() {
        val sorts = listOf(SonglistSort("15127315", "推荐", "recommend"))
        assertEquals("15127315", RecommendSelection.pickHotSort(sorts)?.id)
        assertNull(RecommendSelection.pickHotSort(emptyList()))
    }

    @Test
    fun `flatten tags keeps group order and skips hot tags when groups exist`() {
        val tags =
            SonglistTags(
                tags =
                    listOf(
                        SonglistTagGroup("主题", listOf(SonglistTag("1", "流行"), SonglistTag("2", "摇滚"))),
                        SonglistTagGroup("心情", listOf(SonglistTag("3", "治愈"))),
                    ),
                hotTags = listOf(SonglistTag("9", "热门")),
                source = "kw",
            )
        assertEquals(listOf("1", "2", "3"), RecommendSelection.flattenTags(tags).map { it.id })
    }

    @Test
    fun `flatten tags falls back to hot tags when groups are empty`() {
        val tags =
            SonglistTags(
                tags = emptyList(),
                hotTags = listOf(SonglistTag("9", "经典"), SonglistTag("10", "怀旧")),
                source = "kg",
            )
        assertEquals(listOf("9", "10"), RecommendSelection.flattenTags(tags).map { it.id })
    }

    @Test
    fun `pick tag rotates through the catalogue`() {
        val tags = listOf(SonglistTag("a", "A"), SonglistTag("b", "B"), SonglistTag("c", "C"))
        assertEquals("a", RecommendSelection.pickTag(tags, 0)?.id)
        assertEquals("b", RecommendSelection.pickTag(tags, 1)?.id)
        assertEquals("b", RecommendSelection.pickTag(tags, 4)?.id)
        // 负轮次也能落到合法下标（Kotlin 取模与 JS 不同，需 floorMod）
        assertEquals("c", RecommendSelection.pickTag(tags, -1)?.id)
        assertNull(RecommendSelection.pickTag(emptyList(), 3))
    }
}
