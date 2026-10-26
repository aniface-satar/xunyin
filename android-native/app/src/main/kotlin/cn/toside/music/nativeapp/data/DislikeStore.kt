package cn.toside.music.nativeapp.data

import android.content.Context
import cn.toside.music.core.player.DislikeInfo
import cn.toside.music.core.recommend.DislikeRules
import cn.toside.music.core.recommend.DislikeRulesParser
import cn.toside.music.core.storage.ShardedKvStore
import cn.toside.music.core.storage.StorageKeys
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * 「不感兴趣」持久层 —— RN `utils/dislikeManage.ts` + `utils/data.ts` 的等价物。
 *
 * 存储形状与 RN 完全一致：`@dislike_list` 存一条规则文本（`歌名@歌手` 每行一条），
 * 写入时整体重写归一化后的文本（[DislikeRulesParser.normalize]），
 * 因此原生版与 RN 版读同一份数据。
 *
 * 三处消费方：
 * - [PlayerCore][cn.toside.music.core.player.PlayerCore] 的 `dislikeInfoProvider`（切歌跳过踩雷曲）；
 * - M1 画像重排的 `blocked` 规则（隐藏踩雷歌/歌手）；
 * - 电台引擎的排除集与显式负反馈（`RadioFilter` / `RadioBehavior`）。
 */
class DislikeStore(
    context: Context,
) {
    private val kv = ShardedKvStore(DataStoreKvStore(context.applicationContext))
    private val mutex = Mutex()

    @Volatile
    private var rawCache: String? = null

    @Volatile
    private var rulesCache: DislikeRules? = null

    /** 规则文本（未解析）。 */
    suspend fun rawRules(force: Boolean = false): String =
        mutex.withLock {
            if (!force && rawCache != null) return@withLock rawCache.orEmpty()
            val raw = readLocked()
            raw
        }

    /** 解析后的规则；首次调用读盘，之后走内存缓存。 */
    suspend fun rules(force: Boolean = false): DislikeRules =
        mutex.withLock {
            if (!force) rulesCache?.let { return@withLock it }
            val raw = readLocked()
            DislikeRulesParser.parse(raw).also { rulesCache = it }
        }

    /** 给 PlayerCore 用的不喜欢集合（name / singer / 组合三类）。 */
    suspend fun info(force: Boolean = false): DislikeInfo = rules(force).toDislikeInfo()

    /** 追加一条「不感兴趣」（RN `addDislikeInfo`），返回写入后的规则。 */
    suspend fun add(
        name: String?,
        singer: String?,
    ): DislikeRules =
        mutex.withLock {
            val raw = rawCache ?: readLocked()
            val next = DislikeRulesParser.appendRule(raw, name, singer)
            if (next == raw) return@withLock DislikeRulesParser.parse(raw)
            kv.saveString(StorageKeys.DISLIKE_LIST_PREFIX, next)
            rawCache = next
            DislikeRulesParser.parse(next).also { rulesCache = it }
        }

    /** 整体覆盖规则（设置页清空/导入用；RN `overwirteDislikeInfo`）。 */
    suspend fun overwrite(rules: String): DislikeRules =
        mutex.withLock {
            val next = DislikeRulesParser.normalize(rules)
            kv.saveString(StorageKeys.DISLIKE_LIST_PREFIX, next)
            rawCache = next
            DislikeRulesParser.parse(next).also { rulesCache = it }
        }

    suspend fun clear(): DislikeRules = overwrite("")

    private suspend fun readLocked(): String {
        val raw = withContext(Dispatchers.IO) { runCatching { kv.getString(StorageKeys.DISLIKE_LIST_PREFIX) }.getOrNull() }.orEmpty()
        rawCache = raw
        return raw
    }
}

/** [DislikeRules] → PlayerCore 的不喜欢集合（小写、`@` 组合键）。 */
fun DislikeRules.toDislikeInfo(): DislikeInfo =
    DislikeInfo(
        names = names,
        musicNames = musicNames,
        singerNames = singerNames,
    )
