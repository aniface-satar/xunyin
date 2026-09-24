export type PlaylistQueueRoute = 'playlist' | 'playLater'

export interface PlaylistQueueItem {
  route: PlaylistQueueRoute
  musicInfo: LX.Music.MusicInfo
  index: number
}

const getMusicInfo = (musicInfo: LX.Player.PlayMusic): LX.Music.MusicInfo => {
  return 'progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo
}

export const buildPlaylistQueue = (
  playlist: LX.Music.MusicInfo[],
  tempPlaylist: LX.Player.PlayMusicInfo[],
  currentMusicId: string | null,
): PlaylistQueueItem[] => {
  const currentIndex = currentMusicId
    ? playlist.findIndex(musicInfo => musicInfo.id == currentMusicId)
    : -1
  const before = playlist.slice(0, currentIndex + 1)
  const after = playlist.slice(currentIndex + 1)

  return [
    ...before.map((musicInfo, index) => ({ route: 'playlist' as const, musicInfo, index })),
    ...tempPlaylist.map(({ musicInfo }, index) => ({
      route: 'playLater' as const,
      musicInfo: getMusicInfo(musicInfo),
      index,
    })),
    ...after.map((musicInfo, position) => ({
      route: 'playlist' as const,
      musicInfo,
      index: currentIndex + 1 + position,
    })),
  ]
}

export const getDragTargetSourceIndex = (
  queueItems: PlaylistQueueItem[],
  targetVisibleIndex: number,
  originalIndex: number,
) => {
  const targetItem = queueItems[targetVisibleIndex]
  if (targetItem?.route == 'playlist') return targetItem.index

  const previousItem = [...queueItems.slice(0, targetVisibleIndex)].reverse()
    .find(item => item.route == 'playlist')
  if (previousItem) return previousItem.index + 1

  const nextItem = queueItems.slice(targetVisibleIndex).find(item => item.route == 'playlist')
  return nextItem?.index ?? originalIndex
}
