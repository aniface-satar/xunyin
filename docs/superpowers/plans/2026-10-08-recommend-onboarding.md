# 推荐页首次进入偏好问卷 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 推荐 tab 首次进入显示两题偏好问卷（一列选项 + 滑条调百分比），百分比作为先验注入 themeWeights 与关键词池，电台/探索/新歌速递/推荐歌单四个出口联动。

**Architecture:** 新增纯模块 `onboarding.ts`（选项表、百分比→种子权重、加减回退）；状态落 `RecommendationState.onboarding`（v7 迁移）；引擎门面加 `getOnboardingView/submitOnboarding`；注入点仅两处（`buildCuratedKeywords` 与 `candidate.ts` keywordPool）；UI 是 Recommend 视图内一个门控组件。

**Tech Stack:** TypeScript、React Native（@react-native-community/slider，已是项目依赖）、node:test（`--experimental-strip-types`）、AsyncStorage（经 storage.ts）。

**Spec:** `docs/superpowers/specs/2026-10-08-recommend-onboarding-design.md`

## Global Constraints

- **不执行任何 `git commit`/`git add`**：仓库当前有整套未提交、待真机验收的推荐功能 WIP（本计划要改的 `src/core/recommend/index.ts`、`types.ts`、`stateSchema.ts`、`candidate.ts`、`package.json`、lang 文件等都处于 modified 状态），staging 会把 WIP 一并卷入；全部改动完成后由用户在真机验收后自行提交。
- portrait-only（AGENTS.md）：滑条行布局不得依赖横屏分支。
- 文案三语同步：`src/lang/zh-cn.json`、`src/lang/zh-tw.json`、`src/lang/en-us.json` 每处新 key 三个文件一起加。
- 测试约束（项目既有坑）：node 单测导入 src 模块时相对路径必须带 `.ts` 扩展；`tests/*.mts` 被 ESLint 按 JS 解析，**测试代码里不能写 TS 类型注解/非空断言**。
- 等号风格：src 代码用 `==`/`!=`（项目 eslint 允许），跟随现有文件。
- 验证闸门：`node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-onboarding.mts` + `npx eslint <改动文件>` + `npx tsc --noEmit`（node_modules 有一处既有报错属基线，只看 recommend 相关路径零新增报错）。

---

### Task 1: 纯模块 `src/core/recommend/onboarding.ts` + 单测

**Files:**
- Create: `src/core/recommend/onboarding.ts`
- Create: `tests/recommend-onboarding.mts`
- Modify: `package.json`（`scripts.test` 追加测试文件）

**Interfaces:**
- Consumes: `recommendationConfig.themeFeedback.saturation`（config.ts:151 附近，当前值 4）、`createThemePreference(themeId, now)`（feedback.ts:290）、`normalizeText`（trackKey.ts:6）、`ThemePreference`（types.ts:59）。
- Produces（Task 2/3/4 依赖的确切签名）:
  - `type OnboardingQuestion = 'language' | 'genre'`
  - `interface OnboardingOption { id: string, question: OnboardingQuestion, aliases: string[] }`
  - `const ONBOARDING_OPTIONS: readonly OnboardingOption[]`
  - `sanitizeWeights(weights: Record<string, number>): Record<string, number>`
  - `computeSeedWeights(weights: Record<string, number>): Record<string, number>`
  - `applySeedWeights(themes: Record<string, ThemePreference>, seeds: Record<string, number>, now?: number): void`
  - `revokeSeedWeights(themes: Record<string, ThemePreference>, seeds: Record<string, number>): void`
  - `computePreferenceKeywords(weights: Record<string, number>): string[]`
  - `mergePreferenceKeywords(profileKeywords: readonly string[], preferenceKeywords: readonly string[]): string[]`

- [ ] **Step 1: 写失败测试**

创建 `tests/recommend-onboarding.mts`（本任务先建前 6 个用例；Task 2 会往同一文件追加迁移用例）：

