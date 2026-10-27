package cn.toside.music.core.local

/**
 * 本地曲目重定位算路（W5-7）—— 纯字符串规则，SAF 侧的探测（`documentExists`、
 * 目录树扫描）由 app 侧 [cn.toside.music.nativeapp.util.SafDocuments] 完成。
 *
 * 场景：换机 / 文件挪目录后，持久化的 document URI 失效，曲目变哑。
 * 重定位 = 拿「期望标识」去候选文件里找回同一首歌的新 URI。
 *
 * ## 匹配规则（按优先级，多候选一律不猜）
 *
 * | 级 | 规则 | 命中条件 | 多候选 |
 * |:--:|:--|:--|:--|
 * | R1 | 完全同名 stem | 归一化后 stem 与原文件名 stem 相同 | 进 `ambiguous` |
 * | R2 | 同名且歌手一致 | 候选 stem 按 `-` 拆开后（歌名, 歌手）与期望一致 | 进 `ambiguous` |
 * | R3 | 同名候选中唯一 | 归一化后 stem 与歌名相同 | 进 `ambiguous` |
 * | R4 | 不猜 | 以上皆未唯一命中 | 进 `unmatched` |
 *
 * 为什么不猜：换错文件的代价（听错歌、歌词错位）远大于「保持失效让用户手动处理」；
 * 为什么不删：删曲是破坏性操作（用户可能只是暂时拔了 U 盘），本波只计数不删除。
 *
 * 归一化（[normalize]）：小写 + 全角→半角，吸收「同一首歌大小写 / 全半角不一致」的常见情况。
 */
object LocalRelink {
    /** 匹配优先级常量表（仅供报告与测试引用，语义见类注释的规则表）。 */
    const val RULE_EXACT_STEM: Int = 1
    const val RULE_NAME_SINGER: Int = 2
    const val RULE_NAME_UNIQUE: Int = 3

    /** 一条待重定位的失效曲目：期望标识。 */
    data class Expectation(
        val oldId: String,
        val name: String,
        val singer: String,
        val originalStem: String,
    )

    /** 一个候选文件：文件名去扩展名的 stem + document URI。 */
    data class Candidate(
        val stem: String,
        val uri: String,
    )

    /**
     * 重定位计划。[matched] 的 value 是新 document URI；
     * `unmatched` 是完全没找到的，`ambiguous` 是有多个候选不敢猜的——两者都**不删**。
     */
    data class Plan(
        val matched: Map<String, String>,
        val unmatched: List<String>,
        val ambiguous: List<String>,
    )

    /**
     * @param takenUris 已被列表里其他（未失效）曲目占用的 URI：命中它们会造成重复，
     * 直接从候选池剔除（与 `LocalTrack.dedupeKey` 同一套 id 键语义）。
     */
    fun plan(
        expectations: List<Expectation>,
        candidates: List<Candidate>,
        takenUris: Set<String> = emptySet(),
    ): Plan {
        val matched = linkedMapOf<String, String>()
        val unmatched = mutableListOf<String>()
        val ambiguous = mutableListOf<String>()
        // 一个候选只许被认领一次：两首失效曲抢同一文件时，先到先得，后者按无候选处理
        val claimed = mutableSetOf<String>()
        for (expectation in expectations) {
            // 可用候选：stem 非空、未被占用、未被前面认领
            val pool =
                candidates.filter {
                    it.uri !in takenUris && it.uri !in claimed && normalize(it.stem).isNotEmpty()
                }
            val target = matchOne(expectation, pool)
            if (target == null) {
                unmatched.add(expectation.oldId)
            } else {
                matched[expectation.oldId] = target.uri
                claimed.add(target.uri)
            }
        }
        // 歧义集在 matchOne 内无法表达（它只返回唯一命中），这里复扫一遍归类
        val ambiguousPool = candidates.filter { it.uri !in takenUris }
        val ambiguousIds =
            expectations
                .filter { it.oldId !in matched && isAmbiguous(it, ambiguousPool) }
                .map { it.oldId }
        ambiguous.addAll(ambiguousIds)
        unmatched.removeAll(ambiguous.toSet())
        return Plan(matched = matched, unmatched = unmatched.toList(), ambiguous = ambiguous.toList())
    }

