# 下一首预加载 + 动态背景渐变浮现 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 播放到当前这首歌还剩 ≤60s 时，把下一首的封面 URL、封面字节、歌词、莫奈背景色、音频直链与前 8MB 字节提前备好；同时把全屏播控页的动态背景从"来不及就不画"改成"旧色留住 → 新色淡入叠上去 → 旧层再撤"，宽限期 8s 后才淡回主题底。

**Architecture:** 判据全部抽成两张能用 `node --test` 直接跑的纯表 —— `src/core/player/preloadPlan.ts`（该预热哪几步）与扩展后的 `src/utils/monet/backdropGate.ts`（屏幕上该铺哪一支）。副作用留在两处：`src/core/init/player/preloadNextMusic.ts` 只剩"订阅进度 → 问表 → 发起步骤 → 按代数丢弃晚到结果"，`coverBackdropStore.ts` 只多一个宽限计时器。封面字节走 App 自己的原生模块（带 UA 的 Fresco prefetch），音频字节走 `dependencies-patch.js` 给 track-player 打的三条补丁（复用播放器手里那份 `SimpleCache`）。

**Tech Stack:** React Native 0.73.11 / Hermes / TypeScript，androidx.media3 1.8.0（`CacheWriter` + `DataSpec` + `CacheDataSource.Factory`），Fresco 3.1.3（`ReactNetworkImageRequest.fromBuilderWithHeaders`），`node --test`（`--experimental-strip-types` 直读 `.ts`），Gradle `compileDebugJavaWithJavac`。

**Spec:** `docs/superpowers/specs/2026-10-15-preload-next-music-design.md`（commit 46e4030）—— 本计划按 spec 落地，三处偏离见下面第二节，执行时两个文件都要读。

## Global Constraints

每个任务的隐含要求都包含下面这些，值一律照抄 spec，不许近似：

- 竖屏专用：不改 `android/app/src/main/AndroidManifest.xml` 里 MainActivity 的 `android:screenOrientation="portrait"`，不改 `src/navigation/index.ts` 的 `layout.orientation: ['portrait']`，新代码不依赖横屏分支（AGENTS.md）。
- 不引入任何新依赖：`expo-image`、`NetInfo` 都不装；不做"仅 WiFi 预取"的网络类型判定（spec §8）。
- 不接纹理层：`getCoverTexture` 那条支继续保持不接线（spec §8）。
- 不碰 `src/components/player/PlayerOverlay/index.tsx` 里反编译的 `OverlayBackdrop`（line 127-159），渐变逻辑只住在这张纯表里（spec §4.6 范围）。
- 只做"下一首"一个目标，不预焐下两首（spec §4.1）。
- 预热绝不写 `coverBackdropStore` 的 `attempts` 账本与 `generation`，只焐 `coverPalette` 的内存缓存（spec §4.3 承重细节）。
- 宽限期 `graceMs = 8000`；淡入 380ms `Easing.out(Easing.quad)`；淡出 260ms `Easing.in(Easing.quad)`；`Animated.timing` + `useNativeDriver: true`（spec §4.6）。
- 音频默认档 `'head'` = 8MB（`AUDIO_HEAD_BYTES = 8 * 1024 * 1024`），`'full'` 传 `0` 让原生换成 `C.LENGTH_UNSET`（spec §4.5）。
- 单测闸门（2026-10-15 实测基线，别照抄理想值）：`npm test` 当前是 `tests 510 / pass 509 / fail 1`，那**一条红是既有的**、与本功能无关 —— `tests/monet-texture.mts:68`「正文区必须钉在色阶带上沿以下（lift 区另计）」，纹理支故意红，本计划不许把它改绿也不许让它更红。要求只有两条：`tests` 总数只增不减、`fail` 恒为 1 且仍是这一条。汇总行的前缀随 reporter 变（spec 是 `ℹ pass`、tap 是 `# pass`），统一用 `npm test 2>&1 | grep -E "^(ℹ|#) (tests|pass|fail)"` 抓。`npx tsc --noEmit` 的 src 基线 107 条不许涨；改到的文件 `npx eslint <文件>` 零新增告警；动 Java 必跑 `cd android && ./gradlew.bat compileDebugJavaWithJavac`（spec §6 + 仓库闸门约定）。
- 面向用户的文案写"对你有什么用"，不解释实现（spec §4.7）。
- `Animated.Interpolation` 节点没有 `.subtract()` 之类算术方法，需要组合时用 `Animated.add/multiply` 或在纯 JS 里算完再喂 `useNativeDriver`（spec §4.6，仓库踩过）。
- 真机验证只在 vivo 上跑（两台备用）；release 构建 ETA 2–3 分钟；工作区里与本功能无关的未提交 WIP 一律不清理、不"顺手整理"。
- 凡是要证明"这次没碰某个文件"的 `git diff`，对照对象都是开工前记下的 `BASE`（Task 1 Step 1 里 `git rev-parse HEAD` 的那枚 SHA），**不是 `main`** —— `main` 落后当前分支几十个提交，`package.json` 与播放页相关目录早就被推荐/识曲/莫奈改过一轮，对 `main` 比会得到"新增了 @material/material-color-utilities 依赖"这种假红。

## 与 spec 的三处偏离（先读这段）

执行前必须知道，这三条是我在写计划时读码得出的，与 spec 的字面表述不一致，都不改变要交付的行为：

1. **`CoverBackdropState` 不加 `displayed` / `incoming` 两个字段**（spec §4.6 写的是加两支）。实现改成：宽限期内把"旧的 `{picUrl, surface}` 这一支"**原样重新发布**，状态形状完全不变。收益是 `isSame()` 的去重、`OnCoverThemeProvider` 的墨色联动、`navigation.ts:162` 的 `peekCoverBackdrop()` 三条读点全都不用动，叠层/淡出这些动画簿籍收进组件。纯表多收两个可选入参（`stale`、`withinGrace`），判据本身和 spec 描述一模一样。
2. **`tests/monet-gate.mts:44` 不需要改写，它会原样绿**。spec §6 说它是"唯一被改写的既有判据"，但那条用例是 4 个实参调用（没有旧层可留），在新表里走的仍然是"整层不渲染"分支，断言 `surface === null` 继续成立。被真正改变的只是策略描述，所以本计划把它降级为"改注释、不改断言"，并在 Task 5 里给新分支单独加用例。spec §4.6 要求点名改写的那句约束（"不能靠顺手让旧用例变绿"）由新用例承担：新语义必须有自己命名的测试，不许靠删断言蒙过去。
3. **§4.2 的"兜底补触发 ≤10s"一行不做单独分支**。进度事件约每 1s 发一次，剩余 ≤10s 必然先经过 ≤60s 那道门；只有 `maxPlayTime > 10` 这个既有下界需要保留（电台/未知长度的流式曲不预热，与现状一致）。所以表里只有一条解析门限 `RESOLVE_AHEAD_SECONDS = 60` 加 `MIN_DURATION_SECONDS = 10`，Task 1 用一条用例把这个"10s 被 60s 包含"的关系钉住。

## 文件结构

新建（5 个）：

- `src/core/player/preloadPlan.ts` —— 纯表：这一刻该发起哪几步。零运行时依赖，`node --test` 直接 import。
- `tests/preload-next-music-plan.mts` —— 上面这张表的单测。
- `src/screens/Home/Views/Setting/settings/Player/IsPreloadNextMusic.tsx` —— 「切歌前准备下一首」开关（`CheckBoxItem`）。
- `src/screens/Home/Views/Setting/settings/Player/PreloadNextMusicAudio.tsx` —— 音频预热档位三选（`SubTitle` + `CheckBox`，与 `PlayHighQuality` 同款）。
- `docs/superpowers/plans/2026-10-15-preload-next-music.md` —— 本文件。

修改（14 个）：

- `src/core/init/player/preloadNextMusic.ts` —— 执行器重写（Task 3 落地、Task 4/9 各插一步）。
- `src/utils/nativeModules/palette.ts` —— 加 `prefetchCoverImage`（Task 4）。
- `android/app/src/main/java/cn/toside/music/mobile/palette/PaletteModule.java` —— 加 `prefetchImageWithHeaders`（Task 4）。
- `src/utils/monet/backdropGate.ts` —— 纯表加 `stale` / `withinGrace` 两个入参与宽限分支（Task 5）。
- `tests/monet-gate.mts` —— 末尾追加 5 条分支用例 + 1 处测试名改写（Task 5）。
- `src/utils/monet/coverBackdropStore.ts` —— `switchedAt`、`withinGrace`、宽限定时器与 `stale` 投递（Task 6）。
- `src/components/player/CoverBackdrop/index.tsx` —— 先叠后撤的双层淡入淡出（Task 7）。
- `dependencies-patch.js` —— 三条 track-player 补丁（Task 8）。
- `src/plugins/player/utils.ts` —— `cacheTrack` / `cancelCacheTrack` 的特性检测包装（Task 8）。
- `src/plugins/player/playList.ts` —— 导出 `defaultUserAgent` 给预热带同一个 UA（Task 8）。
- `src/config/defaultSetting.ts`、`src/types/app_setting.d.ts` —— 两个新键（Task 2）。
- `src/screens/Home/Views/Setting/settings/Player/index.tsx` —— 挂两项（Task 2）。
- `src/lang/zh-cn.json`、`src/lang/zh-tw.json`、`src/lang/en-us.json` —— 三个语言各补同一组键（Task 2）。
- `package.json` —— `test` 脚本追加新测试文件（Task 1）。

依赖顺序：Task 1 → 2 → 3 → 4；Task 5 → 6 → 7；Task 8 → 9；Task 10 收尾。前两组互不依赖，但 Task 3 的 `audio` 步骤在 Task 9 之前只拿直链不下字节，属预期的中间态。

---

### Task 1：预热判据抽成纯表

**Files:**
- Create: `src/core/player/preloadPlan.ts`
- Create: `tests/preload-next-music-plan.mts`
- Modify: `package.json:14`（`test` 脚本末尾追加一个文件名）

**Interfaces:**
- Consumes: 无（本任务不依赖任何既有函数）。
- Produces:
  - `type PreloadStep = 'pic' | 'lyric' | 'palette' | 'coverBytes' | 'audio'`
  - `type PreloadAudioTier = 'off' | 'head' | 'full'`
  - `interface PreloadProgress { nowPlayTime: number, maxPlayTime: number }`
  - `interface PreloadFlags { preloadNextMusic: boolean, dynamicBg: boolean, audioTier: PreloadAudioTier, cacheEnabled: boolean }`
  - `interface PreloadPlanInput { progress: PreloadProgress, flags: PreloadFlags, resolveTried: boolean, hasTarget: boolean, targetIsOnline: boolean, hasPicUrl: boolean, resolvedAge: number, done: Record<PreloadStep, boolean> }`
  - `interface PreloadPlan { resolveTarget: boolean, steps: PreloadStep[] }`
  - `buildPreloadPlan(input: PreloadPlanInput): PreloadPlan`
  - `audioMaxBytes(tier: PreloadAudioTier): number`（`'full'` → `0`，其余 → `AUDIO_HEAD_BYTES`）
  - 常量 `RESOLVE_AHEAD_SECONDS = 60`、`MIN_DURATION_SECONDS = 10`、`AUDIO_DELAY_SECONDS = 3`、`AUDIO_HEAD_BYTES = 8 * 1024 * 1024`

- [ ] **Step 1：先写失败的测试**

动手前先 `git rev-parse HEAD` 把这一刻的 SHA 记下来（下称 `BASE`），并在 Task 1 的提交信息末尾带上它一行 `BASE: <sha>` —— 后面所有"这次没碰哪个文件"的 `git diff` 都对着它比，不对 `main`（见 Global Constraints 最后一条）。

创建 `tests/preload-next-music-plan.mts`，全文如下：

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildPreloadPlan,
  audioMaxBytes,
  RESOLVE_AHEAD_SECONDS,
  MIN_DURATION_SECONDS,
  AUDIO_DELAY_SECONDS,
  AUDIO_HEAD_BYTES,
  type PreloadPlanInput,
  type PreloadStep,
} from '../src/core/player/preloadPlan.ts'

const FLAGS = { preloadNextMusic: true, dynamicBg: true, audioTier: 'head' as const, cacheEnabled: true }
const NO_DONE: Record<PreloadStep, boolean> = { pic: false, lyric: false, palette: false, coverBytes: false, audio: false }

/** 默认输入：播到 50s / 共 60s（剩 10s，落在 60s 门限内），下一首已解析、还没有封面 URL、解析刚完成。 */
const input = (over: Partial<PreloadPlanInput> = {}): PreloadPlanInput => ({
  progress: { nowPlayTime: 50, maxPlayTime: 60 },
  flags: FLAGS,
  resolveTried: true,
  hasTarget: true,
  targetIsOnline: true,
  hasPicUrl: false,
  resolvedAge: 0,
  done: { ...NO_DONE },
  ...over,
})

