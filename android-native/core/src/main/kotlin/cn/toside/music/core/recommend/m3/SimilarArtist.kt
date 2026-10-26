package cn.toside.music.core.recommend.m3

import kotlinx.coroutines.CancellationException
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import kotlin.math.max
import kotlin.math.min

/**
 * 相似歌手通道 E 的纯逻辑 —— RN `core/recommend/similarArtist.ts` 原样移植：
 * MB/LB 响应解析、跨刷新任务状态机、缓存整理与预算调度。
 *
 * 这里**不发请求、不碰存储**：运行时 I/O 由 app 侧的 `SimilarArtistRuntime` 以 `suspend` 函数注入，
 * 因此整条链路可以在 JVM 单测里跑完（含超时与降级路径）。
 *
 * 合规硬要求（落在 app 侧，纯逻辑只保证不阻拦）：
 * - MusicBrainz 强制可识别 `User-Agent`；
 * - MB/LB 全局限 1 req/s（串行队列）；
 * - 失败**静默降级**：拿不到就退回 A/B/D 通道，不弹错、不卡住取曲。
 */
object SimilarArtist {
    data class MbArtistSummary(
        val mbid: String,
        val name: String,
        val aliases: List<String>,
        val tags: List<String>,
    )

    @Serializable
    data class SimilarEntry(
        val mbid: String,
        val name: String,
        val score: Double,
    )

    @Serializable
    enum class Stage {
        @SerialName("search")
        SEARCH,

        @SerialName("similar")
        SIMILAR,

        @SerialName("aliases")
        ALIASES,

        @SerialName("songs")
        SONGS,

        @SerialName("done")
        DONE,
    }

    /** 跨刷新续跑的链路任务：已完成/已成功的阶段不会重发请求。 */
    @Serializable
    data class Task(
        val seedArtist: String,
        val stage: Stage,
        val seedMbid: String? = null,
        val similar: List<SimilarEntry> = emptyList(),
        /** 已尝试过 MB 规范名反查的相似歌手数（失败也推进，避免卡在同一位置）。 */
        val aliasCursor: Int = 0,
        val resolved: List<SimilarEntry> = emptyList(),
        /** 还没搜过歌的规范歌手名；失败时也移出，不让一个名字卡死整条链路。 */
        val pending: List<String> = emptyList(),
        val createdAt: Long,
        val updatedAt: Long,
    )

    @Serializable
    data class Record(
        val similar: List<SimilarEntry> = emptyList(),
        val source: String = "musicbrainz+listenbrainz",
        val fetchedAt: Long,
        /** 缓存命中后搜歌的轮换位，避免每次都重复同一批相似歌手。 */
        val nextIndex: Int = 0,
        /** 上次搜歌时间；冷却期内不重复花 kg 请求。 */
        val songsFetchedAt: Long = 0,
    )

    @Serializable
    data class Cache(
        val byArtist: Map<String, Record> = emptyMap(),
        /** 不受 TTL 管：链路中途态被清掉就永远铺不完。 */
        val pending: Map<String, Task> = emptyMap(),
    )

    data class Policy(
        val aliasLookups: Int = 3,
        val songFetchesPerRun: Int = 3,
        val cacheTtlMs: Long = 30L * 24 * 60 * 60 * 1000,
        val cacheLimit: Int = 200,
        val cacheReuseCooldownMs: Long = 6L * 60 * 60 * 1000,
    )

    const val SOURCE_EMPTY = "empty"
    const val SOURCE_MB_LB = "musicbrainz+listenbrainz"

    private const val PENDING_LIMIT = 20

    sealed interface Action {
        data class MbSearch(
            val seedArtist: String,
            val query: String,
        ) : Action

        data class LbSimilar(
            val seedArtist: String,
            val mbid: String,
        ) : Action

        data class MbAlias(
            val seedArtist: String,
            val mbid: String,
        ) : Action

        data class KgSongs(
            val seedArtist: String,
            val artist: String,
        ) : Action
    }

    sealed interface Outcome {
        data class MbSearched(
            val artist: MbArtistSummary?,
        ) : Outcome

        data class LbSimilared(
            val entries: List<SimilarEntry>,
        ) : Outcome

