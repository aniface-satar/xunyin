package cn.toside.music.nativeapp.data

import android.content.Context
import cn.toside.music.core.recommend.TrackKeys
import cn.toside.music.core.recommend.m3.LangBucket
import cn.toside.music.core.recommend.m3.Language
import cn.toside.music.core.storage.ShardedKvStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/**
 * 歌手语言表（语种判定的 L3）—— RN `core/recommend/artistLanguageStore.ts` 的等价物。
 *
 * 键沿用 RN 的 `xunyin_recommend_artist_lang_v1`：形状一致（歌手键 → 桶/命中/强度/时间），
 * 所以这一张表两端可以互读，不像相似歌手缓存那样必须另起键。
 *
 * 三个观察入口按强度分层：歌词（1）< 逐曲字段（2）< MB 关系链（3）。
 * 合并规则全在 [Language.updateArtistLangTable] 里，本类只管「读、写、延迟落盘」。
 *
 * 读盘失败时 [persistAllowed] 置 false：此刻内存表是从空表起步的，磁盘上那份积累了
 * 数周的旧表我们没见过，照常落盘就会把它整张覆写成近似空表。降级方向是
 * 「观察只在内存里累积、什么都不持久化」，而不是「磁盘表被销毁」。
 */
class ArtistLangStore(
    context: Context,
) {
    private val kv = ShardedKvStore(DataStoreKvStore(context.applicationContext))
    private val mutex = Mutex()
    private val serializer = MapSerializer(String.serializer(), Language.ArtistLangEntry.serializer())

    @Volatile
    private var table: MutableMap<String, Language.ArtistLangEntry>? = null

    @Volatile
    private var persistAllowed = true

    @Volatile
    private var dirty = false

    /** 打分路径用：未 load 完成时返回空表而不是抛错，别让存储时序卡住取曲。 */
    fun peek(): Map<String, Language.ArtistLangEntry> = table.orEmpty()

    /**
     * L3 查询：`core` 传进来的键来自 `TrackKeys.getArtistKeys`（已归一化，拉丁名小写）。
     *
     * 先按原键查，再按 [TrackKeys.normalizeText] 归一化查——第二跳是为了读回 Wave5 的磁盘表：
     * 那时唯一的写入方是 MB 艺人事实（`facts.name` 原样落键），拉丁歌手名带大写，
     * 只按归一化键查会一条都命中不了。新写入已统一归一化（见 [observeNow]），两跳对新数据等价。
     */
    fun lookup(artist: String): LangBucket? {
        val current = table ?: return null
        current[artist]?.let { return it.bucket }
        val normalized = TrackKeys.normalizeText(artist)
        if (normalized == artist) return null
        return current[normalized]?.bucket
    }

    suspend fun load(force: Boolean = false): MutableMap<String, Language.ArtistLangEntry> {
        table?.takeIf { !force }?.let { return it }
        return mutex.withLock {
            table?.takeIf { !force }?.let { return@withLock it }
            val loaded =
                withContext(Dispatchers.IO) {
                    runCatching { kv.getData<kotlinx.serialization.json.JsonObject>(KEY) }.getOrNull()
                }
            val parsed =
                if (loaded == null) {
                    mutableMapOf()
                } else {
                    runCatching { Json.decodeFromJsonElement(serializer, loaded) }
                        .getOrElse {
                            persistAllowed = false
                            mutableMapOf()
                        }.toMutableMap()
                }
            table = parsed
            parsed
        }
    }

    /**
     * 观察写入。桶能不能入库（`unknown` / `instr` 的排除）由
     * [Language.updateArtistLangTable] 把关，这里只挡「什么都不会写」的空观察。
     */
    suspend fun observe(
        artists: List<String>,
        bucket: LangBucket?,
        source: Language.ArtistLangSource,
        now: Long,
    ) {
        if (bucket == null || artists.isEmpty()) return
        val current = load()
        Language.updateArtistLangTable(current, keysOf(artists), bucket, source, ARTIST_TABLE_LIMIT, now)
        dirty = true
    }

    /**
     * 非挂起观察入口：给「回调里拿不到 suspend 上下文」的调用方用（如 MB 艺人事实回灌）。
     * 表还没 load 完成时**丢弃这次观察**——宁可少记一条，也不在取曲路径上等磁盘。
     * 调用方应在刷新开始前先 `load()` 预热。
     */
    fun observeNow(
        artists: List<String>,
        bucket: LangBucket?,
        source: Language.ArtistLangSource,
        now: Long,
    ) {
        if (bucket == null || artists.isEmpty()) return
        val current = table ?: return
        Language.updateArtistLangTable(current, keysOf(artists), bucket, source, ARTIST_TABLE_LIMIT, now)
        dirty = true
    }

    /** 把内存表落盘（由调用方在合适的时机触发，例如电台一次刷新结束）。 */
    suspend fun flush() {
        if (!dirty || !persistAllowed) return
        val current = table ?: return
        val element = runCatching { Json.encodeToJsonElement(serializer, current.toMap()) }.getOrNull() ?: return
        withContext(Dispatchers.IO) { runCatching { kv.saveData(KEY, element) } }
        dirty = false
    }

    suspend fun clear() {
        withContext(Dispatchers.IO) { runCatching { kv.removeData(KEY) } }
        table = mutableMapOf()
        dirty = false
    }

    companion object {
        const val KEY = "xunyin_recommend_artist_lang_v1"
        const val ARTIST_TABLE_LIMIT = 500

        /** 写入键与读侧同口径（`TrackKeys.getArtistKeys` 的归一化），否则拉丁歌手名永远查不到。 */
        private fun keysOf(artists: List<String>): List<String> =
            artists.map { TrackKeys.normalizeText(it) }.filter { it.isNotEmpty() }.distinct()
    }
}
