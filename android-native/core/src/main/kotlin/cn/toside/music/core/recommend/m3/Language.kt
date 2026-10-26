package cn.toside.music.core.recommend.m3

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * 语种分桶 —— RN `core/recommend/language.ts` 的 `LangBucket`。
 *
 * 八桶里只有前六个进语种配额（[QUOTA_LANG_BUCKETS]）：`instr` 由「每窗口上限」单独管，
 * `unknown` 既不凑配额也不受约束（判不出就放行，宁缺毋滥）。
 *
 * `wire` 是与 RN 一致的落盘名（小写），持久化模型统一用它，不依赖枚举常量名的拼写。
 */
@Serializable
enum class LangBucket(
    val wire: String,
) {
    @SerialName("zh")
    ZH("zh"),

    @SerialName("yue")
    YUE("yue"),

    @SerialName("en")
    EN("en"),

    @SerialName("ja")
    JA("ja"),

    @SerialName("ko")
    KO("ko"),

    @SerialName("other")
    OTHER("other"),

    @SerialName("instr")
    INSTR("instr"),

    @SerialName("unknown")
    UNKNOWN("unknown"),
    ;

    companion object {
        private val BY_WIRE: Map<String, LangBucket> = entries.associateBy { it.wire }

        /** 只认表内的名字；盘上来的脏值返回 null，由调用方决定降级方向。 */
        fun fromWire(value: String?): LangBucket? = BY_WIRE[value?.trim()?.lowercase()]

        fun fromWireOrUnknown(value: String?): LangBucket = fromWire(value) ?: UNKNOWN
    }
}

/** 全部八桶，顺序与 RN 一致（落盘与日志依赖稳定顺序）。 */
val LANG_BUCKETS: List<LangBucket> =
    listOf(
        LangBucket.ZH,
        LangBucket.YUE,
        LangBucket.EN,
        LangBucket.JA,
        LangBucket.KO,
        LangBucket.OTHER,
        LangBucket.INSTR,
        LangBucket.UNKNOWN,
    )

/** 进语种配额统计的桶：`instr` 由每窗口上限单独管，`unknown` 不参与硬约束。 */
val QUOTA_LANG_BUCKETS: List<LangBucket> =
    listOf(LangBucket.ZH, LangBucket.YUE, LangBucket.EN, LangBucket.JA, LangBucket.KO, LangBucket.OTHER)

/** 语种判定的命中级别：0=判不出 1=接口字段 2=桶提示 3=歌手表 4=字面统计。只用于诊断。 */
object LangLevel {
    const val NONE = 0
    const val FIELD = 1
    const val HINT = 2
    const val ARTIST = 3
    const val SCRIPT = 4
}

/**
 * 语种分桶与四级判定的纯函数集合 —— RN `language.ts` 原样移植（不碰存储、不碰网络）。
 *
 * 判定原则：**宁缺毋滥**——判不出就 [LangBucket.UNKNOWN] 走自由名额，绝不硬判 `en`。
 * L4 字面统计里拉丁占比再高也不判 en（欧美原创与日韩用英文歌名的原创无法区分），
 * 只有歌词正文这一路才放开 en。
 */
object Language {
    /** kg 语种字段是中文词（实测 song_search_v2 与歌单内嵌 global.data 的 trans_param.language 同形）。 */
    private val KG_LANGUAGE_WORDS: Map<String, LangBucket> =
        mapOf(
            "国语" to LangBucket.ZH,
            "中文" to LangBucket.ZH,
            "华语" to LangBucket.ZH,
            "粤语" to LangBucket.YUE,
            "英语" to LangBucket.EN,
            "英文" to LangBucket.EN,
            "日语" to LangBucket.JA,
            "韩语" to LangBucket.KO,
            "法语" to LangBucket.OTHER,
            "德语" to LangBucket.OTHER,
            "意大利语" to LangBucket.OTHER,
            "西班牙语" to LangBucket.OTHER,
            "俄语" to LangBucket.OTHER,
            "泰语" to LangBucket.OTHER,
            "越南语" to LangBucket.OTHER,
            "拉丁语" to LangBucket.OTHER,
            "小语种" to LangBucket.OTHER,
        )

