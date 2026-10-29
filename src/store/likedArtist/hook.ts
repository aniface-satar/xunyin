import { useEffect, useState } from 'react'

import type { LikedArtist } from '@/core/artistLibrary'
import state from './state'

export const useLikedArtists = () => {
  const [list, setList] = useState(state.likedArtists)

  useEffect(() => {
    const handleUpdate = (next: LikedArtist[]) => {
      setList(next)
    }
    global.state_event.on('likedArtistsUpdated', handleUpdate)
    return () => {
      global.state_event.off('likedArtistsUpdated', handleUpdate)
    }
  }, [])

  return list
}
