import { buildTrackKey, canonicalTrackKey, getArtistKeys, normalizeText } from './trackKey.ts'

/** 与 utils/dislikeManage 的输出规则保持一致（均为小写）。 */
export const DISLIKE_PAIR_SEPARATOR = '@'

export interface DislikeRules {
  names: ReadonlySet<string>
  musicNames: ReadonlySet<string>
  singerNames: ReadonlySet<string>
}

export interface TrackLike {
  name?: string | null
  singer?: string | null
  interval?: string | null
  source?: string | null
  meta?: { songId?: string | number | null, albumName?: string | null } | null
}

export type ExclusionReason =
  | 'library'
  | 'disliked'
  | 'blocked_song'
  | 'blocked_artist'
  | 'blocked_pair'
  | 'queued'
  | 'session_played'
  | 'recent_radio_7d'

export interface ExclusionContext {
  libraryKeys: ReadonlySet<string>
  dislikedTrackKeys: ReadonlySet<string>
  queuedTrackKeys: ReadonlySet<string>
  sessionTrackKeys: ReadonlySet<string>
  recentRadioTrackKeys: ReadonlySet<string>
  blocked: DislikeRules
}

export const isDislikedByName = (name: string, singer: string, blocked: DislikeRules): ExclusionReason | undefined => {
  const trackName = normalizeText(name)
  if (!trackName) return undefined
  if (blocked.musicNames.has(trackName)) return 'blocked_song'

  const artistKeys = getArtistKeys(singer)
  for (const artist of artistKeys) {
    if (blocked.singerNames.has(artist)) return 'blocked_artist'
    if (blocked.names.has(`${trackName}${DISLIKE_PAIR_SEPARATOR}${artist}`)) return 'blocked_pair'
  }
  return undefined
}

export const buildTrackIdentity = (track: TrackLike) => {
  return canonicalTrackKey(String(track.name ?? ''), String(track.singer ?? ''))
}

export const getExclusionReason = (track: TrackLike, ctx: ExclusionContext): ExclusionReason | undefined => {
  const trackKey = track.source && track.meta?.songId != null
    ? buildTrackKey(track as LX.Music.MusicInfo)
    : buildTrackIdentity(track)
  if (ctx.libraryKeys.has(trackKey)) return 'library'
  if (ctx.dislikedTrackKeys.has(trackKey)) return 'disliked'
  if (ctx.queuedTrackKeys.has(trackKey)) return 'queued'
  if (ctx.sessionTrackKeys.has(trackKey)) return 'session_played'
  if (ctx.recentRadioTrackKeys.has(trackKey)) return 'recent_radio_7d'
  return isDislikedByName(String(track.name ?? ''), String(track.singer ?? ''), ctx.blocked)
}
