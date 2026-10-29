import {
  removeLikedArtist as removeFromList,
  toggleLikedArtist as toggleInList,
  type LikedArtist,
  type LikedArtistInput,
} from '@/core/artistLibrary'
import likedArtistAction from '@/store/likedArtist/action'
import likedArtistState from '@/store/likedArtist/state'
import { getLikedArtists, saveLikedArtists } from '@/utils/data'

export const initLikedArtists = async() => {
  likedArtistAction.setLikedArtists(await getLikedArtists())
}

const commit = async(list: LikedArtist[]) => {
  likedArtistAction.setLikedArtists(list)
  await saveLikedArtists(list)
}

export const toggleLikedArtist = async(artist: LikedArtistInput) => {
  const result = toggleInList(likedArtistState.likedArtists, artist)
  await commit(result.list)
  return result.liked
}

export const removeLikedArtist = async(source: LikedArtist['source'], id: string) => {
  await commit(removeFromList(likedArtistState.likedArtists, source, id))
}
