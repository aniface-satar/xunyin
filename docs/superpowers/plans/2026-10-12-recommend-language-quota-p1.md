# 语种硬配额 + 最小桶召回 + 歌手语言表（P1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让电台每 20 首里各语种的产出比例钉在用户问卷选定的百分比 ±1，并从供给侧保证配额可达成；同时治理"同一歌手连推"。

**Architecture:** 三层改动一次落地——① 新增纯函数模块 `language.ts`（语种分桶与四级推断）+ `artistLanguageStore.ts`（歌手语言表，AsyncStorage 独立键）；② `languageQuota.ts`（纯算术：目标数/上限/连推约束）被 `diversity.ts` 的约束谓词和 `candidate.ts` 的桶召回共同消费；③ 语种字段穿透音源层（`music.d.ts` → `utils/index.ts` → tx/kg SDK）后写进候选池，打分时 L1→L2→L3→L4 兜底推导（derive-on-read，旧缓存自动获得语种）。

**Tech Stack:** TypeScript（`.ts` 纯模块 + `.mts` 单测）、React Native、AsyncStorage、node:test + `--experimental-strip-types`、eslint、tsc。

**Spec:** `docs/superpowers/specs/2026-10-12-recommend-language-quota-similar-artist-design.md`（§3.1–§3.4、§3.6 的 P1 部分、§7 P1 行、§9 存储、§10 可观测性、§11 测试）。P2（五源全量桶召回、unknown 二次判型）与 P3（通道 E / 路线 2 / `targetPerWindow` 腾名额）**不在本计划内**。

## Global Constraints

- 无自建后端、零上报；只用现有音源接口，不引入任何会过期额度的付费服务（spec §0）。
- 语种是**硬闸门**不是加权：命中上限即作候选不合格；按 spec §3.2 的阶梯，只在 relax 第 3~4 档（池里没别的可选时）放开并写 `lang_quota_relaxed`，而**同语言连播与纯音乐上限任何档都守**（spec §0、§3.2、§3.3）。
- 判不准一律 `unknown`，不猜 `en`；`unknown` 走自由名额，不降档、不惩罚（spec §3.1）。
- 纯音乐判型只信显式标记，不做"无词=纯音乐"的正则推断（spec §3.1）。
- 本期**不动** `recommendationConfig.channels.targetPerWindow`（仍 A9/B5/C4/D2），通道腾名额留到 P3（spec §3.5）。
- 固定竖屏：本计划不新增界面，不得改 `android/app/src/main/AndroidManifest.xml` 的 `android:screenOrientation="portrait"`，不得改 `src/navigation/index.ts` 的 `layout.orientation: ['portrait']`。
- 可测性边界：`node --test --experimental-strip-types` 只能加载不引 `@/plugins/storage`、不引 `@/utils/musicSdk` 的纯模块。所有语种算术做成纯函数放 `*.ts`，AsyncStorage 外壳单独成文件、只由 `index.ts` 消费、由 bundle grep 门验证。
- 只 `git add` 本 Task 列出的路径，**绝不 `git add -A`**——工作区仍有识曲等功能线的未提交改动，`src/` 里别人的现场不能动。
- 每个 Task 的验证闸门按顺序跑：`npm test` → `npx eslint <本次改动文件>` → `npx tsc --noEmit`。基线：`npm test` 当前 **293 pass**；`npx tsc --noEmit` 在 `src/` 有既有错误基线，**只要求本次改动路径零新增错误**。
- **eslint 闸门只跑源码，不跑 `tests/*.mts`。** 仓库自己的 `package.json:12` 是 `eslint . --ext .js,.jsx,.ts,.tsx`，`.mts` 根本不在 lint 面上；且顶层 parser 是 `@babel/eslint-parser`（TS override 只匹配 `*.ts`/`*.tsx`），它解析不了 TS 的 const 断言 `as const`——现有 26 个 `.mts` 测试里有 10 个因此已经是 error 状态（含 `tests/recommend-algorithm.mts:196`）。`.mts` 由 `npm test` 与 `npx tsc --noEmit` 覆盖就够了。**不要为了凑 eslint 0 error 去改 `.eslintrc.cjs`，也不要把测试里的 `as const` 拆掉。**

## File Structure

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `src/core/recommend/language.ts` | Create | 纯：`LangBucket` 类型、kg 中文词表 / tx 数字码表映射、文字系统统计（L4）、歌词判型（L3 喂入口）、歌手语言表合并算法、`resolveLang` 四级链 |
| `src/core/recommend/artistLanguageStore.ts` | Create | RN 外壳：AsyncStorage 键 `xunyin_recommend_artist_lang_v1` 的读入/防抖落盘/观察写入；不做任何判定 |
| `src/core/recommend/languageQuota.ts` | Create | 纯：问卷选项→桶目标数换算、窗口已用量、逐桶上限、连推判定、池内分桶计数 |
| `src/core/recommend/config.ts` | Modify | 新增 `language` 段（Task 2 建、Task 4 补 3 键）；`candidatePool` 补桶召回 5 键（Task 6）与 `poolEvictOverQuotaSlack`（Task 7）、`artistHitsPerRefresh` 2→1（Task 9）；`antiRepeat.sameArtistInLast30` 3→2、新增 `categoryRotationTemperature`（Task 6）与 `recentArtistWindow`/`recentArtistFactor`/`midArtistWindow`/`midArtistFactor`/`minArtistGap`（Task 9） |
| `src/types/music.d.ts` | Modify | `MusicInfoMetaBase` 增可选 `lang` |
| `src/utils/index.ts` | Modify | `toNewMusicInfo` / `toOldMusicInfo` 双向透传 `lang`（照 `releaseDate` 的写法） |
| `src/utils/musicSdk/kg/musicSearch.js` | Modify | `filterData` 输出 `trans_param.language`（真机/开发机均已实测存在） |
| `src/utils/musicSdk/kg/songList.js` | Modify | `getMusicInfos` 按 hash/audio_id 建语种索引并传给 `filterData2` 回填 |
| `src/utils/musicSdk/tx/songList.js` | Modify | `filterListDetail` 保留 `item.language`（守 `new_format=1`） |
| `src/core/recommend/types.ts` | Modify | `PoolCandidate` 增 `lang?` / `langHint?` |
| `src/core/recommend/candidatePool.ts` | Modify | `createPoolCandidate` 写 `lang`；`mergePoolCandidates` 保留可信的一份；`capPoolSize` 第三参按桶限额；`buildFinalQueueItems` 用 `resolvePoolLang` 填 `FinalQueueItem.lang`；`poolStats` 增 `byLang` |
| `src/core/recommend/diversity.ts` | Modify | `FinalQueueItem.lang`、`RelaxConfig.langQuotaEnforced`、`checkItemConstraints` 第 4 参 `langCaps`、`weightFor` 连推惩罚、删 `artistGap=0` 兜底 |
| `src/core/recommend/candidate.ts` | Modify | `SummaryWithHints.langHint`、4.5 步缺口驱动桶召回、`CatalogRefreshParams.langTargets` |
| `src/core/recommend/tabSections.ts` | Modify | 新增 `pickWeightedTag`（softmax 分类轮换，温度可配） |
| `src/core/recommend/index.ts` | Modify | 载入歌手语言表、暴露 `observeLyricLanguage`/`observeTrackLanguage`/`getArtistLanguages`、`generateQueue` 注入 `langCaps`、`pushMusicInfo` 回填 `lang` |
| `src/core/player/player.ts` | Modify | 两处 `getLyricInfo` 成功回调各插一行喂歌词（守卫之后） |
| `src/core/recommend/stateSchema.ts` | Modify | `STATE_VERSION` 8→9 + 问卷播种负权重播（v8→v9 迁移） |
| `src/core/recommend/onboarding.ts` | Modify | `seedValueFor` 以 50% 为中轴分正负两支，`applySeedWeights`/`revokeSeedWeights` 对称回退 |
| `tests/recommend-language.mts` | Create | 分桶映射、文字系统、歌词判型、歌手表合并、`resolveLang` 四级链 |
| `tests/recommend-language-quota.mts` | Create | 目标数、上限、连推、池淘汰看桶 |
| `tests/recommend-diversity-lang.mts` | Create | `checkItemConstraints` 语种闸门 + `selectFinalQueue` 端到端钉死 |
| `tests/recommend-candidate-lang.mts` | Create | `createPoolCandidate` 的 L1 写入/缺键、`langHint` 透传、`mergePoolCandidates` 取值优先级 |
| `tests/recommend-lang-bucket-supply.mts` | Create | 桶缺口规划、`pickWeightedTag` 抽样、详情额度预留 |
| `tests/recommend-pool-lang.mts` | Create | `resolvePoolLang` 四级链、`capPoolSize` 按桶限额、`computePoolBucketLimits`、推导不改入参（等价于"不回写缓存键"） |
| `tests/recommend-onboarding.mts` | Modify | 负权播种/回退、v8→v9 迁移断言 |
| `package.json` | Modify | `scripts.test` 白名单逐个追加六个新测试文件：`recommend-language`、`recommend-language-quota`、`recommend-diversity-lang`、`recommend-candidate-lang`、`recommend-lang-bucket-supply`、`recommend-pool-lang` |

---

### Task 1: 语种分桶与四级推断纯模块 `language.ts`

对应 spec §3.1（分桶 + 四级判定）。这是后续所有 Task 的地基：`languageQuota.ts`、候选池、播放器喂歌词都只吃这里的 `LangBucket`。

**Files:**
- Create: `src/core/recommend/language.ts`
- Create: `tests/recommend-language.mts`
- Modify: `package.json`（`scripts.test` 末尾追加 `tests/recommend-language.mts`）

**Interfaces:**
- Consumes: 无（不 import 引擎内任何模块，保证可进 `node --test`）。
- Produces:
  - `type LangBucket = 'zh' | 'yue' | 'en' | 'ja' | 'ko' | 'other' | 'instr' | 'unknown'`
  - `const LANG_BUCKETS: readonly LangBucket[]`（8 个）
  - `const QUOTA_LANG_BUCKETS: readonly LangBucket[]`（`['zh','yue','en','ja','ko','other']`，即除 `instr`/`unknown` 之外全部进配额）
  - `const mapKgLanguageWord(word: string | null | undefined): LangBucket | null`
  - `const mapTxLanguageCode(code: string | number | null | undefined): LangBucket | null`
  - `const bucketFromLangField(source: string | undefined, lang: string | number | null | undefined): LangBucket | null`
  - `const countLangChars(text: string): { han: number, kana: number, hangul: number, latin: number, otherLetter: number, letters: number }`
  - `const bucketFromScript(name: string, singer?: string): LangBucket | null`
  - `const bucketFromLyric(lyric: string | null | undefined, name?: string): LangBucket | null`
  - `type ArtistLangSource = 'lyric' | 'field'`
  - `interface ArtistLangEntry { bucket: LangBucket, hits: number, strength: number, updatedAt: number }`
  - `type ArtistLangTable = Record<string, ArtistLangEntry>`
  - `const updateArtistLangTable(table: ArtistLangTable, artists: readonly string[], bucket: LangBucket | null, source: ArtistLangSource, limit?: number, now?: number): void`
  - `interface LangResolveInput { source?: string, langField?: string | number | null, name?: string, singer?: string, langHint?: LangBucket | null, artistKeys?: readonly string[] }`
  - `const resolveLang(input: LangResolveInput, table?: ArtistLangTable): { bucket: LangBucket, level: 1 | 2 | 3 | 4 | 0 }`

- [ ] **Step 1: 写失败的测试**

Create `tests/recommend-language.mts`：

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import type { ArtistLangTable } from '../src/core/recommend/language.ts'
import {
  LANG_BUCKETS,
  QUOTA_LANG_BUCKETS,
  mapKgLanguageWord,
  mapTxLanguageCode,
  bucketFromLangField,
  countLangChars,
  bucketFromScript,
  bucketFromLyric,
  updateArtistLangTable,
  resolveLang,
} from '../src/core/recommend/language.ts'

test('bucket sets: quota buckets exclude instr and unknown', () => {
  assert.deepEqual([...LANG_BUCKETS], ['zh', 'yue', 'en', 'ja', 'ko', 'other', 'instr', 'unknown'])
  assert.deepEqual([...QUOTA_LANG_BUCKETS], ['zh', 'yue', 'en', 'ja', 'ko', 'other'])
})

test('kg language words map by exact trimmed chinese word', () => {
  assert.equal(mapKgLanguageWord('国语'), 'zh')
  assert.equal(mapKgLanguageWord(' 粤语 '), 'yue')
  assert.equal(mapKgLanguageWord('英语'), 'en')
  assert.equal(mapKgLanguageWord('日语'), 'ja')
  assert.equal(mapKgLanguageWord('韩语'), 'ko')
  assert.equal(mapKgLanguageWord('西班牙语'), 'other')
  assert.equal(mapKgLanguageWord('法语'), 'other')
  // 不认识的词不许猜：交回下一级，最终由 resolveLang 落 unknown
  assert.equal(mapKgLanguageWord('自译解词'), null)
  assert.equal(mapKgLanguageWord(null), null)
})

test('tx numeric language codes map and mixed-semantics codes return null', () => {
  assert.equal(mapTxLanguageCode(0), 'zh')
  assert.equal(mapTxLanguageCode(1), 'yue')
  assert.equal(mapTxLanguageCode(3), 'ja')
  assert.equal(mapTxLanguageCode(4), 'ko')
  assert.equal(mapTxLanguageCode('5'), 'en')
  assert.equal(mapTxLanguageCode(6), 'other')
  assert.equal(mapTxLanguageCode(13), 'other')
  assert.equal(mapTxLanguageCode(16), 'other')
  assert.equal(mapTxLanguageCode(24), 'other')
  // 7=中英交替、8=自译解词、11/12/15 实测不符实际：宁缺毋滥
  assert.equal(mapTxLanguageCode(7), null)
  assert.equal(mapTxLanguageCode(8), null)
  assert.equal(mapTxLanguageCode(12), null)
  assert.equal(mapTxLanguageCode(99), null)
  assert.equal(mapTxLanguageCode(null), null)
  // 空串会被 Number() 折成 0，而 0 在码表里是 'zh'：必须先拦掉
  assert.equal(mapTxLanguageCode(''), null)
  assert.equal(mapTxLanguageCode('   '), null)
})

test('bucketFromLangField dispatches by source only', () => {
  assert.equal(bucketFromLangField('tx', 1), 'yue')
  assert.equal(bucketFromLangField('kg', '粤语'), 'yue')
  assert.equal(bucketFromLangField('wy', '粤语'), null)
  assert.equal(bucketFromLangField(undefined, 1), null)
})

test('countLangChars ignores digits, spaces and punctuation', () => {
  const c = countLangChars('晴天 2004, Jay Chou（周杰伦）')
  assert.equal(c.han, 5)
  assert.equal(c.latin, 7)
  assert.equal(c.letters, 12)
})

test('bucketFromScript pins ja/ko/zh/other and refuses to guess en', () => {
  assert.equal(bucketFromScript('First Love', '宇多田ヒカル'), 'ja')
  assert.equal(bucketFromScript('Dynamite', 'BTS(방탄소년단)'), 'ko')
  assert.equal(bucketFromScript('告白气球', '周杰伦'), 'zh')
  assert.equal(bucketFromScript('Despacito', 'Luis Fonsi'), null)
  // 纯拉丁不判 en（翻唱率最高，误判代价最大）
  assert.equal(bucketFromScript('Shape of You', 'Ed Sheeran'), null)
  // 西里尔等非拉丁非中日韩文字走 otherLetter 占比通道
  assert.equal(bucketFromScript('Bello', 'Михаил Круг'), 'other')
  assert.equal(bucketFromScript('1234', ''), null)
})

test('bucketFromLyric uses lyric body, not the filename', () => {
  const zh = '[00:00.00]作词：林夕\n[00:01.00]作曲：C.Y.Kong\n[00:02.00]风雨里做一个天真的梦'
  assert.equal(bucketFromLyric(zh), 'zh')
  const en = '[00:00.00]Baby we could drive forever tonight'
  assert.equal(bucketFromLyric(en), 'en')
  // 拿不到歌词 ≠ 纯音乐
  assert.equal(bucketFromLyric(null, 'Shape of You'), null)
  assert.equal(bucketFromLyric('', 'Shape of You'), null)
  assert.equal(bucketFromLyric('', '卡农（纯音乐）'), 'instr')
  // 曲名只是包含 inst 这个子串，不算显式标记
  assert.equal(bucketFromLyric('', 'Instinct'), null)
  assert.equal(bucketFromLyric('  \n[00:00.00]\n', 'Canon in D'), null)
})

test('bucketFromLyric recognises cantonese function words', () => {
  const yue = '[00:01.00]嘅世界越似呢个梦\n[00:03.00]唔想讲 冇办法讲'
  assert.equal(bucketFromLyric(yue), 'yue')
})

test('updateArtistLangTable: strength beats hits, same strength votes by hits', () => {
  const table: ArtistLangTable = {}
  updateArtistLangTable(table, ['周杰伦'], 'zh', 'lyric', 500, 1000)
  updateArtistLangTable(table, ['周杰伦'], 'zh', 'lyric', 500, 1001)
  assert.equal(table['周杰伦'].bucket, 'zh')
  assert.equal(table['周杰伦'].hits, 2)
  // 同强度反向票：hits 递减，不清零桶
  updateArtistLangTable(table, ['周杰伦'], 'en', 'lyric', 500, 1002)
  assert.equal(table['周杰伦'].bucket, 'zh')
  assert.equal(table['周杰伦'].hits, 1)
  updateArtistLangTable(table, ['周杰伦'], 'en', 'lyric', 500, 1003)
  assert.equal(table['周杰伦'].bucket, 'zh')
  assert.equal(table['周杰伦'].hits, 0)
  // 高强度直接覆盖
  updateArtistLangTable(table, ['周杰伦'], 'en', 'field', 500, 1004)
  assert.equal(table['周杰伦'].bucket, 'en')
  assert.equal(table['周杰伦'].strength, 2)
  // unknown 不入库
  updateArtistLangTable(table, ['新人'], 'unknown', 'lyric', 500, 1005)
  assert.equal(table['新人'], undefined)
  // instr 同样不入库：伴奏是单曲属性，钉到歌手身上会让其真唱曲目逃出语种配额
  updateArtistLangTable(table, ['新人'], 'instr', 'field', 500, 1006)
  assert.equal(table['新人'], undefined)
})

test('updateArtistLangTable evicts the weakest entry past the limit', () => {
  const table: ArtistLangTable = {}
  updateArtistLangTable(table, ['A'], 'zh', 'lyric', 2, 1)
  updateArtistLangTable(table, ['A'], 'zh', 'lyric', 2, 2)
  updateArtistLangTable(table, ['B'], 'en', 'lyric', 2, 3)
  updateArtistLangTable(table, ['C'], 'ja', 'lyric', 2, 4)
  assert.equal(Object.keys(table).length, 2)
  // 淘汰的是得票最低的那位（B、C 都只有 1 票，B 更旧所以先走）；A 有 2 票必须留下
  assert.equal(table['B'], undefined)
  assert.equal(table['A'].bucket, 'zh')
  assert.equal(table['A'].hits, 2)
  assert.equal(table['C'].bucket, 'ja')
})

test('resolveLang runs L1 -> L2 -> L3 -> L4 and lands on unknown', () => {
  const table: ArtistLangTable = { 陈奕迅: { bucket: 'yue', hits: 3, strength: 1, updatedAt: 1 } }
  assert.deepEqual(resolveLang({ source: 'tx', langField: 0, name: '十年', singer: '陈奕迅' }, table), { bucket: 'zh', level: 1 })
  assert.deepEqual(resolveLang({ name: 'Something', singer: 'New Artist', langHint: 'en' }, table), { bucket: 'en', level: 2 })
  // L3 只认 artistKeys（候选上的归一化歌手键），不认 singer 原串
  assert.deepEqual(resolveLang({ name: '浮夸', singer: '陈奕迅', artistKeys: ['陈奕迅'] }, table), { bucket: 'yue', level: 3 })
  assert.deepEqual(resolveLang({ name: '第一封情书', singer: '陌生人' }), { bucket: 'zh', level: 4 })
  assert.deepEqual(resolveLang({ name: 'Yesterday', singer: 'The Beatles' }), { bucket: 'unknown', level: 0 })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-language.mts`
Expected: FAIL，报错 `Cannot find module .../src/core/recommend/language.ts`

- [ ] **Step 3: 写实现**

Create `src/core/recommend/language.ts`：

```ts
/**
 * 语种分桶与四级判定（spec §3.1）。本模块必须保持纯函数：
 * 不 import config、不 import storage、不 import musicSdk，否则 node --test 载不动。
 * 判定原则：宁缺毋滥——判不出就 unknown 走自由名额，绝不硬判 en。
 */

export type LangBucket = 'zh' | 'yue' | 'en' | 'ja' | 'ko' | 'other' | 'instr' | 'unknown'

export const LANG_BUCKETS: readonly LangBucket[] = ['zh', 'yue', 'en', 'ja', 'ko', 'other', 'instr', 'unknown']

/** 进语种配额统计的桶：instr 由每窗口上限单独管，unknown 不参与硬约束。 */
export const QUOTA_LANG_BUCKETS: readonly LangBucket[] = ['zh', 'yue', 'en', 'ja', 'ko', 'other']

/** kg 语种字段是中文词（实测 song_search_v2 与歌单内嵌 global.data 的 trans_param.language 同形）。 */
const KG_LANGUAGE_WORDS: Record<string, LangBucket> = {
  国语: 'zh',
  中文: 'zh',
  华语: 'zh',
  粤语: 'yue',
  英语: 'en',
  英文: 'en',
  日语: 'ja',
  韩语: 'ko',
  法语: 'other',
  德语: 'other',
  意大利语: 'other',
  西班牙语: 'other',
  俄语: 'other',
  泰语: 'other',
  越南语: 'other',
  拉丁语: 'other',
  小语种: 'other',
}

/** 只认表内的词；表外（如"自译解词"）返回 null 交回下一级，不做子串匹配。 */
export const mapKgLanguageWord = (word: string | null | undefined): LangBucket | null => {
  const key = typeof word == 'string' ? word.trim() : ''
  if (!key) return null
  return KG_LANGUAGE_WORDS[key] ?? null
}

/** tx 语种是数字码表（实测钉死，见 spec §3.1 码表行）。 */
const TX_LANGUAGE_CODES: Record<number, LangBucket> = {
  0: 'zh',
  1: 'yue',
  3: 'ja',
  4: 'ko',
  5: 'en',
  6: 'other',
  13: 'other',
  16: 'other',
  24: 'other',
}

/**
 * 只有本表列出的码可用：7=中英交替、8=自译解词、11=俄语、12=汉语、15=朝语
 * 实测与内容不符或语义混合，返回 null 让上层继续往下推。
 */
export const mapTxLanguageCode = (code: string | number | null | undefined): LangBucket | null => {
  // 空串/纯空白必须先拦：Number('') === 0，而 0 在码表里是 'zh'，
  // 否则"接口没给语种"会被当成最高可信度的 L1=中文。
  if (typeof code == 'string' && !code.trim()) return null
  const num = typeof code == 'string' ? Number(code) : code
  if (num == null || !Number.isInteger(num)) return null
  return TX_LANGUAGE_CODES[num] ?? null
}

/** 按源分派：mg 的语种是字符串列表（P2 接），其余源没有语种字段。 */
export const bucketFromLangField = (
  source: string | undefined,
  lang: string | number | null | undefined,
): LangBucket | null => {
  if (lang == null) return null
  if (source == 'tx') return mapTxLanguageCode(lang)
  if (source == 'kg') return mapKgLanguageWord(String(lang))
  return null
}

const HAN_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/g
const KANA_RE = /[\u3041-\u30ff\u31f0-\u31ff]/g
const HANGUL_RE = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g
const LATIN_RE = /[A-Za-z\u00c0-\u024f]/g
/** 其它有音节的文字：西里尔 / 希腊 / 亚美尼亚 / 希伯来 / 阿拉伯 / 天城 / 泰文 / 老挝-缅甸-高棉 */
const OTHER_LETTER_RE = /[\u0370-\u03ff\u0400-\u04ff\u0530-\u058f\u0590-\u05ff\u0600-\u06ff\u0900-\u097f\u0e00-\u0fff]/g

const countMatches = (text: string, re: RegExp) => {
  const hits = text.match(re)
  return hits ? hits.length : 0
}

/** 只统计"有音节"的字符：数字、空白、中英标点、装饰性符号一律忽略。 */
export const countLangChars = (text: string) => {
  const han = countMatches(text, HAN_RE)
  const kana = countMatches(text, KANA_RE)
  const hangul = countMatches(text, HANGUL_RE)
  const latin = countMatches(text, LATIN_RE)
  const otherLetter = countMatches(text, OTHER_LETTER_RE)
  return { han, kana, hangul, latin, otherLetter, letters: han + kana + hangul + latin + otherLetter }
}

const JA_SHARE = 0.2
const KO_SHARE = 0.2
const ZH_SHARE = 0.5
const OTHER_SHARE = 0.3

/**
 * L4：曲名 + 歌手名合并的字面统计。按 spec §3.1 的边界，本层**不判 en**——
 * 拉丁占比高只可能是欧美原创，也可能是日本/韩国用英文歌名的原创，后者占比很高。
 */
export const bucketFromScript = (name: string, singer = ''): LangBucket | null => {
  const { han, kana, hangul, latin, otherLetter, letters } = countLangChars(`${name} ${singer}`)
  if (letters <= 0) return null
  if (kana / letters >= JA_SHARE) return 'ja'
  if (hangul / letters >= KO_SHARE) return 'ko'
  if (han / letters >= ZH_SHARE) return 'zh'
  if (otherLetter / letters >= OTHER_SHARE) return 'other'
  // 纯拉丁、或汉字/片假名不足以定型的混合标题：交回调用方落 unknown
  void latin
  return null
}

const INSTR_NAME_RE = /(纯音乐|伴奏|无人声|instrumental|\binst\b\.?|piano version)/i

/** 歌词里的粤语虚词。汉字统计本身分不开 zh/yue，这几个字是可靠的方言信号。 */
const YUE_MARKER_RE = /[嘅唔冇俾佢哋嚟咗乜嗰咪]/g
const YUE_MARKER_MIN = 2

/** 歌词元数据行（作词/作曲/LRC 头部），进统计前先剔除，否则 "C.Y.Kong" 会把拉丁占比抬高。 */
const LYRIC_META_RE = /^\s*(?:作词|作曲|编曲|制作人|录音|混音|母带|吉他|钢琴|和声|Lyric|Lyrics|Word|Music|Composed|Arranged|Produced|LRC版本)[为:：]/i
const LRC_TAG_RE = /\[[^\]]*\]/g

export const stripLyricNoise = (raw: string): string => {
  return raw
    .split('\n')
    .map(line => line.replace(LRC_TAG_RE, '').trim())
    .filter(line => line && !LYRIC_META_RE.test(line) && !/^[^\w\u4e00-\u9fff]+$/.test(line))
    .join(' ')
}

/**
 * L3 的喂入口：只看歌词正文。歌词拿不到返回 null（不是 instr）；
 * 正文为空只在曲名带显式纯音乐标记时判 instr——"无词=纯音乐"会误伤轻音乐。
 */
export const bucketFromLyric = (lyric: string | null | undefined, name = ''): LangBucket | null => {
  if (lyric == null) return null
  const body = stripLyricNoise(lyric)
  if (!body) return INSTR_NAME_RE.test(name) ? 'instr' : null
  if (countMatches(body, YUE_MARKER_RE) >= YUE_MARKER_MIN) return 'yue'
  const { han, kana, hangul, latin, otherLetter, letters } = countLangChars(body)
  if (letters <= 0) return null
  if (kana / letters >= JA_SHARE) return 'ja'
  if (hangul / letters >= KO_SHARE) return 'ko'
  if (han / letters >= ZH_SHARE) return 'zh'
  if (otherLetter / letters >= OTHER_SHARE) return 'other'
  // 歌词正文里拉丁占绝对多数判 en 是可靠的（spec §3.1 明确放开这一条）
  if (latin / letters >= 0.8) return 'en'
  return null
}

export type ArtistLangSource = 'lyric' | 'field'

/** 强度：曲内语言表（歌词）< 接口语种字段。P2 的 MusicBrainz 关系链再往上加一档。 */
const ARTIST_LANG_STRENGTH: Record<ArtistLangSource, number> = {
  lyric: 1,
  field: 2,
}

export interface ArtistLangEntry {
  bucket: LangBucket
  hits: number
  strength: number
  updatedAt: number
}

export type ArtistLangTable = Record<string, ArtistLangEntry>

/**
 * 歌手语言表就地合并（表由 artistLanguageStore 持有，本函数不碰存储）：
 * 高强度直接覆盖；同强度用 hits 做计数器投票（反向票递减，减到负再换桶），
 * 低强度忽略。unknown 不入库。超容量淘汰 hits 最低、最旧的一条。
 */
export const updateArtistLangTable = (
  table: ArtistLangTable,
  artists: readonly string[],
  bucket: LangBucket | null,
  source: ArtistLangSource,
  limit = 500,
  now = Date.now(),
): void => {
  // instr 是"单首曲"的属性，不是歌手的：几首伴奏就把歌手钉成 instr，
  // 会让他的真唱曲目在 L3 拿到 instr，而 instr 不在配额桶里 => 整首逃出语种硬约束。
  if (!bucket || bucket == 'unknown' || bucket == 'instr') return
  const strength = ARTIST_LANG_STRENGTH[source]
  for (const rawKey of artists) {
    const key = typeof rawKey == 'string' ? rawKey.trim() : ''
    if (!key) continue
    const prev = table[key]
    if (!prev) {
      table[key] = { bucket, hits: 1, strength, updatedAt: now }
      continue
    }
    if (strength > prev.strength) {
      table[key] = { bucket, hits: 1, strength, updatedAt: now }
      continue
    }
    if (strength < prev.strength) continue
    if (bucket == prev.bucket) {
      table[key] = { ...prev, hits: prev.hits + 1, updatedAt: now }
      continue
    }
    const hits = prev.hits - 1
    table[key] = hits < 0
      ? { bucket, hits: 1, strength, updatedAt: now }
      : { ...prev, hits, updatedAt: now }
  }
  const keys = Object.keys(table)
  if (keys.length <= limit) return
  keys.sort((a, b) => {
    if (table[a].hits != table[b].hits) return table[a].hits - table[b].hits
    return table[a].updatedAt - table[b].updatedAt
  })
  for (const key of keys.slice(0, keys.length - limit)) delete table[key]
}

export interface LangResolveInput {
  source?: string
  langField?: string | number | null
  name?: string
  singer?: string
  /** L2：候选来源语种桶的批次提示。 */
  langHint?: LangBucket | null
  /** L3 查表用的歌手键（归一化后的 artistKeys）。 */
  artistKeys?: readonly string[]
}

/**
 * 四级链：L1 接口逐曲字段 > L2 桶召回提示 > L3 歌手语言表 > L4 字面统计。
 * level=0 表示落到 unknown（走自由名额，不参与硬约束）。
 */
export const resolveLang = (
  input: LangResolveInput,
  table?: ArtistLangTable,
): { bucket: LangBucket, level: 1 | 2 | 3 | 4 | 0 } => {
  const l1 = bucketFromLangField(input.source, input.langField)
  if (l1) return { bucket: l1, level: 1 }
  if (input.langHint && input.langHint != 'unknown') return { bucket: input.langHint, level: 2 }
  if (table) {
    for (const artist of input.artistKeys ?? []) {
      const entry = table[artist]
      if (entry && entry.bucket != 'unknown') return { bucket: entry.bucket, level: 3 }
    }
  }
  const l4 = bucketFromScript(input.name ?? '', input.singer ?? '')
  if (l4) return { bucket: l4, level: 4 }
  return { bucket: 'unknown', level: 0 }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-language.mts`
Expected: PASS 11 tests（若 `bucketFromLyric` 的元数据行过滤把 `风雨里做一个天真的梦` 之外的英文歌手名算进正文，先调 `LYRIC_META_RE` 覆盖到行首，不要放宽拉丁阈值）

- [ ] **Step 5: 追加进 test 白名单并跑全量**

Modify `package.json`：把 `scripts.test` 的值在 `tests/feature-icons-font.mts` 之后追加 ` tests/recommend-language.mts`（白名单是显式文件列表，不是 glob）。

Run: `npm test`
Expected: 304 pass（293 + 11），0 fail

- [ ] **Step 6: lint 与类型闸门**

Run: `npx eslint src/core/recommend/language.ts`
Expected: 0 error（warning 里 `no-regex-spaces` 之类如与正则无关可忽略）

Run: `npx tsc --noEmit 2>&1 | grep -E "core/recommend/language|tests/recommend-language" || echo "no new errors"`
Expected: `no new errors`

- [ ] **Step 7: 提交**

```bash
git add src/core/recommend/language.ts tests/recommend-language.mts package.json
git commit -m "feat(recommend): 语种分桶与四级判定纯模块，配额的地基"
```

---

### Task 2: 歌手语言表存储 + 播放器歌词喂入

对应 spec §3.1 的 L3 与"喂入时机"、§9 的表容量与淘汰。**不改任何打分行为**——本 Task 结束时表已经在积累，但还没人读它。分开做是为了让"喂入"能独立验收（真机听几首后能验证表在长），再动配额闸门。

**Files:**
- Create: `src/core/recommend/artistLanguageStore.ts`
- Modify: `src/types/music.d.ts:20-26`（`MusicInfoMetaBase` 增可选 `lang`）
- Modify: `src/utils/index.ts:34`、`src/utils/index.ts:94`（新旧格式双向透传 `lang`，照 `releaseDate` 的写法）
- Modify: `src/core/recommend/config.ts`（新增 `language` 段，插在 `candidatePool` 之后）
- Modify: `src/core/recommend/index.ts`（import + `doInitialize` 载入 + `observeLyricLanguage` 方法）
- Modify: `src/core/player/player.ts:187`、`src/core/player/player.ts:219`（两处 `getLyricInfo` 成功回调的守卫之后各插一行）

`meta.lang` 的类型改动放在本 Task 而不是 Task 3：Step 4 的引擎代码要读 `musicInfo.meta.lang`，类型不到场这个 Task 收尾就 tsc 不干净。Task 3 只管让音源 SDK 真的把值填进来。

**Interfaces:**
- Consumes（Task 1）: `ArtistLangTable`、`LangBucket`、`bucketFromLangField`、`bucketFromLyric`、`updateArtistLangTable`
- Produces:
  - `loadArtistLangTable(): Promise<ArtistLangTable>`
  - `getArtistLangTable(): ArtistLangTable`（未 load 完成返回 `{}`，不抛）
  - `observeArtistLyric(artists: readonly string[], bucket: LangBucket | null): void`
  - `observeArtistLangField(artists: readonly string[], bucket: LangBucket | null): void`
  - `saveArtistLangTableNow(): Promise<void>`
  - `clearArtistLangTable(): Promise<void>`
  - `getArtistLangKey(): string`
  - `recommendationEngine.observeLyricLanguage(musicInfo: LX.Music.MusicInfo, lyric: string | null | undefined): void`
  - `recommendationConfig.language: { artistTableLimit: 500, saveDebounceMs: 20000 }`

- [ ] **Step 1: 确认 config 里还没有 language 段**

Run: `grep -n "language" src/core/recommend/config.ts`
Expected: 无输出。若已有该段，改用现成键名并跳过本 Step 的插入。

- [ ] **Step 2: 语种字段进类型与新旧格式互转**

Modify `src/types/music.d.ts`：`MusicInfoMetaBase`（21–27 行）里 `releaseDate` 那行之后加一行：

```ts
      releaseDate?: string | null // 歌曲发行日期，例：2020-01-01，部分源提供
      lang?: string | number | null // 语种原始值：kg 源是中文词（例：粤语），tx 源是数字码（例：1），各源形态不一，由引擎分桶
```

必须加在 `MusicInfoMetaBase` 而不是 `MusicInfoMeta_online`——本地文件也要能带这个字段。

Modify `src/utils/index.ts`：`toNewMusicInfo` 的 34 行（`releaseDate` 那行）之后加：

```ts
  if (oldMusicInfo.lang != null) meta.lang = oldMusicInfo.lang // 音源语种原值，分桶见 recommend/language.ts
```

`toOldMusicInfo` 的 94 行（`releaseDate` 那行）之后加：

```ts
  if (minfo.meta.lang != null) oInfo.lang = minfo.meta.lang
```

两处都照 `releaseDate` 的写法：`!= null` 才写，不往 meta 里塞 `undefined` 键，避免旧歌单序列化时凭空多字段。

- [ ] **Step 3: 加配置段**

Modify `src/core/recommend/config.ts`：在 `candidatePool: { ... }` 收尾的 `},`（约 204 行）之后、`exclusions: {` 之前插入：

```ts
  /**
   * 歌手语言表（spec §3.1 L3/§9）。表只存归一化歌手名→单一分桶，
   * artistTableLimit：容量，超出按"得票最低、最久没再听见"淘汰；
   * saveDebounceMs：换歌很频繁，观察合并成批写。
   * 语种配额相关的 capTolerance / maxConsecutive / bucketFetchesPerRefresh 等键由 Task 4、Task 6 各自补。
   */
  language: {
    artistTableLimit: 500,
    saveDebounceMs: 20000,
  },
```

- [ ] **Step 4: 写存储外壳**

Create `src/core/recommend/artistLanguageStore.ts`（结构照 `candidateStore.ts`，用同一套 `@/plugins/storage` 的 `getData/saveData/removeData`）：

```ts
/* eslint-disable require-atomic-updates */
import { getData, saveData, removeData } from '@/plugins/storage'
import { recommendationConfig } from './config.ts'
import { updateArtistLangTable } from './language.ts'
import type { ArtistLangTable, LangBucket } from './language.ts'

const ARTIST_LANG_KEY = 'xunyin_recommend_artist_lang_v1'

let table: ArtistLangTable | null = null
let pendingLoad: Promise<ArtistLangTable> | null = null

export const loadArtistLangTable = async(): Promise<ArtistLangTable> => {
  if (table) return table
  let loaded: ArtistLangTable | null = null
  try {
    loaded = await getData<ArtistLangTable>(ARTIST_LANG_KEY)
  } catch {
    loaded = null
  }
  table = loaded && typeof loaded == 'object' ? loaded : {}
  return table
}

/** 未 load 完成时返回空表而不是抛错：打分路径不该被存储时序卡住。 */
export const getArtistLangTable = (): ArtistLangTable => table ?? {}

let saveTimer: ReturnType<typeof setTimeout> | null = null

const scheduleSave = () => {
  if (!table || saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (!table) return
    void saveData(ARTIST_LANG_KEY, table).catch(() => {})
  }, recommendationConfig.language.saveDebounceMs)
}

/**
 * 观察写入。table 还没载完时必须排队等同一份 promise：
 * 直接 table ??= {} 会让稍后的 loadArtistLangTable() 命中内存副本、把磁盘上的旧表整张丢掉。
 */
const observe = (artists: readonly string[], bucket: LangBucket | null, source: 'lyric' | 'field') => {
  if (!bucket || bucket == 'unknown' || !artists.length) return
  const write = (target: ArtistLangTable) => {
    updateArtistLangTable(target, artists, bucket, source, recommendationConfig.language.artistTableLimit, Date.now())
    scheduleSave()
  }
  if (table) {
    write(table)
    return
  }
  pendingLoad ??= loadArtistLangTable()
  void pendingLoad.then(write).catch(() => {})
  pendingLoad.finally(() => {
    pendingLoad = null
  })
}

export const observeArtistLyric = (artists: readonly string[], bucket: LangBucket | null) => {
  observe(artists, bucket, 'lyric')
}

export const observeArtistLangField = (artists: readonly string[], bucket: LangBucket | null) => {
  observe(artists, bucket, 'field')
}

export const saveArtistLangTableNow = async() => {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!table) return
  await saveData(ARTIST_LANG_KEY, table).catch(() => {})
}

