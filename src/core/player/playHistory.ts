import { addPlayHistory as addPlayHistoryToStorage, clearPlayHistory as clearPlayHistoryStorage, getPlayHistory } from '@/utils/data'


/**
 * 添加歌曲到播放历史
 * @param playMusicInfo 播放信息
 */
export const addPlayHistory = (playMusicInfo: LX.Player.PlayMusicInfo) => {
  void addPlayHistoryToStorage(playMusicInfo)
}

/**
 * 清空播放历史
 */
export const clearPlayHistory = () => {
  void clearPlayHistoryStorage()
}

export { getPlayHistory }
