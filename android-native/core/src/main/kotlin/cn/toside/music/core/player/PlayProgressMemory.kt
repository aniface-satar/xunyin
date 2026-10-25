package cn.toside.music.core.player

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * 上次播放位置（RN `LX.Player.SavedPlayInfo`）。
 *
 * `index` 是**列表内**索引（RN `playerState.playInfo.playIndex`），不是播放器队列索引；
 * 恢复时直接拿它去列表取曲目并校验存在性。
 */
data class SavedPlayInfo(
    val timeSec: Float,
    val maxTimeSec: Float,
    val listId: String,
    val index: Int,
)

/** 进度持久层抽象：app 层用 SharedPreferences 落盘，JVM 测试用内存实现。 */
interface SavedPlayInfoStorage {
    suspend fun save(info: SavedPlayInfo)

    suspend fun load(): SavedPlayInfo?
}

/** `SavedPlayInfo` 的 JSON 编解码（RN 直接用 AsyncStorage 存对象，这里存一行 JSON）。 */
object SavedPlayInfoCodec {
    fun encode(info: SavedPlayInfo): String =
        buildJsonObject {
            put("time", info.timeSec)
            put("maxTime", info.maxTimeSec)
            put("listId", info.listId)
            put("index", info.index)
        }.toString()

    fun decode(raw: String?): SavedPlayInfo? {
        if (raw.isNullOrBlank()) return null
        val obj = runCatching { Json.parseToJsonElement(raw) }.getOrNull() as? JsonObject ?: return null
        val time = obj.floatOrNull("time") ?: return null
        val maxTime = obj.floatOrNull("maxTime") ?: return null
        val listId = (obj["listId"] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content ?: return null
        val index = (obj["index"] as? JsonPrimitive)?.content?.toIntOrNull() ?: return null
        if (listId.isEmpty() || index < 0) return null
        return SavedPlayInfo(time, maxTime, listId, index)
    }

    private fun JsonObject.floatOrNull(key: String): Float? =
        (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content?.toFloatOrNull()
}

/**
 * 播放进度记忆 —— RN 两处保存点的判定逻辑：
 *
 * - `playProgress.ts#delaySavePlayInfo`（2 秒节流）：只在**播放中** + `player.isSavePlayTime`
 *   + 非临时曲 + 亮屏时保存；RN 的节流器是 leading+trailing 的后台定时器，这里退化为
 *   「距上次保存不足 2 秒就跳过」（差在最后一次进度可能晚最多 2 秒落盘）。
 * - `playProgress.ts#handleSetPlayInfo`（`musicToggled`）：非临时曲**无条件**保存；
 *   此刻 `setPlayMusicInfo` 已把进度归零，所以写进去的是「新曲 + 0 秒」，只用来记住
 *   上次选的是哪首（RN 同）。
 *
 * 恢复门（`isSavePlayTime` 决定时间是否还原、`maxTime` 总是还原）由调用方按
 * [SavedPlayInfo] 组装，见 `PlayerRuntime`。
 */
class PlayProgressMemory(
    private val storage: SavedPlayInfoStorage,
    private val isSavePlayTime: () -> Boolean,
    private val isScreenOn: () -> Boolean = { true },
    private val currentTimeMs: () -> Long = { System.currentTimeMillis() },
    private val throttleMs: Long = 2000L,
) {
    private var lastSaveMs: Long? = null

    /**
     * 按 RN 规则尝试保存当前进度。
     *
     * @param force `musicToggled` 路径：跳过播放态/开关/节流判定（临时曲仍然跳过）。
     * @return 真正写入的条目；被跳过时返回 null。
     */
    suspend fun saveProgress(
        state: PlayerState,
        force: Boolean = false,
    ): SavedPlayInfo? {
        val snapshot = snapshot(state) ?: return null
        if (!force) {
            if (!state.isPlay || !isSavePlayTime() || !isScreenOn()) return null
            val now = currentTimeMs()
            val last = lastSaveMs
            if (last != null && now - last < throttleMs) return null
            lastSaveMs = now
        }
        storage.save(snapshot)
        return snapshot
    }

    /** 启动恢复候选：`listId` 为空或 `index < 0` 直接作废（RN playInfo.ts:10）。 */
    suspend fun load(): SavedPlayInfo? = storage.load()?.takeIf { it.listId.isNotEmpty() && it.index >= 0 }

    private fun snapshot(state: PlayerState): SavedPlayInfo? {
        val playInfo = state.playMusicInfo
        if (playInfo.musicInfo == null || playInfo.isTempPlay) return null
        val listId = playInfo.listId ?: return null
        return SavedPlayInfo(
            timeSec = state.progress.nowPlayTimeSec,
            maxTimeSec = state.progress.maxPlayTimeSec,
            listId = listId,
            index = state.playerPlayIndex,
        )
    }
}
