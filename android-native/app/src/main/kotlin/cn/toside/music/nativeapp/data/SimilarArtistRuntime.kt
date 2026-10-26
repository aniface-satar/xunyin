package cn.toside.music.nativeapp.data

import android.content.Context
import cn.toside.music.core.recommend.m3.LangBucket
import cn.toside.music.core.recommend.m3.Language
import cn.toside.music.core.recommend.m3.SimilarArtist
import cn.toside.music.core.storage.ShardedKvStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import java.net.HttpURLConnection
import java.net.URI

/**
 * 相似歌手通道 E 的运行时 —— RN `core/recommend/similarArtistStore.ts` 的等价物。
 *
 * 纯逻辑（解析 / 状态机 / 缓存整理 / 预算）在 `:core` 的 [SimilarArtist] 里，
 * 本类只负责三件事：**发请求**、**读写缓存**、**把 kg 搜歌接到既有搜索通道**。
 *
 * 合规硬要求（三条都在这里落地）：
 * 1. `User-Agent` 必带 —— MusicBrainz 对无 UA 的请求直接 403，伪装浏览器反而会被限流；
 * 2. **全局限 1 req/s** —— MB 与 LB 共用一条串行队列（实测超限直接 503 busy）。
 *    kg 搜索走国内快队列，不受这条约束，所以两条队列彼此独立；
 * 3. **失败静默降级** —— 任何一步失败只吞掉并记 reason，绝不向 UI 抛错、绝不卡住取曲：
 *    调用方看 `songs` 是否为空决定要不要退回 A/B/D。
 *
 * 缓存键另起 `xunyin_recommend_similar_artist_v1`：形状与 RN 的
 * `xunyin_recommend_artistsim_v1` 不同（本类多存 score 与 nextIndex 语义），不互解析。
 */
