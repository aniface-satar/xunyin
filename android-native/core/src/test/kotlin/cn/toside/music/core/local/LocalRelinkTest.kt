package cn.toside.music.core.local

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 重定位匹配规则（规则表见 [LocalRelink] 类注释）。
 */
class LocalRelinkTest {
    private fun expectation(
        oldId: String = "old://uri",
        name: String,
        singer: String = "",
        stem: String = name,
    ): LocalRelink.Expectation = LocalRelink.Expectation(oldId = oldId, name = name, singer = singer, originalStem = stem)

    private fun candidate(
        stem: String,
        uri: String = "content://new/$stem",
    ): LocalRelink.Candidate = LocalRelink.Candidate(stem = stem, uri = uri)

    @Test
    fun `R1 unique stem match wins`() {
        val plan =
            LocalRelink.plan(
                expectations = listOf(expectation(name = "晴天", stem = "track01")),
                candidates = listOf(candidate("track01"), candidate("other")),
            )
        assertEquals("content://new/track01", plan.matched["old://uri"])
        assertEquals(emptyList<String>(), plan.unmatched)
    }

    @Test
    fun `multiple identical stems are ambiguous not guessed`() {
        val plan =
            LocalRelink.plan(
                expectations = listOf(expectation(name = "晴天", stem = "track01")),
                candidates = listOf(candidate("track01", "u1"), candidate("track01", "u2")),
            )
        assertEquals(emptyMap<String, String>(), plan.matched)
        assertEquals(listOf("old://uri"), plan.ambiguous)
    }

    @Test
    fun `case and width are normalized`() {
        val plan =
            LocalRelink.plan(
                expectations = listOf(expectation(name = "Blue", stem = "ＢＬＵＥ")),
                candidates = listOf(candidate("blue")),
            )
        assertEquals(1, plan.matched.size)
    }

    @Test
    fun `R2 matches name and singer split by dash`() {
        val plan =
            LocalRelink.plan(
                expectations = listOf(expectation(name = "晴天", singer = "周杰伦", stem = "cd1_04")),
                candidates = listOf(candidate("七里香 - 周杰伦"), candidate("晴天 - 周杰伦"), candidate("晴天 - 周杰伦2")),
            )
        assertEquals("content://new/晴天 - 周杰伦", plan.matched["old://uri"])
    }

    @Test
    fun `R3 falls back to unique name-only candidate`() {
        val plan =
            LocalRelink.plan(
                expectations = listOf(expectation(name = "晴天", singer = "周杰伦", stem = "cd1_04")),
                candidates = listOf(candidate("other"), candidate("晴天")),
            )
        assertEquals("content://new/晴天", plan.matched["old://uri"])
    }

    @Test
    fun `multiple same-name candidates with matching singer stays ambiguous when not unique`() {
        val plan =
            LocalRelink.plan(
                expectations = listOf(expectation(name = "晴天", singer = "周杰伦", stem = "x")),
                candidates = listOf(candidate("晴天 - 周杰伦", "u1"), candidate("晴天 - 周杰伦", "u2")),
            )
        assertEquals(listOf("old://uri"), plan.ambiguous)
    }

    @Test
    fun `empty stem candidates are never matched`() {
        val plan =
            LocalRelink.plan(
                expectations = listOf(expectation(name = "song", stem = "song")),
                candidates = listOf(candidate("")),
            )
        assertEquals(listOf("old://uri"), plan.unmatched)
    }

    @Test
    fun `no candidates means unmatched`() {
        val plan =
            LocalRelink.plan(
                expectations = listOf(expectation(name = "晴天", stem = "track01")),
                candidates = emptyList(),
            )
        assertEquals(emptyMap<String, String>(), plan.matched)
        assertEquals(listOf("old://uri"), plan.unmatched)
        assertEquals(emptyList<String>(), plan.ambiguous)
    }

    @Test
    fun `taken uris are excluded to avoid duplicates`() {
        val plan =
            LocalRelink.plan(
                expectations =
                    listOf(
                        expectation(oldId = "stale", name = "晴天", stem = "track01"),
                        expectation(oldId = "alive", name = "七里香", stem = "track01"),
                    ),
                candidates = listOf(candidate("track01", "content://new/track01")),
                takenUris = setOf("content://new/track01"),
            )
        assertEquals(emptyMap<String, String>(), plan.matched)
        assertEquals(listOf("stale", "alive"), plan.unmatched)
    }

    @Test
    fun `one candidate is claimed by only one expectation`() {
        val plan =
            LocalRelink.plan(
                expectations =
                    listOf(
                        expectation(oldId = "a", name = "晴天", stem = "same"),
                        expectation(oldId = "b", name = "晴天2", stem = "same"),
                    ),
                candidates = listOf(candidate("same", "u1")),
            )
        assertEquals(mapOf("a" to "u1"), plan.matched)
        assertEquals(listOf("b"), plan.unmatched)
    }

    @Test
    fun `blank name expectation is unmatched`() {
        val plan =
            LocalRelink.plan(
                expectations = listOf(expectation(name = "", stem = "")),
                candidates = listOf(candidate("anything")),
            )
        assertEquals(listOf("old://uri"), plan.unmatched)
    }

    @Test
    fun `full width space in names still matches`() {
        val plan =
            LocalRelink.plan(
                expectations = listOf(expectation(name = "夜　曲", stem = "夜曲")),
                candidates = listOf(candidate("夜曲")),
            )
        assertEquals("content://new/夜曲", plan.matched["old://uri"])
    }
}
