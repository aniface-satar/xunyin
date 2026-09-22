import { useEffect, useState } from 'react'

import { getListMusics } from '@/core/list'
import { LIST_IDS } from '@/config/constant'
import { usePlayMusicInfo } from './hook'

export const useIsLove = () => {
  const playMusicInfo = usePlayMusicInfo()
  const [isLove, setIsLove] = useState(false)

  useEffect(() => {
    let valid = true
    const currentMusic = playMusicInfo.musicInfo
      ? 'progress' in playMusicInfo.musicInfo
        ? playMusicInfo.musicInfo.metadata.musicInfo
        : playMusicInfo.musicInfo
      : null

    const updateLoveState = () => {
      if (!currentMusic) {
        setIsLove(false)
        return
      }
      void getListMusics(LIST_IDS.LOVE).then((musics) => {
        if (valid) setIsLove(musics.some(music => music.id == currentMusic.id))
      })
    }

    updateLoveState()
    global.app_event.on('myListMusicUpdate', updateLoveState)
    return () => {
      valid = false
      global.app_event.off('myListMusicUpdate', updateLoveState)
    }
  }, [playMusicInfo])

  return isLove
}