    /** 只认表内的词；表外（如「自译解词」）返回 null 交回下一级，不做子串匹配。 */
    fun mapKgLanguageWord(word: String?): LangBucket? {
        val key = word?.trim().orEmpty()
        if (key.isEmpty()) return null
        return KG_LANGUAGE_WORDS[key]
    }

    /** tx 语种是数字码表（实测钉死）。7=中英交替、8=自译解词、11=俄语、12=汉语、15=朝语 实测与内容不符，故意不入表。 */
    private val TX_LANGUAGE_CODES: Map<Int, LangBucket> =
        mapOf(
            0 to LangBucket.ZH,
            1 to LangBucket.YUE,
            3 to LangBucket.JA,
            4 to LangBucket.KO,
            5 to LangBucket.EN,
            6 to LangBucket.OTHER,
            13 to LangBucket.OTHER,
            16 to LangBucket.OTHER,
            24 to LangBucket.OTHER,
        )

    /**
     * 空串必须先拦：`"".toIntOrNull()` 是 null 而不是 0，但「非数字」也要拦；
     * 否则「接口没给语种」会被当成最高可信度的 L1=中文。
     */
    fun mapTxLanguageCode(code: String?): LangBucket? {
        val key = code?.trim().orEmpty()
        if (key.isEmpty()) return null
        val num = key.toIntOrNull() ?: return null
        return TX_LANGUAGE_CODES[num]
    }

    /** 有逐曲语种字段（L1）的源：桶召回优先在它们身上花预算，抓回来的候选语种闭环最准。 */
    fun hasTrackLangField(source: String?): Boolean = source == "kg" || source == "tx"

    /** 按源分派：只有 kg/tx 有逐曲语种字段；其余源没有，落到 L2/L3/L4。 */
    fun bucketFromLangField(
        source: String?,
        lang: String?,
    ): LangBucket? =
        when (source) {
            "tx" -> mapTxLanguageCode(lang)
            "kg" -> mapKgLanguageWord(lang)
            else -> null
        }

    private val HAN_RE = Regex("[\\u4e00-\\u9fff\\u3400-\\u4dbf]")
    private val KANA_RE = Regex("[\\u3041-\\u30ff\\u31f0-\\u31ff]")
    private val HANGUL_RE = Regex("[\\u1100-\\u11ff\\u3130-\\u318f\\uac00-\\ud7af]")
    private val LATIN_RE = Regex("[A-Za-z\\u00c0-\\u024f]")

    /** 其它有音节的文字：天城 / 希腊 / 西里尔 / 亚美尼亚 / 希伯来 / 阿拉伯 / 泰文 / 老挝-缅甸-高棉。 */
    private val OTHER_LETTER_RE =
        Regex("[\\u0900-\\u097f\\u0370-\\u03ff\\u0400-\\u04ff\\u0530-\\u058f\\u0590-\\u05ff\\u0600-\\u06ff\\u0e00-\\u0fff]")

    data class LangCharCounts(
        val han: Int,
        val kana: Int,
        val hangul: Int,
        val latin: Int,
        val otherLetter: Int,
    ) {
        val letters: Int get() = han + kana + hangul + latin + otherLetter
    }

    /** 只统计「有音节」的字符：数字、空白、中英标点、装饰性符号一律忽略。 */
    fun countLangChars(text: String): LangCharCounts =
        LangCharCounts(
            han = HAN_RE.findAll(text).count(),
            kana = KANA_RE.findAll(text).count(),
            hangul = HANGUL_RE.findAll(text).count(),
            latin = LATIN_RE.findAll(text).count(),
            otherLetter = OTHER_LETTER_RE.findAll(text).count(),
        )

    private const val JA_SHARE = 0.2
    private const val KO_SHARE = 0.2
    private const val ZH_SHARE = 0.5
    private const val OTHER_SHARE = 0.3
    private const val LYRIC_EN_SHARE = 0.8

