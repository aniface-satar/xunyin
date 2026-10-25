package cn.toside.music.nativeapp.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 启动回读：对照 RN `player.ts#handlePlay` 里 `playerInitial({...})` 的取值，
 * 尤其是 `isEnableAudioOffload && !isEnableVolumeBalancer`（音量均衡依赖 audiofx 链）。
 */
class PlayerStartupSettingsTest {
    @Test
    fun usesRnDefaultsWhenSettingEmpty() {
        val s = PlayerStartupSettings.fromSetting(emptyMap())
        assertEquals(1f, s.volume)
        assertEquals(1f, s.playRate)
        assertEquals(1024, s.cacheSizeMiB)
        assertTrue(s.isHandleAudioFocus)
        assertTrue(s.isEnableAudioOffload)
    }

    @Test
    fun readsOverridesFromSetting() {
        val s =
            PlayerStartupSettings.fromSetting(
                mapOf(
                    "player.volume" to 0.35,
                    "player.playbackRate" to 1.5,
                    "player.cacheSize" to "256",
                    "player.isHandleAudioFocus" to false,
                    "player.isEnableAudioOffload" to false,
                ),
            )
        assertEquals(0.35f, s.volume)
        assertEquals(1.5f, s.playRate)
        assertEquals(256, s.cacheSizeMiB)
        assertFalse(s.isHandleAudioFocus)
        assertFalse(s.isEnableAudioOffload)
    }

    @Test
    fun volumeBalancerForcesOffloadOff() {
        // RN player.ts:251：音频卸载会绕过 audiofx 插入链，音量均衡开启时必须关掉
        val s =
            PlayerStartupSettings.fromSetting(
                mapOf(
                    "player.isEnableAudioOffload" to true,
                    "player.isEnableVolumeBalancer" to true,
                ),
            )
        assertFalse(s.isEnableAudioOffload)
    }

    @Test
    fun cacheSizeParsesLikeRnParseInt() {
        assertEquals(1024, PlayerStartupSettings.fromSetting(mapOf("player.cacheSize" to "1024")).cacheSizeMiB)
        assertEquals(0, PlayerStartupSettings.fromSetting(mapOf("player.cacheSize" to "")).cacheSizeMiB)
        assertEquals(0, PlayerStartupSettings.fromSetting(mapOf("player.cacheSize" to "abc")).cacheSizeMiB)
        assertEquals(512, PlayerStartupSettings.fromSetting(mapOf("player.cacheSize" to "512abc")).cacheSizeMiB)
    }
}
