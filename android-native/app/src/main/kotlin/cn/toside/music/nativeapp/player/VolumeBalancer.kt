package cn.toside.music.nativeapp.player

import android.media.audiofx.DynamicsProcessing
import android.os.Build
import android.util.Log

/**
 * 音量均衡 —— 对照 RN `android/.../volumeBalancer/VolumeBalancerModule.java`：
 * 在播放器的 audio session 上挂系统 DynamicsProcessing 多段压缩（MBC），
 * 把响的歌曲动态压小，缩小不同歌曲之间的音量差。
 *
 * 音效归属于播放器的 session，换解码器时 session 会重建，所以由调用方在
 * 每次开始播放/改设置时重新 apply；session 未就绪（<=0）返回 NO_SESSION 重试。
 */
class VolumeBalancer {
    enum class Code(
        val ok: Boolean,
    ) {
        OK(true),
        RELEASED(true),
        NO_SESSION(false),
        UNSUPPORTED_SDK(false),
        CREATE_FAILED(false),
        NO_MBC(false),
        CONFIGURE_FAILED(false),
    }

    data class Params(
        val ratio: Float,
        val thresholdDb: Float,
        val postGainDb: Float,
    )

    private var effect: DynamicsProcessing? = null
    private var sessionId = -1

    @Synchronized
    fun apply(
        sessionId: Int,
        level: Int,
    ): Code {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return Code.UNSUPPORTED_SDK
        if (sessionId <= 0) return Code.NO_SESSION

        val current = effect
        if (current != null && this.sessionId == sessionId) return configure(current, level)

        releaseEffect()
        val created =
            runCatching { DynamicsProcessing(sessionId) }.getOrElse { err ->
                Log.e(TAG, "Create DynamicsProcessing failed", err)
                return Code.CREATE_FAILED
            }
        effect = created
        this.sessionId = sessionId
        return configure(created, level)
    }

    @Synchronized
    fun release(): Code {
        releaseEffect()
        return Code.RELEASED
    }

    private fun configure(
        effect: DynamicsProcessing,
        level: Int,
    ): Code {
        return runCatching {
            val config = effect.getConfig()
            val channelCount = effect.getChannelCount()
            val bandCount = config.mbcBandCount
            if (!config.isMbcInUse || bandCount <= 0) {
                Log.e(TAG, "Effect has no usable MBC stage, channels=$channelCount bands=$bandCount")
                return Code.NO_MBC
            }
            val params = paramsFor(level)

            for (channel in 0 until channelCount) {
                val mbc = effect.getMbcByChannelIndex(channel)
                mbc.setEnabled(true)
                effect.setMbcByChannelIndex(channel, mbc)
            }
            for (band in 0 until bandCount) {
                val bandParams = DynamicsProcessing.MbcBand(config.getMbcBandByChannelIndex(0, band))
                bandParams.setEnabled(true)
                bandParams.setRatio(params.ratio)
                bandParams.setThreshold(params.thresholdDb)
                bandParams.setKneeWidth(3.0f)
                bandParams.setAttackTime(5.0f)
                bandParams.setReleaseTime(150.0f)
                bandParams.setPreGain(0.0f)
                bandParams.setPostGain(params.postGainDb)
                bandParams.setExpanderRatio(1.0f)
                bandParams.setNoiseGateThreshold(-90.0f)
                effect.setMbcBandAllChannelsTo(band, bandParams)
            }
            // 限幅器只打开、不改参数：补偿增益后靠它挡爆音，参数留给设备默认值
            if (config.isLimiterInUse) {
                for (channel in 0 until channelCount) {
                    val limiter = effect.getLimiterByChannelIndex(channel)
                    limiter.setEnabled(true)
                    effect.setLimiterByChannelIndex(channel, limiter)
                }
            }
            Log.i(TAG, "Applied: session=$sessionId level=$level channels=$channelCount mbcBands=$bandCount")
            Code.OK
        }.getOrElse { err ->
            Log.e(TAG, "Configure DynamicsProcessing failed", err)
            releaseEffect()
            Code.CONFIGURE_FAILED
        }
    }

    private fun releaseEffect() {
        val current = effect
        if (current != null) {
            runCatching { current.release() }.onFailure { err -> Log.e(TAG, "Release failed", err) }
        }
        effect = null
        sessionId = -1
    }

    companion object {
        private const val TAG = "VolumeBalancer"

        /** 三档参数（0=low / 1=mid / 2=high，与 RN LEVEL_VALUES 一致）。 */
        fun paramsFor(level: Int): Params =
            when {
                level <= 0 -> Params(ratio = 2.0f, thresholdDb = -12.0f, postGainDb = 0.0f)
                level == 1 -> Params(ratio = 4.0f, thresholdDb = -18.0f, postGainDb = 1.0f)
                else -> Params(ratio = 8.0f, thresholdDb = -24.0f, postGainDb = 2.0f)
            }
    }
}
