# 播放页"动态背景"（封面莫奈取色）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全屏播放页背景跟随当前歌曲封面的莫奈（Material You / HCT 色调）配色，前景字色完全不变，并在外观设置里提供"动态背景"开关。

**Architecture:** 三层分工。Android 原生模块只负责"下载封面 → 降采样 → 吐 ARGB 像素数组"；所有色彩数学放在纯 JS（Google 官方 `@material/material-color-utilities`，零依赖、可 node 单测）；渲染层只往背景里加三层 View（铺底色 / 模糊封面 / 同色蒙版），前景沿用 `useTheme()`。取色结果按封面 URL 缓存并做 in-flight 去重。

**Tech Stack:** React Native 0.73.11（old arch, Hermes）、Java（`cn.toside.music.mobile.*` 自研模块）、TypeScript、`node --test --experimental-strip-types` 单测、`@material/material-color-utilities@0.4.0`。

**Spec:** `docs/superpowers/specs/2026-10-14-player-dynamic-background-design.md`（本计划即其落地方案；讨论记录见会话，关键结论已抄进下面的 Global Constraints）

---

## Global Constraints

- **竖屏 only**（AGENTS.md）：不得改 `AndroidManifest.xml` 的 `screenOrientation`、不得改 `src/navigation/index.ts` 的 `layout.orientation`；本次只动 `PlayDetail/Vertical`，`PlayDetail/Horizontal` 一律不碰。
- **不改全局主题**：禁止调用 `themeActions.setTheme` / `applyTheme`，禁止改 `src/theme/themes/utils.js` 的 `createThemeColors`。本功能只影响播放页背景层。
- **前景字色一律沿用 `useTheme()`**，不得由封面色推导 —— 这是"背景与字色混淆"的硬防线。可读性只靠"底色 tone 钳制 + 蒙版不透明度"两件事保证。
- **依赖约束**：只新增 `@material/material-color-utilities@0.4.0`（纯 JS，无原生代码、无子依赖）。不引入渐变库（项目当前无 linear-gradient / skia，见 package.json）。
- **取色包只能按子路径 import**（实测 Ruling P4）：任何 `src/**` 与 `tests/**` 都写 `'@material/material-color-utilities/<dir>/<file>.js'`，**禁止包根 import**。包根 `index.js` 有 33 条 `export *` 且 Metro 不做 tree-shaking，包根 import 实测让 bundle **+479,461 B**，子路径 import 只带实际用到的 5 个入口，实测 **+134,020 B**。为此 `dependencies-patch.js` 必须给该包 `package.json` 的 `exports` 追加 `"./*": "./*"`（发布产物只暴露 `"."`，Node 跑单测时子路径会被 `ERR_PACKAGE_PATH_NOT_EXPORTED` 挡掉）。
- **不得删 `res/`**：仓库在根目录 `res/` 下跟踪了 13 个 Metro 生成的 png（`git ls-files res` 可见），`react-native bundle --assets-dest res` 会重写它们。清理验证产物时只 `rm -f index.android.bundle`；`res/` 若变脏用 `git restore -- res` 还原，**绝不 `rm -rf res`**。
- **平台约束**：iOS 端本仓库无任何自研原生模块（`ios/` 下只有 `LxMusicMobileTests`），因此 iOS 直接返回 `null`，功能自动关闭，不加 `.mm`。
- **失败即回落**：取色失败 / 无封面 / 色度为 0 → 用 `theme['c-content-background']`，与现状像素一致。
- **主题自带背景图优先**：`theme['bg-image'] != null` 时不启用封面取色（用户显式设过背景图）。
- **默认关闭**：`theme.dynamicBg` 默认 `false`，老用户零感知。
- **测试约定**：单测文件放 `tests/*.mts`，用 `import ... from '../src/xxx/yyy.ts'`（**必须带 `.ts` 后缀**），被测源文件**不得** `import 'react-native'`，也不得用 `@/` 别名（node 解析不了）。跑单个文件：`node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/<file>.mts`。
- **被 node 加载的 src 模块，自己内部的相对 import 必须带 `.ts`**：`src/utils/monet/coverPalette.ts` 会 import `sourceColor` / `surface`，无扩展名时 `node --test` 直接 `ERR_MODULE_NOT_FOUND`（实测）；Metro 0.80.12 带扩展名照样解析（探针 bundle 验过），tsc 也不会报 TS5097（`@react-native/typescript-config` 里 `allowImportingTsExtensions: true` 且 `noEmit: true`，实测）。**这条只管会被单测加载的纯逻辑模块** —— 只跑在 RN 里的入口（`src/utils/monet/index.ts`、`useCoverSurface.ts`、`CoverBackdrop`、`DynamicBg.tsx`）沿用仓库惯例：无扩展名 + `@/` 别名，不要顺手全改。
- **提交纪律**：当前分支 `feat/music-recognition-phase1` 工作区有大量无关未提交改动（174 改 + 7 删）。**禁止 `git add -A` / `git add .`**，每次只 add 本计划列出的文件。

## File Structure

**新建（JS，纯逻辑，可单测）**
| 文件 | 唯一职责 |
| --- | --- |
| `src/utils/monet/sourceColor.ts` | ARGB 像素数组 → `{ source, average }`（官方 Monet 取源色：Celebi 量化 128 色 + Score 打分） |
| `src/utils/monet/surface.ts` | `{ source, average, font }` → `{ base, scrimAlpha }`（HCT tone 钳制 + 对比度校验 + 蒙版算法） |
| `src/utils/monet/coverPalette.ts` | 工厂：注入 fetcher，负责缓存 + in-flight 去重（不碰 react-native） |
| `src/utils/monet/index.ts` | 把原生 fetcher 接进工厂，导出 `getCoverSurface`（唯一被 UI 引用的入口） |
| `src/utils/monet/useCoverSurface.ts` | hook：读设置/当前歌曲/主题字色，异步算出背景配色 |
| `src/components/player/CoverBackdrop/index.tsx` | 三层背景 View，供 `PlayDetail/Vertical` 使用 |
| `src/utils/nativeModules/palette.ts` | 原生桥：`getArgbPixels(url, maxSize)` |
| `tests/monet-source-color.mts` | sourceColor 单测 |
| `tests/monet-surface.mts` | surface 单测（含对比度回归） |
| `tests/monet-cover-palette.mts` | 缓存/去重/兜底单测（假 fetcher） |

**新建（Android 原生）**
| 文件 | 职责 |
| --- | --- |
| `android/app/src/main/java/cn/toside/music/mobile/palette/PaletteModule.java` | 下载/读本地封面 → `inSampleSize` 降采样 → `getPixels` → `WritableNativeArray` |
| `android/app/src/main/java/cn/toside/music/mobile/palette/PalettePackage.java` | 注册模块（照 `utils/UtilsPackage.java` 模板） |

**修改**
| 文件 | 改动 |
| --- | --- |
| `package.json` | Task 1 只加 `dependencies`；`test` 脚本追加 3 个 monet 测试放在 Task 8（该行带着别人的未提交 WIP，见 Ruling P7） |
| `android/app/src/main/java/cn/toside/music/mobile/MainApplication.java:20` 后 | import + `packages.add(new PalettePackage())` |
| `src/types/app_setting.d.ts:96` 后 | 新增 `'theme.dynamicBg': boolean` |
| `src/config/defaultSetting.ts:80` 后 | `'theme.dynamicBg': false` |
| `src/lang/zh-cn.json` / `zh-tw.json` / `en-us.json` | 新增 `setting_basic_theme_dynamic_bg` |
| `src/screens/Home/Views/Setting/settings/Theme/DynamicBg.tsx` | 新开关组件（照 `IsFontShadow.tsx` 模板） |
| `src/screens/Home/Views/Setting/settings/Theme/index.tsx:16` 后 | 挂 `<DynamicBg />` |
| `src/screens/PlayDetail/Vertical/index.tsx:78-103` | 外层加 root View + `<CoverBackdrop />` |
| `src/components/player/PlayerOverlay/index.tsx:126-165` | **反编译产物**，只加 3 处最小改动 |

---

## Task 1: 装依赖并验证 Metro / Node 双端能用

背景（全部实测，见 ledger Ruling P4）：`@material/material-color-utilities@0.4.0` 是 ESM（`"type": "module"`），发布产物的 `exports` 只暴露 `"."`；而包根 `index.js` 里有 10 处**无扩展名**相对 import（`scheme/` 9 处、`dynamiccolor/color_spec_2025.js` 1 处），Node 直接 `import('@material/material-color-utilities')` 会抛 `ERR_MODULE_NOT_FOUND` —— Metro 会补扩展名所以打包正常，但单测跑不动。解决方向不是换版本（0.2.4/0.3.0 的 `exports` 同样只暴露 `"."`），而是**给 `exports` 放开子路径 + 全项目按子路径 import**：这样 Node 能跑单测，Metro 也只打进真正用到的文件（包根 import 实测 +479KB，子路径实测 +134KB）。我们需要的子树（`hct/`、`contrast/`、`quantize/`、`score/`、`utils/color_utils.js` 及其闭包）**不含**无扩展名 import，已实测在 Node 直连成功。

另外 `utils/image_utils.js`、`utils/theme_utils.js` 两个文件的函数体内部引用 `document`；按子路径 import 的约定碰不到它们，模块顶层本来也不碰 DOM。

**Files:**
- Modify: `package.json`（dependencies）
- Modify: `dependencies-patch.js`（新增一条 exports 补丁）

**Interfaces:**
- Produces: 可按子路径 import 的 `Hct`（`hct/hct.js`）、`Contrast`（`contrast/contrast.js`）、`QuantizerCelebi`（`quantize/quantizer_celebi.js`）、`Score`（`score/score.js`）、`redFromArgb` / `greenFromArgb` / `blueFromArgb` / `argbFromRgb`（`utils/color_utils.js`）

- [ ] **Step 1: 安装**

```bash
npm i @material/material-color-utilities@0.4.0
```

注意：`postinstall` 会跑 `node dependencies-patch.js`，属正常。

- [ ] **Step 2: 给 exports 放开子路径（写进 dependencies-patch.js，不要手改 node_modules）**

在 `dependencies-patch.js` 的 `const patchs = [` **紧跟其后**插入下面这条（插在数组开头是因为该文件当前有一批**未提交**的音量均衡补丁都在尾部 388 行之后，本任务的改动必须落在完全没被动过的区域，见 Step 3 的暂存方式）：