export const clearArtistLangTable = async() => {
  table = {}
  await removeData(ARTIST_LANG_KEY).catch(() => {})
}

export const getArtistLangKey = () => ARTIST_LANG_KEY
```

`updateArtistLangTable` 的第 5 参是 `limit`、第 6 参是 `now`（Task 1 签名），这里必须按位置传，不要写成命名参数。

- [ ] **Step 5: 引擎侧接线**

Modify `src/core/recommend/index.ts`：

1. 第 8 行 `trackKey` import 之后补一行：

```ts
import { bucketFromLangField, bucketFromLyric } from './language.ts'
```

2. 第 11 行 candidateStore import 之后补一行：

```ts
import { loadArtistLangTable, observeArtistLangField, observeArtistLyric } from './artistLanguageStore.ts'
```

3. `doInitialize()`（约 94 行）里 `await loadState()` 与 `this.stateReady = true` 之后插入：

```ts
    void loadArtistLangTable().catch(() => {})
```

不 await：表只影响后续打分，不该拖慢首次就绪。

4. `setRandomGenerator` 方法（约 124 行）之后加公开方法：

```ts
  /**
   * 歌词到手后喂歌手语言表（spec §3.1 L3）。同一首歌的两个信号各自记：
   * 接口语种字段强度高（strength=2），歌词字面统计强度低（strength=1），冲突时字段赢；
   * 两个都判不出（null）什么都不写。
   */
  observeLyricLanguage(musicInfo: LX.Music.MusicInfo, lyric: string | null | undefined) {
    const artists = getArtistKeys(musicInfo.singer)
    if (!artists.length) return
    const fieldBucket = bucketFromLangField(musicInfo.source, musicInfo.meta.lang)
    if (fieldBucket) observeArtistLangField(artists, fieldBucket)
    observeArtistLyric(artists, bucketFromLyric(lyric, musicInfo.name))
  }
