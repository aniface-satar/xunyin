package cn.toside.music.core.player

/**
 * 播放器事件 —— 对照 RN app_event 的 playerLoadstart/playerPlaying/playerPause/
 * playerEnded/error。平台实现负责把底层事件翻译成这几种，编排层
 * （[PlaybackCoordinator]）不碰平台细节。
 */
sealed interface PlaybackEvent {
    /** 开始装载新资源（RN playerLoadstart；用于 25 秒加载超时）。 */
    data object LoadStarted : PlaybackEvent

    data object Playing : PlaybackEvent

    data object Paused : PlaybackEvent

    data object Ended : PlaybackEvent

    data class Failed(
        val message: String,
    ) : PlaybackEvent
}

/** 事件源（平台实现）。 */
interface PlaybackEventSource {
    var onPlaybackEvent: ((PlaybackEvent) -> Unit)?
}
