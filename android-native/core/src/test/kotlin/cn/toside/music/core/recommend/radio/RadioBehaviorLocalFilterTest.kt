package cn.toside.music.core.recommend.radio

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * W5-13：本地曲不吃词面 —— `source == "local"` 的曲子显式反馈时不学 tokenWeights
 * （硬盘里的文件名不是「想听什么」的表态），歌手先验照学（歌手是稳定品味信号）。
 */
class RadioBehaviorLocalFilterTest {
    private val now = RadioFixtures.NOW

    private fun trackInfo(source: String): JsonObject =
        buildJsonObject {
            put("id", "t1")
            put("name", "夜曲 高清无损合集版")
            put("singer", "周杰伦")
            put("source", source)
        }

    private fun like(info: JsonObject) =
        ExplicitFeedbackInput(
            type = ExplicitFeedbackType.LIKE,
            trackKey = RadioTrackKeys.buildTrackKey(info),
            timestamp = now,
            musicInfo = info,
        )

    @Test
    fun `本地曲显式喜欢不进词面`() {
        val online = RadioBehavior.applyExplicitFeedback(RadioState(), like(trackInfo("kw")))
        val local = RadioBehavior.applyExplicitFeedback(RadioState(), like(trackInfo("local")))
        // 在线曲照常学词面；本地曲一个词都不落
        assertTrue(online.state.tokenWeights.isNotEmpty())
        assertTrue(local.state.tokenWeights.isEmpty())
    }

    @Test
    fun `本地曲显式喜欢歌手先验照学`() {
        val online = RadioBehavior.applyExplicitFeedback(RadioState(), like(trackInfo("kw")))
        val local = RadioBehavior.applyExplicitFeedback(RadioState(), like(trackInfo("local")))
        assertEquals(online.state.artistStats.keys, local.state.artistStats.keys)
        assertTrue(local.state.artistStats.isNotEmpty())
    }

    @Test
    fun `本地曲踩雷仍记屏蔽但不吃词面`() {
        val local =
            RadioBehavior.applyExplicitFeedback(
                RadioState(),
                ExplicitFeedbackInput(
                    type = ExplicitFeedbackType.DISLIKE,
                    trackKey = RadioTrackKeys.buildTrackKey(trackInfo("local")),
                    timestamp = now,
                    musicInfo = trackInfo("local"),
                ),
            )
        // 屏蔽照生效（本地曲也能被踩雷）；词面不落负向
        assertTrue(local.state.dislikedTracks.isNotEmpty())
        assertTrue(local.state.tokenWeights.isEmpty())
    }
}
