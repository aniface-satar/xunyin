import { recommendationConfig } from './config.ts'
import type { SessionPreference, SessionTrack } from './types.ts'

export const createSession = (): SessionPreference => ({
  recentTracks: [],
  recentChannels: [],
})

export const pushSessionTrack = (session: SessionPreference, track: SessionTrack) => {
  session.recentTracks.unshift(track)
  if (session.recentTracks.length > recommendationConfig.session.recentTracksLimit) {
    session.recentTracks.length = recommendationConfig.session.recentTracksLimit
  }
  if (track.channel) {
    session.recentChannels.unshift(track.channel)
    if (session.recentChannels.length > recommendationConfig.channels.windowSize) {
      session.recentChannels.length = recommendationConfig.channels.windowSize
    }
  }
}
