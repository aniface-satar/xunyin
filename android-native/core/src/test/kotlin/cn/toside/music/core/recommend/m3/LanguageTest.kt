package cn.toside.music.core.recommend.m3

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 语种八桶与四级判定 —— 对照 RN `core/recommend/language.ts`。
 *
 * 核心断言是「宁缺毋滥」：判不出的必须落 unknown，绝不能被硬判成 en。
 */
class LanguageTest {
    @Test
    fun `kg 中文词表只认表内的词`() {
        assertEquals(LangBucket.ZH, Language.mapKgLanguageWord("国语"))
        assertEquals(LangBucket.ZH, Language.mapKgLanguageWord(" 华语 "))
        assertEquals(LangBucket.YUE, Language.mapKgLanguageWord("粤语"))
        assertEquals(LangBucket.EN, Language.mapKgLanguageWord("英文"))
        assertEquals(LangBucket.OTHER, Language.mapKgLanguageWord("小语种"))
        // 表外不做子串匹配，也不硬猜
        assertNull(Language.mapKgLanguageWord("自译解词"))
        assertNull(Language.mapKgLanguageWord(""))
        assertNull(Language.mapKgLanguageWord(null))
    }

    @Test
    fun `tx 码表空串不能落成中文`() {
        // Number('') === 0 的坑：空串必须拦在码表之前
        assertNull(Language.mapTxLanguageCode(""))
        assertNull(Language.mapTxLanguageCode("   "))
        assertNull(Language.mapTxLanguageCode(null))
        assertEquals(LangBucket.ZH, Language.mapTxLanguageCode("0"))
        assertEquals(LangBucket.YUE, Language.mapTxLanguageCode("1"))
        assertEquals(LangBucket.EN, Language.mapTxLanguageCode("5"))
        // 7=中英交替 / 11=俄语 实测与内容不符，故意不入表
        assertNull(Language.mapTxLanguageCode("7"))
        assertNull(Language.mapTxLanguageCode("11"))
        assertNull(Language.mapTxLanguageCode("abc"))
    }

    @Test
    fun `字面统计不判 en，只认假名谚文汉字和其它文字`() {
        assertEquals(LangBucket.JA, Language.bucketFromScript("アイドル"))
        assertEquals(LangBucket.KO, Language.bucketFromScript("사랑"))
        assertEquals(LangBucket.ZH, Language.bucketFromScript("晴天", "周杰伦"))
        assertEquals(LangBucket.OTHER, Language.bucketFromScript("Катюша"))
        // 纯拉丁：可能是欧美原创，也可能是日韩用英文歌名——一律交回 unknown
        assertNull(Language.bucketFromScript("Lemon"))
        // 汉字与拉丁各占一半上下：判不出
        assertNull(Language.bucketFromScript("Lemon", "米津玄師"))
        assertNull(Language.bucketFromScript("", ""))
    }

    @Test
    fun `歌词正文里拉丁占绝对多数才判 en`() {
        assertEquals(LangBucket.EN, Language.bucketFromLyric("We were both young when I first saw you"))
        assertEquals(LangBucket.YUE, Language.bucketFromLyric("我唔知你嘅嘢点算"))
        assertEquals(LangBucket.ZH, Language.bucketFromLyric("故事的小黄花 从出生那年就飘着"))
        // 歌词拿不到不是 instr
        assertNull(Language.bucketFromLyric(null, "Instrumental"))
        // 空正文只在曲名带显式纯音乐标记时判 instr
        assertEquals(LangBucket.INSTR, Language.bucketFromLyric("", "夜曲 (Instrumental)"))
        assertNull(Language.bucketFromLyric("", "夜曲"))
    }

    @Test
    fun `歌词噪声剔除 作词行与 LRC 时间戳不参与统计`() {
        val cleaned = Language.stripLyricNoise("作词：方文山\n[00:01.00]故事的小黄花\n[00:05.30]从出生那年就飘着")
        assertFalse(cleaned.contains("方文山"))
        assertFalse(cleaned.contains("00:01"))
        assertTrue(cleaned.contains("故事的小黄花"))
    }

