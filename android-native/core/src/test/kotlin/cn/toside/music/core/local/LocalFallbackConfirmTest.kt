package cn.toside.music.core.local

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 兜底人工确认判定（W6-2）—— 规则表见 [LocalFallbackConfirm] 类注释。
 *
 * 定性：RN `getOtherSourceByLocal` 静默（local.ts:19-67），这里是**体验增强**。
 */
class LocalFallbackConfirmTest {
    private fun option(
        name: String,
        singer: String,
        source: String = "kw",
    ) = LocalFallbackConfirm.Option(name = name, singer = singer, source = source)

    @Test
    fun sameSingerIsTrusted() {
        val expect = LocalFallbackConfirm.Expectation("起风了", "买辣椒也用券")
        val candidate = option("起风了", "买辣椒也用券")
        assertEquals(LocalFallbackConfirm.Verdict.OK, LocalFallbackConfirm.verdict(expect, candidate))
        assertFalse(LocalFallbackConfirm.needsConfirm(expect, listOf(candidate)))
    }

    @Test
    fun singerContainmentIsEnough() {
        // 在线候选常带多位歌手：「周杰伦/汤珈铖」对「周杰伦」互含成立
        val expect = LocalFallbackConfirm.Expectation("稻香", "周杰伦")
        val candidate = option("稻香", "周杰伦/汤珈铖")
        assertEquals(LocalFallbackConfirm.Verdict.OK, LocalFallbackConfirm.verdict(expect, candidate))
    }

    @Test
    fun differentSingerNeedsConfirm() {
        val expect = LocalFallbackConfirm.Expectation("起风了", "买辣椒也用券")
        val candidate = option("起风了", "周杰伦")
        assertEquals(LocalFallbackConfirm.Verdict.SINGER_MISMATCH, LocalFallbackConfirm.verdict(expect, candidate))
        assertTrue(LocalFallbackConfirm.needsConfirm(expect, listOf(candidate)))
    }

    @Test
    fun emptyExpectSingerIsUnknown() {
        // 本地标签没歌手：核无可核，同名不同歌手风险只能交给用户
        val expect = LocalFallbackConfirm.Expectation("起风了", "")
        val candidate = option("起风了", "买辣椒也用券")
        assertEquals(LocalFallbackConfirm.Verdict.SINGER_UNKNOWN, LocalFallbackConfirm.verdict(expect, candidate))
        assertTrue(LocalFallbackConfirm.needsConfirm(expect, listOf(candidate)))
    }

    @Test
    fun candidateWithoutSingerIsUnknown() {
        val expect = LocalFallbackConfirm.Expectation("起风了", "买辣椒也用券")
        assertEquals(
            LocalFallbackConfirm.Verdict.SINGER_UNKNOWN,
            LocalFallbackConfirm.verdict(expect, option("起风了", "")),
        )
    }

    @Test
    fun severalCandidatesWithSameSingerAreFine() {
        val expect = LocalFallbackConfirm.Expectation("稻香", "周杰伦")
        val candidates = listOf(option("稻香", "周杰伦"), option("稻香", "周杰伦"))
        assertFalse(LocalFallbackConfirm.needsConfirm(expect, candidates))
    }

    @Test
    fun severalCandidatesWithDifferentSingersNeedConfirm() {
        val expect = LocalFallbackConfirm.Expectation("起风了", "买辣椒也用券")
        val candidates =
            listOf(
                option("起风了", "买辣椒也用券"),
                option("起风了", "周杰伦"),
            )
        assertTrue(LocalFallbackConfirm.needsConfirm(expect, candidates))
    }

    @Test
    fun normalizationMatchesSearchRule() {
        // 全角/大小写/标点差异都不该触发确认（与 LocalSourceQuery.matches 同一把尺子）
        val expect = LocalFallbackConfirm.Expectation("ＢＬＵＥ", "ＢＬＵＥ ＢＩＲＤ")
        val candidate = option("blue", "blue bird")
        assertEquals(LocalFallbackConfirm.Verdict.OK, LocalFallbackConfirm.verdict(expect, candidate))
    }

    @Test
    fun noCandidatesMeansNoConfirm() {
        val expect = LocalFallbackConfirm.Expectation("起风了", "")
        assertFalse(LocalFallbackConfirm.needsConfirm(expect, emptyList()))
    }

    @Test
    fun orderingPutsTrustedFirstAndIsStable() {
        val expect = LocalFallbackConfirm.Expectation("起风了", "买辣椒也用券")
        val wrong1 = option("起风了", "周杰伦", source = "kw")
        val wrong2 = option("起风了", "林俊杰", source = "kg")
        val right = option("起风了", "买辣椒也用券", source = "wy")
        val ordered = LocalFallbackConfirm.ordered(expect, listOf(wrong1, wrong2, right))
        assertEquals(listOf(right, wrong1, wrong2), ordered)
    }
}
