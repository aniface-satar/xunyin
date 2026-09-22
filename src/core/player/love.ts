import { LIST_IDS } from '@/config/constant'
import { addListMusics, getListMusics, removeListMusics } from '@/core/list'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'

const getCurrentMusicInfo = () => {
  const playMusicInfo = playerState.playMusicInfo.musicInfo
  if (!playMusicInfo) return null

  return 'progress' in playMusicInfo ? playMusicInfo.metadata.musicInfo : playMusicInfo
}

export const isMusicCollected = async(musicId?: string | null) => {
  const musicInfo = getCurrentMusicInfo()
  const targetId = musicId ?? musicInfo?.id
  if (!targetId) return false

  const loveList = await getListMusics(LIST_IDS.LOVE)
  return loveList.some(music => music.id == targetId)
}

export const setMusicCollected = async(isCollected: boolean) => {
  const musicInfo = getCurrentMusicInfo()
  console.log('[LOVE_DEBUG] set', {
    isCollected,
    id: musicInfo?.id,
    name: musicInfo?.name,
    stack: new Error().stack?.split('\n').slice(1, 6).join(' <- '),
  })
  if (!musicInfo || await isMusicCollected(musicInfo.id) == isCollected) return

  if (isCollected) {
    await addListMusics(LIST_IDS.LOVE, [musicInfo], settingState.setting['list.addMusicLocationType'])
  } else {
    await removeListMusics(LIST_IDS.LOVE, [musicInfo.id])
  }
}
