/**
 * 决定"上一曲"在已播放历史中的锚点。
 *
 * 背景：串流式播放（个性电台/探索未知）的歌曲经"稍后播放"临时队列播出，
 * 若不特殊处理，上一曲会锚回底层旧列表的歌曲而不是实际上一首播放的歌。
 * 电台会把每首开播的歌写入 playedList（isTempPlay=true），因此：
 * - 当前临时曲已在历史中 → 锚定自身，历史后退；
 * - 普通"稍后播放"曲（不在历史中）→ 保持旧语义，锚定底层列表当前位歌曲；
 * - 非临时曲 → 锚定自身 id。
 */
export const resolvePrevAnchor = (
  currentPlayInfo: { musicInfo: { id: string }, isTempPlay: boolean },
  playedList: ReadonlyArray<{ musicInfo: { id: string }, isTempPlay: boolean }>,
  listMusicId: string | null,
): { currentId: string | null, tempInHistory: boolean } => {
  if (!currentPlayInfo.isTempPlay) return { currentId: currentPlayInfo.musicInfo.id, tempInHistory: false }
  const tempId = currentPlayInfo.musicInfo.id
  if (playedList.some(m => m.isTempPlay && m.musicInfo.id == tempId)) {
    return { currentId: tempId, tempInHistory: true }
  }
  return { currentId: listMusicId, tempInHistory: false }
}