```js
  // @material/material-color-utilities 的发布产物只暴露包根 exports，而包根 index.js
  // 有 10 处无扩展名相对 import，Node（跑单测）import 包根会 ERR_MODULE_NOT_FOUND。
  // 放开子路径后 src 与 tests 都按子路径 import：Node 能跑单测，Metro 只打进真正
  // 用到的文件（包根 import 会让 bundle +468KB）。负向前瞻保证幂等。
  [
    path.join(rootPath, 'node_modules/@material/material-color-utilities/package.json'),
    /("exports": \{\r?\n    "\.": \{[\s\S]{0,200}?\r?\n    \})(?![\s\S]{0,60}"\.\/\*")/,
    '$1,\n    "./*": "./*"',
  ],
```

跑两遍确认幂等（第二遍不应再插一次）：

```bash
node dependencies-patch.js && node dependencies-patch.js
node -e "console.log(JSON.stringify(require('./node_modules/@material/material-color-utilities/package.json').exports))"
```

Expected: 输出里 `"./*": "./*"` **只出现一次**，形如
`{'.':{types:...,import:...,default:...},'.//*':'.//*'}`。

- [ ] **Step 3: 只提交本任务那一处改动（工作区该文件有无关 WIP，禁止整文件 add）**

`dependencies-patch.js` 当前尾部带着音量均衡的未提交改动，`git add dependencies-patch.js` 会把它一起提交进来。用"只改索引、不动工作树"的方式暂存：