test('剩余 >60s 时不解析目标，也不发任何步骤', () => {
  const plan = buildPreloadPlan(input({ progress: { nowPlayTime: 10, maxPlayTime: 200 }, resolveTried: false, hasTarget: false }))
  assert.equal(plan.resolveTarget, false)
  assert.deepEqual(plan.steps, [])
})

test('剩余 <=60s 且本曲没问过：只让解析目标，这一步不发任何步骤', () => {
  const plan = buildPreloadPlan(input({ progress: { nowPlayTime: 30, maxPlayTime: 90 }, resolveTried: false, hasTarget: false }))
  assert.equal(plan.resolveTarget, true)
  assert.deepEqual(plan.steps, [])
})

test('目标问过就不再问第二次（无论成功还是返回 null）', () => {
  assert.equal(buildPreloadPlan(input({ resolveTried: false, hasTarget: false })).resolveTarget, true)
  assert.equal(buildPreloadPlan(input({ resolveTried: true, hasTarget: false })).resolveTarget, false)
  assert.equal(buildPreloadPlan(input({ resolveTried: true, hasTarget: true })).resolveTarget, false)
})

test('时长 <=10s（含 0，电台/未知长度流）整条不启动：60s 门限对它是恒真，必须靠这个下界挡掉', () => {
  for (const maxPlayTime of [0, 5, MIN_DURATION_SECONDS]) {
    const plan = buildPreloadPlan(input({ progress: { nowPlayTime: 0, maxPlayTime }, resolveTried: false, hasTarget: false }))
    assert.equal(plan.resolveTarget, false, `maxPlayTime=${maxPlayTime}`)
  }
  assert.equal(buildPreloadPlan(input({ progress: { nowPlayTime: 0, maxPlayTime: 11 }, resolveTried: false, hasTarget: false })).resolveTarget, true)
})

test('spec §4.2 的"≤10s 兜底"被 60s 门限包含：同一张表里剩 8s 与剩 40s 的判据相同', () => {
  assert.equal(RESOLVE_AHEAD_SECONDS > MIN_DURATION_SECONDS, true)
  const nearEnd = buildPreloadPlan(input({ progress: { nowPlayTime: 52, maxPlayTime: 60 } }))
  const midEnd = buildPreloadPlan(input({ progress: { nowPlayTime: 20, maxPlayTime: 60 } }))
  assert.deepEqual(nearEnd.steps, ['pic', 'lyric'])
  assert.deepEqual(midEnd.steps, nearEnd.steps)
})

test('目标一定就立刻发 pic 与 lyric，两者互不牵连', () => {
  assert.deepEqual(buildPreloadPlan(input()).steps, ['pic', 'lyric'])
})

test('dynamicBg=false 只跳取色那一步，其余照发', () => {
  const withoutPalette = buildPreloadPlan(input({ hasPicUrl: true, flags: { ...FLAGS, dynamicBg: false } }))
  assert.equal(withoutPalette.steps.includes('palette'), false)
  assert.deepEqual(withoutPalette.steps, ['pic', 'lyric', 'coverBytes'])
})

test('palette 与 coverBytes 都要等 pic 的结果（hasPicUrl）才发', () => {
  assert.deepEqual(buildPreloadPlan(input()).steps, ['pic', 'lyric'])
  assert.deepEqual(buildPreloadPlan(input({ hasPicUrl: true })).steps, ['pic', 'lyric', 'palette', 'coverBytes'])
})

test('本地/下载曲不发 coverBytes，也不发 audio', () => {
  const offline = buildPreloadPlan(input({ targetIsOnline: false, hasPicUrl: true, resolvedAge: 10 }))
  assert.equal(offline.steps.includes('coverBytes'), false)
  assert.equal(offline.steps.includes('audio'), false)
  assert.deepEqual(offline.steps, ['pic', 'lyric', 'palette'])
})

test('audio 要等解析完成后满 3s 才发（给连点下一首留反悔窗口）', () => {
  assert.equal(buildPreloadPlan(input({ hasPicUrl: true, resolvedAge: AUDIO_DELAY_SECONDS - 1 })).steps.includes('audio'), false)
  assert.equal(buildPreloadPlan(input({ hasPicUrl: true, resolvedAge: AUDIO_DELAY_SECONDS })).steps.includes('audio'), true)
})

test('audio 三种关闭情形：档位 off / 缓存 0 / 非在线曲，各自只少 audio 一步', () => {
  assert.equal(buildPreloadPlan(input({ hasPicUrl: true, resolvedAge: 5, flags: { ...FLAGS, audioTier: 'off' } })).steps.includes('audio'), false)
  assert.equal(buildPreloadPlan(input({ hasPicUrl: true, resolvedAge: 5, flags: { ...FLAGS, cacheEnabled: false } })).steps.includes('audio'), false)
  const off = buildPreloadPlan(input({ hasPicUrl: true, resolvedAge: 5, flags: { ...FLAGS, cacheEnabled: false } }))
  assert.deepEqual(off.steps, ['pic', 'lyric', 'palette', 'coverBytes'])
})

test('preloadNextMusic=false 时五步全不发、也不解析', () => {
  const plan = buildPreloadPlan(input({ flags: { ...FLAGS, preloadNextMusic: false }, hasPicUrl: true, resolvedAge: 10, resolveTried: false }))
  assert.equal(plan.resolveTarget, false)
  assert.deepEqual(plan.steps, [])
})

test('已经发起过的步骤不再重复发起（每步每曲只发一次）', () => {
  const done = { ...NO_DONE, pic: true, lyric: true }
  assert.deepEqual(buildPreloadPlan(input({ done })).steps, [])
  assert.deepEqual(buildPreloadPlan(input({ hasPicUrl: true, resolvedAge: 5, done: { ...NO_DONE, pic: true, lyric: true, palette: true } })).steps, ['coverBytes', 'audio'])
})

test('音频档位换算：head 给 8MB 上限，full 给 0（由原生换成 C.LENGTH_UNSET），off 不会被调用', () => {
  assert.equal(audioMaxBytes('head'), AUDIO_HEAD_BYTES)
  assert.equal(audioMaxBytes('full'), 0)
})
```

- [ ] **Step 2：跑测试，确认它因为文件不存在而失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/preload-next-music-plan.mts`
Expected: FAIL，报 `Cannot find module '.../src/core/player/preloadPlan.ts'`（实现文件还没建）。

- [ ] **Step 3：写实现**

创建 `src/core/player/preloadPlan.ts`，全文如下。这个文件除下面这些类型与常量之外不许有任何东西，尤其不许 `import` 任何带运行时的模块 —— 它要能被 Node 直接加载：

```ts
// 「这一刻该为下一首发哪几步」的纯表。
// 与 backdropGate.ts / attemptLedger.ts 同一类：除会被 Node 擦掉的类型外零运行时依赖，
// 所以能拿 node --test 当单元测试跑（tests/preload-next-music-plan.mts）。
// 副作用一步都不在这里，判据也不读 playerState / settingState —— 全部从入参拿，
// 否则这张表就退化成又一个"只能真机上才能验"的代码。

export type PreloadAudioTier = 'off' | 'head' | 'full'

export type PreloadStep = 'pic' | 'lyric' | 'palette' | 'coverBytes' | 'audio'

export interface PreloadProgress {
  nowPlayTime: number
  maxPlayTime: number
}

export interface PreloadFlags {
  /** 总开关：关掉就是五步全不发，连"下一首是谁"都不问 */
  preloadNextMusic: boolean
  /** 取色那一步单独受它管，别把整条预热带过去 */
  dynamicBg: boolean
  audioTier: PreloadAudioTier
  /** `parseInt(player.cacheSize) > 0` 为假时不开：播放器手里没有 SimpleCache，下字节无处可写 */
  cacheEnabled: boolean
}

export interface PreloadPlanInput {
  progress: PreloadProgress
  flags: PreloadFlags
  /** 本曲是否已经问过"下一首是谁"。返回 null（列表播完）也算问过，不再每秒重问 */
  resolveTried: boolean
  hasTarget: boolean
  /** 本地曲 / 下载曲为假：这两类没有"再下一趟网络"可省 */
  targetIsOnline: boolean
  hasPicUrl: boolean
  /** 目标解析完成后经过的秒数，音频字节那一步的延迟判据 */
  resolvedAge: number
  done: Record<PreloadStep, boolean>
}

export interface PreloadPlan {
  resolveTarget: boolean
  steps: PreloadStep[]
}

/** 剩多少秒开始准备下一首。10s 那条旧门限被它包含（进度事件约每 1s 一次），不再单独写分支 */
export const RESOLVE_AHEAD_SECONDS = 60
/** 时长下界：电台与未知长度的流式曲 maxPlayTime 为 0，此时"剩余 <=60"恒真，没有这个下界就会每秒问一次 */
export const MIN_DURATION_SECONDS = 10
/** 反悔窗口：给"连点下一首 / 拖到尾部"留出作废时间，过了这个点才动音频字节 */
export const AUDIO_DELAY_SECONDS = 3
export const AUDIO_HEAD_BYTES = 8 * 1024 * 1024

export const audioMaxBytes = (tier: PreloadAudioTier): number => tier === 'full' ? 0 : AUDIO_HEAD_BYTES

export const buildPreloadPlan = (input: PreloadPlanInput): PreloadPlan => {
  if (!input.flags.preloadNextMusic) return { resolveTarget: false, steps: [] }

  const remaining = input.progress.maxPlayTime - input.progress.nowPlayTime
  const resolveTarget = !input.resolveTried &&
    input.progress.maxPlayTime > MIN_DURATION_SECONDS &&
    remaining <= RESOLVE_AHEAD_SECONDS

  if (!input.hasTarget) return { resolveTarget, steps: [] }

  const steps: PreloadStep[] = []
  if (!input.done.pic) steps.push('pic')
  if (!input.done.lyric) steps.push('lyric')
  // 取色要等 pic 的结果：配色层的缓存键是 `picUrl|fontArgb`，没有 url 就没有这一步
  if (input.flags.dynamicBg && input.hasPicUrl && !input.done.palette) steps.push('palette')
  if (input.targetIsOnline && input.hasPicUrl && !input.done.coverBytes) steps.push('coverBytes')
  if (input.targetIsOnline &&
    input.flags.audioTier !== 'off' &&
    input.flags.cacheEnabled &&
    input.resolvedAge >= AUDIO_DELAY_SECONDS &&
    !input.done.audio) steps.push('audio')

  return { resolveTarget, steps }
}
```

- [ ] **Step 4：再跑一次，确认全绿**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/preload-next-music-plan.mts`
Expected: PASS，`pass 14`、`fail 0`（汇总行前缀随 reporter 变：spec 是 `ℹ pass 14`、tap 是 `# pass 14`，用 `| grep -E "^(ℹ|#) (pass|fail)"` 抓）。

- [ ] **Step 5：把新测试挂进 `npm test`，确认总数只增**

`package.json:14` 的 `test` 脚本末尾（`tests/monet-attempt-ledger.mts` 之后）追加一个文件名：

```
tests/monet-attempt-ledger.mts tests/preload-next-music-plan.mts"
```

（上面那段末尾的双引号是 `package.json` 里本来就有的，不是笔误 —— 逐字保留，别"顺手修"成不带引号的形式。）

Run: `npm test 2>&1 | grep -E "^(ℹ|#) (tests|pass|fail)"`
Expected: `tests` 从 510 涨到 524、`pass` 从 509 涨到 523，`fail` 仍然是 **1**（就是 Global Constraints 里点名的 `tests/monet-texture.mts:68`；本任务没碰纹理支，它要是变成 2 或那条换了名字，说明这次改动有牵连，先查清再提交）。先记下改动前的三个数字，提交信息里要写"从 510 涨到 524"。

- [ ] **Step 6：静态闸门**

Run: `npx tsc --noEmit 2>&1 | tail -3` → 仍然 107 条错误（src 基线，不许涨）。
Run: `npx eslint src/core/player/preloadPlan.ts` → 无输出。

- [ ] **Step 7：提交**

```bash
git add src/core/player/preloadPlan.ts tests/preload-next-music-plan.mts package.json
git commit -m "feat(preload): 下一首预热的判据抽成纯表，14 条分支进 node --test

BASE: <Step 1 记下的 SHA>"
```

---

### Task 2：两个设置项（键、UI、三语）

**Files:**
- Modify: `src/config/defaultSetting.ts:23`（`'player.cacheSize': '1024',` 之后）
- Modify: `src/types/app_setting.d.ts:141`（`'player.cacheSize': string` 之后）
- Create: `src/screens/Home/Views/Setting/settings/Player/IsPreloadNextMusic.tsx`
- Create: `src/screens/Home/Views/Setting/settings/Player/PreloadNextMusicAudio.tsx`
- Modify: `src/screens/Home/Views/Setting/settings/Player/index.tsx:17,37`
- Modify: `src/lang/zh-cn.json:501` 附近、`src/lang/zh-tw.json`、`src/lang/en-us.json` 同位置

