package cn.toside.music.nativeapp.player

import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/**
 * 播放服务 —— 后台播放 + 通知栏（B2 验收：通知栏播放/暂停/切歌、后台存活）。
 *
 * 对照 RN fork 的 MusicService：MediaSession 挂在进程级 [PlayerRuntime] 上，
 * 播放/暂停/上一首/下一首由 Media3PlayerPlatform 的 CommandForwardingPlayer
 * 转给 PlayerCore（队列语义不在 ExoPlayer 里）。
 */
@UnstableApi
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onCreate() {
        super.onCreate()
        session = PlayerRuntime.get(this).platform.attachSession(this)
    }

    override fun onDestroy() {
        session?.release()
        session = null
        super.onDestroy()
    }
}
