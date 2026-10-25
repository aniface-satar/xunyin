package cn.toside.music.nativeapp.player

import android.content.Context
import android.os.PowerManager
import android.util.Log
import androidx.media3.common.util.UnstableApi
import cn.toside.music.core.lyric.LyricParser
import cn.toside.music.core.lyric.ParsedLyric
import cn.toside.music.core.player.CorePlaybackCommands
import cn.toside.music.core.player.PlayProgressMemory
import cn.toside.music.core.player.PlaybackCoordinator
import cn.toside.music.core.player.PlayerCore
import cn.toside.music.core.player.TogglePlayMethod
import cn.toside.music.nativeapp.data.ListRuntime
import cn.toside.music.nativeapp.data.SettingsRuntime
import cn.toside.music.nativeapp.userapi.UserApiRuntime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * 播放运行时 —— 把四件独立可测件接成一个进程级单例：
 * [PlayerCore]（决策）+ [Media3PlayerPlatform]（播放/缓存）+ [PlaybackCoordinator]
 * （事件与进度轮询）+ [CorePlaybackCommands]（通知栏/耳机键）。
 *
 * UI（B4）与 [PlaybackService] 共用同一份实例：SimpleCache 同目录二开会撞
 * `SimpleCache.isCacheFolderLocked`，ExoPlayer 也不能有第二个。
 */