**Interfaces:**
- Consumes: 既有 `updateSetting`（`@/core/common`）、`useSettingValue`（`@/store/setting/hook`）、`useI18n`（`@/lang`）、`CheckBoxItem`（`../../components/CheckBoxItem`）、`SubTitle`（`../../components/SubTitle`）、`CheckBox`（`@/components/common/CheckBox`）。
- Produces: 设置键 `'player.preloadNextMusic': boolean`（默认 `true`）与 `'player.preloadNextMusicAudio': 'off' | 'head' | 'full'`（默认 `'head'`）；i18n 键 `setting_play_preload_next`、`setting_play_preload_next_tip`、`setting_play_preload_next_audio`、`setting_play_preload_next_audio_off`、`setting_play_preload_next_audio_head`、`setting_play_preload_next_audio_full`。Task 3 从 `settingState.setting` 读这两个键。

- [ ] **Step 1：加两个默认值**

`src/config/defaultSetting.ts` 里 `'player.cacheSize': '1024',` 之后插两行：

```ts
  'player.preloadNextMusic': true,
  'player.preloadNextMusicAudio': 'head',
```

- [ ] **Step 2：加类型声明**

`src/types/app_setting.d.ts` 里 `'player.cacheSize': string` 之后插（注释风格照抄同文件其他键）：

```ts
    /**
       * 切歌前是否提前准备下一首的封面、歌词、配色与音频
       */
    'player.preloadNextMusic': boolean

    /**
       * 下一首音频字节的预热档位：off 不下、head 只下开头、full 整首
       */
    'player.preloadNextMusicAudio': 'off' | 'head' | 'full'
```

- [ ] **Step 3：写开关组件**

创建 `src/screens/Home/Views/Setting/settings/Player/IsPreloadNextMusic.tsx`，全文照 `IsAutoCleanPlayedList.tsx` 的形状：

```tsx
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { memo } from 'react'
import { View } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'

import CheckBoxItem from '../../components/CheckBoxItem'

export default memo(() => {
  const t = useI18n()
  const isPreloadNextMusic = useSettingValue('player.preloadNextMusic')
  const setPreloadNextMusic = (isPreloadNextMusic: boolean) => {
    updateSetting({ 'player.preloadNextMusic': isPreloadNextMusic })
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={isPreloadNextMusic}
        onChange={setPreloadNextMusic}
        helpDesc={t('setting_play_preload_next_tip')}
        label={t('setting_play_preload_next')}
      />
    </View>
  )
})


const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
```

- [ ] **Step 4：写档位组件**

创建 `src/screens/Home/Views/Setting/settings/Player/PreloadNextMusicAudio.tsx`，形状照 `PlayHighQuality.tsx`（`SubTitle` + 一行 `CheckBox`），但档位是固定三个而不是常量表：

```tsx
import { memo } from 'react'

import { StyleSheet, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import CheckBox from '@/components/common/CheckBox'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'

type Tier = 'off' | 'head' | 'full'

const TIERS: readonly Tier[] = ['head', 'full', 'off']

const Item = ({ tier, name, active }: { tier: Tier, name: string, active: boolean }) => {
  return <CheckBox marginRight={8} check={active} label={name} onChange={() => { updateSetting({ 'player.preloadNextMusicAudio': tier }) }} need />
}

export default memo(() => {
  const t = useI18n()
  const tier = useSettingValue('player.preloadNextMusicAudio')

  return (
    <SubTitle title={t('setting_play_preload_next_audio')}>
      <View style={styles.list}>
        {
          TIERS.map(id => <Item key={id} tier={id} name={t(`setting_play_preload_next_audio_${id}`)} active={tier == id} />)
        }
      </View>
    </SubTitle>
  )
})

const styles = StyleSheet.create({
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
})
```

`useSettingValue('player.preloadNextMusicAudio')` 的返回类型就是那个联合，`tier == id` 比较合法。`t(\`setting_play_preload_next_audio_${id}\`)` 能过 tsc 的理由已查实：`src/lang/index.ts:7` 把 `Message` 定义成 `Record<keyof typeof zh_cn, string>` 的联合，键直接从 JSON 推，而 `Tier` 是可枚举联合，模板字符串会展开成那三个键的字面量联合 —— 所以 Step 6 三个语言文件都补齐键之后它就是合法的。只有当 tsc 在这里报键不存在（说明某个 JSON 漏了键）才改成显式三元：`tier === 'head' ? t('..._head') : tier === 'full' ? t('..._full') : t('..._off')`，别为了绕类型把键删掉。

- [ ] **Step 5：挂进播放设置页**

`src/screens/Home/Views/Setting/settings/Player/index.tsx`：在 `import MaxCache from './MaxCache'` 之后加两行 import：

```tsx
import IsPreloadNextMusic from './IsPreloadNextMusic'
import PreloadNextMusicAudio from './PreloadNextMusicAudio'
```

渲染区 `<MaxCache />` 之后插两行（`PlayHighQuality` 之前）：

```tsx
      <IsPreloadNextMusic />
      <PreloadNextMusicAudio />
```

- [ ] **Step 6：补三个语言的键**

`src/lang/zh-cn.json`（插在 `"setting_play_cache_size_save_tip"` 之后，保持键序稳定）：

```json
  "setting_play_preload_next": "切歌前准备下一首",
  "setting_play_preload_next_tip": "提前把下一首的封面、歌词和配色取好，切过去不用再等。只影响切歌快慢，不改变音质。",
  "setting_play_preload_next_audio": "提前下载下一首",
  "setting_play_preload_next_audio_head": "开头（约 8MB）",
  "setting_play_preload_next_audio_full": "整首",
  "setting_play_preload_next_audio_off": "不下载",
```

`src/lang/zh-tw.json` 同位置：

```json
  "setting_play_preload_next": "切歌前準備下一首",
  "setting_play_preload_next_tip": "提前把下一首的封面、歌詞和配色取好，切過去不用再等。只影響切歌快慢，不改變音質。",
  "setting_play_preload_next_audio": "提前下載下一首",
  "setting_play_preload_next_audio_head": "開頭（約 8MB）",
  "setting_play_preload_next_audio_full": "整首",
  "setting_play_preload_next_audio_off": "不下載",
```

`src/lang/en-us.json` 同位置：

```json
  "setting_play_preload_next": "Prepare the next song",
  "setting_play_preload_next_tip": "Fetches the next song's cover, lyrics and colors in advance so switching feels instant. It only affects how fast switching feels, not sound quality.",
  "setting_play_preload_next_audio": "Download the next song ahead",
  "setting_play_preload_next_audio_head": "The beginning (about 8MB)",
  "setting_play_preload_next_audio_full": "The whole song",
  "setting_play_preload_next_audio_off": "Don't download",
```

- [ ] **Step 7：静态闸门**

Run: `npx tsc --noEmit 2>&1 | tail -3` → 仍是 107 条。
Run: `npx eslint src/screens/Home/Views/Setting/settings/Player/IsPreloadNextMusic.tsx src/screens/Home/Views/Setting/settings/Player/PreloadNextMusicAudio.tsx src/screens/Home/Views/Setting/settings/Player/index.tsx src/config/defaultSetting.ts` → 无输出。
Run: `node -e "for (const f of ['zh-cn','zh-tw','en-us']) { const j = require('./src/lang/' + f + '.json'); for (const k of ['setting_play_preload_next','setting_play_preload_next_tip','setting_play_preload_next_audio','setting_play_preload_next_audio_head','setting_play_preload_next_audio_full','setting_play_preload_next_audio_off']) if (!(k in j)) throw new Error(f + ' missing ' + k) } console.log('i18n ok')"` → `i18n ok`。

- [ ] **Step 8：真机确认能存下来**

Run: `cd android && ./gradlew.bat assembleRelease`（ETA 2–3 分钟）后 `adb install -r app/build/outputs/apk/release/app-arm64-v8a-release.apk`（按本机 ABI 选产物）。
Expected: 「播放设置」里出现两项；档位选「不下载」→ 杀掉应用重进 → 仍是「不下载」；总开关仍能勾掉/勾回。这一步只是验设置本身能读写，预热行为在 Task 3 之后才有效。

- [ ] **Step 9：提交**

```bash
git add src/config/defaultSetting.ts src/types/app_setting.d.ts src/screens/Home/Views/Setting/settings/Player src/lang/zh-cn.json src/lang/zh-tw.json src/lang/en-us.json
git commit -m "feat(preload): 「切歌前准备下一首」与音频档位两个设置项，文案只讲对用户有什么用"
```

---

### Task 3：执行器只保留订阅、代数与步骤派发

**Files:**
- Modify: `src/core/init/player/preloadNextMusic.ts`（整文件重写）

**Interfaces:**
- Consumes: Task 1 的 `buildPreloadPlan` / `PreloadStep`；Task 2 的两个设置键；既有 `getMusicUrl` / `getPicPath` / `getLyricInfo`（`@/core/music`）、`getNextPlayMusicInfo` / `resetRandomNextMusicInfo`（`@/core/player/player`）、`checkUrl`（`@/utils/request`）、`isCached`（`@/plugins/player/utils`）、`getCoverSurface`（`@/utils/monet`）、`ON_COVER_FONT_CSS`（`@/utils/monet/surface`）。
- Produces: 内部状态形状 `{ generation, resolveTried, target, targetIsOnline, picUrl, resolvedAt, done, isResolving }`；Task 4 往 `runStep` 的 `'coverBytes'` 分支填一行，Task 9 往 `'audio'` 分支尾巴接上字节预热，并在 `bump()` 里加 `cancelCacheTrack`。

- [ ] **Step 1：整文件替换**

`src/core/init/player/preloadNextMusic.ts` 全文换成：

```ts
import { getMusicUrl, getPicPath, getLyricInfo } from '@/core/music'
import { getNextPlayMusicInfo, resetRandomNextMusicInfo } from '@/core/player/player'
import { checkUrl } from '@/utils/request'
import settingState from '@/store/setting/state'
import { isCached } from '@/plugins/player/utils'
import { getCoverSurface } from '@/utils/monet'
import { ON_COVER_FONT_CSS } from '@/utils/monet/surface'
import { buildPreloadPlan, type PreloadStep } from '@/core/player/preloadPlan'

// 判据在 src/core/player/preloadPlan.ts（纯表，node --test 跑得动）。
// 这里只做四件事：订阅进度、按代数作废在途、发起步骤、把结果写回 state。
// 目标恒为一个（下一首），不预焐下两首：coverPalette 的像素层 LRU 只有 20 条，
// 焐两首会把当前这首歌挤出去，反而制造新的取色迟到。
const state = {
  // 在途代数：手动切歌、播放模式变化、预热相关设置翻动都 ++，
  // 每步写回前比对，晚到的旧结果据此丢弃
  generation: 0,
  /** 本曲是否已经问过"下一首是谁"。问过就不再问，返回 null（列表播完）也不再问 */
  resolveTried: false,
  target: null as LX.Player.PlayMusicInfo | null,
  /** 本地/下载曲为假：省掉 coverBytes 与音频字节两步 */
  targetIsOnline: false,
  picUrl: null as string | null,
  /** 目标解析完成的时刻（ms）：音频字节延后 3s 的判据 */
  resolvedAt: 0,
  done: { pic: false, lyric: false, palette: false, coverBytes: false, audio: false } as Record<PreloadStep, boolean>,
  isResolving: false,
}

const reset = () => {
  state.resolveTried = false
  state.target = null
  state.targetIsOnline = false
  state.picUrl = null
  state.resolvedAt = 0
  state.isResolving = false
  for (const key of Object.keys(state.done) as PreloadStep[]) state.done[key] = false
}

const bump = () => {
  state.generation++
  reset()
}

const flags = () => ({
  preloadNextMusic: settingState.setting['player.preloadNextMusic'],
  dynamicBg: settingState.setting['theme.dynamicBg'],
  audioTier: settingState.setting['player.preloadNextMusicAudio'],
  // 与 core/player/player.ts:248 同式：那个设置项是字符串，空串也会算成 0，
  // 而 maxCacheSize <= 0 时 LocalPlayback 根本不建 SimpleCache（cache == null），
  // 字节下下去没地方写，只能整条禁用音频字节这步。
  cacheEnabled: parseInt(settingState.setting['player.cacheSize'] || '0') > 0,
})

const resolveTarget = async() => {
  if (state.isResolving) return
  state.isResolving = true
  state.resolveTried = true
  const generation = state.generation
  const info = await getNextPlayMusicInfo().catch(() => null)
  if (generation !== state.generation) {
    state.isResolving = false
    return
  }
  state.isResolving = false
  state.target = info
  state.resolvedAt = Date.now()
  if (info) {
    const musicInfo = info.musicInfo
    // 下载曲带 progress 字段，本地曲 source === 'local'；这两类没有"再下一趟网络"可省
    state.targetIsOnline = !('progress' in musicInfo) && musicInfo.source !== 'local'
  }
}

/** 沿用现状那条链：先拿直链，再用 isCached + HEAD 探活，两者都不成才 isRefresh 重取一次 */
const warmAudio = async(target: LX.Player.PlayMusicInfo) => {
  const generation = state.generation
  const url = await getMusicUrl({ musicInfo: target.musicInfo }).catch(() => '')
  if (!url || generation !== state.generation) return
  const [cached, available] = await Promise.all([
    isCached(url),
    checkUrl(url).then(() => true).catch(() => false),
  ])
  if (cached || available) return
  await getMusicUrl({ musicInfo: target.musicInfo, isRefresh: true }).catch(() => '')
}

const runStep = async(step: PreloadStep) => {
  const target = state.target
  if (target == null) return
  // 发起即记账：一次失败不在这一首里重试，下一首自然还会再问（spec §5）
  state.done[step] = true
  const generation = state.generation
  try {
    switch (step) {
      case 'pic': {
        const url = await getPicPath({ musicInfo: target.musicInfo, listId: target.listId })
        if (generation !== state.generation) return
        state.picUrl = url
        break
      }
      case 'lyric':
        await getLyricInfo({ musicInfo: target.musicInfo })
        break
      case 'palette':
        // 承重：只焐 coverPalette 的缓存，绝不碰 coverBackdropStore 的 attempts 账本与 generation。
        // 那张账管的是"这张封面该不该再问原生、什么时候自愈重试"，去动它就是把
        // 「时有时无」那个缺陷重写一遍。两边按 url 合并 promise，切歌时页面读到同一条在途。
        await getCoverSurface(state.picUrl, ON_COVER_FONT_CSS)
        break
      case 'coverBytes':
        break
      case 'audio':
        await warmAudio(target)
        break
    }
  } catch (e) {
    if (__DEV__) console.log('[preload]', step, 'failed', e)
  }
}

export default () => {
  const handleMusicToggled = () => {
    // 切歌就是新的一轮：在途全部作废，目标重问
    bump()
  }

  const handleConfigUpdated: typeof global.state_event.configUpdated = (keys) => {
    if (keys.includes('player.togglePlayMethod')) {
      if (state.target && !state.target.isTempPlay) resetRandomNextMusicInfo()
      bump()
    }
    // 预加载相关设置翻了也要重来：关掉要作废在途，打开（含「动态背景」）才能补发没发过的那几步
    if (keys.includes('player.preloadNextMusic') ||
      keys.includes('player.preloadNextMusicAudio') ||
      keys.includes('theme.dynamicBg')) bump()
  }

  const handlePlayProgressChanged: typeof global.state_event.playProgressChanged = (progress) => {
    const plan = buildPreloadPlan({
      progress: { nowPlayTime: progress.nowPlayTime, maxPlayTime: progress.maxPlayTime },
      flags: flags(),
      resolveTried: state.resolveTried,
      hasTarget: state.target != null,
      targetIsOnline: state.targetIsOnline,
      hasPicUrl: state.picUrl != null,
      resolvedAge: (Date.now() - state.resolvedAt) / 1000,
      done: state.done,
    })
    if (plan.resolveTarget) void resolveTarget()
    for (const step of plan.steps) void runStep(step)
  }

  global.app_event.on('musicToggled', handleMusicToggled)
  global.state_event.on('configUpdated', handleConfigUpdated)
  global.state_event.on('playProgressChanged', handlePlayProgressChanged)
}
```

