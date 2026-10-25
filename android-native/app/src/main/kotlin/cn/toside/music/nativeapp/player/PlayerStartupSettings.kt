package cn.toside.music.nativeapp.player

/**
 * 播放器启动参数回读（RN `player.ts#handlePlay` 里 `playerInitial({...})` 的等价物）。
 *
 * 三个键 `player.volume` / `player.playbackRate` / `player.isSavePlayTime` 原先只有写没有读；
 * 这里把前两个连同 RN 同时下发的缓存大小/音频焦点/音频卸载一起解析出来，
 * `isSavePlayTime` 由进度记忆（[cn.toside.music.core.player.PlayProgressMemory]）消费。
 *
 * 音频卸载与音量均衡互斥：卸载的输出路径绕过 audiofx 插入链，音量均衡依赖该链
 * （RN player.ts:250-251 的原注释）。
 */
data class PlayerStartupSettings(
    val volume: Float,
    val playRate: Float,
    val cacheSizeMiB: Int,
    val isHandleAudioFocus: Boolean,
    val isEnableAudioOffload: Boolean,
) {
    companion object {
        fun fromSetting(setting: Map<String, Any?>): PlayerStartupSettings {
            val volume = (setting["player.volume"] as? Number)?.toFloat() ?: 1f
            val playRate = (setting["player.playbackRate"] as? Number)?.toFloat() ?: 1f
            val cacheSize = (setting["player.cacheSize"] as? String)?.let(::parseCacheSize) ?: 1024
            val isHandleAudioFocus = setting["player.isHandleAudioFocus"] as? Boolean ?: true
            val isEnableOffload = setting["player.isEnableAudioOffload"] as? Boolean ?: true
            val isVolumeBalancer = setting["player.isEnableVolumeBalancer"] as? Boolean ?: false
            return PlayerStartupSettings(
                volume = volume,
                playRate = playRate,
                cacheSizeMiB = cacheSize,
                isHandleAudioFocus = isHandleAudioFocus,
                isEnableAudioOffload = isEnableOffload && !isVolumeBalancer,
            )
        }

        /**
         * RN 用 `parseInt(setting['player.cacheSize'])`：取前导整数，非法字符串得到 NaN。
         * 这里非法值归 0（等价于「不建缓存」，与 native 侧 cacheSize<=0 的分支一致）。
         */
        private fun parseCacheSize(raw: String): Int {
            val matched = LEADING_INT.find(raw)?.value ?: return 0
            return matched.toIntOrNull() ?: 0
        }

        private val LEADING_INT = Regex("^\\s*[+-]?\\d+")
    }
}
