// 识曲结果的统一形状。引擎数组（Task 5）与各引擎实现都产出这个结构，
// 页面层只认它，不认网易/Shazam 的原始响应。
export interface RecognizedSong {
  name: string
  singer: string
  albumName: string
  neteaseSongId: string
  startTimeMs: number
}