四处与旧文件的不同，提交信息里要说明白：

- `playerState` 这个 import 一起删：旧文件读它是为了 `musicInfo.id` 与 `nowPlayTime`，现在进度全部从 `playProgressChanged` 的入参拿，留着就是未使用导入，`npx eslint` 会直接判红。
- 旧的 `setProgress` 监听只喂 `preProgress`（3s 节流用的），现在"每步每曲只发一次"由 `done` 承担，节流字段和监听一起删。
- 旧门限 `duration > 10 && duration - nowPlayTime < 10` 换成表里的 `maxPlayTime > 10 && remaining <= 60`，语义包含关系见第二节偏离第 3 条。
- `tempPlayList`（稍后播放）仍然由 `getNextPlayMusicInfo` 优先返回，本文件不特判；`resetRandomNextMusicInfo()` 也仍然只在 `player.togglePlayMethod` 时调，预热路径一次都不碰它。

- [ ] **Step 2：静态闸门**

Run: `npx tsc --noEmit 2>&1 | tail -3` → 107 条基线不变（`getPicPath` / `getLyricInfo` 的入参类型接受 `LX.Music.MusicInfo | LX.Download.ListItem`，与 `PlayMusicInfo.musicInfo` 同型，不需要断言）。
Run: `npx eslint src/core/init/player/preloadNextMusic.ts` → 无输出。
Run: `npm test 2>&1 | grep -E "^(ℹ|#) (tests|pass|fail)"` → 与 Task 1 之后同数 524（本任务没加测试；判据都在表里，已经覆盖）。

- [ ] **Step 3：真机看"切歌不再等"**

`./gradlew.bat assembleRelease`（ETA 2–3 分钟）→ 装到 vivo → 播放列表连续切两三首，重点看：歌词是否还空一秒、小封面是否还慢半拍。
Expected: 有网时歌词与封面随切随出。播放期间 `adb logcat -s ReactNativeJS` 若看到 `[preload] <step> failed`，把步骤名与原句记进本节末尾；`pic` 与 `lyric` 连续失败说明源接口有问题，先别往下走 Task 4。
顺带确认一件副作用没有炸：预热会把封面 URL 写回列表（`updateListMusics`），列表页此刻可能重渲染 —— 观察列表页有没有明显抖动；抖得难看就按 spec §7-6 的逃生口，把 `listId` 从 `getPicPath` 的参数里去掉。

- [ ] **Step 4：提交**

```bash
git add src/core/init/player/preloadNextMusic.ts
git commit -m "feat(preload): 执行器改为按纯表派发四步，门限提前到剩 60s

删掉只服务 3s 节流的 setProgress 监听；preloadNextMusic / 音频档位 / dynamicBg
翻动时一并作废在途。coverBytes 分支先留空，由下一笔提交填。"
```

---

### Task 4：封面字节预热（带 UA 的原口 prefetch）

**Files:**
- Modify: `android/app/src/main/java/cn/toside/music/mobile/palette/PaletteModule.java`（新增一个 `@ReactMethod` + 四个 import）
- Modify: `src/utils/nativeModules/palette.ts`（加 `prefetchCoverImage`）
- Modify: `src/core/init/player/preloadNextMusic.ts`（`case 'coverBytes':` 分支填一行）

**Interfaces:**
- Consumes: Fresco 3.1.3 已在 app 的 `debugCompileClasspath` 上（本任务 Step 1 会先验一遍可见性，所以不需要新依赖）；`com.facebook.react.modules.fresco.ReactNetworkImageRequest.fromBuilderWithHeaders(ImageRequestBuilder, ReadableMap)`；`ReactOkHttpNetworkFetcher`（line 60-63）会把 `ReactNetworkImageRequest` 上的 headers 发给真实请求。
- Produces: 原生方法 `PaletteModule.prefetchImageWithHeaders(String url, ReadableMap headers, Promise promise)`（resolve `true` / `false`，永不 reject）；JS 侧 `prefetchCoverImage(url: string | null | undefined, headers: Record<string, string>): Promise<boolean>`（非 Android、非 http、模块缺失都返回 `false`）。

- [ ] **Step 1：先确认 Fresco 类在 app 侧可编译（这一步决定走 A 还是 B）**

`PaletteModule.java` 的 import 区加上四行：

```java
import android.util.Log;
import com.facebook.common.executors.CallerThreadExecutor;
import com.facebook.datasource.BaseDataSubscriber;
import com.facebook.datasource.DataSource;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.ReadableType;
import com.facebook.react.modules.fresco.ReactNetworkImageRequest;
import com.facebook.drawee.backends.pipeline.Fresco;
import com.facebook.imagepipeline.request.ImageRequest;
import com.facebook.imagepipeline.request.ImageRequestBuilder;
```

临时在类里塞一个只用到 `Fresco.getImagePipeline()` 的空方法，跑：

Run: `cd android && ./gradlew.bat compileDebugJavaWithJavac`
Expected: `BUILD SUCCESSFUL`。Fresco 3.1.3 由 RN gradle 插件以 `{strictly 3.1.3}` 钉进 app 的 `debugCompileClasspath`（实测 `:app:dependencies` 输出里有 `+--- com.facebook.fresco:fresco:{strictly 3.1.3}`），所以能编译，不需要加 `implementation`。
若这一步报 `package com.facebook.drawee.backends.pipeline does not exist`：**放弃 A**，删除以上 import 与临时方法，跳到 Step 5 的 B 方案（隐藏 1×1 `<Image>`），并在提交信息里写明"A 被编译期否掉"。

- [ ] **Step 2：写原生方法**

在 `getArgbPixels` 之后插入（用 Step 1 的 import；不新增任何依赖）：

```java
  // 封面字节预热：把下一首的封面原图下载进 Fresco 的磁盘缓存。
  // 不能用 RN 自带的 Image.prefetch —— 它建请求时不带 headers
  // （ImageLoaderModule.java:219 是 ImageRequestBuilder.newBuilderWithSource(uri).build()），
  // 而有 UA 校验的 CDN 会 403。这里复用 ReactNetworkImageRequest，
  // headers 由 ReactOkHttpNetworkFetcher.java:60-63 真正发出去，落到与页面渲染同一个 pipeline。
  @ReactMethod
  public void prefetchImageWithHeaders(String url, ReadableMap headers, Promise promise) {
    if (url == null || url.isEmpty() || !url.startsWith("http")) {
      promise.resolve(false);
      return;
    }
    try {
      ImageRequest request = ReactNetworkImageRequest.fromBuilderWithHeaders(
        ImageRequestBuilder.newBuilderWithSource(Uri.parse(url)), headers);
      DataSource<Void> prefetchSource = Fresco.getImagePipeline().prefetchToDiskCache(request, null);
      prefetchSource.subscribe(new BaseDataSubscriber<Void>() {
        @Override
        protected void onNewResultImpl(DataSource<Void> dataSource) {
          boolean isFinished = dataSource.isFinished();
          dataSource.close();
          if (isFinished) promise.resolve(true);
        }

        @Override
        protected void onFailureImpl(DataSource<Void> dataSource) {
          Throwable t = dataSource.getThrowable();
          dataSource.close();
          // 预热失败只是"下一首还得现下"，不值得像 getArgbPixels 那样 reject：
          // reject 会让 JS 侧每个坏封面都走一遍 catch，还会在 __DEV__ 刷一堆红字。
          Log.d("PaletteModule", "cover prefetch failed: " + (t == null ? "unknown" : t.getMessage()));
          promise.resolve(false);
        }
      }, CallerThreadExecutor.getInstance());
    } catch (Throwable t) {
      // 工作线程外的 Throwable 也一并吃掉：prefetch 不是正确性路径。
      Log.d("PaletteModule", "cover prefetch threw: " + t);
      promise.resolve(false);
    }
  }
```

`callerContext` 传 `null` 是有意的：Fresco 的磁盘 key 由 uri 决定（`ReactImageView.java:589-601` 里 http uri 不做 resize），callerContext 不参与，页面那条请求读得到；这正是探针 P-1 要验的东西，不许在这里"顺手"传一个 context 把结论搅浑。

- [ ] **Step 3：编译并装包**

Run: `cd android && ./gradlew.bat compileDebugJavaWithJavac` → `BUILD SUCCESSFUL`。
Run: `cd android && ./gradlew.bat assembleRelease`（ETA 2–3 分钟）→ `adb install -r` 产物。

- [ ] **Step 4：JS 包装（特性检测，iOS/补丁漂移都自己熄火）**

`src/utils/nativeModules/palette.ts` 末尾追加：

```ts
export const prefetchCoverImage = async(url: string | null | undefined, headers: Record<string, string>): Promise<boolean> => {
  // file:// 是本地内嵌封面抽出来的文件，本来就不走网络，预热无意义
  if (Platform.OS !== 'android' || !url?.startsWith('http') || !PaletteModule?.prefetchImageWithHeaders) return false
  try {
    return await PaletteModule.prefetchImageWithHeaders(url, headers) === true
  } catch (e) {
    if (__DEV__) console.log('[palette] prefetchImageWithHeaders failed', url, e)
    return false
  }
}
```

`src/core/init/player/preloadNextMusic.ts`：import 区补这两行（`getCoverSurface` / `ON_COVER_FONT_CSS` 是 Task 3 已经写进去的，别重复 import），并把空分支填上。

```ts
import { prefetchCoverImage } from '@/utils/nativeModules/palette'
import { defaultHeaders } from '@/components/common/Image'
```

（在 core 里 import 组件层的常量是本仓库已有的做法 —— `src/core/init/theme.ts:6` 就 import 了 `@/components/common/StatusBar`。这里非复制不可的理由是那个 UA 决定"这个封面 403 还是 200"，它必须与页面渲染那一条请求逐字相同；`PaletteModule.java` 里同串的 UA 已经用注释钉在 `Image.tsx` 的 `defaultHeaders` 上了。）

