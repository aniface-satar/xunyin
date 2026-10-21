import test from 'node:test'
import assert from 'node:assert/strict'
import { LISTEN_SECONDS } from '../src/core/musicRecognition/pcmSplitter.ts'
import { SESSION_SECONDS, mergeSong, shouldResumeOnExit, shouldStartAnotherRound } from '../src/core/musicRecognition/session.ts'
import type { RecognizedSong } from '../src/core/musicRecognition/types.ts'

const song = (over: Partial<RecognizedSong> = {}): RecognizedSong => ({
  name: 'A', singer: 'x', albumName: '', neteaseSongId: '1', startTimeMs: 0, ...over,
})

// --- 会话预算 ---

test('会话预算是一分钟，比一轮录音长得多，否则循环一次都跑不完', () => {
  assert.ok(SESSION_SECONDS > LISTEN_SECONDS * 2, `${SESSION_SECONDS}s 装不下两轮 ${LISTEN_SECONDS}s`)
})

test('60 秒之内允许再开一轮，到点之后不许', () => {
  const start = 1_000_000
  assert.equal(shouldStartAnotherRound(start, start), true, '按下圆盘的瞬间必须开第一轮')
  assert.equal(shouldStartAnotherRound(start + 59_999, start), true)
  assert.equal(shouldStartAnotherRound(start + 60_000, start), false)
  assert.equal(shouldStartAnotherRound(start + 61_000, start), false)
})

// 钉住语义：截止管的是「开新轮」，不管「收正在跑的那一轮」。
// 一轮要录满 8 秒，卡着 60 秒整不许开新轮 ⇒ 会话实际时长会超过一分钟，这是刻意的。
test('截止只管开新轮，进行中的那一轮照样跑完', () => {
  const start = 0
  let elapsed = 0
  let rounds = 0
  while (shouldStartAnotherRound(elapsed, start)) {
    rounds += 1
    // 一轮 = 8 秒录音 + 约 3.5 秒解码与匹配（真机实测）
    elapsed += LISTEN_SECONDS * 1000 + 3500
  }
  assert.equal(rounds, 6)
  assert.ok(elapsed > SESSION_SECONDS * 1000, '最后一轮越过了截止时刻才算收工')
})

// --- 列表去重 ---

test('新歌追加到列表尾部，返回的是新数组而不是改过的旧数组', () => {
  const list: RecognizedSong[] = [song()]
  const next = mergeSong(list, song({ name: 'B' }))
  assert.notEqual(next, list)
  assert.deepEqual(next.map(item => item.name), ['A', 'B'])
  assert.deepEqual(list.map(item => item.name), ['A'], '旧数组不许被就地改写')
})

test('同一首再认一次不新增条目，而且返回同一个引用', () => {
  const list = [song()]
  const next = mergeSong(list, song({ albumName: '随便变的字段' }))
  assert.equal(next, list, '返回同一引用，面板 setList(同一引用) 就不会多渲染一次')
})

// Shazam 那条引擎的 neteaseSongId 恒为空串（见 shazamApi.ts 的注释：跨派系填它等于造假数据），
// 所以「id 相同」在 Shazam 这里永远成立，判重必须真的比到歌名与歌手。
test('两条 id 都为空但歌名歌手相同，仍然算同一首', () => {
  const list = [song({ neteaseSongId: '' })]
  assert.equal(mergeSong(list, song({ neteaseSongId: '' })), list)
})

test('两条 id 都为空、歌名相同但歌手不同，算两首', () => {
  const list = [song({ neteaseSongId: '', singer: 'x' })]
  assert.equal(mergeSong(list, song({ neteaseSongId: '', singer: 'y' })).length, 2)
})

// 同名不同 id 是真会发生的（现场版/纯音乐版同名），不能被去重吞掉。
test('同名同歌手但 id 不同，算两首', () => {
  const list = [song({ neteaseSongId: '1' })]
  assert.equal(mergeSong(list, song({ neteaseSongId: '2' })).length, 2)
})

test('歌名或歌手只差首尾空白，算同一首', () => {
  const list = [song({ name: ' Fade Away ', singer: ' The ' })]
  assert.equal(mergeSong(list, song({ name: 'Fade Away', singer: 'The' })), list)
})

// --- 退出识曲页时该不该把音乐接回去 ---
// 面板传进来的 pausedFor / loaded 都是 musicInfo 对象引用：换了歌就是换了对象。
const track = { id: '1' }

test('为识曲按下了暂停、那首还停在播放器里 → 退出时接回去', () => {
  assert.equal(shouldResumeOnExit(track, { isPlay: false, loaded: track }), true)
})

test('这一场没为识曲停过歌 → 不碰播放器', () => {
  assert.equal(shouldResumeOnExit(null, { isPlay: false, loaded: track }), false)
})

test('用户在页内自己按了播放 → 别再替他按一次', () => {
  assert.equal(shouldResumeOnExit(track, { isPlay: true, loaded: track }), false)
})

// play() 放的是「播放器里当前那一首」，不是当初按下暂停的那首。
// 用户在页内点了识别结果播别的歌、又自己停了它，这时接回去等于擅自开播他没在听的东西。
test('播放器里换成别的歌 → 不接管用户的新选择', () => {
  assert.equal(shouldResumeOnExit(track, { isPlay: false, loaded: { id: '2' } }), false)
})

test('队列被清空 → 没东西可接', () => {
  assert.equal(shouldResumeOnExit(track, { isPlay: false, loaded: null }), false)
})