    @Test
    fun `歌手语言表按强度覆盖 同强度做计数器投票`() {
        val table = mutableMapOf<String, Language.ArtistLangEntry>()
        Language.updateArtistLangTable(table, listOf("周杰伦"), LangBucket.ZH, Language.ArtistLangSource.FIELD, now = 1_000L)
        assertEquals(LangBucket.ZH, table.getValue("周杰伦").bucket)
        assertEquals(2, table.getValue("周杰伦").strength)

        // 低强度（歌词）不能推翻接口字段
        Language.updateArtistLangTable(table, listOf("周杰伦"), LangBucket.JA, Language.ArtistLangSource.LYRIC, now = 2_000L)
        assertEquals(LangBucket.ZH, table.getValue("周杰伦").bucket)

        // 高强度（MB 关系链）直接覆盖
        Language.updateArtistLangTable(table, listOf("周杰伦"), LangBucket.YUE, Language.ArtistLangSource.RELATION, now = 3_000L)
        assertEquals(LangBucket.YUE, table.getValue("周杰伦").bucket)
        assertEquals(3, table.getValue("周杰伦").strength)
        assertEquals(1, table.getValue("周杰伦").hits)
    }

    @Test
    fun `同强度反向票递减 减到负才换桶`() {
        val table = mutableMapOf<String, Language.ArtistLangEntry>()
        val source = Language.ArtistLangSource.FIELD
        Language.updateArtistLangTable(table, listOf("A"), LangBucket.ZH, source, now = 0L)
        Language.updateArtistLangTable(table, listOf("A"), LangBucket.ZH, source, now = 1L)
        assertEquals(2, table.getValue("A").hits)

        Language.updateArtistLangTable(table, listOf("A"), LangBucket.JA, source, now = 2L)
        assertEquals(LangBucket.ZH, table.getValue("A").bucket)
        assertEquals(1, table.getValue("A").hits)

        Language.updateArtistLangTable(table, listOf("A"), LangBucket.JA, source, now = 3L)
        assertEquals(LangBucket.ZH, table.getValue("A").bucket)
        assertEquals(0, table.getValue("A").hits)

        Language.updateArtistLangTable(table, listOf("A"), LangBucket.JA, source, now = 4L)
        assertEquals(LangBucket.JA, table.getValue("A").bucket)
        assertEquals(1, table.getValue("A").hits)
    }

    @Test
    fun `unknown 与 instr 不入歌手表`() {
        val table = mutableMapOf<String, Language.ArtistLangEntry>()
        Language.updateArtistLangTable(table, listOf("A"), LangBucket.UNKNOWN, Language.ArtistLangSource.FIELD, now = 0L)
        Language.updateArtistLangTable(table, listOf("A"), LangBucket.INSTR, Language.ArtistLangSource.FIELD, now = 0L)
        Language.updateArtistLangTable(table, listOf("A"), null, Language.ArtistLangSource.FIELD, now = 0L)
        assertTrue(table.isEmpty())
    }

    @Test
    fun `超容量淘汰 hits 最低最旧的一条`() {
        val table = mutableMapOf<String, Language.ArtistLangEntry>()
        val source = Language.ArtistLangSource.FIELD
        // keep 有两次命中，drop 只有一次
        Language.updateArtistLangTable(table, listOf("keep"), LangBucket.ZH, source, limit = 2, now = 0L)
        Language.updateArtistLangTable(table, listOf("keep"), LangBucket.ZH, source, limit = 2, now = 1L)
        Language.updateArtistLangTable(table, listOf("drop"), LangBucket.JA, source, limit = 2, now = 2L)
        Language.updateArtistLangTable(table, listOf("new"), LangBucket.KO, source, limit = 2, now = 3L)

        assertEquals(2, table.size)
        assertTrue(table.containsKey("keep"))
        assertTrue(table.containsKey("new"))
    }

