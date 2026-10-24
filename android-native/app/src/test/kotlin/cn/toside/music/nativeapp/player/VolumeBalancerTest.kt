package cn.toside.music.nativeapp.player

import org.junit.Assert.assertEquals
import org.junit.Test

/** 音量均衡三档参数：对照 RN VolumeBalancerModule.java 的 level 分支。 */
class VolumeBalancerTest {
    @Test
    fun lowLevelParams() {
        val params = VolumeBalancer.paramsFor(0)
        assertEquals(2.0f, params.ratio)
        assertEquals(-12.0f, params.thresholdDb)
        assertEquals(0.0f, params.postGainDb)
    }

    @Test
    fun midLevelParams() {
        val params = VolumeBalancer.paramsFor(1)
        assertEquals(4.0f, params.ratio)
        assertEquals(-18.0f, params.thresholdDb)
        assertEquals(1.0f, params.postGainDb)
    }

    @Test
    fun highLevelParams() {
        val params = VolumeBalancer.paramsFor(2)
        assertEquals(8.0f, params.ratio)
        assertEquals(-24.0f, params.thresholdDb)
        assertEquals(2.0f, params.postGainDb)
    }

    @Test
    fun outOfRangeLevelsClampToNearestTier() {
        assertEquals(VolumeBalancer.paramsFor(0), VolumeBalancer.paramsFor(-1))
        assertEquals(VolumeBalancer.paramsFor(2), VolumeBalancer.paramsFor(9))
    }
}