```ts
      case 'coverBytes':
        await prefetchCoverImage(state.picUrl, defaultHeaders)
        break
```

- [ ] **Step 5：B 方案（仅当 Step 1 编译失败时才做）**

不碰 Java，改在 `src/screens/PlayDetail/Vertical/index.tsx` 的 `<CoverBackdrop />` 之后挂一个 1×1 的隐藏 `Image`，用现成的 `@/components/common/Image`（它自带 `defaultHeaders` + `force-cache`），url 取 `playerState.nextMusicInfo?.musicInfo.pic`。本仓库当前不需要走这一支；真要走，B 的语义与 A 完全一致（同一个 `defaultHeaders`，差别只在请求发起者）。

- [ ] **Step 6：探针 P-1（真机，决定这套留不留）**

1. 列表里连选两首都有封面的歌，播第一首，等到剩 60s 内（`adb logcat -s ReactNativeJS` 可看到 `[preload]` 相关日志；`__DEV__` 下 `Image.tsx` 还会打 `[codex Image]`）。
2. **开启飞行模式**，再手动切到下一首。
3. 看播放页的糊封面（`CoverBackdrop`）与小封面是否仍然出现。

Expected: 断网仍能出封面 ⇒ 预热写进了 Fresco 缓存（这一首之前页面从没显示过它的封面，内存缓存里也不会有，所以结论唯一）。
若断网完全没有封面：prefetch 与请求页不同 pipeline 或 key 不一致，A 判否 —— 改走 Step 5 的 B；B 也不行就把 `coverBytes` 这一步删掉（其余四步不受影响），并在提交信息里写明删掉的理由。

- [ ] **Step 7：静态闸门与提交**

Run: `npx tsc --noEmit 2>&1 | tail -3` → 107 条基线。
Run: `npx eslint src/utils/nativeModules/palette.ts src/core/init/player/preloadNextMusic.ts` → 无输出。

```bash
git add android/app/src/main/java/cn/toside/music/mobile/palette/PaletteModule.java src/utils/nativeModules/palette.ts src/core/init/player/preloadNextMusic.ts
git commit -m "feat(preload): 封面字节预热走自带 UA 的原生 prefetch，绕开 Image.prefetch

RN 的 prefetch 建请求不带 headers，有 UA 校验的封面会 403；这里改用
ReactNetworkImageRequest + 全局 ImagePipeline，磁盘 key 与页面渲染同源。
P-1 断网探针已验（结果写在计划对应步骤）。"
```

---

### Task 5：宽限期判据进纯表（先加测试）

**Files:**
- Modify: `src/utils/monet/backdropGate.ts`
- Modify: `tests/monet-gate.mts`（末尾追加 5 条用例 + 1 处测试名改写）

**Interfaces:**
- Consumes: 既有 `CoverSurface` 类型与 `resolveCoverBackdrop` 的四条既有判据。
- Produces: `interface CoverBackdropStale { picUrl: string, surface: CoverSurface }`、常量 `COVER_BACKDROP_GRACE_MS = 8000`，以及扩展签名
  `resolveCoverBackdrop(dynamicBg, hasThemeBgImage, pic, surface, stale?: CoverBackdropStale | null, withinGrace?: boolean): CoverBackdropState`
  （后两个可选，缺省行为与今天逐字段一致 —— 现有 8 条用例（实测数）都是 4 参调用，必须原样绿）。
  `CoverBackdropState` 的四个字段（`enabled` / `picUrl` / `surface` / `wantsSurface`）**不变**。

- [ ] **Step 1：先把新分支的测试写出来（此刻必然红）**

`tests/monet-gate.mts` 末尾追加：

```ts
// 下面五条钉的是 spec §4.6 的过渡态。第 1、2 条是「晚到不要闪」这一半，第 2 条同时防死锁：
// 留住旧层不等于关掉取色请求 —— 否则就把 2026-10-15 晚修掉的「时有时无」重写一遍。
// 第 3 条钉「没有封面的歌不给宽限期」，第 4 条钉新色到手立即换，第 5 条钉无旧层可留时不造假。
const OLD_PIC = 'https://example.com/old.jpg'
const STALE = { picUrl: OLD_PIC, surface: SURFACE }

test('新歌有封面、色还没到手、宽限期内：继续铺旧那一支（含它自己的 picUrl），不是闪回主题底', () => {
  const s = resolveCoverBackdrop(true, false, PIC, null, STALE, true)
  assert.equal(s.enabled, true)
  assert.equal(s.picUrl, OLD_PIC, '屏上是"背景还没变过来"，不是整屏纯色')
  assert.equal(s.surface, SURFACE)
})

test('宽限期已过：旧层交回去，底下是主题底（晚到的色仍然会淡进来一次）', () => {
  const s = resolveCoverBackdrop(true, false, PIC, null, STALE, false)
  assert.equal(s.picUrl, null)
  assert.equal(s.surface, null)
  assert.equal(s.wantsSurface, true, '过期不等于放弃 —— 冷却重试还要靠这一格为真')
})

test('新歌根本没有封面：不给宽限期，旧层同一帧交回去', () => {
  assert.equal(resolveCoverBackdrop(true, false, null, null, STALE, true).picUrl, null)
  assert.equal(resolveCoverBackdrop(true, false, '', null, STALE, true).picUrl, null)
})

test('新色到手就立刻换过来，宽限期不再有意义', () => {
  const s = resolveCoverBackdrop(true, false, PIC, SURFACE, STALE, true)
  assert.equal(s.picUrl, PIC)
  assert.equal(s.surface, SURFACE)
  assert.equal(s.wantsSurface, false)
})

test('没有旧层可留时（首次进入/上一首本来就没上色）：宽限期不造假出任何层', () => {
  assert.equal(resolveCoverBackdrop(true, false, PIC, null, null, true).picUrl, null)
})
```

- [ ] **Step 2：跑一次，确认新用例红、旧用例红不到**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-gate.mts`
Expected: 第 1 条新用例失败（`s.picUrl` 拿到 `null`，断言要的是 `OLD_PIC`，因为表还不认 `stale`）；其余四条新用例此刻应已通过（它们断言的是"没有旧层也照旧不铺"这类既有行为）。8 条既有用例必须全绿。

- [ ] **Step 3：扩展纯表**

`src/utils/monet/backdropGate.ts` 全文换成：

```ts
// 这一层只放纯判断：除了下面这个会被 Node 擦掉的类型 import，本文件不许有任何运行时依赖，
// 这样 `node --test` 才能直接加载它，把这张决策表当单元测试跑。
// `useCoverSurface` 是它唯一的调用方。PlayerOverlay（APK 反编译文件）不许 import 这里，
// 它自己那句 `hasBackdropImage ||` 是冗余判断而不是第二套规则。
import type { CoverSurface } from './surface.ts'

export interface CoverBackdropState {
  enabled: boolean
  picUrl: string | null
  surface: CoverSurface | null
  /** 该不该为这张封面去发一次取色。与 picUrl 分开是必须的：picUrl 要等色到手才交（见下），
   *  拿它当取色的触发条件就是死锁 —— 没色 → picUrl 为 null → 不请求 → 永远没色。 */
  wantsSurface: boolean
}

/** 屏幕上正在铺底的那一支（可能还是上一首歌的）。宽限期内它被原样重新发布，
 *  于是背景层与前景墨色一起停在旧那一支上 —— 见 coverBackdropStore.ts 的头注释。 */
export interface CoverBackdropStale {
  picUrl: string
  surface: CoverSurface
}

/** 唯一可调的观感数字，推导见 spec §4.6-4：原生单次超时 4s，取两次的时间量级；
 *  低于 4s 会把"慢但还活着"的取色判成失败（先淡出再淡入，比一次闪更难看），
 *  高于 15s（ATTEMPT_COOLDOWN_MS）就分不清是宽限期还是冷却重试。 */
export const COVER_BACKDROP_GRACE_MS = 8000

export const resolveCoverBackdrop = (dynamicBg: boolean, hasThemeBgImage: boolean,
  pic: string | null | undefined, surface: CoverSurface | null,
  stale: CoverBackdropStale | null = null, withinGrace = false): CoverBackdropState => {
  // 主题自带背景图优先：hasThemeBgImage 的实参必须是 ActiveTheme 的 theme['bg-image'] 取真值，
  // 那是 PageContent 真正拿去画图的同一个值，不能用 extInfo 里的原始字符串（纯色主题是 ''）。
  const enabled = dynamicBg && !hasThemeBgImage
  // 关掉的瞬间也要交回 null，让屏幕上那一层走退场淡出而不是硬切（spec §4.6-1）。
  if (!enabled) return { enabled, picUrl: null, surface: null, wantsSurface: false }
  // pic 也参加这条：切到没有封面的歌时 enabled 仍为真，只挡 enabled 会让上一张封面的色多刷一帧，
  // 而那一帧模糊封面层已经因为 picUrl 变空而卸载 —— 屏幕上是"整屏纯色闪一下"，
  // 不是验收 ④ 说的"与改动前逐像素一致"。没有封面的歌同理不给宽限期：留着的该是"这张封面还没上色"，
  // 而不是"这一首根本不该有背景层"。
  if (!pic) return { enabled, picUrl: null, surface: null, wantsSurface: false }
  if (surface != null) return { enabled, picUrl: pic, surface, wantsSurface: false }
  // 新歌的色还没到手：宽限期内且手里真的有一支旧层，就把它原样重新发布（底与字同一份、同一次 publish 一起翻）。
  // 留住的是带自己 picUrl 的完整那一支（糊封面 + 底色 + 蒙版），不是把上一首的纯色铺到新一首上，
  // 所以这不是 backdropGate 旧注释担心的"刷一屏旧封面色"。
  if (withinGrace && stale != null && stale.picUrl !== pic) {
    return { enabled, picUrl: stale.picUrl, surface: stale.surface, wantsSurface: true }
  }
  return { enabled, picUrl: null, surface: null, wantsSurface: true }
}
```

注意 `wantsSurface` 在过渡分支里也必须为真（spec §4.6-2 那条"不许松"的约束，靠 Step 1 第二条用例钉住）。

- [ ] **Step 4：把被改变策略的那条既有用例的注释改准**

`tests/monet-gate.mts:44` 那条用例名与注释只描述"没有旧层"这一支，新语义里它不再是整张表的结论。改测试名、断言一个字不动：

```ts
test('配色还没算出来、手里也没有旧层：surface 交 null，整层不渲染（有旧层可留时走下面那组宽限用例）', () => {
  const s = resolveCoverBackdrop(true, false, PIC, null)
  assert.equal(s.enabled, true)
  assert.equal(s.surface, null)
})
```

- [ ] **Step 5：跑测试**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-gate.mts`
Expected: PASS（`pass 13`：既有 8 条 + 新 5 条，`fail 0`；汇总前缀按 reporter 是 `ℹ` 或 `#`）。
Run: `npm test 2>&1 | grep -E "^(ℹ|#) (tests|pass|fail)"` → 总数比 Task 1 之后多 5，`fail` 仍是 1 且仍是 `tests/monet-texture.mts:68` 那条既有红。特别确认 `:31`、`:38`、`:54` 三条（末尾追加不改它们的行号，它们都在文件前部）原样绿。

- [ ] **Step 6：静态闸门与提交**

Run: `npx tsc --noEmit 2>&1 | tail -3` → 107 条基线。
Run: `npx eslint src/utils/monet/backdropGate.ts` → 无输出。

```bash
git add src/utils/monet/backdropGate.ts tests/monet-gate.mts
git commit -m "feat(monet): 宽限期判据进纯表 —— 色晚到时把旧那一支原样重新发布

状态形状不变（不加 displayed/incoming 两支），所以 isSame 去重、OnCoverThemeProvider
的墨色联动、navigation.ts 的 peekCoverBackdrop 都不动。
tests/monet-gate.mts 里唯一改动的是 :44 那条的用例名与注释（断言未动）：它只描述
"没有旧层可留"这一支；:31/:38/:54 三条原样绿。过渡语义由新增的 5 条用例承担。"
```

---

### Task 6：store 负责宽限计时与 stale 投递

**Files:**
- Modify: `src/utils/monet/coverBackdropStore.ts:24-33,58-61,111-120,123-129`

**Interfaces:**
- Consumes: Task 5 的 `resolveCoverBackdrop(..., stale, withinGrace)`、`COVER_BACKDROP_GRACE_MS`、`CoverBackdropStale`。
- Produces: 组件侧无新接口；`useCoverSurface` 的返回值形状不变。`CoverBackdrop`（Task 7）靠"published 的 `picUrl` 变了"这一件事驱动叠层动画。

- [ ] **Step 1：加时钟与 stale 投递**

`src/utils/monet/coverBackdropStore.ts` 的 import 行改成把常量一起拿进来：

```ts
import { resolveCoverBackdrop, COVER_BACKDROP_GRACE_MS, type CoverBackdropState, type CoverBackdropStale } from './backdropGate'
```

模块级状态区（`retryTimer` 旁边）加两个变量与一个清理函数：

