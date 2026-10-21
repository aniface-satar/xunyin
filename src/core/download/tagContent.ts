/** 有 [mm:ss] 时间轴才算歌词，纯文本塞进标签里播放器只会显示一串乱码 */
const LRC_TIME_EXP = /\[\d{1,2}:.*\d{1,4}]/

/**
 * 写进标签的文本。
 * 三首曲子的字段都从同一份 musicInfo 来，缺一个就用空串补上，原生层只认字符串。
 */
export interface DownloadTagContent {
  name: string
  singer: string
  albumName: string
}

/** 只用到标题、歌手和专辑名，所以不要求整条 MusicInfoOnline，测试与调用方都更好构造 */
export interface TagSourceInfo {
  name: string
  singer: string
  meta: { albumName?: string | null }
}

export const buildTagContent = (musicInfo: TagSourceInfo): DownloadTagContent => {
  return {
    name: musicInfo.name ?? '',
    singer: musicInfo.singer ?? '',
    albumName: musicInfo.meta.albumName ?? '',
  }
}

/**
 * 把逐字歌词（`<起, 长>字`）压回普通 lrc 行。
 * 各源的 lyric 字段都可能带这些标记，直接写进标签的话别的播放器读不懂。
 */
export const toLrcText = (lyric?: string | null): string => {
  if (!lyric) return ''
  const lines = lyric
    .split('\n')
    .map(line => line.replace(/<\d+,\d+>/g, '').trimEnd())
    .filter(line => line.length)
    .join('\n')
  return LRC_TIME_EXP.test(lines) ? lines : ''
}