```bash
git show HEAD:dependencies-patch.js > .scratch/dp-head.js
cp .scratch/dp-head.js .scratch/dp-staged.js
# 手工把 Step 2 那 8 行插进 .scratch/dp-staged.js 的 `const patchs = [` 之后（其余内容与 HEAD 完全一致）
diff -u .scratch/dp-head.js .scratch/dp-staged.js \
  | sed -e '1s|.*|--- a/dependencies-patch.js|' -e '2s|.*|+++ b/dependencies-patch.js|' \
  > .scratch/dp.patch
git apply --cached .scratch/dp.patch
git diff --cached --stat          # 必须只有 dependencies-patch.js，且 +8 行左右
git diff --stat dependencies-patch.js   # 工作树相对索引的差 = 音量均衡 WIP，原样保留
```

Expected: `--cached` 里只有本任务那一条补丁；`git diff`（不带 `--cached`）还能看到音量均衡的 37 行未被提交。**若 `git apply --cached` 报 context mismatch**，说明 Step 2 插到了 WIP 邻区，改插到数组开头重试。

- [ ] **Step 4: 验证 Node 侧按子路径拿到真实 API 名（防止后续计划里的符号不存在）**

```bash
node --input-type=module -e "
const { Hct } = await import('@material/material-color-utilities/hct/hct.js')
const { Contrast } = await import('@material/material-color-utilities/contrast/contrast.js')
const { QuantizerCelebi } = await import('@material/material-color-utilities/quantize/quantizer_celebi.js')
const { Score } = await import('@material/material-color-utilities/score/score.js')
const cu = await import('@material/material-color-utilities/utils/color_utils.js')
console.log([Hct, Contrast, QuantizerCelebi, Score, cu.redFromArgb, cu.greenFromArgb, cu.blueFromArgb, cu.argbFromRgb].map(t => typeof t).join(','))
const src = Hct.fromInt(0xFFE8551F)
console.log('tone', src.tone.toFixed(1), 'chroma', src.chroma.toFixed(1), 'hue', src.hue.toFixed(1))
console.log('ratio(10,90)', Contrast.ratioOfTones(10, 90).toFixed(2))
console.log('score returns array:', Array.isArray(Score.score(QuantizerCelebi.quantize([0xFFE8551F, 0xFFE8551F, 0xFF808080], 128))))
console.log('element type:', typeof Score.score(QuantizerCelebi.quantize([0xFFE8551F, 0xFFE8551F, 0xFF808080], 128))[0])
"
```

Expected: 8 个符号的 `typeof` 全是 `function`（`Hct`/`Contrast`/`QuantizerCelebi`/`Score` 是 class，`typeof` 也是 `function`）；`ratio(10,90)` ≈ 13.27；`score returns array: true`；**`element type: number`** —— `Score.score` 返回的是纯 ARGB 数字数组（`score.js` 里 push 的是 `chosenHct.toInt()` 与 `fallbackColorARGB`），Task 3 的 `ranked[0] >>> 0` 依赖这一点。若某个符号名不同，**立即用实际名字修正后续任务的代码**，不要带着猜测往下写。

- [ ] **Step 5: 验证 Metro 能按子路径打进包（不跑 gradle，只 bundle）**

```bash
cat > mcu-probe-entry.js <<'EOF'
import { Hct } from '@material/material-color-utilities/hct/hct.js'
import { Contrast } from '@material/material-color-utilities/contrast/contrast.js'
import { QuantizerCelebi } from '@material/material-color-utilities/quantize/quantizer_celebi.js'
import { Score } from '@material/material-color-utilities/score/score.js'
import { argbFromRgb, redFromArgb, greenFromArgb, blueFromArgb } from '@material/material-color-utilities/utils/color_utils.js'
console.log(Hct, Contrast, QuantizerCelebi, Score, argbFromRgb, redFromArgb, greenFromArgb, blueFromArgb)
EOF
npx react-native bundle --platform android --dev true --entry-file mcu-probe-entry.js \
  --bundle-output .scratch/mcu-sub.bundle --assets-dest .scratch/mcu-res
ls -l .scratch/mcu-sub.bundle
rm -f mcu-probe-entry.js
```

Expected: 成功退出、无 `Unable to resolve module`。实测基线（`--dev true`，同一台机器）：空入口 45,019 B；子路径入口 179,039 B ⇒ **增量 134,020 B（约 131 KB）**；对照包根 import 的 524,480 B（增量 479,461 B）。如果你的数字与 134,020 B 相差超过 ~10KB，说明 import 写成了包根或带进了 `scheme/`，改回子路径。
不要往 `res/` 输出（那是仓库跟踪目录），`--assets-dest` 一律指到 `.scratch/`。

- [ ] **Step 6: 提交**

```bash
git add package.json package-lock.json
git commit -m "build(theme): 引入 material-color-utilities 并按子路径开放 exports"
```

Expected: 提交内含 `package.json`、`package-lock.json` 与 Step 3 暂存的 `dependencies-patch.js`（约 +8 行）。**不要** `rm -rf res`；若 `git status` 显示 `res/` 变脏，`git restore -- res`。

---

## Task 2: `surface.ts` —— 源色 → 背景配色（含对比度钳制）

这是整个功能"不会背景字色混淆"的核心，规则来自 Material 官方 `ToneDeltaPair` 的土法实现：**底色 tone 必须待在主题字色的对面（暗 ≤ 14 / 亮 ≥ 92），且模糊封面透出来时，合成 tone 偏离底色不得超过 8**（偏离越大蒙版越实）。

**Files:**
- Create: `src/utils/monet/surface.ts`
- Test: `tests/monet-surface.mts`

**Interfaces:**
- Consumes: `Hct`、`Contrast`、`redFromArgb/greenFromArgb/blueFromArgb`（Task 1）
- Produces:
  - `type CoverSurface = { base: string; scrimAlpha: number }`
  - `parseCssColor(color: string): number | null` —— `'rgb(33, 33, 33)'` / `'rgba(...)'` → ARGB int
  - `buildCoverSurface(sourceArgb: number, coverAvgArgb: number, fontArgb: number): CoverSurface | null`
  - 常量 `CHROMA_CAP = 36`、`MIN_CONTRAST = 4.5`、`DARK_ANCHOR_TONE = 10`、`LIGHT_ANCHOR_TONE = 96`、`TONE_DRIFT_LIMIT = 8`、`SCRIM_MIN = 0.45`、`SCRIM_MAX = 0.9`

- [ ] **Step 1: 写失败测试**

Create `tests/monet-surface.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CHROMA_CAP,
  DARK_ANCHOR_TONE,
  LIGHT_ANCHOR_TONE,
  MIN_CONTRAST,
  buildCoverSurface,
  parseCssColor,
} from '../src/utils/monet/surface.ts'
import { Contrast } from '@material/material-color-utilities/contrast/contrast.js'
import { Hct } from '@material/material-color-utilities/hct/hct.js'

const LIGHT_FONT = parseCssColor('rgb(33, 33, 33)')!
const DARK_FONT = parseCssColor('rgb(229, 229, 229)')!
const ORANGE = 0xFFE8551F
const WHITE = 0xFFFFFFFF
const GRAY = 0xFF808080

test('parseCssColor 支持 rgb 与 rgba，非 rgb 字符串返回 null', () => {
  assert.equal(parseCssColor('rgb(33, 33, 33)'), 0xFF212121)
  assert.equal(parseCssColor('rgba(255, 255, 255, 0.9)'), 0xFFFFFFFF)
  assert.equal(parseCssColor('#212121'), null)
  assert.equal(parseCssColor(''), null)
})

test('亮主题：底色落在高 tone 端，色相跟封面走', () => {
  const s = buildCoverSurface(ORANGE, ORANGE, LIGHT_FONT)!
  const tone = Hct.fromInt(parseCssColor(s.base)!).tone
  assert.ok(tone >= LIGHT_ANCHOR_TONE, `tone ${tone} 应 >= ${LIGHT_ANCHOR_TONE}`)
  assert.ok(Math.abs(Hct.fromInt(parseCssColor(s.base)!).hue - Hct.fromInt(ORANGE).hue) < 12)
})

test('暗主题：底色落在低 tone 端', () => {
  const s = buildCoverSurface(ORANGE, ORANGE, DARK_FONT)!
  const tone = Hct.fromInt(parseCssColor(s.base)!).tone
  assert.ok(tone <= DARK_ANCHOR_TONE + 4, `tone ${tone} 应 <= ${DARK_ANCHOR_TONE + 4}`)
})

test('底色与字色对比度恒 >= 4.5（任意封面）', () => {
  const sources = [ORANGE, WHITE, GRAY, 0xFF0000FF, 0xFF00FF00, 0xFF123456, 0xFFFEDCBA]
  for (const font of [LIGHT_FONT, DARK_FONT]) {
    for (const src of sources) {
      const s = buildCoverSurface(src, src, font)!
      const ratio = Contrast.ratioOfTones(Hct.fromInt(parseCssColor(s.base)!).tone, Hct.fromInt(font).tone)
      assert.ok(ratio >= MIN_CONTRAST, `src=${src.toString(16)} font=${font.toString(16)} ratio=${ratio}`)
    }
  }
})

test('高饱和封面被削到 CHROMA_CAP，灰封面不造假彩色', () => {
  const vivid = Hct.from(30, 120, 50).toInt()
  assert.ok(Hct.fromInt(parseCssColor(buildCoverSurface(vivid, vivid, LIGHT_FONT)!.base)!).chroma <= CHROMA_CAP + 1)
  const graySurface = buildCoverSurface(GRAY, GRAY, LIGHT_FONT)!
  assert.ok(Hct.fromInt(parseCssColor(graySurface.base)!).chroma < 3)
})

test('白封面压在暗底上时蒙版变实，暗封面则允许透出', () => {
  const darkFont = DARK_FONT
  const whiteCover = buildCoverSurface(GRAY, WHITE, darkFont)!
  const darkCover = buildCoverSurface(GRAY, 0xFF101010, darkFont)!
  assert.ok(whiteCover.scrimAlpha >= 0.85, `白封面 scrim=${whiteCover.scrimAlpha}`)
  assert.ok(darkCover.scrimAlpha <= 0.5, `暗封面 scrim=${darkCover.scrimAlpha}`)
})

test('scrimAlpha 恒在 [0.45, 0.9] 且保留两位小数', () => {
  for (const avg of [0xFF000000, 0xFF7F7F7F, 0xFFFFFFFF, ORANGE]) {
    const s = buildCoverSurface(ORANGE, avg, LIGHT_FONT)!
    assert.ok(s.scrimAlpha >= 0.45 && s.scrimAlpha <= 0.9)
    assert.equal(s.scrimAlpha, Number(s.scrimAlpha.toFixed(2)))
  }
})

test('字体色非法时返回 null，让调用方回落', () => {
  assert.equal(buildCoverSurface(ORANGE, ORANGE, 0x00000000), null)
})

// —— 以下 5 条是任务评审补的用例。前 3 条对旧实现（未钳制通道、未挡 NaN/透明、未做 gamut 后校验）
//    实测为红；后 2 条实测旧实现也为绿 —— 它们守的是"循环/削彩真的在起作用"，删掉对应防护才红。
//    每条期望值都本机复现过，见行内注释。

test('底色 tone 钳制循环真的会触发：中灰字色逼底色压到暗锚以下', () => {
  const font = 0xFF787878 // tone 50.43，走暗分支
  assert.ok(Hct.fromInt(font).tone > 50)
  const base = Hct.fromInt(parseCssColor(buildCoverSurface(ORANGE, ORANGE, font)!.base)!)
  assert.ok(base.tone < DARK_ANCHOR_TONE, `baseTone ${base.tone} 应低于暗锚 ${DARK_ANCHOR_TONE}，实测 1.93`)
  assert.ok(Contrast.ratioOfTones(base.tone, Hct.fromInt(font).tone) >= MIN_CONTRAST)
})

test('字色落在分支切分线附近时不跨侧硬凑，宁可按 null 回落', () => {
  // 实测：字色 tone 49.92 被判为"亮主题"→ 走高 tone 端，纯白 rgb(255,255,255) 也只有 4.4962 < 4.5。
  // 低 tone 端其实够得到（tone 0 → 4.6706），但底色跨侧意味着整页从亮翻成黑，是看得见的乱来，
  // 所以设计上是"够不到就 null"，不是"换一侧再试"。
  const font = Hct.from(0, 20, 49.95).toInt() >>> 0
  assert.ok(Hct.fromInt(font).tone < 50, '夹具要落在切分线的亮侧')
  assert.equal(buildCoverSurface(ORANGE, ORANGE, font), null)
})

test('削彩上限真的在削：hue 115 在高 tone 端有色度空间，必须压到 CHROMA_CAP 以下', () => {
  const src = Hct.from(115, 120, 50).toInt() >>> 0
  assert.ok(Hct.fromInt(src).chroma > CHROMA_CAP + 10, '夹具要能被上限咬到')
  const base = Hct.fromInt(parseCssColor(buildCoverSurface(src, src, LIGHT_FONT)!.base)!)
  assert.ok(base.chroma <= CHROMA_CAP + 1, `base chroma ${base.chroma} 实测 36.07；不削彩则为 50.21`)
})

test('CSS 通道越界按 255 钳制，不做位运算溢出', () => {
  assert.equal(parseCssColor('rgb(300, 0, 0)'), 0xFFFF0000)
})

test('入参非整数或 alpha 不足 255 一律 null，不被 >>> 0 吞成黑色', () => {
  assert.equal(buildCoverSurface(NaN, ORANGE, LIGHT_FONT), null)
  assert.equal(buildCoverSurface(ORANGE, NaN, LIGHT_FONT), null)
  assert.equal(buildCoverSurface(ORANGE, ORANGE, NaN), null)
  assert.equal(buildCoverSurface(0x80E8551F, ORANGE, LIGHT_FONT), null)
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-surface.mts
```

Expected: FAIL —— `Cannot find module '.../src/utils/monet/surface.ts'`

- [ ] **Step 3: 实现**

Create `src/utils/monet/surface.ts`:

```ts
import { Contrast } from '@material/material-color-utilities/contrast/contrast.js'
import { Hct } from '@material/material-color-utilities/hct/hct.js'
import { blueFromArgb, greenFromArgb, redFromArgb } from '@material/material-color-utilities/utils/color_utils.js'

export const CHROMA_CAP = 36
export const MIN_CONTRAST = 4.5
export const DARK_ANCHOR_TONE = 10
export const LIGHT_ANCHOR_TONE = 96
export const TONE_DRIFT_LIMIT = 8
export const SCRIM_MIN = 0.45
export const SCRIM_MAX = 0.9
const MAX_TONE_STEPS = 8

export interface CoverSurface {
  /** 铺底色，同时用作蒙版色：保证前景字色始终落在它这一侧 */
  base: string
  /** 蒙版不透明度：封面越亮/越暗（相对底色）越实，限制封面透出的 tone 漂移 */
  scrimAlpha: number
}

const cssRgb = (argb: number) => `rgb(${redFromArgb(argb)}, ${greenFromArgb(argb)}, ${blueFromArgb(argb)})`

const rgbColorRxp = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/
// CSS 语义是"超过 255 钳到 255"。少了这一步，`300 << 16` 会溢出污染相邻通道，
// 交出去一个看起来正常的暗色，比抛错更难查。
const clampChannel = (value: string) => Math.min(255, Number(value))

export const parseCssColor = (color: string): number | null => {
  const matched = rgbColorRxp.exec(color.trim())
  if (!matched) return null
  return ((255 << 24) | (clampChannel(matched[1]) << 16) | (clampChannel(matched[2]) << 8) | clampChannel(matched[3])) >>> 0
}

// 上游（原生像素与 parseCssColor）保证 alpha=255；非整数或带透明通道就是取色失败。
// 注意 `NaN >>> 0 === 0`：不在这一层挡住，失败会被静默当成"不透明黑"参与配色。
const isUsableArgb = (argb: number) => Number.isInteger(argb) && (argb >>> 24) === 255

export const buildCoverSurface = (sourceArgb: number, coverAvgArgb: number, fontArgb: number): CoverSurface | null => {
  if (!isUsableArgb(fontArgb) || !isUsableArgb(sourceArgb) || !isUsableArgb(coverAvgArgb)) return null

  const font = Hct.fromInt(fontArgb)
  const source = Hct.fromInt(sourceArgb)
  const isDark = font.tone > 50
  const chroma = Math.min(source.chroma, CHROMA_CAP)

  let tone = isDark ? DARK_ANCHOR_TONE : LIGHT_ANCHOR_TONE
  for (let i = 0; i < MAX_TONE_STEPS && Contrast.ratioOfTones(tone, font.tone) < MIN_CONTRAST; i++) {
    tone = isDark ? Math.max(0, tone - 4) : Math.min(100, tone + 3)
  }
  const base = Hct.from(source.hue, chroma, tone).toInt() >>> 0
  // HCT→sRGB 夹色域后真正铺出来的底色 tone 才是给用户看的那个值，判断以它为准。
  // 字色 tone 落在 49.9~50.0 且带彩度时（例：Hct.from(0, 20, 49.95)）亮分支最好也只有
  // 纯白的 4.4962。另一侧够得到（tone 0 → 4.6706），但底色跨侧等于把整页从亮翻成黑，
  // 那是看得见的乱来 —— 所以够不到就 null 回落到主题纯色，不跨侧硬凑。
  const baseTone = Hct.fromInt(base).tone
  if (Contrast.ratioOfTones(baseTone, font.tone) < MIN_CONTRAST) return null

  // 合成 ≈ scrim(base, a) 盖在模糊封面(平均色) 上：偏离量 = (1 - a) * |封面 tone - 底色 tone|
  const drift = Math.abs(Hct.fromInt(coverAvgArgb).tone - baseTone)
  let scrimAlpha = drift <= TONE_DRIFT_LIMIT ? SCRIM_MIN : 1 - TONE_DRIFT_LIMIT / drift
  scrimAlpha = Math.min(SCRIM_MAX, Math.max(SCRIM_MIN, scrimAlpha))

  return { base: cssRgb(base), scrimAlpha: Number(scrimAlpha.toFixed(2)) }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-surface.mts
```

Expected: PASS（13 个用例）。`MAX_TONE_STEPS = 8` 实测够用，别去放宽它：两个主题字色在锚点处就已达标（tone 12.74 vs 96 → 14.57；tone 90.94 vs 10 → 13.61），循环根本不跑；真正逼循环下探的是 `0xFF787878`（tone 50.43），2 步即 10→6→2 拿到 4.555。若有用例挂了，改实现不要改断言。

- [ ] **Step 5: 提交**

```bash
git add src/utils/monet/surface.ts tests/monet-surface.mts
git commit -m "feat(theme): 莫奈底色 tone 钳制与封面蒙版算法"
```

---

## Task 3: `sourceColor.ts` —— ARGB 像素 → 源色 + 平均色

官方 Monet 取源色链路（`sourceColorFromImageBytes`）：`QuantizerCelebi.quantize(pixels, 128)` → `Score.score(map)[0]`。`Score` 会过滤色度 < 5、占比 ≤ 1% 的颜色，所以**取到的是"最丰富"的颜色而非最大面积颜色** —— 这正是解决"灰暗封面糊成一片"的那一步。同时输出平均色给 Task 2 算蒙版。

**Files:**
- Create: `src/utils/monet/sourceColor.ts`
- Test: `tests/monet-source-color.mts`

**Interfaces:**
- Consumes: `QuantizerCelebi`、`Score`、`argbFromRgb`（Task 1）
- Produces:
  - `type CoverAnalysis = { source: number; average: number }`（两个都是 ARGB int，alpha 恒 255）
  - `analyzeArgbPixels(pixels: number[]): CoverAnalysis | null`
  - 常量 `QUANTIZE_COLORS = 128`

- [ ] **Step 1: 写失败测试**

Create `tests/monet-source-color.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { QUANTIZE_COLORS, analyzeArgbPixels } from '../src/utils/monet/sourceColor.ts'
import { Hct } from '@material/material-color-utilities/hct/hct.js'

const fill = (argb: number, n: number) => new Array(n).fill(argb >>> 0)
const GRAY = 0xFF808080
const RED = 0xFFCC2222

test('灰底 + 少量红：源色取红（面积让位于色度），平均色仍是灰', () => {
  const result = analyzeArgbPixels([...fill(GRAY, 900), ...fill(RED, 100)])!
  assert.ok(Hct.fromInt(result.source).chroma > 20, `source chroma=${Hct.fromInt(result.source).chroma}`)
  assert.ok(Hct.fromInt(result.average).chroma < 15, `average chroma=${Hct.fromInt(result.average).chroma}`)
})

test('全灰像素不崩，源色取的是这张图自己的灰而不是内置常量灰', () => {
  // 只断言色度挡不住"把 fallbackColorARGB 写成常量 0xff808080"这种改法：
  // 中灰封面照样全绿，深灰/浅灰封面就会被涂成中灰。三档灰都要求 source === 本图平均色 === 输入色。
  for (const gray of [0xFF808080, 0xFF2A2A2A, 0xFFEFEFEF]) {
    const result = analyzeArgbPixels(fill(gray, 4096))!
    assert.equal(result.average, gray)
    assert.equal(result.source, result.average, `gray=${gray.toString(16)}`)
    assert.ok(Hct.fromInt(result.source).chroma < 5)
  }
})

test('输出 alpha 恒为 255（供 Hct.fromInt 使用）', () => {
  const result = analyzeArgbPixels([...fill(GRAY, 100), ...fill(RED, 100)])!
  assert.equal(result.source >>> 24, 255)
  assert.equal(result.average >>> 24, 255)
})

test('半透明像素被跳过（图标/带透明通道封面不污染结果）', () => {
  const transparent = fill(0x00FF00FF, 3000)
  const result = analyzeArgbPixels([...transparent, ...fill(GRAY, 1000)])!
  // 断言要钉死数值：除以 pixels.length 而不是 opaque.length 时平均色会变成 0xff202020，
  // 色度仍是 1.9，只比色度的话这条就漏过了 —— 而 Task 2 的蒙版正好吃这个平均色。
  assert.equal(result.average, GRAY, `average=${result.average.toString(16)}`)
  assert.equal(result.source, GRAY, `source=${result.source.toString(16)}`)
  assert.ok(Hct.fromInt(result.source).chroma < 5)
})

test('空数组 / 全透明 / 非法输入返回 null', () => {
  assert.equal(analyzeArgbPixels([]), null)
  assert.equal(analyzeArgbPixels(fill(0x00FFFFFF, 100)), null)
  assert.equal(analyzeArgbPixels(null as unknown as number[]), null)
  assert.equal(analyzeArgbPixels(undefined as unknown as number[]), null)
  // array-like 是 Array.isArray 这道守卫存在的理由，不测它就是没守卫
  assert.equal(analyzeArgbPixels({ length: 3 } as unknown as number[]), null)
})

test('量化色数用官方 128', () => {
  assert.equal(QUANTIZE_COLORS, 128)
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-source-color.mts
```

Expected: FAIL —— `Cannot find module '.../sourceColor.ts'`

- [ ] **Step 3: 实现**

Create `src/utils/monet/sourceColor.ts`:

```ts
import { QuantizerCelebi } from '@material/material-color-utilities/quantize/quantizer_celebi.js'
import { Score } from '@material/material-color-utilities/score/score.js'
import { argbFromRgb } from '@material/material-color-utilities/utils/color_utils.js'

export const QUANTIZE_COLORS = 128

export interface CoverAnalysis {
  /** Monet 源色：色度加权后的"最丰富颜色" */
  source: number
  /** 全图平均色：用来估封面透出后的明度漂移 */
  average: number
}

export const analyzeArgbPixels = (pixels: number[]): CoverAnalysis | null => {
  // 入参来自 RN 原生桥，是个真实边界：`!pixels?.length` 会放过 { length: 3 } 这类 array-like，
  // 然后 `for (const pixel of pixels)` 直接抛 TypeError —— 文档承诺的是"非法输入返回 null"，就得真做到。
  if (!Array.isArray(pixels) || pixels.length === 0) return null
  const opaque: number[] = []
  let sumR = 0
  let sumG = 0
  let sumB = 0
  for (const pixel of pixels) {
    const argb = pixel >>> 0
    if ((argb >>> 24) < 255) continue
    opaque.push(argb)
    sumR += (argb >> 16) & 0xff
    sumG += (argb >> 8) & 0xff
    sumB += argb & 0xff
  }
  if (!opaque.length) return null

  const average = argbFromRgb(
    Math.round(sumR / opaque.length),
    Math.round(sumG / opaque.length),
    Math.round(sumB / opaque.length),
  ) >>> 0

  // 实测：Score.score 返回 number[]（不是 Map），且**永远至少给一个**：色度 < 5 的被
  // CUTOFF_CHROMA 全滤掉时（纯灰/近灰封面）它返回内置兜底色 Google Blue 0xFF4285F4，
  // 而不是空数组。灰封面被涂成蓝色是错的，所以用官方 options 把兜底色换成封面平均色。
  const ranked = Score.score(QuantizerCelebi.quantize(opaque, QUANTIZE_COLORS), { fallbackColorARGB: average })
  const source = ranked[0] >>> 0

  return { source, average }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-source-color.mts
```

Expected: PASS（6 个用例）。控制方已用真实实现跑过并记录实测值，挂了先对照：灰底+100 红 → `source` `0xffcc2222` 色度 87.3、`average` 色度 7.4；**三档灰**（`0xFF808080` / `0xFF2A2A2A` / `0xFFEFEFEF`）各自 → `average === 输入灰`、`source === average`，色度 1.90 / 1.01 / 2.76；100 灰 + 100 红 → alpha 均 255；3000 透明 + 1000 灰 → `average === source === 0xff808080`；空/全透明/`null` → `null`。
"三档灰"与"半透明被跳过"两条**靠 `{ fallbackColorARGB: average }` 才成立**：不传这个 options 时 `Score.score` 对灰封面返回 Google Blue `0xff4285f4`（色度 36+），这两条测试会红 —— 那是测试在正确地抓 bug，不许改成 `return null`（那等于把灰封面判成取色失败，Task 6 的回落分支会被误触发），也不许把 `assert.equal` 换回只比色度、或放宽任何断言。若"少量红"那条挂了（源色取到灰），打印 `Score.score` 前 5 名再判断，**不要改成"取 chroma 最大的量化色"来绕过**，那会丢掉官方行为。

- [ ] **Step 5: 提交**

```bash
git add src/utils/monet/sourceColor.ts tests/monet-source-color.mts
git commit -m "feat(theme): ARGB 像素走官方 Monet 取源色，灰封面回落到平均色"
```

---

## Task 4: Android 原生像素模块 + JS 桥

原生只做"给像素"，一行色彩逻辑都不写 —— 这样换算法不用重编 APK。下载必须带和 JS 侧 `defaultHeaders` 一致的 User-Agent（`src/components/common/Image.tsx:19`），否则部分音源封面会 403。

控制方已核实的现场（不用再查）：① 上面的 UA 串与 `defaultHeaders['User-Agent']` **逐字相等**，别改；② `MainApplication.java` 工作区**干净**（无别人 WIP），锚点 `packages.add(new AudioRecordPackage());` 实测在第 **45** 行，本任务可直接整文件 `git add`；③ `android/app/src/main/res/xml/network_security_config.xml` 是 `base-config cleartextTrafficPermitted="true"`，所以 `http://` 封面走 `HttpURLConnection` 不会被拦，无需额外配置；④ Java 的 `int` 过 JS 边界是**有符号**的（`0xFFE8551F` 变成负数），下游 `analyzeArgbPixels` 已用 `>>> 0` 归一，本模块不要为此特殊处理。

**Files:**
- Create: `android/app/src/main/java/cn/toside/music/mobile/palette/PaletteModule.java`
- Create: `android/app/src/main/java/cn/toside/music/mobile/palette/PalettePackage.java`
- Modify: `android/app/src/main/java/cn/toside/music/mobile/MainApplication.java:14-21, 39-46`
- Create: `src/utils/nativeModules/palette.ts`

**Interfaces:**
- Consumes: 无
- Produces: `getArgbPixels(url: string, maxSize?: number): Promise<number[] | null>`（ARGB int 数组，长度 ≈ maxSize² 以内；任何失败返回 `null`）

- [ ] **Step 1: 写模块**

Create `android/app/src/main/java/cn/toside/music/mobile/palette/PaletteModule.java`:

```java
package cn.toside.music.mobile.palette;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableNativeArray;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class PaletteModule extends ReactContextBaseJavaModule {

  // 与 src/components/common/Image.tsx 的 defaultHeaders 保持一致，否则部分音源封面取不到图
  private static final String USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36";

  private final ExecutorService executor = Executors.newSingleThreadExecutor();

  // 网络响应 4MB：封面实际几十到几百 KB，超了就是"自称是图片"的东西在撑堆。
  private static final int MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024;
  // 本地文件单独放宽到 32MB：本机歌曲的封面是内嵌图抽出来的文件（src/core/music/local.ts:112 会拼成 file://），
  // FLAC/高码率的内嵌封面超 4MB 很常见，用网络那个上限会把它们静默判成取色失败。
  private static final int MAX_LOCAL_BYTES = 32 * 1024 * 1024;

  PaletteModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return "PaletteModule";
  }

  @ReactMethod
  public void getArgbPixels(String url, int maxSize, Promise promise) {
    if (url == null || url.isEmpty()) {
      promise.reject("PALETTE_EMPTY_URL", "url is empty");
      return;
    }
    final String target = url;
    // 下界 1、上界 512：上界不是装饰 —— 巨大的 maxSize 会让下面 limit * 2 溢出成负数，
    // while 条件恒 false，于是原图不缩放直接按宽高分配 int[]，最坏 OOM（和下面 catch Throwable 是同一个坑）。
    final int limit = Math.max(1, Math.min(maxSize <= 0 ? 128 : maxSize, 512));
    executor.execute(() -> {
      Bitmap decoded = null;
      Bitmap scaled = null;
      try {
        byte[] raw = readBytes(target);
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(raw, 0, raw.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new Exception("image not decodable");

        int sample = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= limit * 2) sample *= 2;

        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        decoded = BitmapFactory.decodeByteArray(raw, 0, raw.length, options);
        // 截断的响应体能骗过上面 inJustDecodeBounds 的探边，但完整解码返回 null。
        // 不显式判就会靠 decoded.getWidth() 的 NPE 兜住，reject 文案变成 ART 的长句，看不出是"图不完整"。
        if (decoded == null) throw new Exception("decode returned null");

        int width = decoded.getWidth();
        int height = decoded.getHeight();
        float ratio = Math.min((float) limit / Math.max(width, height), 1f);
        scaled = ratio == 1f
          ? decoded
          : Bitmap.createScaledBitmap(decoded, Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)), true);

        int[] pixels = new int[scaled.getWidth() * scaled.getHeight()];
        scaled.getPixels(pixels, 0, scaled.getWidth(), 0, 0, scaled.getWidth(), scaled.getHeight());

        WritableNativeArray result = new WritableNativeArray();
        for (int pixel : pixels) result.pushInt(pixel);
        promise.resolve(result);
      } catch (Throwable t) {
        // 必须是 Throwable 不是 Exception：大封面解码可能抛 OutOfMemoryError，那是 Error 不是 Exception。
        // ART 上工作线程里逃逸的 Throwable 会直接把整个 App 杀掉（用户看到的是"进播放页偶发闪退"）；
        // 而且 promise 会永不 settle —— Task 5 的 pixelCache 按 url 缓存 Promise，
        // 一条永不 settle 的 promise 等于这张封面到杀进程为止都不会再尝试上色，违反"失败即回落"。
        promise.reject("PALETTE_FAILED", String.valueOf(t), t);
      } finally {
        try {
          if (scaled != null && scaled != decoded) scaled.recycle();
          if (decoded != null) decoded.recycle();
        } catch (Throwable ignored) {
          // recycle 只在 finally 里跑，此刻 promise 已经 settle，抛出去只会杀进程，换不到任何信息
        }
      }
    });
  }

  private byte[] readBytes(String url) throws Exception {
    String path = url.startsWith("file://") ? Uri.parse(url).getPath() : url;
    if (path == null) throw new Exception("bad file uri");
    if (!path.startsWith("http")) {
      File file = new File(path);
      FileInputStream in = new FileInputStream(file);
      try {
        return readAll(in, MAX_LOCAL_BYTES);
      } finally {
        in.close();
      }
    }
    HttpURLConnection conn = (HttpURLConnection) new URL(path).openConnection();
    conn.setRequestProperty("User-Agent", USER_AGENT);
    // 单线程 executor 意味着排队：一个"慢慢滴"的服务器能占住这条唯一的工作线程，
    // 把用户正在听的这首歌的上色挤到几十秒后。背景是装饰功能，过期就回落，不值得等 8+8 秒。
    conn.setConnectTimeout(4000);
    conn.setReadTimeout(4000);
    conn.setInstanceFollowRedirects(true);
    try {
      int code = conn.getResponseCode();
      if (code < 200 || code >= 400) throw new Exception("http " + code);
      // 走到这里只剩 2xx/3xx：3xx 没跟随时响应体在 getInputStream()，getErrorStream() 恒为 null，
      // 那样会把"靠 UA 才拿得到的 CDN 跳转封面"误判成取色失败。
      InputStream in = conn.getInputStream();
      if (in == null) throw new Exception("empty body");
      try {
        return readAll(in, MAX_DOWNLOAD_BYTES);
      } finally {
        in.close();
      }
    } finally {
      conn.disconnect();
    }
  }

  private byte[] readAll(InputStream in, int maxBytes) throws Exception {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    int read;
    while ((read = in.read(buffer)) != -1) {
      if (out.size() + read > maxBytes) throw new Exception("image too large");
      out.write(buffer, 0, read);
    }
    return out.toByteArray();
  }
}
```

- [ ] **Step 2: 写 Package（照 `utils/UtilsPackage.java` 模板）**

Create `android/app/src/main/java/cn/toside/music/mobile/palette/PalettePackage.java`:

```java
package cn.toside.music.mobile.palette;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.Collections;
import java.util.List;

public class PalettePackage implements ReactPackage {

  @Override
  public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
    return Collections.emptyList();
  }

  @Override
  public List<NativeModule> createNativeModules(ReactApplicationContext reactContext) {
    return Collections.singletonList(new PaletteModule(reactContext));
  }
}
```

- [ ] **Step 3: 注册**

`MainApplication.java` —— import 段（第 20 行 `audioRecord` 之后）加：

```java
import cn.toside.music.mobile.palette.PalettePackage;
```

`getPackages()` 里（第 45 行 `packages.add(new AudioRecordPackage());` 之后）加：

```java
          packages.add(new PalettePackage());
```

- [ ] **Step 4: 写 JS 桥**

Create `src/utils/nativeModules/palette.ts`:

```ts
import { NativeModules, Platform } from 'react-native'

const { PaletteModule } = NativeModules

export const getArgbPixels = async(url: string, maxSize = 128): Promise<number[] | null> => {
  if (Platform.OS !== 'android' || !PaletteModule?.getArgbPixels) return null
  try {
    return await PaletteModule.getArgbPixels(url, maxSize) as number[]
  } catch (e) {
    if (__DEV__) console.log('[palette] getArgbPixels failed', url, e)
    return null
  }
}
```

`maxSize = 128` 保持官方口径（官方 `sourceColorFromImage` 也把图缩到 128 边长），**不要**凭感觉往下调。本机实测 `QuantizerCelebi.quantize + Score.score` 的开销**跟着"不同颜色数"走而不是像素数**：4096 与 16384 个**全随机**像素在 128 簇下都是 140~148ms，而"照片样"像素（60 个基色 + 噪声）同样 4096/16384 只要 **21~28ms**；把簇数砍到 16 对随机样本能降到 35~69ms，但对真实封面几乎没差别。分析跑在 `await fetchOnce()` 之后的 promise 续体里（Task 5），不在渲染路径上。**真机验收项**：vivo 上计时"进入播放页 → 背景上色"，若这段 JS 把开屏动画卡出可见掉帧，就把默认值降到 `maxSize = 64`（一处改动，`fetchOnce` 的入参），而不是去砍 `QUANTIZE_COLORS`（那会偏离官方取色行为，Task 3 的用例语义也会变）。

- [ ] **Step 5: 编译验证**

```bash
cd android && ./gradlew assembleDebug
```

Expected: `BUILD SUCCESSFUL`。首次要下 gradle 依赖，给足时间；失败按报错定位，不要跳过。

- [ ] **Step 6: 移交运行时冒烟（实现者不碰 adb）**

真机是本仓库唯一的测试设备，且 USB 注入有误触用户前台应用的风险 —— **子代理不执行 `adb install` / `adb shell`**。实现者到此为止只需保证 Step 5 编译通过，并在报告里写明"桥未做运行时验证"，由控制方在 Task 6 完成后统一装机冒烟（验证点：数组长度 ≈ 4096–16384，且 `pixels[0] >>> 24 === 255`）。

- [ ] **Step 7: 提交**

```bash
git add android/app/src/main/java/cn/toside/music/mobile/palette \
        android/app/src/main/java/cn/toside/music/mobile/MainApplication.java \
        src/utils/nativeModules/palette.ts
git commit -m "feat(android): 封面降采样像素模块 PaletteModule"
```

---

## Task 5: `coverPalette.ts` —— 缓存 / in-flight 去重 / 回落

取色一次要下载 + 量化，**同一张封面切回来不能重算**；快速切歌时同一 URL 的并发请求要合并。缓存存"分析结果"而不是最终配色，因为暗/亮主题下配色不同但像素分析一致。

**Files:**
- Create: `src/utils/monet/coverPalette.ts`
- Create: `src/utils/monet/index.ts`
- Test: `tests/monet-cover-palette.mts`

**Interfaces:**
- Consumes: `analyzeArgbPixels`（Task 3）、`buildCoverSurface` + `CoverSurface`（Task 2）
- Produces:
  - `createCoverPalette(fetchPixels: (url: string) => Promise<number[] | null>) => { getCoverSurface(picUrl: string | null | undefined, fontColor: string): Promise<CoverSurface | null>, clearCache(): void }`
  - `src/utils/monet/index.ts` 导出 `getCoverSurface`、`clearCoverPaletteCache`、`type CoverSurface`

- [ ] **Step 1: 写失败测试**

Create `tests/monet-cover-palette.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { PIXEL_LIMIT, createCoverPalette } from '../src/utils/monet/coverPalette.ts'
import { Hct } from '@material/material-color-utilities/hct/hct.js'

const GRAY = 0xFF808080
const RED = 0xFFCC2222
const LIGHT_FONT = 'rgb(33, 33, 33)'
const DARK_FONT = 'rgb(229, 229, 229)'
const pixels = (argb: number, n = 1000) => new Array(n).fill(argb >>> 0)

test('正常路径：返回亮主题高 tone 底色 + 合法 scrim', async() => {
  const { getCoverSurface } = createCoverPalette(async() => pixels(RED))
  const surface = await getCoverSurface('https://example.com/a.jpg', LIGHT_FONT)
  assert.ok(surface)
  assert.ok(surface!.scrimAlpha >= 0.45 && surface!.scrimAlpha <= 0.9)
  assert.match(surface!.base, /^rgb\(\d+, \d+, \d+\)$/)
})

test('同一 URL 只取一次像素，暗/亮主题各自算色不互相污染', async() => {
  let calls = 0
  const { getCoverSurface } = createCoverPalette(async() => {
    calls += 1
    return pixels(RED)
  })
  const light = await getCoverSurface('https://example.com/a.jpg', LIGHT_FONT)
  const dark = await getCoverSurface('https://example.com/a.jpg', DARK_FONT)
  assert.equal(calls, 1)
  assert.notEqual(light!.base, dark!.base)
})

test('并发调用合并成一次网络取色', async() => {
  let calls = 0
  const { getCoverSurface } = createCoverPalette(async() => {
    calls += 1
    await new Promise(resolve => setTimeout(resolve, 10))
    return pixels(RED)
  })
  const [a, b, c] = await Promise.all([
    getCoverSurface('https://example.com/same.jpg', LIGHT_FONT),
    getCoverSurface('https://example.com/same.jpg', LIGHT_FONT),
    getCoverSurface('https://example.com/same.jpg', DARK_FONT),
  ])
  assert.equal(calls, 1)
  assert.ok(a && b && c)
})

test('取色失败（null 像素）→ 返回 null 且被缓存，不再反复重试', async() => {
  let calls = 0
  const { getCoverSurface } = createCoverPalette(async() => {
    calls += 1
    return null
  })
  assert.equal(await getCoverSurface('https://example.com/bad.jpg', LIGHT_FONT), null)
  assert.equal(await getCoverSurface('https://example.com/bad.jpg', LIGHT_FONT), null)
  assert.equal(calls, 1)
})

test('空 url / 非法字体色直接 null，不碰原生', async() => {
  let called = false
  const { getCoverSurface } = createCoverPalette(async() => {
    called = true
    return pixels(GRAY)
  })
  assert.equal(await getCoverSurface('', LIGHT_FONT), null)
  assert.equal(await getCoverSurface(null, LIGHT_FONT), null)
  assert.equal(await getCoverSurface('https://example.com/a.jpg', '#333'), null)
  assert.equal(called, false)
})

test('缓存有上限，超出后淘汰最早的 key', async() => {
  let calls = 0
  const { getCoverSurface } = createCoverPalette(async() => {
    calls += 1
    return pixels(GRAY)
  })
  for (let i = 0; i < 70; i++) await getCoverSurface(`https://example.com/${i}.jpg`, LIGHT_FONT)
  assert.equal(calls, 70)
  await getCoverSurface('https://example.com/0.jpg', LIGHT_FONT)
  assert.equal(calls, 71)
})

