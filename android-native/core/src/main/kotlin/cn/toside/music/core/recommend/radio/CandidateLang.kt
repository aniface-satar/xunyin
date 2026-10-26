package cn.toside.music.core.recommend.radio

import cn.toside.music.core.recommend.m3.LangBucket
import cn.toside.music.core.recommend.m3.LangLevel
import cn.toside.music.core.recommend.m3.Language
import kotlinx.serialization.json.JsonObject

/**
 * 歌手语言表查询（语种判定的 L3）。
 *
 * core 不持有这张表（它在 app 侧的 `ArtistLangStore`）：调用方以 lambda 注入，
 * 表未载入、查不到该歌手、条目是 unknown 一律返回 null，自动降级到 L4 字面统计。
 */
typealias ArtistLangLookup = (String) -> LangBucket?

/**
 * 一首候选的语种判定结果。
 *
 * `bucket == null` ⇔ `level == [LangLevel.NONE]`：四级链全部判不出，走自由名额，
 * 既不能凑配额也不该被当成某种语言卡住（[cn.toside.music.core.recommend.m3.LanguageQuota.langWithinCap]）。
 */
data class ResolvedLang(
    val bucket: LangBucket?,
    val level: Int,
)

/**
 * 语种供给的唯一入口 —— 把「候选从哪儿取语种」收在一处，对照 RN
 * `candidatePool.ts` 的 `resolvePoolLang` 与 `index.ts` 的历史项 `resolveLang` 调用。
 *
 * 四级链本身不重写：[Language.resolveLang] 仍是唯一实现，本类只做两件事：
 * 1. 从 `musicInfo` 里取 L1 需要的 `source` / `meta.lang`、L4 需要的曲名与歌手；
 * 2. 把注入的歌手表 lambda 适配成 `resolveLang` 需要的 map 形状。
 *
 * **L3 的表适配为什么不缓存**：一次队列生成要对整池候选与最近 60 首各解析一次，
 * 表本身是 500 条上限的小 map，按需查 1-3 个歌手键比维护第二份索引便宜，
 * 也不会出现「表更新了、索引没更新」的第二真源。
 */
object CandidateLang {
    /** `musicInfo.meta.lang`：kg 是中文词、tx 是数字码；其余源没有该字段。 */
    fun langField(musicInfo: JsonObject): String? = musicInfo.metaObject()?.stringField("lang")

    fun resolve(
        musicInfo: JsonObject,
        langHint: LangBucket? = null,
        artistLang: ArtistLangLookup? = null,
        artistKeys: List<String> = RadioTrackKeys.getArtistKeys(musicInfo),
    ): ResolvedLang {
        val input =
            Language.LangResolveInput(
                source = musicInfo.stringField("source"),
                langField = langField(musicInfo),
                name = musicInfo.stringField("name").orEmpty(),
                singer = musicInfo.stringField("singer").orEmpty(),
                langHint = langHint,
                artistKeys = artistKeys,
            )
        return fromResolution(Language.resolveLang(input, lookupTable(artistKeys, artistLang)))
    }

    /**
     * 池内候选的读时解析：已存的 `lang` 优先（RN `resolvePoolLang` 同一口径），
     * 缺席才按四级链现算——老池子没有 `lang` 字段，不能当成「永远判不出」。
     */
    fun resolve(
        candidate: PoolCandidate,
        artistLang: ArtistLangLookup? = null,
    ): ResolvedLang {
        candidate.lang?.let { return ResolvedLang(it, candidate.langLevel.takeIf { level -> level > 0 } ?: LangLevel.FIELD) }
        return resolve(candidate.musicInfo, candidate.langHint, artistLang, candidate.artistKeys)
    }

    private fun fromResolution(resolution: Language.LangResolution): ResolvedLang =
        if (resolution.level == LangLevel.NONE) {
            ResolvedLang(null, LangLevel.NONE)
        } else {
            ResolvedLang(resolution.bucket, resolution.level)
        }

    private fun lookupTable(
        artistKeys: List<String>,
        artistLang: ArtistLangLookup?,
    ): Map<String, Language.ArtistLangEntry>? {
        if (artistLang == null || artistKeys.isEmpty()) return null
        val table = mutableMapOf<String, Language.ArtistLangEntry>()
        for (key in artistKeys) {
            val bucket = artistLang(key) ?: continue
            // unknown / instr 不进 L3：instr 是单曲属性，会让这位歌手的真唱曲目整首逃出配额
            if (bucket == LangBucket.UNKNOWN || bucket == LangBucket.INSTR) continue
            table[key] =
                Language.ArtistLangEntry(
                    bucket = bucket,
                    hits = 1,
                    strength = Language.ArtistLangSource.RELATION.strength,
                    updatedAt = 0,
                )
        }
        return table
    }
}
