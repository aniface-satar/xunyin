import type { LikedArtist } from '@/core/artistLibrary'
import state from './state'

export default {
  setLikedArtists(list: LikedArtist[]) {
    state.likedArtists = list
    global.state_event.likedArtistsUpdated(list)
  },
}