test('像素层按自己的 PIXEL_LIMIT 淘汰，不跟配色层共用 60', async() => {
  // 探测像素层必须换 font：同一 url + 同一 font 会先命中配色层（cache.has(key) 直接返回），
  // 根本走不到 fetchOnce，那样的话这条用例测的是配色层而不是像素层。换 DARK_FONT 后 surface key 变了、
  // pixel key 没变，才真正问的是"这张封面的像素还在不在缓存里"。
  // 若实现误用 CACHE_LIMIT(60)：21 条不触发淘汰，第二个 assert 就会红（calls 停在 21），所以这条是承重的。
  // fetcher 恒返回 null：失败条目同样占位（第 4 条用例钉的行为），顺带省掉真量化开销。
  let calls = 0
  const { getCoverSurface } = createCoverPalette(async() => {
    calls += 1
    return null
  })
  for (let i = 0; i < PIXEL_LIMIT + 1; i++) await getCoverSurface(`https://example.com/${i}.jpg`, LIGHT_FONT)
  assert.equal(calls, PIXEL_LIMIT + 1)
  await getCoverSurface('https://example.com/0.jpg', DARK_FONT)
  assert.equal(calls, PIXEL_LIMIT + 2)
  await getCoverSurface(`https://example.com/${PIXEL_LIMIT}.jpg`, DARK_FONT)
  assert.equal(calls, PIXEL_LIMIT + 2)
})