    /**
     * L4：曲名 + 歌手名合并的字面统计。本层**不判 en**——
     * 拉丁占比高只可能是欧美原创，也可能是日本/韩国用英文歌名的原创，后者占比很高。
     */
    fun bucketFromScript(
        name: String,
        singer: String = "",
    ): LangBucket? {
        val counts = countLangChars("$name $singer")
        if (counts.letters <= 0) return null
        val total = counts.letters.toDouble()
        if (counts.kana / total >= JA_SHARE) return LangBucket.JA
        if (counts.hangul / total >= KO_SHARE) return LangBucket.KO
        if (counts.han / total >= ZH_SHARE) return LangBucket.ZH
        if (counts.otherLetter / total >= OTHER_SHARE) return LangBucket.OTHER
        // 纯拉丁、或汉字/假名不足以定型的混合标题：交回调用方落 unknown
        return null
    }

    private val INSTR_NAME_RE = Regex("(纯音乐|伴奏|无人声|instrumental|\\binst\\b\\.?|piano version)", RegexOption.IGNORE_CASE)

    /** 歌词里的粤语虚词。汉字统计本身分不开 zh/yue，这几个字是可靠的方言信号。 */
    private val YUE_MARKER_RE = Regex("[嘅唔冇俾佢哋嚟咗乜嗰咪]")
    private const val YUE_MARKER_MIN = 2

    /** 歌词元数据行（作词/作曲/LRC 头部），进统计前先剔除，否则「C.Y.Kong」会把拉丁占比抬高。 */
    private val LYRIC_META_RE =
        Regex(
            "^\\s*(?:作词|作曲|编曲|制作人|录音|混音|母带|吉他|钢琴|和声|Lyric|Lyrics|Word|Music|Composed|Arranged|Produced|LRC版本)" +
                "[为:：]",
            RegexOption.IGNORE_CASE,
        )
    private val LRC_TAG_RE = Regex("\\[[^\\]]*\\]")
    private val NON_WORD_ONLY_RE = Regex("^[^\\w\\u4e00-\\u9fff]+$")

    fun stripLyricNoise(raw: String): String =
        raw
            .split('\n')
            .map { line -> line.replace(LRC_TAG_RE, "").trim() }
            .filter { line ->
                line.isNotEmpty() && !LYRIC_META_RE.containsMatchIn(line) && !NON_WORD_ONLY_RE.matches(line)
            }.joinToString(" ")

    /**
     * L3 的喂入口：只看歌词正文。歌词拿不到返回 null（不是 instr）；
     * 正文为空只在曲名带显式纯音乐标记时判 instr——「无词=纯音乐」会误伤轻音乐。
     */
    fun bucketFromLyric(
        lyric: String?,
        name: String = "",
    ): LangBucket? {
        if (lyric == null) return null
        val body = stripLyricNoise(lyric)
        if (body.isEmpty()) return if (INSTR_NAME_RE.containsMatchIn(name)) LangBucket.INSTR else null
        if (YUE_MARKER_RE.findAll(body).count() >= YUE_MARKER_MIN) return LangBucket.YUE
        val counts = countLangChars(body)
        if (counts.letters <= 0) return null
        val total = counts.letters.toDouble()
        if (counts.kana / total >= JA_SHARE) return LangBucket.JA
        if (counts.hangul / total >= KO_SHARE) return LangBucket.KO
        if (counts.han / total >= ZH_SHARE) return LangBucket.ZH
        if (counts.otherLetter / total >= OTHER_SHARE) return LangBucket.OTHER
        // 歌词正文里拉丁占绝对多数判 en 是可靠的（spec 明确放开这一条）
        if (counts.latin / total >= LYRIC_EN_SHARE) return LangBucket.EN
        return null
    }

    /**
     * 观测强度：曲内语言表（歌词）< 接口语种字段 < 歌手级权威标签（MB 关系链）。
     * 数值参与 `updateArtistLangTable` 的覆盖比较，改动要同步报告。
     */
    enum class ArtistLangSource(
        val wire: String,
        val strength: Int,
    ) {
        LYRIC("lyric", 1),
        FIELD("field", 2),
        RELATION("relation", 3),
        ;

        companion object {
            fun fromWire(value: String?): ArtistLangSource? = entries.firstOrNull { it.wire == value?.trim() }
        }
    }