        data class MbAliased(
            val artist: MbArtistSummary?,
        ) : Outcome

        object KgSongsDone : Outcome
    }

    /** 运行时 I/O 注入点。任一函数抛错都等价于「这一步失败」，由 [runRefresh] 统一降级。 */
    interface Io<T> {
        suspend fun mbSearch(name: String): MbArtistSummary?

        suspend fun lbSimilar(mbid: String): List<SimilarEntry>

        suspend fun mbLookup(mbid: String): MbArtistSummary?

        suspend fun kgSongs(name: String): List<T>
    }

    fun actionKindOf(action: Action): String =
        when (action) {
            is Action.MbSearch -> "mb_search"
            is Action.LbSimilar -> "lb_similar"
            is Action.MbAlias -> "mb_alias"
            is Action.KgSongs -> "kg_songs"
        }

    private fun JsonElement?.asObject(): JsonObject? = this as? JsonObject

    private fun readNameList(value: JsonElement?): List<String> {
        val array = value as? JsonArray ?: return emptyList()
        val names = mutableListOf<String>()
        for (item in array) {
            val name =
                when (item) {
                    is JsonPrimitive -> if (item.isString) item.content.trim() else ""
                    is JsonObject -> (item["name"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
                    else -> ""
                }
            if (name.isNotEmpty() && !names.contains(name)) names.add(name)
        }
        return names
    }

    private fun parseMbArtist(raw: JsonElement?): MbArtistSummary? {
        val obj = raw.asObject() ?: return null
        val mbid = (obj["id"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
        val name = (obj["name"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
        if (mbid.isEmpty() || name.isEmpty()) return null
        return MbArtistSummary(mbid, name, readNameList(obj["aliases"]), readNameList(obj["tags"]))
    }

    /** MB 搜索响应里 `artists[0]` 就是最相关结果；没有结果返回 null，由调用方决定缓存「查无此人」。 */
    fun parseMusicBrainzArtistSearch(body: JsonElement?): MbArtistSummary? {
        val obj = body.asObject() ?: return null
        val artists = obj["artists"] as? JsonArray ?: return null
        if (artists.isEmpty()) return null
        return parseMbArtist(artists[0])
    }

    /** MB 单艺人反查（inc=aliases+tags），响应就是艺人本体。 */
    fun parseMusicBrainzArtistLookup(body: JsonElement?): MbArtistSummary? = parseMbArtist(body)

    /**
     * LB 相似歌手：接口返回 100 条左右，按 score 降序、按 mbid 去重。
     * 只采信 mbid，名字要到 MB 反查拿规范名（实测 LB 的 name 繁简/拉丁混排）。
     */
    fun parseListenBrainzSimilar(body: JsonElement?): List<SimilarEntry> {
        if (body !is JsonArray) return emptyList()
        val byMbid = linkedMapOf<String, SimilarEntry>()
        for (raw in body) {
            val obj = raw.asObject() ?: continue
            val mbid = (obj["artist_mbid"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
            val name = (obj["name"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
            if (mbid.isEmpty() || name.isEmpty()) continue
            val score = (obj["score"] as? JsonPrimitive)?.doubleOrNull?.takeIf { it.isFinite() } ?: 0.0
            val entry = SimilarEntry(mbid, name, score)
            val prev = byMbid[mbid]
            if (prev == null || entry.score > prev.score) byMbid[mbid] = entry
        }
        return byMbid.values.sortedByDescending { it.score }
    }

    /** 只认显式语种标签；多语种并列时不硬判——错写进 L3 会比不写更糟。 */
    private val MB_TAG_LANG: Map<String, LangBucket> =
        mapOf(
            "mandarin" to LangBucket.ZH,
            "mandopop" to LangBucket.ZH,
            "mandarin pop" to LangBucket.ZH,
            "chinese" to LangBucket.ZH,
            "chinese pop" to LangBucket.ZH,
            "cantopop" to LangBucket.YUE,
            "canto-pop" to LangBucket.YUE,
            "cantonese" to LangBucket.YUE,
            "cantonese pop" to LangBucket.YUE,
            "j-pop" to LangBucket.JA,
            "japanese" to LangBucket.JA,
            "japanese pop" to LangBucket.JA,
            "k-pop" to LangBucket.KO,
            "korean" to LangBucket.KO,
            "korean pop" to LangBucket.KO,
            "english" to LangBucket.EN,
            "english pop" to LangBucket.EN,
        )

    fun inferArtistLangFromTags(tags: List<String>): LangBucket? {
        val buckets = mutableListOf<LangBucket>()
        for (raw in tags) {
            val bucket = MB_TAG_LANG[raw.trim().lowercase()] ?: continue
            if (!buckets.contains(bucket)) buckets.add(bucket)
        }
        return if (buckets.size == 1) buckets[0] else null
    }

    private fun parseEntries(value: JsonElement?): List<SimilarEntry> {
        val array = value as? JsonArray ?: return emptyList()
        val byMbid = linkedMapOf<String, SimilarEntry>()
        for (raw in array) {
            val obj = raw.asObject() ?: continue
            val mbid = (obj["mbid"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
            val name = (obj["name"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
            if (mbid.isEmpty() || name.isEmpty()) continue
            val score = (obj["score"] as? JsonPrimitive)?.doubleOrNull?.takeIf { it.isFinite() } ?: 0.0
            if (!byMbid.containsKey(mbid)) byMbid[mbid] = SimilarEntry(mbid, name, score)
        }
        return byMbid.values.toList()
    }

    private fun readTime(
        value: JsonElement?,
        fallback: Long = 0L,
    ): Long {
        val number = (value as? JsonPrimitive)?.longOrNull ?: return fallback
        return if (number >= 0) number else fallback
    }

    private fun readString(
        obj: JsonObject,
        key: String,
    ): String? = (obj[key] as? JsonPrimitive)?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }

    private fun normalizeRecord(value: JsonElement?): Record? {
        val obj = value.asObject() ?: return null
        val fetchedAt = readTime(obj["fetchedAt"])
        if (fetchedAt <= 0L) return null
        val source = if (readString(obj, "source") == SOURCE_EMPTY) SOURCE_EMPTY else SOURCE_MB_LB
        return Record(
            similar = parseEntries(obj["similar"]),
            source = source,
            fetchedAt = fetchedAt,
            nextIndex = max(0, readTime(obj["nextIndex"]).toInt()),
            songsFetchedAt = readTime(obj["songsFetchedAt"]),
        )
    }

    private fun stageFromWire(value: String?): Stage? = Stage.entries.firstOrNull { it.name.lowercase() == value?.lowercase() }

    private fun normalizeTask(value: JsonElement?): Task? {
        val obj = value.asObject() ?: return null
        val seedArtist = readString(obj, "seedArtist") ?: return null
        val stage = stageFromWire(readString(obj, "stage")) ?: return null
        if (stage == Stage.DONE) return null
        val pending =
            (obj["pending"] as? JsonArray)
                ?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.trim()?.takeIf { name -> name.isNotEmpty() } }
                ?.distinct()
                .orEmpty()
        if (stage == Stage.SONGS && pending.isEmpty()) return null
        return Task(
            seedArtist = seedArtist,
            stage = stage,
            seedMbid = readString(obj, "seedMbid"),
            similar = parseEntries(obj["similar"]),
            aliasCursor = max(0, readTime(obj["aliasCursor"]).toInt()),
            resolved = parseEntries(obj["resolved"]),
            pending = pending,
            createdAt = readTime(obj["createdAt"]),
            updatedAt = readTime(obj["updatedAt"]),
        )
    }

    /**
     * 存储形状不认识就当作无缓存重来（独立键没有版本戳，不能靠 STATE_VERSION 迁移）。
     * `byArtist` 受 TTL 管、超容量按 `fetchedAt` 留最新；`pending` 不受 TTL 管，只在链路完成时删除。
     */
    fun normalizeCache(
        loaded: JsonElement?,
        now: Long,
        policy: Policy = Policy(),
    ): Cache {
        val root = loaded.asObject() ?: return Cache()
        val byArtist = mutableMapOf<String, Record>()
        val rawByArtist = root["byArtist"].asObject()
        if (rawByArtist != null) {
            for ((seedArtist, value) in rawByArtist) {
                val record = normalizeRecord(value) ?: continue
                if (now - record.fetchedAt > policy.cacheTtlMs) continue
                byArtist[seedArtist] = record
            }
        }
        if (byArtist.size > policy.cacheLimit) {
            val ordered = byArtist.entries.sortedByDescending { it.value.fetchedAt }.map { it.key }
            for (key in ordered.drop(policy.cacheLimit)) byArtist.remove(key)
        }
        val pending = mutableMapOf<String, Task>()
        val rawPending = root["pending"].asObject()
        if (rawPending != null) {
            for ((seedArtist, value) in rawPending) {
                val task = normalizeTask(value) ?: continue
                if (task.seedArtist != seedArtist) continue
                pending[seedArtist] = task
            }
        }
        if (pending.size > PENDING_LIMIT) {
            val ordered = pending.entries.sortedByDescending { it.value.updatedAt }.map { it.key }
            for (key in ordered.drop(PENDING_LIMIT)) pending.remove(key)
        }
        return Cache(byArtist, pending)
    }

    fun createTask(
        seedArtist: String,
        now: Long,
    ): Task = Task(seedArtist = seedArtist, stage = Stage.SEARCH, createdAt = now, updatedAt = now)

    fun nextAction(
        task: Task,
        aliasLookups: Int = Policy().aliasLookups,
    ): Action? =
        when (task.stage) {
            Stage.SEARCH -> Action.MbSearch(task.seedArtist, task.seedArtist)
            Stage.SIMILAR -> task.seedMbid?.let { Action.LbSimilar(task.seedArtist, it) }
            Stage.ALIASES -> {
                val target = min(max(0, aliasLookups), task.similar.size)
                if (task.aliasCursor < target) Action.MbAlias(task.seedArtist, task.similar[task.aliasCursor].mbid) else null
            }
            Stage.SONGS -> task.pending.firstOrNull()?.let { Action.KgSongs(task.seedArtist, it) }
            Stage.DONE -> null
        }

    private fun advanceAliases(
        task: Task,
        aliasLookups: Int,
    ): Task {
        val target = min(max(0, aliasLookups), task.similar.size)
        if (task.aliasCursor < target) return task
        val names = mutableListOf<String>()
        for (resolved in task.resolved) {
            val name = resolved.name.trim()
            if (name.isEmpty() || name == task.seedArtist || names.contains(name)) continue
            names.add(name)
        }
        return task.copy(
            pending = names,
            stage = if (names.isEmpty()) Stage.DONE else Stage.SONGS,
        )
    }

    fun applyOutcome(
        task: Task,
        action: Action,
        outcome: Outcome,
        now: Long,
        aliasLookups: Int = Policy().aliasLookups,
    ): Task {
        val next = task.copy(similar = task.similar, resolved = task.resolved, pending = task.pending, updatedAt = now)
        when (action) {
            is Action.MbSearch -> {
                val artist = (outcome as? Outcome.MbSearched)?.artist
                if (artist == null) return next.copy(stage = Stage.DONE)
                return next.copy(seedMbid = artist.mbid, stage = Stage.SIMILAR)
            }
            is Action.LbSimilar -> {
                val entries = (outcome as? Outcome.LbSimilared)?.entries.orEmpty()
                val sorted = entries.sortedByDescending { it.score }
                val staged = next.copy(similar = sorted, aliasCursor = 0, stage = if (sorted.isEmpty()) Stage.DONE else Stage.ALIASES)
                if (staged.stage == Stage.DONE) return staged
                return advanceAliases(staged, aliasLookups)
            }
            is Action.MbAlias -> {
                val artist = (outcome as? Outcome.MbAliased)?.artist
                val resolved = next.resolved.toMutableList()
                if (artist != null && artist.name.isNotEmpty()) {
                    val mbid = artist.mbid.ifEmpty { action.mbid }
                    if (resolved.none { it.mbid == mbid }) resolved.add(SimilarEntry(mbid, artist.name, 0.0))
                }
                return advanceAliases(
                    next.copy(resolved = resolved, aliasCursor = next.aliasCursor + 1),
                    aliasLookups,
                )
            }
            is Action.KgSongs -> {
                // 搜歌失败也推进：kg 搜索重试价值低，留下来只会让整条链路永远铺不完
                val pending = next.pending.drop(1)
                return next.copy(pending = pending, stage = if (pending.isEmpty()) Stage.DONE else Stage.SONGS)
            }
        }
    }

    fun completeTask(
        task: Task,
        now: Long,
    ): Record =
        Record(
            similar = task.resolved.toList(),
            source = if (task.resolved.isEmpty()) SOURCE_EMPTY else SOURCE_MB_LB,
            fetchedAt = now,
            nextIndex = 0,
            // songs 阶段刚按这批名字搜过歌；空记录没有可搜的，置 0 不参与冷却
            songsFetchedAt = if (task.resolved.isEmpty()) 0L else now,
        )

    data class SeedPick(
        val seedArtist: String,
        val nextCursor: Int,
    )

    fun pickSeed(
        artists: List<String>,
        cache: Cache,
        cursor: Int,
    ): SeedPick? {
        if (artists.isEmpty()) return null
        val taken = cache.byArtist.keys + cache.pending.keys
        val size = artists.size
        val start = ((max(0, cursor) % size) + size) % size
        for (offset in 0 until size) {
            val index = (start + offset) % size
            val seedArtist = artists[index]
            if (taken.contains(seedArtist)) continue
            return SeedPick(seedArtist, (index + 1) % size)
        }
        return null
    }

    data class CachedFetchPlan(
        val names: List<String>,
        val nextIndex: Int,
    )

    fun planCachedSongFetches(
        record: Record,
        count: Int,
    ): CachedFetchPlan {
        val size = record.similar.size
        if (size == 0 || count <= 0) return CachedFetchPlan(emptyList(), record.nextIndex % max(1, size))
        val start = ((record.nextIndex % size) + size) % size
        val take = min(count, size)
        val names = mutableListOf<String>()
        for (offset in 0 until take) {
            val name = record.similar[(start + offset) % size].name
            if (!names.contains(name)) names.add(name)
        }
        return CachedFetchPlan(names, (start + take) % size)
    }

    /** 冷却期外、且最久没搜过歌的那位歌手；没有可用的返回 null。 */
    fun pickCachedRecord(
        cache: Cache,
        now: Long,
        cooldownMs: Long,
    ): String? {
        var picked: String? = null
        var oldest = Long.MAX_VALUE
        for ((seedArtist, record) in cache.byArtist) {
            if (record.similar.isEmpty()) continue
            if (record.songsFetchedAt > 0 && now - record.songsFetchedAt < cooldownMs) continue
            if (record.songsFetchedAt >= oldest) continue
            oldest = record.songsFetchedAt
            picked = seedArtist
        }
        return picked
    }

    data class SongFetch<T>(
        val seedArtist: String,
        val artistName: String,
        val tracks: List<T>,
    )

    /** 首屏补给的一条取货计划：用上一会话缓存里的相似歌手名去 kg 搜歌。 */
    data class PrefillPick(
        val seedArtist: String,
        val artistName: String,
    )

    data class PrefillGate(
        /** 距上次补给不到冷却期 → 不开闸。 */
        val cooldownMs: Long = 60_000L,
        /** 滑窗内最多补给几次（防「反复停播/开播」把 kg 请求堆起来）。 */
        val maxPerWindow: Int = 3,
        val windowMs: Long = 10L * 60 * 1000,
    )

    /**
     * 首屏补给的闸门（W6-11）：补给挂在开播路径上，反复停播→开播会让它每轮都发
     * `PREFILL_ARTISTS` 次 kg 搜歌。RN 没有等价入口（E 的推进只在刷新链路里按预算走一格，
     * 且受 `cacheReuseCooldownMs` 6h 约束），所以这是原生自己的节拍，用两道闸对齐 RN 的节奏：
     * 1. 冷却期（默认 60 s）—— 抖动式开播不重复搜；
     * 2. 滑窗次数上限（默认 10 分钟 3 次）—— 长时间来回切换也不会把请求堆成串。
     *
     * 缓存状态不能当闸门用：补给是**只读**的（不推进 `nextIndex` / `songsFetchedAt`），
     * 用缓存里的 `songsFetchedAt` 判断会变成「要么永远开、要么永远关」。
     */
    fun prefillAllowed(
        now: Long,
        lastPrefillAt: Long,
        recentPrefills: List<Long> = emptyList(),
        gate: PrefillGate = PrefillGate(),
    ): Boolean {
        if (now - lastPrefillAt < gate.cooldownMs) return false
        val recent = recentPrefills.count { now - it in 0 until gate.windowMs }
        return recent < max(1, gate.maxPerWindow)
    }

    /**
     * 方案 b 的纯计划部分：从上一会话缓存里挑出最多 [maxArtists] 位相似歌手（不碰网络）。
     *
     * 排序按缓存的 `fetchedAt` 降序（最近铺完的种子优先），每个种子从自己的 `nextIndex`
     * 开始取——与后台 refresh 的轮换位一致，避免每次都补给同几个人。
     * 缓存为空 / 记录里没有相似歌手 / `maxArtists <= 0` 一律返回空表，调用方据此**不发请求**。
     */
    fun planCachePrefill(
        cache: Cache,
        maxArtists: Int,
    ): List<PrefillPick> {
        if (maxArtists <= 0 || cache.byArtist.isEmpty()) return emptyList()
        val picks = mutableListOf<PrefillPick>()
        val ordered = cache.byArtist.entries.sortedByDescending { it.value.fetchedAt }
        for ((seedArtist, record) in ordered) {
            if (record.similar.isEmpty()) continue
            val start = Math.floorMod(record.nextIndex, record.similar.size)
            for (offset in record.similar.indices) {
                val entry = record.similar[(start + offset) % record.similar.size]
                picks.add(PrefillPick(seedArtist, entry.name))
                if (picks.size >= maxArtists) return picks
            }
        }
        return picks
    }

    data class RefreshInput(
        val cache: Cache,
        /** 候选种子歌手，按画像权重降序；调用方已剔除屏蔽歌手。 */
        val seedArtists: List<String>,
        val seedCursor: Int,
        /** 本轮是否轮到起一位新种子（每 3 次刷新一次）；有在途任务时仍续跑在途。 */
        val startNewSeed: Boolean,
        val budget: Int,
        val now: Long,
        val policy: Policy = Policy(),
        /** MB 返回的艺人事实，供 L3 歌手语言表借鉴（可选）。 */
        val onArtistFacts: ((MbArtistSummary) -> Unit)? = null,
    )

    data class RefreshResult<T>(
        val cache: Cache,
        val songs: List<SongFetch<T>>,
        val requests: Int,
        val reasons: List<String>,
        val nextSeedCursor: Int,
    )

    private fun trimCache(
        cache: Cache,
        limit: Int,
    ): Cache {
        if (cache.byArtist.size <= limit) return cache
        val ordered =
            cache.byArtist.entries
                .sortedByDescending { it.value.fetchedAt }
                .map { it.key }
        val kept = cache.byArtist.toMutableMap()
        for (key in ordered.drop(limit)) kept.remove(key)
        return cache.copy(byArtist = kept)
    }

    /**
     * 一轮 E 链路调度：先续跑在途任务（预算内逐个请求），完成后把任务落成缓存；
     * 预算还有剩且没有在途任务时，按冷却轮换给已缓存的相似歌手搜歌。
     * 返回新的缓存对象，不修改调用方传入的 cache。
     *
     * 任何一个请求抛错都只记一条 `similar_artist_<kind>_failed` 原因并结束本轮——
     * 这就是「静默降级」的实现：调用方看 `songs` 是否为空决定要不要退回 A/B/D。
     */
    suspend fun <T> runRefresh(
        input: RefreshInput,
        io: Io<T>,
    ): RefreshResult<T> {
        val policy = input.policy
        var cache = input.cache.copy(byArtist = input.cache.byArtist.toMap(), pending = input.cache.pending.toMap())
        val reasons = mutableListOf<String>()
        val songs = mutableListOf<SongFetch<T>>()
        var requests = 0
        var remaining = max(0, input.budget)
        var seedCursor = input.seedCursor
        val pending = cache.pending.toMutableMap()

        var task: Task? = pending.values.sortedBy { it.createdAt }.firstOrNull()
        if (task == null && input.startNewSeed) {
            val picked = pickSeed(input.seedArtists, cache, seedCursor)
            if (picked != null) {
                seedCursor = picked.nextCursor
                task = createTask(picked.seedArtist, input.now)
                pending[picked.seedArtist] = task
                reasons.add("similar_artist_seed:${picked.seedArtist}")
            }
        }
        cache = cache.copy(pending = pending.toMap())

        while (remaining > 0) {
            val current: Task = task ?: break
            val action = nextAction(current, policy.aliasLookups) ?: break
            remaining -= 1
            requests += 1
            val kind = actionKindOf(action)
            try {
                val advanced =
                    when (action) {
                        is Action.MbSearch -> {
                            val artist = io.mbSearch(action.query)
                            if (artist != null) input.onArtistFacts?.invoke(artist)
                            applyOutcome(current, action, Outcome.MbSearched(artist), input.now, policy.aliasLookups)
                        }
                        is Action.LbSimilar -> {
                            val entries = io.lbSimilar(action.mbid)
                            applyOutcome(current, action, Outcome.LbSimilared(entries), input.now, policy.aliasLookups)
                        }
                        is Action.MbAlias -> {
                            val artist = io.mbLookup(action.mbid)
                            if (artist != null) input.onArtistFacts?.invoke(artist)
                            applyOutcome(current, action, Outcome.MbAliased(artist), input.now, policy.aliasLookups)
                        }
                        is Action.KgSongs -> {
                            val tracks = io.kgSongs(action.artist)
                            songs.add(SongFetch(current.seedArtist, action.artist, tracks))
                            applyOutcome(current, action, Outcome.KgSongsDone, input.now, policy.aliasLookups)
                        }
                    }
                if (advanced.stage == Stage.DONE) {
                    val nextPending = pending.toMutableMap()
                    nextPending.remove(advanced.seedArtist)
                    val nextByArtist = cache.byArtist.toMutableMap()
                    nextByArtist[advanced.seedArtist] = completeTask(advanced, input.now)
                    cache = trimCache(cache.copy(byArtist = nextByArtist, pending = nextPending.toMap()), policy.cacheLimit)
                    task = null
                    break
                }
                task = advanced
                pending[advanced.seedArtist] = advanced
                cache = cache.copy(pending = pending.toMap())
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                reasons.add("similar_artist_${kind}_failed")
                if (kind == "kg_songs") {
                    val advanced = applyOutcome(current, action, Outcome.KgSongsDone, input.now, policy.aliasLookups)
                    if (advanced.stage == Stage.DONE) {
                        val nextPending = pending.toMutableMap()
                        nextPending.remove(advanced.seedArtist)
                        val nextByArtist = cache.byArtist.toMutableMap()
                        nextByArtist[advanced.seedArtist] = completeTask(advanced, input.now)
                        cache = trimCache(cache.copy(byArtist = nextByArtist, pending = nextPending.toMap()), policy.cacheLimit)
                    } else {
                        pending[advanced.seedArtist] = advanced
                        cache = cache.copy(pending = pending.toMap())
                    }
                }
                break
            }
        }

        if (task == null && remaining > 0 && policy.songFetchesPerRun > 0) {
            val seedArtist = pickCachedRecord(cache, input.now, policy.cacheReuseCooldownMs)
            if (seedArtist != null) {
                val cached = cache.byArtist.getValue(seedArtist)
                val plan = planCachedSongFetches(cached, min(policy.songFetchesPerRun, remaining))
                val byArtist = cache.byArtist.toMutableMap()
                byArtist[seedArtist] = cached.copy(nextIndex = plan.nextIndex, songsFetchedAt = input.now)
                cache = cache.copy(byArtist = byArtist)
                for (artistName in plan.names) {
                    if (remaining <= 0) break
                    remaining -= 1
                    requests += 1
                    try {
                        songs.add(SongFetch(seedArtist, artistName, io.kgSongs(artistName)))
                    } catch (error: Exception) {
                        if (error is CancellationException) throw error
                        reasons.add("similar_artist_kg_songs_failed")
                    }
                }
            }
        }

        return RefreshResult(cache, songs, requests, reasons.distinct(), seedCursor)
    }
}
