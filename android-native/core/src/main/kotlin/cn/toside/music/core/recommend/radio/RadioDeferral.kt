package cn.toside.music.core.recommend.radio

/**
 * 安全模式撤队判定 —— RN `core/recommend/queueDeferral.ts` 原样移植。
 *
 * 引擎队列与已移交给播放器的待播曲目共用同一套阈值，
 * 判定只依赖歌手/来源歌单的会话惩罚，不修改任何状态。
 */
object RadioDeferral {
    fun selectDeferredTrackKeys(
        items: List<RecommendQueueItem>,
        penalties: SessionPenalties?,
        maxDeferrals: Int = RadioConfig.SessionHealth.MAX_DEFERRALS_PER_TRIGGER,
        excludeTrackKey: String? = null,
    ): List<String> {
        if (penalties == null) return emptyList()
        val max = maxDeferrals.coerceAtLeast(0)
        val deferred = mutableListOf<String>()
        for (item in items) {
            if (deferred.size >= max) break
            val trackKey = RadioTrackKeys.buildTrackKey(item.musicInfo)
            if (trackKey == excludeTrackKey) continue
            val artistKeys = RadioTrackKeys.getArtistKeys(item.musicInfo)
            if (!SessionHealthLogic.shouldDeferQueuedItem(artistKeys, item.sourcePlaylistId, penalties)) continue
            if (!deferred.contains(trackKey)) deferred.add(trackKey)
        }
        return deferred
    }
}
