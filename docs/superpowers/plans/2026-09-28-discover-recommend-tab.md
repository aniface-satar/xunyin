# Discover 推荐 Tab 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在发现页新增"推荐"tab，包含"个性电台"（基于本地听歌画像随机播放）与"探索未知"（听歌画像补集音乐）两个大卡片模块，点击即随机播放，无需歌单列表页。

**Architecture:** 纯逻辑层与 wiring 层分离：`pool.ts`（键/过滤/洗牌工具）、`profile.ts`（画像构建）、`radio.ts`（电台池会话）、`explore.ts`（探索池会话）为纯模块、零运行时依赖、可单测；`play.ts` 作为唯一 wiring 模块对接 musicSdk / 播放内核 / 本地数据；UI 层为两张卡片的状态机 + 基于"稍后播放"队列长度的自动续批。

**Tech Stack:** React Native 0.73 + TypeScript；测试用 node:test + `--experimental-strip-types`（零新增依赖，直接跑 `.mts`）。

**Spec:** `docs/superpowers/specs/2026-09-28-discover-recommend-tab-design.md`

## Global Constraints

以下约束对每个任务隐式生效：

- 所有代码改动在**内层仓库** `lx-music-mobile/lx-music-mobile-master` 中进行（下文路径均相对该目录）。提交也提交到内层仓库。
- **绝对禁止 `git add -A` / `git add .`**：内层仓库有用户未提交的图标 PNG 改动（mipmap-*.png 等），只能按文件名逐个 `git add` 本计划明确列出的文件。
- 纯模块 `src/core/recommend/pool.ts|profile.ts|radio.ts|explore.ts` **不得有任何 `@/` 运行时导入**；它们之间的相对导入必须带显式 `.ts` 扩展名（node strip-types 的硬性要求；基础 tsconfig 已启用 `allowImportingTsExtensions` + `noEmit`，Metro 与 tsc 均支持）。跨模块类型一律 `import type`。
- `src/core/recommend/play.ts` 是唯一允许导入 `@/` 路径的 recommend 模块；它**不被单测**（其相对导入按代码库惯例不带扩展名）。`src/screens` 与 `src/lang` 同理不进单测。
- 不做任何持久化：推荐会话只存模块级变量，应用重启即失效。
- 推荐固定使用 `(await getSongListSetting()).source` 作为音源，不随发现页源选择器联动（推荐 tab 下源选择器隐藏）。
- 入队一律通过 `addTempPlayList`（`@/core/player/tempPlayList`，队列空闲时它会自动 `playNext()`）；若当前有歌在播，还需补一次 `void playNext()` 跳到新批次。首批 `isTop: true`（整体插队到队列最前），续批 `isTop: false`（追加到队尾）。
- 文案三语同步：`src/lang/zh-cn.json`、`src/lang/zh-tw.json`、`src/lang/en-us.json`（`Message` 类型由这三个 JSON 的 key 联合推导，漏加会导致 `t()` 类型报错）。
- 测试命令（在内层仓库根目录执行）：`node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/<file>.mts`。
- 本机 npm install 慢易超时，**禁止新增任何 npm 依赖**。
- 提交信息用英文祈使句，与内层仓库现有风格一致（如 "Add ..."）。

---

### Task 1: 推荐工具池 pool.ts + 测试 + 测试脚本

**Files:**
- Create: `src/core/recommend/pool.ts`
- Test: `tests/recommend-pool.mts`
- Modify: `package.json:14`（test 脚本追加文件列表）

**Interfaces:**
- Consumes: 无（零导入）
- Produces（后续任务依赖，签名必须一致）:
  - `DISLIKE_PAIR_SEPARATOR: string`（值 `'@'`）
  - `interface DislikeInfo { names: Set<string>, musicNames: Set<string>, singerNames: Set<string> }`
  - `interface TrackLike { source?: string | null, name?: string | null, singer?: string | null, meta?: { songId?: string | number | null } | null }`
  - `splitSinger(singer: string): string[]`
  - `trackKey(track: TrackLike): string`（`sid:<source>__<songId>` 或回退 `ns:<name>__<singer>`，均小写）
  - `isDisliked(name: string, singer: string, dislike: DislikeInfo): boolean`
  - `isExcluded(track: TrackLike, excludeKeys: ReadonlySet<string>, dislike: DislikeInfo): boolean`
  - `shuffle<T>(list: readonly T[], random?: () => number): T[]`

- [ ] **Step 1: 写失败测试 `tests/recommend-pool.mts`**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DISLIKE_PAIR_SEPARATOR,
  isDisliked,
  isExcluded,
  shuffle,
  splitSinger,
  trackKey,
} from '../src/core/recommend/pool.ts'
import type { DislikeInfo } from '../src/core/recommend/pool.ts'

const emptyDislike = (): DislikeInfo => ({
  names: new Set(),
  musicNames: new Set(),
  singerNames: new Set(),
})

// 与 LX.Music.MusicInfo 结构兼容的最小测试对象
const song = (id: number, singer = 'A', name = `song${id}`) =>
  ({ id: `kw_${id}`, source: 'kw', name, singer, meta: { songId: id } }) as any

test('trackKey prefers source + songId', () => {
  assert.equal(trackKey(song(1)), 'sid:kw__1')
})

test('trackKey falls back to name + singer (trimmed, lowercased)', () => {
  assert.equal(trackKey({ name: ' Song ', singer: 'Singer' }), 'ns:song__singer')
})

test('splitSinger splits on common separators', () => {
  assert.deepEqual(splitSinger('A/B、C & D;E，F'), ['A', 'B', 'C', 'D', 'E', 'F'])
})

test('isDisliked matches music name exactly', () => {
  const dislike = emptyDislike()
  dislike.musicNames.add('bad song')
  assert.equal(isDisliked('Bad Song', 'A', dislike), true)
  assert.equal(isDisliked('other song', 'A', dislike), false)
})

test('isDisliked matches any singer token', () => {
  const dislike = emptyDislike()
  dislike.singerNames.add('zhang san')
  assert.equal(isDisliked('x', 'Zhang San/Li Si', dislike), true)
  assert.equal(isDisliked('x', 'Li Si', dislike), false)
})

test('isDisliked matches name@singer pair', () => {
  const dislike = emptyDislike()
  dislike.names.add(`bad song${DISLIKE_PAIR_SEPARATOR}a`)
  assert.equal(isDisliked('Bad Song', 'A', dislike), true)
  assert.equal(isDisliked('Bad Song', 'B', dislike), false)
})

test('isExcluded by key', () => {
  const dislike = emptyDislike()
  assert.equal(isExcluded(song(1), new Set(['sid:kw__1']), dislike), true)
  assert.equal(isExcluded(song(1), new Set(), dislike), false)
})

test('isExcluded by dislike rules', () => {
  const dislike = emptyDislike()
  dislike.singerNames.add('a')
  assert.equal(isExcluded(song(1), new Set(), dislike), true)
})

test('shuffle is deterministic with stubbed random', () => {
  assert.deepEqual(shuffle([1, 2, 3], () => 0.5), [1, 3, 2])
})

