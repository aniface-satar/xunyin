package cn.toside.music.nativeapp.player

import android.content.Context
import android.net.Uri
import android.os.PowerManager
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionParameters
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.CacheWriter
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import cn.toside.music.core.player.PlaybackCommands
import cn.toside.music.core.player.PlaybackEvent
import cn.toside.music.core.player.PlaybackEventSource
import cn.toside.music.core.player.PlayerCache
import cn.toside.music.core.player.PlayerPlatform
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.resume

/**
 * Media3 [PlayerPlatform] 实现 —— 对照 lyswhut/react-native-track-player fork
 * （LocalPlayback.java + MusicManager.java，media3 1.8.0）的定制点：
 *
 * - LRU 音频缓存（SimpleCache + LeastRecentlyUsedCacheEvictor，filesDir/TrackPlayer）
 * - audioOffload 开关（AudioOffloadPreferences + gapless 必需）
 * - handleAudioFocus（setAudioAttributes 第二参）
 * - WAKE_MODE_NONE + 自管 wakeLock/wifiLock（本类持有 wakeLock；wifiLock 在 B2 后续按需）
 * - AudioAttributes：CONTENT_TYPE_MUSIC + USAGE_MEDIA
 * - 变更：使用 media3 1.11.1（fork 的 1.8.0 后两版；1.11.x API 兼容这段代码）
 */