    @Test
    fun `四级链 L1 字段优先于一切`() {
        val table = mutableMapOf<String, Language.ArtistLangEntry>()
        Language.updateArtistLangTable(table, listOf("周杰伦"), LangBucket.JA, Language.ArtistLangSource.RELATION, now = 0L)
        val resolved =
            Language.resolveLang(
                Language.LangResolveInput(
                    source = "kg",
                    langField = "国语",
                    name = "Lemon",
                    singer = "米津玄師",
                    artistKeys = listOf("周杰伦"),
                ),
                table,
            )
        assertEquals(LangBucket.ZH, resolved.bucket)
        assertEquals(LangLevel.FIELD, resolved.level)
    }

    @Test
    fun `四级链 L2 桶提示优先于歌手表`() {
        val table = mutableMapOf<String, Language.ArtistLangEntry>()
        Language.updateArtistLangTable(table, listOf("A"), LangBucket.YUE, Language.ArtistLangSource.RELATION, now = 0L)
        val resolved =
            Language.resolveLang(
                Language.LangResolveInput(
                    source = "wy",
                    name = "晴天",
                    singer = "周杰伦",
                    langHint = LangBucket.JA,
                    artistKeys = listOf("A"),
                ),
                table,
            )
        assertEquals(LangBucket.JA, resolved.bucket)
        assertEquals(LangLevel.HINT, resolved.level)
    }

    @Test
    fun `四级链 L3 歌手表优先于字面统计`() {
        val table = mutableMapOf<String, Language.ArtistLangEntry>()
        Language.updateArtistLangTable(table, listOf("周杰伦"), LangBucket.KO, Language.ArtistLangSource.RELATION, now = 0L)
        val resolved =
            Language.resolveLang(
                Language.LangResolveInput(source = "wy", name = "晴天", singer = "周杰伦", artistKeys = listOf("周杰伦")),
                table,
            )
        assertEquals(LangBucket.KO, resolved.bucket)
        assertEquals(LangLevel.ARTIST, resolved.level)
    }

    @Test
    fun `四级链 L4 字面统计 判不出落 unknown`() {
        val zh = Language.resolveLang(Language.LangResolveInput(source = "wy", name = "晴天", singer = "周杰伦"))
        assertEquals(LangBucket.ZH, zh.bucket)
        assertEquals(LangLevel.SCRIPT, zh.level)

        val unknown = Language.resolveLang(Language.LangResolveInput(source = "wy", name = "Lemon", singer = "米津玄師"))
        assertEquals(LangBucket.UNKNOWN, unknown.bucket)
        assertEquals(LangLevel.NONE, unknown.level)
    }

    @Test
    fun `混合 fixture 的桶分布符合预期`() {
        data class Fixture(
            val name: String,
            val singer: String,
            val source: String?,
            val lang: String?,
            val expected: LangBucket,
        )

        val fixtures =
            listOf(
                Fixture("晴天", "周杰伦", "kg", "国语", LangBucket.ZH),
                Fixture("海阔天空", "Beyond", "kg", "粤语", LangBucket.YUE),
                Fixture("Yellow", "Coldplay", "tx", "5", LangBucket.EN),
                Fixture("アイドル", "YOASOBI", "tx", "3", LangBucket.JA),
                Fixture("사랑해", "아이유", "tx", "4", LangBucket.KO),
                Fixture("Chanson", "Édith Piaf", "wy", null, LangBucket.UNKNOWN),
                Fixture("アイドル", "YOASOBI", "wy", null, LangBucket.JA),
                Fixture("晴天", "周杰伦", "wy", null, LangBucket.ZH),
            )
        val buckets =
            fixtures.map { fixture ->
                val input =
                    Language.LangResolveInput(
                        source = fixture.source,
                        langField = fixture.lang,
                        name = fixture.name,
                        singer = fixture.singer,
                    )
                Language.resolveLang(input).bucket
            }
        assertEquals(fixtures.map { it.expected }, buckets)

        // 纯音乐一路：无歌词 + 曲名带标记
        assertEquals(LangBucket.INSTR, Language.bucketFromLyric("", "River Flows in You (Instrumental)"))
    }
}
