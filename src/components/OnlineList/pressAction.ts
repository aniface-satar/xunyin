type SourceListPlayHandler = (index: number) => void

export type ListPressAction<T> = {
  kind: 'sourceList'
  index: number
  onPlayList: SourceListPlayHandler
} | {
  kind: 'music'
  musicInfo: T
}

export const getListPressAction = <T,>(
  musicInfo: T,
  index: number,
  onPlayList?: SourceListPlayHandler,
): ListPressAction<T> => {
  if (onPlayList) return { kind: 'sourceList', index, onPlayList }
  return { kind: 'music', musicInfo }
}
