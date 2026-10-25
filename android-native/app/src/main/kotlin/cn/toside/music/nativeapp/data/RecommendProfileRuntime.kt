package cn.toside.music.nativeapp.data

import android.content.Context
import cn.toside.music.core.data.DataRepository
import cn.toside.music.core.player.PlayMusicInfo
import cn.toside.music.core.recommend.LearnedProfile
import cn.toside.music.core.recommend.PlayHistoryParser
import cn.toside.music.core.recommend.ProfileInput
import cn.toside.music.core.recommend.ProfileInputAssembler
import cn.toside.music.core.recommend.RecommendProfile
import cn.toside.music.core.recommend.RecommendProfileStore
import cn.toside.music.core.storage.ShardedKvStore
import cn.toside.music.core.storage.StorageKeys
import cn.toside.music.nativeapp.player.PlayerRuntime
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * 推荐画像装配层（Wave3 Lane B / S9 M1）—— 发现页推荐歌单与新歌速递的重排输入。
 *
 * 数据来源全部是原生已有信号（数据底线：缺的信号不造假）：
 * - 收藏列表 `@list__love`；
 * - 用户自建歌单 `@user_list` + 各列表曲目（最多前 [MAX_USER_LISTS] 张，按创建顺序）；
 * - 播放历史 `@play_history`（原生尚无写入方，读到空即视为无此信号）；
 * - PlayerCore `playedList`（个性电台实时曲目；没有时间戳，按装配时刻计入）。
 *
 * 装配规则在 `:core` [RecommendProfile] / [ProfileInputAssembler]（纯函数、有单测）；
 * 这里只做 IO、缓存与落盘：
 * - 内存缓存 [CACHE_TTL_MS]：一次面板刷新会同时取歌单与新歌，避免重复读列表；
 * - 落盘键对齐 RN `xunyin_recommend_state_v2`（[RecommendProfileStore]）；
 * - 读取信号失败时回退到上次落盘画像；无任何信号时返回空画像（冷启动 = 不过问）。
 *
 * 踩雷规则与「不感兴趣」隐藏名单在 M1 无原生入口/写入方，[RecommendProfile.rankState]
 * 以空规则调用；接线留给 M2。上下文来自已初始化的 [ListRuntime]（发现页同帧先建好），
 * 未初始化时返回 null，调用方保持原序。
 */
object RecommendProfileRuntime {
    private const val CACHE_TTL_MS = 60_000L
    private const val MAX_USER_LISTS = 20

    private val mutex = Mutex()

    @Volatile
    private var cached: LearnedProfile? = null

    @Volatile
    private var cachedAt = 0L

    /**
     * 当前画像；[refresh] 跳过内存缓存（面板下拉刷新）。
     * 调用线程不限：IO 读在 [Dispatchers.IO] 上串行执行。
     */
    suspend fun load(
        now: Long,
        refresh: Boolean = false,
    ): LearnedProfile? {
        val context = ListRuntime.current()?.appContext ?: return null
        if (!refresh) freshCached(now)?.let { return it }
        return mutex.withLock {
            if (!refresh) freshCached(now)?.let { return@withLock it }
            val profile = withContext(Dispatchers.IO) { readAndBuild(context, now) }
            if (profile != null) {
                cached = profile
                cachedAt = now
            }
            profile
        }
    }

    private fun freshCached(now: Long): LearnedProfile? {
        val value = cached ?: return null
        return if (now - cachedAt in 0 until CACHE_TTL_MS) value else null
    }

    private suspend fun readAndBuild(
        context: Context,
        now: Long,
    ): LearnedProfile? {
        val kv = ShardedKvStore(DataStoreKvStore(context))
        val input =
            runCatching { readInput(kv, now) }.getOrNull()
                ?: return runCatching {
                    RecommendProfileStore.load(kv.getString(RecommendProfileStore.STATE_KEY))
                }.getOrNull()
        val profile = RecommendProfileStore.trim(RecommendProfile.build(input, now))
        // 空画像不落盘：避免把「用户清空收藏」误存成长期口味
        if (input.isEmpty()) return profile
        runCatching { kv.saveString(RecommendProfileStore.STATE_KEY, RecommendProfileStore.save(profile)) }
        return profile
    }

    private suspend fun readInput(
        kv: ShardedKvStore,
        now: Long,
    ): ProfileInput {
        val repo = DataRepository(kv)
        val love = repo.getListMusics(StorageKeys.ListIds.LOVE).filterIsInstance<JsonObject>()
        val userTracks = mutableListOf<JsonObject>()
        for (info in repo.getUserLists().take(MAX_USER_LISTS)) {
            val id = info.stringField("id") ?: continue
            if (id == StorageKeys.ListIds.LOVE || info.stringField("isLove") == "true") continue
            userTracks += repo.getListMusics(id).filterIsInstance<JsonObject>()
        }
        val storedHistory = PlayHistoryParser.parse(kv.getData<JsonArray>(StorageKeys.PLAY_HISTORY)?.toString())
        val livePlayed =
            PlayerRuntime
                .current()
                ?.core
                ?.state
                ?.value
                ?.playedList
                .orEmpty()
                .mapNotNull(PlayMusicInfo::musicInfo)
        return ProfileInputAssembler.assemble(
            loveTracks = love,
            userListTracks = userTracks,
            storedHistory = storedHistory,
            livePlayed = livePlayed,
            livePlayedAt = now,
        )
    }

    private fun JsonObject.stringField(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeIf { it !is kotlinx.serialization.json.JsonNull }?.content
}

private fun ProfileInput.isEmpty(): Boolean = loveTracks.isEmpty() && userListTracks.isEmpty() && playHistory.isEmpty()