```mts
import test from 'node:test'
import assert from 'node:assert/strict'

import { ONBOARDING_OPTIONS, sanitizeWeights, computeSeedWeights, applySeedWeights, revokeSeedWeights, computePreferenceKeywords, mergePreferenceKeywords } from '../src/core/recommend/onboarding.ts'
import { pickPlaylistTag } from '../src/core/recommend/tabSections.ts'

test('sanitizeWeights drops invalid ids, clamps and rounds to tens, removes zeros', () => {
  const out = sanitizeWeights({ zh: 50, bogus: 80, pop: 105, rock: -20, folk: 35, jazz: 0 })
  assert.deepEqual(out, { zh: 50, pop: 100, folk: 40 })
})

test('computeSeedWeights keys are normalized aliases and values scale with percent', () => {
  const seeds = computeSeedWeights({ western: 100, jazz: 50 })
  assert.equal(seeds['欧美'], 4)
  assert.equal(seeds['英文'], 4)
  assert.equal(seeds['爵士'], 2)
  assert.equal(seeds['r&b'], undefined)
})

test('computeSeedWeights takes the max when two options share an alias key', () => {
  const seeds = computeSeedWeights({ electronic: 100, dj: 20 })
  assert.equal(seeds['dj'], 4)
})

test('applySeedWeights adds onto existing positive and keeps negative', () => {
  const themes = { 欧美: { themeId: '欧美', positiveWeight: 1, negativeWeight: 2, lastDecayTime: 0, lastUsedTime: 0 } }
  applySeedWeights(themes, { 欧美: 4, 民谣: 2 }, 1000)
  assert.equal(themes['欧美'].positiveWeight, 5)
  assert.equal(themes['欧美'].negativeWeight, 2)
  assert.equal(themes['民谣'].positiveWeight, 2)
  assert.equal(themes['民谣'].themeId, '民谣')
})

test('revokeSeedWeights subtracts only the seeded component and drops cleared entries', () => {
  const themes = {
    欧美: { themeId: '欧美', positiveWeight: 6, negativeWeight: 0, lastDecayTime: 0, lastUsedTime: 0 },
    英文: { themeId: '英文', positiveWeight: 1, negativeWeight: 0, lastDecayTime: 0, lastUsedTime: 0 },
    西洋: { themeId: '西洋', positiveWeight: 4, negativeWeight: 3, lastDecayTime: 0, lastUsedTime: 0 },
  }
  revokeSeedWeights(themes, { 欧美: 4, 英文: 4, 西洋: 4 })
  assert.equal(themes['欧美'].positiveWeight, 2)
  assert.equal(themes['英文'], undefined)
  assert.equal(themes['西洋'].positiveWeight, 0)
  assert.equal(themes['西洋'].negativeWeight, 3)
  revokeSeedWeights(themes, { 英文: 4 })
})

test('computePreferenceKeywords keeps >=20 percent options sorted by weight desc', () => {
  assert.deepEqual(computePreferenceKeywords({ ko: 20, zh: 80, pop: 80, rock: 10 }), ['华语', '流行', '韩语'])
  assert.deepEqual(computePreferenceKeywords({}), [])
})

test('mergePreferenceKeywords puts preference words first without duplicates', () => {
  assert.deepEqual(mergePreferenceKeywords(['周杰伦', '华语'], ['华语', '说唱']), ['华语', '说唱', '周杰伦'])
})

test('pickPlaylistTag prefers a seeded category in the learning rotation', () => {
  const tags = [
    { id: '1', name: '华语' },
    { id: '2', name: '欧美' },
    { id: '3', name: '古风' },
  ]
  const themes = {}
  applySeedWeights(themes, computeSeedWeights({ western: 100 }), 1000)
  const picked = tags.filter(tag => pickPlaylistTag(tags, themes, [], 0, 1000)?.id == tag.id
    || pickPlaylistTag(tags, themes, [], 1, 1000)?.id == tag.id
    || pickPlaylistTag(tags, themes, [], 2, 1000)?.id == tag.id)
  assert.ok(picked.every(tag => tag.name == '欧美'))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-onboarding.mts`
Expected: FAIL —— `Cannot find module ... onboarding.ts`

- [ ] **Step 3: 实现 onboarding.ts**