@UnstableApi
class PlayerRuntime private constructor(
    context: Context,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val appContext = context.applicationContext

    val platform = Media3PlayerPlatform(context.applicationContext)

    /** 音源运行时（B3 QuickJS 桥）：内置脚本加载、取链、歌词/封面。 */
    val userApi = UserApiRuntime(context.applicationContext)

    /** 列表数据（B5：歌单页与播放列表 sheet 共用）。 */
    val lists = ListRuntime.get(context.applicationContext)

    /** 设置运行时（B5 设置层）：音质/歌词开关/音量均衡共用一个事实来源。 */
    val settings = SettingsRuntime.get(context.applicationContext)

    /** 取链（走当前音源脚本；初始化失败时返回 null，由失败链路跳下一首）。 */
    var urlResolver: PlayerCore.MusicUrlProvider =
        PlayerCore.MusicUrlProvider { info -> userApi.getMusicUrl(info) { playQuality() } }

    /** 播放音质设置（设置页可改；默认值对齐 RN defaultSetting）。 */
    var playQuality: () -> String = { settings.store.string("player.playQuality") }

    /** 列表读取（B5：走原生 ListStore，与歌单页共用同一份缓存）。 */
    var listResolver: suspend (String) -> List<JsonObject> = { id -> lists.musics(id) }

    /** 歌词显示开关（设置页可改；默认值与 RN defaultSetting 一致）。 */
    var isShowLyricTranslation: () -> Boolean = { settings.store.bool("player.isShowLyricTranslation") }

    var isShowLyricRoma: () -> Boolean = { settings.store.bool("player.isShowLyricRoma") }

    private val _lyrics = MutableStateFlow(LyricsState())

    /** 当前曲歌词（B4 播放页订阅）。 */
    val lyrics: StateFlow<LyricsState> = _lyrics.asStateFlow()

    val core =
        PlayerCore(
            platform = platform,
            listProvider = { id -> listResolver(id) },
            urlProvider = PlayerCore.MusicUrlProvider { info -> urlResolver.getUrl(info) },
        )

    /** 进度记忆（三键之一 `player.isSavePlayTime` 的消费者，落盘见 [PlayInfoStore]）。 */
    private val progressMemory =
        PlayProgressMemory(
            storage = PlayInfoStore(appContext),
            isSavePlayTime = { settings.store.bool("player.isSavePlayTime") },
            isScreenOn = { isScreenOn() },
        )

    // ---------- 音量均衡（对照 core/init/player/volumeBalancer.ts） ----------
    // 声明必须在 init 之前：init 里启动的协程会立刻读到默认值

    private val volumeBalancer = VolumeBalancer()
    private var volumeBalancerUnsupported = false

    /** 设置读取（设置页可改）。默认关、中档，与 RN defaultSetting 一致。 */
    var isVolumeBalancerEnabled: () -> Boolean = { settings.store.bool("player.isEnableVolumeBalancer") }

    var volumeBalancerLevel: () -> Int = {
        SettingsRuntime.volumeBalancerLevelIndex(settings.store.string("player.volumeBalancerLevel"))
    }

    /** 设备不支持音效时的提示回调（RN toast(`setting_play_volume_balancer_failed`)）。 */
    var onVolumeBalancerFailed: (() -> Unit)? = null

    init {
        platform.commandHandler = CorePlaybackCommands(core, scope)
        core.togglePlayMethodProvider = { core.state.value.playMethod }
        PlaybackCoordinator(core, platform, scope).start()
        observeMetadata()
        observeSettings()
        observeProgressMemory()
        observePlayForVolumeBalancer()
        observeLyrics()
        wireUserApiUpdates()
    }

    // ---------- 设置（B5：音质/歌词/音量均衡） ----------

    private fun observeSettings() {
        scope.launch {
            // 设置就绪后再挂均衡：默认关时什么也不做，开时等音频 session 出现再应用
            settings.ensureLoaded()
            applyStartupSettings()
            if (isVolumeBalancerEnabled()) applyVolumeBalancer()
            restoreSavedPlayback()
        }
    }

    /**
     * 三键回读（RN handlePlay 里的 `playerInitial`）：音量/倍率随播放器初始化一次下发，
     * 缓存大小/音频焦点/音频卸载也走同一入口；音频卸载在音量均衡开启时强制关闭。
     */
    private suspend fun applyStartupSettings() {
        val startup = PlayerStartupSettings.fromSetting(settings.store.state.value)
        platform.initialize(
            volume = startup.volume,
            playRate = startup.playRate,
            cacheSizeMiB = startup.cacheSizeMiB,
            isHandleAudioFocus = startup.isHandleAudioFocus,
            isEnableAudioOffload = startup.isEnableAudioOffload,
        )
        core.setVolume(startup.volume)
        core.setRate(startup.playRate)
        Log.d(
            "PlayerRuntime",
            "startup volume=${startup.volume} rate=${startup.playRate} cache=${startup.cacheSizeMiB}MiB " +
                "focus=${startup.isHandleAudioFocus} offload=${startup.isEnableAudioOffload}",
        )
    }

    /**
     * 恢复上次播放（RN playInfo.ts）：列表/索引校验通过才恢复；`isSavePlayTime`
     * 关闭时只还原曲目与总时长、进度从 0 开始；是否自动开播由 `player.startupAutoPlay` 决定。
     */
    private suspend fun restoreSavedPlayback() {
        val saved = progressMemory.load() ?: return
        val list = runCatching { listResolver(saved.listId) }.getOrDefault(emptyList())
        if (list.getOrNull(saved.index) == null) return
        val timeSec = if (settings.store.bool("player.isSavePlayTime")) saved.timeSec else 0f
        if (!core.restorePlayList(saved.listId, saved.index, timeSec, saved.maxTimeSec)) return
        if (settings.store.bool("player.startupAutoPlay")) core.play()
    }

    /** 进度保存的两个触发点（RN `musicToggled` + `delaySavePlayInfo`）。 */
    private fun observeProgressMemory() {
        scope.launch {
            core.state
                .map { it.playMusicInfo }
                .distinctUntilChanged()
                .collect { info ->
                    // 换曲那一刻进度已被 PlayerCore 归零，落盘的是「新曲 + 0 秒」
                    if (info.musicInfo == null) return@collect
                    progressMemory.saveProgress(core.state.value, force = true)
                }
        }
        scope.launch {
            core.state
                .map { it.progress }
                .distinctUntilChanged()
                .collect {
                    // 开关/亮屏/临时曲/2 秒节流都在 PlayProgressMemory 内判定
                    progressMemory.saveProgress(core.state.value)
                }
        }
    }

    private fun isScreenOn(): Boolean = (appContext.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.isInteractive ?: true

    // ---------- 歌词（对照 RN player.ts 的 getLyricInfo + lyricUpdated） ----------

    private fun observeLyrics() {
        scope.launch {
            core.state
                .map {
                    it.playMusicInfo.musicInfo
                        ?.musicKey()
                        .orEmpty()
                }.distinctUntilChanged()
                .collect { key ->
                    val info = core.state.value.playMusicInfo.musicInfo
                    if (key.isEmpty() || info == null) {
                        _lyrics.value = LyricsState()
                        return@collect
                    }
                    _lyrics.value = LyricsState(musicId = key, loading = true)
                    val data =
                        try {
                            userApi.getLyric(info)
                        } catch (e: Exception) {
                            Log.d("PlayerLyric", "load failed: ${e.message}")
                            null
                        }
                    // 取歌词期间用户可能已切歌：旧曲结果直接丢弃
                    if (core.state.value.playMusicInfo.musicInfo
                            ?.musicKey() != key
                    ) {
                        return@collect
                    }
                    _lyrics.value =
                        if (data == null) {
                            LyricsState(musicId = key, failed = true)
                        } else {
                            buildLyricsState(key, data)
                        }
                }
        }
    }

    private fun buildLyricsState(
        key: String,
        data: JsonObject,
    ): LyricsState {
        val raw = data.text("lyric").orEmpty()
        val translation = data.text("tlyric").orEmpty()
        val roma = data.text("rlyric").orEmpty()
        return LyricsState(
            musicId = key,
            raw = raw,
            translation = translation,
            roma = roma,
            parsed = LyricParser.parse(raw, activeExtendedLyrics(translation, roma)),
        )
    }

    private fun activeExtendedLyrics(
        translation: String,
        roma: String,
    ): List<String> =
        buildList {
            if (isShowLyricTranslation() && translation.isNotBlank()) add(translation)
            if (isShowLyricRoma() && roma.isNotBlank()) add(roma)
        }

    /** 翻译/音译开关变化后重新解析（不用重新下载歌词）。 */
    fun refreshLyrics() {
        val current = _lyrics.value
        if (current.raw.isBlank()) return
        _lyrics.value =
            current.copy(parsed = LyricParser.parse(current.raw, activeExtendedLyrics(current.translation, current.roma)))
    }

    fun isLyricTranslationShown(): Boolean = isShowLyricTranslation()

    fun isLyricRomaShown(): Boolean = isShowLyricRoma()

    fun setLyricTranslation(show: Boolean) {
        isShowLyricTranslation = { show }
        refreshLyrics()
        scope.launch {
            settings.ensureLoaded()
            settings.store.set("player.isShowLyricTranslation", show)
        }
    }

    fun setLyricRoma(show: Boolean) {
        isShowLyricRoma = { show }
        refreshLyrics()
        scope.launch {
            settings.ensureLoaded()
            settings.store.set("player.isShowLyricRoma", show)
        }
    }

    /** 播放页进度条与歌词共用的实时位置；取不到时退回最近一次轮询值。 */
    suspend fun positionMs(): Long = runCatching { platform.positionMs() }.getOrDefault(0L)

    /** 当前播放列表（B5 提供 listResolver 前为空）。 */
    suspend fun playerList(): List<JsonObject> {
        val listId = core.state.value.playerListId ?: return emptyList()
        return runCatching { listResolver(listId) }.getOrDefault(emptyList())
    }

    suspend fun togglePlayMethod(): TogglePlayMethod = core.toggleNextPlayMethod()

    private fun wireUserApiUpdates() {
        val updater = userApi.updater
        updater.onLog = { type, message ->
            Log.d("UserApiUpdate", "[$type]$message")
            userApi.onLog?.invoke(type, message)
        }
        userApi.onUpdateAlert = { name, log, updateUrl ->
            scope.launch { updater.handleUpdateAlert(name, log, updateUrl) }
        }
        // 先等当前源初始化完再查更新：源还没起来就换脚本，验证失败会把「源已就绪」判成失败
        scope.launch {
            userApi.ensureSourceReady()
            updater.runStartupCheck()
        }
    }

    /** 设置变化时调用：关 → 释放音效；开/换档 → 立即重挂一次。 */
    fun setVolumeBalancer(
        enabled: Boolean,
        level: Int,
    ) {
        isVolumeBalancerEnabled = { enabled }
        volumeBalancerLevel = { level }
        volumeBalancerUnsupported = false
        if (enabled) scope.launch { applyVolumeBalancer() } else volumeBalancer.release()
    }

    private fun observePlayForVolumeBalancer() {
        // RN 监听 play 事件：每次真正开始播放对齐一次 session（换解码器会重建）
        scope.launch {
            core.state
                .map { it.isPlay }
                .distinctUntilChanged()
                .collect { isPlay -> if (isPlay) applyVolumeBalancer() }
        }
    }

    private suspend fun applyVolumeBalancer() {
        if (volumeBalancerUnsupported || !isVolumeBalancerEnabled()) return
        var code = volumeBalancer.apply(platform.audioSessionId(), volumeBalancerLevel())
        var retry = 0
        // session 要等音频渲染器就绪才分配：NO_SESSION 稍后重试（RN 5 × 600ms）
        while (code == VolumeBalancer.Code.NO_SESSION && retry < 5) {
            delay(600L)
            retry++
            code = volumeBalancer.apply(platform.audioSessionId(), volumeBalancerLevel())
        }
        if (code.ok || code == VolumeBalancer.Code.NO_SESSION) return
        volumeBalancerUnsupported = true
        onVolumeBalancerFailed?.invoke()
    }

    private fun observeMetadata() {
        scope.launch {
            core.state
                .map { it.playMusicInfo }
                .distinctUntilChanged()
                .collect { playMusicInfo ->
                    val info = playMusicInfo.musicInfo ?: return@collect
                    platform.updateMetadata(
                        title = info.text("name").orEmpty(),
                        singer = info.text("singer").orEmpty(),
                        album = info.metaText("albumName").orEmpty(),
                        artworkUrl = info.metaText("picUrl")?.takeIf { it.isNotEmpty() },
                    )
                }
        }
    }

    /** 音量（0..1），设置层在 B5 接过来。 */
    suspend fun setVolume(volume: Float) = core.setVolume(volume)

    /** 播放倍速，设置层在 B5 接过来。 */
    suspend fun setRate(rate: Float) = core.setRate(rate)

    companion object {
        @Volatile
        private var instance: PlayerRuntime? = null

        fun get(context: Context): PlayerRuntime =
            instance ?: synchronized(this) {
                instance ?: PlayerRuntime(context.applicationContext).also { instance = it }
            }
    }
}

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

private fun JsonObject.metaText(key: String): String? =
    ((this["meta"] as? JsonObject)?.get(key) as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

/** 当前曲歌词快照。`raw/translation/roma` 保留原文，开关变化时只重解析不重下载。 */
data class LyricsState(
    val musicId: String = "",
    val raw: String = "",
    val translation: String = "",
    val roma: String = "",
    val parsed: ParsedLyric = ParsedLyric(),
    val loading: Boolean = false,
    val failed: Boolean = false,
)

/** 跨源 id 去重键（不同音源 id 可能相同）。 */
private fun JsonObject.musicKey(): String = "${text("source").orEmpty()}|${text("id").orEmpty()}"
