import type { RecognizedSong } from './types'

// 持续识别的会话规则，纯函数：面板只管「录一轮、问一次、把结果交进来」，
// 什么时候该收尾、什么时候算同一首歌，都在这里，好让这两条能被单测钉住。

// 一次会话的预算：按下圆盘到「不再开新的一轮」的截止时刻。
// 它同时是单设备单次点按的请求量上限（一轮约 11.5 秒 ⇒ 约 6 笔），
// 这是每日次数上限取消之后，仍然把流量特征钉在"人手动点几下"量级的那道闸。
export const SESSION_SECONDS = 60

// 截止管的是「开新轮」，不是「收正在跑的那一轮」：一轮要录满 LISTEN_SECONDS，
// 半路掐掉等于白录。所以会话实际时长会略过一分钟，这是刻意的。
export const shouldStartAnotherRound = (nowMs: number, startedAtMs: number): boolean =>
  nowMs - startedAtMs < SESSION_SECONDS * 1000

// 判同一首：id 优先（网易云给稳定 id），但 Shazam 那条的 neteaseSongId 恒为空串
// （跨派系填它等于造假数据，见 shazamApi.ts），所以必须真的比到歌名与歌手，
// 否则 Shazam 列表里只会剩下第一首。同名不同 id 算两首——现场版与录音室版同名是真事。
// 也用作结果列表的 React key：列表只追加，一首歌的标识正好是它的一行。
export const songKey = (song: RecognizedSong): string =>
  `${song.neteaseSongId}|${song.name.trim()}|${song.singer.trim()}`

// 重复命中返回**同一个数组引用**：面板直接把它塞进 setState，引用相等就不会多渲染一次。
export const mergeSong = (list: RecognizedSong[], song: RecognizedSong): RecognizedSong[] =>
  list.some(item => songKey(item) == songKey(song)) ? list : [...list, song]

// 退出识曲页时要不要把「当初为识曲让路而暂停的那首」接回去。三个条件缺一不可：
// 1. 那个暂停确实是本场识曲按下的 —— 用户在页面上自己按停的歌不是我们停的，也不该由我们放；
// 2. 现在还是暂停态 —— 他自己按过播放了就别再替他按一次；
// 3. 播放器里装的仍是当初那一首 —— `play()` 放的是「当前装着的那首」而不是「当初停掉的那首」，
//    用户若在页内点了识别结果播别的歌，队列就归他管了，这时候接回去等于擅自开播他没在听的东西。
// 「同一首」比的是对象引用：面板两端都取 `playMusicInfo.musicInfo`，换了歌就是换了对象。
export const shouldResumeOnExit = <T>(pausedFor: T | null, current: { isPlay: boolean, loaded: T | null }): boolean =>
  pausedFor != null && !current.isPlay && current.loaded === pausedFor