```ts
import { recommendationConfig } from './config.ts'
import { createThemePreference } from './feedback.ts'
import { normalizeText } from './trackKey.ts'
import type { ThemePreference } from './types.ts'

/**
 * 首次进入推荐页的偏好问卷：纯数据与纯函数。
 * 选项 id 是持久化键（onboarding.weights），标签文案在 lang（recommend_onboarding_opt_<id>）。
 * aliases[0] 为规范词（进关键词池做包含匹配），全量 aliases 归一化后作为 themeWeights 的精确键——
 * 各音源分类目录叫法不一（欧美/英文/西洋），多别名各占一键，同名 tag 才会吃到净权。
 */

export type OnboardingQuestion = 'language' | 'genre'

export interface OnboardingOption {
  id: string
  question: OnboardingQuestion
  aliases: string[]
}

export const ONBOARDING_OPTIONS: readonly OnboardingOption[] = [
  { id: 'zh', question: 'language', aliases: ['华语', '国语', '中文', '内地'] },
  { id: 'cantonese', question: 'language', aliases: ['粤语', '广东歌'] },
  { id: 'western', question: 'language', aliases: ['欧美', '英文', '英语', '西洋'] },
  { id: 'ja', question: 'language', aliases: ['日语', '日文', '日本'] },
  { id: 'ko', question: 'language', aliases: ['韩语', '韩国', 'KPOP'] },
  { id: 'other', question: 'language', aliases: ['小语种', '俄语', '法语', '德语'] },
  { id: 'pop', question: 'genre', aliases: ['流行'] },
  { id: 'rock', question: 'genre', aliases: ['摇滚', 'ROCK'] },
  { id: 'folk', question: 'genre', aliases: ['民谣'] },
  { id: 'rnb', question: 'genre', aliases: ['R&B', '节奏布鲁斯', '灵魂'] },
  { id: 'hiphop', question: 'genre', aliases: ['说唱', '嘻哈', 'HIPHOP', 'RAP'] },
  { id: 'electronic', question: 'genre', aliases: ['电子', 'EDM', '舞曲', 'DJ'] },
  { id: 'gufeng', question: 'genre', aliases: ['古风', '国风', '中国风'] },
  { id: 'acg', question: 'genre', aliases: ['二次元', 'ACG', '动漫'] },
  { id: 'light', question: 'genre', aliases: ['轻音乐', '纯音乐'] },
  { id: 'jazz', question: 'genre', aliases: ['爵士', 'JAZZ'] },
  { id: 'blues', question: 'genre', aliases: ['蓝调', '布鲁斯', 'BLUES'] },
  { id: 'metal', question: 'genre', aliases: ['金属', 'METAL'] },
  { id: 'punk', question: 'genre', aliases: ['朋克', 'PUNK'] },
  { id: 'country', question: 'genre', aliases: ['乡村', 'COUNTRY'] },
  { id: 'latin', question: 'genre', aliases: ['拉丁', 'LATIN'] },
  { id: 'dj', question: 'genre', aliases: ['DJ', 'REMIX', '串烧'] },
]

/** 只留合法 id，钳到 0-100 并取整到 10 的倍数，0 值删除。 */
export const sanitizeWeights = (weights: Record<string, number>): Record<string, number> => {
  const result: Record<string, number> = {}
  for (const option of ONBOARDING_OPTIONS) {
    const raw = weights[option.id]
    if (typeof raw != 'number' || !Number.isFinite(raw)) continue
    const percent = Math.round(Math.max(0, Math.min(100, raw)) / 10) * 10
    if (percent > 0) result[option.id] = percent
  }
  return result
}

const seedValueFor = (percent: number) => percent / 100 * recommendationConfig.themeFeedback.saturation

/** optionId→百分比 映射成 themeWeights 键→初值分量；同键多选项命中取 max。 */
export const computeSeedWeights = (weights: Record<string, number>): Record<string, number> => {
  const seeds: Record<string, number> = {}
  for (const option of ONBOARDING_OPTIONS) {
    const percent = weights[option.id]
    if (!percent) continue
    for (const alias of option.aliases) {
      const key = normalizeText(alias)
      if (!key) continue
      seeds[key] = Math.max(seeds[key] ?? 0, seedValueFor(percent))
    }
  }
  return seeds
}

/** 把初值分量加进分类净权的正反馈侧；直接改动传入 map（与状态存储共享引用）。 */
export const applySeedWeights = (
  themes: Record<string, ThemePreference>,
  seeds: Record<string, number>,
  now = Date.now(),
): void => {
  for (const [key, seed] of Object.entries(seeds)) {
    const base = themes[key] ?? createThemePreference(key, now)
    themes[key] = { ...base, positiveWeight: base.positiveWeight + seed, lastUsedTime: now }
  }
}

/** 只回退记录在案的初值分量：减后钳 0，正负皆 0 才删条目，用户反馈净权保留。 */
export const revokeSeedWeights = (
  themes: Record<string, ThemePreference>,
  seeds: Record<string, number>,
): void => {
  for (const [key, seed] of Object.entries(seeds)) {
    const pref = themes[key]
    if (!pref) continue
    const positiveWeight = Math.max(0, pref.positiveWeight - seed)
    if (positiveWeight == 0 && pref.negativeWeight == 0) delete themes[key]
    else themes[key] = { ...pref, positiveWeight }
  }
}

const MIN_KEYWORD_PERCENT = 20

/** 进关键词池的规范词：≥20% 才贡献，按百分比降序（rotation 窗口从强偏好起滑）。 */
export const computePreferenceKeywords = (weights: Record<string, number>): string[] => {
  return ONBOARDING_OPTIONS
    .filter(option => (weights[option.id] ?? 0) >= MIN_KEYWORD_PERCENT)
    .sort((a, b) => (weights[b.id] ?? 0) - (weights[a.id] ?? 0))
    .map(option => normalizeText(option.aliases[0]))
    .filter(Boolean)
}

export const mergePreferenceKeywords = (
  profileKeywords: readonly string[],
  preferenceKeywords: readonly string[],
): string[] => [...new Set([...preferenceKeywords, ...profileKeywords])]
```