class SimilarArtistRuntime(
    context: Context,
) {
    private val kv = ShardedKvStore(DataStoreKvStore(context.applicationContext))
    private val cacheMutex = Mutex()
    private val slowQueue = Mutex()

    @Volatile
    private var cache: SimilarArtist.Cache? = null

    @Volatile
    private var persistAllowed = true

    @Volatile
    private var lastSlowStartAt = 0L

    private var refreshCount = 0
    private var seedCursor = 0

    private var pendingNow: Long = 0L

    /**
     * 后台刷新产出的曲目**缓冲**：候选抓取只来取货、绝不触发网络。
     *
     * 一次 [refresh] 至少两位数的秒（MB 与 LB 全局限 1 req/s），而取曲路径是有延迟预算的。
     * 所以刷新放在独立后台任务里跑，产物留在这里等下一轮取曲 —— 首批队列拿不到 E 的曲子，
     * 但也不会为它多等 5 秒。这是与 RN 的差异点（RN 走同一套缓存 + 独立刷新循环），
     * 效果相同：E 是渐进到位而不是首屏到位。
     */
    @Volatile
    private var buffered: List<SimilarArtist.SongFetch<JsonObject>> = emptyList()

    private val bufferLock = Any()

    private fun json(): Json = HttpResponseJson

    /** 取走缓冲的曲目（非阻塞，幂等）；候选抓取用这个，不会发任何请求。 */
    fun drainBuffered(): List<SimilarArtist.SongFetch<JsonObject>> =
        synchronized(bufferLock) {
            val snapshot = buffered
            buffered = emptyList()
            snapshot
        }

    private fun buffer(songs: List<SimilarArtist.SongFetch<JsonObject>>) {
        if (songs.isEmpty()) return
        synchronized(bufferLock) {
            buffered = (buffered + songs).takeLast(POLICY.BUFFER_LIMIT)
        }
    }

    private suspend fun loadCache(now: Long): SimilarArtist.Cache {
        cache?.let { return it }
        return cacheMutex.withLock {
            cache?.let { return@withLock it }
            val loaded =
                withContext(Dispatchers.IO) {
                    runCatching { kv.getData<JsonObject>(KEY) }.getOrNull()
                }
            val parsed =
                runCatching {
                    SimilarArtist.normalizeCache(loaded, now, policy())
                }.getOrElse {
                    persistAllowed = false
                    SimilarArtist.Cache()
                }
            cache = parsed
            parsed
        }
    }

    private suspend fun save(next: SimilarArtist.Cache) {
        cache = next
        if (!persistAllowed) return
        val element: JsonElement =
            runCatching { json().encodeToJsonElement(SimilarArtist.Cache.serializer(), next) }.getOrNull() ?: return
        withContext(Dispatchers.IO) { runCatching { kv.saveData(KEY, element) } }
    }

    /**
     * 跑一轮 E 链路。返回本轮搜到的歌手曲目（可能为空 = 静默降级）。
     *
     * [seedArtists] 由调用方按画像权重降序给出，且**已剔除屏蔽歌手**——
     * 本类不做屏蔽判定，那是调用方的排除集职责。
     */
    suspend fun refresh(
        seedArtists: List<String>,
        now: Long,
        budget: Int = POLICY.BUDGET_PER_RUN,
    ): SimilarArtist.RefreshResult<JsonObject> {
        // 预热歌手语言表：MB 艺人事实的回灌走非挂起入口，表没载完时会丢弃观察
        runCatching { RecommendStores.artistLang.load() }
        val current = loadCache(now)
        val index = refreshCount
        refreshCount += 1
        pendingNow = now
        val input =
            SimilarArtist.RefreshInput(
                cache = current,
                seedArtists = seedArtists,
                seedCursor = seedCursor,
                startNewSeed = index % POLICY.SEED_INTERVAL_REFRESHES == 0,
                budget = budget.coerceAtLeast(POLICY.MIN_BUDGET),
                now = now,
                policy = policy(),
                onArtistFacts = { facts -> onArtistFacts(facts) },
            )
        val result =
            runCatching { SimilarArtist.runRefresh(input, io()) }.getOrElse {
                // 连纯逻辑都炸了说明缓存形状有问题：当作本轮无产出，不动缓存
                SimilarArtist.RefreshResult(current, emptyList(), 0, listOf("similar_artist_runtime_failed"), seedCursor)
            }
        seedCursor = result.nextSeedCursor
        save(result.cache)
        buffer(result.songs)
        return result
    }

    suspend fun size(now: Long): Int = loadCache(now).byArtist.size

    suspend fun clear() {
        cache = SimilarArtist.Cache()
        refreshCount = 0
        seedCursor = 0
        withContext(Dispatchers.IO) { runCatching { kv.removeData(KEY) } }
    }

    private fun onArtistFacts(facts: SimilarArtist.MbArtistSummary) {
        // MB 关系链是歌手级权威标签（强度 3），比单曲字段更能代表歌手整体。
        // 这里只投递到内存表；落盘由 Store.flush() 在刷新结束时统一做。
        val bucket: LangBucket = SimilarArtist.inferArtistLangFromTags(facts.tags) ?: return
        val artists = (listOf(facts.name) + facts.aliases).distinct()
        RecommendStores.artistLang.observeNow(artists, bucket, Language.ArtistLangSource.RELATION, pendingNow)
    }

    private fun policy(): SimilarArtist.Policy =
        SimilarArtist.Policy(
            aliasLookups = POLICY.ALIAS_LOOKUPS,
            songFetchesPerRun = POLICY.SONG_FETCHES_PER_RUN,
            cacheTtlMs = POLICY.CACHE_TTL_MS,
            cacheLimit = POLICY.CACHE_LIMIT,
            cacheReuseCooldownMs = POLICY.CACHE_REUSE_COOLDOWN_MS,
        )

    private fun io(): SimilarArtist.Io<JsonObject> =
        object : SimilarArtist.Io<JsonObject> {
            override suspend fun mbSearch(name: String): SimilarArtist.MbArtistSummary? {
                val body = slowRequest(buildMusicBrainzSearchUrl(name)) ?: return null
                return SimilarArtist.parseMusicBrainzArtistSearch(body)
            }

            override suspend fun lbSimilar(mbid: String): List<SimilarArtist.SimilarEntry> {
                val body = slowRequest(buildListenBrainzSimilarUrl(mbid)) ?: return emptyList()
                return SimilarArtist.parseListenBrainzSimilar(body)
            }

            override suspend fun mbLookup(mbid: String): SimilarArtist.MbArtistSummary? {
                val body = slowRequest(buildMusicBrainzLookupUrl(mbid)) ?: return null
                return SimilarArtist.parseMusicBrainzArtistLookup(body)
            }

            override suspend fun kgSongs(name: String): List<JsonObject> {
                if (name.isBlank()) return emptyList()
                val page = runCatching { SearchRuntime.search(name, 1, KG_SOURCE) }.getOrNull() ?: return emptyList()
                return page.list.take(POLICY.SONGS_PER_ARTIST)
            }
        }

    /**
     * MB/LB 共用串行队列：请求**起始**间隔 ≥ [POLICY.MIN_REQUEST_INTERVAL_MS]。
     * 用 `Mutex` 而不是 Channel，是为了让 `lastSlowStartAt` 的读写天然互斥。
     */
    private suspend fun slowRequest(url: String): JsonElement? =
        slowQueue.withLock {
            val wait = POLICY.MIN_REQUEST_INTERVAL_MS - (System.currentTimeMillis() - lastSlowStartAt)
            if (wait > 0) delay(wait)
            lastSlowStartAt = System.currentTimeMillis()
            fetchJson(url)
        }

    private suspend fun fetchJson(url: String): JsonElement? =
        withContext(Dispatchers.IO) {
            val connection = runCatching { URI.create(url).toURL().openConnection() as HttpURLConnection }.getOrNull() ?: return@withContext null
            connection.connectTimeout = POLICY.REQUEST_TIMEOUT_MS.toInt()
            connection.readTimeout = POLICY.REQUEST_TIMEOUT_MS.toInt()
            connection.setRequestProperty("User-Agent", MUSICBRAINZ_UA)
            try {
                val code = connection.responseCode
                if (code !in 200..299) return@withContext null
                val text = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                runCatching { json().parseToJsonElement(text) }.getOrNull()
            } catch (error: Exception) {
                // 超时 / 断网 / 503 一律当作「本轮没有相似歌手」
                null
            } finally {
                runCatching { connection.disconnect() }
            }
        }

    companion object {
        const val KEY = "xunyin_recommend_similar_artist_v1"

        /** MB 要求可识别的 UA，用工程地址而不是伪装浏览器。 */
        const val MUSICBRAINZ_UA = "XunYin/1.2.0 (https://github.com/aniface-satar/xunyin)"

        private const val MB_API = "https://musicbrainz.org/ws/2"
        private const val LB_SIMILAR_API = "https://labs.api.listenbrainz.org/similar-artists/json"

        /** 实测缺省 algorithm 直接 400；这是 ListenBrainz Labs 当前的会话共现算法。 */
        private const val LB_ALGORITHM =
            "session_based_days_7500_session_300_contribution_3_threshold_10_limit_100_filter_True_skip_30"

        private const val KG_SOURCE = "kg"

        private object POLICY {
            const val BUDGET_PER_RUN = 4
            const val MIN_BUDGET = 2
            const val SEED_INTERVAL_REFRESHES = 3
            const val ALIAS_LOOKUPS = 3
            const val SONG_FETCHES_PER_RUN = 3
            const val SONGS_PER_ARTIST = 8
            const val CACHE_LIMIT = 200
            const val CACHE_TTL_MS = 30L * 24 * 60 * 60 * 1000
            const val CACHE_REUSE_COOLDOWN_MS = 6L * 60 * 60 * 1000
            const val MIN_REQUEST_INTERVAL_MS = 1000L
            const val REQUEST_TIMEOUT_MS = 12_000L

            /** 缓冲最多留 24 位歌手的曲目：再多也只是把过期的候选堆在内存里。 */
            const val BUFFER_LIMIT = 24
        }

        private fun escapeQuery(name: String): String = name.replace('"', ' ').replace('\\', ' ').trim()

        fun buildMusicBrainzSearchUrl(name: String): String =
            "$MB_API/artist/?query=artist%3A%22${encode(escapeQuery(name))}%22&fmt=json&limit=1"

        fun buildMusicBrainzLookupUrl(mbid: String): String = "$MB_API/artist/${encode(mbid)}?inc=aliases+tags&fmt=json"

        fun buildListenBrainzSimilarUrl(mbid: String): String =
            "$LB_SIMILAR_API?artist_mbids=${encode(mbid)}&algorithm=$LB_ALGORITHM"

        private fun encode(value: String): String = java.net.URLEncoder.encode(value, "UTF-8").replace("+", "%20")
    }
}

/** 共享的 Json 实例：解析宽松（忽略未知键），够用且省一个每次新建的开销。 */
private val HttpResponseJson: Json =
    Json {
        ignoreUnknownKeys = true
        isLenient = true
    }