test('clearCache 后重新取色', async() => {
  let calls = 0
  const { getCoverSurface, clearCache } = createCoverPalette(async() => {
    calls += 1
    return pixels(GRAY)
  })
  await getCoverSurface('https://example.com/a.jpg', LIGHT_FONT)
  clearCache()
  await getCoverSurface('https://example.com/a.jpg', LIGHT_FONT)
  assert.equal(calls, 2)
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-cover-palette.mts
```

Expected: FAIL —— `Cannot find module '.../coverPalette.ts'`

- [ ] **Step 3: 实现工厂**

Create `src/utils/monet/coverPalette.ts`:

```ts
// 相对 import 必须带 .ts：这个文件被 `node --test` 直接加载，Node ESM 不认无扩展名的相对路径
// （实测 ERR_MODULE_NOT_FOUND: .../monet/sourceColor），而 Metro 0.80.12 带扩展名照样解析成功（已用探针 bundle 验过）。
import { analyzeArgbPixels } from './sourceColor.ts'
import { buildCoverSurface, parseCssColor, type CoverSurface } from './surface.ts'

export const CACHE_LIMIT = 60
// 像素层单独设上限，而且要比 CACHE_LIMIT 小：一个 value 是最多 16384 个数字的数组，
// 比一条 CoverSurface 贵两个量级。pixelCache 原先只有 clearCache() 能清空，而全计划没有任何调用方，
// 长时间连播会把听过的每一张封面的原始像素都留在内存里。
export const PIXEL_LIMIT = 20

export const createCoverPalette = (fetchPixels: (url: string) => Promise<number[] | null>) => {
  // 两层缓存：像素按 url 缓存（下载+量化只一次），配色按 url|font 缓存（暗/亮主题各一份）
  const pixelCache = new Map<string, Promise<number[] | null>>()
  const pixelOrder: string[] = []
  const cache = new Map<string, CoverSurface | null>()
  const cacheOrder: string[] = []
  const pending = new Map<string, Promise<CoverSurface | null>>()

  // async 是仓库规则要求的（@typescript-eslint/promise-function-async：非 async 函数返回 Promise 会报），
  // 不是功能需要。去重靠 pixelCache 里那条原始 promise：async 包装只是再套一层壳，
  // 命中缓存时不会第二次调用 fetchPixels，第 2、5 条用例仍然量得到。
  const fetchOnce = async(picUrl: string): Promise<number[] | null> => {
    const cached = pixelCache.get(picUrl)
    if (cached) return cached
    // 取色失败（null）也进缓存，这是 Task 5 第 4 条用例钉住的行为：原生侧是单线程队列，
    // 坏源封面若不缓存就会每跳一次这首歌再排一次失败请求，把当前这首歌的上色挤到一串失败后面。
    // 代价是"瞬时失败即整会话不再上色"，出口在 Task 6：翻动"动态背景"开关时 clearCoverPaletteCache()。
    const task = Promise.resolve(fetchPixels(picUrl)).catch(() => null)
    pixelCache.set(picUrl, task)
    pixelOrder.push(picUrl)
    if (pixelOrder.length > PIXEL_LIMIT) {
      const oldest = pixelOrder.shift()!
      if (oldest !== picUrl) pixelCache.delete(oldest)
    }
    return task
  }

  const remember = (key: string, value: CoverSurface | null) => {
    if (!cache.has(key)) {
      cacheOrder.push(key)
      if (cacheOrder.length > CACHE_LIMIT) {
        const oldest = cacheOrder.shift()!
        if (oldest !== key) cache.delete(oldest)
      }
    }
    cache.set(key, value)
  }

  // 同上：async 只为过 lint。pending 里的原始 promise 仍是去重的那一条。
  const load = async(picUrl: string, fontArgb: number): Promise<CoverSurface | null> => {
    const key = `${picUrl}|${fontArgb}`
    if (cache.has(key)) return cache.get(key)!
    const inFlight = pending.get(key)
    if (inFlight) return inFlight

    const task = (async() => {
      try {
        const pixels = await fetchOnce(picUrl)
        const analysis = pixels == null ? null : analyzeArgbPixels(pixels)
        return analysis == null ? null : buildCoverSurface(analysis.source, analysis.average, fontArgb)
      } catch {
        return null
      } finally {
        pending.delete(key)
      }
    })()
    pending.set(key, task)
    return task
  }

  return {
    getCoverSurface: async(picUrl: string | null | undefined, fontColor: string): Promise<CoverSurface | null> => {
      if (!picUrl) return null
      const fontArgb = parseCssColor(fontColor)
      if (fontArgb == null) return null
      return load(picUrl, fontArgb).then(surface => {
        remember(`${picUrl}|${fontArgb}`, surface)
        return surface
      })
    },
    clearCache() {
      pixelCache.clear()
      pixelOrder.length = 0
      cache.clear()
      cacheOrder.length = 0
      pending.clear()
    },
  }
}
```

- [ ] **Step 4: 接原生入口**

Create `src/utils/monet/index.ts`:

```ts
import { getArgbPixels } from '@/utils/nativeModules/palette'
import { createCoverPalette } from './coverPalette'

export { type CoverSurface } from './surface'

// 直接写 `export const getCoverSurface = palette.getCoverSurface` 会报
// @typescript-eslint/unbound-method（把对象方法当函数引用导出），所以两个导出都包一层箭头。
const palette = createCoverPalette(getArgbPixels)

export const getCoverSurface = async(picUrl: string | null | undefined, fontColor: string) =>
  palette.getCoverSurface(picUrl, fontColor)

export const clearCoverPaletteCache = () => {
  palette.clearCache()
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-cover-palette.mts
```

Expected: PASS（**8** 个用例）。第 6 条"缓存有上限"要求 `CACHE_LIMIT = 60` 且按插入序淘汰；若淘汰逻辑把刚写的 key 删了，改成"先删 cacheOrder 头部且不等于当前 key"。第 7 条"像素层按自己的 PIXEL_LIMIT 淘汰"是**承重的**：控制方实测把 `pixelOrder.length > PIXEL_LIMIT` 改成 `> CACHE_LIMIT` 后这条会红（`calls` 停在 21、期望 22），别把它当摆设放宽。

再加两道闸门（本机实测过的目标值）：

```bash
npx eslint src/utils/monet/coverPalette.ts src/utils/monet/index.ts
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "monet/(coverPalette|index)"
```

Expected：两条命令都为**空输出**。这两个文件里所有 `async` 都不是风格选择，是仓库规则逼出来的 —— 少一个就报 `@typescript-eslint/promise-function-async`（fetchOnce/load/getCoverSurface 三处）或 `@typescript-eslint/unbound-method`（index.ts 两个导出）。**不要**为了让代码"更干净"把 async 去掉或把包装箭头改成直接导出方法引用，那样 lint 立刻红回去。禁用 `eslint --fix`。

- [ ] **Step 6: 提交**

```bash
git add src/utils/monet/coverPalette.ts src/utils/monet/index.ts tests/monet-cover-palette.mts
git commit -m "feat(theme): 封面配色缓存与并发去重"
```

---

## Task 6: 背景层组件 + 播放页接入 + "动态背景"开关

**Files:**
- Create: `src/utils/monet/useCoverSurface.ts`
- Create: `src/components/player/CoverBackdrop/index.tsx`
- Modify: `src/screens/PlayDetail/Vertical/index.tsx`（**该文件带着别人未提交的歌词工具 WIP（5+/1-），只能按 Step 6 的定点替换提交，禁止整文件 `git add`**）
- Modify: `src/types/app_setting.d.ts`（`'theme.fontShadow'` 之后）
- Modify: `src/config/defaultSetting.ts:80` 之后
- Create: `src/screens/Home/Views/Setting/settings/Theme/DynamicBg.tsx`
- Modify: `src/screens/Home/Views/Setting/settings/Theme/index.tsx:7, 16`
- Modify: `src/lang/zh-cn.json` / `src/lang/zh-tw.json` / `src/lang/en-us.json`（`setting_basic_theme_font_shadow` 之前）

**Interfaces:**
- Consumes: `getCoverSurface`（Task 5）、`usePlayerMusicInfo`（`src/store/player/hook`，字段 `pic`）、`useSettingValue('theme.dynamicBg')`、`ImageBackground`（`src/components/common/ImageBackground`，支持 `blurRadius`）、`defaultHeaders`（`src/components/common/Image.tsx:19`）
- Produces: `useCoverSurface(): { enabled: boolean; picUrl: string | null; surface: CoverSurface | null }`；`<CoverBackdrop />`

- [ ] **Step 1: 加设置项类型与默认值**

`src/types/app_setting.d.ts`，在 `'theme.fontShadow': boolean` 那段之后加：

```ts
    /**
       * 播放页动态背景（跟随封面莫奈取色）
       */
    'theme.dynamicBg': boolean
```

`src/config/defaultSetting.ts`，在 `'theme.fontShadow': false,` 之后加：

```ts
  'theme.dynamicBg': false,
```

- [ ] **Step 2: 加文案**

三个语言文件里，在 `setting_basic_theme_font_shadow` 那一行**之前**各加一行（保持 key 字典序）：

`src/lang/zh-cn.json`
```json
  "setting_basic_theme_dynamic_bg": "动态背景（跟随封面配色）",
```
`src/lang/zh-tw.json`
```json
  "setting_basic_theme_dynamic_bg": "動態背景（跟隨封面配色）",
```
`src/lang/en-us.json`
```json
  "setting_basic_theme_dynamic_bg": "Dynamic background (follows album artwork colors)",
```

- [ ] **Step 3: 加开关组件**

Create `src/screens/Home/Views/Setting/settings/Theme/DynamicBg.tsx`（照 `IsFontShadow.tsx`，只改 key/文案）:

```tsx
import { memo } from 'react'
import { View } from 'react-native'

import CheckBoxItem from '../../components/CheckBoxItem'
import { createStyle } from '@/utils/tools'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'
import { useSettingValue } from '@/store/setting/hook'
import { clearCoverPaletteCache } from '@/utils/monet'

export default memo(() => {
  const t = useI18n()
  const dynamicBg = useSettingValue('theme.dynamicBg')
  const setDynamicBg = (dynamicBg: boolean) => {
    updateSetting({ 'theme.dynamicBg': dynamicBg })
    // Task 5 会把取色失败的封面按 url 缓存到会话结束（那是它第 4 条用例钉住的行为），
    // 而 clearCoverPaletteCache 在全计划里原本没有任何调用方 —— 翻开关就是用户唯一够得到的重试出口：
    // 关掉再打开，慢网/瞬时失败的封面会重新取色，而不是永远灰着。
    clearCoverPaletteCache()
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem check={dynamicBg} label={t('setting_basic_theme_dynamic_bg')} onChange={setDynamicBg} />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
```

`src/screens/Home/Views/Setting/settings/Theme/index.tsx`：加 `import DynamicBg from './DynamicBg'`，并把 `<DynamicBg />` 放在 `<IsFontShadow />` 之前（`IsFontShadow` 的 `marginBottom: 15` 是分组末位，新项不要抢）。

- [ ] **Step 4: 写 hook**

Create `src/utils/monet/useCoverSurface.ts`:

```ts
import { useEffect, useState } from 'react'

import { usePlayerMusicInfo } from '@/store/player/hook'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { getCoverSurface, type CoverSurface } from '@/utils/monet'

export interface CoverBackdropState {
  enabled: boolean
  picUrl: string | null
  surface: CoverSurface | null
}

export const useCoverSurface = (): CoverBackdropState => {
  const enabled = useSettingValue('theme.dynamicBg')
  const theme = useTheme()
  const { pic } = usePlayerMusicInfo()
  const fontColor = theme['c-font']

  const [surface, setSurface] = useState<CoverSurface | null>(null)

  useEffect(() => {
    if (!enabled || !pic) {
      setSurface(null)
      return
    }
    let cancelled = false
    void getCoverSurface(pic, fontColor).then(next => {
      if (!cancelled) setSurface(next)
    })
    return () => { cancelled = true }
  }, [enabled, pic, fontColor])

  return { enabled, picUrl: enabled ? pic ?? null : null, surface }
}
```

- [ ] **Step 5: 写背景层组件**

Create `src/components/player/CoverBackdrop/index.tsx`:

```tsx
import { memo, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'

import ImageBackground from '@/components/common/ImageBackground'
import { defaultHeaders } from '@/components/common/Image'
import { useCoverSurface } from '@/utils/monet/useCoverSurface'
import { useTheme } from '@/store/theme/hook'

const BLUR_RADIUS = 90

export default memo(({ enabled = true }: { enabled?: boolean }) => {
  const theme = useTheme()
  const { picUrl, surface } = useCoverSurface()
  const active = enabled && surface != null

  const source = useMemo(() => (active && picUrl
    ? {
        uri: picUrl.startsWith('/') ? 'file://' + picUrl : picUrl,
        headers: defaultHeaders,
        cache: 'force-cache' as const,
      }
    : null), [active, picUrl])

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: active ? surface.base : theme['c-content-background'] }]}>
      {
        source ? (
          <>
            <ImageBackground style={StyleSheet.absoluteFill} source={source} resizeMode="cover" blurRadius={BLUR_RADIUS} />
            {/* 这一处必须留 `!`：`source` 不是 `active` 的别名，TS 的 aliased narrowing 只认得出上面那行的三元。
                删掉它 tsc 报 TS18047，加上它 lint 报 no-unnecessary-type-assertion —— 两处写法不同是被这两条闸门夹出来的。 */}
            <View style={[StyleSheet.absoluteFill, { backgroundColor: surface!.base, opacity: surface!.scrimAlpha }]} />
          </>
        ) : null
      }
    </View>
  )
})
```

三层顺序即 Global Constraints 的落点：**铺底 → 模糊封面 → 同色蒙版**。前景（歌词/标题/按钮）完全在这个组件之上，颜色仍来自 `useTheme()`。

- [ ] **Step 6: 接入竖屏播放页**

`src/screens/PlayDetail/Vertical/index.tsx`：**只做两处插入，不要重写 return 结构。** 这个文件当前带着别人未提交的歌词工具 WIP（`useLyricToolMode` / `setLyricToolMode` / `{!lyricToolMode ? <Player .../> : null}`，`git diff --numstat` 实测 5+/1-），而且 return 块里还有别人的注释代码（`// onPageScrollStateChanged=...` 与被注释掉的 `styles.pageIndicator` 整段）。早先计划版本写的"把 return 整段换成 `<View style={styles.root}>` 包一层"会同时踩这两条雷：既删掉别人的注释块，又给共享元素转场（`NAV_SHEAR_NATIVE_IDS`）多塞一层 View。现在改成最小接入：

第一处，`import Pic from './Pic'` 之前那一组 import 里加一行（紧跟 `import Lyric from './Lyric'` 之后即可）：

```tsx
import CoverBackdrop from '@/components/player/CoverBackdrop'
```

第二处，把 return 的 Fragment 开头改成（只加一行，其余一个字符都不动）：

```tsx
  return (
    <>
      <CoverBackdrop />
      <Header pageIndex={pageIndex} onPageSelected={(page: number) => pagerRef.current?.setPage(page)} />
```

`CoverBackdrop` 自己用 `StyleSheet.absoluteFill` 铺满，Fragment 的第一个子节点在最底层，Header/PagerView/Player 天然压在它上面，所以不需要新的 `styles.root` / `styles.layer`，也不要动 `styles`。

**提交只能走定点暂存**（Step 10 给命令）。原因：`git add src/screens/PlayDetail/Vertical/index.tsx` 会把那 5+/1- 的歌词工具 WIP 一起提交进本功能，而本项目的硬约束是"只提交计划列出的改动"。

- [ ] **Step 7: 跑全量 monet 测试（不要改 `package.json`）**

`package.json` 的 `test` 脚本行**当前带着别人未提交的 WIP**（行尾多了 `tests/lyric-copy-text.mts`，属于歌词工具那笔活儿）。在这个工作区里 `git add package.json` 会把那半行一起提交进本功能，所以本步不改 `package.json`：挂进 `npm test` 由控制方在 Task 8 收尾时处理。

验证（直接按文件跑）：

```bash
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types \
  tests/monet-source-color.mts tests/monet-surface.mts tests/monet-cover-palette.mts 2>&1 | tail -6
```

Expected: `fail 0`；`pass` 计数 = **27**（T3 6 + T2 13 + T5 8）。T5 是 8 不是 7 —— P15 给它加了第 7 条像素层 LRU 用例（本条计划的旧版本还写着 26，已按 `ebbcecf`+`bcc807b` 的实测数订正）。

- [ ] **Step 8: 过静态检查**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint src/utils/monet src/components/player/CoverBackdrop src/screens/PlayDetail/Vertical/index.tsx src/screens/Home/Views/Setting/settings/Theme --ext .ts,.tsx
```

Expected: **本机 tsc 实测总数 137**（记忆那个 107 是"落在 `src/` 的子集"，不是总数，别拿它当总数比 —— 其中 88 条在 `src/components/player/PlayerOverlay/index.tsx`，16/6/3/3 条在既有 `tests/*.mts` 的 `as` 断言噪音，都与本功能无关）。闸门按"**自己新增/改动的文件 0 报错**"判定：`npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "monet|CoverBackdrop|DynamicBg"` 应为空。总数只允许持平或下降，**不要**去修别人的 88 条。lint 对新增文件 0 error。

- [ ] **Step 9: 编译验证（真机验收移交控制方）**

```bash
cd android && ./gradlew assembleDebug
```

Expected: `BUILD SUCCESSFUL`。**子代理不执行 `adb install`**（真机唯一、注入前须确认前台，见 Task 4 Step 6 的同一约定）。以下四条由控制方装机后与用户一起看，实现者在报告里逐条标注"未验"：
① 开关关 → 与改动前完全一致；② 开关开、暗主题、亮封面 → 背景偏暗且歌词清楚；③ 切歌时背景 300ms 内跟换；④ 无封面/取色失败 → 回落纯色。

- [ ] **Step 10: 提交**

新建的组件/hook/开关文件正常暂存：

```bash
git add src/utils/monet/useCoverSurface.ts src/components/player/CoverBackdrop \
        src/types/app_setting.d.ts src/config/defaultSetting.ts \
        src/screens/Home/Views/Setting/settings/Theme
git diff --cached --stat
```

Expected（`git diff --cached --stat`）：**6 个文件**（`CoverBackdrop/index.tsx`、`useCoverSurface.ts`、`DynamicBg.tsx`、`Theme/index.tsx`、`app_setting.d.ts`、`defaultSetting.ts`），**不含 `Vertical/index.tsx`、不含 `src/lang/*.json`、不含 `package.json`**。提交后总数会是 **10 个文件**（这 6 个 + Vertical + 3 个 lang）。

**`src/lang/zh-cn.json` / `zh-tw.json` / `en-us.json` 也走定点暂存**，和 `Vertical/index.tsx` 同一套：控制方实测这三个文件各自带着别人 **91+/15−** 的未提交 WIP（推荐引导 / 听歌识曲 / 歌词工具三笔活儿的文案），整文件 `git add` 会把约 273 行别人的东西提交进本功能 —— Task 6 的实现者自己发现并按本条 recipe 处理了，现在把它写死在计划里，别让后面的执行者再踩一次。三个文件的锚点都是 `"setting_basic_theme_font_shadow"` 那一行（实测每个文件命中 **1 次**），在它**之前**插入 brief Step 2 给的那一行。

`Vertical/index.tsx` 单独走定点暂存（控制方已用一次性 scratch 仓库复现过这套命令的机制：`git hash-object -w` + `git update-index --cacheinfo` 能让暂存内容与工作树内容不同；工作树里别人的 WIP 原样保留）：

```bash
mkdir -p .scratch/t6
git show HEAD:src/screens/PlayDetail/Vertical/index.tsx > .scratch/t6/base.tsx
cp .scratch/t6/base.tsx .scratch/t6/staged.tsx
node - <<'EOF'
const fs = require('fs')
const p = '.scratch/t6/staged.tsx'
let s = fs.readFileSync(p, 'utf8')
const reps = [
  ["import Lyric from './Lyric'\n", "import Lyric from './Lyric'\nimport CoverBackdrop from '@/components/player/CoverBackdrop'\n"],
  ['  return (\n    <>\n      <Header pageIndex={pageIndex}', '  return (\n    <>\n      <CoverBackdrop />\n      <Header pageIndex={pageIndex}'],
]
for (const [from, to] of reps) {
  const n = s.split(from).length - 1
  if (n !== 1) throw new Error(`锚点命中 ${n} 次，应为 1：${JSON.stringify(from)}`)
  s = s.replace(from, to)
}
fs.writeFileSync(p, s)
console.log('staged.tsx ok')
EOF
BLOB=$(git hash-object -w .scratch/t6/staged.tsx)
git update-index --cacheinfo 100644,$BLOB,src/screens/PlayDetail/Vertical/index.tsx
git diff --cached -- src/screens/PlayDetail/Vertical/index.tsx
```

Expected：脚本打印 `staged.tsx ok`（两个锚点若命中 0 次或 >1 次会直接抛错，别改锚点凑过）；最后一条命令**只有 2 行 `+`，没有 `-`**，且不出现 `useLyricToolMode` / `setLyricToolMode` / `lyricToolMode` 任何一行。若看到删除行，说明暂存内容被写错了，重来：`git reset -- src/screens/PlayDetail/Vertical/index.tsx`（只重置这一个路径，**禁止**裸 `git reset`）。

然后提交并核对：

```bash
git commit -m "feat(theme): 播放页动态背景（封面莫奈取色）+ 外观设置开关"
git show --stat --oneline HEAD
git status --porcelain -- src/screens/PlayDetail/Vertical/index.tsx
```

Expected：`git show --stat` 里**没有** `package.json`，共 **10 个文件、0 行删除**；`git status --porcelain` 对 `Vertical/index.tsx` 与三个 lang 文件显示 **` M`**（提交后剩下的未暂存差异就是别人的 WIP：Vertical 5+/1−、每个 lang 91+/15−）。`MM` 是**提交前**的状态，别看错。`.scratch/t6/` 用完删掉。

---

## Task 7: 接入 PlayerOverlay（反编译产物，最小改动）

`src/components/player/PlayerOverlay/index.tsx` 顶部注释写明它是从 APK dev bundle 反编译还原的（无 TS 注解，`require` + `jsxRuntime` 手写风格）。**不要重排、不要"顺手改规范"**，只做下面 3 处插入。

**Files:**
- Modify: `src/components/player/PlayerOverlay/index.tsx`（`OverlayBackdrop`，约 126-165 行）

**Interfaces:**
- Consumes: `useCoverSurface()`（Task 6）
- Produces: 无

- [ ] **Step 1: 先读实际代码再改**

```bash
sed -n '124,168p' src/components/player/PlayerOverlay/index.tsx
```

以文件实际缩进/变量名为准做匹配，不要照抄本计划里的行号。

- [ ] **Step 2: 在 `OverlayBackdrop` 里取配色**

在 `var hasBackdropImage = backdropImageSource != null;` 之后插入：

```js
  var coverBackdrop = (0, require("../../../utils/monet/useCoverSurface").useCoverSurface)();
  var coverSurface = hasBackdropImage || !coverBackdrop.enabled ? null : coverBackdrop.surface;
  var coverSource = coverSurface != null && coverBackdrop.picUrl ? {
    uri: coverBackdrop.picUrl.startsWith('/') ? 'file://' + coverBackdrop.picUrl : coverBackdrop.picUrl,
    headers: require("../../common/Image").defaultHeaders,
    cache: 'force-cache'
  } : null;
```

主题自带背景图优先（`hasBackdropImage` 时整条封面取色让路）。

- [ ] **Step 3: 外层底色改用 base**

把该 View 的 `backgroundColor: theme['c-content-background'],`（transform 之前那个）改为：

```js
      backgroundColor: coverSurface != null ? coverSurface.base : theme['c-content-background'],
```

- [ ] **Step 4: children 数组里加模糊封面层，并让蒙版用同一个 base**

把 `children: [ ... ]` 整段替换为：

```js
      children: [hasBackdropImage ? (0, _jsxRuntime.jsx)(_ImageBackground.default, {
        style: _reactNative.StyleSheet.absoluteFill,
        source: backdropImageSource,
        resizeMode: "cover",
        blurRadius: 24
      }) : null, coverSource != null ? (0, _jsxRuntime.jsx)(_ImageBackground.default, {
        style: _reactNative.StyleSheet.absoluteFill,
        source: coverSource,
        resizeMode: "cover",
        blurRadius: 90
      }) : null, (0, _jsxRuntime.jsx)(_reactNative.View, {
        style: [_reactNative.StyleSheet.absoluteFill, {
          backgroundColor: coverSurface != null ? coverSurface.base : theme['c-content-background'],
          opacity: coverSurface != null ? coverSurface.scrimAlpha : hasBackdropImage ? 0.58 : 0.64
        }]
      })]
```

- [ ] **Step 5: 语法与打包验证**

```bash
npx babel --presets module:metro-react-native-babel-preset src/components/player/PlayerOverlay/index.tsx -o /dev/null && echo OK
npm run build-test
```

Expected: `OK` + bundle 成功。若 babel 报 JSX 语法错，说明插入括号不配对，回到 Step 1 重读原文。

- [ ] **Step 6: morph 动画验收移交控制方**

**子代理不碰 adb / 不装机**（同 Task 4 Step 6 约定）。实现者以 Step 5 的 babel + bundle 静态验证为终点，报告里把下面四条逐条标注"未验"，由控制方装机后与用户一起看：① 从底栏点开全屏的 morph 过渡里背景层跟随位移、不闪烁；② 收起回底栏时背景正常淡出；③ 歌词页长按进"复制模式"时整页压暗逻辑不受影响；④ 关掉"动态背景"后与改动前一致。

- [ ] **Step 7: 提交**

```bash
git add src/components/player/PlayerOverlay/index.tsx
git commit -m "feat(theme): PlayerOverlay 展开态背景接入封面莫奈取色"
```

---

## Task 8: 回归 + 收尾

- [ ] **Step 1: 把三个 monet 测试挂进 `npm test`，再跑全量**

`package.json` 的 `test` 脚本行（HEAD 与工作区都只有 1 行，`git show HEAD:package.json` 可取基线）当前**末尾带着别人未提交的 WIP**：工作区比 HEAD 多 ` tests/lyric-copy-text.mts`。直接 `git add package.json` 会把那半行提交进本功能，所以照 Task 1 的做法只暂存自己那一处：

```bash
mkdir -p .scratch
node -e '
const fs = require("fs")
const add = " tests/monet-source-color.mts tests/monet-surface.mts tests/monet-cover-palette.mts"
// 纯文本改那一行：JSON 往返重排会让 diff 变成整文件重写，git apply --cached 的上下文也对不上索引里的原始 blob
const withMonet = (text) => text.replace(/("test": ")([^"]*)(")/, (m, a, body, c) =>
  body.includes("monet-surface.mts") ? m : a + body + add + c)
fs.writeFileSync("package.json", withMonet(fs.readFileSync("package.json", "utf8")))
const head = require("child_process").execSync("git show HEAD:package.json", { encoding: "utf8" })
fs.writeFileSync(".scratch/pkg-head.json", head)
fs.writeFileSync(".scratch/pkg-index.json", withMonet(head))
'
diff -u .scratch/pkg-head.json .scratch/pkg-index.json | sed "1s|.*|--- a/package.json|;2s|.*|+++ b/package.json|" > .scratch/pkg.patch
git apply --cached .scratch/pkg.patch
git diff --cached -- package.json
```

Expected: `git diff --cached` 里**只有 `test` 那一行**，且新增的三个文件名都是 `monet-`，**不出现 `lyric-copy-text.mts`**（上面这段已在本机 `.scratch/pkgcheck/` 空跑过：`grep -c lyric-copy-text .scratch/pkg.patch` = 0，工作区改动是干净的 `14c14` 单行，行数 114 不变，JSON 仍可 parse）。工作区的 `package.json` 此时同时带着别人的 WIP 和这三个文件（`git diff -- package.json` 仍显示 lyric 那半行未暂存）。

跑全量：

```bash
npm test 2>&1 | tail -8
```

Expected: `fail 0`。若 `tests/*.mts` 里出现**改动前就红**的用例，先 `git stash` 之外的方式确认（按文件跑那个用例），记录"既有红"并单独确认，不要顺手改别人的测试。

- [ ] **Step 2: 类型与 lint 对账**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -1
npm run lint
```

Expected: tsc 错误数 ≤ 本机基线 **137**（构成见 Task 6 Step 8：88 条在 `PlayerOverlay/index.tsx` 的别人 WIP、其余是 `tests/*.mts` 的 `as` 断言噪音）；判定按"本功能文件 0 报错"，不是总数归零；lint 无新增 error。

- [ ] **Step 3: 确认工作区没夹带**

```bash
git status --short
```

Expected: 只剩本次无关的既有改动（174 改 + 7 删那批）。**不要** `git add -A`。

- [ ] **Step 4: 更新项目记忆**

在 `C:\Users\30913\.qoder\projects\C--Users-30913-Documents-ChatGPT-music\memory\` 新增 `project-dynamic-background.md`（type: project）：记录"取色内核 = 官方 material-color-utilities，原生只给像素，前景字色不参与"这个架构决定，以及 **vivo 真机验收清单的通过情况**（哪几项已验、哪几项待验）。索引 `MEMORY.md` 加一行。

---

## Self-Review 结论

- **覆盖**：设置开关（T6）、播放页背景（T6）、morph 浮层背景（T7）、取色链路（T3/T4/T5）、对比度防线（T2）、失败回落（T2/T5/T6）、iOS 关闭（T4）、竖屏约束（Global）。
- **占位符**：无 TBD/TODO；唯一"以实际文件为准"的地方是反编译文件的行号匹配，已给出先读后改的步骤。
- **类型一致性**：`CoverSurface = { base, scrimAlpha }` 在 T2 定义、T5/T6/T7 使用；`getArgbPixels` 在 T4 定义、T5 注入；`useCoverSurface` 在 T6 定义、T7 消费。
- **已知坑（写进 T5 正文）**：像素缓存必须独立于配色缓存，否则同一封面在暗/亮主题下会各下载一次。
