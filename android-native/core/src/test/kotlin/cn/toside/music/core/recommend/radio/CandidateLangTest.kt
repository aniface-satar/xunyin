package cn.toside.music.core.recommend.radio

import cn.toside.music.core.recommend.TrackKeys
import cn.toside.music.core.recommend.m3.LangBucket
import cn.toside.music.core.recommend.m3.LangLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 语种供给链（L1~L4）的单测 —— 对照 RN `language.ts` 的 `resolveLang` 与
 * `candidatePool.ts` 的 `resolvePoolLang`。
 *
 * 每条用例只让**一级**命中，其余级刻意留空：链路的顺序错误（例如 L4 抢在 L1 前面）
 * 会让「拉丁标题的粤语歌」被判成 unknown，这种错在整套用例里最难从结果反推。
 */
class CandidateLangTest {
    private fun info(
        id: String = "t1",
        name: String = "曲目",
        singer: String = "歌手",
        source: String = "kw",
        lang: String? = null,
    ) = RadioFixtures.musicInfo(id = id, name = name, singer = singer, source = source, lang = lang)

    @Test
    fun `L1 kg 语种词优先命中`() {
        val resolved = CandidateLang.resolve(info(source = "kg", lang = "国语"), artistLang = { LangBucket.JA })
        assertEquals(LangBucket.ZH, resolved.bucket)
        assertEquals(LangLevel.FIELD, resolved.level)
    }

    @Test
    fun `L1 tx 数字码命中`() {
        val resolved = CandidateLang.resolve(info(source = "tx", lang = "5", name = "Song", singer = "Artist"))
        assertEquals(LangBucket.EN, resolved.bucket)
        assertEquals(LangLevel.FIELD, resolved.level)
    }

    @Test
    fun `L1 tx 空串不判成中文`() {
        // Number('') === 0 → 0 在码表里是中文；空串必须先拦在码表前（Language 内已拦）
        val resolved = CandidateLang.resolve(info(source = "tx", lang = "", name = "Song", singer = "Artist"))
        assertNull(resolved.bucket)
        assertEquals(LangLevel.NONE, resolved.level)
    }

    @Test
    fun `L2 桶提示在 L1 缺席时生效`() {
        val resolved =
            CandidateLang.resolve(
                info(source = "kw", name = "Song", singer = "Artist"),
                langHint = LangBucket.JA,
            )
        assertEquals(LangBucket.JA, resolved.bucket)
        assertEquals(LangLevel.HINT, resolved.level)
    }

    @Test
    fun `L1 优先于 L2 与 L3`() {
        val resolved =
            CandidateLang.resolve(
                info(source = "kg", lang = "国语", name = "Song", singer = "Artist"),
                langHint = LangBucket.JA,
                artistLang = { LangBucket.KO },
            )
        assertEquals(LangBucket.ZH, resolved.bucket)
        assertEquals(LangLevel.FIELD, resolved.level)
    }

    @Test
    fun `L3 歌手表命中`() {
        // 查表键是 RadioTrackKeys.getArtistKeys 的产物（已归一化，拉丁名小写）——
        // 注入方（app 的 ArtistLangStore.lookup）按同一口径查，别再传原始歌手名
        val table = mapOf(TrackKeys.normalizeText("Artist") to LangBucket.KO)
        val resolved =
            CandidateLang.resolve(
                info(source = "kw", name = "Song", singer = "Artist"),
                artistLang = { table[it] },
            )
        assertEquals(LangBucket.KO, resolved.bucket)
        assertEquals(LangLevel.ARTIST, resolved.level)
    }

    @Test
    fun `L3 表里的 unknown 与 instr 不入库`() {
        // 查表命中 unknown/instr 都当作「这个歌手没记录」，继续落到 L4
        for (bucket in listOf(LangBucket.UNKNOWN, LangBucket.INSTR)) {
            val resolved =
                CandidateLang.resolve(
                    info(source = "kw", name = "Song", singer = "Artist"),
                    artistLang = { bucket },
                )
            assertNull("$bucket 不该在 L3 短路", resolved.bucket)
        }
    }

    @Test
    fun `L4 字面统计命中且不判 en`() {
        val zh = CandidateLang.resolve(info(source = "kw", name = "晴天", singer = "周杰伦"))
        assertEquals(LangBucket.ZH, zh.bucket)
        assertEquals(LangLevel.SCRIPT, zh.level)

        // 拉丁标题 + 拉丁歌手：L4 绝不判 en（RN 的「宁缺毋滥」），只能 unknown
        val en = CandidateLang.resolve(info(source = "kw", name = "Shape of You", singer = "Ed Sheeran"))
        assertNull(en.bucket)
        assertEquals(LangLevel.NONE, en.level)
    }

    @Test
    fun `四级都判不出时返回 null 而不是 unknown 桶`() {
        val resolved = CandidateLang.resolve(info(source = "kw", name = "Track 01", singer = ""))
        assertNull(resolved.bucket)
        assertEquals(LangLevel.NONE, resolved.level)
    }

    @Test
    fun `候选已存 lang 时直接采用并保留命中级别`() {
        val candidate =
            PoolCandidate(
                trackKey = "ns:曲目__歌手",
                musicInfo = info(source = "kw", name = "Song", singer = "Artist"),
                lang = LangBucket.YUE,
                langLevel = LangLevel.HINT,
            )
        val resolved = CandidateLang.resolve(candidate, artistLang = { LangBucket.JA })
        assertEquals(LangBucket.YUE, resolved.bucket)
        assertEquals(LangLevel.HINT, resolved.level)
    }

    @Test
    fun `候选没有 lang 时按四级链现算`() {
        val candidate =
            PoolCandidate(
                trackKey = "ns:曲目__歌手",
                musicInfo = info(source = "kg", lang = "粤语"),
            )
        val resolved = CandidateLang.resolve(candidate)
        assertEquals(LangBucket.YUE, resolved.bucket)
        assertEquals(LangLevel.FIELD, resolved.level)
    }
}
