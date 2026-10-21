import { addPlayHistory as addPlayHistoryToStorage, addMusicPlayCount, clearPlayHistory as clearPlayHistoryStorage, getPlayHistory } from '@/utils/data'


/**
 * 添加歌曲到播放历史
 * @param playMusicInfo 播放信息
 */
export const addPlayHistory = (playMusicInfo: LX.Player.PlayMusicInfo) => {
  void addPlayHistoryToStorage(playMusicInfo)
  // 记录歌曲播放次数，用于列表按播放次数排序
  void addMusicPlayCount(playMusicInfo.musicInfo.id)
}

/**
 * 清空播放历史
 */
export const clearPlayHistory = () => {
  void clearPlayHistoryStorage()
}

export { getPlayHistory }