@UnstableApi
class Media3PlayerPlatform(
    private val context: Context,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main),
) : PlayerPlatform,
    PlayerCache,
    PlaybackEventSource {
    private var player: ExoPlayer? = null
    private var mediaSession: MediaSession? = null
    private var cache: SimpleCache? = null
    private var wakeLock: PowerManager.WakeLock? = null

    /** token -> writer，供 cancelCacheTrack 用；用户跳走时早点收摊，省流量。 */
    private val cacheWriters = ConcurrentHashMap<String, CacheWriter>()

    /** 当前曲目元数据（通知栏用；B4 播放页接入后补封面）。 */
    @Volatile
    var currentMetadata: MediaMetadata? = null

    /** 播放状态回调（isPlay/进度/播完 → 由 PlaybackCoordinator 消费）。 */
    override var onPlaybackEvent: ((PlaybackEvent) -> Unit)? = null

    /** 通知栏/耳机键指令的目标（由 B4/B5 接 PlayerCore 后注入）。 */
    var commandHandler: PlaybackCommands? = null

    override suspend fun setResource(
        musicId: String,
        url: String,
        startPositionMs: Long,
    ) {
        val p = ensurePlayer()
        val item =
            MediaItem
                .Builder()
                .setUri(url)
                .setMediaId(musicId)
                .setMediaMetadata(currentMetadata ?: MediaMetadata.Builder().build())
                .build()
        p.setMediaItem(item, startPositionMs)
        p.prepare()
        // 对照 RN playerLoadstart：装载一开始就通知编排层起 25 秒加载超时
        onPlaybackEvent?.invoke(PlaybackEvent.LoadStarted)
    }

    override suspend fun play() {
        ensurePlayer().play()
    }

    override suspend fun pause() {
        ensurePlayer().pause()
    }

    override suspend fun stop() {
        player?.stop()
        player?.clearMediaItems()
        releaseLocks()
    }

    override suspend fun setVolume(volume: Float) {
        ensurePlayer().volume = volume
    }

    override suspend fun setRate(rate: Float) {
        ensurePlayer().setPlaybackSpeed(rate)
    }

    override suspend fun seekTo(positionSec: Float) {
        ensurePlayer().seekTo((positionSec * 1000).toLong())
    }

    override suspend fun isInitialized(): Boolean = player != null

    override suspend fun initialize(
        volume: Float,
        playRate: Float,
        cacheSizeMiB: Int,
        isHandleAudioFocus: Boolean,
        isEnableAudioOffload: Boolean,
    ) {
        val p = ensurePlayer(cacheSizeMiB, isHandleAudioFocus, isEnableAudioOffload)
        p.volume = volume
        p.setPlaybackSpeed(playRate)
    }

    override suspend fun isEmpty(): Boolean = player?.mediaItemCount == 0

    override suspend fun positionMs(): Long = player?.currentPosition ?: 0L

    override suspend fun durationMs(): Long {
        val duration = player?.duration ?: return 0L
        // 未知长度（直播/电台）为 C.TIME_UNSET，别把负值漏给上层
        return if (duration == C.TIME_UNSET) 0L else duration.coerceAtLeast(0L)
    }

    /** 播放器 audio session（音频渲染器就绪前为 0，音量均衡用它挂音效）。 */
    fun audioSessionId(): Int = player?.audioSessionId ?: C.AUDIO_SESSION_ID_UNSET

    /** 更新通知栏元数据（对照 RN updateMetaData：标题/歌手/专辑/封面）。 */
    fun updateMetadata(
        title: String,
        singer: String,
        album: String,
        artworkUrl: String? = null,
    ) {
        val builder =
            MediaMetadata
                .Builder()
                .setTitle(title)
                .setArtist(singer)
                .setAlbumTitle(album)
        if (artworkUrl != null) builder.setArtworkUri(Uri.parse(artworkUrl))
        val meta = builder.build()
        currentMetadata = meta
        player?.run {
            val item = currentMediaItem ?: return
            replaceMediaItem(currentMediaItemIndex, item.buildUpon().setMediaMetadata(meta).build())
        }
    }

    /**
     * 预热下一首的音频字节到播放器这份缓存里（对照 fork LocalPlayback.cacheTrack）。
     *
     * 建 DataSource 与登记 token 都留在调用线程：cacheTrack 与 cancelCacheTrack 只有排在同一条队列上
     * 才有先后可言；put 挪进 worker 就成了两条队列抢时间，取消可能先落地、摘不到 writer，
     * 那条读循环会一路读到底（full 档没有 8MB 上限兜底）。
     */
    override suspend fun cacheTrack(
        url: String,
        headers: Map<String, String>,
        maxBytes: Long,
        token: String,
    ): Boolean {
        val activeCache = cache ?: return false
        if (url.isEmpty() || token.isEmpty()) return false

        // 与播放路径同一套请求头：带 referer/UA 校验的源否则会 403，白下一趟
        val requestHeaders = headers.toMutableMap()
        val upstream =
            DefaultHttpDataSource
                .Factory()
                .setConnectTimeoutMs(DefaultHttpDataSource.DEFAULT_CONNECT_TIMEOUT_MILLIS)
                .setReadTimeoutMs(DefaultHttpDataSource.DEFAULT_READ_TIMEOUT_MILLIS)
                .setAllowCrossProtocolRedirects(true)
        requestHeaders.remove("User-Agent")?.takeIf { it.isNotEmpty() }?.let { upstream.setUserAgent(it) }
        if (requestHeaders.isNotEmpty()) upstream.setDefaultRequestProperties(requestHeaders)

        val dataSource: CacheDataSource
        val writer: CacheWriter
        try {
            dataSource =
                CacheDataSource
                    .Factory()
                    .setCache(activeCache)
                    .setUpstreamDataSourceFactory(upstream)
                    .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
                    .createDataSource()
            // maxBytes <= 0 表示整首，交给 LENGTH_UNSET，别用「很大的正数」糊弄
            val dataSpec = DataSpec(Uri.parse(url), 0, if (maxBytes > 0) maxBytes else C.LENGTH_UNSET.toLong())
            writer = CacheWriter(dataSource, dataSpec, ByteArray(64 * 1024)) { _, _, _ -> }
        } catch (e: Throwable) {
            return false
        }

        cacheWriters[token] = writer
        return suspendCancellableCoroutine { continuation ->
            continuation.invokeOnCancellation { cancelCacheTrack(token) }
            val worker =
                Thread({
                    try {
                        writer.cache()
                        // 读循环结束时 token 还登记在表里才算成功；被取消的那次 remove 到 null，报 false
                        val completed = cacheWriters.remove(token) != null
                        if (continuation.isActive) continuation.resume(completed)
                    } catch (e: Throwable) {
                        cacheWriters.remove(token)
                        if (continuation.isActive) continuation.resume(false)
                    } finally {
                        // media3 常规路径已关过；这里补的是走不到 close 的路径（未关会一直占着 hole span）
                        runCatching { dataSource.close() }
                    }
                }, "TrackPlayerCacheTrack")
            worker.isDaemon = true
            worker.start()
        }
    }

    override fun cancelCacheTrack(token: String) {
        cacheWriters.remove(token)?.cancel()
    }

    override suspend fun isCached(url: String): Boolean = cache?.getCachedSpans(url)?.isNotEmpty() == true

    override suspend fun getCacheSize(): Long = cache?.cacheSpace ?: 0L

    override suspend fun clearCache() {
        val activeCache = cache ?: return
        activeCache.keys.forEach { key ->
            runCatching { activeCache.removeResource(key) }
        }
    }

    private fun ensurePlayer(
        cacheSizeMiB: Int = 1024,
        isHandleAudioFocus: Boolean = true,
        isEnableAudioOffload: Boolean = true,
    ): ExoPlayer {
        player?.let { return it }

        // 缓存（对照 LocalPlayback：>0 才建；LRU 驱逐）
        val cacheMaxBytes = cacheSizeMiB.toLong() * 1024 * 1024
        if (cacheMaxBytes > 0) {
            val cacheDir = File(context.filesDir, "TrackPlayer")
            val db = StandaloneDatabaseProvider(context)
            cache = SimpleCache(cacheDir, LeastRecentlyUsedCacheEvictor(cacheMaxBytes), db)
        }
        val localCache = cache

        // DataSource 工厂（对照 Track.java：默认超时 + 跨协议重定向 + 移动 UA）
        val httpFactory =
            DefaultHttpDataSource
                .Factory()
                .setConnectTimeoutMs(DefaultHttpDataSource.DEFAULT_CONNECT_TIMEOUT_MILLIS)
                .setReadTimeoutMs(DefaultHttpDataSource.DEFAULT_READ_TIMEOUT_MILLIS)
                .setAllowCrossProtocolRedirects(true)
                .setUserAgent(
                    "Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Mobile Safari/537.36",
                )
        // 本地曲库（Wave5 Lane B）：`content://` 不能交给 DefaultHttpDataSource（会报
        // Unsupported scheme），按 scheme 分流到 DefaultDataSource（内容/文件 URI）。
        // HTTP 分支保持原样（缓存 + UA + 超时），本地文件不进磁盘缓存。
        val dataSourceFactory: androidx.media3.datasource.DataSource.Factory =
            SchemeRoutingDataSourceFactory(
                httpFactory =
                    if (localCache != null) {
                        CacheDataSource
                            .Factory()
                            .setCache(localCache)
                            .setUpstreamDataSourceFactory(httpFactory)
                            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
                    } else {
                        httpFactory
                    },
                localFactory = DefaultDataSource.Factory(context),
            )

        val p =
            ExoPlayer
                .Builder(context)
                .setMediaSourceFactory(DefaultMediaSourceFactory(dataSourceFactory))
                .setWakeMode(C.WAKE_MODE_NONE)
                .build()

        // 音频卸载（对照 MusicManager.createLocalPlayback）
        val trackParams =
            p.trackSelectionParameters
                .buildUpon()
                .setAudioOffloadPreferences(
                    TrackSelectionParameters.AudioOffloadPreferences
                        .Builder()
                        .setAudioOffloadMode(
                            if (isEnableAudioOffload) {
                                TrackSelectionParameters.AudioOffloadPreferences.AUDIO_OFFLOAD_MODE_ENABLED
                            } else {
                                TrackSelectionParameters.AudioOffloadPreferences.AUDIO_OFFLOAD_MODE_DISABLED
                            },
                        ).setIsGaplessSupportRequired(true)
                        .build(),
                ).build()
        p.trackSelectionParameters = trackParams

        // 音频焦点 + 音频属性
        p.setAudioAttributes(
            AudioAttributes
                .Builder()
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .setUsage(C.USAGE_MEDIA)
                .build(),
            isHandleAudioFocus,
        )

        p.addListener(
            object : Player.Listener {
                override fun onIsPlayingChanged(isPlaying: Boolean) {
                    if (isPlaying) {
                        acquireLocks()
                        onPlaybackEvent?.invoke(PlaybackEvent.Playing)
                    } else {
                        releaseLocks()
                        onPlaybackEvent?.invoke(PlaybackEvent.Paused)
                    }
                }

                override fun onPlaybackStateChanged(playbackState: Int) {
                    if (playbackState == Player.STATE_ENDED) {
                        onPlaybackEvent?.invoke(PlaybackEvent.Ended)
                    }
                }

                override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                    onPlaybackEvent?.invoke(PlaybackEvent.Failed(error.errorCodeName))
                }
            },
        )

        player = p
        return p
    }

    private fun acquireLocks() {
        if (wakeLock == null) {
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock =
                pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "xunyin:player").apply {
                    setReferenceCounted(false)
                }
        }
        wakeLock?.takeIf { !it.isHeld }?.acquire(30 * 60 * 1000L)
    }

    private fun releaseLocks() {
        wakeLock?.takeIf { it.isHeld }?.release()
    }

    /** MediaSession 接入（通知栏）。B2 验收的入口由 Service 调用。 */
    fun attachSession(service: MediaSessionService): MediaSession {
        val p = player ?: ensurePlayer()
        if (mediaSession == null) {
            val sessionPlayer = CommandForwardingPlayer(p) { commandHandler }
            mediaSession = MediaSession.Builder(service, sessionPlayer).build()
        }
        return mediaSession!!
    }

    /**
     * 通知栏按键映射 —— 对照 RN service.ts 的 RemotePlay/Pause/Next/Previous。
     *
     * play/pause 也走 PlayerCore（RN RemotePlay/RemotePause 就是 core.play/pause）：
     * 播放器为空时 core.play 会重新取链，而不是对着空 ExoPlayer 空转。
     * 上一首/下一首必须转给 PlayerCore（ExoPlayer 只装一首，队列语义全在 PlayerCore）。
     * media3 1.11 已废弃 onPlayerCommandRequest，官方替代是
     * 「改 Player.getAvailableCommands()」——所以这里把两个命令显式加进可用集，
     * 再把 seekToNext/seekToPrevious 转发给 commandHandler。
     */
    private class CommandForwardingPlayer(
        player: Player,
        private val commands: () -> PlaybackCommands?,
    ) : ForwardingPlayer(player) {
        override fun getAvailableCommands(): Player.Commands =
            super
                .getAvailableCommands()
                .buildUpon()
                .addAll(
                    Player.COMMAND_SEEK_TO_NEXT,
                    Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
                    Player.COMMAND_SEEK_TO_PREVIOUS,
                    Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
                ).build()

        override fun play() {
            commands()?.onPlayCommand()
        }

        override fun pause() {
            commands()?.onPauseCommand()
        }

        override fun seekToNext() {
            commands()?.onNextCommand()
        }

        override fun seekToNextMediaItem() {
            commands()?.onNextCommand()
        }

        override fun seekToPrevious() {
            commands()?.onPrevCommand()
        }

        override fun seekToPreviousMediaItem() {
            commands()?.onPrevCommand()
        }
    }

    fun release() {
        mediaSession?.release()
        mediaSession = null
        // 先让预热读循环收摊，再放缓存实例（反过来会在已释放的 cache 上收尾）
        cacheWriters.values.forEach { it.cancel() }
        cacheWriters.clear()
        player?.release()
        player = null
        releaseLocks()
        cache?.release()
        cache = null
        scope.cancel()
    }
}

