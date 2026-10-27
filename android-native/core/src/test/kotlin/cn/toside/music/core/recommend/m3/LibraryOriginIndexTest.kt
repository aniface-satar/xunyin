package cn.toside.music.core.recommend.m3

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 导入来源索引 —— 对照 RN `core/recommend/libraryIndex.ts`
 * （`getPlaylistOriginKey` / `buildLibraryIndexData` 的 `origins` 字段）。
 *
 * 关键语义：来源判断只看歌单级 `source` + `sourceListId`，RN 没有逐曲来源元数据；
 * 缺任一项的歌单（含收藏、默认列表）不贡献归因。
 */
class LibraryOriginIndexTest {
    private fun playlist(
        id: String,
        tracks: List<String>,
        source: String? = null,
        sourceListId: String? = null,
    ) = LibraryIndex.PlaylistOriginInput(
        id = id,
        source = source,
        sourceListId = sourceListId,
        trackKeys = tracks,
    )

    @Test
    fun `有来源的歌单给每首歌记一个来源键`() {
        val index =
            LibraryIndex.buildOriginIndex(
                listOf(playlist("list_1", listOf("晴天::周杰伦", "十年::陈奕迅"), source = "tx", sourceListId = "123")),
            )
        assertEquals(listOf("tx::123"), index["晴天::周杰伦"])
        assertEquals(listOf("tx::123"), index["十年::陈奕迅"])
    }

    @Test
    fun `缺来源或缺来源歌单 id 的歌单不贡献归因`() {
        val index =
            LibraryIndex.buildOriginIndex(
                listOf(
                    playlist("love", listOf("t1")),
                    playlist("list_2", listOf("t2"), source = "kw"),
                    playlist("list_3", listOf("t3"), sourceListId = "9"),
                    playlist("list_4", listOf("t4"), source = "", sourceListId = "9"),
                ),
            )
        assertEquals(emptyMap<String, List<String>>(), index)
    }

    @Test
    fun `同一首来自多张网络歌单时来源去重保序`() {
        val index =
            LibraryIndex.buildOriginIndex(
                listOf(
                    playlist("a", listOf("t1", "t2"), source = "tx", sourceListId = "1"),
                    playlist("b", listOf("t1"), source = "wy", sourceListId = "2"),
                    playlist("c", listOf("t1"), source = "tx", sourceListId = "1"),
                ),
            )
        assertEquals(listOf("tx::1", "wy::2"), index["t1"])
        assertEquals(listOf("tx::1"), index["t2"])
    }

    @Test
    fun `空 trackKey 不入表而其它曲目照常记录`() {
        val index =
            LibraryIndex.buildOriginIndex(
                listOf(playlist("a", listOf("", "t1"), source = "kg", sourceListId = "7")),
            )
        assertEquals(setOf("t1"), index.keys)
        assertEquals(listOf("kg::7"), index["t1"])
    }

    @Test
    fun `来源键与排序侧的歌单键同源`() {
        val key = LibraryIndex.playlistOriginKey(playlist("a", listOf("t"), source = "mg", sourceListId = "42"))
        assertEquals("mg::42", key)
        assertNull(LibraryIndex.playlistOriginKey(playlist("a", listOf("t"))))
    }
}