```ts
// 换到当前这首歌的时刻（ms）。宽限期从它起算，判据由表算，这里只管时钟。
let switchedAt = 0
let graceTimer: ReturnType<typeof setTimeout> | null = null

const clearGrace = () => {
  if (graceTimer != null) clearTimeout(graceTimer)
  graceTimer = null
}
```

`updateCoverBackdrop` 换成下面这版（新增 `stale` 与 `withinGrace` 两个入参、一条过期重算定时器，其余逐行保持原样）：

```ts
export function updateCoverBackdrop(dynamicBg: boolean, hasThemeBgImage: boolean, pic: string | null | undefined) {
  const url = pic ?? null
  if (url !== inputs.pic) switchedAt = Date.now()
  inputs = { dynamicBg, hasThemeBgImage, pic: url }
  // 手里那份色只在该它属于这张封面时才交进去：换歌瞬间不交，决策表就把它判成"还没有色"。
  const held = url != null && url === state.picUrl ? state.surface : null
  // 与 held 相对的另一条读法：屏幕上正在铺的那一支（可能属于上一首），它是宽限期的素材。
  const stale: CoverBackdropStale | null = state.picUrl != null && state.surface != null
    ? { picUrl: state.picUrl, surface: state.surface }
    : null
  const now = Date.now()
  const next = resolveCoverBackdrop(dynamicBg, hasThemeBgImage, url, held, stale, now - switchedAt < COVER_BACKDROP_GRACE_MS)
  if (!isSame(next, state)) publish(next)
  arm(url, next)
  // 铺着的还是别的那一首 → 到点必须自己再算一次，否则旧色会永远挂在新一首上（spec §4.6-4）。
  clearGrace()
  if (next.picUrl != null && next.picUrl !== url) {
    graceTimer = setTimeout(() => {
      graceTimer = null
      if (inputs.pic === url) updateCoverBackdrop(inputs.dynamicBg, inputs.hasThemeBgImage, url)
    }, Math.max(0, COVER_BACKDROP_GRACE_MS - (now - switchedAt)))
  }
}
```

`request()` 里那句 `publish(resolveCoverBackdrop(inputs.dynamicBg, inputs.hasThemeBgImage, picUrl, surface))`（现文件 :70）**保持四参不动**：色已经到手的那一刻没有"等不等"可言，后两个入参缺省就是"没有旧层可留"，正好。别顺手给它补 `stale`。

- [ ] **Step 2：两处收尾也要清计时器**

`resetCoverBackdrop()` 里在 `clearRetry()` 之后加 `clearGrace()`，并把 `switchedAt = 0`（翻开关后重新打开要重新起算）：

```ts
export function resetCoverBackdrop() {
  generation += 1
  clearRetry()
  clearGrace()
  switchedAt = 0
  attempts.reset()
  inputs = { dynamicBg: false, hasThemeBgImage: false, pic: null }
  publish(IDLE)
}
```

`settle()` 保持不变 —— 它经 `updateCoverBackdrop` 重新算，宽限分支自然会被再确认一次。

- [ ] **Step 3：跑测试 + 静态闸门**

Run: `npm test 2>&1 | grep -E "^(ℹ|#) (tests|pass|fail)"` → 总数不变，`fail` 仍是那 1 条既有红（本任务没有新判据，时钟不在纯表里）。
Run: `npx tsc --noEmit 2>&1 | tail -3` → 107 条基线。
Run: `npx eslint src/utils/monet/coverBackdropStore.ts` → 无输出。

- [ ] **Step 4：真机看"旧色留住了"**

`assembleRelease` → 装 vivo → 播一首有封面的歌，等它上色后切到下一首（弱网或飞行模式下更好复现）。
Expected: 切歌瞬间背景**不闪回主题底**，仍是上一首的糊封面 + 底色；最多 8s 后淡回主题底；若色晚到，仍然淡进来一次。
这一步只验 store 的判据投递；淡入淡出的动画本身要到 Task 7，此刻还是硬换（旧层会一直硬铺到过期）。

- [ ] **Step 5：提交**

```bash
git add src/utils/monet/coverBackdropStore.ts
git commit -m "feat(monet): store 起宽限计时并把屏幕上那一支当 stale 喂回决策表

只加时钟，不加判据；attempts 账本与 generation 一行未动。"
```

---

### Task 7：CoverBackdrop 先叠后撤的淡入淡出

**Files:**
- Modify: `src/components/player/CoverBackdrop/index.tsx`（整文件重写）

**Interfaces:**
- Consumes: `useCoverSurface()` 返回的 `{ picUrl, surface }`（Task 6 之后它可能仍属于上一首）；`defaultHeaders`（`@/components/common/Image`）；`ImageBackground`（`@/components/common/ImageBackground`）。
- Produces: 无对外接口。内部固定两个时长常量 `FADE_IN_MS = 380`、`FADE_OUT_MS = 260`，供真机观感复核时一处调参。

- [ ] **Step 1：整文件替换**

```tsx
import { memo, useEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'

import ImageBackground from '@/components/common/ImageBackground'
import { defaultHeaders } from '@/components/common/Image'
import { useCoverSurface } from '@/utils/monet/useCoverSurface'
import type { CoverSurface } from '@/utils/monet/surface'

const BLUR_RADIUS = 90
const FADE_IN_MS = 380
const FADE_OUT_MS = 260

interface Layer {
  /** 层身份就是封面 url：同一张封面的色在 coverPalette 里是同一份引用，不会有两个"同名不同色" */
  key: string
  surface: CoverSurface
}

interface Slot {
  layer: Layer
  show: boolean
}

/**
 * 一支层的淡入淡出。opacity 走原生驱动；动画跑完才通知父层撤槽，
 * 这样"卸载"永远发生在看不见的时候，不会留下半透明的一屏主题底。
 */
const BackdropLayer = memo(({ layer, show, onHide }: { layer: Layer, show: boolean, onHide: (key: string) => void }) => {
  const anim = useRef(new Animated.Value(0)).current
  const onHideRef = useRef(onHide)
  onHideRef.current = onHide

  useEffect(() => {
    if (show) {
      Animated.timing(anim, {
        toValue: 1,
        duration: FADE_IN_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start()
      return
    }
    Animated.timing(anim, {
      toValue: 0,
      duration: FADE_OUT_MS,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onHideRef.current(layer.key)
    })
  // 只在挂载与 show 翻转时跑；anim 与 layer 在挂载后不变
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  const source = useRef({
    uri: layer.key.startsWith('/') ? 'file://' + layer.key : layer.key,
    headers: defaultHeaders,
    cache: 'force-cache' as const,
  }).current

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: anim }]} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: layer.surface.base }]} />
      <ImageBackground style={StyleSheet.absoluteFill} source={source} resizeMode="cover" blurRadius={BLUR_RADIUS} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: layer.surface.base, opacity: layer.surface.scrimAlpha }]} />
    </Animated.View>
  )
})

/**
 * 全屏播控页的封面铺底层。
 *
 * 「闪」的根因不是缺动画，是层在"有/无"两个状态之间硬卸载 —— 改法是先叠后撤：
 * 新层叠在旧层之上淡到 1，淡到位后旧层才走退场（它在下面，退场全程不可见），
 * 所以中间帧不露主题底。两支交叉淡（线性 a=t, b=1-t）会露 25%，不要改成那样。
 *
 * 屏上该铺哪一支由 resolveCoverBackdrop 决定（含 8s 宽限期），这里只负责"它变了就淡过去"，
 * 一点判据都不写在组件里 —— 判据要能 node --test（tests/monet-gate.mts）。
 * 前景墨色读 store 里同一份 surface，底与字在同一次 publish 里一起翻。
 */
export default memo(() => {
  const { picUrl, surface } = useCoverSurface()
  const target: Layer | null = picUrl != null && surface != null ? { key: picUrl, surface } : null
  const [slots, setSlots] = useState<Slot[]>([])

  useEffect(() => {
    setSlots(prev => {
      if (target == null) return prev.map(s => ({ ...s, show: false }))
      if (prev.some(s => s.layer.key === target.key)) {
        return prev.map(s => ({ ...s, show: s.layer.key === target.key }))
      }
      // 新层叠上去；已经在淡出的那些保持淡出，别让一支退了半场的层又亮回来
      return [...prev, { layer: target, show: true }]
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picUrl, surface])

  const handleHide = (key: string) => {
    setSlots(prev => prev.filter(s => !(s.layer.key === key && !s.show)))
  }

  if (!slots.length) return null

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {slots.map(s => <BackdropLayer key={s.layer.key} layer={s.layer} show={s.show} onHide={handleHide} />)}
    </View>
  )
})
```

三条实现约束（都是踩过或读码确认的，别在 review 时改回去）：

- `opacity` 用原生驱动，`blurRadius` 是挂载时本地重跑的 postprocessor（`ReactImageView.java:222-231, 470-489`），磁盘存的是原始编码字节，所以淡入期间不会出现"色到位了但糊底还没出来"的空档。
- 需要组合透明度时不要用 `Animated.Interpolation` 的算术方法（`.subtract()` 之类不存在，首渲就崩）。
- 没上色时不铺任何不透明底色（原文件 :22-25 那段注释记的实测：会盖掉 5 个内置主题的主题背景图）。`slots` 为空时 `return null`，退场由层自己淡完再撤 —— 淡完之前 `slots.length > 0`，容器仍在。

- [ ] **Step 2：静态闸门**

Run: `npx tsc --noEmit 2>&1 | tail -3` → 107 条基线（若 `Layer` 的 `key`/`surface` 让 `CoverSurface` 类型报错，说明 `import type` 写成了值 import，改回来）。
Run: `npx eslint src/components/player/CoverBackdrop/index.tsx` → 无输出（两条 `exhaustive-deps` 已就地注明理由）。
Run: `npm test 2>&1 | grep -E "^(ℹ|#) (tests|pass|fail)"` → `fail` 仍是 1 条既有红，总数不变。

- [ ] **Step 3：真机观感复核（这条比指标优先）**

`assembleRelease` → 装 vivo，逐个过：

1. 正常网切歌：底色直接换新，中间不闪。
2. 弱网（限速或移动网络）切歌：旧色停留 ≤8s 后**淡**回主题底；色到手时淡入浮现，全程不出现"闪一下"。
3. 翻「动态背景」开关：整层淡出而不是硬切（`resetCoverBackdrop()` 发 IDLE → `target` 变 null → 全部 `show=false`）。
4. 切到一首没有封面的歌：不留旧色，同一帧淡出。
5. 打开播放页的同时取色慢到：从主题底淡进来一次。
6. 横屏一行未改（AGENTS.md）。

判不满意时的调参顺序：先动 `FADE_IN_MS`（380）与 `FADE_OUT_MS`（260），再动 `COVER_BACKDROP_GRACE_MS`（8000）；`graceMs` 低于 4000 会把慢请求误判成失败，换来"淡出再淡入"的双向变动（spec §7-5）。

- [ ] **Step 4：提交**

```bash
git add src/components/player/CoverBackdrop/index.tsx
git commit -m "feat(monet): 铺底改为先叠后撤，晚到的底色淡入而不是闪出

两支都是整屏不透明层，交叉淡会让中间帧露出主题底，所以新层淡到 1 之后才撤旧层。
判据仍在纯表里，组件只管动画与槽位。"
```

---

### Task 8：track-player 的字节预热口子（三条补丁 + JS 包装）

**Files:**
- Modify: `dependencies-patch.js`（`patchs` 数组末尾追加三条）
- Modify: `node_modules/react-native-track-player/.../player/ExoPlayback.java`、`LocalPlayback.java`、`module/MusicModule.java`（由补丁脚本改，不手改）
- Modify: `src/plugins/player/utils.ts`
- Modify: `src/plugins/player/playList.ts:12`

**Interfaces:**
- Consumes: media3 1.8.0 的 public API（javap 实测：`CacheWriter(CacheDataSource, DataSpec, byte[], ProgressListener)` + `cache()` + `cancel()`；`DataSpec(Uri, long, long)`；`CacheDataSource.Factory.setCache/setUpstreamDataSourceFactory/setFlags/createDataSource`；`CacheDataSource.close()`；`C.LENGTH_UNSET = -1`）；`LocalPlayback` 的既有成员 `cache` 与 `enableCaching`。
- Produces: 原生 `MusicModule.cacheTrack(String url, ReadableMap headers, double maxBytes, String token, Promise)`（resolve `true`/`false`，永不 reject）与 `MusicModule.cancelCacheTrack(String token)`；JS 侧 `cacheTrack(url, headers, maxBytes, token): Promise<boolean>` 与 `cancelCacheTrack(token: string | null): void`，非 Android / 补丁未重打时分别返回 `false` / 静默返回。Task 9 用它们。

- [ ] **Step 1：导出播放路径同一个 UA**

`src/plugins/player/playList.ts:12`：

```ts
// 预热带同一个 UA（cacheTrack 走的是与 Track.java:137-170 同源的 DefaultHttpDataSource），
// 两个值一旦分叉，带校验的源就会"播得出、预热带不进"。
export const defaultUserAgent = 'Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Mobile Safari/537.36'
```