/**
 * 按 URI scheme 分流的数据源工厂（Wave5 Lane B 的最小修补）。
 *
 * 原实现把 `DefaultHttpDataSource` 直接当上游，本地曲目的 `content://…` 会在
 * ExoPlayer 打开时抛 `Unsupported scheme`。这里只做一件事：
 * http(s) 走原来的「缓存 + HTTP」链，其余 scheme（content/file）走
 * [DefaultDataSource]（Media3 内置 ContentDataSource/FileDataSource），两者行为都不变。
 */
@UnstableApi
private class SchemeRoutingDataSourceFactory(
    private val httpFactory: androidx.media3.datasource.DataSource.Factory,
    private val localFactory: androidx.media3.datasource.DataSource.Factory,
) : androidx.media3.datasource.DataSource.Factory {
    override fun createDataSource(): androidx.media3.datasource.DataSource =
        object : androidx.media3.datasource.DataSource {
            private var delegate: androidx.media3.datasource.DataSource? = null
            private var currentUri: Uri? = null

            override fun open(dataSpec: DataSpec): Long {
                val factory =
                    if (dataSpec.uri.scheme?.startsWith("http") == true) httpFactory else localFactory
                val source = factory.createDataSource()
                delegate = source
                currentUri = dataSpec.uri
                return source.open(dataSpec)
            }

            override fun read(
                buffer: ByteArray,
                offset: Int,
                length: Int,
            ): Int {
                val source = delegate ?: throw IllegalStateException("DataSource 未打开")
                return source.read(buffer, offset, length)
            }

            override fun getUri(): Uri? = currentUri

            override fun close() {
                try {
                    delegate?.close()
                } finally {
                    delegate = null
                    currentUri = null
                }
            }

            override fun addTransferListener(transferListener: androidx.media3.datasource.TransferListener) {
                // 委托对象在 open() 时才确定，监听器由各自的工厂配置
            }
        }
}
