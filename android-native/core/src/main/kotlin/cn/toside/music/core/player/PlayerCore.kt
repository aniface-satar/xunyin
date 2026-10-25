package cn.toside.music.core.player

import kotlinx.serialization.json.JsonObject

/**
 * 播放器平台抽象 —— Media3 ExoPlayer 由 B2 的 app/android 层实现，
 * `:core` 只面向此接口编程（切歌决策、随机队列、进度状态全部可 JVM 单测）。
 */
interface PlayerPlatform {
    /** 装载资源（RN setResource）。 */
    suspend fun setResource(
        musicId: String,
        url: String,
        startPositionMs: Long,
    )

    /** 播放/暂停/停止。 */
    suspend fun play()

    suspend fun pause()

    suspend fun stop()

    /** 音量（0..1）与倍率。 */
    suspend fun setVolume(volume: Float)

    suspend fun setRate(rate: Float)

    /** seek（秒）。 */
    suspend fun seekTo(positionSec: Float)

    /** 是否已初始化（RN isInitialized）。 */
    suspend fun isInitialized(): Boolean

    /** 用启动参数初始化（RN playerInitial）。 */
    suspend fun initialize(
        volume: Float,
        playRate: Float,
        cacheSizeMiB: Int,
        isHandleAudioFocus: Boolean,
        isEnableAudioOffload: Boolean,
    )

    /** 播放器内是否有内容（RN isEmpty）。 */
    suspend fun isEmpty(): Boolean

    /** 当前播放位置（毫秒，RN getPosition）。 */
    suspend fun positionMs(): Long

    /** 当前曲目时长（毫秒，RN getDuration）；未知长度返回 0。 */
    suspend fun durationMs(): Long
}

/**
 * 播放音乐信息（对应 LX.Player.PlayMusicInfo）。
 * B1 的 JsonElement 动态模型延续：musicInfo 保持 JsonObject。
 */
data class PlayMusicInfo(
    val listId: String?,
    val musicInfo: JsonObject?,
    val isTempPlay: Boolean = false,
)

/** 播放进度快照（对应 player state 的 progress）。 */
data class PlayProgress(
    val nowPlayTimeSec: Float = 0f,
    val maxPlayTimeSec: Float = 0f,
) {
    val progress: Float get() = if (maxPlayTimeSec > 0) nowPlayTimeSec / maxPlayTimeSec else 0f
}

/** 播放状态（对应 RN player state 的相关字段集合）。 */
data class PlayerState(
    val playMusicInfo: PlayMusicInfo = PlayMusicInfo(null, null),
    val playerListId: String? = null,
    val playerPlayIndex: Int = -1,
    val isPlay: Boolean = false,
    val volume: Float = 1f,
    val playRate: Float = 1f,
    val playMethod: TogglePlayMethod = TogglePlayMethod.LIST_LOOP,
    val statusText: String = "",
    val playedList: List<PlayMusicInfo> = emptyList(),
    val tempPlayList: List<PlayMusicInfo> = emptyList(),
    val randomList: RandomList? = null,
    val progress: PlayProgress = PlayProgress(),
)

/** 随机播放队列（对应 RN RandomList）。 */
data class RandomList(
    val listId: String,
    val musicIds: List<String>,
)

/** 不喜欢列表信息（对应 LX.Dislike.DislikeInfo，B2 只需名称集合）。 */
data class DislikeInfo(
    val names: Set<String> = emptySet(),
    val musicNames: Set<String> = emptySet(),
    val singerNames: Set<String> = emptySet(),
) {
    companion object {
        const val SPLIT_CHAR = "@"
        const val SPLIT_CHAR_ALIAS = "#"
    }
}

/** 切歌模式（对应 player.togglePlayMethod）。 */
enum class TogglePlayMethod {
    LIST_LOOP,
    RANDOM,
    LIST,
    SINGLE_LOOP,
    NONE,
    ;

    companion object {
        /** 播放页播放模式按钮的轮转顺序（RN MUSIC_TOGGLE_MODE_LIST）。 */
        val CYCLE =
            listOf(LIST_LOOP, RANDOM, LIST, SINGLE_LOOP, NONE)

        fun fromSetting(value: String): TogglePlayMethod =
            when (value) {
                "listLoop" -> LIST_LOOP
                "random" -> RANDOM
                "list" -> LIST
                "singleLoop" -> SINGLE_LOOP
                else -> NONE
            }

        fun next(current: TogglePlayMethod): TogglePlayMethod {
            val index = CYCLE.indexOf(current)
            return CYCLE[(index + 1) % CYCLE.size]
        }
    }
}

