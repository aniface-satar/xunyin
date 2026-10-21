import { action } from '@/store/dislikeList'
import { recommendationEngine } from '@/core/recommend'


export const addDislikeInfo = async(infos: LX.Dislike.DislikeMusicInfo[]) => {
  await global.dislike_event.dislike_music_add(infos)
  // 不感兴趣同时是一次负反馈：永久屏蔽之外还要给来源歌单降权
  for (const info of infos) void recommendationEngine.onDislikedInfo(info.name, info.singer)
}

export const overwirteDislikeInfo = async(rules: string) => {
  await global.dislike_event.dislike_data_overwrite(rules)
  recommendationEngine.invalidateDislikeCache()
}

export const clearDislikeInfo = async() => {
  await global.dislike_event.dislike_music_clear()
  recommendationEngine.invalidateDislikeCache()
}


export const hasDislike = (info: LX.Music.MusicInfo | LX.Download.ListItem | null) => {
  if (!info) return false
  return action.hasDislike(info)
}


export const setDislikeInfo = (info: LX.Dislike.DislikeInfo) => {
  action.setDislikeInfo(info)
}

export { getDislikeInfo } from '@/utils/dislikeManage'
