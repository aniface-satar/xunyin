import type { LikedArtist } from '@/core/artistLibrary'

export interface InitState {
  likedArtists: LikedArtist[]
}

const state: InitState = {
  likedArtists: [],
}

export default state