    /**
     * 某条失效曲目的**歧义候选**（W6-3）—— [plan] 把它们归进 `ambiguous` 不敢猜，
     * 这里把候选列出来交给 UI 让用户自己挑（挑完走 [plan] 之外的换键路径）。
     *
     * 顺序按规则级：R1 完全同名 stem → R2 同名且歌手一致 → R3 同名唯一，
     * 同级的保持候选池原顺序（让「扫描顺序」这条既有语义不被打乱），按 uri 去重。
     */
    fun candidatesFor(
        expectation: Expectation,
        candidates: List<Candidate>,
        takenUris: Set<String> = emptySet(),
    ): List<Candidate> {
        val pool =
            candidates.filter {
                it.uri !in takenUris && normalize(it.stem).isNotEmpty()
            }
        val nameKey = normalize(expectation.name)
        if (nameKey.isEmpty()) return emptyList()
        val stemKey = normalize(expectation.originalStem)
        val singerKey = normalize(expectation.singer)
        val byStem =
            if (stemKey.isNotEmpty()) {
                pool.filter { normalize(it.stem) == stemKey }
            } else {
                emptyList()
            }
        val bySinger =
            if (singerKey.isNotEmpty()) {
                pool.filter { c ->
                    val parts = LocalTrack.splitArtist(c.stem) ?: return@filter false
                    normalize(parts.first) == nameKey && normalize(parts.second) == singerKey
                }
            } else {
                emptyList()
            }
        val byName = pool.filter { normalize(it.stem) == nameKey }
        return (byStem + bySinger + byName).distinctBy { it.uri }
    }

    /** 归一化：trim + 小写 + 全角 ASCII 段转半角 + 全角空格转半角空格。 */
    fun normalize(value: String): String =
        buildString(value.length) {
            for (ch in value.trim().lowercase()) {
                when {
                    ch == '　' -> append(' ')
                    ch.code in 0xFF01..0xFF5E -> append((ch.code - 0xFEE0).toChar())
                    else -> append(ch)
                }
            }
        }

    /** 逐级尝试 R1 → R2 → R3，只有「唯一命中」才算数。 */
    private fun matchOne(
        expectation: Expectation,
        pool: List<Candidate>,
    ): Candidate? {
        val stemKey = normalize(expectation.originalStem)
        val nameKey = normalize(expectation.name)
        if (nameKey.isEmpty()) return null
        // R1 完全同名 stem（原 stem 为空时跳过，避免空串撞上空串）
        if (stemKey.isNotEmpty()) {
            val byStem = pool.filter { normalize(it.stem) == stemKey }
            if (byStem.size == 1) return byStem[0]
        }
        // R2 同名且歌手一致：候选 stem 是「歌名 - 歌手」形态且两段都对上
        val singerKey = normalize(expectation.singer)
        if (singerKey.isNotEmpty()) {
            val bySinger =
                pool.filter { c ->
                    val parts = LocalTrack.splitArtist(c.stem) ?: return@filter false
                    normalize(parts.first) == nameKey && normalize(parts.second) == singerKey
                }
            if (bySinger.size == 1) return bySinger[0]
        }
        // R3 同名候选中唯一
        val byName = pool.filter { normalize(it.stem) == nameKey }
        if (byName.size == 1) return byName[0]
        return null
    }

    /** 是否存在「多个候选都符合某级规则」的歧义情形（R1/R2/R3 任一级命中多个）。 */
    private fun isAmbiguous(
        expectation: Expectation,
        pool: List<Candidate>,
    ): Boolean {
        val stemKey = normalize(expectation.originalStem)
        val nameKey = normalize(expectation.name)
        if (nameKey.isEmpty()) return false
        if (stemKey.isNotEmpty() && pool.count { normalize(it.stem) == stemKey } > 1) return true
        val singerKey = normalize(expectation.singer)
        if (singerKey.isNotEmpty() &&
            pool.count { c ->
                val parts = LocalTrack.splitArtist(c.stem) ?: return@count false
                normalize(parts.first) == nameKey && normalize(parts.second) == singerKey
            } > 1
        ) {
            return true
        }
        return pool.count { normalize(it.stem) == nameKey } > 1
    }
}