（只是把既有 `const` 加上 `export`，字符串一个字都不改。）

- [ ] **Step 2：加三条补丁**

`dependencies-patch.js` 的 `patchs` 数组里，`metro-file-map` 那条之前插入。三条都靠负向前瞻幂等，锚点用 `\r?\n` 容忍 CRLF：

```js
  // 音频字节预热：ExoPlayback 声明两个口子，LocalPlayback 用手里那份 SimpleCache 实现。
  // 默认实现只 resolve(false)，所以补丁只重打了 LocalPlayback 那半时也只是"这项功能熄火"，不会崩。
  [
    path.join(rootPath, trackPlayerService, 'player/ExoPlayback.java'),
    /(    public int getAudioSessionId\(\) \{[\s\S]{0,400}?\r?\n    \})(?![\s\S]{0,600}?cacheTrack)/,
    [
      '$1',
      '',
      '    /**',
      '     * Downloads bytes for the next track into the same cache playback uses, so switching',
      '     * to it stops re-fetching from the network. Default: nothing to cache into.',
      '     */',
      '    public void cacheTrack(String url, com.facebook.react.bridge.ReadableMap headers,',
      '                           double maxBytes, String token, com.facebook.react.bridge.Promise promise) {',
      '        if(promise != null) promise.resolve(false);',
      '    }',
      '',
      '    public void cancelCacheTrack(String token) {',
      '',
      '    }',
    ].join('\n'),
  ],
  [
    path.join(rootPath, trackPlayerService, 'player/LocalPlayback.java'),
    /(    public void isCached\(String url, Promise promise\) \{[\s\S]{0,400}?\r?\n    \})(?![\s\S]{0,200}?cancelCacheTrack)/,
    [
      '$1',
      '',
      '    // token -> writer，供 cancelCacheTrack 用；用户跳走时早点收摊，省流量。',
      '    private final java.util.concurrent.ConcurrentHashMap<String, androidx.media3.datasource.cache.CacheWriter>',
      '            cacheWriters = new java.util.concurrent.ConcurrentHashMap<>();',
      '',
      '    private static java.util.Map<String, String> headerMap(com.facebook.react.bridge.ReadableMap headers) {',
      '        java.util.Map<String, String> map = new java.util.HashMap<>();',
      '        if(headers == null) return map;',
      '        com.facebook.react.bridge.ReadableMapKeySetIterator it = headers.keySetIterator();',
      '        while(it.hasNextKey()) {',
      '            String key = it.nextKey();',
      '            if(headers.getType(key) == com.facebook.react.bridge.ReadableType.String) {',
      '                String value = headers.getString(key);',
      '                if(value != null) map.put(key, value);',
      '            }',
      '        }',
      '        return map;',
      '    }',
      '',
      '    public void cacheTrack(String url, com.facebook.react.bridge.ReadableMap headers,',
      '                           double maxBytes, final String token, final Promise promise) {',
      '        // 只能用播放器这一份 cache：同目录再起一个 SimpleCache 会撞实例锁（SimpleCache.isCacheFolderLocked）。',
      '        if(cache == null || url == null || url.isEmpty() || token == null) {',
      '            promise.resolve(false);',
      '            return;',
      '        }',
      '        final long byteLimit = (long) maxBytes;',
      '        final java.util.Map<String, String> requestHeaders = headerMap(headers);',
      '        final android.net.Uri target = android.net.Uri.parse(url);',
      '        Thread worker = new Thread(() -> {',
      '            androidx.media3.datasource.cache.CacheDataSource cacheDataSource = null;',
      '            try {',
      '                // 与 Track.toMediaSource 里那条播放路径同一套请求头配置，',
      '                // 否则带 referer / UA 校验的源会 403，白下一趟。',
      '                androidx.media3.datasource.DefaultHttpDataSource.Factory upstream =',
      '                        new androidx.media3.datasource.DefaultHttpDataSource.Factory()',
      '                                // 与 Track.java:165-166 播放路径逐字一致：这两个常量挂在 DefaultHttpDataSource 上（各 8000）,',
      '                                // HttpDataSource 接口里没有, 写成 HttpDataSource.XXX 编译不过。',
      '                                .setConnectTimeoutMs(androidx.media3.datasource.DefaultHttpDataSource.DEFAULT_CONNECT_TIMEOUT_MILLIS)',
      '                                .setReadTimeoutMs(androidx.media3.datasource.DefaultHttpDataSource.DEFAULT_READ_TIMEOUT_MILLIS)',
      '                                .setAllowCrossProtocolRedirects(true);',
      '                String userAgent = requestHeaders.remove("User-Agent");',
      '                if(userAgent != null && !userAgent.isEmpty()) upstream.setUserAgent(userAgent);',
      '                if(!requestHeaders.isEmpty()) upstream.setDefaultRequestProperties(requestHeaders);',
      '                cacheDataSource = new androidx.media3.datasource.cache.CacheDataSource.Factory()',
      '                        .setCache(cache)',
      '                        .setUpstreamDataSourceFactory(upstream)',
      '                        .setFlags(androidx.media3.datasource.cache.CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)',
      '                        .createDataSource();',
      '                // maxBytes <= 0 表示整首，交给 LENGTH_UNSET，别用"很大的正数"糊弄。',
      '                androidx.media3.datasource.DataSpec dataSpec = new androidx.media3.datasource.DataSpec(',
      '                        target, 0, byteLimit > 0 ? byteLimit : androidx.media3.common.C.LENGTH_UNSET);',
      '                androidx.media3.datasource.cache.CacheWriter writer =',
      '                        new androidx.media3.datasource.cache.CacheWriter(',
      '                                cacheDataSource, dataSpec, new byte[64 * 1024],',
      '                                // javap 实测：CacheWriter$ProgressListener 只有 onProgress(long, long, long)，',
      '                                // 第三个参数是 media3 的 removal action 码，不是可选的 —— 少写一个参数编译就红。',
      '                                // 预热不需要进度回报，空实现即可。',
      '                                (cachedBytes, totalBytes, removalAction) -> { });',
      '                cacheWriters.put(token, writer);',
      '                writer.cache();',
      '                cacheWriters.remove(token);',
      '                promise.resolve(true);',
      '            } catch(Throwable t) {',
      '                cacheWriters.remove(token);',
      '                Log.d("LocalPlayback", "cacheTrack failed: " + t);',
      '                promise.resolve(false);',
      '            } finally {',
      '                // 必须关：CacheDataSource 不 close 会让这条 cache key 一直被锁着。',
      '                // cache() 自己关过一次也再来一次，close() 重复调用是幂等的。',
      '                if(cacheDataSource != null) {',
      '                    try { cacheDataSource.close(); } catch(java.io.IOException ignored) { }',
      '                }',
      '            }',
      '        }, "TrackPlayerCacheTrack");',
      '        worker.setDaemon(true);',
      '        worker.start();',
      '    }',
      '',
      '    public void cancelCacheTrack(String token) {',
      '        if(token == null) return;',
      '        androidx.media3.datasource.cache.CacheWriter writer = cacheWriters.remove(token);',
      '        if(writer != null) writer.cancel();',
      '    }',
    ].join('\n'),
  ],
  [
    path.join(rootPath, trackPlayerModule, 'MusicModule.java'),
    /(    public void isCached\(String url, final Promise callback\) \{[\s\S]{0,300}?\r?\n    \})(?![\s\S]{0,600}?cacheTrack)/,
    [
      '$1',
      '',
      '    @ReactMethod',
      '    public void cacheTrack(String url, ReadableMap headers, double maxBytes, String token,',
      '                           final Promise callback) {',
      '        waitForConnection(() -> {',
      '            binder.getPlayback().cacheTrack(url, headers, maxBytes, token, callback);',
      '        });',
      '    }',
      '',
      '    @ReactMethod',
      '    public void cancelCacheTrack(String token) {',
      '        waitForConnection(() -> {',
      '            binder.getPlayback().cancelCacheTrack(token);',
      '        });',
      '    }',
    ].join('\n'),
  ],
```

两条容易踩的：超时常量挂在 `DefaultHttpDataSource`（`DEFAULT_CONNECT_TIMEOUT_MILLIS` / `DEFAULT_READ_TIMEOUT_MILLIS`，javap 实测各 8000），`HttpDataSource` 接口上并没有这两个名字，写错就编译不过 —— 上面刻意与 `Track.java:165-166` 逐字一致。另一条是 LocalPlayback 那条前瞻为什么盯 `cancelCacheTrack` 而不是 `cacheTrack`：插入块里第一处小写 `cacheTrack` 在方法签名上，距锚点 600 多字符，`{0,300}` 够不着，重跑脚本会把整段方法再插一遍（重复定义、编译红）；`cancelCacheTrack` 出现在紧跟锚点的首行注释里，才是可靠的"已打过"标记。

- [ ] **Step 3：打补丁并验命中**

Run: `node dependencies-patch.js 2>&1 | grep -i "trackplayer\|failed"`
Expected: 三个文件都出现 `Patching ...`。（脚本对"没匹配上"和"已打过"打同一句话，所以还要自己确认一次：）
Run: `grep -c "cacheTrack" node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/player/LocalPlayback.java node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/module/MusicModule.java node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/player/ExoPlayback.java`
Expected: 三个文件都 ≥ 2（声明 + 调用都在）。
Run: `node dependencies-patch.js >/dev/null && grep -c "cacheWriters" node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/player/LocalPlayback.java`
Expected: 数字与上一次相同（负向前瞻生效，重跑不重复插入）。

- [ ] **Step 4：编译 Java**

Run: `cd android && ./gradlew.bat compileDebugJavaWithJavac`
Expected: `BUILD SUCCESSFUL`。这一步会真编译 track-player 的 Java，签名/超时/`ProgressListener` 的 lambda 形状只要错就红。
（`ProgressListener` 的 lambda 已按 javap 实测写成三参数 `(cachedBytes, totalBytes, removalAction)`；若编译仍报签名不符，说明本地 media3 版本与勘查时不同，按编译器给出的形状改，并把结论订正回这一条。）

- [ ] **Step 5：JS 包装（特性检测）**

`src/plugins/player/utils.ts` 末尾追加：

```ts
import { NativeModules, Platform } from 'react-native'

/** 预热音频字节到播放器正在用的那份缓存里；maxBytes <= 0 表示整首。
 *  补丁没重打、iOS、缓存被关掉时都返回 false，不抛（这项功能自己熄火，其余预热不受牵连）。 */
export const cacheTrack = async(url: string, headers: Record<string, string>, maxBytes: number, token: string): Promise<boolean> => {
  if (Platform.OS !== 'android' || !url.startsWith('http')) return false
  const musicModule = NativeModules.MusicModule as { cacheTrack?: (url: string, headers: Record<string, string>, maxBytes: number, token: string) => Promise<boolean> }
  if (!musicModule?.cacheTrack) return false
  try {
    return await musicModule.cacheTrack(url, headers, maxBytes, token) === true
  } catch (e) {
    if (__DEV__) console.log('[player] cacheTrack failed', url, e)
    return false
  }
}

export const cancelCacheTrack = (token: string | null) => {
  if (!token) return
  const musicModule = NativeModules.MusicModule as { cancelCacheTrack?: (token: string) => void }
  if (!musicModule?.cancelCacheTrack) return
  try {
    musicModule.cancelCacheTrack(token)
  } catch (e) {
    if (__DEV__) console.log('[player] cancelCacheTrack failed', token, e)
  }
}
```

（`NativeModules` / `Platform` 若文件顶部已经 import 过，就用既有的那行，不要重复。）

- [ ] **Step 6：静态闸门与提交**

Run: `npx tsc --noEmit 2>&1 | tail -3` → 107 条基线。
Run: `npx eslint src/plugins/player/utils.ts src/plugins/player/playList.ts dependencies-patch.js` → 无输出。

```bash
git add dependencies-patch.js src/plugins/player/utils.ts src/plugins/player/playList.ts
git commit -m "feat(preload): track-player 补丁开 cacheTrack/cancelCacheTrack 口子，复用播放器那份 SimpleCache

同目录第二个 SimpleCache 会撞实例锁，所以只能补依赖；ExoPlayback 的默认实现
resolve(false)，补丁漂移时这项自己熄火。UA 与播放路径同源（playList.ts:12）。"
```

---

### Task 9：执行器接上音频字节（档位、作废、P-2）

**Files:**
- Modify: `src/core/init/player/preloadNextMusic.ts`（`state` 加 token、`bump()` 取消、`warmAudio` 末尾下发字节）

**Interfaces:**
- Consumes: Task 8 的 `cacheTrack` / `cancelCacheTrack`、Task 1 的 `audioMaxBytes` / `AUDIO_HEAD_BYTES`；既有 `warmAudio` 已经算好了可用的 `url`。
- Produces: 无对外新接口。

- [ ] **Step 1：让 warmAudio 把 url 交回来**

