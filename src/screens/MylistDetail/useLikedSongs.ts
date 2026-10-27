import { useEffect, useState } from 'react'

import { getListMusics } from '@/core/list'
import { LIST_IDS } from '@/config/constant'

export const useLikedSongs = () => {
  const [musics, setMusics] = useState<LX.Music.MusicInfo[]>([])

  useEffect(() => {
    let mounted = true
    const load = () => {
      void getListMusics(LIST_IDS.LOVE).then(list => {
        if (mounted) setMusics(list)
      })
    }
    load()
    global.app_event.on('myListMusicUpdate', load)
    return () => {
      mounted = false
      global.app_event.off('myListMusicUpdate', load)
    }
  }, [])

  return musics
}