```

- [ ] **Step 6: 播放器两处接线**

Modify `src/core/player/player.ts`：`recommendationEngine` 已在第 19 行 import，直接用。

第一处——`handleRestorePlay` 里的 `getLyricInfo` 成功回调（186–195 行），在 187 行守卫之后插一行：

```ts
  void getLyricInfo({ musicInfo }).then((lyricInfo) => {
    if (musicInfo.id != playMusicInfo.musicInfo?.id) return
    recommendationEngine.observeLyricLanguage(musicInfo, lyricInfo.lyric)
    setMusicInfo({
```

第二处——`debouncePlay`（206 行起）里的同一回调，在 219 行守卫之后插同一行：

```ts
  void getLyricInfo({ musicInfo }).then((lyricInfo) => {
    if (musicInfo.id != playerState.playMusicInfo.musicInfo?.id) return
    recommendationEngine.observeLyricLanguage(musicInfo, lyricInfo.lyric)
    setMusicInfo({
```

两处都要加：`handleRestorePlay` 只在恢复播放时跑，日常切歌走 `debouncePlay`。`catch` 分支什么都不写——歌词拉不到 ≠ 纯音乐（spec §3.1）。

- [ ] **Step 7: 闸门**

Run: `npm test`
Expected: 304 pass。本 Task 不加新单测：`artistLanguageStore.ts` 引 `@/plugins/storage`（AsyncStorage），`node --test --experimental-strip-types` 载不动；判定与合并逻辑已在 Task 1 的 `updateArtistLangTable` 覆盖。

Run: `npx eslint src/types/music.d.ts src/utils/index.ts src/core/recommend/artistLanguageStore.ts src/core/recommend/index.ts src/core/recommend/config.ts src/core/player/player.ts`
Expected: 0 error。

Run: `npx tsc --noEmit 2>&1 | grep -E "music\.d\.ts|utils/index|artistLanguageStore|core/recommend/index|core/player/player|recommend/config" || echo "no new errors"`
Expected: `no new errors`。`src/` 有既有 tsc 基线，本 Task 的判定标准是**上面这几个文件零命中**；若命中 `Property 'lang' does not exist`，说明 Step 3 的类型行没加对位置（必须加在 `MusicInfoMetaBase`，不是 `MusicInfoMeta_online`——local 源也要能带）。

- [ ] **Step 8: bundle 门（验证 Metro 真把新模块拉进依赖图）**

Run: `npm run build-test`
Expected: 生成 `index.android.bundle`（1–3 分钟）

Run: `grep -c "xunyin_recommend_artist_lang_v1" index.android.bundle`
Expected: ≥1。若为 0，说明 `artistLanguageStore.ts` 没进图——检查 `index.ts` 是否真的调用它，而不是只在注释里提到。

- [ ] **Step 9: 提交**

```bash
git add src/core/recommend/artistLanguageStore.ts src/core/recommend/config.ts src/core/recommend/index.ts src/core/player/player.ts src/types/music.d.ts src/utils/index.ts
git commit -m "feat(recommend): 歌词到手即喂歌手语言表，给语种判定补上 L3"
```

---

### Task 3: L1 穿透音源层——kg 与 tx 把语种原值交出来

对应 spec §2.1（可得性实测）与 §3.1 的 L1 行（"要穿过三层"）。Task 2 只铺好了管道（`meta.lang` 类型 + 双向透传），本 Task 让管道里有水。**这一步做完 L1 才有真值**，否则 `bucketFromLangField` 永远拿到 `undefined`，整套配额只能靠 L2/L3/L4 兜。

三条改动路径的实测依据（都已复现）：
- kg 搜索 `songsearch.kugou.com/song_search_v2` 每条都带 `trans_param.language`（中文词，例 `"粤语"`/`"英语"`/`"日语"`/`"韩语"`/`"西班牙语"`），但 `filterData` 没往外传。
- kg 歌单详情**端点有、引擎拿不到**：HTML 内嵌的 `global.data` 每项带 `trans_param.language`，可 `getMusicInfos` 只 `map(item => ({ hash: item.hash }))` 就丢掉了，重建出的对象自然没有语种——要按 hash 回填。
- tx 歌单详情 `fcg_ucc_getcdinfo_byids_cp.fcg` 在 URL 带 `new_format=1` 时每条带 `language` 数字码；`filterListDetail` 也没往外传。tx 搜索路径实测**不**带语种，本期不动。

**Files:**
- Modify: `src/utils/musicSdk/kg/musicSearch.js:49-65`（`filterData` 返回对象）
- Modify: `src/utils/musicSdk/kg/songList.js:324-332`（`getMusicInfos` 建语种索引）与 `src/utils/musicSdk/kg/songList.js:815-875`（`filterData2` 接收索引并回填）
- Modify: `src/utils/musicSdk/tx/songList.js:322-341`（`filterListDetail` 返回对象）
- Modify: `src/core/recommend/types.ts:165-189`（`PoolCandidate` 增 `lang` / `langHint`）
- Modify: `src/core/recommend/candidatePool.ts:22-40`（`CreatePoolCandidateInput`）、`:42-73`（`createPoolCandidate`）、`:78-118`（`mergePoolCandidates`）
- Create: `tests/recommend-candidate-lang.mts`
- Modify: `package.json`（`scripts.test` 追加新测试文件）

**Interfaces:**
- Consumes: Task 1 的 `bucketFromLangField`、`LangBucket`；Task 2 的 `meta.lang` 类型与双向透传。
- Produces:
  - `PoolCandidate.lang?: LangBucket`——**L1 事实**，由 `bucketFromLangField(source, musicInfo.meta.lang)` 得来；判不出时不写这个键（旧候选缺键是可预期的，Task 7 的 derive-on-read 负责补）。
  - `PoolCandidate.langHint?: LangBucket`——L2 批次提示，Task 6 的桶召回写入。
  - `CreatePoolCandidateInput.langHint?: LangBucket | null`
  - `resolvePoolLang(candidate, table?)`——Task 7 定义并导出，吃候选的 `lang`/`langHint`/`artistKeys`/`musicInfo`，返回 `{ bucket: LangBucket, level: 0 | 1 | 2 | 3 | 4 }`；本 Task 只留字段，不定义它。

- [ ] **Step 1: 先复现"引擎拿不到"，把改动前的现场钉住**

Run:

```bash
node -e "
const get=(u,o)=>fetch(u,o).then(r=>r.text());
(async()=>{
  const j=JSON.parse(await get('https://songsearch.kugou.com/song_search_v2?keyword='+encodeURIComponent('陈奕迅 喜欢你')+'&page=1&pagesize=5&userid=0&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1',{headers:{'User-Agent':'Mozilla/5.0'}}));
  console.log('search:', j.data.lists.map(it=>it.trans_param && it.trans_param.language).join(' / '));
  const html=await get('http://www2.kugou.kugou.com/yueku/v9/special/single/908552-5-9999.html',{headers:{'User-Agent':'Mozilla/5.0'}});
  const m=html.match(/global\.data = (\[.+\]);/);
  if(!m){console.log('detail: 这一张歌单页没取到 global.data，换一张 special id 再试（Step 1 只是取证，不阻塞改动）');return}
  const arr=JSON.parse(m[1]); const hist={};
  for(const it of arr){const l=it.trans_param && it.trans_param.language; hist[l]=(hist[l]||0)+1}
  console.log('detail:', arr.length, JSON.stringify(hist));
})()"
```

Expected: 第一行打印出若干 `粤语`（证明搜索路径有语种）；第二行若能取到则形如 `96 {"粤语":96}`。**这一步不是闸门**：`www2.kugou.kugou.com` 偶尔会返回没有 `global.data` 的短页（实测出现过一次 3548 字节的响应），取不到就换一张 special id 或跳过，不影响后续步骤——真正要改的是"就算取到了也会被丢掉"这段代码。

- [ ] **Step 2: 写失败的测试**

Create `tests/recommend-candidate-lang.mts`：

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { createPoolCandidate, mergePoolCandidates } from '../src/core/recommend/candidatePool.ts'

const musicInfoOf = (over: Record<string, any>) => ({
  id: `kg_${over.songmid ?? 'x'}`,
  name: over.name ?? '喜欢你',
  singer: over.singer ?? '邓紫棋',
  source: over.source ?? 'kg',
  interval: '03:55',
  meta: { songId: over.songmid ?? 'x', albumName: '新的心跳', lang: over.lang, ...over.meta },
})

const baseInput = (musicInfo: any) => ({
  musicInfo,
  channel: 'A' as const,
  sourceId: 'pl-1',
})

test('createPoolCandidate maps kg chinese language word into lang bucket', () => {
  const candidate = createPoolCandidate(baseInput(musicInfoOf({ lang: '粤语' })))
  assert.equal(candidate.lang, 'yue')
})

test('createPoolCandidate maps tx numeric language code into lang bucket', () => {
  const candidate = createPoolCandidate(baseInput(musicInfoOf({ source: 'tx', lang: 1 })))
  assert.equal(candidate.lang, 'yue')
})

test('createPoolCandidate omits lang when the source value is unusable', () => {
  const candidate = createPoolCandidate(baseInput(musicInfoOf({ lang: '自译解词' })))
  assert.equal(candidate.lang, undefined)
  assert.equal('lang' in candidate, false)
})

test('createPoolCandidate keeps langHint from the batch it came from', () => {
  const candidate = createPoolCandidate({ ...baseInput(musicInfoOf({ lang: null })), langHint: 'en' })
  assert.equal(candidate.langHint, 'en')
})

test('mergePoolCandidates takes the newer L1 fact and keeps the first langHint', () => {
  const hinted = createPoolCandidate({ ...baseInput(musicInfoOf({ lang: null, songmid: 'a1' })), langHint: 'ja' })
  const known = createPoolCandidate(baseInput(musicInfoOf({ lang: '粤语', songmid: 'a1' })))
  const [merged] = mergePoolCandidates([hinted], [known])
  assert.equal(merged.lang, 'yue')
  // 已有 langHint 时不被后来批次覆盖
  assert.equal(merged.langHint, 'ja')
})

test('mergePoolCandidates lets a later L1 fact win over an older one', () => {
  const old = createPoolCandidate(baseInput(musicInfoOf({ lang: '国语', songmid: 'a2' })))
  const fresh = createPoolCandidate(baseInput(musicInfoOf({ lang: '粤语', songmid: 'a2' })))
  const [merged] = mergePoolCandidates([old], [fresh])
  assert.equal(merged.lang, 'yue')
})

test('mergePoolCandidates keeps langHint from incoming when existing has none', () => {
  const bare = createPoolCandidate(baseInput(musicInfoOf({ lang: '国语', songmid: 'a3' })))
  const hinted = createPoolCandidate({ ...baseInput(musicInfoOf({ lang: null, songmid: 'a3' })), langHint: 'en' })
  const [merged] = mergePoolCandidates([bare], [hinted])
  assert.equal(merged.lang, 'zh')
  assert.equal(merged.langHint, 'en')
})
```

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-candidate-lang.mts`
Expected: FAIL ——`candidate.lang` 全为 `undefined`（字段还没加）

- [ ] **Step 3: kg 搜索路径带上语种原值**

Modify `src/utils/musicSdk/kg/musicSearch.js`：`filterData` 返回对象里 `source: 'kg',`（55 行）之后加一行：

```js
      source: 'kg',
      lang: rawData.trans_param?.language ?? null, // 中文词表（国语/粤语/英语…），键名是小写 trans_param
```

`trans_param` 是对象、键名小写（探针实测），用可选链就够；不要在此处做词表映射，分桶统一在 `language.ts`。

- [ ] **Step 4: kg 歌单详情按 hash 回填语种**

Modify `src/utils/musicSdk/kg/songList.js`。

先把 `getMusicInfos`（324–332 行）整体替换为：

```js
  async getMusicInfos(list) {
    // global.data 每项自带 trans_param.language，但下面的 createTask 只把 hash 送给 gateway 接口，
    // 回来的对象没有语种——先按 hash/songid 建索引，交给 filterData2 回填，否则 L1 在这条路上恒为空
    const langIndex = new Map()
    for (const item of list) {
      const lang = item.trans_param?.language
      if (!lang) continue
      if (item.hash) langIndex.set(String(item.hash).toUpperCase(), lang)
      const id = item.audio_id ?? item.songid ?? item.SongID
      if (id != null && id !== '') langIndex.set(`a${id}`, lang)
    }
    return this.filterData2(
      await Promise.all(
        this.createTask(
          this.deDuplication(list)
            .map(item => ({ hash: item.hash })),
        ))
        .then(([...datas]) => datas.flat()),
      langIndex)
  },
```

再把 `filterData2(rawList)`（815 行）签名改为带默认值：

```js
  filterData2(rawList, langIndex = new Map()) {
```

最后在该方法 `list.push({ ... })` 的 `source: 'kg',`（863 行）之后加一行：

```js
        source: 'kg',
        lang: langIndex.get(String(item.audio_info.hash).toUpperCase())
          ?? langIndex.get(`a${item.audio_info.audio_id}`)
          ?? null,
```

`getMusicInfos` 有 8 个调用点（121、369、396、462、513、555、614 行等），索引建在它内部就全覆盖；`filterData2` 只被它调用一处，默认参数保证签名变化不影响任何其他调用者。

- [ ] **Step 5: tx 歌单详情保留 language**

Modify `src/utils/musicSdk/tx/songList.js`：`filterListDetail` 返回对象里 `source: 'tx',`（327 行）之后加一行：

```js
        source: 'tx',
        lang: item.language ?? null, // 数字码，见 recommend/language.ts 的 TX_LANGUAGE_CODES
```

`getListDetail`（257 行）与回落路径 `getListDetail2`（198 行）都走 `this.filterListDetail(result.songlist)`，所以一处改动覆盖两条路。

Run: `grep -n "new_format=1" src/utils/musicSdk/tx/songList.js`
Expected: 仍能 grep 到 `getListDetailUrl`（64 行）里的 `new_format=1`。**这个参数一丢，`language` 字段整个消失**（实测过：换成 `only_source=1` 就没有了）——后续任何动 tx 歌单请求的改动都必须守住它。

- [ ] **Step 6: 复核 `lang` 能活过 `toNewMusicInfo` 白名单**

Step 3~5 把语种写在 SDK 返回对象的**顶层**，而推荐引擎拿到歌之前一律先过 `toNewMusicInfo`（`src/core/recommend/sdkCatalog.ts:195` 歌单详情、`:237` 榜单、`:254` 搜索）。这个函数是**白名单重建**：`src/utils/index.ts:29-42` 只组出 `id/name/singer/source/interval/meta` 六个键，其余顶层字段一律丢弃。所以这条链必须由 Task 2 Step 2 补的搬运行接上（`if (oldMusicInfo.lang != null) meta.lang = oldMusicInfo.lang`）——接不上的话本 Task 前五步等于白做，`createPoolCandidate` 读到的 `meta.lang` 恒为 `undefined`。

Run: `grep -n "meta.lang = oldMusicInfo.lang\|lang?: string | number | null" src/utils/index.ts src/types/music.d.ts`
Expected: 命中两行（`src/utils/index.ts` 的搬运 + `src/types/music.d.ts` 的 `MusicInfoMetaBase.lang`）。

这里只做验证，**不要在本 Task 重复实现**。断链就回到 Task 2 Step 2 补齐再回来，本 Task 的提交清单里也不该出现 `src/utils/index.ts` 或 `src/types/music.d.ts`。

- [ ] **Step 7: 候选池字段与合并策略**

Modify `src/core/recommend/types.ts`：`PoolCandidate`（165–189 行）里 `reasons: string[]` 之前加两行，并在文件顶部 import 区补 `import type { LangBucket } from './language.ts'`：

```ts
  /** L1 事实：音源逐曲语种字段分桶结果。判不出时不写该键（旧缓存候选靠 derive-on-read 补）。 */
  lang?: LangBucket
  /** L2 提示：候选来源的语种桶批次线索，可信度低于 lang。 */
  langHint?: LangBucket
```

Modify `src/core/recommend/candidatePool.ts`：

1. 顶部补 import：

```ts
import { bucketFromLangField } from './language.ts'
```

2. `CreatePoolCandidateInput`（22–40 行）里 `reason?: string` 之后加：

```ts
  /** L2 语种桶批次提示（桶召回用）；L1 由 musicInfo.meta.lang 自动推导，不需要入参。 */
  langHint?: LangBucket | null
```

3. `createPoolCandidate` 是块体函数、末尾只有一个 `return {`（48 行），先在它前面一行解出局部变量：

```ts
export const createPoolCandidate = (input: CreatePoolCandidateInput): PoolCandidate => {
  const trackKey = buildTrackKey(input.musicInfo)
  const channels = [...new Set([input.channel, ...(input.channels ?? [])])]
  const channelSourceId: Partial<Record<ChannelId, string>> = {}
  for (const channel of channels) channelSourceId[channel] = input.sourceId
  const primaryArtist = getPrimaryArtist(input.musicInfo)
  // L1：音源逐曲语种字段；判不出就不写这个键，让 derive-on-read 去走 L2~L4
  const lang = bucketFromLangField(input.musicInfo.source, input.musicInfo.meta.lang)
  return {
```

再在返回对象里 `reasons: ...` 之前加两条条件展开（用 `? {} :` 而不是把 `undefined` 塞进键值，保证"键不存在"这一状态可测）：

```ts
    ...(lang ? { lang } : {}),
    ...(input.langHint ? { langHint: input.langHint } : {}),
```

4. `mergePoolCandidates` 的 merged 对象（96–115 行）里 `addedAt: ...` 之前加：

```ts
      // L1 事实以较新的一份为准（同一首不同批次里，后到的更可能是重新拉取的现值）；
      // 只有旧的一边有 L1 时保留它；langHint 同理取先出现的那个（提示来自更可信的批次）。
      ...(candidate.lang ?? prev.lang ? { lang: candidate.lang ?? prev.lang } : {}),
      ...(prev.langHint ?? candidate.langHint ? { langHint: prev.langHint ?? candidate.langHint } : {}),
```

**两边都没有时必须整键缺席，不能写 `lang: undefined`。** 合并后的对象是以 `...prev` 起步的字面量，`createPoolCandidate` 那步特意用条件展开守住了"判不出就没有这个键"，合并这步若改成无条件赋值就会把它破掉：内存里 `'lang' in candidate` 会变成 `true` 而值是 `undefined`。JSON 落盘确实会丢掉 `undefined` 值，所以磁盘上看没问题——**但池子每轮刷新都在内存里合一次**（`index.ts` 的 merge 调用），恰恰是最常被推荐的"多歌单命中"候选带着这个幽灵键，Task 7 的读时推导若写成 `!('lang' in candidate)` 就永远不给它们补 L2/L3/L4。因此本 Step 额外补两条断言（进 `tests/recommend-candidate-lang.mts`，总数变 9）：

```ts
test('mergePoolCandidates keeps the lang key absent when neither side knows it', () => {
  const bare = createPoolCandidate(baseInput(musicInfoOf({})))
  const [merged] = mergePoolCandidates([bare], [createPoolCandidate(baseInput(musicInfoOf({})))])
  assert.equal('lang' in merged, false)
  assert.equal('langHint' in merged, false)
})

test('mergePoolCandidates output survives a JSON round trip', () => {
  // 候选池落盘是整池 JSON 重写，所以"键缺席"必须能穿过序列化仍然是缺席。
  // 注意 buildTrackKey（trackKey.ts:116-119）只由 name+singer 构成，songmid 不参与：
  // 想让池子里真留下两条，必须改 name/singer，只改 songmid 会被合并成一条。
  const known = createPoolCandidate(baseInput(musicInfoOf({ songmid: 'a', name: '喜欢你', lang: '粤语' })))
  const bare = createPoolCandidate(baseInput(musicInfoOf({ songmid: 'b', name: '泡沫' })))
  const revived = JSON.parse(JSON.stringify(mergePoolCandidates([known], [bare])))
  assert.equal(revived.length, 2)
  const withLang = revived.find((c: any) => c.musicInfo.id == 'kg_a')
  const withoutLang = revived.find((c: any) => c.musicInfo.id == 'kg_b')
  assert.equal(withLang.lang, 'yue')
  assert.equal('lang' in withoutLang, false)

  // 读盘后的两条同名同歌手候选再合并，才真的走合并分支：键缺席要一路保持
  const sameAsBare = createPoolCandidate(baseInput(musicInfoOf({ songmid: 'b', name: '泡沫' })))
  const [remerged] = mergePoolCandidates([withoutLang], [sameAsBare])
  assert.equal('lang' in remerged, false)
  assert.equal('langHint' in remerged, false)
})
```

**给 Task 6/7 的交接说明：** 任何"多条候选"的测试构造同理——`buildTrackKey` 不看 `songmid`/`id`（`local` 源除外），只按 `name`+`singer` 归一化定同一首，跨源同曲会被合并成一条。

- [ ] **Step 8: 跑通新测试并入白名单**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-candidate-lang.mts`
Expected: PASS 9 tests

Modify `package.json`：`scripts.test` 末尾追加 ` tests/recommend-candidate-lang.mts`。

Run: `npm test`
Expected: 313 pass（304 + 9，其中 Task 2 未增测试；若计数与此不符，以 `npm test 2>&1 | tail -20` 的实际 pass 数为准并记进交接说明，只要求 0 fail 且不减少）

- [ ] **Step 9: 静态闸门与 bundle 特征串**

Run: `npx eslint src/utils/musicSdk/kg/musicSearch.js src/utils/musicSdk/kg/songList.js src/utils/musicSdk/tx/songList.js src/core/recommend/candidatePool.ts src/core/recommend/types.ts`
Expected: 0 error。`src/utils/musicSdk/**` 是 `.js`，若报 `__DEV__` 之类的 globals 问题按仓库既有做法在文件头声明，不要顺手改 eslint 配置。

Run: `npx tsc --noEmit 2>&1 | grep -E "recommend/(candidatePool|types)" || echo "no new errors"`
Expected: `no new errors`

Run: `npm run build-test && grep -c "trans_param" index.android.bundle && grep -c "oldMusicInfo.lang" index.android.bundle`
Expected: 前者 ≥2（`musicSearch.js` 与 `songList.js` 各出现一次，只有 1 说明 Step 4 的索引代码没进包）；后者 ≥1，为 0 说明 Task 2 的白名单搬运行没进包（Step 6 的 grep 会先抓到这个断链）。

- [ ] **Step 10: 提交**

```bash
git add src/utils/musicSdk/kg/musicSearch.js src/utils/musicSdk/kg/songList.js src/utils/musicSdk/tx/songList.js src/core/recommend/types.ts src/core/recommend/candidatePool.ts tests/recommend-candidate-lang.mts package.json
git commit -m "feat(recommend): kg/tx 语种字段穿到候选池，L1 判定开始有真值"
```

---

### Task 4: 硬配额纯算术模块 `languageQuota.ts`

把 spec §3.2 的三段算式（目标数 / 已出现 / 本轮上限）与两条独立硬规则（同语言连播、纯音乐上限）做成一个**不 import 任何 IO、不 import musicSdk** 的纯模块，好让 Task 5 的执行点和 Task 6 的供给侧都能拿同一套数去判断，也方便单测穷举边界。

**Files:**
- Create: `src/core/recommend/languageQuota.ts`
- Modify: `src/core/recommend/config.ts`（Task 2 建好的 `language` 段里补 3 个键）
- Test: `tests/recommend-language-quota.mts`
- Modify: `package.json`（`test` 脚本白名单追加该测试文件）

**Interfaces:**
- Consumes：Task 1 的 `LangBucket` / `QUOTA_LANG_BUCKETS`（`./language.ts`）；`recommendationConfig.channels.windowSize`（20）；`recommendationConfig.language.*`。
- Produces（Task 5、6、7 全靠这些名字，不要改名）：
  - `const OPTION_TO_BUCKET: Record<string, LangBucket>`
  - `interface LangTargets { targets: Partial<Record<LangBucket, number>>; free: number; enforced: boolean }`
  - `computeLangTargets(weights: Record<string, number>, windowSize?): LangTargets`
  - `countLangUsed(recentLangs: ReadonlyArray<LangBucket | undefined>, windowSize?): Partial<Record<LangBucket, number>>`
  - `interface LangCaps { enforced: boolean; caps: Partial<Record<LangBucket, number>> }`
  - `computeLangCaps(targets: LangTargets, used: Partial<Record<LangBucket, number>>, tolerance?): LangCaps`
  - `langWithinCap(lang: LangBucket | undefined, caps: Partial<Record<LangBucket, number>>): boolean`
  - `consecutiveLangAllowed(recentLangs, lang, maxConsecutive?): boolean`
  - `instrumentalAllowed(recentLangs, windowSize?, maxPerWindow?): boolean`
  - `countPoolLang(candidates: ReadonlyArray<{ lang?: LangBucket, langHint?: LangBucket }>): Partial<Record<LangBucket, number>>`

**语义提醒（实现者不要自行猜，spec §3.2 已定）：**
- 百分比是**绝对占比**：中文 10% = 20 首里最多 2 首（+1 容差），跟用户还滑了什么无关。
- 各语言是独立滑条，加起来可能 >100 → 按声明值比例把 `target` 整体缩进窗口（最大余数法，照 `channels.ts:22` 的 `allocateByWeights` 写法），不静默丢弃。
- 加起来 <100 时剩余是**自由名额**：未声明的桶不受任何上限约束（`caps` 里根本不出现该键），已声明桶的上限照样卡住。
- 问卷全空 / 跳过 → `enforced: false`、`caps: {}`，行为等同今天，只剩连播硬规则与 `instr` 上限。
- `unknown`（含 `lang` 为 `undefined`）不占名额、也不能用来满足配额，`langWithinCap` 一律放行。

- [ ] **Step 1: 补配置键**

Modify `src/core/recommend/config.ts`，把 Task 2 写入的 `language` 段扩成：

```ts
  language: {
    artistTableLimit: 500,
    saveDebounceMs: 20000,
    /** 本轮上限相对缺口多给的余量（首）。只允许向下收紧，不回溯删除已排进队列的曲目。 */
    capTolerance: 1,
    /** 同一种语言最多连播几首（硬规则，配额放开档也守）。 */
    maxConsecutiveSameLang: 2,
    /** 纯音乐在 20 首窗口里的上限；不占语言名额。 */
    instrumentalPerWindow: 2,
  },
```

- [ ] **Step 2: 写失败测试**

Create `tests/recommend-language-quota.mts`：

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  OPTION_TO_BUCKET,
  computeLangTargets,
  countLangUsed,
  computeLangCaps,
  langWithinCap,
  consecutiveLangAllowed,
  instrumentalAllowed,
  countPoolLang,
} from '../src/core/recommend/languageQuota.ts'

test('选项 id 映射到语种桶', () => {
  assert.deepEqual({ ...OPTION_TO_BUCKET }, {
    zh: 'zh', cantonese: 'yue', western: 'en', ja: 'ja', ko: 'ko', other: 'other',
  })
})

test('百分比是绝对占比：中文 10% 在 20 首窗口里是 2 首，其余是自由名额', () => {
  const result = computeLangTargets({ zh: 10 })
  assert.deepEqual(result.targets, { zh: 2 })
  assert.equal(result.free, 18)
  assert.equal(result.enforced, true)
})

test('问卷全空时不设配额', () => {
  assert.deepEqual(computeLangTargets({}), { targets: {}, free: 20, enforced: false })
  assert.deepEqual(computeLangTargets({ pop: 80 }), { targets: {}, free: 20, enforced: false })
})

test('声明合计超过 100 时按比例缩进窗口，用最大余数法不丢名额', () => {
  const result = computeLangTargets({ zh: 60, western: 30, ja: 30 })
  assert.deepEqual(result.targets, { zh: 10, en: 5, ja: 5 })
  assert.equal(result.free, 0)
})

test('窗口大小可注入，目标数按占比缩放', () => {
  assert.deepEqual(computeLangTargets({ zh: 10 }, 10).targets, { zh: 1 })
  assert.deepEqual(computeLangTargets({ zh: 10 }, 10).free, 9)
})

test('已用量把上限压到剩余缺口，并带 1 首容差', () => {
  const targets = computeLangTargets({ zh: 10 })
  const used = countLangUsed(['zh', 'zh', 'en', 'unknown', undefined])
  assert.deepEqual(used, { zh: 2, en: 1 })
  assert.deepEqual(computeLangCaps(targets, used).caps, { zh: 1 })
})

test('已用量超过目标时上限收紧到容差，不会给负数', () => {
  const targets = computeLangTargets({ zh: 10 })
  assert.deepEqual(computeLangCaps(targets, { zh: 5 }).caps, { zh: 1 })
})

test('未声明的桶不进 caps，enforced 为 false 时 caps 是空对象', () => {
  const targets = computeLangTargets({ zh: 10 })
  const caps = computeLangCaps(targets, {})
  assert.equal('yue' in caps.caps, false)
  assert.equal(caps.enforced, true)
  assert.deepEqual(computeLangCaps(computeLangTargets({}), {}), { enforced: false, caps: {} })
})

test('unknown 与判不出的歌永不受配额限制', () => {
  assert.equal(langWithinCap('unknown', { zh: 0 }), true)
  assert.equal(langWithinCap(undefined, { zh: 0 }), true)
  assert.equal(langWithinCap('yue', { zh: 0 }), true)
  assert.equal(langWithinCap('zh', { zh: 0 }), false)
  assert.equal(langWithinCap('zh', { zh: 3 }), true)
})

test('同语言连播硬规则只看尾部连续段，不看全窗口', () => {
  assert.equal(consecutiveLangAllowed(['zh', 'zh'], 'zh'), false)
  assert.equal(consecutiveLangAllowed(['zh'], 'zh'), true)
  assert.equal(consecutiveLangAllowed(['zh', 'en', 'zh', 'zh'], 'zh'), false)
  assert.equal(consecutiveLangAllowed(['en', 'en'], 'zh'), true)
  assert.equal(consecutiveLangAllowed(['unknown', 'unknown'], 'unknown'), true)
  assert.equal(consecutiveLangAllowed(['unknown', 'unknown'], 'zh'), true)
  // 只有第一条能区分"尾部连续段"和"全窗口计数"：全窗口会数到 2 个 zh 而误拦
  assert.equal(consecutiveLangAllowed(['zh', 'en', 'en', 'en', 'zh'], 'zh'), true)
  // 第二条是反面补位：尾部真攒够 2 连照样拦
  assert.equal(consecutiveLangAllowed(['en', 'en', 'en', 'zh', 'zh'], 'zh'), false)
})

test('名额不能整除时余数照最大余数法补齐，一个名额都不丢', () => {
  // 20 首按 34/33/33 分：各得 floor 6，共 18；剩 2 首按余数补给 zh(.8) 与 en(.6)
  // 这条是 allocateByPercents 里 `for (let i = allocated; i < total; i++)` 唯一的实跑证据
  const result = computeLangTargets({ zh: 34, western: 33, ja: 33 })
  assert.deepEqual(result.targets, { zh: 7, en: 7, ja: 6 })
  assert.equal(result.free, 0)
})

test('纯音乐每窗口最多 2 首，且只数最近 20 首', () => {
  assert.equal(instrumentalAllowed(['instr', 'instr', 'zh']), false)
  assert.equal(instrumentalAllowed(['instr', 'zh']), true)
  const long = ['instr', 'instr', ...Array.from({ length: 25 }, () => 'zh' as const)]
  assert.equal(instrumentalAllowed(long), true)
})

test('窗口 0 或负数按空窗口算，不能退化成看全历史', () => {
  // arr.slice(-0) === arr.slice(0)：不夹紧的话 Task 5/6 传一个算出来的剩余窗口就会把全历史当本轮用量
  assert.deepEqual(countLangUsed(['zh', 'zh', 'en'], 0), {})
  assert.deepEqual(countLangUsed(['zh', 'zh', 'en'], -5), {})
  assert.equal(instrumentalAllowed(['instr', 'instr'], 0), true)
})

test('池内按桶计数：lang 优先，判不出退 langHint，再不行算 unknown', () => {
  const counts = countPoolLang([
    { lang: 'zh', langHint: 'en' },
    { lang: 'en' },
    { langHint: 'ja' },
    {},
  ])
  assert.deepEqual(counts, { zh: 1, en: 1, ja: 1, unknown: 1 })
})
```

- [ ] **Step 3: 跑到失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-language-quota.mts`
Expected: `ERR_MODULE_NOT_FOUND`，指向 `languageQuota.ts`。这一步同时确认该模块能被测试载入（纯模块，无 IO）。

- [ ] **Step 4: 实现 `languageQuota.ts`**

Create `src/core/recommend/languageQuota.ts`：

```ts
import { recommendationConfig } from './config.ts'
import { QUOTA_LANG_BUCKETS } from './language.ts'
import type { LangBucket } from './language.ts'

/**
 * 语种硬配额的纯算术层：问卷百分比 → 窗口目标数 → 本轮可选上限。
 * 执行点在 diversity.ts 的筛子里（消费 caps/连播），供给侧在 candidate.ts（消费缺口）。
 */

export const OPTION_TO_BUCKET: Record<string, LangBucket> = {
  zh: 'zh',
  cantonese: 'yue',
  western: 'en',
  ja: 'ja',
  ko: 'ko',
  other: 'other',
}

/**
 * 取队列尾部 windowSize 首。必须显式处理 0/负数：`arr.slice(-0)` 等于 `arr.slice(0)`，
 * 不夹紧就会把"本轮没有窗口"算成"整段历史都是本轮用量"。
 */
const windowSlice = <T>(items: readonly T[], windowSize: number): readonly T[] => {
  const size = Math.max(0, Math.floor(windowSize))
  return size === 0 ? [] : items.slice(-size)
}

export interface LangTargets {
  /** 已声明桶的目标首数；未声明的桶不在这里。 */
  targets: Partial<Record<LangBucket, number>>
  /** 窗口里没被任何声明桶占走的名额。 */
  free: number
  /** 问卷没滑过任何语言时为 false，本轮不设配额。 */
  enforced: boolean
}

/** 最大余数法：按占比把 total 首分给声明桶，同余数按声明顺序排前（照 channels.ts allocateByWeights）。 */
const allocateByPercents = (total: number, percents: Partial<Record<LangBucket, number>>): Partial<Record<LangBucket, number>> => {
  const result: Partial<Record<LangBucket, number>> = {}
  const buckets = QUOTA_LANG_BUCKETS.filter(bucket => (percents[bucket] ?? 0) > 0)
  const sum = buckets.reduce((acc, bucket) => acc + (percents[bucket] ?? 0), 0)
  if (sum <= 0 || total <= 0) return result
  const remainders: Array<{ bucket: LangBucket, remainder: number }> = []
  let allocated = 0
  for (const bucket of buckets) {
    const exact = total * (percents[bucket] ?? 0) / sum
    result[bucket] = Math.floor(exact)
    allocated += result[bucket]
    remainders.push({ bucket, remainder: exact - result[bucket] })
  }
  remainders.sort((a, b) => b.remainder - a.remainder)
  for (let i = allocated; i < total; i++) {
    result[remainders[(i - allocated) % remainders.length].bucket] += 1
  }
  return result
}

export const computeLangTargets = (
  weights: Record<string, number>,
  windowSize: number = recommendationConfig.channels.windowSize,
): LangTargets => {
  const percents: Partial<Record<LangBucket, number>> = {}
  for (const [optionId, raw] of Object.entries(weights)) {
    const bucket = OPTION_TO_BUCKET[optionId]
    if (!bucket || typeof raw != 'number' || !Number.isFinite(raw)) continue
    percents[bucket] = (percents[bucket] ?? 0) + Math.max(0, Math.min(100, raw))
  }
  const sum = QUOTA_LANG_BUCKETS.reduce((acc, bucket) => acc + (percents[bucket] ?? 0), 0)
  if (sum <= 0) return { targets: {}, free: Math.max(0, Math.floor(windowSize)), enforced: false }

  const window = Math.max(0, Math.floor(windowSize))
  // 合计 >100 时全部名额都给声明桶；<100 时只给占比对应的那一段，剩下算自由名额
  const declared = Math.min(window, Math.round(window * Math.min(sum, 100) / 100))
  const targets = allocateByPercents(declared, percents)
  const given = QUOTA_LANG_BUCKETS.reduce((acc, bucket) => acc + (targets[bucket] ?? 0), 0)
  return { targets, free: Math.max(0, window - given), enforced: true }
}

export const countLangUsed = (
  recentLangs: ReadonlyArray<LangBucket | undefined>,
  windowSize: number = recommendationConfig.channels.windowSize,
): Partial<Record<LangBucket, number>> => {
  const counts: Partial<Record<LangBucket, number>> = {}
  for (const lang of windowSlice(recentLangs, windowSize)) {
    if (!lang || lang == 'unknown') continue
    counts[lang] = (counts[lang] ?? 0) + 1
  }
  return counts
}

export interface LangCaps {
  enforced: boolean
  /** 只包含已声明桶；缺席即代表该桶不受配额约束。 */
  caps: Partial<Record<LangBucket, number>>
}

export const computeLangCaps = (
  targets: LangTargets,
  used: Partial<Record<LangBucket, number>>,
  tolerance: number = recommendationConfig.language.capTolerance,
): LangCaps => {
  if (!targets.enforced) return { enforced: false, caps: {} }
  const caps: Partial<Record<LangBucket, number>> = {}
  for (const bucket of QUOTA_LANG_BUCKETS) {
    const target = targets.targets[bucket]
    if (target === undefined) continue
    caps[bucket] = Math.max(0, target - (used[bucket] ?? 0)) + Math.max(0, Math.floor(tolerance))
  }
  return { enforced: true, caps }
}

/** 判不出语言的歌（unknown / undefined）放行：它既不能凑配额也不该被当成另一种语言卡住。 */
export const langWithinCap = (lang: LangBucket | undefined, caps: Partial<Record<LangBucket, number>>): boolean => {
  if (!lang || lang == 'unknown') return true
  const cap = caps[lang]
  if (cap === undefined) return true
  return cap > 0
}

/** 连播硬规则：只看队列尾部的同语言连续段，与窗口配额无关。 */
export const consecutiveLangAllowed = (
  recentLangs: ReadonlyArray<LangBucket | undefined>,
  lang: LangBucket | undefined,
  maxConsecutive: number = recommendationConfig.language.maxConsecutiveSameLang,
): boolean => {
  if (!lang || lang == 'unknown') return true
  let run = 0
  for (let i = recentLangs.length - 1; i >= 0; i--) {
    if (recentLangs[i] != lang) break
    run += 1
  }
  return run < Math.max(1, Math.floor(maxConsecutive))
}

export const instrumentalAllowed = (
  recentLangs: ReadonlyArray<LangBucket | undefined>,
  windowSize: number = recommendationConfig.channels.windowSize,
  maxPerWindow: number = recommendationConfig.language.instrumentalPerWindow,
): boolean => {
  let count = 0
  for (const lang of windowSlice(recentLangs, windowSize)) {
    if (lang == 'instr') count += 1
  }
  return count < Math.max(0, Math.floor(maxPerWindow))
}

/** 池内各桶现有多少首：L1 的 lang 优先，判不出才退 L2 的桶召回提示。 */
export const countPoolLang = (
  candidates: ReadonlyArray<{ lang?: LangBucket, langHint?: LangBucket }>,
): Partial<Record<LangBucket, number>> => {
  const counts: Partial<Record<LangBucket, number>> = {}
  for (const candidate of candidates) {
    const bucket = candidate.lang ?? candidate.langHint ?? 'unknown'
    counts[bucket] = (counts[bucket] ?? 0) + 1
  }
  return counts
}
```

- [ ] **Step 5: 跑到通过**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-language-quota.mts`
Expected: 14 条测试全 PASS。

若「已声明合计 60/30/30」那条给出 `{ zh: 10, en: 5, ja: 5 }` 之外的结果，先打印 `allocateByPercents` 的 `remainders` 再改代码，不要靠调阈值凑过。

- [ ] **Step 6: 并入 npm test 白名单**

Modify `package.json`：在 `tests/recommend-candidate-lang.mts` 之后插入 `tests/recommend-language-quota.mts`（保持既有"显式文件白名单"写法，不要改成 glob）。

Run: `npm test`
Expected: `# fail 0`。**不要用它的 pass 总数当闸门**——同一工作树里有另一条功能线（识曲）正在并发改 `tests/music-recognition-*.mts`，总数会自己漂（本 Task 期间实测从 313 漂到 319）。本 Task 的计数闸门是按文件跑：`node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-language.mts tests/recommend-candidate-lang.mts tests/recommend-language-quota.mts` 应为 **34 pass / 0 fail**（11 + 9 + 14）。

- [ ] **Step 7: 静态闸门**

Run: `npx eslint src/core/recommend/languageQuota.ts src/core/recommend/config.ts`
Expected: 0 error。

Run: `npx tsc --noEmit 2>&1 | grep -E "recommend/(languageQuota|config)" || echo "no new errors"`
Expected: `no new errors`（src 有既有基线，只要求本次路径零新增）。

- [ ] **Step 8: 提交**

```bash
git add src/core/recommend/languageQuota.ts src/core/recommend/config.ts tests/recommend-language-quota.mts package.json
git commit -m "feat(recommend): 语种硬配额纯算术模块，问卷百分比按绝对占比落到窗口"
```

---

### Task 5: 配额落地——`diversity.ts` 执行点与引擎接线

Task 4 只会算数，不会拦歌。本 Task 把三道闸接到最终选曲的筛子里：**已声明桶的本轮上限**（随放开档失效）、**同语言不连播超过 2 首**、**纯音乐 20 首里最多 2 首**（后两条独立于配额，放开档也守）。对应 spec §3.2 的"执行点""阶梯""连播硬规则""instr"四条。

**Files:**
- Modify: `src/core/recommend/diversity.ts`（`FinalQueueItem` 29-45、`FinalQueueSelectionOptions` 47-55、`RelaxConfig` 69-77、`getRelaxConfigs` 79-129、`checkItemConstraints` 144-178、`selectFinalQueue` 182-305）
- Modify: `src/core/recommend/candidatePool.ts`（`buildFinalQueueItems` 272-298 透传 `lang`）
- Modify: `src/core/recommend/index.ts`（`pushMusicInfo` 369-384 就地算 lang；`generateQueue` 439-508 传 `langCaps`；533 recallLog 补诊断字段）
- Test: `tests/recommend-diversity-lang.mts`
- Modify: `package.json`（白名单追加）

**Interfaces:**
- Consumes：Task 4 全部导出；Task 1 `resolveLang`；Task 2 `getArtistLangTable`；Task 3 `PoolCandidate.lang`。
- Produces：`FinalQueueItem.lang?: LangBucket`、`FinalQueueSelectionOptions.langCaps?: LangCaps`、`RelaxConfig.langQuotaEnforced: boolean`。Task 7 要往 `FinalQueueBuildOptions` 上加 `artistLangTable`，别在本 Task 提前加。

- [ ] **Step 1: 写失败测试**

Create `tests/recommend-diversity-lang.mts`。`diversity.ts` 只引 `config.ts`/`types.ts`/`channels.ts` 等纯模块，实测可被 `node --test --experimental-strip-types` 直接载入，所以这里能对真函数做端到端断言。

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { selectFinalQueue } from '../src/core/recommend/diversity.ts'
import { planChannelQuotas } from '../src/core/recommend/channels.ts'
import { computeLangTargets, computeLangCaps } from '../src/core/recommend/languageQuota.ts'
import type { FinalQueueItem } from '../src/core/recommend/diversity.ts'
import type { LangBucket } from '../src/core/recommend/language.ts'

const seedRandom = (seed: number) => {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

// 每条候选都要避开歌手/歌单/专辑间隔约束，否则测到的是 antiRepeat 不是语种
// 权重必须落在 0.6 倍以内：applyQualityGate（config.ts qualityGateRatio=0.6）
// 会先把同通道里低于最高分×0.6 的候选整个剔出抽样，权重差太多时对照组根本没人可选。
const mkItem = (index: number, lang: LangBucket | undefined, weight = 1): FinalQueueItem => ({
  key: `k${index}`,
  channels: ['A'],
  primaryArtist: `artist-${index}`,
  artistKeys: [`artist-${index}`],
  albumKey: `album-${index}`,
  sourcePlaylistId: `pl-${index}`,
  weight,
  lang,
})

const items = (list: Array<Selected>) => list.map(entry => entry.item)
type Selected = { item: FinalQueueItem }

const langCapsFor = (weights: Record<string, number>, recentLangs: Array<LangBucket | undefined>) =>
  computeLangCaps(computeLangTargets(weights), countLangUsed(recentLangs))

test('已声明语种的上限卡住本轮选择，未声明语种不受限', () => {
  // 三组候选：zh 权重 3（本应被优先选中）、en/ja 权重 2（仍过 0.6 质量闸门）。
  // ja 必须存在：只有 zh+en 时，连播硬规则让 3 首 zh 最多再配 3 首 en，凑不满 8 首，
  // 阶梯会被迫走放开档多收 zh —— 那测到的是"放开档"而不是"上限"。
  const candidates = [
    ...Array.from({ length: 10 }, (_, i) => mkItem(i, 'zh', 3)),
    ...Array.from({ length: 10 }, (_, i) => mkItem(100 + i, 'en', 2)),
    ...Array.from({ length: 10 }, (_, i) => mkItem(200 + i, 'ja', 2)),
  ]
  const plan = planChannelQuotas(8, [], { A: 30, B: 0, C: 0, D: 0 })
  const zhCount = (list: Array<{ item: FinalQueueItem }>) => list.filter(entry => entry.item.lang == 'zh').length
  const capped = selectFinalQueue(candidates, {
    target: 8,
    channelPlan: plan,
    rng: seedRandom(7),
    langCaps: langCapsFor({ zh: 10 }, []),
  })
  assert.equal(capped.items.length, 8)
  assert.ok(zhCount(capped.items) <= 3, `zh should stay within target 2 + tolerance 1, got ${zhCount(capped.items)}`)
  // 对照组：同一份候选、同一个种子，不传 caps 时 zh 必须更多，否则上面的上界是空断言。
  // 两次都要重新 seedRandom（rng 有内部状态）。把两个数字都写进报告，不要为了过而换种子。
  const control = selectFinalQueue(candidates, { target: 8, channelPlan: plan, rng: seedRandom(7) })
  assert.ok(zhCount(control.items) > zhCount(capped.items), `cap should reduce zh: control=${zhCount(control.items)} capped=${zhCount(capped.items)}`)
})

test('同语言连播硬规则与配额无关：enforced=false 也拦住第三首中文', () => {
  // zh 权重 3，本应被优先选中；第一首不是 zh 才是连播硬规则在起作用。
  // 不能断言第一首"等于 en"：en 与 ja 权重相同，具体落谁头上取决于种子，而规则只保证"不是 zh"。
  const candidates = [
    ...Array.from({ length: 5 }, (_, i) => mkItem(i, 'zh', 3)),
    ...Array.from({ length: 10 }, (_, i) => mkItem(100 + i, 'en', 2)),
    ...Array.from({ length: 5 }, (_, i) => mkItem(200 + i, 'ja', 2)),
  ]
  const recent = [mkItem(300, 'zh'), mkItem(301, 'zh')]
  const plan = planChannelQuotas(3, [], { A: 20, B: 0, C: 0, D: 0 })
  const result = selectFinalQueue(candidates, {
    target: 3,
    recent,
    channelPlan: plan,
    rng: seedRandom(3),
  })
  assert.equal(result.items.length, 3)
  assert.notEqual(result.items[0].item.lang, 'zh', 'first pick must break the zh run even with no quota')
  const seq = [...recent, ...items(result.items)]
  for (let i = 2; i < seq.length; i++) {
    if (seq[i].lang == 'unknown' || seq[i].lang == undefined) continue
    assert.ok(!(seq[i].lang == seq[i - 1].lang && seq[i].lang == seq[i - 2].lang), `three in a row of ${seq[i].lang}`)
  }
})

test('纯音乐在窗口里另设上限，不占语言名额', () => {
  // instr 权重 3：不设上限时它会被优先选，2 首的上界才只可能来自规则。
  // 另配 en 一组（权重 2）：instr 卡到 2 首之后，只剩 zh 会被连播规则再次卡死（凑不满 10 首）。
  const candidates = [
    ...Array.from({ length: 6 }, (_, i) => mkItem(i, 'instr', 3)),
    ...Array.from({ length: 20 }, (_, i) => mkItem(100 + i, 'zh', 2)),
    ...Array.from({ length: 20 }, (_, i) => mkItem(300 + i, 'en', 2)),
  ]
  const plan = planChannelQuotas(10, [], { A: 46, B: 0, C: 0, D: 0 })
  const result = selectFinalQueue(candidates, { target: 10, channelPlan: plan, rng: seedRandom(5) })
  assert.equal(result.items.length, 10)
  assert.ok(result.items.filter(entry => entry.item.lang == 'instr').length <= 2)

  // 另一半断言：纯音乐不能吃语言名额。zh 只给 1 个名额，2 首 instr 各占一格的话
  // 第 3 首 zh 就得靠放开档出歌（reasons 里会出现 lang_quota_relaxed）——那是错的。
  const mixed = [
    ...Array.from({ length: 4 }, (_, i) => mkItem(20 + i, 'instr', 3)),
    ...Array.from({ length: 4 }, (_, i) => mkItem(120 + i, 'zh', 2)),
  ]
  const smallPlan = planChannelQuotas(3, [], { A: 8, B: 0, C: 0, D: 0 })
  const mixedResult = selectFinalQueue(mixed, {
    target: 3,
    channelPlan: smallPlan,
    rng: seedRandom(5),
    langCaps: { enforced: true, caps: { zh: 1 } },
  })
  assert.equal(mixedResult.items.length, 3)
  assert.equal(mixedResult.items.filter(entry => entry.item.lang == 'instr').length, 2)
  assert.equal(mixedResult.reasons.includes('lang_quota_relaxed'), false,
    `instrumentals must not eat the language headroom, got ${mixedResult.reasons.join(',')}`)
})

test('池里只有超配额语种时靠放开档出歌，并留下 lang_quota_relaxed 线索', () => {
  // 必须配 2 首 unknown：它不受配额也不参与连播计数，先占掉前两格，
  // 第三格只剩超配额的 zh —— 全靠 zh 的话队列只能凑到 2 首（连播硬规则恒守），
  // 那样测出来的是"凑不满"而不是"靠放开档凑满"。
  const candidates = [
    ...Array.from({ length: 2 }, (_, i) => mkItem(200 + i, 'unknown')),
    ...Array.from({ length: 6 }, (_, i) => mkItem(i, 'zh')),
  ]
  const plan = planChannelQuotas(3, [], { A: 8, B: 0, C: 0, D: 0 })
  const result = selectFinalQueue(candidates, {
    target: 3,
    channelPlan: plan,
    rng: seedRandom(1),
    langCaps: { enforced: true, caps: { zh: 0 } },
  })
  assert.equal(result.items.length, 3, 'quota relaxation must still fill the queue')
  assert.ok(result.reasons.includes('lang_quota_relaxed'), `expected lang_quota_relaxed, got ${result.reasons.join(',')}`)
})

test('用掉最后一个合法名额不算放开配额：线索必须能分清两者', () => {
  // 阶梯升级的原因必须和语言无关：recent 两首与候选同歌手，0~3 档全被 artistGap 卡住，
  // 候选带着 1 个合法名额在第 4 档被收下。若埋点读的是"扣完之后"的额度，
  // 这条合法消耗会和真正的超额破例给出同一串 reasons。
  const asChorus = (index: number, lang: LangBucket | undefined) => ({
    ...mkItem(index, lang),
    primaryArtist: 'shared-artist',
    artistKeys: ['shared-artist'],
  })
  const recent = [asChorus(900, 'zh'), asChorus(901, 'en')]
  const plan = planChannelQuotas(1, [], { A: 20, B: 0, C: 0, D: 0 })
  const result = selectFinalQueue([asChorus(1, 'zh')], {
    target: 1,
    recent,
    channelPlan: plan,
    rng: seedRandom(11),
    langCaps: { enforced: true, caps: { zh: 1 } },
  })
  assert.equal(result.maxRelaxLevel, 4, 'escalation must come from the artist gap, not the quota')
  assert.equal(result.items.length, 1, 'the last legal unit of the quota must still be pickable')
  assert.equal(result.reasons.includes('lang_quota_relaxed'), false,
    `legal consumption must not look like a bypass, got ${result.reasons.join(',')}`)
})

test('判不出语言的歌直接放行，不触发放开档', () => {
  const candidates = [
    ...Array.from({ length: 4 }, (_, i) => mkItem(i, 'unknown')),
    ...Array.from({ length: 4 }, (_, i) => mkItem(100 + i, undefined)),
  ]
  const plan = planChannelQuotas(4, [], { A: 8, B: 0, C: 0, D: 0 })
  const result = selectFinalQueue(candidates, {
    target: 4,
    channelPlan: plan,
    rng: seedRandom(9),
    langCaps: { enforced: true, caps: { zh: 0 } },
  })
  assert.equal(result.items.length, 4)
  assert.equal(result.reasons.includes('lang_quota_relaxed'), false)
  assert.equal(result.maxRelaxLevel, 0)
})
```

**注意**：`import { countLangUsed }` 也要加到文件顶部的 `languageQuota.ts` import 里（上面 `langCapsFor` 用到它）。写测试时一次补全，别等报错再补。

- [ ] **Step 2: 跑到失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-diversity-lang.mts`
Expected: 第 1 条 FAIL，报 `zh should stay within target 2 + tolerance 1`（`langCaps` 还不存在、被忽略）。`strip-types` 不做类型检查，所以"多传一个不存在的 option"不会在这里报错，会在 Step 7 的 tsc 报错——两道都要跑。

- [ ] **Step 3: 改 `diversity.ts` 的类型与阶梯**

1. `FinalQueueItem`（29-45）在 `albumKey: string` 之后加一行：

```ts
  /** 语种桶：配额与连播硬规则的唯一依据。undefined 与 unknown 同义——不受配额约束。 */
  lang?: LangBucket
```

2. 文件顶部补 import：

```ts
import { consecutiveLangAllowed, instrumentalAllowed, langWithinCap } from './languageQuota.ts'
import type { LangCaps } from './languageQuota.ts'
import type { LangBucket } from './language.ts'
```

3. `FinalQueueSelectionOptions`（47-55）在 `explorationGap?: number` 之后加：

```ts
  /** 语种硬配额：由调用方按问卷 + 最近窗口算好传入；缺席即代表本轮不设配额。 */
  langCaps?: LangCaps
```

4. `RelaxConfig`（69-77）加必填字段：

```ts
  /** 本档是否仍卡语种配额。放开档只放开配额，连播与纯音乐上限恒守。 */
  langQuotaEnforced: boolean
```

5. `getRelaxConfigs()`（79-129）是**零参函数、返回五个硬写字面量**，漏填就编译不过（字段必填）。逐个补：下标 0、1、2 三档 `langQuotaEnforced: true`，下标 3、4 两档 `langQuotaEnforced: false`。不要写成 `langQuotaEnforced: relaxLevel < 3` 之类由循环生成的形式——保持"五个字面量逐个可见"的既有写法。

- [ ] **Step 4: 改 `checkItemConstraints`**

签名加第 4 参，并在函数**开头**（早于歌手间隔循环）插三条语种判定：

```ts
interface LangGuardState {
  /** 调用方是否真的设了配额（问卷全空时是 false）。 */
  enforced: boolean
  /** 本轮剩余额度，选走一首即减 1；缺席的桶代表不受约束。 */
  remaining: Partial<Record<LangBucket, number>>
  /** 与 history 同步维护的语种序列（旧→新），供连播与纯音乐规则读尾部。 */
  langs: Array<LangBucket | undefined>
}

const checkItemConstraints = (
  item: FinalQueueItem,
  history: readonly FinalQueueItem[],
  relax: RelaxConfig,
  langGuard: LangGuardState,
) => {
  // 语种判定排在最前：它最便宜，且"连三四首中文"是用户最直接的感受，不该被后面的间隔检查稀释
  if (relax.langQuotaEnforced && langGuard.enforced && !langWithinCap(item.lang, langGuard.remaining)) return false
  if (!consecutiveLangAllowed(langGuard.langs, item.lang)) return false
  if (item.lang == 'instr' && !instrumentalAllowed(langGuard.langs)) return false
  // 合唱需要检查全部可靠识别出的参与歌手。
  for (const artist of item.artistKeys) {
```

`instrumentalAllowed` 只在候选本身是 `instr` 时调用——否则会把"池里已有 2 首纯音乐"误判成所有歌都不能选。

- [ ] **Step 5: 改 `selectFinalQueue`**

1. 开头（`history` 初始化之后，约 193 行）建出守卫，并**克隆** caps：

```ts
  const history: FinalQueueItem[] = (options.recent ?? []).slice(-60)
  const langGuard: LangGuardState = {
    enforced: options.langCaps?.enforced === true,
    remaining: options.langCaps?.enforced ? { ...options.langCaps.caps } : {},
    langs: history.map(item => item.lang),
  }
```

必须克隆：`selectFinalQueue` 是纯函数，直接写 `options.langCaps.caps` 会把调用方（引擎状态）的额度扣掉，第二次生成队列就少一批名额。

2. `runChannelLadder` 与 fallback 里的两处 `checkItemConstraints(item, history, relax)` / `checkItemConstraints(item, history, fallbackRelax)` 都补第 4 参 `langGuard`。

3. 选定之后（`history.push(chosen)` 那一行附近，296-297）同步守卫并埋点：

```ts
    history.push(chosen)
    if (history.length > 60) history.splice(0, history.length - 60)
    langGuard.langs.push(chosen.lang)
    if (langGuard.langs.length > 60) langGuard.langs.splice(0, langGuard.langs.length - 60)
    // 必须在扣额度**之前**读：`langWithinCap` 判的是 cap > 0，扣完之后"合法用掉最后一个名额"
    // 和"本来就超额"都是 0，两者就分不开了（实测：caps {zh:1} 与 {zh:0} 会给出同一条线索）
    const langOverCapAtPickTime = langGuard.enforced && !langWithinCap(chosen.lang, langGuard.remaining)
    if (chosen.lang && chosen.lang != 'unknown') {
      const remaining = langGuard.remaining[chosen.lang]
      if (remaining !== undefined) langGuard.remaining[chosen.lang] = Math.max(0, remaining - 1)
    }
    // 这首是在"语种配额已放开"的档位下才收下的：日志要能看出配额本轮没兑现，而不是假装满足
    if (langOverCapAtPickTime && !relaxConfigs[chosenRelax].langQuotaEnforced &&
      !reasons.includes('lang_quota_relaxed')) {
      reasons.push('lang_quota_relaxed')
    }
```

`langs` 与 `history` 的下标必须同步裁剪（两个 `splice` 数字一样），否则连播判定会看到错位的历史。

- [ ] **Step 6: 候选池与引擎侧透传 lang**

1. Modify `src/core/recommend/candidatePool.ts`：`buildFinalQueueItems` 返回对象（281 起）里，`albumKey: candidate.albumKey,` 之后加一行

```ts
      lang: candidate.lang,
```

2. Modify `src/core/recommend/index.ts`：`pushMusicInfo`（369-384）里，`items.push` 之前先算桶，push 对象里 `albumKey: getAlbumName(musicInfo),` 之后加 `lang`：

```ts
    const pushMusicInfo = (musicInfo: LX.Music.MusicInfo, channel?: ChannelId, playlistId?: string, seedKey?: string, groupId?: string, chartId?: string) => {
      const artistKeys = getArtistKeys(musicInfo.singer)
      items.push({
        key: buildTrackKey(musicInfo),
        channels: channel ? [channel] : [],
        primaryArtist: getPrimaryArtist(musicInfo),
        artistKeys,
        albumKey: getAlbumName(musicInfo),
        lang: resolveLang({
          source: musicInfo.source,
          // 这里的 musicInfo 来自播放器状态/持久化队列，不保证带 meta（本模块 trackKey.ts:104,113、filter.ts:59 都按可缺处理）：
          // 少一个 ?. 就是在选曲主流程里埋一个 TypeError，整批队列生成失败
          langField: musicInfo.meta?.lang ?? null,
          name: musicInfo.name,
          singer: musicInfo.singer,
          artistKeys,
        }, getArtistLangTable()).bucket,
```

必须在这里算：`recent` 里的 `musicInfo` 早被丢掉了，`selectFinalQueue` 只能读 `FinalQueueItem.lang`（spec §3.2 执行点那条）。原 `artistKeys: getArtistKeys(musicInfo.singer)` 换成上面的局部变量，别重复调用两次。

import 补两行（放在既有 `./language.ts` / `./artistLanguageStore.ts` 那两行里合并即可）：

```ts
import { bucketFromLangField, bucketFromLyric, resolveLang } from './language.ts'
import { getArtistLangTable, loadArtistLangTable, observeArtistLangField, observeArtistLyric } from './artistLanguageStore.ts'
import { computeLangCaps, computeLangTargets, countLangUsed, countPoolLang } from './languageQuota.ts'
```

3. `generateQueue`（439 起）：把 `recent` 从 `selectFinalQueue` 的实参里提出来，先算语种再传。

```ts
    const recent = this.buildRecentSelectionItems()
    const langTargets = computeLangTargets(state.onboarding.weights, cfg.channels.windowSize)
    const langCaps = computeLangCaps(langTargets, countLangUsed(recent.map(item => item.lang), cfg.channels.windowSize))
    const selection = selectFinalQueue(finalItems, {
      target,
      recent,
      channelPlan: plan,
      rng: randomGenerator,
      temperature: health.safeMode ? cfg.softmax.safeModeTemperature : cfg.softmax.temperature,
      explorationGap,
      langCaps,
    })
```

4. 紧接 Step 6.3 之后（`selectFinalQueue` 调用之后、`recallLog('generate', ...)` 之前）加池内缺货线索，并在 `recallLog` 里带出——`langTargets` 是上一步才定义的，别插到 478 行的 `availability` 那段后面去。

```ts
    const poolLangCounts = countPoolLang(finalItems)
    // 池里对这个桶一首都没有，配额这轮注定兑现不了——和"被配额挡住"是两种问题，日志要分开
    const langUnmet = Object.keys(langTargets.targets)
      .filter(bucket => (poolLangCounts[bucket as LangBucket] ?? 0) === 0)
      .map(bucket => `lang_unmet:${bucket}`)
```

`recallLog` 的对象里加两项（放在 `reasons: selection.reasons,` 之后）：

```ts
      langCaps: langCaps.caps,
      langUnmet,
```

`countPoolLang(finalItems)` 能直接吃 `FinalQueueItem[]`——它的形参只要求 `{ lang?, langHint? }` 结构，`FinalQueueItem` 有 `lang`、无 `langHint`，结构化类型天然满足。**注意因此纯音乐与 unknown 也会计进去**，`lang_unmet` 只报已声明桶（`targets` 的键），不会误报。

`LangBucket` 类型若 `index.ts` 尚未 import，用 `import type { LangBucket } from './language.ts'` 补。

- [ ] **Step 7: 跑到通过**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-diversity-lang.mts`
Expected: 6 条全 PASS。

「用掉最后一个合法名额」这条要**先红后绿**：把它单独写完就跑一次，此时埋点还读扣完之后的额度，必须报 `legal consumption must not look like a bypass`；改成"先快照再扣额度"后才转绿。留 RED/GREEN 两段证据。

若「同语言连播」那条仍然失败，先确认 `recent` 传进来的两条 `zh` 有没有被 `slice(-60)` 保留、以及 `langGuard.langs` 初始化是否在 `history` 之后（同一份顺序）。

- [ ] **Step 8: 回归与静态闸门**

Run: `npm test`
Expected: `# fail 0`。**本工作树有另一条功能线在同时改 `tests/music-recognition-*.mts`，仓库总 pass 数在两次运行之间会漂，不要拿总数当闸门**；要卡数就逐文件跑：`recommend-diversity-lang.mts` 6、`recommend-language.mts` 11、`recommend-candidate-lang.mts` 9、`recommend-language-quota.mts` 14。既有 `recommend-algorithm.mts` 的候选都不带 `lang`（`undefined`），连播与 instr 规则对 `undefined` 一律放行，所以不该有旧断言被推翻。**若有**，说明那条测试构造了带 `lang` 的候选——先读断言再判断，不要直接改测试。

Run: `npx eslint src/core/recommend/diversity.ts src/core/recommend/candidatePool.ts src/core/recommend/index.ts`
Expected: 0 error。

Run: `npx tsc --noEmit 2>&1 | grep -E "recommend/(diversity|candidatePool|index|languageQuota)" || echo "no new errors"`
Expected: `no new errors`。特别留意 `getRelaxConfigs` 漏填 `langQuotaEnforced` 会在 tsc 报缺属性——那正是 Step 3 第 5 点想要的效果。

- [ ] **Step 9: 提交**

```bash
git add src/core/recommend/diversity.ts src/core/recommend/candidatePool.ts src/core/recommend/index.ts tests/recommend-diversity-lang.mts package.json
git commit -m "feat(recommend): 语种配额与同语言连播接到最终选曲，放开档留 lang_quota_relaxed 线索"
```

---

### Task 6: 供给侧——kg/tx 语种桶召回与加权分类轮换

Task 5 只会"卡"，不会"找"。用户只滑了"中文 10%"时，池里 90% 是华语歌单抓来的华语歌，配额每轮都得破例。本 Task 补上 spec §3.3 的**缺口驱动召回**：每轮刷新先算哪个语种桶在池里缺货，用实测到的 kg/tx 语种标签 id 抓该语种的歌单，并把桶作为 `langHint`（L2）打进候选。同时把步骤 3 的"分类等频轮转"换成按学习权重的 softmax 抽样——不修这条，召回会持续过量抓华语分类。

**语种标签 id（spec §2.3，2026-10-12 实测）**：

| 桶 | kg | tx |
| --- | --- | --- |
| `zh` 国语 | 84 | 1 |
| `yue` 粤语 | 19 | 146 |
| `en` 英语 | 20 | 3 |
| `ja` 日语 | 21 | 5 |
| `ko` 韩语 | 23 | 4 |
| `other` 小语种 | 24 | 6 |

id 会随源改版失效。防呆做法是**先跟该源的实时分类目录取交集**（`knownTagIds`），目录里没有就不规划，浪费一次请求都不会发生；真机表现是这轮没有 `lang_bucket:` 线索，此时重新抓一次该源语种分组即可。kw/wy/mg 本期不参与（没有逐曲语种，闭环不可信）。

**Files:**
- Modify: `src/core/recommend/tabSections.ts`（新增 `LANG_BUCKET_TAGS`、`planLangBucketFetch`、`pickWeightedTag`）
- Modify: `src/core/recommend/languageQuota.ts`（新增 `computeBucketDetailReserve`）
- Modify: `src/core/recommend/config.ts`（`candidatePool` 补 5 键、`antiRepeat` 补 1 键）
- Modify: `src/core/recommend/candidate.ts`（`CatalogRefreshParams.langTargets`、`SummaryWithHints.langHint`、`addSummary` 第 4 参、步骤 3 换加权轮换、新增步骤 4.5、步骤 5 详情位预留与 `langHint` 下传）
- Modify: `src/core/recommend/index.ts`（`refreshPoolWithSource` 传 `langTargets`）
- Test: `tests/recommend-lang-bucket-supply.mts`
- Modify: `package.json`（白名单追加）

**Interfaces:**
- Consumes：Task 4 的 `LangTargets` / `countPoolLang`；Task 1 的 `QUOTA_LANG_BUCKETS` / `LangBucket`；Task 3 的 `CreatePoolCandidateInput.langHint`。
- Produces：
  - `LANG_BUCKET_TAGS: Partial<Record<LX.OnlineSource, Partial<Record<LangBucket, string>>>`
  - `planLangBucketFetch(options: { source, targets, poolCounts, poolSize, windowSize, maxBuckets, knownTagIds? }): Array<{ bucket: LangBucket, tagId: string, deficit: number }>`
  - `pickWeightedTag(tags: readonly TagSummary[], themes: Record<string, ThemePreference>, options?: { rotation?: number, temperature?: number, now?: number, rng?: () => number }): TagSummary | null`
  - `computeBucketDetailReserve(options: { detailBudget: number, unknownShare: number, escalateAt: number, base: number, escalateTo: number }): number`
  - `CatalogRefreshParams.langTargets?: LangTargets`

- [ ] **Step 1: 补配置键**

Modify `src/core/recommend/config.ts`，`candidatePool` 段里 `maxSize` 之后加（按键名定位，段落的行号已经漂）：

```ts
    /** 每轮最多为几个缺货语种桶抓歌单列表（各 1 次发现请求）。 */
    bucketFetchesPerRefresh: 1,
    /** 每个缺货桶取前几张歌单当摘要：第一张读到空歌单时靠下一张替补。 */
    bucketPlaylistsPerBucket: 2,
    /** 详情额度里为语种桶召回预留几格（从常规摘要份额里让）。 */
    bucketDetailReserve: 1,
    /** 池内 unknown 占比过高时预留位加到几格。 */
    bucketDetailReserveWhenUnknownHigh: 2,
    /** 触发上面这条扩容的 unknown 占比阈值。 */
    unknownShareEscalate: 0.3,
```

`antiRepeat` 段里 `variantSoftFactor` 之后加（**按键名定位**，各段的行号从计划写下后已经漂了）：

```ts
    /** 分类轮换的 softmax 温度：越小越只顾高权重分类，越大越均匀。 */
    categoryRotationTemperature: 1.2,
```

3. `config.ts` 里 `language` 段的那句注释（当前 220 行：`语种配额相关的 capTolerance / maxConsecutive / bucketFetchesPerRefresh 等键由 Task 4、Task 6 各自补。`）是本 Task 该清掉的待办残迹：Task 4/6 都已落地，而且 `bucketFetchesPerRefresh` 落在 `candidatePool` 段而不是 `language` 段，留着这行会把人指向错的地方。按名定位后删掉这一句即可（段内其余注释不动）。

- [ ] **Step 2: 写失败测试**

Create `tests/recommend-lang-bucket-supply.mts`：

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { LANG_BUCKET_TAGS, planLangBucketFetch, pickWeightedTag } from '../src/core/recommend/tabSections.ts'
import { computeBucketDetailReserve, computeLangTargets, countPoolLang } from '../src/core/recommend/languageQuota.ts'
import type { ThemePreference } from '../src/core/recommend/types.ts'

const theme = (name: string, positiveWeight: number, negativeWeight = 0): [string, ThemePreference] => [
  name,
  { themeId: name, positiveWeight, negativeWeight, lastDecayTime: 1000, lastUsedTime: 1000 },
]

test('kg 与 tx 的语种桶标签 id 齐备，其余源不参与', () => {
  assert.deepEqual({ ...LANG_BUCKET_TAGS.kg }, { zh: '84', yue: '19', en: '20', ja: '21', ko: '23', other: '24' })
  assert.deepEqual({ ...LANG_BUCKET_TAGS.tx }, { zh: '1', yue: '146', en: '3', ja: '5', ko: '4', other: '6' })
  assert.equal(LANG_BUCKET_TAGS.kw, undefined)
  assert.equal(LANG_BUCKET_TAGS.wy, undefined)
  assert.equal(LANG_BUCKET_TAGS.mg, undefined)
})

test('按池内比例折算目标数，只规划真正缺货的桶并按缺口降序', () => {
  // 20 首窗口里 en 目标 5 首，池按 400/20=20 倍放大 → 期望 100 首，现只有 10
  const targets = computeLangTargets({ zh: 10, western: 25 })
  const plan = planLangBucketFetch({
    source: 'kg',
    targets,
    poolCounts: { zh: 300, en: 10 },
    poolSize: 400,
    windowSize: 20,
    maxBuckets: 2,
  })
  assert.deepEqual(plan.map(entry => entry.bucket), ['en'])
  assert.equal(plan[0].tagId, '20')
  assert.equal(plan[0].deficit, 90)
})

test('两个桶都缺货时只留缺口大的那个（maxBuckets=1）', () => {
  const plan = planLangBucketFetch({
    source: 'tx',
    targets: computeLangTargets({ zh: 10, western: 10, ja: 10 }),
    poolCounts: { zh: 10, en: 40, ja: 5 },
    poolSize: 200,
    windowSize: 20,
    maxBuckets: 1,
  })
  assert.equal(plan.length, 1)
  assert.equal(plan[0].bucket, 'ja')
  assert.equal(plan[0].tagId, '5')
})

test('问卷没滑语言 / 源没有语种标签 / 池已够货 时都不规划', () => {
  const empty = computeLangTargets({})
  assert.deepEqual(planLangBucketFetch({ source: 'kg', targets: empty, poolCounts: {}, poolSize: 400, windowSize: 20, maxBuckets: 1 }), [])
  assert.deepEqual(planLangBucketFetch({ source: 'kw', targets: computeLangTargets({ zh: 50 }), poolCounts: {}, poolSize: 400, windowSize: 20, maxBuckets: 1 }), [])
  assert.deepEqual(planLangBucketFetch({
    source: 'kg',
    targets: computeLangTargets({ zh: 10 }),
    poolCounts: { zh: 400 },
    poolSize: 400,
    windowSize: 20,
    maxBuckets: 1,
  }), [])
})

test('实时目录里没有该标签 id 时跳过，不发注定为空的请求', () => {
  const plan = planLangBucketFetch({
    source: 'kg',
    targets: computeLangTargets({ western: 40, zh: 40 }),
    poolCounts: {},
    poolSize: 200,
    windowSize: 20,
    maxBuckets: 2,
    knownTagIds: new Set(['84']),
  })
  assert.deepEqual(plan.map(entry => entry.bucket), ['zh'])
})

test('池内桶计数与配额共用同一套数：unknown 不冒充任何桶', () => {
  const counts = countPoolLang([{ lang: 'zh' }, { langHint: 'en' }, {}, { lang: 'unknown' }])
  assert.deepEqual(counts, { zh: 1, en: 1, unknown: 2 })
})

test('unknown 占比越高，桶召回抢走的详情位越多，但永远给常规摘要留至少一格', () => {
  assert.equal(computeBucketDetailReserve({ detailBudget: 4, unknownShare: 0.1, escalateAt: 0.3, base: 1, escalateTo: 2 }), 1)
  assert.equal(computeBucketDetailReserve({ detailBudget: 4, unknownShare: 0.5, escalateAt: 0.3, base: 1, escalateTo: 2 }), 2)
  assert.equal(computeBucketDetailReserve({ detailBudget: 1, unknownShare: 0.9, escalateAt: 0.3, base: 1, escalateTo: 2 }), 0)
})

test('加权分类轮换在高权重档里抽样，被学成负偏好的分类永不登场', () => {
  // 华语(6) 与 欧美(2) 都是正偏好。只给一个正偏好分类的话，"永远取最高分"的错实现
  // 也能全绿——rng 走到区间尾部必须落到次高的那个分类，抽样才算被测到。
  const tags = [{ id: '1', name: '华语' }, { id: '2', name: '欧美' }, { id: '3', name: '飙升' }]
  const themes = Object.fromEntries([theme('华语', 6), theme('欧美', 2), theme('飙升', -3)])
  assert.equal(pickWeightedTag(tags, themes, { now: 1000, temperature: 1, rng: () => 0 })?.id, '1')
  assert.equal(pickWeightedTag(tags, themes, { now: 1000, temperature: 1, rng: () => 0.5 })?.id, '1')
  assert.equal(pickWeightedTag(tags, themes, { now: 1000, temperature: 1, rng: () => 0.99 })?.id, '2')
  // 负偏好分类放在目录首位也不能登场（旧写法靠 rotation % 4 让它定期出场）
  const burnedFirst = [{ id: '3', name: '飙升' }, { id: '1', name: '华语' }, { id: '2', name: '欧美' }]
  for (const roll of [0, 0.5, 0.99]) {
    assert.notEqual(pickWeightedTag(burnedFirst, themes, { now: 1000, temperature: 1, rng: () => roll })?.id, '3')
  }
  // 重度用户的净权是累加量、没有上界。不减最大净权直接 exp(900) 会溢出成 Infinity，
  // 减法全变 NaN、永远走不到 roll <= 0，最后静默返回权重最低的那个分类——正好是该压下去的那个。
  const heavy = Object.fromEntries([theme('华语', 900), theme('欧美', 2), theme('飙升', -3)])
  for (const roll of [0, 0.5, 0.99]) {
    const picked = pickWeightedTag(tags, heavy, { now: 1000, temperature: 1, rng: () => roll })
    assert.ok(picked, '溢出防护失效时这里会拿到 undefined')
    assert.equal(picked?.id, '1', `roll ${roll} 应落在高权重分类，实拿 ${picked?.id}`)
  }
})

test('没有正偏好分类时退回按轮次游走，冷启动不空转', () => {
  const tags = [{ id: '1', name: '华语' }, { id: '2', name: '欧美' }, { id: '3', name: '飙升' }]
  assert.equal(pickWeightedTag(tags, {}, { rotation: 0 })?.id, '1')
  assert.equal(pickWeightedTag(tags, {}, { rotation: 1 })?.id, '2')
  assert.equal(pickWeightedTag(tags, {}, { rotation: 4 })?.id, '2')
  assert.equal(pickWeightedTag([], {}, { rotation: 0 }), null)
})
```

- [ ] **Step 3: 跑到失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-lang-bucket-supply.mts`
Expected: `SyntaxError`/`ERR_MODULE_NOT_FOUND` 之外的形态是"命名导出不存在"（`LANG_BUCKET_TAGS` 等）。`tabSections.ts` 与 `languageQuota.ts` 都是纯模块，可被 strip-types 载入。

- [ ] **Step 4: 实现纯函数**

1. Modify `src/core/recommend/tabSections.ts`，顶部补 import：

```ts
import { QUOTA_LANG_BUCKETS } from './language.ts'
import type { LangBucket } from './language.ts'
import type { LangTargets } from './languageQuota.ts'
```

2. 文件末尾（`pickPlaylistSort` 之后）追加：

```ts
/**
 * 语种桶 → 该源分类目录里的标签 id。只登记有逐曲语种字段（L1）的两个源，
 * 桶召回抓回来的歌每首都带真语种，闭环才可信。
 */
export const LANG_BUCKET_TAGS: Partial<Record<LX.OnlineSource, Partial<Record<LangBucket, string>>>> = {
  kg: { zh: '84', yue: '19', en: '20', ja: '21', ko: '23', other: '24' },
  tx: { zh: '1', yue: '146', en: '3', ja: '5', ko: '4', other: '6' },
}

/**
 * 缺口驱动召回的规划：把"20 首窗口里的目标首数"按池规模等比放大成池内应有候选数，
 * 再跟池内实际计数相减，只留真正缺货的桶、按缺口降序取前几个。
 * knownTagIds 传该源实时分类目录时，不在目录里的标签 id 直接跳过（源改版后不浪费请求）。
 */
export const planLangBucketFetch = (options: {
  source: LX.OnlineSource
  targets: LangTargets
  poolCounts: Partial<Record<LangBucket, number>>
  poolSize: number
  windowSize: number
  maxBuckets: number
  knownTagIds?: ReadonlySet<string>
}): Array<{ bucket: LangBucket, tagId: string, deficit: number }> => {
  if (!options.targets.enforced) return []
  const tagIds = LANG_BUCKET_TAGS[options.source]
  if (!tagIds) return []
  const window = Math.max(1, Math.floor(options.windowSize))
  const scale = Math.max(1, Math.floor(options.poolSize)) / window
  const planned: Array<{ bucket: LangBucket, tagId: string, deficit: number }> = []
  for (const bucket of QUOTA_LANG_BUCKETS) {
    const target = options.targets.targets[bucket]
    const tagId = tagIds[bucket]
    if (target === undefined || !tagId) continue
    if (options.knownTagIds && !options.knownTagIds.has(tagId)) continue
    const deficit = Math.ceil(target * scale) - (options.poolCounts[bucket] ?? 0)
    if (deficit > 0) planned.push({ bucket, tagId, deficit })
  }
  planned.sort((a, b) => b.deficit - a.deficit)
  return planned.slice(0, Math.max(0, Math.floor(options.maxBuckets)))
}

/**
 * 分类轮换的加权抽样：概率正比于 exp(分类净权 / 温度)，取代旧的"每 4 轮留 1 轮全目录游走"等频轮转。
 * 等频轮转会让华语这类高权重分类只占 1/N 的出场机会，是召回侧过量抓华语的根因之一。
 * 没有任何正偏好分类时（冷启动）退回按轮次游走，保证不空转。
 * 注意是有意的取舍：一旦学到了正偏好分类，净权为 0（没被学过）的分类就不在这条轮子里出现了，
 * 旧写法的"1/4 轮全目录探索"没有保留。分类维度的多样性现在由两处提供——语种桶召回（candidate.ts 步骤 4.5）
 * 按缺口补货，推荐 tab 的歌单区块（pickPlaylistTag）仍守 1/4 探索轮。别把它当 bug 改回去。
 */
export const pickWeightedTag = (
  tags: readonly TagSummary[],
  themes: Record<string, ThemePreference>,
  options: { rotation?: number, temperature?: number, now?: number, rng?: () => number } = {},
): TagSummary | null => {
  if (!tags.length) return null
  const now = options.now ?? Date.now()
  const temperature = Math.max(0.0001, options.temperature ?? 1)
  const preferred = tags
    .map(tag => ({ tag, net: themeNetWeight(themes, normalizeText(tag.name), now) }))
    .filter(entry => entry.net > 0)
    .sort((a, b) => b.net - a.net)
  if (!preferred.length) return tags[Math.abs(Math.floor(options.rotation ?? 0)) % tags.length]
  // 必须减去最大净权再取 exp：`themeNetWeight` 是累加量、没有上界，直接 exp(net/温度) 在重度用户的
  // 画像上会溢出成 Infinity，减法全变 NaN、永远走不到 `roll <= 0`，最后静默返回权重最低的分类。
  // 这与 diversity.ts 的 softmaxSample 同一写法，但这里不 import 它——tabSections 不该依赖选曲器。
  const maxNet = preferred[0].net
  const weights = preferred.map(entry => Math.exp((entry.net - maxNet) / temperature))
  const rng = options.rng ?? Math.random
  let roll = rng() * weights.reduce((acc, weight) => acc + weight, 0)
  for (let i = 0; i < preferred.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return preferred[i].tag
  }
  return preferred[preferred.length - 1].tag
}
```

3. Modify `src/core/recommend/languageQuota.ts`，末尾追加：

```ts
/**
 * 桶召回该占几格详情额度：unknown 占比过高时多给一格，但永远给常规摘要留至少一格，
 * 否则语种补齐会把画像通道（A/B）饿死。
 */
export const computeBucketDetailReserve = (options: {
  detailBudget: number
  unknownShare: number
  escalateAt: number
  base: number
  escalateTo: number
}): number => {
  const want = options.unknownShare > options.escalateAt ? options.escalateTo : options.base
  return Math.max(0, Math.min(want, Math.max(0, Math.floor(options.detailBudget) - 1)))
}
```

- [ ] **Step 5: 跑到通过**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-lang-bucket-supply.mts`
Expected: 9 条全 PASS。

- [ ] **Step 6: candidate.ts 接线**

1. `CatalogRefreshParams`（20-39）在 `rotation?: number` 之后加：

```ts
  /** 语种硬配额的目标数（由引擎按问卷算好传入）；本模块据此决定要不要补哪个语种的货。 */
  langTargets?: LangTargets
```

顶部补 import：

```ts
import { computeBucketDetailReserve, countPoolLang } from './languageQuota.ts'
import type { LangTargets } from './languageQuota.ts'
import type { LangBucket } from './language.ts'
import { pickWeightedTag, planLangBucketFetch } from './tabSections.ts'
```

2. `SummaryWithHints`（181-192）在 `keyword?: string` 之后加 `langHint?: LangBucket`。

3. `addSummary`（220-243）加第 4 参、落到摘要上，并**返回**登记到的摘要（4.5 步要靠它把桶摘要收进列表；其余调用点仍当语句用，忽略返回值即可）：

```ts
  const addSummary = (summary: { id: string, source: LX.OnlineSource, name?: string, author?: string, desc?: string, playCount?: string | number | null, total?: string | number | null, category?: string }, hints: ChannelId[], keyword?: string, langHint?: LangBucket): SummaryWithHints | null => {
    if (!summary.id) return null
    const normalizedId = String(summary.id)
    const key = normalizePlaylistKey(source, normalizedId)
    const existing = summaries.find(item => normalizePlaylistKey(item.source, item.id) == key)
    if (existing) {
      for (const hint of hints) existing.hints.add(hint)
      // 同一张歌单也可能被别的步骤先登记过：语种提示只在缺席时补，不让后续批次覆盖
      if (langHint && !existing.langHint) existing.langHint = langHint
      return existing
    }
    if (summaryKeys.has(key)) return null
```

`summaries.push({...})` 的对象里加 `langHint,`，并在 push 之后 `return summaries[summaries.length - 1]`。

4. 步骤 3（289-326）把等频轮转换成加权抽样，并把目录留给 4.5 用。`const tag = preferredTags.length && rotation % 4 != 3 ? ... : ...`（301-303 那三行）整段替换为：

```ts
        const tag = pickWeightedTag(tags, params.state.themeWeights, {
          rotation,
          temperature: recommendationConfig.antiRepeat.categoryRotationTemperature,
          now,
        })
```

`preferredTags`（296-299）与 `tagNet`（295）此后只被 `tagNetWeight(tag.name)` 用到，`tagNet` 保留、`preferredTags` 删掉。

`tag` 现在可能是 `null`（目录为空时 `pickWeightedTag` 返回 `null`），所以取列表的那一段要包进 `if (tag) { ... }`——`tagNetWeight`、`sortId`、`page`、`getPlaylistsByTag` 和它下面的 `for (const summary of playlists)` 全部留在 `if (tag)` 里，不要只挡一半（`tag.id` 在 null 上取值会整轮抛 TypeError，被外层 catch 吞成一条 `playlist_list_failed`，看起来像网络问题）。

同时把目录留给步骤 4.5 做标签 id 有效性校验：`let catalogTags: TagSummary[] = []` 声明在 **`if (caps.canTags && caps.canList) {` 这一行之前**（当前 290 行之前，也就是函数体内、`if` 之外——声明在 `if` 里面 4.5 就看不见它了），步骤 3 里拿到 `tags` 之后立刻 `catalogTags = tags`（放在 `if (tags.length)` 内侧第一行即可）。`TagSummary` 类型从 `./sdkCatalog.ts` import（该文件已经从这个模块 import 了别的函数，类型单独 `import type` 一行）。

4b. 步骤 3 里选排序档的那五行（`newSort` / `hotSort` / `wantNew` / `useNew` / `sortId`，当前 306-311）抽成 `candidate.ts` 模块级助手，放在 `refreshExternalCandidates` 之前——4.5 要用同一套口径，逐字复制两遍的话将来改一处就会让桶召回的列表悄悄错通道（`useNew` 决定摘要登记成 C 还是 D）：

```ts
/**
 * 分类/语种桶两条列表召回共用的排序档：最新:最热守 newestListRatio，
 * 源没有"最新"档时降级到最热，并如实报 useNew=false（让调用方把摘要归到 D 而不是冒充 C）。
 */
const pickListSort = (sorts: readonly SortSummary[], rotation: number): { sortId: string, useNew: boolean } => {
  const newSort = sorts.find(sort => /最新|新歌|new/i.test(`${sort.name} ${sort.tid ?? ''}`))
  const useNew = rotation % 10 < Math.round(recommendationConfig.candidatePool.newestListRatio * 10) && newSort != null
  return { sortId: (useNew ? newSort : pickPlaylistSort(sorts))?.id ?? '', useNew }
}
```

`SortSummary` 类型与 `pickPlaylistSort` 都从 `./tabSections.ts` import（后者本来就在找"最热"档，别在助手里再写一遍那个正则）。步骤 3 调用处换成 `const { sortId, useNew } = pickListSort(caps.sorts, rotation)`，其余（`page`、`hints`、`category` 那几行）不动。

5. 在步骤 4（榜单，328-346）之后、步骤 5 之前插入 **4.5 语种桶缺口召回**：

```ts
  // 4.5 语种桶缺口召回：配额能不能兑现取决于池里有没有货，所以先按缺口补货再读详情。
  const bucketSummaries: SummaryWithHints[] = []
  let unknownShare = 0
  if (params.langTargets?.enforced) {
    const poolCandidates = params.state.candidateCache
    const poolCounts = countPoolLang(poolCandidates)
    // 缺口折算要垫到 targetSize（池还小时也得按满池的目标推），
    // 但 unknown 占比必须用真实长度：分母垫到 500 会让 spec §3.3 的"unknown > 30% 优先补货"
    // 在冷启动阶段永远够不着阈值，而那正是 unknown 最浓、最需要 L1 补货的时候。
    const poolSize = Math.max(poolCandidates.length, recommendationConfig.candidatePool.targetSize)
    unknownShare = poolCandidates.length ? (poolCounts.unknown ?? 0) / poolCandidates.length : 0
    // catalogTags 为空时（目录请求本身失败/预算耗尽）这里传 undefined，knownTagIds 闸门是
    // **失败即放行**：宁可发一次可能为空的请求，也不因为读不到目录就整轮不补货。
    const plan = planLangBucketFetch({
      source,
      targets: params.langTargets,
      poolCounts,
      poolSize,
      windowSize: recommendationConfig.channels.windowSize,
      maxBuckets: recommendationConfig.candidatePool.bucketFetchesPerRefresh,
      knownTagIds: catalogTags.length ? new Set(catalogTags.map(tag => String(tag.id))) : undefined,
    })
    for (const entry of plan) {
      if (params.signal?.cancelled) break
      try {
        ensureDiscoveryBudget()
        const { sortId, useNew } = pickListSort(caps.sorts, rotation)
        // 分类归属要用目录里的真名：summary.category 缺失时若写 `lang:en` 这种合成串，
        // 它会经 observedPlaylists.category 进到 behavior.ts 的点赞学习里，
        // 而这个键永远匹配不到任何目录分类名——等于把这次学习信号扔进一个死键。
        const bucketTagName = catalogTags.find(tag => String(tag.id) == entry.tagId)?.name
        const playlists = await getPlaylistsByTag(source, entry.tagId, sortId, 1 + (rotation % 3), { signal: params.signal })
        let added = 0
        for (const summary of playlists) {
          if (added >= recommendationConfig.candidatePool.bucketPlaylistsPerBucket) break
          const registered = addSummary({ ...summary, category: summary.category ?? bucketTagName ?? `lang:${entry.bucket}` }, [useNew ? 'C' : 'D'], undefined, entry.bucket)
          // 只有真的带上本桶语种提示才算数：被别的步骤先登记成无提示摘要时不重复排队
          if (registered?.langHint == entry.bucket && !bucketSummaries.includes(registered)) {
            bucketSummaries.push(registered)
            added += 1
          }
        }
        reasons.push(`lang_bucket:${entry.bucket}:${entry.tagId}:lists=${added}`)
        if (!added) reasons.push(`lang_bucket_empty:${entry.bucket}`)
      } catch (error) {
        reasons.push(`lang_bucket_failed:${entry.bucket}`)
        if ((error as Error).message == 'request_cancelled' || (error as Error).message == 'request_budget_exhausted') break
      }
    }
  }
```

4.5 这里的 `lang_bucket_empty` 含义是"该标签下一页都没给出可用歌单摘要"（标签 id 失效时会稳定命中这条）。真正的"歌单能列出但详情是空"要到步骤 5 读详情才知道，用 `lang_playlist_empty:<歌单 id>` 记录（评审后改名：原来两处共用 `lang_bucket_empty` 前缀、只靠载荷类型区分，读日志的人得先知道 tx 的歌单 id 是数字才分得开）。

6. 步骤 5 的详情编排把预留位算进去：替换范围是 `const detailBudget = ...` 到 `orderedSummaries` 的收尾 `]`（当前 352-358），**上面三行别一起删**——`const playlistCandidates`、`let detailFetches = 0` 和"给 C 通道预留一个详情位"那条注释仍在用（注释可以按下面的新口径补一句"语种桶也要让位"）。

```ts
  const detailBudget = recommendationConfig.candidatePool.detailFetchesPerRefresh
  // 只预留真要用的格子：没召回到桶摘要时（问卷没滑语言的整轮、池里不缺货的整轮都算）预留必须是 0。
  // 详情读是这个候选池唯一的进货口，白扣一格等于给**全体用户**（含没开配额的）砍掉 25% 吞吐，
  // 而且桶只召回到 1 张时也要把没用完的格子还给常规摘要。
  const bucketReserve = bucketSummaries.length
    ? Math.min(bucketSummaries.length, computeBucketDetailReserve({
      detailBudget,
      unknownShare,
      escalateAt: recommendationConfig.candidatePool.unknownShareEscalate,
      base: recommendationConfig.candidatePool.bucketDetailReserve,
      escalateTo: recommendationConfig.candidatePool.bucketDetailReserveWhenUnknownHigh,
    }))
    : 0
  const cSummaries = summaries.filter(summary => summary.hints.has('C') && !summary.langHint)
  const mainSummaries = summaries.filter(summary => !summary.hints.has('C') && !summary.langHint)
  const bucketPicks: SummaryWithHints[] = []
  if (bucketReserve > 0) {
    // 从轮换位起连续取，第一轮落空的那张会在下一轮被取到——这就是"空歌单换下一张"的实现方式
    const start = Math.abs(rotation) % bucketSummaries.length
    for (let i = 0; i < bucketReserve; i++) bucketPicks.push(bucketSummaries[(start + i) % bucketSummaries.length])
  }
  const regularPicks = [
    ...mainSummaries.slice(0, Math.max(1, detailBudget - (cSummaries.length ? 1 : 0) - bucketReserve)),
    ...(cSummaries.length ? [cSummaries[Math.abs(rotation) % cSummaries.length]] : []),
  ]
  // spec §3.3："池内 unknown 占比超过 30% 时，本轮预算优先给 kg/tx 的桶召回"。
  // 优先级要体现在**读取顺序**上：详情循环是按 orderedSummaries 顺序走到预算上限就 break 的，
  // 桶摘要排在最后时总预算一紧就先被牺牲掉的正是刚补进来的那几格，与"优先"相反。
  const orderedSummaries = bucketPicks.length && unknownShare > recommendationConfig.candidatePool.unknownShareEscalate
    ? [...bucketPicks, ...regularPicks]
    : [...regularPicks, ...bucketPicks]
```

`mainSummaries`/`cSummaries` 的过滤都加 `&& !summary.langHint`，否则桶摘要会同时被当成常规摘要排进队列、把预留位重复占掉。

7. 步骤 5 详情循环里，读完 `uniqueTracks` 之后（390 行附近）加空歌单线索：

```ts
      if (!uniqueTracks.length && summary.langHint) reasons.push(`lang_playlist_empty:${summary.id}`)
```

8. 创建候选时把桶提示带下去（435 行）：

```ts
      const created = createPlaylistCandidates(observed, uniqueTracks, params, primaryChannel, summary.langHint)
```

`createPlaylistCandidates`（72-119）签名加第 5 参 `langHint?: LangBucket`，内部 `createPoolCandidate({...})` 的输入对象里加 `langHint,`（放在 `reason: reasons.join(','),` 之后）。这是**唯一**一个调用点（`grep -n "createPlaylistCandidates(" src/core/recommend/candidate.ts` 只有 435 行那一处）——歌手直采和榜单路径是直接走 `createPoolCandidate` 建候选的，本 Task 不给它们加语种提示，第 5 参留空即可。

`candidatePool.ts` 那边**不要**动：它已经用条件展开写这个键（当前 `:77` 的 `...(input.langHint ? { langHint: input.langHint } : {})`），正好满足 Task 3 定的"没值就不留键"不变式（R17）。在这里改成直接赋值会退回 `langHint: undefined` 那种"有键但为空"的形态，把后面的读时推导判死。

- [ ] **Step 7: 引擎传入 langTargets**

Modify `src/core/recommend/index.ts` 的 `refreshPoolWithSource`（276-292 的 params 构造）里，`rotation: ...` 之前加：

```ts
        langTargets: computeLangTargets(state.onboarding.weights, cfg.channels.windowSize),
```

`computeLangTargets` 已在 Task 5 的 import 里。

- [ ] **Step 8: 闸门**

Run: `npm test`
Expected: `# fail 0`。分类轮换换成 softmax 只改了 `candidate.ts` 步骤 3 内部，而那条路径没有单测（`candidate.ts` import 了 `@/plugins/storage`，strip-types 载不动）；`tests/recommend-algorithm.mts:1873-1882` 钉的是 `pickPlaylistTag`——本 Task **不改**那个函数，所以这几条必须保持绿的。它们红了说明实现动了不该动的地方（比如把 `pickPlaylistTag` 就地换成了 `pickWeightedTag`，或删了它的等频分支），照红线回查，不要"顺手"把断言改成新的期望值。

各测试文件按**条数**核（R23：仓内还有别的线在动测试，仓级总数不可比）：`recommend-lang-bucket-supply.mts` **9 条**、`recommend-language.mts` 11、`recommend-candidate-lang.mts` 9、`recommend-language-quota.mts` 14、`recommend-diversity-lang.mts` 6。

Run: `npx eslint src/core/recommend/tabSections.ts src/core/recommend/languageQuota.ts src/core/recommend/candidate.ts src/core/recommend/config.ts src/core/recommend/index.ts`
Expected: 0 error。注意 `npx eslint` 只列源码路径——`tests/*.mts` 不在本仓 lint 面上（R22/R18），测试文件只要 tsc 干净。

Run: `npx tsc --noEmit 2>&1 | grep -E "recommend/(tabSections|languageQuota|candidate|index|config)" || echo "no new errors"`
Expected: `no new errors`。同时确认 `npx tsc --noEmit 2>&1 | grep -c "error TS"` 仍是 **137**（基线，R22）。

Run: `npm run build-test && grep -c "lang_bucket:" index.android.bundle`
Expected: ≥1。为 0 说明 4.5 那段没进包（多半是 `if (params.langTargets?.enforced)` 之外的代码被误删）。

- [ ] **Step 9: 提交**

```bash
git add src/core/recommend/tabSections.ts src/core/recommend/languageQuota.ts src/core/recommend/candidate.ts src/core/recommend/config.ts src/core/recommend/index.ts tests/recommend-lang-bucket-supply.mts package.json
git commit -m "feat(recommend): 按语种桶缺口补货，分类轮换改成按学习权重抽样"
```

只 add 上面这些路径，**绝不** `git add -A`/`git add .`/`git commit -a`（工作区有 200 多个别的线的未提交路径）。`tests/recommend-algorithm.mts` 正常情况下本 Task 不会改它；万一改了，先回查是不是误动了 `pickPlaylistTag`。

- [ ] **Step 10: 改掉被本 Task 说成谎话的注释**

`tabSections.ts` 里 `pickPlaylistTag` 的注释（当前 211-216 行）第一句写着"**与电台候选发现同一条配方**"。Step 4 把电台侧（`candidate.ts` 步骤 3）换成 `pickWeightedTag` 之后这句就不成立了——两处从此是两套轮换：电台侧按学习权重抽样（配额要供给侧配合），推荐 tab 的歌单区块仍走等频轮换（浏览位，要的是"别困在官方组首位"）。注释按下面改掉，别让下一个人以为改一处就等于改两处：

```ts
/**
 * 推荐歌单（tab 歌单区块）的分类挑选：4 轮里 3 轮在学习到正偏好的分类里轮换，
 * 1 轮放开到全目录轮换探索——语种/场景/心情等普通分组由此轮流登场，
 * 分类不再困在目录首位（官方组）里。冷启动没有正偏好分类时全程在全目录里按轮次游走。
 *
 * 注意：电台候选发现（candidate.ts 步骤 3）走的不是这条配方，它用 pickWeightedTag
 * 按学习权重抽样——那里要给语种硬配额补货，浏览位的等频轮转会过量抓华语分类。
 */
```

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-algorithm.mts`
Expected: 全绿（本 Step 只改注释，不改任何被测行为；跑一次只为确认没手滑删掉函数体）。这条不产生新的待 add 路径——`tabSections.ts` 已经在 Step 9 的清单里。

---

### Task 7: 读时推导与淘汰看桶——老候选不再装死

Task 3 之前入池的候选没有 `lang` 键，Task 5 的配额对它们一律"放行"（`undefined` 等同 `unknown`），淘汰也看不见语种——结果是新规则只管新货，池子照旧偏华语。本 Task 补三件事（spec §3.4）：

1. **读时推导**：用的时候现推（L1→L2→L3→L4），**不往候选池数据里写**，因此也就不可能写回磁盘缓存键（`xunyin_recommend_candidates_v2` 没有版本戳、整体 JSON 重写，一次误写就会把整池重排）。
2. **淘汰看桶**：`capPoolSize` 按池规模等比放大后的桶限额淘汰，超配桶先出局，名额没吃满时用它们补位，池子恒满 `maxSize`。
3. **诊断**：`poolStats` 出 `byLang`，召回日志带 L1/L2/L3/L4 命中级别占比——验收时要能回答"配额没兑现是判不出还是没货"。

**Files:**
- Modify: `src/core/recommend/candidatePool.ts`（`resolvePoolLang` 新增、`PoolCapOptions` 新增、`capPoolSize` 133-145、`mergePoolCandidates` 85-131（限额透传）、`FinalQueueBuildOptions` 164-186、`buildFinalQueueItems` 285-313（`lang: candidate.lang` 在 :302）、`poolStats` 315-325）
- Modify: `src/core/recommend/diversity.ts`（`FinalQueueItem.langLevel`，`lang` 在 :40）
- Modify: `src/core/recommend/languageQuota.ts`（`computePoolBucketLimits` 新增）
- Modify: `src/core/recommend/config.ts`（`candidatePool` 补 1 键，接在 `artistHitsPerRefresh` 之后）
- Modify: `src/core/recommend/candidate.ts`（`CatalogRefreshParams.artistLangTable`、4.5 的池内计数改用推导）
- Modify: `src/core/recommend/index.ts`（合并时按限额淘汰、`buildFinalQueueItems` 附表、recallLog 补级别占比）
- Test: `tests/recommend-pool-lang.mts`
- Modify: `package.json`（白名单追加）

**Interfaces:**
- Consumes：Task 1 `resolveLang` / `ArtistLangTable`；Task 3 `PoolCandidate.lang` / `langHint`；Task 4 `LangTargets`。
- Produces：
  - `resolvePoolLang(candidate: PoolLangBearing, table?: ArtistLangTable): { bucket: LangBucket, level: 0 | 1 | 2 | 3 | 4 }`
  - `PoolCapOptions = { limits?: Partial<Record<LangBucket, number>>, resolveBucket?: (candidate: PoolCandidate) => LangBucket }`
  - `capPoolSize(candidates: readonly PoolCandidate[], maxSize?, options?: PoolCapOptions): PoolCandidate[]`
  - `mergePoolCandidates(existing: readonly PoolCandidate[], incoming: readonly PoolCandidate[], maxSize?, capOptions?: PoolCapOptions): PoolCandidate[]` —— **第 4 参必须存在**：限额只有在"合并后的集合超过 `maxSize`、正在裁剪"时才可能生效；对已经 `≤ maxSize` 的池子单独再调一次 `capPoolSize` 会被 `length <= maxSize` 早退直接放过（见 Step 6.3 的说明）。
  - `computePoolBucketLimits(options: { targets: LangTargets, maxSize: number, windowSize: number, slack: number }): Partial<Record<LangBucket, number>>`
  - `FinalQueueBuildOptions.artistLangTable?: ArtistLangTable`
  - `FinalQueueItem.langLevel?: 0 | 1 | 2 | 3 | 4`
  - `CatalogRefreshParams.artistLangTable?: ArtistLangTable`

- [ ] **Step 1: 补配置键**

Modify `src/core/recommend/config.ts`，`candidatePool` 段里 Task 6 新加的键之后：

```ts
    /** 淘汰限额相对"窗口目标数按池规模等比放大"再乘的宽松系数：越小越狠。 */
    poolEvictOverQuotaSlack: 1.5,
```

- [ ] **Step 2: 写失败测试**

Create `tests/recommend-pool-lang.mts`：

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildFinalQueueItems, capPoolSize, poolStats, resolvePoolLang } from '../src/core/recommend/candidatePool.ts'
import { createPoolCandidate } from '../src/core/recommend/candidatePool.ts'
import { computeLangTargets, computePoolBucketLimits } from '../src/core/recommend/languageQuota.ts'
import type { ArtistLangTable } from '../src/core/recommend/language.ts'

const entryOf = (over: Record<string, any> = {}) => ({
  musicInfo: {
    id: `kg_${over.songmid ?? 'x'}`,
    name: over.name ?? '喜欢你',
    singer: over.singer ?? '邓紫棋',
    source: over.source ?? 'kg',
    interval: '03:55',
    meta: { songId: over.songmid ?? 'x', albumName: '新的心跳', lang: over.lang ?? null },
  },
})

// now 钉死：capPoolSize 的同分排序靠 addedAt 打破平局，不钉就会随 Date.now() 是否跳毫秒改变扫描顺序
const baseInput = (musicInfo: any) => ({ musicInfo, channel: 'A' as const, sourceId: 'pl-1', now: 1 })

test('resolvePoolLang：已存的 L1 事实优先，其次接口字段、批次提示、歌手表、字面统计', () => {
  const table: ArtistLangTable = { 陈奕迅: { bucket: 'yue', hits: 3, updatedAt: 1 } }
  assert.deepEqual(resolvePoolLang({ lang: 'en', musicInfo: entryOf().musicInfo as any }, table), { bucket: 'en', level: 1 })
  assert.deepEqual(resolvePoolLang({ musicInfo: entryOf({ lang: '粤语' }).musicInfo as any }, table), { bucket: 'yue', level: 1 })
  assert.deepEqual(resolvePoolLang({ langHint: 'ja', musicInfo: entryOf({ singer: '新人' }).musicInfo as any }, table), { bucket: 'ja', level: 2 })
  assert.deepEqual(resolvePoolLang({ artistKeys: ['陈奕迅'], musicInfo: entryOf({ singer: '陈奕迅', name: '富士山下' }).musicInfo as any }, table), { bucket: 'yue', level: 3 })
  assert.deepEqual(resolvePoolLang({ musicInfo: entryOf({ singer: '陌生人', name: '第一封情书' }).musicInfo as any }), { bucket: 'zh', level: 4 })
  assert.deepEqual(resolvePoolLang({ musicInfo: entryOf({ singer: 'New Act', name: 'Yesterday' }).musicInfo as any }), { bucket: 'unknown', level: 0 })
})

test('池桶限额按池规模等比放大并留宽松系数', () => {
  const limits = computePoolBucketLimits({
    targets: computeLangTargets({ zh: 10 }),
    maxSize: 1500,
    windowSize: 20,
    slack: 1.5,
  })
  assert.deepEqual(limits, { zh: 225 })
  assert.deepEqual(computePoolBucketLimits({ targets: computeLangTargets({}), maxSize: 1500, windowSize: 20, slack: 1.5 }), {})
})

test('capPoolSize 无限额时行为与今天完全一致', () => {
  const candidates = Array.from({ length: 12 }, (_, i) =>
    createPoolCandidate(baseInput(entryOf({ songmid: `a${i}`, lang: '粤语' }).musicInfo as any)))
  const capped = capPoolSize(candidates, 10)
  assert.equal(capped.length, 10)
})

test('capPoolSize 按桶限额淘汰：超配桶先出局，缺口由它补位且池子照样凑满', () => {
  const candidates = [
    ...Array.from({ length: 8 }, (_, i) => createPoolCandidate(baseInput(entryOf({ songmid: `z${i}`, lang: '粤语' }).musicInfo as any))),
    ...Array.from({ length: 8 }, (_, i) => createPoolCandidate(baseInput(entryOf({ songmid: `e${i}`, source: 'tx', lang: 5 }).musicInfo as any))),
  ]
  const capped = capPoolSize(candidates, 10, { limits: { yue: 3 } })
  assert.equal(capped.length, 10)
  assert.equal(capped.filter(candidate => candidate.lang == 'yue').length, 3)
  assert.equal(capped.filter(candidate => candidate.lang == 'en').length, 7)
})

test('capPoolSize 的桶由调用方注入，可按读时推导结果判定老候选', () => {
  const candidates = [
    ...Array.from({ length: 6 }, (_, i) => createPoolCandidate(baseInput(entryOf({ songmid: `n${i}`, singer: '陈奕迅', name: '十年' }).musicInfo as any))),
    // 第二组必须是片假名/平假名占多数：像"僕の色"这种汉字多的日文歌名，L4 会按汉字占比判成 zh
    ...Array.from({ length: 6 }, (_, i) => createPoolCandidate(baseInput(entryOf({ songmid: `j${i}`, singer: '山下達郎', name: 'さよならの夏' }).musicInfo as any))),
  ]
  const table: ArtistLangTable = { 陈奕迅: { bucket: 'zh', hits: 4, updatedAt: 1 } }
  const capped = capPoolSize(candidates, 6, {
    limits: { zh: 2 },
    resolveBucket: candidate => resolvePoolLang(candidate, table).bucket,
  })
  assert.equal(capped.length, 6)
  assert.equal(capped.filter(candidate => resolvePoolLang(candidate, table).bucket == 'zh').length, 2)
})

test('buildFinalQueueItems 用读时推导填 lang，并带出命中级别', () => {
  const table: ArtistLangTable = { 陈奕迅: { bucket: 'yue', hits: 3, updatedAt: 1 } }
  const candidates = [
    createPoolCandidate(baseInput(entryOf({ songmid: 'l1', lang: '英语' }).musicInfo as any)),
    createPoolCandidate(baseInput(entryOf({ songmid: 'l3', singer: '陈奕迅', name: '好久不见' }).musicInfo as any)),
    createPoolCandidate(baseInput(entryOf({ songmid: 'l4', singer: '陌生人', name: '第一封情书' }).musicInfo as any)),
  ]
  const items = buildFinalQueueItems(candidates, { artistLangTable: table })
  assert.deepEqual(items.map(item => item.lang), ['en', 'yue', 'zh'])
  assert.deepEqual(items.map(item => item.langLevel), [1, 3, 4])
})

test('poolStats 报出池内语种分布', () => {
  const candidates = [
    createPoolCandidate(baseInput(entryOf({ songmid: 'p1', lang: '粤语' }).musicInfo as any)),
    createPoolCandidate(baseInput(entryOf({ songmid: 'p2', lang: '粤语' }).musicInfo as any)),
    createPoolCandidate(baseInput(entryOf({ songmid: 'p3', singer: 'New Act', name: 'Yesterday' }).musicInfo as any)),
  ]
  const stats = poolStats(candidates)
  assert.equal(stats.total, 3)
  assert.deepEqual(stats.byLang, { yue: 2, unknown: 1 })
})

test('mergePoolCandidates 把限额透传给合并后的裁剪：超配的旧候选给缺货的新候选让位', () => {
  // 每首都要独立的歌名：buildTrackKey 只认 name+singer（trackKey.ts），同名会被合并成一条
  const zhOld = Array.from({ length: 6 }, (_, i) =>
    createPoolCandidate(baseInput(entryOf({ songmid: `o${i}`, name: `老中文${i}`, lang: '国语' }).musicInfo as any)))
  const enNew = Array.from({ length: 6 }, (_, i) =>
    createPoolCandidate(baseInput(entryOf({ songmid: `n${i}`, source: 'tx', name: `New Track ${i}`, singer: 'Ada', lang: 5 }).musicInfo as any)))
  const merged = mergePoolCandidates(zhOld, enNew, 6, { limits: { zh: 2 } })
  assert.equal(merged.length, 6)
  assert.equal(merged.filter(candidate => candidate.lang == 'zh').length, 2)
  assert.equal(merged.filter(candidate => candidate.lang == 'en').length, 4)
})

test('derive-on-read 只读不写：推导一轮之后候选对象一个键都没多', () => {
  const candidates = [
    createPoolCandidate(baseInput(entryOf({ songmid: 'w1', singer: '陌生人', name: '第一封情书' }).musicInfo as any)),
    createPoolCandidate(baseInput(entryOf({ songmid: 'w2', singer: '山下達郎', name: '僕の色' }).musicInfo as any)),
  ]
  // 深拷一份键清单做对照：任何往 candidate.lang / candidate.langHint 上"顺手补一下"的写法都会在这里被抓到
  const before = candidates.map(candidate => Object.keys(candidate).sort().join(','))
  const snapshot = candidates.map(candidate => ({ lang: candidate.lang, langHint: candidate.langHint }))
  const table: ArtistLangTable = { 陌生人: { bucket: 'zh', hits: 2, updatedAt: 1 } }
  resolvePoolLang(candidates[0], table)
  resolvePoolLang(candidates[1], table)
  capPoolSize(candidates, 2, { limits: { zh: 1 }, resolveBucket: candidate => resolvePoolLang(candidate, table).bucket })
  buildFinalQueueItems(candidates, { artistLangTable: table })
  assert.deepEqual(candidates.map(candidate => Object.keys(candidate).sort().join(',')), before)
  assert.deepEqual(candidates.map(candidate => ({ lang: candidate.lang, langHint: candidate.langHint })), snapshot)
})
```

**关于 spec §4.1 那条"断言没有把推导结果写回缓存键（用假 storage 计写入次数）"**：本仓库做不到那个形态——写盘发生在 `candidateStore.ts`，它 import `@/plugins/storage`，`node --test --experimental-strip-types` 载不动（见本 Task Step 3 的说明）。上面这条是它的等价替身：落盘的唯一来源是内存里的候选数组，所以**只要推导不改入参，磁盘上就不可能多出推导结果**。这条断言比"假 storage 计数"更严（它连"改了但没存"都拦得住），验收时按这条讲，别去补一个 mock loader。

`npm test` 的 `scripts.test` 是**显式白名单**，新文件不追加进去就一行都不会跑。在 `package.json` 的 `scripts.test` 末尾（`tests/recommend-lang-bucket-supply.mts` 之后）追加：

```
tests/recommend-pool-lang.mts
```

追加后 `git status --porcelain package.json` 必须是 `M`（本 Task 该文件在 HEAD 上是干净的，不会有别的线的改动被一起提交）。

- [ ] **Step 3: 跑到失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-pool-lang.mts`
Expected: FAIL 于 `resolvePoolLang is not a function`（或等价的导出缺失报错）。若连 `candidatePool.ts` 都载不动，说明本 Task 误给它引入了非纯依赖——它只许 import `./language.ts` / `./languageQuota.ts`（都是纯模块）。

- [ ] **Step 4: 实现 candidatePool.ts**

1. `candidatePool.ts:3` 已有 `import { bucketFromLangField, type LangBucket } from './language.ts'`：**在这一行里补名**，不要新开一条同样模块的 import：

```ts
import { bucketFromLangField, resolveLang } from './language.ts'
import type { ArtistLangTable, LangBucket } from './language.ts'
```

2. 在文件顶部（import 之后、`planRefreshBudget` 之前）加下面三段。放在文件前面而不是 `capPoolSize` 前面：`mergePoolCandidates`（:85）比 `capPoolSize` 早，要引用新的 `PoolCapOptions`。

```ts
/** 候选上语种能从哪几处读到——resolvePoolLang 的输入形状。 */
export interface PoolLangBearing {
  lang?: LangBucket
  langHint?: LangBucket | null
  artistKeys?: readonly string[]
  musicInfo: { source: string, name: string, singer: string, meta?: { lang?: string | number | null } }
}

/** 裁剪时的语种约束：limits 缺席即该桶不受限，resolveBucket 缺席即只认已存的 lang/langHint。 */
export interface PoolCapOptions {
  /** 各桶在池里的名额上限；缺席即代表该桶不受淘汰约束。 */
  limits?: Partial<Record<LangBucket, number>>
  /** 桶判定器：默认只认已存的 lang / langHint，调用方可传读时推导结果。 */
  resolveBucket?: (candidate: PoolCandidate) => LangBucket
}

/**
 * 读时推导（spec §3.4）：不往候选数据里写推导结果，用的时候现算。
 * 候选池落盘是整池 JSON 重写且没有版本戳，一次误写就把磁盘缓存改了；
 * 老候选缺 lang 键也不该被当成"永远判不出"。
 */
export const resolvePoolLang = (
  candidate: PoolLangBearing,
  table?: ArtistLangTable,
): { bucket: LangBucket, level: 0 | 1 | 2 | 3 | 4 } => {
  if (candidate.lang) return { bucket: candidate.lang, level: 1 }
  return resolveLang({
    source: candidate.musicInfo.source,
    langField: candidate.musicInfo.meta?.lang,
    name: candidate.musicInfo.name,
    singer: candidate.musicInfo.singer,
    langHint: candidate.langHint ?? null,
    artistKeys: candidate.artistKeys,
  }, table)
}
```

3. `capPoolSize`（:133-145）改签名并加限额分支（**无 options 时行为逐字不变**）：

```ts
export const capPoolSize = (
  candidates: readonly PoolCandidate[],
  maxSize = recommendationConfig.candidatePool.maxSize,
  options?: PoolCapOptions,
): PoolCandidate[] => {
  if (candidates.length <= maxSize) return [...candidates]
  const sorted = [...candidates].sort((a, b) => {
    const scoreA = a.affinity + a.coOccurrence + a.exploration - a.exposureCount * 0.1
    const scoreB = b.affinity + b.coOccurrence + b.exploration - b.exposureCount * 0.1
    if (scoreA != scoreB) return scoreB - scoreA
    return b.addedAt - a.addedAt
  })
  const bucketOf = options?.resolveBucket ?? ((candidate: PoolCandidate) => candidate.lang ?? candidate.langHint ?? 'unknown')
  const limits = options?.limits
  if (!limits || !Object.keys(limits).length) return sorted.slice(0, maxSize)
  const kept: PoolCandidate[] = []
  const overflow: PoolCandidate[] = []
  const used: Partial<Record<LangBucket, number>> = {}
  for (const candidate of sorted) {
    const bucket = bucketOf(candidate)
    const limit = limits[bucket]
    if (limit !== undefined && (used[bucket] ?? 0) >= limit) {
      overflow.push(candidate)
      continue
    }
    used[bucket] = (used[bucket] ?? 0) + 1
    kept.push(candidate)
    if (kept.length >= maxSize) break
  }
  // 限额卡不住时池子仍会缺位：用超配桶的候选按分数补满，宁多几个华语也不让池子空着
  for (const candidate of overflow) {
    if (kept.length >= maxSize) break
    kept.push(candidate)
  }
  return kept
}
```

4. `mergePoolCandidates`（:85-131）加第 4 参并把限额透传给自己末尾那次裁剪（:130）：

```ts
export const mergePoolCandidates = (
  existing: readonly PoolCandidate[],
  incoming: readonly PoolCandidate[],
  maxSize = recommendationConfig.candidatePool.maxSize,
  capOptions?: PoolCapOptions,
): PoolCandidate[] => {
```

末尾一行改成：

```ts
  return capPoolSize([...byKey.values()], maxSize, capOptions)
```

**为什么限额必须走这条路透传，而不是合并完再单独淘汰一次**：`capPoolSize` 的第一行是 `if (candidates.length <= maxSize) return [...candidates]`——池子不满时一个字都不动（这是对的：有位置就不用赶人，强行赶会把探索位反复洗牌）。而 `mergePoolCandidates` 返回的长度恒 `≤ maxSize`，所以"合并后再调一次带 limits 的 `capPoolSize`"永远走进那条早退，限额分支一行代码都执行不到。只有 `mergePoolCandidates` 内部那一次裁剪面对的是"合并后可能超过 maxSize"的集合，也就是唯一能真正赶人的现场。

给 `capPoolSize` 的 JSDoc 补一句，免得后人"顺手修"成每次刷新都重排池子：

```ts
/**
 * 按分数裁剪到 maxSize；只在真的超额时动手。
 * 池子没满就不淘汰：语种靠供给补齐（candidate.ts 步骤 4.5），不靠把已有候选赶出去。
 */
```

5. `FinalQueueBuildOptions`（:164-186）在 `timeSlotFactor` 之后加：

```ts
  /** 歌手语言表：读时推导 L3 用，缺表时 L3 自动跳过、由 L4 落桶。 */
  artistLangTable?: ArtistLangTable
```

6. Modify `src/core/recommend/diversity.ts`：`FinalQueueItem`（:40 是 Task 5 加的 `lang`）再补一行

```ts
  /** 语种判定的命中级别：0=判不出 1=接口字段 2=桶提示 3=歌手表 4=字面统计。只用于诊断日志。 */
  langLevel?: 0 | 1 | 2 | 3 | 4
```

7. `buildFinalQueueItems`（:285-313）把 Task 5 写的 `lang: candidate.lang,`（:302）换成：

```ts
    const resolvedLang = resolvePoolLang(candidate, options.artistLangTable)
```

返回对象里：

```ts
      lang: resolvedLang.bucket,
      langLevel: resolvedLang.level,
```

8. `poolStats`（:315-325）加语种分布：

```ts
export const poolStats = (candidates: readonly PoolCandidate[], resolveBucket?: (candidate: PoolCandidate) => LangBucket) => {
  const byChannel: Record<ChannelId, number> = { A: 0, B: 0, C: 0, D: 0 }
  const byLang: Partial<Record<LangBucket, number>> = {}
  const bucketOf = resolveBucket ?? ((candidate: PoolCandidate) => candidate.lang ?? candidate.langHint ?? 'unknown')
  for (const candidate of candidates) {
    for (const channel of candidate.channels) byChannel[channel] += 1
    const bucket = bucketOf(candidate)
    byLang[bucket] = (byLang[bucket] ?? 0) + 1
  }
  return {
    total: candidates.length,
    byChannel,
    byLang,
    confirmed: candidates.filter(candidate => candidate.confirmedSeedPlaylist).length,
  }
}
```

- [ ] **Step 5: 实现 computePoolBucketLimits**

Modify `src/core/recommend/languageQuota.ts`，末尾追加：

```ts
/**
 * 把"20 首窗口里的目标首数"放大成"池里允许存在多少首"，再乘宽松系数：
 * 淘汰是慢变量（下次抓取才能补货），卡太死会让某语种突然断供。
 */
export const computePoolBucketLimits = (options: {
  targets: LangTargets
  maxSize: number
  windowSize: number
  slack: number
}): Partial<Record<LangBucket, number>> => {
  if (!options.targets.enforced) return {}
  const window = Math.max(1, Math.floor(options.windowSize))
  const limits: Partial<Record<LangBucket, number>> = {}
  for (const bucket of QUOTA_LANG_BUCKETS) {
    const target = options.targets.targets[bucket]
    if (target === undefined) continue
    limits[bucket] = Math.ceil(target * (Math.max(0, options.maxSize) / window) * Math.max(1, options.slack))
  }
  return limits
}
```

- [ ] **Step 6: 桶召回的池内计数改用推导**

1. Modify `src/core/recommend/candidate.ts`：`CatalogRefreshParams` 里 `langTargets?: LangTargets` 之后加：

```ts
  /** 歌手语言表：算池内语种分布时做读时推导，老候选不至于全算成 unknown。 */
  artistLangTable?: ArtistLangTable
```

2. 步骤 4.5 里 `const poolCounts = countPoolLang(poolCandidates)` 换成：

```ts
    const poolCounts = countPoolLang(poolCandidates.map(candidate => ({
      lang: resolvePoolLang(candidate, params.artistLangTable).bucket,
    })))
```

import 补 `import { resolvePoolLang } from './candidatePool.ts'` 与 `import type { ArtistLangTable } from './language.ts'`。

3. Modify `src/core/recommend/index.ts`（`refreshPoolWithSource` 在 :283，`const params: CatalogRefreshParams = {` 在 :294-311，合池在 :324，过滤在 :326）：

先把 `langTargets` 从 params 字面量里提成局部变量，并算出本轮的池内桶限额——放到 `const params: CatalogRefreshParams = {` 之前：

```ts
      const langTargets = computeLangTargets(state.onboarding.weights, cfg.channels.windowSize)
      const poolLimits = computePoolBucketLimits({
        targets: langTargets,
        maxSize: cfg.candidatePool.maxSize,
        windowSize: cfg.channels.windowSize,
        slack: cfg.candidatePool.poolEvictOverQuotaSlack,
      })
```

params 构造里把原来那行 `langTargets: computeLangTargets(...)` 改成 `langTargets,`，并在它后面加 `artistLangTable: getArtistLangTable(),`。

:324 那一次合池改成带限额的第 4 参（**不要**另外再调一次 `capPoolSize`：合池返回值长度恒 `≤ maxSize`，独立调用会走进 `length <= maxSize` 的早退，限额分支一行都跑不到——见 Step 4 第 4 条）：

```ts
      state.candidateCache = mergePoolCandidates(state.candidateCache, result.candidates, cfg.candidatePool.maxSize, {
        limits: poolLimits,
        resolveBucket: candidate => resolvePoolLang(candidate, getArtistLangTable()).bucket,
      })
```

`state.candidateCache` 为空的冷启动轮：`result.candidates` 单独一般也超不过 `maxSize`，此时不淘汰、直接整池收下（池子不满就不赶人是对的，缺口由 `candidate.ts` 步骤 4.5 补齐）。

import 改动：`./candidatePool.ts` 那行（:24）补 `resolvePoolLang`（**不补 `capPoolSize`**，本处不再需要）；`./languageQuota.ts` 那行（:11）补 `computePoolBucketLimits`；`getArtistLangTable` 已在 :15 导入。

4. `generateQueue` 的 `buildFinalQueueItems(state.candidateCache, { ... })`（:492）options 里加：

```ts
      artistLangTable: getArtistLangTable(),
```

5. 同处的 `recallLog('generate', { ... })`（:571-592）：在 `langUnmet` 的定义（:566-570）之后补级别占比：

```ts
    const langLevels: Record<string, number> = {}
    for (const item of finalItems) {
      const key = `L${item.langLevel ?? 0}`
      langLevels[key] = (langLevels[key] ?? 0) + 1
    }
```

再在 recallLog 里把 `langUnmet,` 那行（:583）替换为：

```ts
      langUnmet,
      langLevels,
      pool: poolStats(state.candidateCache, candidate => resolvePoolLang(candidate, getArtistLangTable()).bucket),
```

**定位提示**：`pool: poolStats(state.candidateCache),` 在本文件里有三处完全相同的写法——:337（`recallLog('refresh')`）、:591（`recallLog('generate')`）、:715（`getProfileDigest`）。只改前两处（它们是召回日志，验收要读的就是"配额没兑现是判不出还是没货"，用默认判定会把老候选全报成 `unknown`，等于把诊断字段做成假的）；:715 那处自带"TODO 定位后删除"，不动。

6. `refreshPoolWithSource` 末尾的 `recallLog('refresh', { ... })`（:334-339）里，把 :337 那一行改成与上面同口径（同一个 resolver 表达式，重复一次比提到模块级更清楚，因为只有两处用）：

```ts
        pool: poolStats(state.candidateCache, candidate => resolvePoolLang(candidate, getArtistLangTable()).bucket),
```

- [ ] **Step 7: 跑到通过 + 闸门**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-pool-lang.mts`
Expected: 9 条全 PASS。

Run: `npm test`
Expected: 全绿。`recommend-algorithm.mts` 里若有直接调 `capPoolSize(candidates, n)` 的断言，无 options 分支逐字保留原行为，不该红。

Run: `npx eslint src/core/recommend/candidatePool.ts src/core/recommend/languageQuota.ts src/core/recommend/candidate.ts src/core/recommend/config.ts src/core/recommend/index.ts`
Expected: 0 error。

Run: `npx tsc --noEmit 2>&1 | grep -E "recommend/(candidatePool|languageQuota|candidate|index|config)" || echo "no new errors"`
Expected: `no new errors`。

Run: `npm run build-test && grep -c "poolEvictOverQuotaSlack" index.android.bundle && grep -c "langLevels" index.android.bundle`
Expected: 构建 exit 0，两个 grep 都 `≥ 1`。`candidate.ts` / `index.ts` 载入不了 `node --test`（它们 import `@/plugins/storage` / `musicSdk`），本 Task 的引擎接线**没有任何单测能看见**——包内计数是"接线真的进了 App"的唯一机械证据。

- [ ] **Step 8: 提交**

```bash
git add src/core/recommend/candidatePool.ts src/core/recommend/languageQuota.ts src/core/recommend/candidate.ts src/core/recommend/config.ts src/core/recommend/index.ts tests/recommend-pool-lang.mts package.json
git commit -m "feat(recommend): 语种读时推导不进落盘数据，池淘汰按桶留名额并补诊断"
```

---

### Task 8: 问卷播种改以 50% 为中轴，并把存量用户重播一遍

对应 spec §3.3.1 第 1 条。本 Task 只动**算术与迁移**，不碰召回与打分（那是 Task 9）。

**为什么这是硬配额之外必须修的一处**：`seedValueFor`（`onboarding.ts:63`）今天是 `percent / 100 * saturation`，于是用户把"中文"压到 10% 反而给华语分类**加**了 0.4 的正权，`themeAffinityFactor`（`feedback.ts:343`）顺着把它抬进召回——这正是"选了 10% 却连着三四首中文"的软权重侧根因。Task 4/5 的硬配额只能每轮破例拦人，改完中轴才是让召回自己少抓。

**为什么必须带迁移**（spec 原文"不需要迁移"是错的）：`seededThemeWeights` 里存量用户已经按老公式记了一笔纯正分量，`index.ts:1078-1081`（`submitOnboarding`）提交时"先 revoke 旧分量再 apply 新分量"的精确回退全靠它。而这些用户不会再过一遍问卷，只改代码的话修正对他们永不落地。`onboarding.weights` 存的是百分比原值、一直没丢，所以迁移可以做"用旧分量精确退掉 → 用原百分比按新公式重播"。学习数据（tracks/playlists/session）一律不动。

**Files:**
- Modify: `src/core/recommend/onboarding.ts:63`（`seedValueFor`）、`:66-78`（`computeSeedWeights`）、`:81-90`（`applySeedWeights`）、`:93-104`（`revokeSeedWeights`）
- Modify: `src/core/recommend/stateSchema.ts:5`（`STATE_VERSION` 8→9）、`:1-3`（import）、`:69-79`（`onboarding` 局部量）、`:80-86`（`themeWeights` 落成本地量）、`:86` 改引用
- Modify: `tests/recommend-algorithm.mts:853`、`:872`（两处把 `version` 写死成 8 的断言 → 9；见 Step 2 其六）
- Test: `tests/recommend-onboarding.mts`（既有 14 条里改写 4 处、新增 4 条 → 共 18 条）

`package.json` 不用动：`tests/recommend-onboarding.mts` 早已在 `scripts.test` 白名单里（`npm test` 那串路径能看到它）。

**Interfaces:**
- Consumes：`recommendationConfig.themeFeedback.saturation`（`config.ts` 当前为 4，本 Task 不改它）；`OnboardingState`（`types.ts:198-202`，三个字段都不是 readonly，迁移里可以就地写 `onboarding.seededThemeWeights`）；`createThemePreference(themeId, now)`（`feedback.ts:290`，正负两侧都从 0 起）。
- Produces：**三个导出签名一字不改**，只是语义变带符号——`computeSeedWeights(weights): Record<string, number>`（值可负、可为负零不出现）、`applySeedWeights(themes, seeds, now?)`、`revokeSeedWeights(themes, seeds)`。因此 `index.ts:1078-1081` 的问卷提交路径**一行都不用改**就能吃新语义。`STATE_VERSION` 由 8 变 9。

**数值先算清楚（saturation = 4，别实现完再来对）：**

| percent | 新分量 | 说明 |
| --- | --- | --- |
| 100 | `+4` | 与老公式同值（100/100×4 也是 4） |
| 80 | `+2.4` | 老公式 3.2 |
| 50 | `0` | 中轴，**不播种** |
| 20 | `-1.2` | `-(50-20)/50 × 4 × 0.5` |
| 10 | `-1.6` | `-(50-10)/50 × 4 × 0.5`，老公式是 `+0.4` |

`sanitizeWeights`（`onboarding.ts:52-61`）已保证进来的百分比只有 10/20/…/100（钳 0-100、取整到 10、0 值删除），所以不用为 0 或小数百分比设计分支。

- [ ] **Step 1: 确认 stateSchema 引 onboarding 不会绕成循环**

`onboarding.ts` 目前 import `./config.ts`、`./feedback.ts`、`./trackKey.ts`、`./types.ts`；本 Task 要让 `stateSchema.ts` 反向 import 它。先确认这四家里没有谁 import `stateSchema`：

Run: `grep -rn "stateSchema" src/core/recommend/onboarding.ts src/core/recommend/config.ts src/core/recommend/feedback.ts src/core/recommend/trackKey.ts`
Expected: 无输出。只有 `src/core/recommend/storage.ts:3` 引 `stateSchema`，它不在 onboarding 的依赖链上，加这条 import 是安全的。若真出了输出，**不要**把逻辑塞进 `stateSchema`，改为把这三行搬到 `storage.ts` 调 `migrateRecommendationState` 之后的位置，并在交接说明里记下改动的理由。

- [ ] **Step 2: 改写会变的四处既有断言，并补三条新的（先让它们红）**

Modify `tests/recommend-onboarding.mts`。

其一，把 `computeSeedWeights keys are normalized aliases and values scale with percent`（18–24 行）整条换成下面这条。`jazz: 50` 落在中轴上不该留键，`rnb: 10` 要变负——注意别名键 `r&b` 已实测（`normalizeText('R&B')` → `"r&b"`）：

```ts
test('computeSeedWeights uses 50% as the neutral point: above seeds positive, below seeds negative', () => {
  const seeds = computeSeedWeights({ western: 100, jazz: 50, rnb: 10 })
  assert.equal(seeds['欧美'], 4)
  assert.equal(seeds['英文'], 4)
  assert.equal(seeds['爵士'], undefined)
  assert.equal(seeds['r&b'], -1.6)
  assert.equal(seeds['节奏布鲁斯'], -1.6)
})
```

其二，`computeSeedWeights takes the max when two options share an alias key`（26–29 行，`{ electronic: 100, dj: 20 }` → `seeds.dj === 4`）**一个字都不用改**：`electronic` 与 `dj` 都别名到 `dj`，一个 `+4` 一个 `-1.2`，改成"取绝对值更大者"之后仍是 4。留着它正好当"带符号以后同键仍取更强的一侧"的回归。只在它上面那行注释里补一句说明取的是绝对值。

其三，把 `default state carries an unfinished onboarding`（76–80 行）里的 `assert.equal(state.version, 8)` 改成 `9`。

其四，`a version 8 stored onboarding survives migration untouched`（101–107 行）这条断言会被本 Task 正面推翻——v8 存量用户现在**要**被重播。整条换成：

```ts
test('a version 8 onboarding is reseeded with the neutral-point formula', () => {
  const migrated = migrateRecommendationState({
    version: 8,
    themeWeights: {
      华语: { themeId: '华语', positiveWeight: 0.4, negativeWeight: 0, lastDecayTime: 1000, lastUsedTime: 1000 },
    },
    onboarding: { completed: true, weights: { zh: 10 }, seededThemeWeights: { 华语: 0.4 } },
  })
  // 老分量 +0.4 精确退掉，再按新公式播成 -1.6：10% 从此是负偏好
  // 播种按选项的**全部别名**逐键写入（zh 有 4 个别名），所以这里必须列满四键——少写一键就是断言错，不是实现错
  assert.deepEqual(migrated.onboarding.seededThemeWeights, { 华语: -1.6, 国语: -1.6, 中文: -1.6, 内地: -1.6 })
  assert.equal(migrated.themeWeights['华语'].positiveWeight, 0)
  assert.equal(migrated.themeWeights['华语'].negativeWeight, 1.6)
  assert.equal(Object.keys(migrated.themeWeights).length, 4, '四个别名各占一条，用户没点过的 国语/中文/内地 也会被播上')
  assert.equal(migrated.onboarding.completed, true)
  assert.equal(migrated.version, 9)
})
```

`a v7 submitted onboarding is re-shown with its answers carried over`（93–99 行）也要改：v7 同样落在 `< 9` 闸门里，重播后 `华语` 从 2.8 变 1.6（70% → `(70-50)/50 × 4`），且四个别名各记一笔。把最后那行 `assert.deepEqual(migrated.onboarding, {...})` 改成：

```ts
  assert.deepEqual(migrated.onboarding, {
    completed: false,
    weights: { zh: 70 },
    seededThemeWeights: { 华语: 1.6, 国语: 1.6, 中文: 1.6, 内地: 1.6 },
  })
```

其五，在文件末尾追加四条新用例（前两条盖住 `applySeedWeights`/`revokeSeedWeights` 的负支，第三条盖住"重播只做一次"，第四条是 spec §4.1 点名的"同一份 weights 连跑两次结果一致"）。第一条要给夹具显式标注类型，因此文件顶部 import 区（第 4-6 行那三行之后）补一行：

```ts
import type { ThemePreference } from '../src/core/recommend/types.ts'
```

纯类型导入，`--experimental-strip-types` 会擦掉它，不会把 `types.ts` 拉进运行时依赖。其余三条不需要标注（`revokeSeedWeights` 那条的 `themes` 字面量键已带齐，两条迁移用例索引的是 `migrateRecommendationState` 返回值上的 `Record<string, ThemePreference>`，实测零错误）。

```ts
test('applySeedWeights routes a negative seed to negativeWeight only', () => {
  // 必须显式标注：`const themes = {}` 会被推成 `{}`，之后每次 themes['华语'] 都吃一条 TS7053，
  // 这条用例的五个索引读取会把全项目 tsc 基线从 137 顶到 142。写法同 tests/recommend-lang-bucket-supply.mts:6
  const themes: Record<string, ThemePreference> = {}
  applySeedWeights(themes, { 华语: -1.6, 欧美: 4 }, 1000)
  assert.equal(themes['华语'].positiveWeight, 0)
  assert.equal(themes['华语'].negativeWeight, 1.6)
  assert.equal(themes['欧美'].positiveWeight, 4)
  assert.equal(themes['欧美'].negativeWeight, 0)
  applySeedWeights(themes, { 民谣: 0 }, 1000)
  assert.equal(themes['民谣'], undefined, 'a neutral seed must not create an entry')
})

test('revokeSeedWeights undoes a negative seed and keeps the user own net weight', () => {
  const themes = {
    华语: { themeId: '华语', positiveWeight: 0, negativeWeight: 2.6, lastDecayTime: 1000, lastUsedTime: 1000 },
    欧美: { themeId: '欧美', positiveWeight: 0, negativeWeight: 1.6, lastDecayTime: 1000, lastUsedTime: 1000 },
    爵士: { themeId: '爵士', positiveWeight: 1, negativeWeight: 0.6, lastDecayTime: 1000, lastUsedTime: 1000 },
  }
  revokeSeedWeights(themes, { 华语: -1.6, 欧美: -1.6, 爵士: -4 })
  assert.equal(themes['华语'].negativeWeight, 1, '用户自己点出来的负权要留着')
  assert.equal(themes['欧美'], undefined, '两侧都归 0 就删条目')
  // 分量比记录值大（老数据被衰减过）时只钳到 0，绝不把 negativeWeight 写成负数
  assert.equal(themes['爵士'].negativeWeight, 0)
  assert.equal(themes['爵士'].positiveWeight, 1)
})

test('replaying a v9 state does not touch its seeds again', () => {
  const stored = {
    version: 9,
    themeWeights: { 华语: { themeId: '华语', positiveWeight: 0, negativeWeight: 1.6, lastDecayTime: 1000, lastUsedTime: 1000 } },
    onboarding: { completed: true, weights: { zh: 10 }, seededThemeWeights: { 华语: -1.6 } },
  }
  const migrated = migrateRecommendationState(stored)
  assert.deepEqual(migrated.onboarding, stored.onboarding)
  assert.equal(migrated.themeWeights['华语'].negativeWeight, 1.6)
})

test('running the v8 migration twice lands on the same place', () => {
  const legacy = {
    version: 8,
    themeWeights: {
      华语: { themeId: '华语', positiveWeight: 0.4, negativeWeight: 0, lastDecayTime: 1000, lastUsedTime: 1000 },
      欧美: { themeId: '欧美', positiveWeight: 4, negativeWeight: 0, lastDecayTime: 1000, lastUsedTime: 1000 },
    },
    onboarding: {
      completed: true,
      weights: { zh: 10, western: 100 },
      seededThemeWeights: { 华语: 0.4, 欧美: 4, 英文: 4, 英语: 4, 西洋: 4 },
    },
  }
  const once = migrateRecommendationState(legacy)
  const twice = migrateRecommendationState(once)
  assert.deepEqual(twice.onboarding, once.onboarding)
  assert.deepEqual(twice.themeWeights, once.themeWeights)
})
```

最后这条是幂等闸门：`version < 9` 只在第一次为真，第二次进来 `version` 已是 9，重播块整个跳过。**不要**把它写成"再跑一次 `computeSeedWeights` 结果相同"——那测的是纯函数可重复性，不是迁移的消耗品语义。

其六，改 `tests/recommend-algorithm.mts` 的两处版本号（它们和播种算术无关，只是把 `STATE_VERSION` 的当前值写死在了断言里，`STATE_VERSION` 一变 `npm test` 就红）：

- `:853` `assert.equal(migrated.version, 8)` → `9`（`legacy v1 state migrates ...` 那条）
- `:872` `assert.equal(defaults.version, 8)` → `9`（同一条里 `createDefaultState()` 的对照）

这两条的夹具都没有 `onboarding.weights`（v1/v2 状态里根本没这个字段），重播块的 `Object.keys(onboarding.weights).length > 0` 闸门会把它们整段跳过，所以除版本号以外该条其余断言照旧绿。**不要**顺手给这条加播种断言——播种语义归 `tests/recommend-onboarding.mts`。

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-onboarding.mts`
Expected: FAIL ——`computeSeedWeights` 仍返回 `+0.4`、`migrated.version` 仍是 8、`applySeedWeights` 把负分量错加到 `positiveWeight` 上。

- [ ] **Step 3: 改 `onboarding.ts` 的四个函数**

把 `onboarding.ts:63` 那行 `seedValueFor` 换成带符号两支，并在它上面补注释说明中轴含义（这是全模块唯一一处"百分比→权重"的换算，改这里就够）：

```ts
/**
 * 问卷百分比 → 分类净权初值，以 50% 为中轴：高于 50 给正分量，低于 50 给负分量。
 * 老写法是 percent/100×saturation，"中文 10%" 会被记成正偏好、把华语越推越多的锅有一半在这里。
 * 50% 恰为 0（不播种），负支幅度只取正支的一半——误伤比误爱便宜，但也别狠到把用户没听过的分类一棒打死。
 */
const NEUTRAL_PERCENT = 50
const NEGATIVE_SEED_RATIO = 0.5

const seedValueFor = (percent: number): number => {
  const saturation = recommendationConfig.themeFeedback.saturation
  if (percent >= NEUTRAL_PERCENT) return (percent - NEUTRAL_PERCENT) / (100 - NEUTRAL_PERCENT) * saturation
  return -((NEUTRAL_PERCENT - percent) / NEUTRAL_PERCENT * saturation * NEGATIVE_SEED_RATIO)
}
```

`computeSeedWeights`（66–78）里两处要改：跳过 0 值（中轴不播种）、同键改比绝对值（老代码 `Math.max(seeds[key] ?? 0, ...)` 在带符号时会把 `-1.6` 判给"不存在"而漏掉）：

```ts
/** optionId→百分比 映射成 themeWeights 键→初值分量（可正可负）；同键多选项命中取绝对值更大的一侧。 */
export const computeSeedWeights = (weights: Record<string, number>): Record<string, number> => {
  const seeds: Record<string, number> = {}
  for (const option of ONBOARDING_OPTIONS) {
    const percent = weights[option.id]
    if (!percent) continue
    const value = seedValueFor(percent)
    if (value == 0) continue
    for (const alias of option.aliases) {
      const key = normalizeText(alias)
      if (!key) continue
      if (Math.abs(value) > Math.abs(seeds[key] ?? 0)) seeds[key] = value
    }
  }
  return seeds
}
```

`applySeedWeights`（81–90）按符号落到两侧之一，0 值直接跳过（否则会给"两侧皆 0"的空条目建个壳，把 `themeAffinityFactor` 之外的衰减逻辑白白拖进来）：

```ts
/** 把初值分量按符号并进分类净权的正/负反馈侧；直接改动传入 map（与状态存储共享引用）。 */
export const applySeedWeights = (
  themes: Record<string, ThemePreference>,
  seeds: Record<string, number>,
  now = Date.now(),
): void => {
  for (const [key, seed] of Object.entries(seeds)) {
    if (!seed) continue
    const base = themes[key] ?? createThemePreference(key, now)
    themes[key] = seed > 0
      ? { ...base, positiveWeight: base.positiveWeight + seed, lastUsedTime: now }
      : { ...base, negativeWeight: base.negativeWeight - seed, lastUsedTime: now }
  }
}
```

`revokeSeedWeights`（93–104）是**必须跟着改的那半边**——它今天整个函数不碰 `negativeWeight`，删除条件也是"正权归 0 且负权本来为 0"。播种分量一旦可带符号，这里不对称回退就会让用户重置问卷后**负权永久残留**，把该分类压死：

```ts
/** 只回退记录在案的初值分量：按符号分两支对称回退，减后钳 0，两侧皆 0 才删条目，用户反馈净权保留。 */
export const revokeSeedWeights = (
  themes: Record<string, ThemePreference>,
  seeds: Record<string, number>,
): void => {
  for (const [key, seed] of Object.entries(seeds)) {
    if (!seed) continue
    const pref = themes[key]
    if (!pref) continue
    if (seed > 0) {
      const positiveWeight = Math.max(0, pref.positiveWeight - seed)
      if (positiveWeight == 0 && pref.negativeWeight == 0) delete themes[key]
      else themes[key] = { ...pref, positiveWeight }
    } else {
      const negativeWeight = Math.max(0, pref.negativeWeight + seed)
      if (negativeWeight == 0 && pref.positiveWeight == 0) delete themes[key]
      else themes[key] = { ...pref, negativeWeight }
    }
  }
}
```

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-onboarding.mts`
Expected: `computeSeedWeights` / `applySeedWeights` / `revokeSeedWeights` 的用例转绿；两条 `migrateRecommendationState` 的重播用例仍红（迁移还没写）。

- [ ] **Step 4: 加 v8→v9 重播种迁移**

`stateSchema.ts:5` 改 `export const STATE_VERSION = 9`。

顶部 import 区（1–3 行）补两行：

```ts
import { applySeedWeights, computeSeedWeights, revokeSeedWeights } from './onboarding.ts'
import type { RecommendationState, PlaylistPreference, OnboardingState, ThemePreference } from './types.ts'
```

（第二行是把 `ThemePreference` 加进既有的那行 type import，不是新加一行。）

`migrateRecommendationState` 里，`:69-79` 的 `onboarding` **声明一字不动**（仍是 `const`）：重播要写的是它的属性 `seededThemeWeights`，而 `OnboardingState` 三个字段都不是 readonly（`types.ts:198-202`），`const` 绑定的对象照样可以改属性。不要改成 `let`——一个从不重新赋值的 `let` 会让读代码的人以为整个对象要被换掉。（本仓 `prefer-const` 是 off 的，eslint 不会替你拦住这个误读。）

紧接其后（原 `:80` 的 `return {` 之前）插入重播块，并把 `themeWeights` 从返回对象里的内联表达式提成本地量（迁移要改它）：

```ts
  const themeWeights: Record<string, ThemePreference> = { ...(raw.themeWeights ?? {}) }
  // v9 起问卷播种以 50% 为中轴（10% 要产生负权）。存量用户不会再过问卷，
  // 所以这里先用他们记录在案的老分量精确退掉，再拿一直没丢的百分比原值按新公式重播。
  // 只改代码不加这条闸门，这次修正对他们永远不落地。
  if ((raw.version ?? 0) < 9 && Object.keys(onboarding.weights).length > 0) {
    revokeSeedWeights(themeWeights, onboarding.seededThemeWeights)
    const seeds = computeSeedWeights(onboarding.weights)
    applySeedWeights(themeWeights, seeds)
    onboarding.seededThemeWeights = seeds
  }
```

返回对象里 `themeWeights: raw.themeWeights ?? {},`（86 行）替换成 `themeWeights,`。

三条写法上的注意点：
1. **顺序不能倒**——必须先 `revoke`（吃 `seededThemeWeights` 里的老值）再 `apply`（新值），反了会把老分量当成新分量少退一截，剩下的差额再也退不掉。
2. **revoke 用的是老记录值、不是现算值**。`seededThemeWeights` 是当年真正写进 `themeWeights` 的那笔数，用它退才精确；用新公式现算再来退就退不干净（同一个 10%，老记 +0.4、新算 -1.6）。
3. `completed` 一律不动：v8 已填过的保持已填（重播是静默的，不再打扰用户），`< 8` 的仍按既有分支重置成 `false`——这类用户马上会重填，`index.ts:1078-1081` 的提交路径会再走一遍同一套带符号函数，退的正是本块刚写进去的新分量，不会重复计数。

- [ ] **Step 5: 跑到通过 + 闸门**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-onboarding.mts`
Expected: 18 pass（既有 14 条，其中 4 条已按本 Task 改写；另加本 Task 新增的 4 条），0 fail。

Run: `npm test`
Expected: 全绿、0 fail。`recommend-algorithm.mts` 里唯一会因本 Task 变红的就是 Step 2 其六那两处写死的版本号——它们已在 Step 2 改好，若仍红说明 `STATE_VERSION` 没改成 9 或其六漏改，**不要**把它们当成"播种公式退化"来处理。特别注意 `recommend-algorithm.mts` 里如果有断言直接把 `applySeedWeights`/`computeSeedWeights` 的饱和值写死，出现红的是同类脆弱断言：按"只断言方向不断言绝对值"改，不要为了让旧数值绿而回退公式。`tests/recommend-onboarding.mts` 里 `pickPlaylistTag prefers a seeded category...`（63-74 行）本 Task **不该动**——它只断言"登场的是被播种的那个分类"，没钉绝对值，而 `{western: 100}` 在新公式下仍是 `+4`（`(100-50)/50 × 4`），方向不变所以它照旧绿；它红了就说明新公式在 100% 这一档没给出正播种，是实现问题，别改断言。

Run: `npx eslint src/core/recommend/onboarding.ts src/core/recommend/stateSchema.ts`
Expected: 0 error。

Run: `npx tsc --noEmit 2>&1 | grep -E "recommend/(onboarding|stateSchema|index)" || echo "no new errors"`
Expected: `no new errors`。

Run: `npx tsc --noEmit 2>&1 | grep -cE "error TS"`
Expected: **137**（开工基线，一字不多）。上面那条 grep 只看 `src/` 里的路径（`recommend/onboarding` 带斜杠，`tests/recommend-onboarding.mts` 匹配不到），所以测试文件里新增的类型错误它拦不住——总数才是唯一的口径。注意 `tests/recommend-onboarding.mts:36` 本来就有 1 条 TS7053 在基线里（既有用例 `applySeedWeights adds onto existing positive` 的 `themes['民谣']`），**不要**顺手去清它，清了总数会掉到 136、反而看不出是不是自己新写的东西引入的。

- [ ] **Step 6: 真机口径的自查（不改代码，只确认账目）**

`npm test` 盖不到 `index.ts:1078-1081`（那个模块 import `@/plugins/storage`，`--experimental-strip-types` 载不动），所以手工对一遍提交问卷这条路：

Run: `sed -n '1073,1083p' src/core/recommend/index.ts`
Expected: 顺序仍是 `revokeSeedWeights(state.themeWeights, state.onboarding.seededThemeWeights)` → `computeSeedWeights(sanitized)` → `applySeedWeights(...)` → `state.onboarding = { completed: true, weights: sanitized, seededThemeWeights: seeds }`。这四行在新语义下**本来就是对的**（退旧笔、播新笔、把新笔记录下来供下次退），不需要改；确认它没被写成"先 apply 再 revoke"即可。

- [ ] **Step 7: 提交**

```bash
git add src/core/recommend/onboarding.ts src/core/recommend/stateSchema.ts tests/recommend-onboarding.mts tests/recommend-algorithm.mts
git commit -m "feat(recommend): 问卷以 50% 为中轴播种偏好，v8 存量按新公式重播"
```

---

### Task 9: 治连推——歌手直采减量、抽样软惩罚、砍掉"间隔归零"的兜底

对应 spec §3.5。这是用户例②"经常推一个歌手的歌"的另一半：Task 8 让分类偏好不再反向助攻，本 Task 直接收供给侧与抽样侧。

**根因按贡献排好的三处**（都已复现读取）：
1. `candidate.ts:576` 每轮直采 2 位强歌手（读 `artistHitsPerRefresh`）、`:585` 每人搜 15 首 → 单轮最多灌进 30 首同一批人的歌，池子刚建就偏。
2. `diversity.ts:222` 把最后一档 `artistGap` 硬设成 `0`。注释写的是"仅候选枯竭时兜底"，但 1 里那 30 首同歌手候选一多，"枯竭"来得比预想的早，于是**连推**。
3. `diversity.ts:260` 的 `weightFor` 只有曝光与同版本两种软惩罚，同歌手"隔得刚好满足 8 首"和"30 首里唯一候选"权重一样。

下面所有行号是 2026-10-13 实测值。`diversity.ts`/`candidate.ts`/`config.ts` 在 Task 5~8 里被改过，行号可能再次漂移——**每一步都用引用的那段代码原文去定位**（例如 `relaxConfigs[relaxConfigs.length - 1].artistGap = 0`、`searchMusic(source, artistEntry.artist, 1, 15`），行号只是提示；原文找不到就是真找不到，不要改到形似的另一处。

**本 Task 明确不做**：`config.ts:24` 的 `targetPerWindow.A: 9` **不动**。spec §3.5 那条"A 通道 9→7 让名额给 E"是通道 E（P3）上线时的配套，P1 没有 E，先砍 A 只会把名额推给 B/C/D 里的探索曲，观感更差。同理 `diversity.ts:233` 的 `pickedByChannel` 仍是四个通道。

**Files:**
- Modify: `src/core/recommend/config.ts:213`（`artistHitsPerRefresh` 2→1）、`:244`（`sameArtistInLast30` 3→2）、`:242-262`（`antiRepeat` 新增 5 个键）
- Modify: `src/core/recommend/candidate.ts:172`（**评审后退回原值 0.5，不再动**——见下方 Step 4 的说明）、`:571`（注释与"采 2 人"的描述）、`:585`（搜索条数 15→8）
- Modify: `src/core/recommend/diversity.ts:222`（最后一档不再归零）、`:260-268`（`weightFor` 加同歌手软惩罚）
- Modify: `tests/recommend-algorithm.mts`（`:2032` 后加 1 个断言；`:225-231` 那条单歌手池用例按新契约改写）
- Modify: `tests/recommend-diversity-lang.mts:138-160`（把"升级只来自歌手间隔"那条的 recent 几何重排，见 Step 1 其四）
- Add: `tests/recommend-algorithm.mts` 文件末尾 3 条新用例（第 3 条钉软惩罚两档的档位差，是 Step 4 落地后按复评补的，见 Step 6 的条数账）

`package.json` 不用动（`recommend-algorithm.mts` 已在白名单）。`candidate.ts` 不在单测可载范围（它 import `sdkCatalog.ts` → `@/utils/musicSdk`），所以 1 里的三处只用 grep 闸门钉，不硬造测试。

**Interfaces:**
- Consumes：`recommendationConfig.antiRepeat.*`（`diversity.ts` 已在读这一段）；`FinalQueueItem.artistKeys`（`diversity.ts:156` 的 `matchesAnyArtist` 就是按它比对）；`countInLast`（`diversity.ts:147`，私有，本 Task 直接复用）。
- Produces（`config.ts` 的 `antiRepeat` 新增键，Task 9 之后没人读，名字要与下面代码一字不差）：
  - `minArtistGap: number`（2）——最后一档也至少隔这么首
  - `recentArtistWindow: number`（6）、`recentArtistFactor: number`（0.35）
  - `midArtistWindow: number`（12）、`midArtistFactor: number`（0.6）

- [ ] **Step 1: 先写三条会红的用例**

Modify `tests/recommend-algorithm.mts`。文件里已有 `mkFinalItem(key, artist, channel, extra)`（144–161 行，给每个条目配好 `artistKeys: [artist.toLowerCase()]`、`albumKey`/`sourcePlaylistId` 都按 key 唯一，正好用来隔离歌手约束）与 `selectFinalQueue` 的 import（9 行）。

先在 `artist relaxation never dips below the four-song floor before the last rung`（2029 行起）那条的 2032 行之后补一行，把新的"最后一档也不许归零"钉进同一条用例：

```ts
  assert.ok(antiRepeat.minArtistGap >= 1, 'the last rung must still keep at least one song in between')
```

**其二：改写既有的单歌手池用例（`tests/recommend-algorithm.mts:225-231`）。** 这条用例原本钉的是"只有一个歌手时照样把队列填满，而不是假装多样"——它和 Step 3 要立的规矩（最后一档也至少隔 `minArtistGap` 首）**在数学上不可能同时成立**：任何非零的末档间隔都会让"整池同一歌手"只出得到 1 首（预检实测：`minArtistGap: 2` 下 target 5 只出 1 首）。裁决定的是**宁可短队列也不要连推**，理由是同歌手连推是用户点名投诉过的观感问题，而"整池只剩一个歌手"只在召回大幅失败的降级态出现，那时少给几首、让下一轮补货重试，比把 5 首同一歌手塞进队列更可信。所以这条用例连同它的名字一起按新契约改写（不是把它删掉——删掉等于把这条约束的证明也删了）：

```ts
test('a single-artist pool yields one song plus a reason instead of back-to-back repeats', () => {
  const candidates = Array.from({ length: 10 }, (_, i) => mkFinalItem(`only-${i}`, 'Only Artist', 'A', { sourcePlaylistId: `only-pl-${i}` }))
  const plan = planChannelQuotas(5, [], { A: 10, B: 0, C: 0, D: 0 }, { coldStart: true })
  const result = selectFinalQueue(candidates, { target: 5, channelPlan: plan, rng: seedRandom(1) })
  assert.equal(result.items.length, 1, '候选枯竭时宁可少给，也不同歌手连着放')
  assert.ok(result.reasons.includes('no_candidate_after_relaxation'), `expected the starvation reason, got ${result.reasons.join(',')}`)
})
```

改写前它是绿的（末档归零能凑满 5 首）、改写后先红（还是 5 首），Step 3 落地才转绿。原来的 `relax_level_` 断言在新行为下不再出现（第一首是在第 0 档收的，之后直接枯竭），所以那句换成 `no_candidate_after_relaxation`——别把两条都留着硬凑，那会变成断言一个不会发生的事。

**其三：文件末尾追加两条**（软惩罚与"第三次同歌手只能在末档放行"）：

```ts
test('a song whose artist appeared 11 slots back gets a soft penalty, not a hard block', () => {
  const history = [
    mkFinalItem('h0', 'Same', 'B'),
    ...Array.from({ length: 11 }, (_, i) => mkFinalItem(`h${i + 1}`, `Other-${i}`, 'B')),
  ]
  const stale = mkFinalItem('c-stale', 'Same', 'A')
  const fresh = mkFinalItem('c-fresh', 'Fresh', 'A')
  const plan = { quotas: { A: 1, B: 0, C: 0, D: 0 }, total: 1, reasons: {} } as any
  const result = selectFinalQueue([stale, fresh], {
    target: 1,
    channelPlan: plan,
    recent: history,
    temperature: 0.01,
    rng: () => 0.5,
  })
  // 隔 11 首（history 长 12、同歌手在 index 0）：满足 artistGap 8 的硬门槛，但落在 12 首软惩罚窗口里
  // 低温度下抽样几乎取 argmax（stale 权重 0.6 vs fresh 1.0），应当选 Fresh
  assert.equal(result.items[0].item.key, 'c-fresh')
  assert.equal(result.maxRelaxLevel, 0, '软惩罚不该把 stale 挤到放开档才出场')
})

test('a third song from the same artist inside 30 slots waits for the last rung', () => {
  const history = [
    mkFinalItem('h0', 'Same', 'B'),
    mkFinalItem('h1', 'Same', 'B'),
    ...Array.from({ length: 10 }, (_, i) => mkFinalItem(`h${i + 2}`, `Other-${i}`, 'B')),
  ]
  // 两首同歌手在 index 0、1：距末尾 11 与 10 首，都过了 artistGap 8 的间隔关，只差"30 首内出现次数"
  const again = mkFinalItem('c-again', 'Same', 'A')
  const plan = { quotas: { A: 1, B: 0, C: 0, D: 0 }, total: 1, reasons: {} } as any
  const result = selectFinalQueue([again], { target: 1, channelPlan: plan, recent: history, rng: () => 0.5 })
  assert.equal(result.items.length, 1)
  assert.equal(result.maxRelaxLevel, 4, 'sameArtistInLast30 收紧到 2 之后，第三次同歌手只能靠最后一档放行')
})
```

**其四：把 `tests/recommend-diversity-lang.mts:138-160` 那条用例的 recent 几何重排。** 它用"recent 两首与候选同歌手"把阶梯从第 0 档一路卡到第 4 档，借此证明"升级原因是歌手间隔、不是语种配额"。Step 3 把末档从 0 抬到 2 之后，那两首同歌手正好落在末档的窗口里，第 4 档也卡住 → 队列一首都出不来（预检实测 `maxRelaxLevel` 4→0、`items.length` 1→0）。改法是把同歌手挪到**倒数第 3 首**，末尾两首换成别的歌手：第 0~3 档（间隔 8/8/6/4）照样全卡，第 4 档（间隔 2）窗口只盖住末尾两首、放行，用例想证的"升级只来自间隔"一个字没变。

```ts
  // 同歌手挪到倒数第 3 首：第 0~3 档（间隔 8/8/6/4）全被它卡住，第 4 档（间隔 minArtistGap=2）
  // 的窗口只盖末尾两首，于是升级原因仍然是歌手间隔，而不是语种配额
  const recent = [asChorus(900, 'zh'), mkItem(901, 'unknown'), mkItem(902, 'en')]
```

三条断言（`maxRelaxLevel == 4`、`items.length == 1`、不含 `lang_quota_relaxed`）一个字不改。这条用例改完**在 Step 3 前后都是绿的**（挪几何之前老几何也只在末档归零时才行得通，挪之后新末档也走得通），它不是行为证明而是"让 suite 扛得住 Step 3"的适配——把它算进 RED 列表会看错账。

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-algorithm.mts`
Expected: FAIL **四条**，实测数字如下（预检已跑过一遍，对不上就是改错了地方）：
- 其一（`:2029` 那条里的新断言）：`antiRepeat.minArtistGap` 还不存在，`undefined >= 1` 为 false。
- 其二（改写后的单歌手池用例）：`actual: 5, expected: 1` —— 末档归零把队列凑满了。
- 其三第一条：选到 `c-stale` 而不是 `c-fresh`（没有软惩罚，两个候选权重都是 1，rng 固定时按池内顺序取前者）。
- 其三第二条：`maxRelaxLevel` 是 `0` 而不是 `4`（`sameArtistInLast30` 还是 3，第 0 档就放行了）。

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-diversity-lang.mts`
Expected: **全绿**。其四 只是把 recent 的几何挪到末档窗口之外，Step 3 前后都该绿；它现在就是红的，说明 `mkItem(901, 'unknown')` 那两首没替换到位（末档窗口里还留着同歌手）。

上面那个 `4` 是最后一档的下标：`getRelaxConfigs()`（`diversity.ts:90-145`）返回**五个硬写字面量**，下标 0~4。别把它写成 `relaxArtistGaps.length + 1` 之类从配置反推的算式——档位数量和 `relaxArtistGaps` 的长度没有对应关系（那个数组只有 3 个元素：`[0]` 没被任何档位用到，`[1]` 是下标 2 档，`[2]` 同时是下标 3、4 两档的取值），数值巧合会误导下一个人。同理不要为了"消除重复"把 `getRelaxConfigs` 改成循环生成，五档各自的取值差异是有意的。已复现的另一条事实：下标 0~3 的 `sameArtistInLast30` 全都读 `c.sameArtistInLast30`，只有下标 4 读 `c.relaxSameArtistInLast30`——第三条用例断言的 `maxRelaxLevel == 4` 靠的就是这个不对称。

- [ ] **Step 2: 收紧 `antiRepeat` 并加软惩罚窗口配置**

Modify `src/core/recommend/config.ts` 的 `antiRepeat`（242–262 行）。`sameArtistInLast30`（`:244`）由 3 改 2，并在 `relaxArtistGaps` 之后追加 5 个键：

```ts
  antiRepeat: {
    artistGap: 8,
    sameArtistInLast30: 2,
```

```ts
    /** 候选不足时按顺序放宽歌手间隔；下限 4 首——同歌手至少隔 4 首，最后一档兜底才归零。 */
    relaxArtistGaps: [8, 6, 4],
    /** 最后一档（所有候选都满足不了间隔时）也保持的最小间隔；0 会直接造成同歌手连推。 */
    minArtistGap: 2,
    /** 抽样软惩罚：同歌手出现在最近 N 首内时权重乘该系数（硬门槛之外的第二道闸）。 */
    recentArtistWindow: 6,
    recentArtistFactor: 0.35,
    midArtistWindow: 12,
    midArtistFactor: 0.6,
```

`relaxSameArtistInLast30: 6`（`:258`）保持不动——最后一档仍允许"30 首内已出现 2 次"的同歌手出场，Step 1 第三条用例钉的就是这个放行发生在 relaxLevel 4 而不是 0。

改完把 `relaxArtistGaps` 上面那条注释（`:256`）里"最后一档兜底才归零"删掉，改说"最后一档由 `minArtistGap` 兜住"——注释留着归零的说法会误导下一个人。

- [ ] **Step 3: 最后一档不再把间隔归零**

Modify `src/core/recommend/diversity.ts` 的 220–222 行（220 取档位、221 是旧注释、222 归零赋值），整段替换：

```ts
  const relaxConfigs = getRelaxConfigs()
  // 最后一档也保持 minArtistGap，不再归零：同歌手连推是用户明确投诉过的观感问题，
  // 候选枯竭时让它少出几首并记 no_candidate_after_relaxation（下面 fallback 分支的既有 reason），也不要连推
  relaxConfigs[relaxConfigs.length - 1].artistGap = recommendationConfig.antiRepeat.minArtistGap
```

`getRelaxConfigs()` 里 `:134` 那条注释（"最后一档：…才允许放宽到 0，避免候选枯竭时电台断粮"）说的是同一个事实，改完也失真了，一并把"放宽到 0"换成"降到 `minArtistGap`"。

不动 `checkItemConstraints`（169–209 行）本体——它按 `relax.artistGap` 判断，档位值改了自然生效。

- [ ] **Step 4: `weightFor` 加同歌手软惩罚**

Modify `src/core/recommend/diversity.ts`：在 `weightFor`（260 行）之前插一个局部判定，放在 `selectFinalQueue` 函数体内（要用到闭包里的 `history`），位置就在 `explorationBlocked` 与 `weightFor` 之间：

```ts
  // 硬门槛（artistGap）之外的第二道闸：满足了最小间隔但仍离得很近的同一歌手，权重打折。
  // 只降权重不排除，避免"整池都是同一歌手"时被降频把唯一候选也打死。
  const recentArtistPenalty = (item: T) => {
    if (!item.artistKeys.length) return 1
    const sharesArtist = (entry: FinalQueueItem) => entry.artistKeys.some(artist => item.artistKeys.includes(artist))
    const c = recommendationConfig.antiRepeat
    if (countInLast(history, c.recentArtistWindow, sharesArtist) > 0) return c.recentArtistFactor
    if (countInLast(history, c.midArtistWindow, sharesArtist) > 0) return c.midArtistFactor
    return 1
  }
```

再把 `weightFor` 的返回行（267 行）改成三项惩罚相乘：

```ts
    return Math.max(recommendationConfig.softmax.minWeight, base * exposurePenalty * variantPenalty * recentArtistPenalty(item))
```

**为什么放在 `weightFor` 而不是 `checkItemConstraints`**：`applyQualityGate`（273 行）比的是 `qualityWeightOf`＝`item.channelWeights[channel] ?? item.weight`，即不含任何软惩罚的基础分。惩罚加进 `weightFor` 只会让它排后面，不会被质量门槛放大成硬排除；加进 `checkItemConstraints` 就变成硬闸，池子窄时直接断粮。

- [ ] **Step 5: 画像歌手直采减量**

Modify `src/core/recommend/candidate.ts`：

1. `createArtistHitCandidates` 的 affinity 下限（`:172`）：

```ts
  const affinity = Math.max(0.6, Math.min(1, top?.weight ?? 0))
```

2. 搜索条数（`:585`）：

```ts
        const tracks = await searchMusic(source, artistEntry.artist, 1, 8, { signal: params.signal })
```

3. `:571` 那条注释同步改掉"每轮只采 2 人"的说法：

```ts
  // 5.5 画像歌手热门歌直采：rotation 在强歌手列表上滑动，每轮只采 1 人 8 首，
  // 避免单轮就往池里灌一批同歌手候选（配 diversity 的软惩罚一起治连推）
```

`artistHitsPerRefresh` 的数值改动在 `config.ts:213`（Step 2 未列，见下），`candidate.ts` 只读配置、除上面三处外不用动：`picked` 的取数逻辑（`:579` `Math.min(artistHitsPerRefresh, strongArtists.length)`）与 rotation 起点（`:578`）天然跟着配置走。

Modify `src/core/recommend/config.ts:212-213`：

```ts
    /** 每轮直采的画像强歌手数（各搜一次热门歌，轮换不同歌手）。曾经取 2 人×15 首，单轮 30 首同批候选把池子带偏。 */
    artistHitsPerRefresh: 1,
```

- [ ] **Step 6: 跑到通过 + 闸门**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-algorithm.mts`
Expected: 全绿，0 fail。特别确认 `artist relaxation never dips below the four-song floor before the last rung`（2029 行起）仍绿：它的候选里有 20 首不同歌手的备选，走不到最后一档，`minArtistGap` 改动不该影响它——真影响到了说明 `relaxArtistGaps` 被误改。

Run: `npm test`
Expected: 全绿，`ℹ pass 364` / `ℹ fail 0`（开工基线 361/0；本 Task 在 `tests/recommend-algorithm.mts` 末尾净增 3 条用例，其余都是"改写既有用例"，条数不变。第三条是评审之后补的：把软惩罚两档（6 首 0.35 / 12 首 0.6）的档位差钉住——两个候选同时卡在 `sameArtistInLast30`、基础分都过质量闸门时，档位差是唯一决定因素，实测 `recentArtistFactor→0.6`、`recentArtistWindow→4`、`→12` 三种改法都会让它变红）。`radio.ts` 不调 `getRelaxConfigs`（已复现：全仓库只有 `diversity.ts:220` 一处调用），所以电台队列会跟着吃 `minArtistGap` 与软惩罚——这是有意的，连推在电台里同样刺眼；若 `radio-temp-queue-order.mts` 因档位值变化而红，按"只断言顺序不断言具体间隔"的方向改断言。

Run: `npx eslint src/core/recommend/config.ts src/core/recommend/diversity.ts src/core/recommend/candidate.ts`
Expected: 0 error。

Run: `npx tsc --noEmit 2>&1 | grep -E "recommend/(diversity|candidate|config)" || echo "no new errors"`
Expected: `no new errors`。

Run: `npx tsc --noEmit 2>&1 | grep -cE "error TS"`
Expected: **137**（既有基线，一字不多）。上面那条 grep 的路径带斜杠，只盖 `src/`，`tests/recommend-*.mts` 它匹配不到——本 Task 动的是两个测试文件，tsc 照样查它们，所以总数才是唯一口径。`as any` 那两处保持原样，不要为了让总数好看去改既有用例的类型。

Run: `grep -n "artistHitsPerRefresh: 1\|sameArtistInLast30: 2\|minArtistGap: 2" src/core/recommend/config.ts && grep -n "searchMusic(source, artistEntry.artist, 1, 8" src/core/recommend/candidate.ts && grep -nF "Math.max(0.5, Math.min(1, top?.weight ?? 0))" src/core/recommend/candidate.ts && grep -n "artistGap = recommendationConfig.antiRepeat.minArtistGap" src/core/recommend/diversity.ts`
Expected: 四条 grep 全部命中（`candidate.ts` 那两处不在单测可载范围，只能这样钉）。
第三条钉的是 **0.5**：spec §3.5 原文写"affinity 门槛 0.5 → 0.6"，本 Task 起初照字面把它抬到 0.6，全分支评审指出那行是**下限**不是闸门——`computeFinalScore = affinity + coOccurrence + exploration - exposureCount * 0.1`，抬高下限只会让直采曲更容易活过 `qualityGateRatio = 0.6` 的相对质量门槛，即反向助攻"熟歌手占领 A 池"。已退回 0.5（commit f58a6aa），供给侧的杠杆是"每轮 1 人 8 首"那两处。**别把它再改回 0.6。**

Run: `grep -n "targetPerWindow: { A:" src/core/recommend/config.ts`
Expected: 仍显示 `A: 9`。本 Task 不动它（P3 才砍到 7），这一条是防止执行者"顺手把 spec §3.5 全做了"。

- [ ] **Step 7: 提交**

```bash
git add src/core/recommend/config.ts src/core/recommend/diversity.ts src/core/recommend/candidate.ts tests/recommend-algorithm.mts tests/recommend-diversity-lang.mts
git commit -m "feat(recommend): 治连推——歌手直采减量、抽样软惩罚、末档不再把间隔归零"
```

---

### Task 10: 让"0%"真的说话——0% 与"没滑过"分成两种状态

对应 spec §3.3（50% 中轴）与 §3.2（硬配额）。来源是最终全分支评审的 Important-2：
问卷以 50% 为中轴之后，`sanitizeWeights` 的 `if (percent > 0)` 把**刻度最下端那一个值**和"没填"合并成同一个状态，
于是"中文 0%"得到的抑制比"中文 10%"更少（10% 会给华语播种负权并占一格配额，0% 直接消失）。
同一处 `!percent` 的写法在 `computeSeedWeights` 又出现一次，配额侧 `allocateByPercents` 的 `> 0` 筛选则是第三处。

**契约（三处 UI + 两处纯函数按同一条走）**
- **0% = 明确不要；50% = 没意见；键缺席 = 没意见。** `sanitizeWeights` 保留 0、**丢弃 50**。
  为什么把 50 也丢：50 的播种分量本就是 0，留着它只会让它冒充一条有效配额声明（`{western: 50}` 会被读成"欧美占窗口一半"），
  而用户以为自己在表达中立。丢掉 50 之后，"把滑条放回中间"就是天然的"恢复未填"手势，**不需要新造重置按钮**。
  代价（写进注释，别当 bug 修）：想表达"恰好一半"只能滑 40 或 60；配额本身 ±1 容差、窗口 20 首，粗一格无伤。
- 0% 桶进 `targets`（值 0），因而进 `caps`（值 0）；**容差不作用于 0 目标**（`target - used + tolerance` 在 target=0 时会白送 1 首）。
- `enforced` 的判据从"百分比合计 > 0"改成"**声明过的语言桶集合非空**"，否则全 0 提交会被当成从没打开过问卷。

**Files:**
- Modify: `src/core/recommend/onboarding.ts:51-61`（`sanitizeWeights`）、`:78-92`（`computeSeedWeights:82 if (!percent) continue`）、`:68`（`NEUTRAL_PERCENT` 改成 export 并挪到使用点之前）
- Modify: `src/core/recommend/languageQuota.ts:38-57`（`allocateByPercents` 让 0 桶进表、余数只在正桶里轮）、`:59-78`（`computeLangTargets` 的 `enforced`）、`:98-111`（`computeLangCaps` 的容差）
- Modify: `src/core/recommend/index.ts:580-584`（`langUnmet` 跳过目标 0 的桶——它不是"兑现不了"，是用户明确不要）
- Modify: `src/screens/Home/Views/Recommend/PreferenceSliders.tsx:52`（`?? 0` → `?? NEUTRAL_PERCENT`）
- Modify: `src/screens/Home/Views/Recommend/Onboarding.tsx:27`（`hasSelection` 改看键是否存在，否则只滑到 0% 的人提交按钮是灰的）
- Modify: `src/screens/Home/Views/Setting/settings/Recommend/index.tsx:29-30`（`else delete next[id]` 去掉——设置页是回头改配额的地方，这里偷偷 delete 会把引擎侧修复整个抹平）
- Modify: `tests/recommend-onboarding.mts`（改写 `:14` 那条 "removes zeros"）、`tests/recommend-language-quota.mts`（+2 条）

**Interfaces:**
- Consumes: Task 8 的 `seedValueFor`（`NEUTRAL_PERCENT`/`NEGATIVE_SEED_RATIO`）、Task 4 的 `computeLangTargets`/`computeLangCaps`、Task 5 的 `langWithinCap`。
- Produces: `export const NEUTRAL_PERCENT: number`（`50`）；`LangTargets.targets` 里可以出现值为 `0` 的桶；`LangCaps.caps` 里可以出现值为 `0` 的桶。
  下游 `diversity.ts` 的 `langCaps` 判定已经按 `cap > 0` 放行/拦截，无需改动；`computePoolBucketLimits` 与 `planLangBucketFetch` 对 target 0 自然算出"不缺货"，也不要改。

- [ ] **Step 1: 写四条会红的用例**（先 RED，实测值进报告）

```ts
// tests/recommend-onboarding.mts —— 改写既有的 `:14`，不要新增重复条目
test('sanitizeWeights keeps 0 but drops the neutral point', () => {
  const out = sanitizeWeights({ zh: 50, bogus: 80, pop: 105, rock: -20, folk: 35, jazz: 0 })
  assert.equal(out.jazz, 0, '0% 是有效声明')
  assert.equal('zh' in out, false, '停在 50 = 没表态')
  assert.equal(out.pop, 100)
  assert.equal(out.folk, 40, '取整到 10 的行为不许变')
  assert.equal(out.rock, 0, '-20 钳到 0 之后同样是一条明确声明')
  assert.equal('bogus' in out, false)
})

test('0% seeds the strongest negative, exactly absent seeds nothing', () => {
  const zero = computeSeedWeights({ zh: 0 })
  const ten = computeSeedWeights({ zh: 10 })
  for (const key of ['华语', '国语', '中文', '内地']) {
    assert.ok(zero[key] < 0)
    assert.ok(Math.abs(zero[key]) > Math.abs(ten[key]), '0% 必须比 10% 更狠')
  }
  assert.deepEqual(computeSeedWeights({}), {})
  assert.deepEqual(computeSeedWeights({ zh: 50 }), {})
})
```

```ts
// tests/recommend-language-quota.mts
test('a declared 0% bucket enters targets with value 0 and never eats a remainder slot', () => {
  assert.deepEqual(computeLangTargets({ zh: 0 }, 20), { targets: { zh: 0 }, free: 20, enforced: true })
  const both = computeLangTargets({ zh: 0, western: 100 }, 20)
  assert.equal(both.targets.zh, 0)
  assert.equal(both.targets.en, 20)
  assert.equal(both.free, 0)
})

test('the ±1 tolerance does not renegotiate a 0% quota', () => {
  const caps = computeLangCaps({ targets: { zh: 0, en: 1 }, free: 18, enforced: true }, {})
  assert.equal(caps.caps.zh, 0, '0% 是明确不要，容差加上去等于替用户改口')
  assert.equal(langWithinCap('zh', caps), false)
  assert.equal(caps.caps.en, 2, '非零目标照旧 1 目标 + 1 容差')
})
```

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/recommend-onboarding.mts tests/recommend-language-quota.mts`
Expected: 4 条全红。三条在 `{}`（0 被丢掉），`hasSelection` 那条不在单测可载范围、本 Step 不预望它红。
既有 `:23/:28/:29/:35/:40` 那五条 `free` 断言**必须保持绿**（`{}` 与 `{pop: 80}` 仍是 `enforced: false`，`{zh: 10}` 在 window 10 下仍是 `free: 9`）——
它们红了就是 `enforced` 判据改错了方向。

- [ ] **Step 2: 引擎侧（onboarding.ts + languageQuota.ts + index.ts）**

`sanitizeWeights` 的两行改成：

```ts
    if (percent == NEUTRAL_PERCENT) continue
    result[option.id] = percent
```

`computeSeedWeights` 的 `if (!percent) continue` 改成 `if (percent == null) continue`（`!percent` 把 0 和 50 一起跳过，50 对、0 错）。
`allocateByPercents` 先给每个**声明过的**桶写 `result[bucket] = 0`，再用其中 `percent > 0` 的桶做最大余数分配，
`remainders` 只收正桶（`sum <= 0` 时 `remainders.length === 0`，`% 0` 会 NaN——别依赖运气，显式排除）。
`computeLangTargets` 的 `enforced` 判据换成"声明桶集合非空"，`sum` 只对声明桶求和。
`computeLangCaps` 用 `target === 0 ? 0 : Math.max(0, target - used) + Math.max(0, Math.floor(tolerance))`。
`index.ts` 的 `langUnmet` 链式 filter 里加一道 `(langTargets.targets[bucket as LangBucket] ?? 0) > 0`，
并把紧邻注释补一句"（目标 0 首的桶不算：它不是兑现不了，是用户明确不要）"。

- [ ] **Step 3: 三处 UI**

按 Files 段落的六处逐条改。`PreferenceSliders.tsx:7` 已经在 import `@/core/recommend/onboarding`，
把 `NEUTRAL_PERCENT` 并进同一条 import，不要再写第二个字面量 50。

- [ ] **Step 4: 跑到通过 + 闸门**

Run: `npm test`
Expected: 全绿，`ℹ pass 368` / `ℹ fail 0`（开工基线 365；本 Task 在 `recommend-onboarding.mts` +1 条、`recommend-language-quota.mts` +2 条，改写既有 1 条不计数。
**落地实测 368**，上面原本写 367 是算错了一条）。评审之后控制者又补了第 4 条（存量 `{zh: 50}` 不能再冒充配额声明，
修在 `computeLangTargets` 读侧，见 Task 11 Item 0），所以 `recommend-language-quota.mts` 现在是 +3 条。

Run: `npx tsc --noEmit 2>&1 | grep -cE "error TS"`
Expected: **137**。`as any` 与既有类型洞保持原样，不要为了让总数好看去动既有用例。

Run（**模式里有括号，必须 `grep -F` 按字面查**）:
`grep -nF "if (percent > 0)" src/core/recommend/onboarding.ts src/screens/Home/Views/Setting/settings/Recommend/index.tsx`
Expected: **0 命中**（这两处就是缺陷本体）。
`grep -nF "if (percent == null) continue" src/core/recommend/onboarding.ts && grep -n "export const NEUTRAL_PERCENT" src/core/recommend/onboarding.ts && grep -nF "target === 0 ? 0" src/core/recommend/languageQuota.ts && grep -nF "Object.keys(weights).length > 0" src/screens/Home/Views/Recommend/Onboarding.tsx`
Expected: 四条全命中。

Run: `npm run build-test`
Expected: exit 0。UI 三个文件与 `index.ts` 都载不进 node --test，这条是它们唯一的接线证明；
bundle 路径只认命令自己打印的那个，中文串在包里以 UTF-16LE 存在（见 [[project-release-build-hygiene]]），别拿中文 grep 当闸门。

- [ ] **Step 5: 提交**

```bash
git add src/core/recommend/onboarding.ts src/core/recommend/languageQuota.ts src/core/recommend/index.ts src/screens/Home/Views/Recommend/PreferenceSliders.tsx src/screens/Home/Views/Recommend/Onboarding.tsx src/screens/Home/Views/Setting/settings/Recommend/index.tsx tests/recommend-onboarding.mts tests/recommend-language-quota.mts
git commit -m "feat(recommend): 问卷 0% 与未填分成两种状态，配额与播种都认 0%"
```

---

### Task 11: 计划外收口——中性 50% 的读侧、磁盘脏条目的写侧、阶梯注释的真实化

**这不是原计划里的第 11 个 Task。** 它来自 Task 10 的任务评审（Important I-1）、最终全分支评审的两条遗留
（I2 的写侧对偶、I4 复评的 Minor 3），以及我自己对计划正文一处自相矛盾的调整。三段成交：
`f1e2565`（控制者）、`dd3d677`（子代理，按 `task-11-brief.md`）、`63db335`（控制者）。

- **Item 0（I-1，`f1e2565`）**：`computeLangTargets` 自己挡住中性点——`if (raw == NEUTRAL_PERCENT) continue`。
  为什么修在读侧不修在迁移：`stateSchema.ts` 的 v8→v9 重播**原样搬运** `onboarding.weights`，Task 8/9 的
  `sanitizeWeights` 会把 `{zh: 50}` 写进盘；只在迁移里 sanitize 治一次历史，读侧挡住才对所有写入方永久有效，
  而且 `languageQuota.ts` 是 `node --test` 可载的纯模块，能当场钉住（实测先 RED：`{targets:{zh:10},free:10,enforced:true}`）。
- **Item 1（写侧脏条目，`dd3d677`）**：`updateArtistLangTable` 循环体开头就地归一 `prev.hits`/`prev.strength`
  （`Number.isFinite` 不合格就补 0）。缺陷本体：缺 `strength` 让上下两次比较同时 NaN-false，永远落在"同强度"分支、
  两个出口都只 `{...prev}` 铺开，连一次 `field`（强度 2）观测都救不回来；缺 `hits` 把 NaN 一路写下去（存盘成 `null`），
  淘汰排序又把 NaN 当"跟谁都相等"。就地改条目而不是引局部变量，是为了让比较、写回**和文件末尾的淘汰 comparator**
  同时看到干净数字。对照组：缺 `bucket` 的条目**能自愈**（`08cd2ee` 的读侧形状校验已挡在 L3 之前）。
- **Item 2（阶梯，`dd3d677`）**：末档 `artistGap: c.minArtistGap` 直读，删掉 `selectFinalQueue` 里
  `relaxConfigs[len-1].artistGap = ...` 的事后覆写。**计划正文这里本来是矛盾的**：一边要求"阶梯直读 `c.minArtistGap`"，
  一边要求"保留 `:223` 的覆写"——覆写会变成 no-op。裁定：删覆写，保证挪到 Item 4 的配置不等式护栏。
  逐值等价（`minArtistGap` 就是 2，原来覆写完也是 2），证明是 `tests/recommend-diversity-lang.mts` 那条
  "第 0~3 档被间隔卡住、第 4 档按 `minArtistGap=2` 放行"的用例继续绿。副产物：`relaxArtistGaps[0]`（值 8）
  **根本没有档位引用**——不改索引（改了会变动真实行为，超出 P1），只在注释里写明。
- **Item 3/4（注释与护栏，`dd3d677` + `63db335`）**：`config.ts` 的 `relaxArtistGaps`/`minArtistGap` 注释改成
  只说真接了线的东西（哪一位喂哪一档、末档直读、护栏钉在哪条用例），并把"至少隔 4 首"限定成"档位 0~3"
  ——末档可以松到 2，原话在末档直读之后就不成立了；`tests/recommend-algorithm.mts` 的单调性护栏补第二条
  `sameArtistInLast30 <= relaxSameArtistInLast30`（末档是唯一允许放松 30 首窗口同歌手计数的档位，
  反向就是越放宽越严，而这条关系此前没有任何测试钉着）；`computePreferenceKeywords` 同样跳过中性 50
  （实测 RED：`{zh: 50}` 返回 `['华语']`）——中性点是"没意见"，不能进选榜定向的关键词池。

Run: `npm test` / `npx tsc --noEmit 2>&1 | grep -cE "error TS"` / `npx eslint src/core/recommend/{language,diversity,config,onboarding,languageQuota}.ts`
Expected（控制者实测）：`ℹ tests 371 / ℹ pass 371 / ℹ fail 0`、**137**、exit 0。
复评（`re-review-f1e2565-dd3d677.md`，含 `f1e2565`）：通过，Critical 0 / Important 0 / Minor 3。

**明确留下不修的**（写在这里免得下次又被当新发现）：没被再次观测的磁盘脏条目仍会带着 `undefined` 进淘汰 comparator
（表容量 500、读侧 `08cd2ee` 已挡住查找，所以是排序层面的公平问题而不是正确性问题）。根治点在
`artistLanguageStore` 读盘时整表清洗，属 P2/P3。

---

## 整体验收

P1 全部 11 个 Task（10 个计划内 + Task 11 计划外收口）落地后，按顺序过这四道：

1. **静态闸门全绿**：`npm test`（0 fail，条数只增不减）、`npx tsc --noEmit` 对本次涉及的 18 个 src 路径零新增错误（`src/utils/musicSdk/**` 那 3 个是 `.js`，tsc 不覆盖，实际核 15 个；src 有既有基线，只要求本次路径不新增，见 [[project-verification-gates]]）、`npx eslint` 对本次改动文件 0 error。
2. ** bundle 里确实带了新逻辑**：`npm run build-test` 之后 `grep -c "computeLangCaps\|xunyin_recommend_artist_lang_v1\|lang_bucket:" index.android.bundle` 期望三项都 ≥1；`grep -c "oldMusicInfo.lang" index.android.bundle` ≥1（Task 2 的白名单搬运）。中文串在包里只以 UTF-16LE 存在，`grep` 中文特征串是查不到的，别拿它当闸门（见 [[project-release-build-hygiene]]）。
3. **真机口径**（用户习惯全部在真机做，见 [[user-behavior-b43dd755]]）：问卷把"中文"滑到 10%、"欧美"滑到 100% → 提交 → 连刷 3 轮 20 首队列，数语种分布；期望华语 2±1 首/20 首，欧美占比明显上升，**不出现连续 3 首中文**、**不出现同歌手连推**。再把"中文"改到 **0%** 复测一轮（Task 10 的验收就在这一步）：日志里 `langCaps` 的 `zh` 必须是 `0`，队列 20 首里中文至多 1 首且**不出现整轮空队列**——空队列说明配额和窄池叠上了，看 `pool.byLang` 分清是"池里只剩中文"还是"判不出语种"。再对比"老池子"与"新池子"两种起点：清池最省事的做法是系统设置里清除应用数据后重走问卷；若要保留画像只清候选与语言表，代码侧是 `clearCandidateCache()`（`candidateStore.ts:50`）加 Task 2 的 `clearArtistLangTable()`，两者都没有 UI 入口，得临时挂个调试调用。清池后第一轮会走冷启补货，队列短是预期现象，看第二轮。
4. **诊断可答**：一轮召回日志里要能读到 `langCaps`、`langUnmet`、`langLevels`（L1~L4 命中占比）、`pool.byLang`。配额没兑现时用 `langUnmet` 与 `langLevels` 区分"没货"还是"判不出"——这是验收和后续调参唯一的抓手，缺了就只能靠观感猜。

## 已知风险与边界（不藏）

1. **放开档会兑现不了配额，这是设计而不是 bug**。`getRelaxConfigs()` 第 3~4 档 `langQuotaEnforced = false`（Task 5）：池里只剩超配额语种时，为了不断粮照样出歌，并埋 `lang_quota_relaxed` 线索。**名额不会在下轮回补**——回补要跨轮记账，而候选池和窗口都在滚动变化，回补算出来的数没有可信的分母。验收时看到 20 首里 3~4 首中文（±1 容差之外一首）就是这个口子，属可接受。
2. **空歌单靠跨轮 rotation 替补，不是当轮换一张**。`tx` 的分类歌单里有 `songlist` 为空的坑（spec §2.3 实测）。Task 6 的处理是"当轮标记 `lang_bucket_empty:<bucket>` 并跳过，下一轮 rotation 前移到下一张"，所以某个桶可能要等 2~3 轮才补到货。做不出当轮重试：详情额度一轮只有 4 格，重试会把 A/B 通道饿死。
3. **kg/tx 的语种标签 id 会随官方改版失效**。`LANG_BUCKET_TAGS`（Task 6）是硬编码的数字 id，已用 `knownTagIds` 防呆（目录里没有的 id 直接跳过，不报错、不空跑），但**失效后那个桶静默无货**，只能从 `langUnmet` 看出来。这是无后端的代价：没有一份能远程下发的映射表。
4. **L4 猜语种依赖"汉字歌名基本是中文歌"这个前提**。`bucketFromScript`（Task 1）看到 CJK 就猜 zh，日/韩歌名里夹汉字时会误判——所以 L4 的权重低于 L1/L2/L3，且 `instr` 与 `en` 不由 L4 判定（纯拉丁串返回 `null` 而不是猜 en）。歌手语言表（L3）首装是空的，此时 L3 整级跳过，前几轮的推导主要靠 L1 与 L4。
5. **derive-on-read 每轮重推，不写盘**。Task 7 的 `resolvePoolLang` 在使用点现算，所以 `xunyin_recommend_candidates_v2` 这个**没有版本戳、每次整体 JSON 重写**的键不会被推导结果污染。代价是每轮一次字符统计（1500 条上限，实测可忽略），换来的是"一次误写就把整池重排落盘"的风险归零。
6. **`STATE_VERSION` 8→9 的重播种会静默改动老用户的 `themeWeights`**。迁移用记录在案的 `seededThemeWeights` 精确退旧账再播新账（Task 8 Step 4），学出来的 tracks/playlists/session 一律不动；但如果用户在 v8 期间手动改过同名分类的权重，退掉的分量仍按当年记录扣除——这是"精确回退"的必然取舍，也是 `seededThemeWeights` 一直存在的理由。回退只能整体恢复：把 `STATE_VERSION` 改回 8 并删掉迁移块，用户的 `themeWeights` 已被改写、无法只靠版本号还原，所以真机验收前先在测试机装，不要直接推到用户渠道（发版链路见 [[project-update-delivery]]）。
7. **`sameArtistInLast30` 3→2 会让窄池更容易走到放开档**。`maxRelaxLevel` 上升是预期信号，不要当故障修；`radio.ts` 不读 `getRelaxConfigs()`（已复现，全仓库仅 `diversity.ts:220` 一处调用），所以电台与推荐队列会一起吃到这些新约束。
8. **"整池只剩一个歌手"时队列只剩 1 首，这是换来的代价不是 bug**。末档间隔下限（`minArtistGap: 2`）和"单歌手池照样凑满 target"两件事数学上互斥——任何非零下限都会让同歌手第二首永远落在窗口里（预检实测：target 5 只出 1 首）。裁定取下限，因为同歌手连推是用户点名投诉的观感问题，而这种池形只在召回大幅失败的降级态出现（正常池子来自分类歌单/相似歌单，多歌手）。真机验收如果看到"队列明显凑不满"，先看日志里的 `no_candidate_after_relaxation`：有它就是池子窄，该修的是供给侧补货，不是把这个下限改回 0。要回退也只能整体回退——把 `minArtistGap` 设 0 即可恢复旧行为，但那两条被改写的既有用例（`recommend-algorithm.mts` 的单歌手池、`recommend-diversity-lang.mts` 的分档几何）必须一起还原，否则绿灯会盖住真实的连推。
9. **Task 10 之后"停在 50%"不再是一种存储状态**。`sanitizeWeights` 丢弃 50，所以想表达"这个语种占窗口一半"必须滑 40 或 60；换来的是"把滑条放回中间"= 恢复未表态，不必再造重置按钮。另一条：把某语种从 100% 改到 0% **不当轮全见效**——选择侧的 `caps` 当场变 0，但池内限额要等 24h 候选淘汰（Task 6 实测的 `candidateStore.ts:123` 分支）才收干。真机验收看到"改了还推中文"，先读日志 `langCaps`：它当场就该是 0，池子里暂时还有货是正常的。

