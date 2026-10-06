import { buildTrackKey, getArtistKeys } from './trackKey.ts'
import { shouldDeferQueuedItem, type SessionPenalties } from './sessionHealth.ts'
import { recommendationConfig } from './config.ts'

export interface DeferrableItem {
  musicInfo: LX.Music.MusicInfo
  sourcePlaylistId?: string
}

export interface DeferralOptions {
  maxDeferrals?: number
  excludeTrackKey?: string
}

/**
 * 安全模式撤队判定。引擎队列与已移交给播放器的待播曲目共用同一套阈值，
 * 判定只依赖歌手/来源歌单的会话惩罚，不修改任何状态。
 */
export const selectDeferredTrackKeys = (
  items: readonly DeferrableItem[],
  penalties: SessionPenalties | undefined,
  options: DeferralOptions = {},
): string[] => {
  if (!penalties) return []
  const max = Math.max(0, options.maxDeferrals ?? recommendationConfig.sessionHealth.maxDeferralsPerTrigger)
  const deferred: string[] = []
  for (const item of items) {
    if (deferred.length >= max) break
    const trackKey = buildTrackKey(item.musicInfo)
    if (trackKey == options.excludeTrackKey) continue
    if (!shouldDeferQueuedItem(getArtistKeys(item.musicInfo.singer), item.sourcePlaylistId, penalties)) continue
    if (!deferred.includes(trackKey)) deferred.push(trackKey)
  }
  return deferred
}