注意：`electronic` 与 `dj` 共享别名 `DJ`（归一化 `dj`），用例 3 即验证该键取两个选项中较大的种子（100%→4 而非 20%→0.8）。`createThemePreference(key, now)` 的 `themeId` 用归一化键。

- [ ] **Step 4: 跑测试确认全绿**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-onboarding.mts`
Expected: PASS（8 个用例）

- [ ] **Step 5: 纳入 npm test 清单**

`package.json` 的 `scripts.test` 在 `tests/recommend-playlist-cooldown.mts` 之后追加 ` tests/recommend-onboarding.mts`。
Run: `npm test`
Expected: 全绿（含既有用例）。

- [ ] **Step 6: 静态闸门**

Run: `npx eslint src/core/recommend/onboarding.ts tests/recommend-onboarding.mts package.json`
Expected: 无输出。
不 commit（见 Global Constraints）。

---

### Task 2: 状态结构 `onboarding` + v7 迁移

**Files:**
- Modify: `src/core/recommend/types.ts`（RecommendationState:191-232）
- Modify: `src/core/recommend/stateSchema.ts`（STATE_VERSION:5、createDefaultState:7-31、migrateRecommendationState:44-86）
- Test: `tests/recommend-onboarding.mts`（追加用例）

**Interfaces:**
- Consumes: Task 1 无直接依赖。
- Produces（Task 3/4 依赖）:
  - `interface OnboardingState { completed: boolean, weights: Record<string, number>, seededThemeWeights: Record<string, number> }`
  - `RecommendationState.onboarding: OnboardingState`
  - `createDefaultOnboarding(): OnboardingState`（stateSchema.ts 导出）

- [ ] **Step 1: 追加失败迁移测试**

`tests/recommend-onboarding.mts` 顶部 import 追加：

```mts
import { createDefaultState, migrateRecommendationState } from '../src/core/recommend/stateSchema.ts'
```

文件末尾追加：

```mts
test('default state carries an unfinished onboarding', () => {
  const state = createDefaultState()
  assert.equal(state.version, 7)
  assert.deepEqual(state.onboarding, { completed: false, weights: {}, seededThemeWeights: {} })
})

test('migrating a v6 state with learning history auto-completes onboarding', () => {
  const migrated = migrateRecommendationState({ tracks: { 'kw__1': { trackKey: 'kw__1' } } })
  assert.equal(migrated.onboarding.completed, true)
  assert.deepEqual(migrated.onboarding.weights, {})
})

test('migrating an empty legacy state keeps onboarding pending', () => {
  const migrated = migrateRecommendationState({ themeWeights: {} })
  assert.equal(migrated.onboarding.completed, false)
})

