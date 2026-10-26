package cn.toside.music.core.local

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 失效曲目批量判定（W6-5）—— 逐曲 query 换成「每个树根列一次 children + 集合比对」。
 */
class LocalStaleScanTest {
    private fun track(
        id: String,
        documentId: String?,
    ) = LocalStaleScan.Track(id = id, documentId = documentId)

    @Test
    fun missingFromListingIsStale() {
        val result =
            LocalStaleScan.scan(
                tracks =
                    listOf(
                        track("a", "primary:Music/a.mp3"),
                        track("b", "primary:Music/b.mp3"),
                    ),
                listedIds = setOf("primary:Music/a.mp3"),
            )
        assertEquals(listOf("b"), result.stale)
        assertTrue(result.unresolved.isEmpty())
    }

    @Test
    fun unparsableTrackGoesToUnresolvedInsteadOfStale() {
        // 判不出来不能算失效（删曲是破坏性操作），交给调用方退回逐曲 query
        val result =
            LocalStaleScan.scan(
                tracks = listOf(track("weird", null), track("ok", "primary:Music/ok.mp3")),
                listedIds = setOf("primary:Music/ok.mp3"),
            )
        assertEquals(listOf("weird"), result.unresolved)
        assertTrue(result.stale.isEmpty())
    }

    @Test
    fun emptyListingMarksEverythingStale() {
        // 授权全失效：一次都没列出来，全部判失效（与 Wave6 逐曲 query 的既有语义一致）
        val result =
            LocalStaleScan.scan(
                tracks = listOf(track("a", "primary:Music/a.mp3")),
                listedIds = emptySet(),
            )
        assertEquals(listOf("a"), result.stale)
    }

    @Test
    fun thousandTracksAreResolvedInOnePass() {
        val tracks = (0 until 1000).map { track("id$it", "primary:Music/song$it.mp3") }
        // 每 10 首删 1 首 → 100 首失效
        val listed = tracks.filterIndexed { index, _ -> index % 10 != 3 }.map { it.documentId!! }.toSet()
        val result = LocalStaleScan.scan(tracks, listed)
        assertEquals(100, result.stale.size)
        assertEquals("id3", result.stale.first())
        assertTrue(result.unresolved.isEmpty())
    }

    @Test
    fun documentIdOfDecodesTreeDocumentUri() {
        // 中文名按 UTF-8 逐字节编码：必须按字节解回来，逐 %XX 当字符会出乱码
        assertEquals(
            "primary:Music/歌名 - 歌手.mp3",
            LocalStaleScan.documentIdOf(
                "content://com.android.externalstorage.documents/tree/primary%3AMusic/document/" +
                    "primary%3AMusic%2F%E6%AD%8C%E5%90%8D%20-%20%E6%AD%8C%E6%89%8B.mp3",
            ),
        )
        assertEquals(
            "1234",
            LocalStaleScan.documentIdOf("content://com.android.providers.downloads.documents/document/1234"),
        )
        assertNull(LocalStaleScan.documentIdOf("not-a-uri"))
        assertNull(LocalStaleScan.documentIdOf(""))
    }
}