/**
 * 播放核心 —— RN 侧 src/core/player（player.ts + utils.ts + randomList.ts +
 * prevHistory.ts）的切歌决策移植。
 *
 * 范围：播放状态、切歌编排（playNext/playPrev/playListById/togglePlay）、
 * 随机队列、已播放历史、稍后播放队列、不喜欢过滤。
 * 取链（getMusicUrl）、封面/歌词加载、Media3 平台由注入的
 * [PlayerPlatform] 与 [MusicUrlProvider] 承担。
 */
class PlayerCore(
    private val platform: PlayerPlatform,
    private val listProvider: suspend (String) -> List<JsonObject>,
    private val urlProvider: MusicUrlProvider,
    private val randomSource: () -> Int = { kotlin.random.Random.nextInt() },
) {
    /** 取链抽象（B2 先用占位实现；B3 QuickJS 桥接入后由音源系统提供）。 */
    fun interface MusicUrlProvider {
        suspend fun getUrl(musicInfo: JsonObject): String?
    }

    private val _state = kotlinx.coroutines.flow.MutableStateFlow(PlayerState())

    /** 播放状态流（UI 观察）。 */
    val state: kotlinx.coroutines.flow.StateFlow<PlayerState> = _state

    /** 切歌模式与设置读取（由设置层注入读取器）。 */
    var togglePlayMethodProvider: () -> TogglePlayMethod = { TogglePlayMethod.LIST_LOOP }

    /** 不喜欢列表读取器。 */
    var dislikeInfoProvider: () -> DislikeInfo = { DislikeInfo() }

    /** 状态文案回调（对应 setStatusText 的事件）。 */
    var onStatusText: (suspend (String) -> Unit)? = null

    /** 播放失败回调（对应 app_event.error）。 */
    var onPlayError: (suspend (JsonObject) -> Unit)? = null

    /** 取链失败回调（RN setMusicUrl 的 catch：报错后由编排层延时跳下一首）。 */
    var onLoadFailed: (suspend (JsonObject) -> Unit)? = null

    /** 是否自动清理已播放列表（player.isAutoCleanPlayedList 设置读取器）。 */
    var isAutoCleanPlayedListProvider: () -> Boolean = { false }

    /**
     * RN `global.lx.isPlayedStop`：定时停止到点后「等这首歌放完」的全局标志。
     *
     * 到点由 [SleepTimer] 置位（经 app 层转发），以下位置消费同一份事实：
     * - 自动下一首（[playNext] 的 `isAutoToggle` 分支）直接忽略；
     * - 手动切歌 [playNext] / [togglePlay] / [handlePlay] 清除标志（RN `&&= false`）；
     * - 取链完成后若标志已立起则不再装载（RN getMusicPlayUrl 的 then 守卫）。
     */
    var isPlayedStop: Boolean = false
        private set

    fun setPlayedStop(value: Boolean) {
        isPlayedStop = value
    }

    private fun shouldClearPlayedList(
        prevListId: String?,
        listId: String,
    ): Boolean = isAutoCleanPlayedListProvider() || prevListId != listId

    private suspend fun update(transform: (PlayerState) -> PlayerState) {
        _state.value = transform(_state.value)
    }

    // ---------- 状态操作（对照 store/player/action.ts） ----------

    suspend fun setPlayMusicInfo(
        listId: String?,
        musicInfo: JsonObject?,
        isTempPlay: Boolean = false,
    ) {
        // RN setPlayMusicInfo：先更新状态，再按 getPlayIndex 语义计算 playerPlayIndex
        val playerList = _state.value.playerListId?.let { listProvider(it) } ?: emptyList()
        var playerPlayIndex = if (playerList.isNotEmpty()) minOf(_state.value.playerPlayIndex, playerList.size - 1) else -1
        if (musicInfo != null) {
            val list = listId?.let { listProvider(it) } ?: emptyList()
            if (list.isNotEmpty()) {
                val playIndex = list.indexOfFirst { it.idKey() == musicInfo.idKey() }
                if (!isTempPlay) {
                    playerPlayIndex =
                        if (playIndex < 0) {
                            if (playerPlayIndex < 1) list.size - 1 else playerPlayIndex - 1
                        } else {
                            playIndex
                        }
                }
            }
        }
        // RN playInfo.ts:121：换曲那一刻进度归零，旧曲的 nowPlayTime 不跟到新曲。
        // 进度记忆的「换曲即保存」依赖这一点（落盘的必须是新曲 + 0 秒）。
        update {
            it.copy(
                playMusicInfo = PlayMusicInfo(listId, musicInfo, isTempPlay),
                playerPlayIndex = playerPlayIndex,
                progress = PlayProgress(),
            )
        }
    }

    suspend fun setPlayerListId(listId: String?) = update { it.copy(playerListId = listId) }

    suspend fun setIsPlay(isPlay: Boolean) = update { it.copy(isPlay = isPlay) }

    /**
     * 切换播放模式（播放页模式按钮）。设置层接入后由调用方把
     * [togglePlayMethodProvider] 指到 [PlayerState.playMethod]，保证决策与 UI 同源。
     */
    suspend fun setPlayMethod(method: TogglePlayMethod) = update { it.copy(playMethod = method) }

    suspend fun toggleNextPlayMethod(): TogglePlayMethod {
        val next = TogglePlayMethod.next(_state.value.playMethod)
        setPlayMethod(next)
        return next
    }

    suspend fun setProgress(
        nowSec: Float,
        maxSec: Float,
    ) = update { it.copy(progress = PlayProgress(nowSec, maxSec)) }

    /**
     * 读播放器实际进度写回状态（RN playProgress.ts 的 getCurrentTime + getMaxTime）。
     * 每秒轮询的时机与屏息停更由调用方（app 层 ticker）决定，这里只做一次取值。
     */
    suspend fun syncProgress() {
        val positionSec = platform.positionMs().coerceAtLeast(0L) / 1000f
        val durationSec = platform.durationMs().coerceAtLeast(0L) / 1000f
        setProgress(positionSec, durationSec)
    }

    suspend fun addPlayedList(info: PlayMusicInfo) {
        update { s ->
            if (s.playedList.any { it.musicInfo?.idKey() == info.musicInfo?.idKey() }) {
                s
            } else {
                s.copy(playedList = s.playedList + info)
            }
        }
    }

    suspend fun removePlayedList(index: Int) =
        update { s ->
            if (index in s.playedList.indices) s.copy(playedList = s.playedList.filterIndexed { i, _ -> i != index }) else s
        }

    suspend fun clearPlayedList() = update { it.copy(playedList = emptyList()) }

    suspend fun addTempPlayList(list: List<Triple<String?, JsonObject?, Boolean>>) {
        // Triple: (listId, musicInfo, isTop)
        update { s ->
            val top = list.filter { it.third }.map { PlayMusicInfo(it.first, it.second, isTempPlay = true) }
            val bottom = list.filter { !it.third }.map { PlayMusicInfo(it.first, it.second, isTempPlay = true) }
            s.copy(tempPlayList = top + s.tempPlayList + bottom)
        }
    }

    suspend fun removeTempPlayList(index: Int) =
        update { s ->
            if (index in s.tempPlayList.indices) s.copy(tempPlayList = s.tempPlayList.filterIndexed { i, _ -> i != index }) else s
        }

    suspend fun clearTempPlayList() = update { it.copy(tempPlayList = emptyList()) }

    // ---------- 播放编排（对照 player.ts） ----------

    /** 播放列表内歌曲（playListById）。 */
    suspend fun playListById(
        listId: String,
        musicId: String,
    ) {
        val prevListId = _state.value.playerListId
        val list = listProvider(listId)
        val target = list.firstOrNull { it.idKey() == musicId } ?: return
        setPlayerListId(listId)
        setPlayMusicInfo(listId, target)
        clearTempPlayList()
        if (shouldClearPlayedList(prevListId, listId)) clearPlayedList()
        handlePlay()
    }

    /** 播放/暂停切换（togglePlay）。 */
    suspend fun togglePlay() {
        // RN togglePlay：global.lx.isPlayedStop &&= false
        isPlayedStop = false
        if (_state.value.isPlay) pause() else play()
    }

    /**
     * 启动恢复上次播放（RN `playInfo.ts` + `player.ts#handleRestorePlay`）：
     * 校验列表与索引后装载该曲，**不自动播放**；`timeSec/maxTimeSec` 由调用方按
     * `player.isSavePlayTime` 决定（关闭时传 0，`maxTime` 总是还原）。
     *
     * @return 索引无效或取链失败时返回 false（调用方据此决定是否回退到普通播放）。
     */
    suspend fun restorePlayList(
        listId: String,
        index: Int,
        timeSec: Float,
        maxTimeSec: Float,
    ): Boolean {
        val list = listProvider(listId)
        val target = list.getOrNull(index) ?: return false
        val prevListId = _state.value.playerListId
        setPlayerListId(listId)
        setPlayMusicInfo(listId, target)
        clearTempPlayList()
        if (shouldClearPlayedList(prevListId, listId)) clearPlayedList()
        setProgress(timeSec, maxTimeSec)
        if (!_state.value.playMusicInfo.isTempPlay) syncRandomList()
        return loadAndPlay(target, timeSec, autoPlay = false)
    }

    /** 恢复播放（play）。 */
    suspend fun play() {
        val current = _state.value.playMusicInfo.musicInfo ?: return
        if (platform.isEmpty()) {
            loadAndPlay(current, _state.value.progress.nowPlayTimeSec)
            return
        }
        platform.play()
    }

    suspend fun pause() = platform.pause()

    /** 音量（0..1），同步到平台并写回状态（RN playerVolume 设置项）。 */
    suspend fun setVolume(volume: Float) {
        platform.setVolume(volume)
        update { it.copy(volume = volume) }
    }

    /** 播放倍率，同步到平台并写回状态（进度轮询间隔按它缩放）。 */
    suspend fun setRate(rate: Float) {
        platform.setRate(rate)
        update { it.copy(playRate = rate) }
    }

    /**
     * 重新取链并装载当前曲（RN `setMusicUrl(musicInfo, true)` 的刷新分支）。
     * 播放出错时由编排层调用；进度保持（RN 先 getPosition 写回 nowPlayTime 再刷新）。
     */
    suspend fun reloadCurrent() {
        val musicInfo = _state.value.playMusicInfo.musicInfo ?: return
        loadAndPlay(musicInfo, _state.value.progress.nowPlayTimeSec)
    }

    /** 仅停播放器、保留当前曲信息（RN 播放错误分支的 setStop）。 */
    suspend fun stopPlayback() {
        platform.stop()
        setIsPlay(false)
    }

    /**
     * 跳转（通知栏 / 歌词点按 / 进度条拖动）；RN setProgress(time) 同语义：
     * 立刻把 nowPlayTime 写回状态，maxPlayTime 保持不变。
     */
    suspend fun seekTo(positionMs: Long) {
        val positionSec = positionMs.coerceAtLeast(0L) / 1000f
        platform.seekTo(positionSec)
        update { it.copy(progress = PlayProgress(positionSec, it.progress.maxPlayTimeSec)) }
    }

    /** 下一曲（playNext）。 */
    suspend fun playNext(isAutoToggle: Boolean = false) {
        // RN player.ts:53 / playerEvent.ts addDelayNextTimeout：等定时退出时不允许自动续播
        if (isAutoToggle && isPlayedStop) return
        val s = _state.value
        if (s.tempPlayList.isNotEmpty()) {
            val next = s.tempPlayList.first()
            removeTempPlayList(0)
            handlePlayNext(next)
            return
        }
        val playMusicInfo = s.playMusicInfo
        val musicInfo = playMusicInfo.musicInfo ?: return handleToggleStop()
        val currentListId = s.playerListId ?: return handleToggleStop()
        val currentList = listProvider(currentListId)

        if (!playMusicInfo.isTempPlay && togglePlayMethodProvider() == TogglePlayMethod.RANDOM) {
            getRandomQueueNext()?.let {
                handlePlayNext(it)
                return
            }
        }

        val playedList = s.playedList
        if (playedList.isNotEmpty()) {
            val currentId = resolveCurrentId(playMusicInfo, currentList, s.playerPlayIndex)
            // 从已播放列表移除原列表已删除的歌曲
            var index = playedList.indexOfFirst { it.musicInfo?.idKey() == currentId }
            index++
            while (index < playedList.size) {
                val pm = playedList[index]
                val pmId = pm.musicInfo?.idKey()
                if (pm.listId == currentListId && pmId != null && !currentList.any { it.idKey() == pmId }) {
                    removePlayedList(index)
                    continue
                }
                break
            }
            if (index in playedList.indices) {
                // 重新读取（removePlayedList 已更新 state）
                val updated = _state.value.playedList
                if (index < updated.size) {
                    handlePlayNext(updated[index])
                    return
                }
            }
        }

        val filter = filterList(playedList, currentListId, currentList, currentList.getOrNull(s.playerPlayIndex), isNext = true)
        if (filter.first.isEmpty()) return handleToggleStop()
        var playerIndex = filter.second
        if (playerIndex == -1) playerIndex = 0

        var method = togglePlayMethodProvider()
        if (!isAutoToggle && method in listOf(TogglePlayMethod.LIST, TogglePlayMethod.SINGLE_LOOP, TogglePlayMethod.NONE)) {
            method = TogglePlayMethod.LIST_LOOP
        }
        val nextIndex =
            when (method) {
                TogglePlayMethod.LIST_LOOP -> if (playerIndex == filter.first.size - 1) 0 else playerIndex + 1
                TogglePlayMethod.RANDOM -> randomSource().mod(filter.first.size)
                TogglePlayMethod.LIST -> if (playerIndex == filter.first.size - 1) -1 else playerIndex + 1
                TogglePlayMethod.SINGLE_LOOP -> playerIndex
                TogglePlayMethod.NONE -> -1
            }
        if (nextIndex < 0) return

        handlePlayNext(PlayMusicInfo(currentListId, filter.first[nextIndex], false))
    }

    /** 上一曲（playPrev）。 */
    suspend fun playPrev(isAutoToggle: Boolean = false) {
        val s = _state.value
        val playMusicInfo = s.playMusicInfo
        if (playMusicInfo.musicInfo == null) return handleToggleStop()
        val currentListId = s.playerListId
        if (currentListId == null && s.playedList.isEmpty()) return handleToggleStop()
        val currentList = currentListId?.let { listProvider(it) } ?: emptyList()

        if (!playMusicInfo.isTempPlay && togglePlayMethodProvider() == TogglePlayMethod.RANDOM) {
            getRandomQueuePrev()?.let {
                handlePlayNext(it)
                return
            }
        }

        val playedList = s.playedList
        if (playedList.isNotEmpty()) {
            val listMusicInfo = currentList.getOrNull(s.playerPlayIndex)
            val anchor = resolvePrevAnchor(playMusicInfo, playedList, listMusicInfo?.idKey())
            var index = playedList.indexOfFirst { it.musicInfo?.idKey() == anchor.first } - 1
            while (index > -1) {
                val pm = playedList[index]
                val pmId = pm.musicInfo?.idKey()
                val stale = pm.listId == currentListId && !pm.isTempPlay && pmId != null && !currentList.any { it.idKey() == pmId }
                if (stale) {
                    removePlayedList(index)
                    index--
                    continue
                }
                break
            }
            if (index > -1) {
                if (anchor.second) {
                    // 临时曲后退时放回稍后播放队首（RN 行为）
                    addTempPlayList(listOf(Triple(playMusicInfo.listId, playMusicInfo.musicInfo, true)))
                }
                handlePlayNext(playedList[index])
                return
            }
        }
        if (currentListId == null) return handleToggleStop()

        val filter = filterList(playedList, currentListId, currentList, currentList.getOrNull(s.playerPlayIndex), isNext = false)
        if (filter.first.isEmpty()) return handleToggleStop()
        var playerIndex = filter.second
        if (playerIndex == -1) playerIndex = 0
        var nextIndex = playerIndex
        if (!playMusicInfo.isTempPlay) {
            var method = togglePlayMethodProvider()
            if (!isAutoToggle && method in listOf(TogglePlayMethod.LIST, TogglePlayMethod.SINGLE_LOOP, TogglePlayMethod.NONE)) {
                method = TogglePlayMethod.LIST_LOOP
            }
            nextIndex =
                when (method) {
                    TogglePlayMethod.RANDOM -> randomSource().mod(filter.first.size)
                    TogglePlayMethod.LIST_LOOP, TogglePlayMethod.LIST ->
                        if (playerIndex == 0) filter.first.size - 1 else playerIndex - 1
                    TogglePlayMethod.SINGLE_LOOP -> playerIndex
                    TogglePlayMethod.NONE -> -1
                }
            if (nextIndex < 0) return
        }

        handlePlayNext(PlayMusicInfo(currentListId, filter.first[nextIndex], false))
    }

    // ---------- 内部 ----------

    private fun resolveCurrentId(
        playMusicInfo: PlayMusicInfo,
        currentList: List<JsonObject>,
        playerPlayIndex: Int,
    ): String? =
        if (playMusicInfo.isTempPlay) {
            currentList.getOrNull(playerPlayIndex)?.idKey()
        } else {
            playMusicInfo.musicInfo?.idKey()
        }

    private suspend fun handlePlayNext(playMusicInfo: PlayMusicInfo) {
        setPlayMusicInfo(playMusicInfo.listId, playMusicInfo.musicInfo, playMusicInfo.isTempPlay)
        handlePlay()
    }

    private suspend fun handleToggleStop() {
        platform.stop()
        setPlayMusicInfo(null, null)
    }

    /** handlePlay：取链 → setResource（RN 走 debounce + 事件，这里同步编排）。
     *  注意：与 RN 一致，普通播放不把当前曲写入 playedList（playedList 仅个性电台
     *  临时曲经 musicToggled 事件写入，见 radio.ts:151）。 */
    private suspend fun handlePlay() {
        // RN handlePlay：global.lx.isPlayedStop &&= false（手动播新曲即撤掉等待退出）
        isPlayedStop = false
        val playMusicInfo = _state.value.playMusicInfo
        val musicInfo = playMusicInfo.musicInfo ?: return

        if (!playMusicInfo.isTempPlay) syncRandomList()

        platform.stop()
        loadAndPlay(musicInfo, 0f)
    }

    private suspend fun loadAndPlay(
        musicInfo: JsonObject,
        startPositionSec: Float,
        autoPlay: Boolean = true,
    ): Boolean {
        val url = runCatching { urlProvider.getUrl(musicInfo) }.getOrNull()
        if (url == null) {
            onStatusText?.invoke("取链失败")
            onPlayError?.invoke(musicInfo)
            onLoadFailed?.invoke(musicInfo)
            return false
        }
        // RN getMusicPlayUrl 的 then 守卫：取链期间定时退出已到点，就不再装载
        if (isPlayedStop) return false
        platform.setResource(musicInfo.idKey() ?: "", url, (startPositionSec * 1000).toLong())
        // 启动恢复（RN playList.ts:185-190）：装载后暂停，等用户自己按播放
        if (autoPlay) platform.play() else platform.pause()
        return true
    }

    /**
     * 过滤（对照 utils.ts filterList）：排除不喜欢歌曲（当前曲豁免标记）、
     * 排除已播放；全部过滤完时回退 canPlayList（对应 clearPlayedList 分支）。
     * 返回 (filteredList, playerIndex)。
     */
    internal fun filterList(
        playedList: List<PlayMusicInfo>,
        listId: String,
        list: List<JsonObject>,
        playerMusicInfo: JsonObject?,
        isNext: Boolean,
    ): Pair<List<JsonObject>, Int> {
        val dislike = dislikeInfoProvider()
        val filteredPlayedList =
            playedList
                .filter { it.listId == listId && !it.isTempPlay }
                .mapNotNull { it.musicInfo?.idKey() }
                .toMutableList()
        var isDislikeCurrent = false

        val canPlayList = mutableListOf<JsonObject>()
        val filteredList = mutableListOf<JsonObject>()
        for (s in list) {
            val key = dislike.key(s)
            if (dislike.contains(key)) {
                if (playerMusicInfo != null && s.idKey() != playerMusicInfo.idKey()) continue
                isDislikeCurrent = true
            }
            canPlayList.add(s)
            val index = filteredPlayedList.indexOf(s.idKey())
            if (index > -1) {
                filteredPlayedList.removeAt(index)
                continue
            }
            filteredList.add(s)
        }

        var playerIndex = -1
        if (playerMusicInfo != null) {
            if (isDislikeCurrent) {
                if (filteredList.size <= 1) {
                    if (filteredList.isNotEmpty()) filteredList.removeAt(0)
                    if (canPlayList.size > 1) {
                        val currentMusicIndex = canPlayList.indexOfFirst { it.idKey() == playerMusicInfo.idKey() }
                        if (currentMusicIndex >= 0) {
                            playerIndex =
                                if (isNext) {
                                    (currentMusicIndex - 1).let { if (it < 0 && canPlayList.size > 1) canPlayList.size - 2 else it }
                                } else {
                                    currentMusicIndex
                                }
                            canPlayList.removeAt(currentMusicIndex)
                        }
                    } else if (canPlayList.isNotEmpty()) {
                        canPlayList.removeAt(0)
                    }
                } else {
                    val currentMusicIndex = filteredList.indexOfFirst { it.idKey() == playerMusicInfo.idKey() }
                    if (currentMusicIndex >= 0) {
                        playerIndex =
                            if (isNext) {
                                (currentMusicIndex - 1).let { if (it < 0 && filteredList.size > 1) filteredList.size - 2 else it }
                            } else {
                                currentMusicIndex
                            }
                        filteredList.removeAt(currentMusicIndex)
                    }
                }
            } else {
                val base = if (filteredList.isNotEmpty()) filteredList else canPlayList
                playerIndex = base.indexOfFirst { it.idKey() == playerMusicInfo.idKey() }
            }
        }

        if (filteredList.isEmpty() && playedList.isNotEmpty()) {
            return canPlayList to playerIndex
        }
        return filteredList to playerIndex
    }

    // ---------- 随机队列（对照 randomList.ts） ----------

    /** 当前在播放列表内生效的歌曲 id。 */
    private suspend fun getCurrentListMusicId(): String? {
        val s = _state.value
        val listId = s.playerListId ?: return null
        if (s.playMusicInfo.isTempPlay) {
            return listProvider(listId).getOrNull(s.playerPlayIndex)?.idKey()
        }
        return s.playMusicInfo.musicInfo?.idKey()
    }

    /** 以 currentId 为首重新生成随机队列。 */
    private suspend fun generateRandomList(currentId: String?): Boolean {
        val s = _state.value
        val listId =
            s.playerListId ?: run {
                setRandomList(null)
                return false
            }
        val list = listProvider(listId)
        if (list.isEmpty()) {
            setRandomList(null)
            return false
        }
        val dislike = dislikeInfoProvider()
        val playable = list.filter { !dislike.contains(dislike.key(it)) }.mapNotNull { it.idKey() }.filter { it != currentId }
        val musicIds = shuffle(playable)
        if (currentId != null) (musicIds as MutableList).add(0, currentId)
        setRandomList(RandomList(listId, musicIds))
        return true
    }

    /** 同步随机队列（切歌单/换模式时）。 */
    suspend fun syncRandomList() {
        if (togglePlayMethodProvider() != TogglePlayMethod.RANDOM) {
            if (_state.value.randomList != null) setRandomList(null)
            return
        }
        val listId = _state.value.playerListId
        val list = listId?.let { listProvider(it) } ?: emptyList()
        if (listId == null || list.isEmpty()) {
            if (_state.value.randomList != null) setRandomList(null)
            return
        }
        val currentId = getCurrentListMusicId()
        val randomList = _state.value.randomList
        if (randomList?.listId == listId && currentId != null && randomList.musicIds.contains(currentId)) return
        generateRandomList(currentId)
    }

    /** 随机队列取下一曲（整轮放完自动重新洗牌）。 */
    internal suspend fun getRandomQueueNext(): PlayMusicInfo? {
        val s = _state.value
        val randomList = s.randomList
        val listId = s.playerListId
        if (randomList == null || listId == null || randomList.listId != listId) return null
        val list = listProvider(listId)
        if (list.isEmpty()) return null

        val currentId = getCurrentListMusicId()
        var musicIds = randomList.musicIds
        var currentIndex = currentId?.let { musicIds.indexOf(it) } ?: -1
        if (currentIndex == -1 || currentIndex >= musicIds.size - 1) {
            if (!generateRandomList(currentId)) return null
            musicIds = _state.value.randomList?.musicIds ?: return null
            currentIndex = 0
        }
        for (i in currentIndex + 1 until musicIds.size) {
            val musicInfo = findPlayable(list, musicIds[i]) ?: continue
            return PlayMusicInfo(listId, musicInfo, false)
        }
        return null
    }

    /** 随机队列取上一曲（队首回绕到队尾）。 */
    internal suspend fun getRandomQueuePrev(): PlayMusicInfo? {
        val s = _state.value
        val randomList = s.randomList
        val listId = s.playerListId
        if (randomList == null || listId == null || randomList.listId != listId) return null
        val list = listProvider(listId)
        if (list.isEmpty()) return null

        val currentId = getCurrentListMusicId()
        val musicIds = randomList.musicIds
        val currentIndex = currentId?.let { musicIds.indexOf(it) } ?: -1
        if (currentIndex == -1) return null
        for (i in currentIndex - 1 downTo 0) {
            val musicInfo = findPlayable(list, musicIds[i]) ?: continue
            return PlayMusicInfo(listId, musicInfo, false)
        }
        for (i in musicIds.size - 1 downTo currentIndex + 1) {
            val musicInfo = findPlayable(list, musicIds[i]) ?: continue
            return PlayMusicInfo(listId, musicInfo, false)
        }
        return null
    }

    /** 列表歌曲增删后同步队列。 */
    suspend fun handleListMusicsUpdated(listIds: List<String>) {
        val randomList = _state.value.randomList ?: return
        if (!listIds.contains(randomList.listId)) return
        val list = listProvider(randomList.listId)
        val idSet = list.mapNotNull { it.idKey() }.toHashSet()
        val dislike = dislikeInfoProvider()
        val musicIds = randomList.musicIds.filter { idSet.contains(it) }.toMutableList()
        val existIds = musicIds.toHashSet()
        val newIds = shuffle(list.filter { !existIds.contains(it.idKey()) && !dislike.contains(dislike.key(it)) }.mapNotNull { it.idKey() })
        if (newIds.isEmpty() && musicIds.size == randomList.musicIds.size) return
        val currentId = getCurrentListMusicId()
        val currentIndex = currentId?.let { musicIds.indexOf(it) } ?: -1
        for (id in newIds) {
            musicIds.add(randomInt(currentIndex + 1, musicIds.size + 1), id)
        }
        setRandomList(RandomList(randomList.listId, musicIds))
    }

    private fun findPlayable(
        list: List<JsonObject>,
        id: String,
    ): JsonObject? {
        val musicInfo = list.firstOrNull { it.idKey() == id } ?: return null
        val dislike = dislikeInfoProvider()
        if (dislike.contains(dislike.key(musicInfo))) return null
        return musicInfo
    }

    private suspend fun setRandomList(randomList: RandomList?) = update { it.copy(randomList = randomList) }

    private fun shuffle(list: List<String>): MutableList<String> {
        val result = list.toMutableList()
        for (i in result.size - 1 downTo 1) {
            val j = randomInt(0, i + 1)
            val tmp = result[i]
            result[i] = result[j]
            result[j] = tmp
        }
        return result
    }

    private fun randomInt(
        min: Int,
        max: Int,
    ): Int {
        if (max <= min) return min
        val r = randomSource()
        return ((r.toLong() - Int.MIN_VALUE.toLong()) % (max - min)).toInt() + min
    }

    private fun DislikeInfo.key(musicInfo: JsonObject): Triple<String, String, String> {
        fun norm(s: String?): String =
            (s ?: "")
                .replace(DislikeInfo.SPLIT_CHAR, DislikeInfo.SPLIT_CHAR_ALIAS)
                .lowercase()
                .trim()
        val name = norm(musicInfo.nameField())
        val singer = norm(musicInfo.singerField())
        return Triple(name, singer, "${name}${DislikeInfo.SPLIT_CHAR}$singer")
    }

    private fun DislikeInfo.contains(key: Triple<String, String, String>): Boolean =
        musicNames.contains(key.first) || singerNames.contains(key.second) || names.contains(key.third)

    internal fun resolvePrevAnchor(
        currentPlayInfo: PlayMusicInfo,
        playedList: List<PlayMusicInfo>,
        listMusicId: String?,
    ): Pair<String?, Boolean> {
        if (!currentPlayInfo.isTempPlay) return currentPlayInfo.musicInfo?.idKey() to false
        val tempId = currentPlayInfo.musicInfo?.idKey() ?: return listMusicId to false
        if (playedList.any { it.isTempPlay && it.musicInfo?.idKey() == tempId }) return tempId to true
        return listMusicId to false
    }
}

/** JsonObject 便捷取字段。 */
internal fun JsonObject.idKey(): String? = stringFieldOr("id")

internal fun JsonObject.nameField(): String? = stringFieldOr("name")

internal fun JsonObject.singerField(): String? = stringFieldOr("singer")

internal fun JsonObject.stringFieldOr(key: String): String? =
    (this[key] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it !is kotlinx.serialization.json.JsonNull }?.content