    @Serializable
    data class ArtistLangEntry(
        val bucket: LangBucket,
        val hits: Int,
        val strength: Int,
        val updatedAt: Long,
    )

    /**
     * 歌手语言表就地合并（表由 app 侧 store 持有，本函数不碰存储）：
     * 高强度直接覆盖；同强度用 hits 做计数器投票（反向票递减，减到负再换桶），低强度忽略。
     * `unknown` 与 `instr` 都不入库：instr 是「单首曲」的属性，几首伴奏就把歌手钉成 instr，
     * 会让他的真唱曲目在 L3 拿到 instr 而整首逃出语种硬约束。超容量淘汰 hits 最低、最旧的一条。
     */
    fun updateArtistLangTable(
        table: MutableMap<String, ArtistLangEntry>,
        artists: List<String>,
        bucket: LangBucket?,
        source: ArtistLangSource,
        limit: Int = 500,
        now: Long,
    ) {
        if (bucket == null || bucket == LangBucket.UNKNOWN || bucket == LangBucket.INSTR) return
        val strength = source.strength
        for (rawKey in artists) {
            val key = rawKey.trim()
            if (key.isEmpty()) continue
            val prev = table[key]
            if (prev == null) {
                table[key] = ArtistLangEntry(bucket, 1, strength, now)
                continue
            }
            if (strength > prev.strength) {
                table[key] = ArtistLangEntry(bucket, 1, strength, now)
                continue
            }
            if (strength < prev.strength) continue
            if (bucket == prev.bucket) {
                table[key] = prev.copy(hits = prev.hits + 1, updatedAt = now)
                continue
            }
            val hits = prev.hits - 1
            table[key] = if (hits < 0) ArtistLangEntry(bucket, 1, strength, now) else prev.copy(hits = hits, updatedAt = now)
        }
        if (table.size <= limit) return
        val ordered =
            table.entries
                .sortedWith(compareBy({ it.value.hits }, { it.value.updatedAt }))
                .map { it.key }
        for (key in ordered.take(table.size - limit)) table.remove(key)
    }

    /** L2 的批次提示：候选来自「按语种桶召回的桶」，整批都带同一个提示。 */
    data class LangResolveInput(
        val source: String? = null,
        val langField: String? = null,
        val name: String = "",
        val singer: String = "",
        val langHint: LangBucket? = null,
        val artistKeys: List<String> = emptyList(),
    )

    data class LangResolution(
        val bucket: LangBucket,
        val level: Int,
    )

    /**
     * 四级链：L1 接口逐曲字段 > L2 桶召回提示 > L3 歌手语言表 > L4 字面统计。
     * `level = 0` 表示落到 unknown（走自由名额，不参与硬约束）。
     */
    fun resolveLang(
        input: LangResolveInput,
        table: Map<String, ArtistLangEntry>? = null,
    ): LangResolution {
        val l1 = bucketFromLangField(input.source, input.langField)
        if (l1 != null) return LangResolution(l1, LangLevel.FIELD)
        val hint = input.langHint
        if (hint != null && hint != LangBucket.UNKNOWN) return LangResolution(hint, LangLevel.HINT)
        if (table != null) {
            for (artist in input.artistKeys) {
                // 表是从盘上读回来的：bucket 已由枚举反序列化保证合法，
                // 但「查不到」「值是 unknown」都当作这个歌手没记录，继续往下级走。
                val bucket = table[artist]?.bucket
                if (bucket != null && bucket != LangBucket.UNKNOWN) return LangResolution(bucket, LangLevel.ARTIST)
            }
        }
        val l4 = bucketFromScript(input.name, input.singer)
        if (l4 != null) return LangResolution(l4, LangLevel.SCRIPT)
        return LangResolution(LangBucket.UNKNOWN, LangLevel.NONE)
    }
}
