/**
 * 稍后播放队列的顺序判定：电台补位曲必须排在用户手动加入的歌曲之后，
 * 否则"下一首"（固定弹出队首）会先播放补位曲而不是用户刚稍后播放的歌。
 * @param radioFlags 按队列顺序标记每项是否为电台补位曲
 */
export const hasUserTrackAfterRadio = (radioFlags: readonly boolean[]): boolean => {
  let hasRadio = false
  for (const isRadio of radioFlags) {
    if (isRadio) {
      hasRadio = true
    } else if (hasRadio) {
      return true
    }
  }
  return false
}