`warmAudio` 的签名改成返回直链（拿不到就返回 `''`），末尾 `return url`：

```ts
const warmAudio = async(target: LX.Player.PlayMusicInfo): Promise<string> => {
  const generation = state.generation
  let url = await getMusicUrl({ musicInfo: target.musicInfo }).catch(() => '')
  if (!url || generation !== state.generation) return ''
  const [cached, available] = await Promise.all([
    isCached(url),
    checkUrl(url).then(() => true).catch(() => false),
  ])
  if (!cached && !available) {
    const fresh = await getMusicUrl({ musicInfo: target.musicInfo, isRefresh: true }).catch(() => '')
    if (generation !== state.generation) return ''
    if (fresh) url = fresh
  }
  return url
}
```

`runStep` 的 `'audio'` 分支改成拿到 url 再下字节：

```ts
      case 'audio': {
        const url = await warmAudio(target)
        if (!url || generation !== state.generation) return
        // 档位与缓存在发起这一刻再读一次：从解析到这一步中间有 3s 反悔窗口，
        // 期间用户可能已经把档切成 off 或把缓存清成 0。
        const currentFlags = flags()
        if (currentFlags.audioTier === 'off' || !currentFlags.cacheEnabled) return
        state.audioToken = `${target.musicInfo.id}|${generation}`
        await cacheTrack(url, { 'User-Agent': defaultUserAgent }, audioMaxBytes(currentFlags.audioTier), state.audioToken)
        break
      }
```

- [ ] **Step 2：state 与 bump 管住 token**

`state` 里加一行，并在 `reset()` 里清掉：

```ts
  /** 在途的字节预热任务标识，切歌时据此让原生那条读循环收摊 */
  audioToken: null as string | null,
```

```ts
const bump = () => {
  state.generation++
  cancelCacheTrack(state.audioToken)
  reset()
}
```

`reset()` 里加 `state.audioToken = null`（`cancelCacheTrack` 已在 `bump()` 里先调，顺序别反：先取消再清空，否则取消不到在途那条）。

import 区两条**就地改写**、一条新增（`isCached` 与 `buildPreloadPlan` 那两行 Task 3 已经写过了，新加一行会得到重复标识符，必须在原行上加名字）：

```ts
import { isCached, cacheTrack, cancelCacheTrack } from '@/plugins/player/utils'   // 改写：后两个是本任务加的
import { buildPreloadPlan, audioMaxBytes, type PreloadStep } from '@/core/player/preloadPlan'   // 改写：audioMaxBytes 本任务加的
import { defaultUserAgent } from '@/plugins/player/playList'   // 新增
```

- [ ] **Step 3：静态闸门**

Run: `npx tsc --noEmit 2>&1 | tail -3` → 107 条基线。
Run: `npx eslint src/core/init/player/preloadNextMusic.ts` → 无输出。
Run: `npm test 2>&1 | grep -E "^(ℹ|#) (tests|pass|fail)"` → `fail` 仍是 1 条既有红、总数不变（档位与缓存的判据都在 Task 1 的表里，已覆盖）。

- [ ] **Step 4：探针 P-2（真机）**

`assembleRelease`（ETA 2–3 分钟）→ 装 vivo → 播第一首等到剩 60s 内。
临时在 `runStep` 的 `'audio'` 分支后面加一行 `if (__DEV__) console.log('[preload] cached', await isCached(url))`（或直接用 debug 包跑）：

1. `cacheTrack` 返回后 `isCached(url)` 为 `true` ⇒ 字节确实写进了缓存（spec §6 P-2 的第一半）。
2. 切到那一首，观察 `loadstart → playing` 的实测体感：起播应明显快于关闭预热时（可对比：把档位设 `'off'` 重放一次同一条 url）。
3. 切到 `'full'` 档再验一次：整首下完，`isCached` 仍为真，播完不重复请求。
4. 快速连点下一首 5 次：`adb logcat -s ReactNativeJS` 不应出现 `[player] cacheTrack failed`，也不应看到同一 token 被重复下（流量可在系统设置里核对）。

Expected: 四条全过。第 1 条不过 ⇒ 缓存 key 与播放路径不同源，回头读 `CacheDataSource` 的 `CacheKeyFactory`；判不清就把 `audio` 这步删掉，前四步照旧交付。

- [ ] **Step 5：提交**

```bash
git add src/core/init/player/preloadNextMusic.ts
git commit -m "feat(preload): 音频字节预热接进执行器，默认 8MB，切歌即取消

发起那一刻再读一次档位与缓存（反悔窗口里设置可能变了）；token 带代数，
bump 时先 cancelCacheTrack 再 reset。P-2 探针结果记在计划步骤里。"
```

---

### Task 10：收尾验证与交付说明

**Files:**
- Modify: 无（只跑闸门与补文档状态）
- Modify: `docs/superpowers/specs/2026-10-15-preload-next-music-design.md:3`（状态行从「待实现」改成实际状态，并记三条偏离）

- [ ] **Step 1：全套闸门一次跑完**

```bash
npm test 2>&1 | grep -E "^(ℹ|#) (tests|pass|fail)"
npx tsc --noEmit 2>&1 | tail -3
npm run lint 2>&1 | tail -20
cd android && ./gradlew.bat compileDebugJavaWithJavac
```

Expected: `tests 529 / pass 528 / fail 1`，且那 1 条仍是 `tests/monet-texture.mts:68`（Global Constraints 的既有红，不是本功能引入的）；tsc 107 条基线；lint 对本次改到的文件零告警（其它文件的既有告警不属于本功能，别顺手修）；`BUILD SUCCESSFUL`。

- [ ] **Step 2：逐条对 spec 的验收清单**

- [ ] 预热四项（封面 URL / 封面字节 / 歌词 / 背景色）在剩 60s 时发起，`npm test` 里每条都有对应分支。
- [ ] 音频字节按档位发，`'off'`、缓存大小为 0（`player.cacheSize` 为 `'0'` 或空串，与 Task 3 `flags()` 的 parseInt 判据同式）、本地曲、下载曲四种情形都不发。
- [ ] `preloadNextMusic=false` 时五步全不发（Task 1 用例）。
- [ ] 目标恒为一个，代码里不存在"下两首"的路径（`grep -n "nextMusicInfo\|下两首" src/core/init/player/preloadNextMusic.ts`）。
- [ ] 切到没有封面的歌不刷旧色（Task 5 用例 + 真机第 4 项）。
- [ ] 弱网底色停留 ≤8s 后淡回主题底，晚到的色淡入一次（真机第 2、5 项）。
- [ ] 翻「动态背景」开关是淡出（真机第 3 项）。
- [ ] 横屏与 `PlayerOverlay` 一行未改：`git diff --stat $BASE -- src/components/player/PlayerOverlay src/screens/PlayDetail/Horizontal` 为空。
- [ ] 纹理层仍未接线：`grep -rn "getCoverTexture(" src/components src/screens` 无命中。
- [ ] 无新依赖：`git diff $BASE -- package.json` 只在 `test` 脚本那一行有变化（`$BASE` 从 Task 1 提交信息里那行 `BASE:` 取；对着 `main` 比会把 `@material/material-color-utilities`、`react-native-webview` 这些本分支早就算好的改动一起算进来，这条会必然假红）。

- [ ] **Step 3：更新 spec 状态行**

把 `docs/superpowers/specs/2026-10-15-preload-next-music-design.md:3` 的状态改成实际结果，并在文末追加一节「落地与偏离」，把本计划第二节那三条偏离连同真机结论（P-1/P-2 是否过、观感是否满意）写进去。这一步是为了下一次读这份文件时不会被"spec 说要改 :44""spec 说要加 displayed/incoming"误导。

- [ ] **Step 4：提交**

```bash
git add docs/superpowers/specs/2026-10-15-preload-next-music-design.md
git commit -m "docs(preload): spec 补落地状态与三条偏离（不改状态形状、:44 无需改写、10s 兜底被 60s 包含）"
```

---

## Self-Review（写完后对照 spec 的检查结果）

**1. Spec 覆盖**：§4.1 → Task 1 + 3；§4.2 → Task 1（触发档位）+ Task 3（代数作废）；§4.3 三步 → Task 3；§4.4 → Task 4；§4.5 → Task 8 + 9；§4.6 → Task 5 + 6 + 7；§4.7 → Task 2；§5 边界表每一行都落在 Task 1（表分支）、Task 3（本地/下载、tempPlayList、失败不重试）、Task 4（`file://` 不预热）、Task 5/6（无封面不留旧层、宽限过期、晚到仍淡入）、Task 8/9（iOS 与补丁漂移 no-op、缓存大小为 0）里；§6 测试四组 → Task 1（新增 14 条）、Task 5（新增 5 条）、Task 6/8（静态闸门）、Task 4/9/10（真机 P-1/P-2 与观感）。§7 逃生口都有落点：补丁漂移（Task 8 Step 5 的特性检测）、缓存实例（Task 8 Step 2 只用 `cache` 成员）、403（Task 8 Step 1 的 UA 同源）、流量（Task 2 档位 + Task 9 取消）、graceMs 调整（Task 7 Step 3 末尾的调参顺序）、列表抖动（Task 3 Step 3 的 `listId` 逃生口）。§8「明确不做」逐条落到 Global Constraints 与 Task 10 Step 2 的 grep 检查。

**2. 占位符扫描**：全文无 TBD/待补；唯一"留空"是 Task 3 的 `case 'coverBytes': break`，那是有意的中间态并在同一笔提交信息里点名由下一笔填。Task 4 Step 5 与 Task 8 Step 4 各有一条"以编译/探针结果为准"的分支，都给了具体替代实现或修正动作，不是 TBD。

**3. 类型一致性**：`PreloadStep` / `PreloadFlags` / `buildPreloadPlan` / `audioMaxBytes` 在 Task 1 定义、Task 3/9 按同名同型消费；`PreloadAudioTier` 的字面量与 Task 2 设置键的联合逐字一致（`'off' | 'head' | 'full'`）；`CoverBackdropStale`（Task 5 定义）与 Task 6 里构造的 `{ picUrl, surface }` 同型；`prefetchCoverImage(url, headers)`（Task 4）与 Task 3/4 调用点参数顺序一致；`cacheTrack(url, headers, maxBytes, token)`（Task 8）与 Task 9 调用点一致；`audioMaxBytes` 返回 `0` 表示整首，与 Task 8 Java 侧 `byteLimit > 0 ? byteLimit : C.LENGTH_UNSET` 对齐。

**4. 这一轮自审复现出来、已经当场订正的八处**（数字与签名都是量过的，执行时不用再验一遍，但别改回去）：

- `CacheWriter$ProgressListener` 只有 `onProgress(long, long, long)` —— Task 8 的 lambda 从两参改成三参。
- 超时常量挂在 `DefaultHttpDataSource`（各 8000），`HttpDataSource` 接口上没有 `MIN_PARAMATER_CONNECT_TIMEOUT_MILLIS` / `DEFAULT_READ_TIMEOUT_MILLIS` —— 原写法会直接编译红，现与 `Track.java:165-166` 逐字一致。
- `CacheWriter(CacheDataSource, DataSpec, byte[], ProgressListener)`、`DataSpec(Uri, long, long)`、`CacheDataSource.Factory.setCache/setUpstreamDataSourceFactory/setFlags/createDataSource`、`CacheDataSource.close()` 全部对本地 AAR `javap` 命中，Task 8 Interfaces 那串签名就是实测结果。
- LocalPlayback 那条补丁的幂等前瞻原来盯 `cacheTrack`（`{0,300}` 够不着，重跑会重复插入）—— 改盯首行注释里的 `cancelCacheTrack`。
- 单测基线：实测 `tests 510 / pass 509 / fail 1`，既有那条红在 `tests/monet-texture.mts:68`；`tests/monet-gate.mts` 现有 **8** 条（计划原写 6 条），Task 5 追加 **5** 条（原写 3 条）→ 13 条，整仓 529。汇总前缀随 reporter 变，`grep "^# pass"` 一律换成 `grep -E "^(ℹ|#) (tests|pass|fail)"`。
- `cacheEnabled` 原写 `!== '0'`：`player.cacheSize` 是字符串且空串同样让 `player.ts:248` 算出 0，改成 `parseInt(... || '0') > 0`，与 `LocalPlayback` 是否建 `SimpleCache` 同判据。
- Task 3 重写后的执行器不再读 `playerState`（进度从 `playProgressChanged` 入参拿），那行 import 留着就是未使用导入，`npx eslint` 直接判红 —— 已在 import 清单里删掉并写进"四处不同"。
- Task 10 原来用 `git diff main` 证明"无新依赖 / 横屏未改"，实测 `main` 落后本分支几十个提交，`package.json` 对 `main` 已经多了 `@material/material-color-utilities`、`react-native-webview`、`svg2ttf` 等依赖与整条 `test` 脚本变化 —— 那条判据对 `main` 必假红，改成对开工前记下的 `BASE` 比（Global Constraints 最后一条 + Task 1 Step 1）。