test('shuffle preserves all members', () => {
  const out = shuffle([1, 2, 3, 4, 5])
  assert.deepEqual([...out].sort(), [1, 2, 3, 4, 5])
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-pool.mts`
Expected: FAIL（`ERR_MODULE_NOT_FOUND`，pool.ts 尚不存在）

- [ ] **Step 3: 实现 `src/core/recommend/pool.ts`**

```ts
// 与 dislikeManage.getDislikeInfo() 输出的规则保持一致（均小写），成对规则格式：`歌名@singer`
export const DISLIKE_PAIR_SEPARATOR = '@'

export interface DislikeInfo {
  names: Set<string>
  musicNames: Set<string>
  singerNames: Set<string>
}

export interface TrackLike {
  source?: string | null
  name?: string | null
  singer?: string | null
  meta?: { songId?: string | number | null } | null
}

export const splitSinger = (singer: string): string[] => {
  return singer.split(/、|&|;|；|\/|,|，|\|/).map(name => name.trim()).filter(Boolean)
}

export const trackKey = (track: TrackLike): string => {
  const songId = track.meta?.songId != null ? String(track.meta.songId) : undefined
  if (track.source && songId) return `sid:${track.source}__${songId}`
  return `ns:${String(track.name ?? '').trim().toLowerCase()}__${String(track.singer ?? '').trim().toLowerCase()}`
}

export const isDisliked = (name: string, singer: string, dislike: DislikeInfo): boolean => {
  const trackName = name.trim().toLowerCase()
  if (dislike.musicNames.has(trackName)) return true
  const singers = splitSinger(singer).map(name => name.toLowerCase())
  if (singers.some(name => dislike.singerNames.has(name))) return true
  return singers.some(name => dislike.names.has(`${trackName}${DISLIKE_PAIR_SEPARATOR}${name}`))
}

export const isExcluded = (track: TrackLike, excludeKeys: ReadonlySet<string>, dislike: DislikeInfo): boolean => {
  if (excludeKeys.has(trackKey(track))) return true
  return isDisliked(String(track.name ?? ''), String(track.singer ?? ''), dislike)
}

export const shuffle = <T>(list: readonly T[], random: () => number = Math.random): T[] => {
  const arr = [...list]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
```

设计说明：黑名单"成对规则"走字符串匹配（`isDisliked`），**不走 trackKey**——黑名单条目没有 songId，生成的 `ns:` 键永远匹配不上候选池的 `sid:` 键。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-pool.mts`
Expected: PASS（10 tests）

- [ ] **Step 5: 更新 package.json test 脚本**

`package.json` 第 14 行，old:

```json
    "test": "node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/online-list-press.mts",
```

new（显式列出文件——新测试文件不是 `*.test.*` 命名，目录模式扫不到，且 Windows npm 下 glob 不可靠；Task 2/3/4 会在此逐个追加各自的测试文件）:

```json
    "test": "node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/online-list-press.mts tests/recommend-pool.mts",
```

- [ ] **Step 6: 运行 `npm test` 确认全部通过**

Run: `npm test`
Expected: PASS（online-list-press + recommend-pool）

- [ ] **Step 7: 提交（内层仓库，只加指定文件）**

```bash
git add src/core/recommend/pool.ts tests/recommend-pool.mts package.json
git commit -m "Add recommend track pool helpers with tests"
```

---

### Task 2: 听歌画像构建 profile.ts + 测试

**Files:**
- Create: `src/core/recommend/profile.ts`
- Test: `tests/recommend-profile.mts`

**Interfaces:**
- Consumes: 无（零导入）
- Produces:
  - `interface ProfileArtist { name: string, count: number }`
  - `interface ProfileSeedSong { name: string, singer: string }`
  - `interface Profile { artists: ProfileArtist[], seedSongs: ProfileSeedSong[] }`
  - `buildProfile(history: readonly ProfileSong[], love: readonly ProfileSong[]): Profile`（history 需按"最新在前"传入，见 `getPlayHistory()` 的返回顺序）

- [ ] **Step 1: 写失败测试 `tests/recommend-profile.mts`**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildProfile } from '../src/core/recommend/profile.ts'

const song = (name: string, singer: string | null) => ({ name, singer })

test('merges artists from history and love, sorted by count desc', () => {
  const profile = buildProfile(
    [song('h1', 'A'), song('h2', 'B'), song('h3', 'A')],
    [song('l1', 'C')],
  )
  assert.deepEqual(profile.artists.map(a => a.name), ['A', 'B', 'C'])
  assert.deepEqual(profile.artists.map(a => a.count), [2, 1, 1])
})

test('seedSongs take the most recent song of the top 5 artists', () => {
  // history 最新在前：A 出现两次，取最近一首 a1b
  const history = [
    song('a6', 'F'),
    song('a5', 'E'),
    song('a4', 'D'),
    song('a3', 'C'),
    song('a2', 'B'),
    song('a1b', 'A'),
    song('a1', 'A'),
  ]
  const profile = buildProfile(history, [])
  assert.deepEqual(profile.seedSongs, [
    { name: 'a1b', singer: 'A' },
    { name: 'a6', singer: 'F' },
    { name: 'a5', singer: 'E' },
    { name: 'a4', singer: 'D' },
    { name: 'a3', singer: 'C' },
  ])
})

test('empty input yields empty profile', () => {
  assert.deepEqual(buildProfile([], []), { artists: [], seedSongs: [] })
})

test('entries without singer are ignored', () => {
  const profile = buildProfile([song('x', ''), song('y', null)], [])
  assert.deepEqual(profile, { artists: [], seedSongs: [] })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-profile.mts`
Expected: FAIL（`ERR_MODULE_NOT_FOUND`）

- [ ] **Step 3: 实现 `src/core/recommend/profile.ts`**

```ts
export interface ProfileArtist { name: string, count: number }
export interface ProfileSeedSong { name: string, singer: string }
export interface Profile { artists: ProfileArtist[], seedSongs: ProfileSeedSong[] }

type ProfileSong = {
  name?: string | null
  singer?: string | null
}

export const buildProfile = (
  history: readonly ProfileSong[],
  love: readonly ProfileSong[],
): Profile => {
  const counts = new Map<string, number>()
  // 每个歌手第一次遇到的歌 = history（最新在前）里该歌手最近的一首
  const firstSong = new Map<string, ProfileSong>()

  const track = (song: ProfileSong) => {
    const singer = String(song.singer ?? '').trim()
    if (!singer) return
    counts.set(singer, (counts.get(singer) ?? 0) + 1)
    if (!firstSong.has(singer)) firstSong.set(singer, song)
  }

  for (const song of history) track(song)
  for (const song of love) track(song)

  // Map 保持插入序，同为 1 次的歌手按首次出现顺序稳定排列
  const artists = Array.from(counts.entries(), ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  const seedSongs: ProfileSeedSong[] = []
  for (const artist of artists) {
    if (seedSongs.length >= 5) break
    const song = firstSong.get(artist.name)
    if (!song) continue
    const songName = String(song.name ?? '').trim()
    if (!songName) continue
    seedSongs.push({ name: songName, singer: artist.name })
  }

  return { artists, seedSongs }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-profile.mts`
Expected: PASS（4 tests）

- [ ] **Step 5: 追加到 package.json test 脚本**

把 `test` 脚本值的尾部改为：

```json
    "test": "node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/online-list-press.mts tests/recommend-pool.mts tests/recommend-profile.mts",
```

- [ ] **Step 6: 提交**

```bash
git add src/core/recommend/profile.ts tests/recommend-profile.mts package.json
git commit -m "Add local listening profile builder"
```

---

### Task 3: 个性电台池 radio.ts + 测试

**Files:**
- Create: `src/core/recommend/radio.ts`
- Test: `tests/recommend-radio.mts`

**Interfaces:**
- Consumes: pool.ts 的 `isExcluded` / `trackKey` / `shuffle` / `DislikeInfo`（显式 `.ts` 扩展名导入）；profile.ts 的 `Profile` / `ProfileSeedSong` 类型
- Produces:
  - `RADIO_QUEUE_SIZE = 50`、`RADIO_APPEND_SIZE = 30`
  - `interface RadioDeps { fetchArtistSongs: (artist: string) => Promise<LX.Music.MusicInfo[]>, fetchSeedPlaylistSongs: (seed: ProfileSeedSong) => Promise<LX.Music.MusicInfo[]> }`
  - `buildRadioPool(profile: Profile, excludeKeys: ReadonlySet<string>, dislike: DislikeInfo, deps: RadioDeps, artistOffset?: number): Promise<LX.Music.MusicInfo[]>`
  - `interface RadioSession { first(): Promise<LX.Music.MusicInfo[]>, next(): Promise<LX.Music.MusicInfo[]> }`
  - `createRadioSession(profile, excludeKeys, dislike, deps): RadioSession`

- [ ] **Step 1: 写失败测试 `tests/recommend-radio.mts`**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRadioPool, createRadioSession, RADIO_APPEND_SIZE, RADIO_QUEUE_SIZE } from '../src/core/recommend/radio.ts'
import type { RadioDeps } from '../src/core/recommend/radio.ts'
import type { DislikeInfo } from '../src/core/recommend/pool.ts'

const emptyDislike = (): DislikeInfo => ({
  names: new Set(),
  musicNames: new Set(),
  singerNames: new Set(),
})

const song = (id: number, singer = 'A', name = `song${id}`) =>
  ({ id: `kw_${id}`, source: 'kw', name, singer, meta: { songId: id } }) as any

const makeProfile = (artists: Array<[string, number]>, seeds: Array<[string, string]> = []) => ({
  artists: artists.map(([name, count]) => ({ name, count })),
  seedSongs: seeds.map(([name, singer]) => ({ name, singer })),
})

const makeDeps = (
  artistSongs: (artist: string) => any[],
  seedSongs: (seed: unknown) => any[] = () => [],
): RadioDeps => ({
  fetchArtistSongs: async(artist: string) => artistSongs(artist),
  fetchSeedPlaylistSongs: async(seed: unknown) => seedSongs(seed),
})

test('buildRadioPool merges, dedupes and excludes', async() => {
  const profile = makeProfile([['A', 2]], [['songA', 'A']])
  const deps = makeDeps(
    () => [song(1), song(2)],
    () => [song(2), song(3)],
  )
  const pool = await buildRadioPool(profile, new Set(['sid:kw__1']), emptyDislike(), deps)
  assert.deepEqual(pool.map(m => m.id).sort(), ['kw_2', 'kw_3'])
})

test('buildRadioPool filters disliked singers', async() => {
  const dislike = emptyDislike()
  dislike.singerNames.add('bad')
  const deps = makeDeps(() => [song(1, 'Good'), song(2, 'Bad/Singer')])
  const pool = await buildRadioPool(makeProfile([['A', 1]]), new Set(), dislike, deps)
  assert.deepEqual(pool.map(m => m.id), ['kw_1'])
})

test('strong artists (count >= 2) take priority', async() => {
  const profile = makeProfile([['A', 3], ['B', 1], ['C', 2], ['D', 1], ['E', 5], ['F', 1]])
  const fetched: string[] = []
  const deps = makeDeps((artist) => { fetched.push(artist); return [song(fetched.length)] })
  await buildRadioPool(profile, new Set(), emptyDislike(), deps)
  assert.deepEqual(fetched, ['A', 'C', 'E'])
})

test('all fetch failures yield empty pool', async() => {
  const deps: RadioDeps = {
    fetchArtistSongs: async() => { throw new Error('fail') },
    fetchSeedPlaylistSongs: async() => { throw new Error('fail') },
  }
  const pool = await buildRadioPool(makeProfile([['A', 1]], [['x', 'A']]), new Set(), emptyDislike(), deps)
  assert.deepEqual(pool, [])
})

test('empty profile yields empty pool', async() => {
  const deps = makeDeps(() => [song(1)])
  const pool = await buildRadioPool(makeProfile([]), new Set(), emptyDislike(), deps)
  assert.deepEqual(pool, [])
})

test('radio session drains 120 songs across batches then ends', async() => {
  let nextId = 0
  const deps = makeDeps(() => {
    const list: any[] = []
    for (let i = 0; i < 20; i++) list.push(song(++nextId))
    return list
  })
  // 6 个歌手各 20 首；首批取前 5 个歌手(100 首)，备份 50；F 留给 offset 窗口
  const profile = makeProfile([['A', 1], ['B', 1], ['C', 1], ['D', 1], ['E', 1], ['F', 1]])
  const session = createRadioSession(profile, new Set(), emptyDislike(), deps)

  assert.deepEqual(await session.next(), []) // first 之前 next 恒为空

  const all = [...await session.first()]
  assert.equal(all.length, RADIO_QUEUE_SIZE)

  const batchSizes: number[] = []
  const collect = async() => {
    const batch = await session.next()
    batchSizes.push(batch.length)
    all.push(...batch)
  }
  await collect() // 备份 50 → 取 30
  await collect() // 备份 20 → 取 20
  await collect() // 备份空 → offset=5 取 F 的 20 首
  assert.deepEqual(batchSizes, [RADIO_APPEND_SIZE, 20, 20])
  assert.equal(new Set(all.map(m => m.id)).size, 120)
  assert.deepEqual(await session.next(), []) // offset=10 ≥ 歌手数 → 结束
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-radio.mts`
Expected: FAIL（`ERR_MODULE_NOT_FOUND`）

- [ ] **Step 3: 实现 `src/core/recommend/radio.ts`**

```ts
import { isExcluded, shuffle, trackKey } from './pool.ts'
import type { DislikeInfo } from './pool.ts'
import type { Profile, ProfileSeedSong } from './profile.ts'

export const RADIO_QUEUE_SIZE = 50
export const RADIO_APPEND_SIZE = 30

export interface RadioDeps {
  fetchArtistSongs: (artist: string) => Promise<LX.Music.MusicInfo[]>
  fetchSeedPlaylistSongs: (seed: ProfileSeedSong) => Promise<LX.Music.MusicInfo[]>
}

export const buildRadioPool = async(
  profile: Profile,
  excludeKeys: ReadonlySet<string>,
  dislike: DislikeInfo,
  deps: RadioDeps,
  artistOffset = 0,
): Promise<LX.Music.MusicInfo[]> => {
  const strong = profile.artists.filter(artist => artist.count >= 2)
  const base = strong.length ? strong : profile.artists
  const topArtists = base.slice(artistOffset, artistOffset + 5)
  if (!topArtists.length) return []

  const tasks: Array<Promise<LX.Music.MusicInfo[]>> = topArtists.map(
    artist => deps.fetchArtistSongs(artist.name).catch(() => []),
  )
  // 歌单种子只在首轮取，续批重取只会得到重复歌曲
  if (artistOffset == 0) {
    for (const seed of profile.seedSongs.slice(0, 3)) {
      tasks.push(deps.fetchSeedPlaylistSongs(seed).catch(() => []))
    }
  }

  const seen = new Set(excludeKeys)
  const pool: LX.Music.MusicInfo[] = []
  for (const list of await Promise.all(tasks)) {
    for (const musicInfo of list) {
      if (!musicInfo.name) continue
      if (isExcluded(musicInfo, seen, dislike)) continue
      seen.add(trackKey(musicInfo))
      pool.push(musicInfo)
    }
  }
  return shuffle(pool)
}

export interface RadioSession {
  first: () => Promise<LX.Music.MusicInfo[]>
  next: () => Promise<LX.Music.MusicInfo[]>
}

export const createRadioSession = (
  profile: Profile,
  excludeKeys: ReadonlySet<string>,
  dislike: DislikeInfo,
  deps: RadioDeps,
): RadioSession => {
  const keys = new Set(excludeKeys)
  let backup: LX.Music.MusicInfo[] = []
  let artistOffset = 0
  let started = false

  const take = (batch: LX.Music.MusicInfo[], size: number) => {
    const out = batch.splice(0, size)
    for (const musicInfo of out) keys.add(trackKey(musicInfo))
    return out
  }

  return {
    async first() {
      started = true
      const pool = await buildRadioPool(profile, keys, dislike, deps, artistOffset)
      if (!pool.length) return []
      backup = pool.slice(RADIO_QUEUE_SIZE)
      return take(pool, RADIO_QUEUE_SIZE)
    },
    async next() {
      if (!started) return []
      if (backup.length) return take(backup, RADIO_APPEND_SIZE)
      artistOffset += 5
      if (artistOffset >= profile.artists.length) return []
      const pool = await buildRadioPool(profile, keys, dislike, deps, artistOffset)
      if (!pool.length) return []
      backup = pool.slice(RADIO_APPEND_SIZE)
      return take(pool, RADIO_APPEND_SIZE)
    },
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-radio.mts`
Expected: PASS（6 tests）

- [ ] **Step 5: 追加到 package.json test 脚本**

把 `test` 脚本值的尾部改为：

```json
    "test": "node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/online-list-press.mts tests/recommend-pool.mts tests/recommend-profile.mts tests/recommend-radio.mts",
```

- [ ] **Step 6: 提交**

```bash
git add src/core/recommend/radio.ts tests/recommend-radio.mts package.json
git commit -m "Add personal radio pool session"
```

---

### Task 4: 探索未知池 explore.ts + 测试

**Files:**
- Create: `src/core/recommend/explore.ts`
- Test: `tests/recommend-explore.mts`

**Interfaces:**
- Consumes: pool.ts 的 `isExcluded` / `shuffle` / `splitSinger` / `trackKey` / `DislikeInfo`（显式 `.ts` 扩展名导入）
- Produces:
  - `EXPLORE_QUEUE_SIZE = 50`、`EXPLORE_APPEND_SIZE = 30`、`EXPLORE_MAX_DRAWS = 3`
  - `interface ExploreTag { id: string, name: string }`、`interface ExplorePlaylist { id: string, playCount: number }`
  - `interface ExploreDeps { fetchTags: () => Promise<ExploreTag[]>, fetchTagPlaylists: (tagId: string) => Promise<ExplorePlaylist[]>, fetchPlaylistSongs: (playlistId: string) => Promise<LX.Music.MusicInfo[]>, fetchFallbackSongs: () => Promise<LX.Music.MusicInfo[]> }`
  - `interface ExploreBatch { songs: LX.Music.MusicInfo[], tagName: string | null }`
  - `isProfileArtist(singer: string, artistNames: ReadonlySet<string>): boolean`
  - `filterExploreSongs(songs, artistNames, excludeKeys, dislike): LX.Music.MusicInfo[]`
  - `buildExplorePool(artistNames, excludeKeys, dislike, deps, random?): Promise<ExploreBatch>`
  - `interface ExploreSession { first(): Promise<ExploreBatch>, next(): Promise<ExploreBatch | null> }`
  - `createExploreSession(artistNames, excludeKeys, dislike, deps, random?): ExploreSession`

- [ ] **Step 1: 写失败测试 `tests/recommend-explore.mts`**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildExplorePool,
  createExploreSession,
  EXPLORE_APPEND_SIZE,
  EXPLORE_QUEUE_SIZE,
  filterExploreSongs,
  isProfileArtist,
} from '../src/core/recommend/explore.ts'
import type { ExploreDeps } from '../src/core/recommend/explore.ts'
import type { DislikeInfo } from '../src/core/recommend/pool.ts'

const emptyDislike = (): DislikeInfo => ({
  names: new Set(),
  musicNames: new Set(),
  singerNames: new Set(),
})

const song = (id: number, singer = 'A', name = `song${id}`) =>
  ({ id: `kw_${id}`, source: 'kw', name, singer, meta: { songId: id } }) as any

test('isProfileArtist matches any singer token', () => {
  assert.equal(isProfileArtist('Zhang San/Li Si', new Set(['zhang san'])), true)
  assert.equal(isProfileArtist('Li Si', new Set(['zhang san'])), false)
})

test('filterExploreSongs drops profile artists and excluded keys', () => {
  const songs = [song(1, 'A'), song(2, 'B'), song(3, 'B')]
  const out = filterExploreSongs(songs, new Set(['a']), new Set(['sid:kw__3']), emptyDislike())
  assert.deepEqual(out.map(m => m.id), ['kw_2'])
})

test('retries other tags when a draw fails', async() => {
  const randoms = [0, 0.5] // 第一次抽 t1(失败)，第二次抽 t2(成功)
  const random = () => randoms.shift() ?? 0
  const tags = [{ id: 't1', name: '流行' }, { id: 't2', name: '民谣' }]
  let fallbackCalled = false
  const deps: ExploreDeps = {
    fetchTags: async() => tags,
    fetchTagPlaylists: async(tagId: string) => {
      if (tagId == 't1') throw new Error('fail')
      return [{ id: 'p1', playCount: 10 }]
    },
    fetchPlaylistSongs: async() => [song(1, 'B'), song(2, 'B')],
    fetchFallbackSongs: async() => { fallbackCalled = true; return [] },
  }
  const { songs, tagName } = await buildExplorePool(new Set(), new Set(), emptyDislike(), deps, random)
  assert.equal(tagName, '民谣')
  assert.deepEqual(songs.map(m => m.id).sort(), ['kw_1', 'kw_2'])
  assert.equal(fallbackCalled, false)
})

test('falls back to hot songs when tags fetch fails', async() => {
  const deps: ExploreDeps = {
    fetchTags: async() => { throw new Error('fail') },
    fetchTagPlaylists: async() => [],
    fetchPlaylistSongs: async() => [],
    fetchFallbackSongs: async() => [song(1), song(2)],
  }
  const { songs, tagName } = await buildExplorePool(new Set(), new Set(), emptyDislike(), deps)
  assert.equal(tagName, null)
  assert.equal(songs.length, 2)
})

test('returns empty batch when everything fails', async() => {
  const deps: ExploreDeps = {
    fetchTags: async() => { throw new Error('fail') },
    fetchTagPlaylists: async() => [],
    fetchPlaylistSongs: async() => [],
    fetchFallbackSongs: async() => { throw new Error('fail') },
  }
  const { songs, tagName } = await buildExplorePool(new Set(), new Set(), emptyDislike(), deps)
  assert.deepEqual(songs, [])
  assert.equal(tagName, null)
})

test('explore session drains 80 songs then ends', async() => {
  const deps: ExploreDeps = {
    fetchTags: async() => [{ id: 't1', name: '标签' }],
    fetchTagPlaylists: async() => [{ id: 'p1', playCount: 1 }],
    fetchPlaylistSongs: async() => {
      const list: any[] = []
      for (let i = 1; i <= 80; i++) list.push(song(i, 'B'))
      return list
    },
    fetchFallbackSongs: async() => [],
  }
  const session = createExploreSession(new Set(), new Set(), emptyDislike(), deps)
  const first = await session.first()
  assert.equal(first.songs.length, EXPLORE_QUEUE_SIZE)
  assert.equal(first.tagName, '标签')
  const second = await session.next()
  assert.equal(second?.songs.length ?? 0, EXPLORE_APPEND_SIZE)
  assert.equal(second?.tagName ?? null, null)
  // 备份耗尽后重抽：stub 每次返回同一批 80 首，全部已被记录 → 过滤后为空 → 会话结束
  assert.equal(await session.next(), null)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-explore.mts`
Expected: FAIL（`ERR_MODULE_NOT_FOUND`）

- [ ] **Step 3: 实现 `src/core/recommend/explore.ts`**

```ts
import { isExcluded, shuffle, splitSinger, trackKey } from './pool.ts'
import type { DislikeInfo } from './pool.ts'

export const EXPLORE_QUEUE_SIZE = 50
export const EXPLORE_APPEND_SIZE = 30
export const EXPLORE_MAX_DRAWS = 3

export interface ExploreTag { id: string, name: string }
export interface ExplorePlaylist { id: string, playCount: number }

export interface ExploreDeps {
  fetchTags: () => Promise<ExploreTag[]>
  fetchTagPlaylists: (tagId: string) => Promise<ExplorePlaylist[]>
  fetchPlaylistSongs: (playlistId: string) => Promise<LX.Music.MusicInfo[]>
  fetchFallbackSongs: () => Promise<LX.Music.MusicInfo[]>
}

export interface ExploreBatch { songs: LX.Music.MusicInfo[], tagName: string | null }

export const isProfileArtist = (singer: string, artistNames: ReadonlySet<string>): boolean => {
  return splitSinger(singer).some(name => artistNames.has(name.toLowerCase()))
}

export const filterExploreSongs = (
  songs: readonly LX.Music.MusicInfo[],
  artistNames: ReadonlySet<string>,
  excludeKeys: ReadonlySet<string>,
  dislike: DislikeInfo,
): LX.Music.MusicInfo[] => {
  return songs.filter(musicInfo => musicInfo.name
    && !isProfileArtist(String(musicInfo.singer ?? ''), artistNames)
    && !isExcluded(musicInfo, excludeKeys, dislike))
}

export const buildExplorePool = async(
  artistNames: ReadonlySet<string>,
  excludeKeys: ReadonlySet<string>,
  dislike: DislikeInfo,
  deps: ExploreDeps,
  random: () => number = Math.random,
): Promise<ExploreBatch> => {
  let tags: ExploreTag[] | null = null
  try {
    tags = await deps.fetchTags()
  } catch { tags = null }

  if (tags?.length) {
    for (let draw = 0; draw < EXPLORE_MAX_DRAWS; draw++) {
      const tag = tags[Math.floor(random() * tags.length)]
      try {
        const playlists = await deps.fetchTagPlaylists(tag.id)
        const top = [...playlists].sort((a, b) => b.playCount - a.playCount)[0]
        if (!top) continue
        const songs = await deps.fetchPlaylistSongs(top.id)
        const pool = filterExploreSongs(songs, artistNames, excludeKeys, dislike)
        if (pool.length) return { songs: shuffle(pool, random), tagName: tag.name }
      } catch { /* 换一个分类重抽 */ }
    }
  }

  try {
    const pool = filterExploreSongs(await deps.fetchFallbackSongs(), artistNames, excludeKeys, dislike)
    if (pool.length) return { songs: shuffle(pool, random), tagName: null }
  } catch { /* 降级也失败 → 返回空批次，调用方进入 error 态 */ }
  return { songs: [], tagName: null }
}

export interface ExploreSession {
  first: () => Promise<ExploreBatch>
  next: () => Promise<ExploreBatch | null>
}

export const createExploreSession = (
  artistNames: ReadonlySet<string>,
  excludeKeys: ReadonlySet<string>,
  dislike: DislikeInfo,
  deps: ExploreDeps,
  random: () => number = Math.random,
): ExploreSession => {
  const keys = new Set(excludeKeys)
  let backup: LX.Music.MusicInfo[] = []
  let started = false

  return {
    async first() {
      started = true
      const { songs, tagName } = await buildExplorePool(artistNames, keys, dislike, deps, random)
      if (!songs.length) return { songs, tagName }
      backup = songs.slice(EXPLORE_QUEUE_SIZE)
      const queue = songs.slice(0, EXPLORE_QUEUE_SIZE)
      for (const musicInfo of queue) keys.add(trackKey(musicInfo))
      return { songs: queue, tagName }
    },
    async next() {
      if (!started) return null
      if (backup.length) {
        const out = backup.splice(0, EXPLORE_APPEND_SIZE)
        for (const musicInfo of out) keys.add(trackKey(musicInfo))
        return { songs: out, tagName: null }
      }
      const { songs, tagName } = await buildExplorePool(artistNames, keys, dislike, deps, random)
      if (!songs.length) return null
      backup = songs.slice(EXPLORE_APPEND_SIZE)
      const out = songs.slice(0, EXPLORE_APPEND_SIZE)
      for (const musicInfo of out) keys.add(trackKey(musicInfo))
      return { songs: out, tagName }
    },
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-explore.mts`
Expected: PASS（6 tests）

- [ ] **Step 5: 追加到 package.json test 脚本**

把 `test` 脚本值的尾部改为（即 Task 1 所述最终形态）:

```json
    "test": "node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/online-list-press.mts tests/recommend-pool.mts tests/recommend-profile.mts tests/recommend-radio.mts tests/recommend-explore.mts",
```

- [ ] **Step 6: 运行全量 `npm test`**

Run: `npm test`
Expected: PASS（online-list-press + recommend-pool/profile/radio/explore 全部通过）

- [ ] **Step 7: 提交**

```bash
git add src/core/recommend/explore.ts tests/recommend-explore.mts package.json
git commit -m "Add explore pool session"
```

---

### Task 5: wiring 层 play.ts（对接 musicSdk / 播放内核 / 本地数据）

**Files:**
- Create: `src/core/recommend/play.ts`

**Interfaces:**
- Consumes: Task 1-4 的全部导出；`@/utils/musicSdk`（默认导出，按源取 `musicSearch.search(text, page, limit)` 与 `songList.search(text, page, limit)`）；`@/utils` 的**具名导出** `toNewMusicInfo`（musicSearch 返回旧格式需转换；songlist core 的 `getListDetail` 已返回新格式，**不要**二次转换）；`@/config/constant` 的 `LIST_IDS`（`LOVE: 'love'`、`PLAY_LATER: null`）；`@/utils/data` 的 `getPlayHistory()`（最新在前）/`getSongListSetting()`；`@/utils/dislikeManage` 的 `getDislikeInfo()`；`@/store/list/state` 默认导出（`allMusicList: Map<string, LX.Music.MusicInfo[]>`）；`@/store/player/state` 默认导出（`playMusicInfo.musicInfo` / `playMusicInfo.isTempPlay`）；`@/core/player/tempPlayList` 的 `addTempPlayList(items: LX.Player.TempPlayListItem[])`（队列空闲时自动 playNext）；`@/core/player/player` 的 `playNext()`；`@/core/songlist` 的 `getSortList(source)` / `getTags(source)` / `getList(source, tabId, sortId, page)` / `getListDetail(id, source, page)`（**id 在前**）/ `getListDetailAll(source, id)`（**source 在前**）；`@/core/leaderboard` 的 `getBoardsList(source)` / `getListDetail(id, page)`（id 为 `{source}__{bangId}` 组合键，30 首/页）。
- Produces（UI 任务依赖）:
  - `interface RadioSummary { artistNames: string[], artistCount: number }`
  - `startPersonalRadio(): Promise<RadioSummary>`（构建并立即入队首批 50 首）
  - `continuePersonalRadio(): Promise<number>`（返回追加数量；会话耗尽/失败/非临时播放时返回 0）
  - `interface ExploreSummary { tagName: string | null }`
  - `startExploreRadio(): Promise<ExploreSummary>`
  - `continueExploreRadio(): Promise<number>`

- [ ] **Step 1: 实现 `src/core/recommend/play.ts`**

注意：本文件相对导入**不带扩展名**（Metro 惯例），且本文件不做单元测试。

```ts
import musicSdk from '@/utils/musicSdk'
import { toNewMusicInfo } from '@/utils'
import { LIST_IDS } from '@/config/constant'
import { getPlayHistory, getSongListSetting } from '@/utils/data'
import { getDislikeInfo } from '@/utils/dislikeManage'
import listState from '@/store/list/state'
import playerState from '@/store/player/state'
import { addTempPlayList } from '@/core/player/tempPlayList'
import { playNext } from '@/core/player/player'
import { getList, getListDetail, getListDetailAll, getSortList, getTags } from '@/core/songlist'
import { getBoardsList, getListDetail as getBoardListDetail } from '@/core/leaderboard'
import { shuffle, trackKey } from './pool'
import { buildProfile } from './profile'
import { createRadioSession } from './radio'
import { createExploreSession } from './explore'
import type { DislikeInfo } from './pool'
import type { Profile } from './profile'
import type { RadioDeps, RadioSession } from './radio'
import type { ExploreDeps, ExploreSession } from './explore'

const BUILD_TIMEOUT = 10000

const withTimeout = async<T>(task: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new Error('recommend build timeout')) }, BUILD_TIMEOUT)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const getSource = async(): Promise<LX.OnlineSource> => {
  return (await getSongListSetting()).source as LX.OnlineSource
}

const getLoveList = (): LX.Music.MusicInfo[] => {
  return listState.allMusicList.get(LIST_IDS.LOVE) ?? []
}

const loadRecommendData = async() => {
  const [history, dislike] = await Promise.all([getPlayHistory(), getDislikeInfo()])
  const love = getLoveList()
  const excludeKeys = new Set<string>()
  for (const item of history) excludeKeys.add(trackKey(item.musicInfo))
  for (const musicInfo of love) excludeKeys.add(trackKey(musicInfo))
  const profile = buildProfile(history.map(item => item.musicInfo), love)
  return {
    profile,
    excludeKeys,
    dislike: {
      names: dislike.names,
      musicNames: dislike.musicNames,
      singerNames: dislike.singerNames,
    } as DislikeInfo,
  }
}

const toPlayCount = (raw: unknown): number => {
  if (raw == null) return 0
  if (typeof raw === 'number') return raw
  const text = String(raw)
  const wan = text.match(/([\d.]+)\s*万/)
  if (wan) return Math.round(parseFloat(wan[1]) * 10000)
  const yi = text.match(/([\d.]+)\s*亿/)
  if (yi) return Math.round(parseFloat(yi[1]) * 1e8)
  const num = parseFloat(text)
  return Number.isNaN(num) ? 0 : num
}

const enqueueBatch = (songs: LX.Music.MusicInfo[], isTop: boolean) => {
  if (!songs.length) throw new Error('recommend batch is empty')
  const isPlaying = !!playerState.playMusicInfo.musicInfo
  addTempPlayList(songs.map(musicInfo => ({
    listId: LIST_IDS.PLAY_LATER,
    musicInfo,
    isTop,
  })))
  if (isPlaying) void playNext()
}

const fetchBoardFallbackSongs = async(source: LX.OnlineSource) => {
  const boards = await getBoardsList(source)
  const board = boards[0]
  if (!board) throw new Error('no board available')
  const pages = await Promise.all([1, 2].map(page =>
    getBoardListDetail(board.id, page).catch(() => null),
  ))
  const songs = pages.flatMap(page => page?.list ?? [])
  if (!songs.length) throw new Error('board fallback is empty')
  return shuffle(songs).slice(0, 50)
}

const createRadioDeps = (source: LX.OnlineSource): RadioDeps => {
  const sdk = musicSdk[source]
  if (!sdk) throw new Error(`source ${source} is unavailable`)
  return {
    async fetchArtistSongs(artist) {
      const result = await sdk.musicSearch.search(artist, 1, 20)
      return result.list.map(toNewMusicInfo)
    },
    async fetchSeedPlaylistSongs(seed) {
      const result = await sdk.songList.search(seed.name, 1, 2)
      const lists = await Promise.all(result.list.slice(0, 2).map(list =>
        getListDetail(list.id, source, 1).catch(() => null),
      ))
      return lists.flatMap(list => list?.list ?? [])
    },
  }
}

export interface RadioSummary { artistNames: string[], artistCount: number }

let radioSession: RadioSession | null = null

export const startPersonalRadio = async(): Promise<RadioSummary> => {
  const source = await getSource()
  const { radio, songs, profile } = await withTimeout((async() => {
    const { profile, excludeKeys, dislike } = await loadRecommendData()
    if (!profile.artists.length) throw new Error('no play profile')
    const radio = createRadioSession(profile, excludeKeys, dislike, createRadioDeps(source))
    const songs = await radio.first()
    return { radio, songs, profile }
  })())
  let queue = songs
  if (!queue.length) queue = await fetchBoardFallbackSongs(source)
  enqueueBatch(queue, true)
  radioSession = radio
  return {
    artistNames: profile.artists.slice(0, 3).map(artist => artist.name),
    artistCount: profile.artists.length,
  }
}

export const continuePersonalRadio = async(): Promise<number> => {
  const session = radioSession
  if (!session) return 0
  // 用户已切去播放其它音乐时，电台停止自动续批
  if (!playerState.playMusicInfo.isTempPlay) return 0
  try {
    const songs = await session.next()
    if (!songs.length) {
      radioSession = null
      return 0
    }
    enqueueBatch(songs, false)
    return songs.length
  } catch {
    return 0
  }
}

const createExploreDeps = (source: LX.OnlineSource): ExploreDeps => {
  const getSortId = () => getSortList(source)[0]?.id ?? ''
  return {
    async fetchTags() {
      const info = await getTags(source)
      return [
        ...info.hotTag.map(tag => ({ id: tag.id, name: tag.name })),
        ...info.tags.flatMap(group => group.list.map(tag => ({ id: tag.id, name: tag.name }))),
      ]
    },
    async fetchTagPlaylists(tagId) {
      const first = await getList(source, tagId, getSortId(), 1)
      const page = 1 + Math.floor(Math.random() * Math.min(first.maxPage, 5))
      const info = page == 1 ? first : await getList(source, tagId, getSortId(), page)
      return info.list.map(list => ({ id: list.id, playCount: toPlayCount(list.play_count) }))
    },
    async fetchPlaylistSongs(playlistId) {
      return getListDetailAll(source, playlistId)
    },
    async fetchFallbackSongs() {
      const info = await getList(source, '', getSortId(), 1 + Math.floor(Math.random() * 5))
      const top = [...info.list].sort((a, b) => toPlayCount(b.play_count) - toPlayCount(a.play_count))[0]
      if (!top) throw new Error('no fallback playlist')
      return getListDetailAll(source, top.id)
    },
  }
}

export interface ExploreSummary { tagName: string | null }

let exploreSession: ExploreSession | null = null

export const startExploreRadio = async(): Promise<ExploreSummary> => {
  const source = await getSource()
  const { explore, songs, tagName } = await withTimeout((async() => {
    const { profile, excludeKeys, dislike } = await loadRecommendData()
    const artistNames = new Set(profile.artists.map(artist => artist.name.toLowerCase()))
    const explore = createExploreSession(artistNames, excludeKeys, dislike, createExploreDeps(source))
    const batch = await explore.first()
    return { explore, songs: batch.songs, tagName: batch.tagName }
  })())
  if (!songs.length) throw new Error('explore pool is empty')
  enqueueBatch(songs, true)
  exploreSession = explore
  return { tagName }
}

export const continueExploreRadio = async(): Promise<number> => {
  const session = exploreSession
  if (!session) return 0
  if (!playerState.playMusicInfo.isTempPlay) return 0
  try {
    const batch = await session.next()
    if (!batch || !batch.songs.length) {
      exploreSession = null
      return 0
    }
    enqueueBatch(batch.songs, false)
    return batch.songs.length
  } catch {
    return 0
  }
}
```

- [ ] **Step 2: eslint 检查新文件**

Run: `npx eslint src/core/recommend/play.ts`
Expected: 无 error（warning 需逐条评估）

- [ ] **Step 3: 确认 recommend 目录整体 lint 干净**

Run: `npx eslint src/core/recommend`
Expected: 无 error

- [ ] **Step 4: 提交**

```bash
git add src/core/recommend/play.ts
git commit -m "Wire recommend modules to music sdk and player"
```

---

### Task 6: 推荐 UI + Discover tab 集成 + 三语文案

**Files:**
- Create: `src/screens/Home/Views/Recommend/index.tsx`
- Modify: `src/screens/Home/Views/Discover/index.tsx`（5 处编辑，见下）
- Modify: `src/lang/zh-cn.json`、`src/lang/zh-tw.json`、`src/lang/en-us.json`

**Interfaces:**
- Consumes: `startPersonalRadio/continuePersonalRadio/RadioSummary`、`startExploreRadio/continueExploreRadio/ExploreSummary`（Task 5）；`useTempPlayList()`（`@/store/player/hook`，返回临时播放队列数组）；`useTheme()`；`useI18n()` 的 `t(key, val?)`（`{name}`/`{artists}`/`{count}` 占位符插值已支持）；`createStyle`（`@/utils/tools`）
- Produces: `src/screens/Home/Views/Recommend` 默认导出组件（Discover 引用）

- [ ] **Step 1: 实现 `src/screens/Home/Views/Recommend/index.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'

import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useTempPlayList } from '@/store/player/hook'
import { useI18n } from '@/lang'
import {
  continueExploreRadio,
  continuePersonalRadio,
  startExploreRadio,
  startPersonalRadio,
} from '@/core/recommend/play'
import { createStyle } from '@/utils/tools'

type CardStatus = 'idle' | 'loading' | 'playing' | 'error'

const CONTINUE_THRESHOLD = 2

const Recommend = () => {
  const theme = useTheme()
  const t = useI18n()
  const tempPlayList = useTempPlayList()
  const [radioStatus, setRadioStatus] = useState<CardStatus>('idle')
  const [radioSummary, setRadioSummary] = useState('')
  const [exploreStatus, setExploreStatus] = useState<CardStatus>('idle')
  const [exploreSummary, setExploreSummary] = useState('')
  // 电台与探索共用一个续批单飞锁，避免同一次队列变化触发两路并发续批
  const continuingRef = useRef<'radio' | 'explore' | null>(null)

  const handleStartRadio = useCallback(async() => {
    setRadioStatus('loading')
    setRadioSummary('')
    try {
      const { artistNames, artistCount } = await startPersonalRadio()
      setRadioSummary(artistCount
        ? t('recommend_radio_playing', { artists: artistNames.join('、'), count: artistCount })
        : t('recommend_radio_desc'))
      setRadioStatus('playing')
    } catch {
      setRadioStatus('error')
    }
  }, [t])

  const handleStartExplore = useCallback(async() => {
    setExploreStatus('loading')
    setExploreSummary('')
    try {
      const { tagName } = await startExploreRadio()
      setExploreSummary(tagName
        ? t('recommend_explore_playing', { name: tagName })
        : t('recommend_explore_desc'))
      setExploreStatus('playing')
    } catch {
      setExploreStatus('error')
    }
  }, [t])

  useEffect(() => {
    if (radioStatus != 'playing' || tempPlayList.length > CONTINUE_THRESHOLD) return
    if (continuingRef.current) return
    continuingRef.current = 'radio'
    void continuePersonalRadio().finally(() => { continuingRef.current = null })
  }, [radioStatus, tempPlayList])

  useEffect(() => {
    if (exploreStatus != 'playing' || tempPlayList.length > CONTINUE_THRESHOLD) return
    if (continuingRef.current) return
    continuingRef.current = 'explore'
    void continueExploreRadio().finally(() => { continuingRef.current = null })
  }, [exploreStatus, tempPlayList])

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity
        style={{ ...styles.card, backgroundColor: theme['c-primary-background-active'] }}
        activeOpacity={0.85}
        onPress={handleStartRadio}
      >
        <Text size={22} color={theme['c-font']}>{t('recommend_radio_title')}</Text>
        <Text size={13} color={theme['c-font-label']} style={styles.cardDesc}>
          {radioSummary || t('recommend_radio_desc')}
        </Text>
        {
          radioStatus == 'loading' || radioStatus == 'error'
            ? <Text size={12} color={theme['c-font-label']} style={styles.cardStatus}>
                {radioStatus == 'loading' ? t('recommend_radio_loading') : t('recommend_error')}
              </Text>
            : null
        }
      </TouchableOpacity>
      <TouchableOpacity
        style={{ ...styles.card, backgroundColor: theme['c-primary-background-active'] }}
        activeOpacity={0.85}
        onPress={handleStartExplore}
      >
        <Text size={22} color={theme['c-font']}>{t('recommend_explore_title')}</Text>
        <Text size={13} color={theme['c-font-label']} style={styles.cardDesc}>
          {exploreSummary || t('recommend_explore_desc')}
        </Text>
        {
          exploreStatus == 'loading' || exploreStatus == 'error'
            ? <Text size={12} color={theme['c-font-label']} style={styles.cardStatus}>
                {exploreStatus == 'loading' ? t('recommend_explore_loading') : t('recommend_error')}
              </Text>
            : null
        }
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  content: {
    paddingTop: 15,
    paddingHorizontal: 15,
    paddingBottom: 30,
  },
  card: {
    borderRadius: 14,
    padding: 24,
    marginBottom: 15,
    minHeight: 150,
    justifyContent: 'center',
  },
  cardDesc: {
    marginTop: 10,
  },
  cardStatus: {
    marginTop: 6,
  },
})

export default Recommend
```

- [ ] **Step 2: Discover 集成（5 处编辑，行号基于当前文件）**

`src/screens/Home/Views/Discover/index.tsx`：

2a. import 区（第 5 行后）加：

```tsx
import Recommend from '../Recommend'
```

2b. `DISCOVER_TABS`（第 16-19 行）追加 `'recommend'`：

```tsx
const DISCOVER_TABS = [
  'leaderboard',
  'songlist',
  'recommend',
] as const
```

2c. `mountedTabs` 初始值（第 35-38 行）追加：

```tsx
  const [mountedTabs, setMountedTabs] = useState<Record<DiscoverTabId, boolean>>({
    leaderboard: true,
    songlist: lastActiveTabId == 'songlist',
    recommend: lastActiveTabId == 'recommend',
  })
```

2d. 源选择器（第 106-112 行）在推荐 tab 下隐藏：

```tsx
        {
          activeId != 'recommend' && (
            <View style={styles.sourceSelector}>
              <SourceSelector
                ref={sourceSelectorRef}
                fontSize={14}
                onSourceChange={handleSourceChange}
              />
            </View>
          )
        }
```

2e. songlist tabPage 块（第 118-124 行）之后追加 recommend tabPage（沿用 mountedTabs 惰性挂载 + display 切换模式）：

```tsx
        {
          mountedTabs.recommend
            ? <View style={{ ...styles.tabPage, display: activeId == 'recommend' ? 'flex' : 'none' }}>
                <Recommend />
              </View>
            : null
        }
```

tab 文案无需改动：tab 渲染用 `t(\`discover_${id}\`)`，自动命中 `discover_recommend`。`ROOT_DISCOVER_TAB` 保持 `'leaderboard'` 不变。

- [ ] **Step 3: 三语文案**

每个文件先 Grep 确认锚点行（`"discover_songlist": "歌单",` / `"discover_songlist": "歌單",` / `"discover_songlist": "Playlists",`），然后在该行后追加：

`src/lang/zh-cn.json`：

```json
  "discover_recommend": "推荐",
  "recommend_radio_title": "个性电台",
  "recommend_radio_desc": "按你的听歌口味随机播放",
  "recommend_radio_loading": "正在构建电台…",
  "recommend_radio_playing": "基于 {artists} 等 {count} 位歌手",
  "recommend_explore_title": "探索未知",
  "recommend_explore_desc": "发现你不常听的音乐",
  "recommend_explore_loading": "正在探索…",
  "recommend_explore_playing": "正在探索：{name}",
  "recommend_error": "加载失败，点击重试",
```

`src/lang/zh-tw.json`：

```json
  "discover_recommend": "推薦",
  "recommend_radio_title": "個性電台",
  "recommend_radio_desc": "按你的聽歌口味隨機播放",
  "recommend_radio_loading": "正在構建電台…",
  "recommend_radio_playing": "基於 {artists} 等 {count} 位歌手",
  "recommend_explore_title": "探索未知",
  "recommend_explore_desc": "發現你不常聽的音樂",
  "recommend_explore_loading": "正在探索…",
  "recommend_explore_playing": "正在探索：{name}",
  "recommend_error": "加載失敗，點擊重試",
```

`src/lang/en-us.json`：

```json
  "discover_recommend": "Recommend",
  "recommend_radio_title": "Personal Radio",
  "recommend_radio_desc": "Random play based on your taste",
  "recommend_radio_loading": "Building your radio…",
  "recommend_radio_playing": "Based on {count} artists: {artists}",
  "recommend_explore_title": "Explore",
  "recommend_explore_desc": "Music beyond your usual",
  "recommend_explore_loading": "Exploring…",
  "recommend_explore_playing": "Exploring: {name}",
  "recommend_error": "Failed to load, tap to retry",
```

- [ ] **Step 4: lint 与回归**

Run: `npx eslint src/screens/Home/Views/Recommend src/screens/Home/Views/Discover` 及 `npm test`
Expected: lint 无 error；全部测试通过

- [ ] **Step 5: 提交**

```bash
git add src/screens/Home/Views/Recommend/index.tsx src/screens/Home/Views/Discover/index.tsx src/lang/zh-cn.json src/lang/zh-tw.json src/lang/en-us.json
git commit -m "Add discover recommend tab UI"
```

---

### Task 7: 全量验证 + 真机验收

**Files:**
- 无新增/修改（验证任务；如修复问题，修复代码并入对应模块后重新走本任务）

- [ ] **Step 1: 全量测试与 lint**

Run: `npm test` → Expected: 全部 PASS
Run: `npm run lint` → Expected: 无 error（warning 若为存量则忽略，新增的需修复）

- [ ] **Step 2: 构建并安装真机**

```bash
npm run pack:android
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

（真机通过无线调试连接；构建失败时优先排查新增文件的语法/导入解析。）

- [ ] **Step 3: 设备验收清单（golden path + 边界）**

1. 发现页出现"推荐"tab，与"排行榜""歌单"并列；推荐 tab 下右上角源选择器隐藏，切回其他 tab 源选择器正常显示。
2. 首次点击"个性电台"卡片：显示"正在构建电台…"，随后开始播放，卡片显示"基于 xxx 等 n 位歌手"；稍后播放列表出现 50 首推荐歌曲且歌曲不属于播放历史/收藏/黑名单。
3. 推荐歌曲播放消耗队列至剩 ≤2 首时，自动追加 30 首继续播放（可在"稍后播放"列表观察追加）。
4. 点击"探索未知"卡片：开始播放，卡片显示"正在探索:{分类名}"。
5. 播放中再次点击同一卡片：重新构建并换一批（跳到新队列）。
6. 断网状态下点击卡片：约 10 秒内显示"加载失败，点击重试"；恢复网络后点击卡片可正常重试。
7. 用户手动播放其它音乐后，推荐队列剩余歌曲不触发自动续批。
8. 切换 App 语言到繁体/English，推荐页文案与 tab 名正确。
9. 回归：发现页排行榜/歌单 tab、播放/暂停/切歌、稍后播放列表功能正常。

- [ ] **Step 4: 验收通过后确认工作区干净**

Run: `git status`（内层仓库）→ Expected: 仅剩用户自己的图标 PNG 改动与 `frames_*` 等原有未跟踪目录，无本计划遗留的未提交文件。**不要**对图标 PNG 做任何操作。

---

## Self-Review 结论（编写时已核）

- **Spec 覆盖**：§3 固定音源（Global Constraints + play.ts `getSource`）；§4 架构四纯模块+play.ts+UI（Task 1-6）；§5 画像（Task 2）；§6 电台含种子歌单、续批、榜单降级（Task 3/5）；§7 探索含标签重抽、热门降级、连续失败报错（Task 4/5）；§8 UI 状态机与再点换一批（Task 6）；§9 超时与静默放弃（play.ts `withTimeout`/continue catch）；§10 测试与真机（Task 1-4、7）；§2/§11 非目标（无每日列表、无持久化、无源联动——均未实现）。
- **占位符扫描**：无 TBD/TODO/省略号代码。
- **类型一致性**：`DislikeInfo`/`TrackLike`/`Profile`/`RadioDeps`/`ExploreDeps`/`ExploreBatch` 在定义处与使用处（radio/explore/play/UI）签名逐一核对一致；`getListDetail(id, source, page)`（songlist，id 在前）与 `getBoardListDetail(id, page)`（leaderboard）的参数顺序已区分标注；`getListDetailAll(source, id)` source 在前。
