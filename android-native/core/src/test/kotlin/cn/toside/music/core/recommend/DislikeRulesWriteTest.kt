package cn.toside.music.core.recommend

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 踩雷规则写侧（RN `utils/dislikeManage.ts` 的 `updateDislikeInfo`）单元测试。
 *
 * 写侧归一化必须与读侧 [DislikeRulesParser.parse] 产出同一份语义，
 * 否则「写进去的踩雷规则读回来不生效」。
 */
class DislikeRulesWriteTest {
    @Test
    fun appendRuleKeepsExistingRules() {
        val raw = DislikeRulesParser.appendRule("", "晴天", "周杰伦")
        assertEquals("晴天@周杰伦", raw)
        val next = DislikeRulesParser.appendRule(raw, "十年", "陈奕迅")
        assertEquals("晴天@周杰伦\n十年@陈奕迅", next)
    }

    @Test
    fun appendRuleDedupes() {
        val raw = DislikeRulesParser.appendRule("晴天@周杰伦", "晴天", "周杰伦")
        assertEquals("晴天@周杰伦", raw)
    }

    @Test
    fun normalizeLowercasesAndTrims() {
        val rules = DislikeRulesParser.normalize("  晴天 @ 周杰伦  \n\n十年@陈奕迅\n")
        assertEquals("晴天@周杰伦\n十年@陈奕迅", rules)
    }

    @Test
    fun separatorInsideFieldIsEscaped() {
        // 以首个 @ 切分歌名/歌手；歌手段里的 @ 与 RN 一样转义成 #，避免二次切分
        assertEquals("a@b#歌手", DislikeRulesParser.normalize("a@b@歌手"))
        assertEquals("a#b@歌手", DislikeRulesParser.normalize("a#b@歌手"))
    }

    @Test
    fun writtenRulesParseBackIntoThreeSets() {
        val raw = DislikeRulesParser.appendRule(DislikeRulesParser.appendRule("", "晴天", "周杰伦"), null, "方文山")
        val rules = DislikeRulesParser.parse(raw)
        assertTrue(rules.names.contains("晴天@周杰伦"))
        assertTrue(rules.singerNames.contains("方文山"))
        assertEquals(1, rules.names.size)
    }

    @Test
    fun emptyPartsDegradeToValidRules() {
        assertEquals("晴天", DislikeRulesParser.normalize(DislikeRulesParser.appendRule("", "晴天", null)))
        assertEquals("@周杰伦", DislikeRulesParser.normalize(DislikeRulesParser.appendRule("", null, "周杰伦")))
        assertEquals("", DislikeRulesParser.normalize(DislikeRulesParser.appendRule("", null, null)))
    }

    @Test
    fun parseFromStorageToleratesNull() {
        assertTrue(DislikeRulesParser.parseFromStorage(null).names.isEmpty())
    }
}
