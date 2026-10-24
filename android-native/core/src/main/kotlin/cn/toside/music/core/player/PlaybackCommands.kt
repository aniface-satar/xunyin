package cn.toside.music.core.player

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * 通知栏 / 耳机按键指令 —— RN `service.ts` 的 RemotePlay/Pause/Next/Previous/Seek。
 * MediaSession 回调是同步接口，实现方负责把动作甩进协程。
 */
interface PlaybackCommands {
    fun onPlayCommand()

    fun onPauseCommand()

    fun onNextCommand()

    fun onPrevCommand()

    fun onSeekCommand(positionMs: Long)
}

/** [PlaybackCommands] 的默认实现：直接转发给 [PlayerCore]（对照 RN service.ts 的转发）。 */
class CorePlaybackCommands(
    private val core: PlayerCore,
    private val scope: CoroutineScope,
) : PlaybackCommands {
    override fun onPlayCommand() {
        scope.launch { core.play() }
    }

    override fun onPauseCommand() {
        scope.launch { core.pause() }
    }

    override fun onNextCommand() {
        scope.launch { core.playNext() }
    }

    override fun onPrevCommand() {
        scope.launch { core.playPrev() }
    }

    override fun onSeekCommand(positionMs: Long) {
        scope.launch { core.seekTo(positionMs) }
    }
}