test('a stored onboarding object survives migration untouched', () => {
  const migrated = migrateRecommendationState({
    onboarding: { completed: true, weights: { zh: 70 }, seededThemeWeights: { 华语: 2.8 } },
  })
  assert.deepEqual(migrated.onboarding, { completed: true, weights: { zh: 70 }, seededThemeWeights: { 华语: 2.8 } })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-onboarding.mts`
Expected: FAIL —— `state.onboarding` undefined / version 6≠7

- [ ] **Step 3: types.ts 加结构**

在 `export interface RecommendationState {`（types.ts:191）之前插入：

```ts
/** 首次进入偏好问卷：weights 为选项 id→百分比（只存 >0）；seededThemeWeights 为本轮写入 themeWeights 的初值分量，精确回退用。 */
export interface OnboardingState {
  completed: boolean
  weights: Record<string, number>
  seededThemeWeights: Record<string, number>
}
```

在 `RecommendationState` 内 `audioAnalysis` 字段之后追加：

```ts
  /** 偏好问卷状态（v7 新增）：迁移时老用户（已有学习数据）自动记为已完成。 */
  onboarding: OnboardingState
```

- [ ] **Step 4: stateSchema.ts 升版本 + 迁移**

`export const STATE_VERSION = 6` → `7`。
import 追加 `OnboardingState`：

```ts
import type { RecommendationState, PlaylistPreference, OnboardingState } from './types.ts'
```

`createDefaultState` 之前加导出（Task 3 不依赖，migrate 内部用）：

```ts
export const createDefaultOnboarding = (): OnboardingState => ({
  completed: false,
  weights: {},
  seededThemeWeights: {},
})
```

`createDefaultState` 返回对象末尾（`audioAnalysis` 之后）追加：

```ts
  onboarding: createDefaultOnboarding(),
```

`migrateRecommendationState` 内、`return` 之前加：

```ts
  const storedOnboarding = raw.onboarding
  const onboarding: OnboardingState = storedOnboarding
    ? {
      completed: !!storedOnboarding.completed,
      weights: storedOnboarding.weights ?? {},
      seededThemeWeights: storedOnboarding.seededThemeWeights ?? {},
    }
    : {
      ...createDefaultOnboarding(),
      // v7 以前没有问卷数据：已有学习数据的存量用户直接记为完成，升级不弹问卷
      completed: Object.keys(raw.tracks ?? {}).length + Object.keys(raw.themeWeights ?? {}).length > 0,
    }
```

return 对象里 `...base, ...raw,` 之后显式加 `onboarding,`（防 `...raw` 把旧形状带进来）。

- [ ] **Step 5: 跑测试确认全绿**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-onboarding.mts`
Expected: PASS（12 个用例）

- [ ] **Step 6: 闸门**

Run: `npm test` && `npx eslint src/core/recommend/types.ts src/core/recommend/stateSchema.ts tests/recommend-onboarding.mts` && `npx tsc --noEmit`
Expected: 测试全绿；eslint 无输出；tsc 无 recommend 路径新增报错。不 commit。

---

### Task 3: 引擎门面 + 关键词注入（wiring）

**Files:**
- Modify: `src/core/recommend/index.ts`（imports 区:1-33；`refreshPoolWithSource` params 构造:275-290；`buildCuratedKeywords`:1007-1010；`getProfileRevision`/`markProfileLearned` 附近:991-998）
- Modify: `src/core/recommend/candidate.ts`（CatalogRefreshParams:20-37；keywordPool 构造:259-263）

**Interfaces:**
- Consumes: Task 1 的 `sanitizeWeights/computeSeedWeights/applySeedWeights/revokeSeedWeights/computePreferenceKeywords/mergePreferenceKeywords/ONBOARDING_OPTIONS`；Task 2 的 `state.onboarding`。
- Produces（Task 4 UI 依赖）:
  - `recommendationEngine.getOnboardingView(): Promise<{ completed: boolean, weights: Record<string, number> }>`
  - `recommendationEngine.submitOnboarding(weights: Record<string, number>): Promise<boolean>`

- [ ] **Step 1: index.ts 加 import**

```ts
import { applySeedWeights, computePreferenceKeywords, computeSeedWeights, mergePreferenceKeywords, revokeSeedWeights, sanitizeWeights } from './onboarding.ts'
```

- [ ] **Step 2: index.ts 加门面方法**

放在 `getProfileRevision()`（index.ts:991）之后：

```ts
  /** 首次进入问卷：UI 据此决定渲染问答还是正常内容，并用 weights 预填滑条。 */
  async getOnboardingView(): Promise<{ completed: boolean, weights: Record<string, number> }> {
    await this.initialize()
    const onboarding = getState().onboarding
    return { completed: onboarding.completed, weights: { ...onboarding.weights } }
  }

  /**
   * 提交问卷：先撤销上一轮记录的初值分量，再按百分比写入新一轮。
   * 空选择＝跳过（completed=true、无种子）；状态未就绪返回 false，让 UI 保留问卷下次重试。
   */
  async submitOnboarding(weights: Record<string, number>): Promise<boolean> {
    await this.initialize()
    if (!this.stateReady) return false
    const state = getState()
    const sanitized = sanitizeWeights(weights)
    revokeSeedWeights(state.themeWeights, state.onboarding.seededThemeWeights)
    const seeds = computeSeedWeights(sanitized)
    applySeedWeights(state.themeWeights, seeds)
    state.onboarding = { completed: true, weights: sanitized, seededThemeWeights: seeds }
    this.markProfileLearned()
    trimState()
    saveState()
    return true
  }
```

- [ ] **Step 3: 关键词注入两处**

`buildCuratedKeywords`（index.ts:1007-1010）整体替换：

```ts
  private async buildCuratedKeywords(): Promise<string[]> {
    const profile = await this.buildCurrentProfile()
    return mergePreferenceKeywords(
      buildPlaylistKeywords(profile, 8, getLearnedStyleTokens(getState().tokenWeights, 3)),
      computePreferenceKeywords(getState().onboarding.weights),
    )
  }
```

`refreshPoolWithSource` 的 params 对象（index.ts:275-290，`rotation` 行之前）追加：

```ts
        explicitKeywords: computePreferenceKeywords(state.onboarding.weights),
```

`candidate.ts` 的 `CatalogRefreshParams`（`budget?: number` 之后）追加：

```ts
  /** 偏好问卷规范词（按强度降序），插在画像关键词之前参与 rotation 窗口。 */
  explicitKeywords?: readonly string[]
```

`candidate.ts` keywordPool（259-263）替换为：

```ts
  const keywordPool = [...new Set([
    ...(params.explicitKeywords ?? []),
    ...positivePlaylistNames.slice(0, 2),
    ...buildPlaylistKeywords(params.profile, recommendationConfig.candidatePool.searchSeedsPerRefresh * 2,
      getLearnedStyleTokens(params.state.tokenWeights, 3)),
  ])]
```

- [ ] **Step 4: 闸门**

Run: `npm test` && `npx eslint src/core/recommend/index.ts src/core/recommend/candidate.ts` && `npx tsc --noEmit`
Expected: 全绿、无新增报错（candidate.ts 带 `@/` 别名依赖无法进 node 单测，wiring 按项目惯例走静态闸门）。不 commit。

---

### Task 4: 问卷 UI + tab 门控 + 三语文案

**Files:**
- Create: `src/screens/Home/Views/Recommend/Onboarding.tsx`
- Modify: `src/screens/Home/Views/Recommend/index.tsx`（imports:1-21；`Recommend` 组件:335-403；styles 区）
- Modify: `src/lang/zh-cn.json`、`src/lang/zh-tw.json`、`src/lang/en-us.json`（recommend_* 键块内追加）

**Interfaces:**
- Consumes: Task 3 的 `recommendationEngine.getOnboardingView/submitOnboarding`；Task 1 的 `ONBOARDING_OPTIONS`；feed.ts 已导出的 `refreshRecommendFeed`。
- Produces: 无（终点任务）。

- [ ] **Step 1: 三语新增文案**

在三个 lang 文件既有的 `recommend_radio_title` 所在块内追加以下键（zh-cn 值如下；zh-tw 用繁体；en-us 用英文语义翻译）：

```json
  "recommend_onboarding_greeting": "第一次来？拖动滑条告诉我们你的口味",
  "recommend_onboarding_q_language": "你一般听什么语言的歌比较多？",
  "recommend_onboarding_q_genre": "你喜欢哪些风格？",
  "recommend_onboarding_submit": "开始推荐",
  "recommend_onboarding_skip": "先跳过",
  "recommend_onboarding_adjust": "调整偏好",
  "recommend_onboarding_opt_zh": "华语",
  "recommend_onboarding_opt_cantonese": "粤语",
  "recommend_onboarding_opt_western": "欧美",
  "recommend_onboarding_opt_ja": "日语",
  "recommend_onboarding_opt_ko": "韩语",
  "recommend_onboarding_opt_other": "小语种",
  "recommend_onboarding_opt_pop": "流行",
  "recommend_onboarding_opt_rock": "摇滚",
  "recommend_onboarding_opt_folk": "民谣",
  "recommend_onboarding_opt_rnb": "R&B·灵魂",
  "recommend_onboarding_opt_hiphop": "嘻哈·说唱",
  "recommend_onboarding_opt_electronic": "电子·舞曲",
  "recommend_onboarding_opt_gufeng": "古风·国风",
  "recommend_onboarding_opt_acg": "二次元·ACG",
  "recommend_onboarding_opt_light": "轻音乐·纯音乐",
  "recommend_onboarding_opt_jazz": "爵士",
  "recommend_onboarding_opt_blues": "蓝调",
  "recommend_onboarding_opt_metal": "金属",
  "recommend_onboarding_opt_punk": "朋克",
  "recommend_onboarding_opt_country": "乡村",
  "recommend_onboarding_opt_latin": "拉丁",
  "recommend_onboarding_opt_dj": "DJ·Remix"
```

- [ ] **Step 2: Onboarding.tsx**

```tsx
import { useMemo, useState } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'
import Slider from '@react-native-community/slider'

import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { recommendationEngine } from '@/core/recommend'
import { ONBOARDING_OPTIONS } from '@/core/recommend/onboarding'
import { createStyle } from '@/utils/tools'

interface Props {
  initialWeights: Record<string, number>
  onCompleted: () => void
}

const CONTENT_PADDING_X = 16

const PreferenceRow = ({ id, percent, onChange }: {
  id: string
  percent: number
  onChange: (id: string, value: number) => void
}) => {
  const theme = useTheme()
  const t = useI18n()
  return (
    <View style={styles.row}>
      <Text size={13} numberOfLines={1} color={theme['c-font']} style={styles.optionName}>
        {t(`recommend_onboarding_opt_${id}`)}
      </Text>
      <Slider
        style={styles.slider}
        minimumValue={0}
        maximumValue={100}
        step={10}
        value={percent}
        onValueChange={value => onChange(id, Math.round(value / 10) * 10)}
        minimumTrackTintColor={theme['c-primary']}
        maximumTrackTintColor={theme['c-font-label']}
        thumbTintColor={theme['c-primary-light-100']}
      />
      <Text size={12} color={theme['c-font-label']} style={styles.percent}>{percent}%</Text>
    </View>
  )
}

const Onboarding = ({ initialWeights, onCompleted }: Props) => {
  const theme = useTheme()
  const t = useI18n()
  const [weights, setWeights] = useState<Record<string, number>>(initialWeights)
  const [submitting, setSubmitting] = useState(false)
  const hasSelection = useMemo(() => Object.values(weights).some(percent => percent > 0), [weights])

  const handleChange = (id: string, percent: number) => {
    setWeights(current => {
      const next = { ...current }
      if (percent > 0) next[id] = percent
      else delete next[id]
      return next
    })
  }

  const submit = async(target: Record<string, number>) => {
    if (submitting) return
    setSubmitting(true)
    const ok = await recommendationEngine.submitOnboarding(target)
    setSubmitting(false)
    if (ok) onCompleted()
  }

  const renderQuestion = (question: 'language' | 'genre') => (
    <View style={styles.section}>
      <Text size={15} color={theme['c-font']} style={styles.questionTitle}>
        {t(question == 'language' ? 'recommend_onboarding_q_language' : 'recommend_onboarding_q_genre')}
      </Text>
      {ONBOARDING_OPTIONS.filter(option => option.question == question).map(option => (
        <PreferenceRow
          key={option.id}
          id={option.id}
          percent={weights[option.id] ?? 0}
          onChange={handleChange}
        />
      ))}
    </View>
  )

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text size={13} color={theme['c-font-label']} style={styles.greeting}>
        {t('recommend_onboarding_greeting')}
      </Text>
      {renderQuestion('language')}
      {renderQuestion('genre')}
      <TouchableOpacity
        style={[styles.submit, { backgroundColor: theme['c-button-background'], opacity: hasSelection && !submitting ? 1 : 0.4 }]}
        disabled={!hasSelection || submitting}
        onPress={() => { void submit(weights) }}
      >
        <Text size={14} color={theme['c-button-font']} style={styles.submitText}>{t('recommend_onboarding_submit')}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.skip} onPress={() => { void submit({}) }}>
        <Text size={13} color={theme['c-font-label']}>{t('recommend_onboarding_skip')}</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = createStyle({
  container: { flex: 1 },
  content: { paddingHorizontal: CONTENT_PADDING_X, paddingTop: 24, paddingBottom: 40 },
  greeting: { marginBottom: 18 },
  section: { marginBottom: 24 },
  questionTitle: { marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 2 },
  optionName: { width: 96 },
  slider: { flex: 1, height: 40, marginHorizontal: 8 },
  percent: { width: 44, textAlign: 'right' },
  submit: { borderRadius: 22, paddingVertical: 10, alignItems: 'center', marginTop: 6 },
  submitText: {},
  skip: { alignItems: 'center', marginTop: 12, paddingVertical: 6 },
})

export default Onboarding
```

- [ ] **Step 3: index.tsx 门控 + 调整入口**

imports 追加：

```ts
import { recommendationEngine } from '@/core/recommend'
import Onboarding from './Onboarding'
```

`Recommend` 组件（index.tsx:335）函数体开头加状态：

```tsx
  const theme = useTheme()
  const t = useI18n()
  const [onboardingView, setOnboardingView] = useState<{ completed: boolean, weights: Record<string, number> } | null>(null)
  const [editingPreference, setEditingPreference] = useState(false)
  const reloadOnboarding = useCallback(() => {
    void recommendationEngine.getOnboardingView().then(setOnboardingView)
  }, [])
  useEffect(() => { reloadOnboarding() }, [reloadOnboarding])
```

（`useTheme`/`useI18n` 已在该文件 import；若 `Recommend` 内已有 `t`/`theme` 则跳过重复声明。）

`return (` 之前插入门控：

```tsx
  if (!onboardingView) {
    return (
      <View style={styles.container}>
        <ActivityIndicator style={styles.loading} />
      </View>
    )
  }
  if (!onboardingView.completed || editingPreference) {
    return (
      <Onboarding
        initialWeights={onboardingView.weights}
        onCompleted={() => {
          setEditingPreference(false)
          reloadOnboarding()
          void refreshRecommendFeed(true)
        }}
      />
    )
  }
```

正常内容 ScrollView 里 `<View style={styles.radioRow}>` 之前加调整入口：

```tsx
        <TouchableOpacity style={styles.adjustBar} onPress={() => setEditingPreference(true)}>
          <Text size={12} color={theme['c-font-label']}>{t('recommend_onboarding_adjust')}</Text>
        </TouchableOpacity>
```

styles 追加（沿用该文件既有 `createStyle` 对象）：

```ts
  loading: { alignSelf: 'center', marginTop: 40 },
  adjustBar: { alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 8 },
```

- [ ] **Step 4: 闸门**

Run: `npm test` && `npx eslint src/screens/Home/Views/Recommend/Onboarding.tsx src/screens/Home/Views/Recommend/index.tsx src/lang/zh-cn.json src/lang/zh-tw.json src/lang/en-us.json` && `npx tsc --noEmit`
Expected: 全绿；tsc 无本次改动路径新增报错。
Bundle 校验：`npm run build-test` 成功后 `grep -c recommend_onboarding index.android.bundle` 应 ≥ 1（Metro 抓不到运行时 API，此步验证资源与键存在，见项目经验）。
不 commit。

---

### Task 5: 全量验证与交付报告

- [ ] **Step 1: 全量闸门**

Run: `npm test`（含新增 onboarding 用例）；`npm run lint`；`npx tsc --noEmit`；`npm run build-test`。
Expected: 全绿；lint/tsc 与改动前基线相比零新增报错；bundle 含 `recommend_onboarding`。

- [ ] **Step 2: 交付说明（不 commit）**

向用户汇报：改动文件清单、百分比→权重语义（100%＝分类偏置满幅、45 天半衰期由真实反馈接管）、验证方式（全新安装/清数据后首进推荐页出问卷；"调整偏好"重开预填）；提示 APK 构建与真机验收（v1.0.10 流程）由用户确认后执行。

---

## Self-Review 记录

1. **Spec 覆盖**：问卷两题/一列滑条/百分比→Task 4；权重语义→Task 1；状态与迁移→Task 2；引擎注入两处→Task 3；跳过/调整入口/重提交→Task 3+4；错误处理（stateReady=false 返回 false）→Task 3；测试 6 项→Task 1/2。无缺口。
2. **占位符扫描**：Task 1 Step 3 的"共享别名"用例注记是显式的验证分支指令而非 TBD——实施时以实际别名表断言。
3. **类型一致性**：`OnboardingState.weights/seededThemeWeights`（Task 2）与 `submitOnboarding` 写入（Task 3）、`getOnboardingView` 返回（Task 3→4）一致；`computeSeedWeights` 返回 `Record<string, number>` 在 Task 1 测试与 Task 3 调用一致。
