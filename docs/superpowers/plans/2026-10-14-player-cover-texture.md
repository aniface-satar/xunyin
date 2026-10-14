# 播放页封面纹理背景（云纹柔光）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把全屏播放页的莫奈动态背景从"重度模糊封面 + 同色蒙版"换成参照图那种**带云纹/大理石纹路的柔光底色**，同时保证任何纹理像素对前景字色的对比度都 ≥ 4.5:1。

**Architecture:** 纹理是一张**运行时在 JS 里生成的位图**：原生像素桥回传封面 ARGB 网格与真实宽高 → 先把封面箱形模糊只留大色块 → 用种子化 fBm 做 domain-warp 采样（形状来自封面自己）→ 把采到的 tone 换成百分位、映进"合法色阶带"（带两端对字色都 ≥4.5:1）→ 彩度按同一百分位反向走 → 132×294 左右 RGBA → pako deflate → 手写最小 PNG → base64 data URI → 普通 `<Image resizeMode="stretch">` 放大铺满。取色与纹理各自按 `url|fontArgb` 缓存；底色先到、纹理后到，纹理没到时保持今天那层模糊封面。

**Tech Stack:** React Native 0.73.11（old arch, Hermes）、TypeScript、Java（`cn.toside.music.mobile.palette`）、`@material/material-color-utilities@0.4.0`（子路径 import）、`pako@^2.1.0`（HEAD 已有）、`node --test --experimental-strip-types`。

**Spec:** `docs/superpowers/specs/2026-10-14-player-dynamic-background-design.md` §7（本计划即其落地方案；§1~§6 是已上线的取色链路，本计划**不改**它的任何判据）
**小样（签字现场）:** `.scratch/preview_choice.png`（五格对照）、`.scratch/preview_texture.mts`（本计划纹理核心的原型）、`.scratch/comp_best.png`（合成到真机截图）

---

## Global Constraints

以下每条都从 spec 或旧计划原文抄来，**逐字生效**，每个任务的验收都隐含这一节。

- **竖屏 only**（AGENTS.md）：不得改 `android/app/src/main/AndroidManifest.xml` 的 `screenOrientation`，不得改 `src/navigation/index.ts` 的 `layout.orientation`，新增组件不得依赖横屏布局或调用 `rn-orientation-locker` 的 landscape 接口。`useDeviceOrientation` 的横屏分支是死代码，不要扩展。
- **前景字色一律沿用 `useTheme()`**，不得由封面色推导。可读性只靠"底色 tone 钳制 + 纹理色阶带"保证。
- **`MIN_CONTRAST` 保持 4.5，本次不动。** spec §7.5 已实测：把闸门降到 2.6 也只把结构 std 上限从 8.1 买到 13.0，参照图要 15.8~18.6（对应暗端对比 1.89/1.32）。所以纵深按天花板收货，不去碰 14 套主题的对比度成果。
- **色彩数学只用官方包，且只能子路径 import**（旧计划 Ruling P4）：一律 `'@material/material-color-utilities/<dir>/<file>.js'`，**禁止包根 import**（包根 import 实测 bundle **+479,461 B**，子路径 **+134,020 B**）。
- **不新增依赖**：`pako@^2.1.0` 在 HEAD 的 `package.json:58` 已存在（Node ESM 具名 import 本机实测可用：`import { deflate } from 'pako'` → `function`）。本计划不 `npm install` 任何东西。
- **不引入 SVG / Skia / GL / fast-image**：本仓库没有混合模式也没有渐变基元，纹理必须是生成的位图。
- **失败即回落 = 整层不渲染**：`resolveCoverBackdrop` 那张决策表不变（`enabled = dynamicBg && !theme['bg-image']`）。**不要**铺常驻不透明底色（旧计划 Ruling P22：会把 black / mid_autumn / naruto / china_ink / happy_new_year 这 5 个主题透出的背景图压平）。
- **纹理存在时不再叠 `scrimAlpha` 蒙版**（spec §7.7）：实测本张专辑 `scrimAlpha = 0.83`，蒙版盖上去等于把纹路压平。蒙版只属于"模糊封面"那条旧路径。
- **被 node 加载的纯逻辑模块，内部相对 import 必须带 `.ts`**（旧计划实测：无扩展名时 `node --test` 报 `ERR_MODULE_NOT_FOUND`，Metro 0.80.12 带扩展名照样解析，tsc 因 `allowImportingTsExtensions: true` 不报 TS5097）。只跑在 RN 里的入口（`index.ts`、`useCoverSurface.ts`、`CoverBackdrop`）沿用仓库惯例：无扩展名 + `@/` 别名，**不要顺手全改**。
- **单测约定**：`tests/*.mts`，`import ... from '../src/xxx/yyy.ts'` 必须带 `.ts`；被测源文件**不得** `import 'react-native'`，不得用 `@/` 别名。跑单文件：`node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/<file>.mts`。
- **提交纪律**：分支 `feat/music-recognition-phase1`，工作区有别人大量未提交 WIP。**禁止 `git add -A` / `git add .` / `git stash` / `git checkout -- <file>` / `git restore` / `git clean` / 裸 `git reset` / `git commit --amend` / `eslint --fix`。** 每次只 add 任务里列出的文件。
  - **已知承重污染**：`package.json`（`test` 脚本行）与 `src/components/player/PlayerOverlay/index.tsx` 各带别人的未提交 WIP（旧计划 Ruling P7）。这两份**改了但不 commit**，做完报告控制方由他决定怎么切分提交。其余本计划要动的文件本机 `git diff` 实测干净（`src/utils/monet/sourceColor.ts` 只有 LF→CRLF 的行尾噪声，无内容差异）。
- **验证产物只写 `.scratch/`**，不要往 `res/` 或仓库根跑 bundle（`res/` 有 13 个被跟踪的 Metro 生成文件，`--assets-dest res` 会重写它们）。
- **子代理一律不得执行 `adb install` / `adb shell`**：真机验收由控制方做（本仓库设备是共享的，注入前必须查前台焦点）。gradle 与 `react-native bundle` 允许。
- **不得批量杀 Node 进程**（禁 `taskkill /F /IM node.exe`）；启动即记 PID，只按 PID 精确停。

### 本计划的实测基线（改动前后的判定值，全部本机跑过）

| 事实 | 数值 | 复现脚本 |
| --- | --- | --- |
| 亮主题字色 `rgb(66,66,66)` 的 tone | 28.0 | `.scratch/real_band_probe.mts` |
| black 暗主题字色 `rgb(219,219,219)` 的 tone | 87.4 | 同上 |
| 合法色阶带（`BAND_HEADROOM=0.1`，anchor 96 / 10） | 亮 [72, 100] 宽 28 / 暗 [0, 36] 宽 36 | 同上 |
| 结构 std 上限（带宽 ÷ √12） | 亮 **8.1** / 暗 **10.4** | 同上 |
| 参照图实测结构 std | muted 15.8 / vivid 18.6 | `.scratch/mock_struct.py` |
| 夹色域会不会破线 | 余量 0：10 例破线（最差 4.495）；余量 0.1：**0 例**，最差 4.632（971,280 例） | `.scratch/gamut_probe.mts` |
| 取色非确定性 | 同一份像素 50 次 → 5 种源色 / 4 种底色 | `.scratch/jitter_probe.mts` |
| 根因位置 | `node_modules/@material/material-color-utilities/quantize/quantizer_wsmeans.js:95` | `grep -n Math.random` |
| tsc 全仓基线 | **137** 条，其中 **88** 条在 `PlayerOverlay/index.tsx` | `npx tsc --noEmit -p tsconfig.json 2>&1 \| grep -c 'error TS'` |
| `npm test` 基线 | **422/422** 通过 | `npm test` |
| PlayerOverlay 的 lint 存量 | 改前 1677 errors + 29 warnings | 旧计划 Task 7 实测 |

## File Structure

**新建（JS，纯逻辑，全部可被 `node --test` 直接加载）**

| 文件 | 唯一职责 |
| --- | --- |
| `src/utils/monet/png.ts` | RGBA 字节 → PNG（CRC32 + IHDR/IDAT/IEND + pako deflate）→ base64 data URI。**只有编码，不含任何色彩判断** |
| `src/utils/monet/texture.ts` | `{封面像素, 色阶带, 输出尺寸}` → RGBA（domain-warp fBm + 秩归一 + 彩度斜坡）→ `buildCoverTexture` 负责分块让出 JS 线程并出 data URI |
| `tests/monet-png.mts` | PNG 编码回环（node zlib 解压 + unfilter 比字节）、CRC、data URI 前缀、1×1 退化 |
| `tests/monet-texture.mts` | 确定性 / 每个 texel 在带内 / 每个 texel 对字色 WCAG ≥4.5 / 灰封面不自染 / 1×1 不产 NaN |
| `tests/monet-tone-band.mts` | 色阶带两端对比度、带宽 ≤ 2×swing、亮暗两套真实字色的带等于实测值 |

**修改**

| 文件 | 改动 | 提交 |
| --- | --- | --- |
| `android/.../palette/PaletteModule.java:85-87` | 结果从 `WritableNativeArray` 改成 `{pixels, width, height}` 的 `WritableNativeMap` | ✅ |
| `src/utils/nativeModules/palette.ts` | 返回类型 `CoverPixels \| null` | ✅ |
| `src/utils/monet/sourceColor.ts` | 导出 `CoverPixels` 接口；量化调用套固定种子（+ 哨兵校验改写生效） | ✅ |
| `src/utils/monet/surface.ts` | 新增 `ToneBand` / `buildToneBand` / `TEXTURE_TONE_SWING` / `BAND_HEADROOM`；`CoverSurface` 加 `band` | ✅ |
| `src/utils/monet/coverPalette.ts` | 取色入参改 `CoverPixels` + 几何自洽校验；新增纹理层（LRU + in-flight 去重 + 随 `clearCache` 作废） | ✅ |
| `src/utils/monet/backdropGate.ts` | 决策表多一个可选入参与 `texture` 出字段 | ✅ |
| `src/utils/monet/useCoverSurface.ts` | 底色先到、纹理后排；纹理按 picUrl 打标；屏幕尺寸走 `useWindowDimensions()` | ✅ |
| `src/utils/monet/index.ts` | 工厂接第二个参数 `buildCoverTexture`；导出 `getCoverTexture` | ✅ |
| `src/components/player/CoverBackdrop/index.tsx` | 纹理层替换"模糊封面 + 蒙版"（纹理没到时保持旧两层） | ✅ |
| `src/components/player/PlayerOverlay/index.tsx:132-161` | `OverlayBackdrop` 同一套三层判断，按反编译风格最小插入 | ❌ 带他人 WIP |
| `tests/monet-cover-palette.mts` | `pixels()` 改对象形状；新增几何非法用例；9 处工厂调用补第二个参数 | ✅ |
| `tests/monet-gate.mts` | `SURFACE` 补 `band` 字段；新增纹理的两行决策表用例 | ✅ |
| `tests/monet-source-color.mts` | 新增确定性 + canary 用例 | ✅ |
| `tests/monet-surface.mts` | 新增 `band` 回归用例 | ✅ |
| `package.json` | `test` 脚本追加 3 个新测试文件 | ❌ 带他人 WIP |
| `docs/superpowers/plans/2026-10-14-player-cover-texture.md` | 本文件 | ✅ |

**明确不动**：`src/screens/PlayDetail/Vertical/index.tsx`（`CoverBackdrop` 已经挂在上面，`:81`）、`src/components/PageContent.tsx`、`src/theme/**`、外观设置里的「动态背景」开关（`theme.dynamicBg` 语义不变）、任何横屏文件。

---

## Task 1: 像素桥回传真实宽高

纹理要在封面上做双线性采样，必须知道网格是 128×128 还是 128×86；今天 `PaletteModule` 只吐一维 `int[]`，行主序但**行宽未知**，猜错就采样成斜纹。

**Files:**
- Modify: `android/app/src/main/java/cn/toside/music/mobile/palette/PaletteModule.java:85-87`
- Modify: `src/utils/nativeModules/palette.ts`（整文件替换）
- Modify: `src/utils/monet/sourceColor.ts`（只加一个导出接口）
- Modify: `src/utils/monet/coverPalette.ts:12`（`fetchPixels` 类型）、`:25-39`（`fetchOnce`）
- Modify: `tests/monet-cover-palette.mts:8`（`pixels()` 工厂）

**Interfaces:**
- Consumes: 无（本任务是链路最上游）
- Produces:
  ```ts
  // src/utils/monet/sourceColor.ts
  export interface CoverPixels {
    pixels: number[]        // ARGB uint32，行主序
    width: number
    height: number
  }
  ```
  `getArgbPixels(url: string, maxSize?: number): Promise<CoverPixels | null>`
  `createCoverPalette(fetchPixels: (url: string) => Promise<CoverPixels | null>)` —— 本任务后仍是**一个**参数，第二个参数在 Task 6 才加。

- [ ] **Step 1: 原生改成回传 map**

`PaletteModule.java` 顶部 import 增加（`WritableNativeArray` 那行留着，还要用）：

```java
import com.facebook.react.bridge.WritableNativeMap;
```

把 `:85-87` 这三行：

```java
        WritableNativeArray result = new WritableNativeArray();
        for (int pixel : pixels) result.pushInt(pixel);
        promise.resolve(result);
```

替换为：

```java
        WritableNativeArray pixelArray = new WritableNativeArray();
        for (int pixel : pixels) pixelArray.pushInt(pixel);
        // 行宽只能在这里拿到：JS 侧只有 length，128×86 的封面被当成 128 行宽采样会斜成条纹。
        WritableNativeMap result = new WritableNativeMap();
        result.putArray("pixels", pixelArray);
        result.putInt("width", scaled.getWidth());
        result.putInt("height", scaled.getHeight());
        promise.resolve(result);
```

`:90-93` 那段 `catch (Throwable t)` 的注释和 `promise.reject("PALETTE_FAILED", ...)` **一字不改**（永不 settle 会毒化像素缓存，那是旧计划钉过的）。

- [ ] **Step 2: 声明 `CoverPixels`**

`src/utils/monet/sourceColor.ts` 在 `export interface CoverAnalysis` **之前**插入：

```ts
/** 原生像素桥的返回值：一维行主序 + 真实行列数（纹理采样必须知道行宽） */
export interface CoverPixels {
  pixels: number[]
  width: number
  height: number
}
```

- [ ] **Step 3: 改 JS 桥**

`src/utils/nativeModules/palette.ts` 整文件替换为：

```ts
import { NativeModules, Platform } from 'react-native'

import type { CoverPixels } from '@/utils/monet/sourceColor'

const { PaletteModule } = NativeModules

export const getArgbPixels = async(url: string, maxSize = 128): Promise<CoverPixels | null> => {
  if (Platform.OS !== 'android' || !PaletteModule?.getArgbPixels) return null
  try {
    return await PaletteModule.getArgbPixels(url, maxSize) as CoverPixels | null
  } catch (e) {
    if (__DEV__) console.log('[palette] getArgbPixels failed', url, e)
    return null
  }
}
```

**桥这一层不做校验**：它无法被 `node --test` 加载（`import 'react-native'`），校验放在 Task 1 Step 4 的 `coverPalette.fetchOnce` —— 那里能用假 fetcher 测到。

- [ ] **Step 4: 写失败测试（几何自洽）**

`tests/monet-cover-palette.mts` 第 8 行的 `pixels()` 工厂替换为：

```ts
const pixels = (argb: number, n = 1000) => ({ pixels: new Array(n).fill(argb >>> 0), width: 40, height: Math.max(1, Math.round(n / 40)) })
```

（40×25=1000 正好自洽。）在同文件末尾追加：

```ts
test('像素几何不自洽（长度 != 宽×高）当取色失败，并且失败照样进缓存', async() => {
  let calls = 0
  const { getCoverSurface } = createCoverPalette(async() => {
    calls += 1
    return { pixels: new Array(999).fill(0xFF808080), width: 40, height: 25 }
  })
  assert.equal(await getCoverSurface('https://example.com/skew.jpg', LIGHT_FONT), null)
  assert.equal(await getCoverSurface('https://example.com/skew.jpg', LIGHT_FONT), null)
  assert.equal(calls, 1)
})

test('宽或高小于 1 的像素当取色失败', async() => {
  let calls = 0
  const { getCoverSurface } = createCoverPalette(async() => {
    calls += 1
    return { pixels: [0xFF808080], width: 0, height: 0 }
  })
  assert.equal(await getCoverSurface('https://example.com/zero.jpg', LIGHT_FONT), null)
  assert.equal(await getCoverSurface('https://example.com/zero.jpg', LIGHT_FONT), null)
  assert.equal(calls, 1)
})
```

- [ ] **Step 5: 跑测试确认失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-cover-palette.mts`
Expected: 两条新用例 **FAIL**（现在不判几何，`999 ≠ 40×25` 也照样返回非 null 底色）；其余既有用例已因 `pixels()` 换形状而 FAIL 在 `analyzeArgbPixels` 收到对象 —— 都属预期红。

- [ ] **Step 6: 在 `fetchOnce` 里收边界**

`src/utils/monet/coverPalette.ts`：第 1~4 行的 import 改成（`CoverPixels` 是类型 import，运行时不留痕）

```ts
import { analyzeArgbPixels, type CoverPixels } from './sourceColor.ts'
```

第 12 行工厂签名：

```ts
export const createCoverPalette = (fetchPixels: (url: string) => Promise<CoverPixels | null>) => {
```

把 `fetchOnce`（`:25-39`）整块替换为：

```ts
  const fetchOnce = async(picUrl: string): Promise<CoverPixels | null> => {
    const cached = pixelCache.get(picUrl)
    if (cached) return cached
    // 取色失败（null）也进缓存，这是 Task 5 第 4 条用例钉住的行为：原生侧是单线程队列，
    // 坏源封面若不缓存就会每跳一次这首歌再排一次失败请求，把当前这首歌的上色挤到一串失败后面。
    // 代价是"瞬时失败即整会话不再上色"，出口在 Task 6：翻动"动态背景"开关时 clearCoverPaletteCache()。
    const task = (async() => {
      try {
        const value = await fetchPixels(picUrl)
        // 原生桥是真实边界：行宽只能在这里自证。长度与宽高不自洽时纹理会跨行采样，
        // 斜纹是"看得见的花屏"，比直接不涂色更难查 —— 不如在这里判成失败走回落。
        if (value == null || !Array.isArray(value.pixels) || value.pixels.length === 0) return null
        if (value.width < 1 || value.height < 1) return null
        return value.pixels.length === value.width * value.height ? value : null
      } catch {
        return null
      }
    })()
    pixelCache.set(picUrl, task)
    pixelOrder.push(picUrl)
    if (pixelOrder.length > PIXEL_LIMIT) {
      const oldest = pixelOrder.shift()!
      if (oldest !== picUrl) pixelCache.delete(oldest)
    }
    return task
  }
```

- [ ] **Step 7: 跑测试确认全绿**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-cover-palette.mts`
Expected: **PASS 11/11**（9 条既有 + 2 条新增）。

- [ ] **Step 8: 两道闸门**

```bash
npx eslint src/utils/monet src/utils/nativeModules/palette.ts --ext .ts
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "monet/|nativeModules/palette"
```
Expected: 两条都**空输出**。全仓 tsc 总数仍 **137**（`npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c 'error TS'`）；变大就是本任务引入了类型错误。**不要**为过 lint 去掉 `async`（`@typescript-eslint/promise-function-async` 是这条链的成因，旧计划已实测）。禁止 `eslint --fix`。

- [ ] **Step 9: 提交**

```bash
git add android/app/src/main/java/cn/toside/music/mobile/palette/PaletteModule.java src/utils/nativeModules/palette.ts src/utils/monet/sourceColor.ts src/utils/monet/coverPalette.ts tests/monet-cover-palette.mts
git commit -m "feat(monet): 像素桥回传封面真实宽高，并挡掉几何不自洽的取色结果"
```

---

## Task 2: 把取色的随机源钉住（修已上线缺陷）

`analyzeArgbPixels` 实测**同一份像素 50 次调用出 5 种源色**，根因是上游 `quantizer_wsmeans.js:95` 用裸 `Math.random()` 分配初始簇（详见 spec §7.6）。纹理层由源色推出色阶带，抖动会被放大成"纹路每次重绘都变"。

**Files:**
- Modify: `src/utils/monet/sourceColor.ts:1-2`（import）、`:38-44`（量化调用）
- Test: `tests/monet-source-color.mts`（追加）

**Interfaces:**
- Consumes: `analyzeArgbPixels(pixels: number[]): CoverAnalysis | null`（签名不变）
- Produces: 同签名，但**同一输入恒定返回同一 `source`**。Task 3/5/6 依赖这个确定性。

- [ ] **Step 1: 写失败测试**

`tests/monet-source-color.mts` 末尾追加：

```ts
test('同一份像素重复取色必须给同一个源色（上游 quantizer_wsmeans 用裸 Math.random）', () => {
  const pixels = mixedPixels()
  const first = analyzeArgbPixels(pixels)!.source
  for (let i = 0; i < 50; i++) {
    assert.equal(analyzeArgbPixels(pixels)!.source, first, `第 ${i + 1} 次取色漂了源色`)
  }
})

test('canary：量化确实在消费 Math.random —— 计数归零就该删掉 seeding 包裹', () => {
  let calls = 0
  const original = Math.random
  Math.random = () => {
    calls += 1
    return original()
  }
  try {
    analyzeArgbPixels(mixedPixels())
  } finally {
    Math.random = original
  }
  // 这条是承重的墓碑用例：@material 的 JS 移植版把随机留在 quantizer_wsmeans.js:95。
  // 哪天上游改成确定性实现，calls 变 0，这里会红 —— 那时请删掉 withSeededRandom，不要留着。
  assert.ok(calls > 0, 'Math.random 未被消费：seeding 包裹已成死代码，删掉 withSeededRandom')
})
```

若该文件里还没有 `mixedPixels()`，用下面这份（多色混合才能把 Wsmeans 的初始簇抖动暴露出来；纯色/两色抖动不出差别）：

```ts
const mixedPixels = () => {
  const out: number[] = []
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const band = (x >> 4) + (y >> 4)
      out.push([0xFFF3DC2F, 0xFF3C5A3E, 0xFF8A2C2C, 0xFF244C6E, 0xFFD8C8A8, 0xFF5A5A5A][band % 6])
    }
  }
  return out
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-source-color.mts`
Expected: 确定性用例 **FAIL**，报错形如 `第 12 次取色漂了源色`（本机实测 50 次里会撞上好几次不同结果）；canary **PASS**（今天的实现本来就在读 `Math.random`）。

- [ ] **Step 3: 最小实现**

`src/utils/monet/sourceColor.ts` 在 `export const QUANTIZE_COLORS = 128` 之后插入：

```ts
const PALETTE_SEED = 20261014

// mulberry32：小、确定、无依赖。这里只求"同一份像素永远同一个结果"。
const mulberry32 = (a: number) => () => {
  a |= 0
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// 改写全局 Math.random 不能靠假设：Hermes/V8 理论上都可写，但用哨兵读回来确认。
// 判成不可写就原样跑 —— 半生效（改了一半、量化读的还是旧的）比不修更糟。
const randomRewritable = (() => {
  const original = Math.random
  try {
    Math.random = () => 0.5
    return Math.random() === 0.5
  } catch {
    return false
  } finally {
    Math.random = original
  }
})()

// 上游 JS 移植版在 quantizer_wsmeans.js:95 用裸 Math.random() 给像素分初始簇，
// 同一份封面实测 50 次出 5 种源色（注释里写的 "reproducible results" 在 JS 版是假的）。
// 量化全程同步，所以窗口里不会漏进别人的随机数。
const withSeededRandom = <T>(fn: () => T): T => {
  if (!randomRewritable) return fn()
  const original = Math.random
  Math.random = mulberry32(PALETTE_SEED)
  try {
    return fn()
  } finally {
    Math.random = original
  }
}
```

把 `:41` 那一行的量化调用改成包一层（**只包这一处**，平均色那几行不需要）：

```ts
  const ranked = withSeededRandom(() => Score.score(QuantizerCelebi.quantize(opaque, QUANTIZE_COLORS), { fallbackColorARGB: average }))
```

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2
Expected: **全部 PASS**，包括 canary（包裹是"临时替换 + 还原"，外层哨兵仍数得到调用）。

- [ ] **Step 5: 全量回归 + 闸门**

```bash
npm test
npx eslint src/utils/monet --ext .ts
```
Expected: `npm test` 全绿（基线 422 + 本任务 2 条）；eslint 空输出。

- [ ] **Step 6: 提交**

```bash
git add src/utils/monet/sourceColor.ts tests/monet-source-color.mts
git commit -m "fix(monet): 取色量化套固定种子，同一张封面不再每次跳出不同底色"
```

---

## Task 3: 从底色导出"合法色阶带"

纹理的明度只能在"对字色仍然 ≥4.5:1"的区间里摆。这个区间今天是隐含的（只有 `buildCoverSurface` 里那一步 tone 钳制），必须显式算出来交给纹理层。

**Files:**
- Modify: `src/utils/monet/surface.ts`（新增导出 + `CoverSurface` 加一个字段）
- Modify: `tests/monet-gate.mts:6`（`SURFACE` 常量补字段，否则 tsc 计数上涨）
- Test: `tests/monet-tone-band.mts`（新建）、`tests/monet-surface.mts`（追加）

**Interfaces:**
- Consumes: `Contrast.ratioOfTones` / `Hct` / `isUsableArgb`（同文件私有）/ `MIN_CONTRAST`
- Produces:
  ```ts
  export interface ToneBand { lo: number; hi: number }
  export const TEXTURE_TONE_SWING = 26
  export const BAND_HEADROOM = 0.1
  export const buildToneBand: (baseArgb: number, fontArgb: number) => ToneBand
  export interface CoverSurface { base: string; scrimAlpha: number; band: ToneBand }
  ```
  `buildCoverSurface` 返回值多一个 `band`（签名不变，仍可能返回 `null`）。

- [ ] **Step 1: 写失败测试**

新建 `tests/monet-tone-band.mts`：

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { Contrast } from '@material/material-color-utilities/contrast/contrast.js'
import { Hct } from '@material/material-color-utilities/hct/hct.js'

import { BAND_HEADROOM, DARK_ANCHOR_TONE, LIGHT_ANCHOR_TONE, MIN_CONTRAST, TEXTURE_TONE_SWING, buildCoverSurface, buildToneBand, parseCssColor } from '../src/utils/monet/surface.ts'

// 仓库 17 套内置主题里 c-font 恒等于 c-850（src/theme/themes/index.ts:77），实测只有两个值
const LIGHT_FONT = parseCssColor('rgb(66,66,66)')!
const DARK_FONT = parseCssColor('rgb(219,219,219)')!
const ORANGE = 0xFFE8551F

test('亮主题的带就是实测那条：[72, 100]，宽 28', () => {
  const band = buildToneBand(Hct.from(Hct.fromInt(ORANGE).hue, 12, LIGHT_ANCHOR_TONE).toInt() >>> 0, LIGHT_FONT)
  assert.equal(band.lo, 72)
  assert.equal(band.hi, 100)
})

test('暗主题的带是 [0, 36]，宽 36（被 swing 而非对比度卡住）', () => {
  const band = buildToneBand(Hct.from(Hct.fromInt(ORANGE).hue, 12, DARK_ANCHOR_TONE).toInt() >>> 0, DARK_FONT)
  assert.equal(band.lo, 0)
  assert.equal(band.hi, 36)
})

test('带的两端对字色都留得住：tone 判据 >= MIN_CONTRAST + BAND_HEADROOM', () => {
  for (const [base, font] of [[LIGHT_ANCHOR_TONE, LIGHT_FONT], [DARK_ANCHOR_TONE, DARK_FONT]] as [number, number][]) {
    const baseArgb = Hct.from(Hct.fromInt(ORANGE).hue, 12, base).toInt() >>> 0
    const band = buildToneBand(baseArgb, font)
    const fontTone = Hct.fromInt(font).tone
    assert.ok(Contrast.ratioOfTones(band.lo, fontTone) >= MIN_CONTRAST + BAND_HEADROOM)
    assert.ok(Contrast.ratioOfTones(band.hi, fontTone) >= MIN_CONTRAST + BAND_HEADROOM)
    // 再往字色那边一步就必须破线，否则说明带宽没吃满
    assert.ok(Contrast.ratioOfTones(band.lo - 1, fontTone) < MIN_CONTRAST + BAND_HEADROOM || band.lo === 0)
    assert.ok(Contrast.ratioOfTones(band.hi + 1, fontTone) < MIN_CONTRAST + BAND_HEADROOM || band.hi === 100)
  }
})

test('带一定包住底色本身，且总宽不超过 2×swing', () => {
  for (const font of [LIGHT_FONT, DARK_FONT]) {
    for (const src of [ORANGE, 0xFFFFFFFF, 0xFF808080, 0xFF123456]) {
      const s = buildCoverSurface(src, src, font)
      if (s == null) continue
      const baseTone = Hct.fromInt(parseCssColor(s.base)!).tone
      assert.ok(s.band.lo <= baseTone + 1e-6 && s.band.hi >= baseTone - 1e-6, `底色 tone ${baseTone} 不在带 ${JSON.stringify(s.band)} 内`)
      assert.ok(s.band.hi - s.band.lo <= TEXTURE_TONE_SWING * 2)
      assert.ok(s.band.lo >= 0 && s.band.hi <= 100)
    }
  }
})

test('非法 argb 不产带（NaN / 带透明通道）', () => {
  const band = buildToneBand(NaN, LIGHT_FONT)
  assert.ok(band.lo === 0 && band.hi === 0)
})
```

`tests/monet-surface.mts` 末尾追加：

```ts
test('buildCoverSurface 交出合法色阶带（纹理层的明度只能在这个区间里摆）', () => {
  const s = buildCoverSurface(ORANGE, ORANGE, LIGHT_FONT)!
  assert.ok(s.band.hi - s.band.lo >= 20, `带宽只有 ${s.band.hi - s.band.lo}，纹理没得摆`)
  for (const t of [s.band.lo, s.band.hi]) {
    assert.ok(Contrast.ratioOfTones(t, Hct.fromInt(LIGHT_FONT).tone) >= MIN_CONTRAST)
  }
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-tone-band.mts tests/monet-surface.mts`
Expected: FAIL —— `buildToneBand` 未导出（`SyntaxError: The requested module ... does not provide an export named 'buildToneBand'`）。

- [ ] **Step 3: 实现**

`src/utils/monet/surface.ts`：`TONE_DRIFT_LIMIT` 那组常量之后插入：

```ts
/** 纹理明度摆幅上限（单边）：超过这个跨度，云纹会盖过"这是同一张封面"的观感 */
export const TEXTURE_TONE_SWING = 26
/** 色域余量：HCT→sRGB 夹色域会把带边缘的 tone 拉回来一点。实测余量 0 时 971,280 例里有 10 例破线（最差 4.495），
 *  留 0.1 之后 0 例破线（最差 4.632），代价只是带宽 29→28。见 spec §7.5。 */
export const BAND_HEADROOM = 0.1

export interface ToneBand {
  lo: number
  hi: number
}
```

`CoverSurface` 接口加字段（注释照抄）：

```ts
export interface CoverSurface {
  /** 铺底色，同时用作蒙版色：保证前景字色始终落在它这一侧 */
  base: string
  /** 蒙版不透明度：封面越亮/越暗（相对底色）越实，限制封面透出的 tone 漂移 */
  scrimAlpha: number
  /** 纹理层可用的明度带：两端对字色都 >= MIN_CONTRAST + BAND_HEADROOM，且包住 base 本身 */
  band: ToneBand
}
```

在 `buildCoverSurface` 之前插入（`isUsableArgb` 已在文件里定义，可直接用）：

```ts
// 从底色往两边各走一步，走到"再走一步就破线"或"走出 swing"为止。
// 上界永远被 tone<=100（纯白）顶死：亮主题的纵深只能从靠字色的那端挖，所以带宽是数学上限，不是手艺差。
export const buildToneBand = (baseArgb: number, fontArgb: number): ToneBand => {
  if (!isUsableArgb(baseArgb) || !isUsableArgb(fontArgb)) return { lo: 0, hi: 0 }
  const fontTone = Hct.fromInt(fontArgb).tone
  const center = Hct.fromInt(baseArgb).tone
  const keeps = (t: number) => Contrast.ratioOfTones(t, fontTone) >= MIN_CONTRAST + BAND_HEADROOM
  let lo = center
  while (lo > 0 && center - lo < TEXTURE_TONE_SWING && keeps(lo - 1)) lo -= 1
  let hi = Math.min(100, center)
  while (hi + 1 <= 100 && hi - center < TEXTURE_TONE_SWING && keeps(hi + 1)) hi += 1
  return { lo, hi }
}
```

`buildCoverSurface` 的 return 改成（`base` 那行已存在，只加 `band`）：

```ts
  return { base: cssRgb(base), scrimAlpha: Number(scrimAlpha.toFixed(2)), band: buildToneBand(base, fontArgb) }
```

- [ ] **Step 4: 补 `tests/monet-gate.mts` 的常量，防 tsc 计数上涨**

第 6 行替换为：

```ts
const SURFACE = { base: 'rgb(240, 244, 249)', scrimAlpha: 0.45, band: { lo: 72, hi: 100 } }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-tone-band.mts tests/monet-surface.mts tests/monet-gate.mts tests/monet-cover-palette.mts`
Expected: 全 PASS。

- [ ] **Step 6: 全量回归 + 两道闸门**

```bash
npm test
npx eslint src/utils/monet --ext .ts
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c 'error TS'
```
Expected: `npm test` 全绿；eslint 空输出；tsc 总数 **137**（`CoverSurface` 多字段会让任何 deepEqual 整个 surface 对象的旧用例红 —— 实测没有这种断言，若真出现请按字段断言改写，不要 `assert.partialDeepEqual`）。

- [ ] **Step 7: 把新测试文件登记进 `npm test`（不提交 package.json）**

`package.json` 的 `test` 脚本末尾（`tests/monet-gate.mts` 之后）追加 ` tests/monet-tone-band.mts`。
**不要 commit `package.json`**：那一行带着别人的未提交 WIP（旧计划 Ruling P7），做完在报告里写清"test 脚本待控制方切分"。

- [ ] **Step 8: 提交（只提交源码与测试）**

```bash
git add src/utils/monet/surface.ts tests/monet-tone-band.mts tests/monet-surface.mts tests/monet-gate.mts
git commit -m "feat(monet): 底色向字色侧导出合法色阶带，纹理明度摆幅有明确边界"
```

---

## Task 4: RGBA → PNG → data URI

没有渐变/混合基元，纹理只能是一张位图；本项目不新增依赖，所以手写最小 PNG 封装（`pako` 已在 HEAD）。

**Files:**
- Create: `src/utils/monet/png.ts`
- Test: `tests/monet-png.mts`

**Interfaces:**
- Consumes: `pako` 的 `deflate`；`import { Buffer } from 'buffer'`（仓库既有惯例：`src/utils/musicSdk/kg/util.js:2` 就是这么引的，Metro 的 `extraNodeModules.buffer` 把它解析到 `@craftzdog/react-native-buffer`，Node 里就是原生 Buffer）
- Produces:
  ```ts
  export const encodePng: (rgba: Uint8Array, width: number, height: number) => Buffer
  export const encodePngDataUri: (rgba: Uint8Array, width: number, height: number) => string
  ```

- [ ] **Step 1: 写失败测试**

新建 `tests/monet-png.mts`：

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'

import { encodePng, encodePngDataUri } from '../src/utils/monet/png.ts'

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

const readChunks = (png: Uint8Array) => {
  const out: { type: string; data: Uint8Array; crc: number }[] = []
  let p = 8
  while (p < png.length) {
    const len = (png[p] << 24 | png[p + 1] << 16 | png[p + 2] << 8 | png[p + 3]) >>> 0
    const type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7])
    const data = png.subarray(p + 8, p + 8 + len)
    const crc = (png[p + 8 + len] << 24 | png[p + 9 + len] << 16 | png[p + 10 + len] << 8 | png[p + 11 + len]) >>> 0
    out.push({ type, data, crc })
    p += 12 + len
  }
  return out
}

// 我们只发 filter type 0（None），所以测试能直接 unfilter 回原字节
const unfilter = (raw: Uint8Array, width: number, height: number) => {
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (width * 4 + 1)], 0, `第 ${y} 行的 filter type 必须是 0`)
    out.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4)
  }
  return out
}

const gradient = (w: number, h: number) => {
  const rgba = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = i & 255
    rgba[i * 4 + 1] = (i * 3) & 255
    rgba[i * 4 + 2] = (i * 7) & 255
    rgba[i * 4 + 3] = 255
  }
  return rgba
}

test('签名 + IHDR 写的是真实尺寸、8 位深度、color type 6（RGBA）', () => {
  const rgba = gradient(6, 11)
  const png = encodePng(rgba, 6, 11)
  assert.deepEqual(Array.from(png.subarray(0, 8)), SIGNATURE)
  const chunks = readChunks(png)
  assert.deepEqual(chunks.map(c => c.type), ['IHDR', 'IDAT', 'IEND'])
  const ihdr = chunks[0].data
  assert.equal((ihdr[0] << 24 | ihdr[1] << 16 | ihdr[2] << 8 | ihdr[3]) >>> 0, 6)
  assert.equal((ihdr[4] << 24 | ihdr[5] << 16 | ihdr[6] << 8 | ihdr[7]) >>> 0, 11)
  assert.equal(ihdr[8], 8)
  assert.equal(ihdr[9], 6)
})

test('IDAT 解压 unfilter 之后与输入逐字节相同', () => {
  const rgba = gradient(6, 11)
  const idat = readChunks(encodePng(rgba, 6, 11))[1].data
  const raw = new Uint8Array(inflateSync(Buffer.from(idat)))
  assert.deepEqual(Array.from(unfilter(raw, 6, 11)), Array.from(rgba))
})

test('每个 chunk 的 CRC 都对得上（写错 CRC 的 PNG 会被解码端整张丢掉）', () => {
  // 与实现同一套多项式的独立实现：不共享代码，才能真正否决实现里写反的 CRC
  const crcOf = (bytes: Uint8Array) => {
    let c = 0xffffffff
    for (const b of bytes) {
      c ^= b
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    return (c ^ 0xffffffff) >>> 0
  }
  const png = encodePng(gradient(4, 4), 4, 4)
  for (const chunk of readChunks(png)) {
    const body = new Uint8Array(4 + chunk.data.length)
    for (let i = 0; i < 4; i++) body[i] = chunk.type.charCodeAt(i)
    body.set(chunk.data, 4)
    assert.equal(crcOf(body).toString(16), chunk.crc.toString(16), `${chunk.type} 的 CRC 不匹配`)
  }
})

test('1×1 退化输入不崩且能解回原字节', () => {
  const one = new Uint8Array([10, 20, 30, 255])
  const png = encodePng(one, 1, 1)
  const raw = new Uint8Array(inflateSync(Buffer.from(readChunks(png)[1].data)))
  assert.deepEqual(Array.from(unfilter(raw, 1, 1)), Array.from(one))
})

test('data URI 前缀与 base64 体（解码回来就是那张 PNG）', () => {
  const rgba = gradient(5, 9)
  const uri = encodePngDataUri(rgba, 5, 9)
  assert.ok(uri.startsWith('data:image/png;base64,'))
  const body = uri.slice('data:image/png;base64,'.length)
  assert.deepEqual(Array.from(Buffer.from(body, 'base64')), Array.from(encodePng(rgba, 5, 9)))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-png.mts`
Expected: FAIL —— `Cannot find module '../src/utils/monet/png.ts'`。

- [ ] **Step 3: 实现**

新建 `src/utils/monet/png.ts`：

```ts
// 这个栈里没有 SVG / Skia / GL，也没有混合模式与渐变基元（spec §7.3），
// 纹理只能是一张运行时生成的位图；而位图要能被 RN 的普通 <Image> 吃掉，就得有合法编码。
// pako（HEAD package.json:58）做 deflate，PNG 封装手写 —— 只发 filter type 0，无需自适应滤波。
import { Buffer } from 'buffer'
import { deflate } from 'pako'

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const writeU32BE = (out: Uint8Array, offset: number, value: number) => {
  out[offset] = (value >>> 24) & 255
  out[offset + 1] = (value >>> 16) & 255
  out[offset + 2] = (value >>> 8) & 255
  out[offset + 3] = value & 255
}

const chunk = (type: string, data: Uint8Array) => {
  const body = new Uint8Array(4 + data.length)
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i)
  body.set(data, 4)
  const out = new Uint8Array(8 + data.length)
  writeU32BE(out, 0, data.length)
  out.set(body, 4)
  writeU32BE(out, 4 + body.length, crc32(body))
  return out
}

export const encodePng = (rgba: Uint8Array, width: number, height: number): Buffer => {
  const stride = width * 4
  const raw = new Uint8Array(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    // 每行首字节是 filter type，0 = None（原样存），所以解码端不需要重建相邻像素
    raw[y * (stride + 1)] = 0
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }

  const ihdr = new Uint8Array(13)
  writeU32BE(ihdr, 0, width)
  writeU32BE(ihdr, 4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA

  const idat = deflate(raw, { level: 9 })
  const parts = [SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const png = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    png.set(part, offset)
    offset += part.length
  }
  return Buffer.from(png)
}

export const encodePngDataUri = (rgba: Uint8Array, width: number, height: number) =>
  `data:image/png;base64,${encodePng(rgba, width, height).toString('base64')}`
```

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2
Expected: **PASS 5/5**。若 CRC 用例红，说明实现里表或初值写反 —— 别改测试迁就实现。

- [ ] **Step 5: 验 Metro 能吃下 pako 与 buffer（本机可复现，不要跳过）**

`src/utils/monet/png.ts` 先临时被 `src/utils/monet/index.ts` 引用会牵动后续任务，所以这里用**探针入口**单独验打包：

```bash
mkdir -p .scratch/texture-probe
printf "import { encodePngDataUri } from './src/utils/monet/png.ts'\nglobal.__probe = encodePngDataUri\nimport 'react-native'" > .scratch/texture-probe/entry.js
npx react-native bundle --platform android --dev false --entry-file .scratch/texture-probe/entry.js --bundle-output .scratch/texture-probe/bundle.android.js --assets-dest .scratch/texture-probe/assets
grep -c "data:image/png;base64," .scratch/texture-probe/bundle.android.js
grep -c "\"pako\"\|pako/lib/deflate" .scratch/texture-probe/bundle.android.js
```
Expected: bundle **exit=0**；两个 grep **都 ≥ 1**（说明 png 编码器与 pako 都真进了模块图，不是被摇掉）。产物只落 `.scratch/`，**不要**用 `npm run build-test`（它会往 `res/` 写）。跑完 `rm -rf .scratch/texture-probe` 只删自己建的这个目录。

- [ ] **Step 6: 闸门 + 提交**

```bash
npx eslint src/utils/monet/png.ts --ext .ts
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-png.mts
git add src/utils/monet/png.ts tests/monet-png.mts
git commit -m "feat(monet): 手写最小 PNG 编码，纹理位图能以 data URI 交给普通 Image"
```
Expected: eslint 空输出；测试全绿。`package.json` 的 `test` 行此时追加 ` tests/monet-png.mts`，**不提交**。

---

## Task 5: 纹理核心（封面结构 → 云纹 RGBA）

**Files:**
- Create: `src/utils/monet/texture.ts`
- Test: `tests/monet-texture.mts`

**Interfaces:**
- Consumes: `CoverPixels`（Task 1）、`ToneBand` / `CHROMA_CAP`（Task 3）、`encodePngDataUri`（Task 4）
- Produces:
  ```ts
  export interface TextureRequest { source: CoverPixels; band: ToneBand; outWidth: number; outHeight: number }
  export const TEXTURE_OUT_HEIGHT = 294
  export const TEXTURE_ROWS_PER_CHUNK = 8
  export const textureWidthFor: (screenWidth: number, screenHeight: number) => number
  export const buildTextureRgba: (request: TextureRequest, yieldRows?: () => Promise<void>) => Promise<Uint8Array>
  export const buildCoverTexture: (request: TextureRequest) => Promise<string>
  ```

- [ ] **Step 1: 写失败测试**

新建 `tests/monet-texture.mts`：

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { Contrast } from '@material/material-color-utilities/contrast/contrast.js'
import { Hct } from '@material/material-color-utilities/hct/hct.js'

import {
  CHROMA_FLOOR,
  COVER_WEIGHT,
  MARBLE_FREQ,
  TEXTURE_OUT_HEIGHT,
  TEXTURE_ROWS_PER_CHUNK,
  WARP_STRENGTH,
  buildTextureRgba,
  textureWidthFor,
} from '../src/utils/monet/texture.ts'
import { MIN_CONTRAST, parseCssColor } from '../src/utils/monet/surface.ts'

const LIGHT_FONT = parseCssColor('rgb(66,66,66)')!
const DARK_FONT = parseCssColor('rgb(219,219,219)')!
const BAND_LIGHT = { lo: 72, hi: 100 }
const BAND_DARK = { lo: 0, hi: 36 }

// 与真机那张专辑同构的假封面：左上暗、右下亮、中间一道暖色带，保证有"结构"可跟
const cover = (w = 32, h = 32) => {
  const pixels: number[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round(40 + 190 * ((x / (w - 1)) * 0.6 + (y / (h - 1)) * 0.4))
      pixels.push((0xff << 24 | Math.min(255, v + 20) << 16 | Math.min(255, v) << 8 | Math.max(0, v - 60)) >>> 0)
    }
  }
  return { pixels, width: w, height: h }
}

const lum = (r: number, g: number, b: number) => {
  const chan = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * chan(r / 255) + 0.7152 * chan(g / 255) + 0.0722 * chan(b / 255)
}
const wcag = (a: number[], b: number[]) => {
  const la = lum(...a)
  const lb = lum(...b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
const argbToRgb = (argb: number) => [(argb >> 16) & 255, (argb >> 8) & 255, argb & 255]
const fontRgb = (argb: number) => argbToRgb(argb >>> 0)

test('同一份输入两次生成逐字节相同（纹理绝不能跟着重绘变样）', async() => {
  const req = { source: cover(), band: BAND_LIGHT, outWidth: 16, outHeight: 36 }
  assert.deepEqual(Array.from(await buildTextureRgba(req)), Array.from(await buildTextureRgba(req)))
})

test('每个 texel 都落在合法色阶带里（允许色域夹断的 tolerance）', async() => {
  const band = BAND_LIGHT
  const rgba = await buildTextureRgba({ source: cover(), band, outWidth: 16, outHeight: 36 })
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < rgba.length; i += 4) {
    const tone = Hct.fromInt((0xff << 24 | rgba[i] << 16 | rgba[i + 1] << 8 | rgba[i + 2]) >>> 0).tone
    assert.ok(tone >= band.lo - 1.5 && tone <= band.hi + 1.5, `tone ${tone} 越界（带 ${band.lo}~${band.hi}）`)
    if (tone < lo) lo = tone
    if (tone > hi) hi = tone
  }
  // 秩归一没做对的话，带会被压到中间一小截
  assert.ok(hi - lo >= (band.hi - band.lo) * 0.8, `实际跨度只有 ${(hi - lo).toFixed(1)}，没吃满合法带 ${(band.hi - band.lo)}`)
})

test('每个 texel 对字色的真实 WCAG 对比度都 >= 4.5（夹色域也算进去了）', async() => {
  for (const [source, band, font] of [
    [cover(), BAND_LIGHT, LIGHT_FONT],
    [cover(), BAND_DARK, DARK_FONT],
    [cover(128, 96), BAND_LIGHT, LIGHT_FONT],
    [cover(96, 128), BAND_DARK, DARK_FONT],
  ] as [ReturnType<typeof cover>, typeof BAND_LIGHT, number][]) {
    const rgba = await buildTextureRgba({ source, band, outWidth: 16, outHeight: 36 })
    const text = fontRgb(font)
    let worst = Infinity
    for (let i = 0; i < rgba.length; i += 4) {
      worst = Math.min(worst, wcag([rgba[i], rgba[i + 1], rgba[i + 2]], text))
    }
    assert.ok(worst >= MIN_CONTRAST, `最差纹理对字色只剩 ${worst.toFixed(3)}（要求 >= ${MIN_CONTRAST}）`)
  }
})

test('灰封面（彩度 0）不会自己染上色', async() => {
  const gray = { pixels: new Array(64 * 64).fill(0xFF808080), width: 64, height: 64 }
  const rgba = await buildTextureRgba({ source: gray, band: BAND_LIGHT, outWidth: 16, outHeight: 36 })
  for (let i = 0; i < rgba.length; i += 4) {
    const hct = Hct.fromInt((0xff << 24 | rgba[i] << 16 | rgba[i + 1] << 8 | rgba[i + 2]) >>> 0)
    assert.ok(hct.chroma < 1.5, `灰封面纹理里冒出彩度 ${hct.chroma.toFixed(2)}`)
  }
})

test('1×1 退化封面不产 NaN，且 alpha 恒 255', async() => {
  const rgba = await buildTextureRgba({ source: { pixels: [0xFFF3DC2F], width: 1, height: 1 }, band: BAND_LIGHT, outWidth: 16, outHeight: 36 })
  assert.equal(rgba.length, 16 * 36 * 4)
  for (let i = 0; i < rgba.length; i += 4) {
    assert.ok(Number.isFinite(rgba[i]) && Number.isFinite(rgba[i + 1]) && Number.isFinite(rgba[i + 2]), `第 ${i / 4} 个 texel 不是有限数`)
    assert.equal(rgba[i + 3], 255)
  }
})

test('分块让路不改变结果（yieldRows 只影响调度，不影响像素）', async() => {
  const req = { source: cover(), band: BAND_LIGHT, outWidth: 17, outHeight: 33 }
  let yields = 0
  const withYield = await buildTextureRgba(req, async() => {
    yields += 1
  })
  const plain = await buildTextureRgba(req)
  assert.deepEqual(Array.from(withYield), Array.from(plain))
  // 17×33：两遍各按 8 行让一次，行数不整除时最后一遍也要让
  assert.ok(yields >= 2 * Math.floor(33 / TEXTURE_ROWS_PER_CHUNK), `只让了 ${yields} 次`)
})

test('输出宽度按屏幕宽高比折算并钳在 [40, 200]', () => {
  assert.equal(textureWidthFor(360, 800), 132)
  assert.equal(textureWidthFor(1080, 2400), 132)
  assert.equal(textureWidthFor(360, 360), TEXTURE_OUT_HEIGHT)
  assert.equal(textureWidthFor(360, 3600), 40)
  assert.equal(textureWidthFor(2000, 800), 200)
})

test('算法常量的取值有实测出处，改动要连 spec 一起（防止有人顺手调着玩）', () => {
  assert.equal(MARBLE_FREQ, 7)
  assert.equal(WARP_STRENGTH, 0.12)
  assert.equal(COVER_WEIGHT, 0.45)
  assert.equal(CHROMA_FLOOR, 0.35)
  assert.equal(TEXTURE_OUT_HEIGHT, 294)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-texture.mts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现纹理核心**

新建 `src/utils/monet/texture.ts`（**每个常数旁边都要留实测出处**，spec §7.4 有账）：

```ts
import { Hct } from '@material/material-color-utilities/hct/hct.js'
import { blueFromArgb, greenFromArgb, redFromArgb } from '@material/material-color-utilities/utils/color_utils.js'

import { encodePngDataUri } from './png.ts'
import type { CoverPixels } from './sourceColor.ts'
import { CHROMA_CAP, type ToneBand } from './surface.ts'

/** 纹理竖边固定 294 texel，横边按屏幕宽高比折算：纹样尺度要跟着屏幕走，不能两张屏幕用同一张位图 */
export const TEXTURE_OUT_HEIGHT = 294
export const TEXTURE_OUT_WIDTH_MIN = 40
export const TEXTURE_OUT_WIDTH_MAX = 200
/** Hermes 上单遍全量要 300~450ms（V8 实测 87ms，Hermes 慢 3~5 倍），会把 morph 动画挤掉帧，所以按行分块让路 */
export const TEXTURE_ROWS_PER_CHUNK = 8
export const TEXTURE_SEED = 20261014
/** 云团尺度：参照图实测自相关长度 ≈ 屏宽 7%，折到这张位图上是约 7 个周期 */
export const MARBLE_FREQ = 7
/** domain-warp 强度：再大形状就散成噪声，再小就只是糊掉的封面 */
export const WARP_STRENGTH = 0.12
/** 封面结构 vs 抽象云纹的混合权重（小样 A：结构为主，换封面要看得出换了） */
export const COVER_WEIGHT = 0.45
/** 彩度下限比例：越亮的 texel 越淡（参照图里越暗的云团越饱和） */
export const CHROMA_FLOOR = 0.35
/** 箱形模糊半径（在 128 网格上）≈ 屏幕 40dp：只留最大的几块明暗团 */
export const COVER_BLUR_RADIUS = 4
const OCTAVES = 6
const FREQ_STEP = 2.03

export interface TextureRequest {
  source: CoverPixels
  /** 来自 buildCoverSurface.band：带内任一端对字色都 >= MIN_CONTRAST */
  band: ToneBand
  outWidth: number
  outHeight: number
}

export const textureWidthFor = (screenWidth: number, screenHeight: number) =>
  Math.max(TEXTURE_OUT_WIDTH_MIN, Math.min(TEXTURE_OUT_WIDTH_MAX, Math.round(TEXTURE_OUT_HEIGHT * screenWidth / screenHeight)))

const smoothStep = (t: number) => t * t * (3 - 2 * t)

const hash2 = (x: number, y: number, seed: number) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

const valueNoise = (x: number, y: number, seed: number) => {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = smoothStep(x - xi)
  const yf = smoothStep(y - yi)
  const a = hash2(xi, yi, seed)
  const b = hash2(xi + 1, yi, seed)
  const c = hash2(xi, yi + 1, seed)
  const d = hash2(xi + 1, yi + 1, seed)
  return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf
}

const fbm = (x: number, y: number, seed: number) => {
  let sum = 0
  let amp = 0.5
  let norm = 0
  let fx = x
  let fy = y
  for (let i = 0; i < OCTAVES; i++) {
    sum += amp * valueNoise(fx, fy, seed + i * 977)
    norm += amp
    amp *= 0.5
    fx *= FREQ_STEP
    fy *= FREQ_STEP
  }
  return sum / norm
}

// 秩归一：把值换成它在这个场里的百分位。不做这一步，映到色阶带时会被封面自身的高光/暗部比例压扁，
// 实测结构对比只剩参照图的一半。divisor 取 max(1, n-1)：1×1 封面会在这里除 0，NaN 一旦进 Hct 就是整屏花。
const buildRank = (values: Float32Array) => {
  const sorted = Float32Array.from(values).sort()
  const divisor = Math.max(1, sorted.length - 1)
  return (v: number) => {
    let lo = 0
    let hi = sorted.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid] < v) lo = mid + 1
      else hi = mid
    }
    return lo / divisor
  }
}

const boxBlur = (src: readonly number[], w: number, h: number, radius: number) => {
  const out = new Int32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sr = 0
      let sg = 0
      let sb = 0
      let n = 0
      for (let dy = -radius; dy <= radius; dy++) {
        const row = Math.min(h - 1, Math.max(0, y + dy)) * w
        for (let dx = -radius; dx <= radius; dx++) {
          const p = (src[Math.min(w - 1, Math.max(0, x + dx))] >>> 0)
          sr += (p >> 16) & 255
          sg += (p >> 8) & 255
          sb += p & 255
          n += 1
        }
      }
      out[y * w + x] = ((255 << 24) | (Math.round(sr / n) << 16) | (Math.round(sg / n) << 8) | Math.round(sb / n)) | 0
    }
  }
  return out
}

const makeCoverSampler = (blurred: Int32Array, w: number, h: number) => {
  const lastX = w - 1
  const lastY = h - 1
  return (u: number, v: number) => {
    const x = Math.min(lastX, Math.max(0, u * lastX))
    const y = Math.min(lastY, Math.max(0, v * lastY))
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const x1 = Math.min(x0 + 1, lastX)
    const y1 = Math.min(y0 + 1, lastY)
    const fx = x - x0
    const fy = y - y0
    const at = (px: number, py: number) => blurred[py * w + px] >>> 0
    const p00 = at(x0, y0)
    const p10 = at(x1, y0)
    const p01 = at(x0, y1)
    const p11 = at(x1, y1)
    const mix = (a: number, b: number, c: number, d: number) => (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
    const r = mix((p00 >> 16) & 255, (p10 >> 16) & 255, (p01 >> 16) & 255, (p11 >> 16) & 255)
    const g = mix((p00 >> 8) & 255, (p10 >> 8) & 255, (p01 >> 8) & 255, (p11 >> 8) & 255)
    const b = mix(p00 & 255, p10 & 255, p01 & 255, p11 & 255)
    return Hct.fromInt(((255 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)) >>> 0)
  }
}

/**
 * 纹理核心：封面结构 + 抽象云纹 → 合法色阶带里的 RGBA。
 * `yieldRows` 每 TEXTURE_ROWS_PER_CHUNK 行调一次；单测不传（结果必须与分块无关）。
 */
export const buildTextureRgba = async(request: TextureRequest, yieldRows?: () => Promise<void>): Promise<Uint8Array> => {
  const { source, band, outWidth, outHeight } = request
  const count = outWidth * outHeight
  const blurred = boxBlur(source.pixels, source.width, source.height, COVER_BLUR_RADIUS)
  const sampleCover = makeCoverSampler(blurred, source.width, source.height)

  // 秩建在"真正被采样的那个场"（糊过的封面）上。小样建在原始场上，
  // 而模糊会把 tone 往均值收，用原始百分位映带就吃不满合法摆幅。
  const fieldTones = new Float32Array(blurred.length)
  for (let i = 0; i < blurred.length; i++) fieldTones[i] = Hct.fromInt(blurred[i] >>> 0).tone
  const coverRank = buildRank(fieldTones)

  const coverRankField = new Float32Array(count)
  const coverHue = new Float32Array(count)
  const coverChroma = new Float32Array(count)
  const marbleRaw = new Float32Array(count)

  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const cx = (x + 0.5) / outWidth
      const cy = (y + 0.5) / outHeight
      // 两路独立 fBm 只用来搅采样坐标（domain warp），第三路才是抽象云纹本体
      const w1 = fbm(cx * MARBLE_FREQ + 3.1, cy * MARBLE_FREQ + 7.7, TEXTURE_SEED) - 0.5
      const w2 = fbm(cx * MARBLE_FREQ + 11.3, cy * MARBLE_FREQ + 2.9, TEXTURE_SEED + 31) - 0.5
      const s = sampleCover(cx + WARP_STRENGTH * w1, cy + WARP_STRENGTH * w2)
      const i = y * outWidth + x
      coverRankField[i] = coverRank(s.tone)
      coverHue[i] = s.hue
      coverChroma[i] = Math.min(s.chroma, CHROMA_CAP)
      marbleRaw[i] = fbm(cx * MARBLE_FREQ + 5.3, cy * MARBLE_FREQ + 9.1, TEXTURE_SEED + 707)
    }
    if (yieldRows != null && (y + 1) % TEXTURE_ROWS_PER_CHUNK === 0) await yieldRows()
  }

  const marbleRank = buildRank(marbleRaw)
  const mixField = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    mixField[i] = COVER_WEIGHT * coverRankField[i] + (1 - COVER_WEIGHT) * marbleRank(marbleRaw[i])
  }
  // 混合值本身再归一一次：两个均匀百分位场一平均就往中间挤，实测带宽从 29 个色阶塌到 17
  const mixRank = buildRank(mixField)

  const rgba = new Uint8Array(count * 4)
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const i = y * outWidth + x
      const n = mixRank(mixField[i])
      const tone = band.lo + n * (band.hi - band.lo)
      const chroma = coverChroma[i] * (CHROMA_FLOOR + (1 - CHROMA_FLOOR) * (1 - n))
      const argb = Hct.from(coverHue[i], chroma, tone).toInt() >>> 0
      const o = i * 4
      rgba[o] = redFromArgb(argb)
      rgba[o + 1] = greenFromArgb(argb)
      rgba[o + 2] = blueFromArgb(argb)
      rgba[o + 3] = 255
    }
    if (yieldRows != null && (y + 1) % TEXTURE_ROWS_PER_CHUNK === 0) await yieldRows()
  }
  return rgba
}

export const buildCoverTexture = async(request: TextureRequest): Promise<string> => {
  const rgba = await buildTextureRgba(request, () => new Promise<void>(resolve => {
    setTimeout(resolve, 0)
  }))
  return encodePngDataUri(rgba, request.outWidth, request.outHeight)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-texture.mts`
Expected: **PASS 8/8**。若「真实 WCAG ≥4.5」那条红了，**不要**放宽断言，先查 `band` 是不是拿到了 Task 3 带 `BAND_HEADROOM` 的带（用 `.scratch/gamut_probe.mts` 复跑）。

- [ ] **Step 5: 用真机那张封面的像素对一遍观感指标（不进仓库，只写 `.scratch/`）**

```bash
MAPPING=stretch node --experimental-strip-types --no-warnings .scratch/preview_texture.mts
python .scratch/tex_stats.py
```
Expected（对照 spec §7.5 的天花板）：结构 std **≥ 7.0**（旧小样实测 7.2，上限 8.1）、饱和度 **≥ 30**、tone p5/p95 覆盖带的 80% 以上。这几个数只用来确认"秩归一改在糊过的场上"没把纵深改没；明显变差就停下报告控制方。

- [ ] **Step 6: 闸门 + 提交**

```bash
npx eslint src/utils/monet/texture.ts --ext .ts
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-png.mts tests/monet-texture.mts
git add src/utils/monet/texture.ts tests/monet-texture.mts
git commit -m "feat(monet): 纹理核心——封面结构经 domain-warp 与秩归一映进合法色阶带"
```
Expected: eslint 空输出；测试全绿。`package.json` 的 `test` 行追加 ` tests/monet-texture.mts`，**不提交**。

---

## Task 6: 纹理缓存层（LRU + in-flight 去重 + 随开关作废）

一张 132×294 的纹理在 Hermes 上约 300~450ms，来回切同一首歌不能重算；翻「动态背景」开关是唯一的失败出口，缓存必须跟着 `clearCache()` 一起失效。

**Files:**
- Modify: `src/utils/monet/coverPalette.ts`（工厂加第二个参数 + 纹理层）
- Modify: `src/utils/monet/index.ts`（接线）
- Modify: `tests/monet-cover-palette.mts`（9 处调用补第二参数 + 新增纹理用例）

**Interfaces:**
- Consumes: `CoverPixels`（Task 1）、`buildCoverSurface` / `parseCssColor`（Task 3，`band` 已在返回值里）、`buildCoverTexture`（Task 5）
- Produces:
  ```ts
  export const TEXTURE_LIMIT = 12
  export const createCoverPalette: (
    fetchPixels: (url: string) => Promise<CoverPixels | null>,
    buildTexture: (request: TextureRequest) => Promise<string | null>,
  ) => {
    getCoverSurface: (picUrl: string | null | undefined, fontColor: string) => Promise<CoverSurface | null>
    getCoverTexture: (picUrl: string | null | undefined, fontColor: string, outWidth: number) => Promise<string | null>
    clearCache: () => void
  }
  // src/utils/monet/index.ts 追加
  export const getCoverTexture: (picUrl: string | null | undefined, fontColor: string, outWidth: number) => Promise<string | null>
  ```
  `outWidth` 由调用方用 `textureWidthFor()` 折算 —— 尺寸是渲染侧的事，缓存层只认这个整数（这样 `coverPalette` 不必 import 重量级的 `texture.ts`）。

- [ ] **Step 1: 写失败测试**

`tests/monet-cover-palette.mts`：把 9 处 `createCoverPalette(async() => ...)` 全部改成 `createCoverPalette(async() => ..., async() => 'data:image/png;base64,AAAA')`（第一个失败用例的 fetcher 保持返回 `null`）。新增：

```ts
const REQ_OK = async() => 'data:image/png;base64,AAAA'

test('纹理按 url|font|outWidth 缓存：同一首歌重复要只生成一次', async() => {
  let builds = 0
  const { getCoverTexture } = createCoverPalette(async() => pixels(RED), async() => {
    builds += 1
    return 'data:image/png;base64,AAAA'
  })
  await getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 132)
  await getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 132)
  assert.equal(builds, 1)
})

test('并发要纹理只生成一次（in-flight 合并）', async() => {
  let builds = 0
  const { getCoverTexture } = createCoverPalette(async() => pixels(RED), async() => {
    builds += 1
    await new Promise(resolve => setTimeout(resolve, 10))
    return 'data:image/png;base64,AAAA'
  })
  const [a, b] = await Promise.all([
    getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 132),
    getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 132),
  ])
  assert.equal(builds, 1)
  assert.equal(a, b)
})

test('输出宽度不同就是两张图，不能复用（横竖屏尺寸不同、折叠屏展开）', async() => {
  let builds = 0
  const { getCoverTexture } = createCoverPalette(async() => pixels(RED), async() => {
    builds += 1
    return `data:image/png;base64,${builds}`
  })
  const wide = await getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 132)
  const narrow = await getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 100)
  assert.equal(builds, 2)
  assert.notEqual(wide, narrow)
})

test('暗/亮主题各自一张：字色变了色阶带就变了，纹理不能共用', async() => {
  let builds = 0
  const { getCoverTexture } = createCoverPalette(async() => pixels(RED), async() => {
    builds += 1
    return `data:image/png;base64,${builds}`
  })
  await getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 132)
  await getCoverTexture('https://example.com/a.jpg', DARK_FONT, 132)
  assert.equal(builds, 2)
})

test('取色失败时绝不跑纹理生成', async() => {
  let builds = 0
  const { getCoverTexture } = createCoverPalette(async() => null, async() => {
    builds += 1
    return 'data:image/png;base64,AAAA'
  })
  assert.equal(await getCoverTexture('https://example.com/bad.jpg', LIGHT_FONT, 132), null)
  assert.equal(builds, 0)
})

test('生成抛错当失败处理并缓存住，不再反复重算', async() => {
  let builds = 0
  const { getCoverTexture } = createCoverPalette(async() => pixels(RED), async() => {
    builds += 1
    throw new Error('encode failed')
  })
  assert.equal(await getCoverTexture('https://example.com/x.jpg', LIGHT_FONT, 132), null)
  assert.equal(await getCoverTexture('https://example.com/x.jpg', LIGHT_FONT, 132), null)
  assert.equal(builds, 1)
})

test('clearCache 之后纹理重新生成（翻开关是取色失败唯一的出口）', async() => {
  let builds = 0
  const { getCoverTexture, clearCache } = createCoverPalette(async() => pixels(RED), async() => {
    builds += 1
    return 'data:image/png;base64,AAAA'
  })
  await getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 132)
  clearCache()
  await getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 132)
  assert.equal(builds, 2)
})

test('clearCache 之后才到达的旧纹理结果不写回缓存（代数判据，和配色层同一套）', async() => {
  let builds = 0
  let release: (v: string) => void = () => {}
  const { getCoverTexture, clearCache } = createCoverPalette(async() => pixels(RED), () => {
    builds += 1
    return new Promise<string>(resolve => {
      release = resolve
    })
  })
  const inFlight = getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 132)
  clearCache()
  release('data:image/png;base64,LATE')
  await inFlight
  // 晚到的那条既不该进缓存，也不该占住 key：下一次调用必须重新生成
  let second = 0
  const { getCoverTexture: again } = createCoverPalette(async() => pixels(RED), async() => {
    second += 1
    return 'data:image/png;base64,B'
  })
  assert.ok(second === 0)
  await again('https://example.com/a.jpg', LIGHT_FONT, 132)
  assert.equal(second, 1)
})

test('纹理层有自己更小的上限（一张 data URI 顶得上一条配色的几十倍）', async() => {
  let builds = 0
  const { getCoverTexture } = createCoverPalette(async() => pixels(GRAY), async() => {
    builds += 1
    return `data:image/png;base64,${builds}`
  })
  for (let i = 0; i < TEXTURE_LIMIT + 1; i++) await getCoverTexture(`https://example.com/${i}.jpg`, LIGHT_FONT, 132)
  assert.equal(builds, TEXTURE_LIMIT + 1)
  // 最早那条已被淘汰，重新要会再生成
  await getCoverTexture('https://example.com/0.jpg', LIGHT_FONT, 132)
  assert.equal(builds, TEXTURE_LIMIT + 2)
  // 最后一张还在
  await getCoverTexture(`https://example.com/${TEXTURE_LIMIT}.jpg`, LIGHT_FONT, 132)
  assert.equal(builds, TEXTURE_LIMIT + 2)
})
```

（顶部 import 补 `TEXTURE_LIMIT`：`import { PIXEL_LIMIT, TEXTURE_LIMIT, createCoverPalette } from '../src/utils/monet/coverPalette.ts'`。`REQ_OK` 若最终没被用到就删掉，别留死常量。）

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-cover-palette.mts`
Expected: FAIL —— `getCoverTexture` 不存在 / `TEXTURE_LIMIT` 未导出。

- [ ] **Step 3: 实现纹理层**

`src/utils/monet/coverPalette.ts` 顶部 import 补类型（**必须是 `import type`**：`texture.ts` 带 pako 与 HCT，运行时无条件拉进来会让这一层变重，而这层的全部价值就是能被 `node --test` 直接加载）：

```ts
import { analyzeArgbPixels, type CoverPixels } from './sourceColor.ts'
import type { TextureRequest } from './texture.ts'
import { buildCoverSurface, parseCssColor, type CoverSurface } from './surface.ts'
```

常量区新增：

```ts
// 纹理层单独一个更小的上限：一条 value 是 132×294 PNG 的 base64（几十 KB），
// 比一条 CoverSurface 贵一个量级以上，60 条就是几 MB 的常驻字符串。
export const TEXTURE_LIMIT = 12
```

工厂签名（第二个参数就是生成器，测试注入假的）：

```ts
export const createCoverPalette = (
  fetchPixels: (url: string) => Promise<CoverPixels | null>,
  buildTexture: (request: TextureRequest) => Promise<string | null>,
) => {
```

在 `pending` 声明之后插入纹理层的容器：

```ts
  const textureCache = new Map<string, string | null>()
  const textureOrder: string[] = []
  const pendingTexture = new Map<string, Promise<string | null>>()
```

在 `paletteKey` 旁边加纹理 key（**读写两处同样只由这一条式子生成**，理由同旧计划对 `paletteKey` 的那段）：

```ts
  // outWidth 进 key：纹理是按屏幕宽高比折算的那张，尺寸变了就是另一张图，复用会把纹路拉歪。
  const textureKeyOf = (picUrl: string, fontArgb: number, outWidth: number) => `${picUrl}|${fontArgb}|${outWidth}`

  const rememberTexture = (key: string, value: string | null) => {
    if (!textureCache.has(key)) {
      textureOrder.push(key)
      if (textureOrder.length > TEXTURE_LIMIT) {
        const oldest = textureOrder.shift()!
        if (oldest !== key) textureCache.delete(oldest)
      }
    }
    textureCache.set(key, value)
  }
```

`load` 之后加 `loadTexture`（注意它复用 `load` 的配色缓存，所以底色一定先到位）：

```ts
  const loadTexture = async(key: string, picUrl: string, fontArgb: number, outWidth: number): Promise<string | null> => {
    if (textureCache.has(key)) return textureCache.get(key)!
    const inFlight = pendingTexture.get(key)
    if (inFlight) return inFlight
    const task = (async() => {
      try {
        const surface = await load(paletteKey(picUrl, fontArgb), picUrl, fontArgb)
        if (surface == null) return null
        const source = await fetchOnce(picUrl)
        if (source == null) return null
        // 色阶带来自同一次配色：带两端都已经过对比度校验，纹理只在这个区间里摆明度
        return await buildTexture({ source, band: surface.band, outWidth, outHeight: TEXTURE_OUT_HEIGHT })
      } catch {
        return null
      } finally {
        pendingTexture.delete(key)
      }
    })()
    pendingTexture.set(key, task)
    return task
  }
```

返回值加 `getCoverTexture`，`clearCache` 里补三行：

```ts
    getCoverTexture: async(picUrl: string | null | undefined, fontColor: string, outWidth: number): Promise<string | null> => {
      if (!picUrl) return null
      const fontArgb = parseCssColor(fontColor)
      if (fontArgb == null) return null
      const key = textureKeyOf(picUrl, fontArgb, outWidth)
      const gen = generation
      return loadTexture(key, picUrl, fontArgb, outWidth).then(uri => {
        // 与配色层同一套代数判据：翻开关 clearCache() 之后晚到的结果必须丢掉，
        // 否则那条 null 会占住 key，把"翻开关重试"这个唯一出口一起废掉。
        if (gen === generation) rememberTexture(key, uri)
        return uri
      })
    },
    clearCache() {
      generation++
      pixelCache.clear()
      pixelOrder.length = 0
      cache.clear()
      cacheOrder.length = 0
      pending.clear()
      textureCache.clear()
      textureOrder.length = 0
      pendingTexture.clear()
    },
```

`src/utils/monet/index.ts` 整文件替换：

```ts
import { getArgbPixels } from '@/utils/nativeModules/palette'
import { buildCoverTexture, TEXTURE_OUT_HEIGHT } from '@/utils/monet/texture'
import { createCoverPalette } from './coverPalette'

export { type CoverSurface } from './surface'
export { textureWidthFor } from '@/utils/monet/texture'

// 直接写 `export const getCoverSurface = palette.getCoverSurface` 会报
// @typescript-eslint/unbound-method（把对象方法当函数引用导出），所以每个导出都包一层箭头。
const palette = createCoverPalette(getArgbPixels, buildCoverTexture)

export const getCoverSurface = async(picUrl: string | null | undefined, fontColor: string) =>
  palette.getCoverSurface(picUrl, fontColor)

export const getCoverTexture = async(picUrl: string | null | undefined, fontColor: string, outWidth: number) =>
  palette.getCoverTexture(picUrl, fontColor, outWidth)

export const clearCoverPaletteCache = () => {
  palette.clearCache()
}

export { TEXTURE_OUT_HEIGHT }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-cover-palette.mts`
Expected: 全 PASS。若「clearCache 之后才到达的旧纹理结果不写回」这条红，说明 `generation` 判据没接上（照抄 `load` 那条的写法，不要自创第二套）。

- [ ] **Step 5: 全量回归 + 闸门**

```bash
npm test
npx eslint src/utils/monet --ext .ts
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "monet/"
```
Expected: 测试全绿（基线 422 + Task 1~6 新增）；两条都空输出；tsc 总数 137。

- [ ] **Step 6: 提交**

```bash
git add src/utils/monet/coverPalette.ts src/utils/monet/index.ts tests/monet-cover-palette.mts
git commit -m "feat(monet): 纹理层缓存与去重，随动态背景开关一起作废"
```

---

## Task 7: 播放页接入纹理（闸门 + hook + CoverBackdrop）

**Files:**
- Modify: `src/utils/monet/backdropGate.ts:13-27`
- Modify: `src/utils/monet/useCoverSurface.ts`（整文件替换）
- Modify: `src/components/player/CoverBackdrop/index.tsx`（整文件替换）
- Test: `tests/monet-gate.mts`（追加 2 条）

**Interfaces:**
- Consumes: `getCoverTexture(picUrl, fontColor, outWidth)` / `textureWidthFor(sw, sh)`（Task 6）、`CoverSurface.band`（Task 3）
- Produces: `CoverBackdropState = { enabled: boolean; picUrl: string | null; surface: CoverSurface | null; texture: string | null }`；`useCoverSurface(): CoverBackdropState`

- [ ] **Step 1: 写失败测试（闸门那两行）**

`tests/monet-gate.mts` 末尾追加：

```ts
test('纹理跟着 surface 同一个闸门：active 为真才交出去，否则恒 null', () => {
  const on = resolveCoverBackdrop(true, false, PIC, SURFACE, 'data:image/png;base64,AAAA')
  assert.equal(on.texture, 'data:image/png;base64,AAAA')

  // 开关关 / 主题自带背景图 / 没封面 / 没配色：四种 inactive 都不许把纹理漏出去
  const cases: [boolean, boolean, string | null, typeof SURFACE][] = [
    [false, false, PIC, SURFACE],
    [true, true, PIC, SURFACE],
    [true, false, null, SURFACE],
    [true, false, PIC, null],
  ]
  for (const [dynamicBg, bgImage, pic, surface] of cases) {
    const s = resolveCoverBackdrop(dynamicBg, bgImage, pic, surface, 'data:image/png;base64,AAAA')
    assert.equal(s.texture, null, `dynamicBg=${dynamicBg} bgImage=${bgImage} pic=${pic} 漏了纹理`)
  }
})

test('不传第五个参数时 texture 为 null（旧调用点行为不变，横屏与旧用例都不受影响）', () => {
  assert.equal(resolveCoverBackdrop(true, false, PIC, SURFACE).texture, null)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-gate.mts`
Expected: FAIL —— `s.texture` 是 `undefined`，不等于 `'data:...'`。

- [ ] **Step 3: 闸门加一行判据**

`src/utils/monet/backdropGate.ts`：

```ts
export interface CoverBackdropState {
  enabled: boolean
  picUrl: string | null
  surface: CoverSurface | null
  /** 已生成的纹理 data URI；闸门不过关时恒 null */
  texture: string | null
}
```

`resolveCoverBackdrop` 签名与 return 改为（第五个参数可选，旧 4 参数调用点不用改）：

```ts
export const resolveCoverBackdrop = (dynamicBg: boolean, hasThemeBgImage: boolean,
  pic: string | null | undefined, surface: CoverSurface | null, texture: string | null = null): CoverBackdropState => {
```

```ts
  return {
    enabled,
    picUrl: active ? pic ?? null : null,
    surface: active ? surface : null,
    texture: active ? texture : null,
  }
```

`:3-4` 那两条关于"PlayerOverlay 不许 import 这里"的注释**原样保留**。

- [ ] **Step 4: hook 接纹理**

`src/utils/monet/useCoverSurface.ts` 整文件替换为：

```ts
import { useEffect, useState } from 'react'
import { useWindowDimensions } from 'react-native'

import { usePlayerMusicInfo } from '@/store/player/hook'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { getCoverSurface, getCoverTexture, textureWidthFor, type CoverSurface } from '@/utils/monet'
import { resolveCoverBackdrop, type CoverBackdropState } from '@/utils/monet/backdropGate'

export const useCoverSurface = (): CoverBackdropState => {
  const dynamicBg = useSettingValue('theme.dynamicBg')
  const theme = useTheme()
  const { pic } = usePlayerMusicInfo()
  const { width, height } = useWindowDimensions()
  const fontColor = theme['c-font']

  const [surface, setSurface] = useState<CoverSurface | null>(null)
  // 打上归属 picUrl：切歌时旧纹理必须立刻在这一帧就不作数，
  // 否则"新歌还没纹理"的那几十毫秒里会拿上一张歌的纹路当背景（纹理是形状，比色偏显眼得多）。
  const [texture, setTexture] = useState<{ picUrl: string; uri: string } | null>(null)

  // 决策表本体在 backdropGate.ts，那张表能用 node --test 直接跑；这里只留订阅与取色副作用
  const outWidth = textureWidthFor(width, height)
  const { enabled, picUrl, surface: coverSurface, texture: gatedTexture } = resolveCoverBackdrop(
    dynamicBg, !!theme['bg-image'], pic, surface, texture?.picUrl === pic ? texture.uri : null)

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

  // 底色先到、纹理后到：纹理要在拿到 band 之后才摆得出来，所以这个 effect 依赖 coverSurface
  useEffect(() => {
    if (!enabled || !pic || coverSurface == null) return
    let cancelled = false
    void getCoverTexture(pic, fontColor, outWidth).then(uri => {
      if (!cancelled && uri != null) setTexture({ picUrl: pic, uri })
    })
    return () => { cancelled = true }
  }, [enabled, pic, fontColor, coverSurface, outWidth])

  return { enabled, picUrl, surface: coverSurface, texture: gatedTexture }
}
```

- [ ] **Step 5: CoverBackdrop 换层**

`src/components/player/CoverBackdrop/index.tsx` 整文件替换（**`if (!active) return null` 上方那两条长注释必须原样保留**，那是旧计划 Ruling P22 的现场说明，只在末尾补一句纹理的）：

```tsx
import { memo, useMemo } from 'react'
import { Image, StyleSheet, View } from 'react-native'

import ImageBackground from '@/components/common/ImageBackground'
import { defaultHeaders } from '@/components/common/Image'
import { useCoverSurface } from '@/utils/monet/useCoverSurface'

const BLUR_RADIUS = 90

export default memo(() => {
  const { picUrl, surface, texture } = useCoverSurface()
  const active = surface != null

  const source = useMemo(() => (active && picUrl
    ? {
        uri: picUrl.startsWith('/') ? 'file://' + picUrl : picUrl,
        headers: defaultHeaders,
        cache: 'force-cache' as const,
      }
    : null), [active, picUrl])

  // （保留原有两条长注释：没上色就整层不存在 / 不要铺常驻不透明底色，Ruling P22）
  // 纹理到位之后换成一层生成的位图，并且**不再叠 scrimAlpha 蒙版**：
  // 实测这张专辑 scrimAlpha = 0.83，蒙版压上去等于把刚做出来的纹路抹平（spec §7.7）。
  if (!active) return null

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: surface.base }]} pointerEvents="none">
      {
        texture != null ? (
          <Image style={StyleSheet.absoluteFill} source={{ uri: texture }} resizeMode="stretch" />
        ) : source ? (
          <>
            <ImageBackground style={StyleSheet.absoluteFill} source={source} resizeMode="cover" blurRadius={BLUR_RADIUS} />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: surface.base, opacity: surface.scrimAlpha }]} />
          </>
        ) : null
      }
    </View>
  )
})
```

- [ ] **Step 6: 跑测试 + 三道闸门**

```bash
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-gate.mts
npx eslint src/utils/monet src/components/player/CoverBackdrop --ext .ts,.tsx
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "monet|CoverBackdrop"
npx react-native bundle --platform android --dev true --entry-file index.js --bundle-output .scratch/texture-bundle.js --assets-dest .scratch/texture-assets
```
Expected: 测试全绿；两条 grep 都**空输出**；bundle **exit=0**（证明 `useCoverSurface` → `texture.ts` → `png.ts` → `pako` 这条链 Metro 真能打包）。`grep -c "data:image/png;base64," .scratch/texture-bundle.js` ≥ 1。跑完 `rm -rf .scratch/texture-bundle.js .scratch/texture-assets`（只删自己造的）。

- [ ] **Step 7: 提交**

```bash
git add src/utils/monet/backdropGate.ts src/utils/monet/useCoverSurface.ts src/components/player/CoverBackdrop/index.tsx tests/monet-gate.mts
git commit -m "feat(monet): 播放页背景改用生成的云纹位图，纹理到位前保持模糊封面"
```

---

## Task 8: `OverlayBackdrop` 接入（反编译文件最小插入）

展开态（全屏播放页）实际由 `src/components/player/PlayerOverlay/index.tsx:126-163` 那个 `OverlayBackdrop` 画，播放页静态层在它下面。**这个文件是从 APK 反编译还原的**（`var` + 双引号 `require()` + 分号 + 无尾逗号），改动只能按它的风格做最小插入。

**Files:**
- Modify: `src/components/player/PlayerOverlay/index.tsx:132-161`

**Interfaces:**
- Consumes: `useCoverSurface()` 的新出字段 `texture`（Task 7）、`getBackdropFrame(winWidth, winHeight)`（不变）
- Produces: 无新导出

- [ ] **Step 1: 记录改动前的两道基线计数（必须动手前先跑）**

```bash
mkdir -p .scratch/t8
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "'error TS'" > /dev/null
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c 'error TS' | tee .scratch/t8/tsc_before.txt
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c 'PlayerOverlay/index.tsx' | tee .scratch/t8/tsc_before_file.txt
npx eslint src/components/player/PlayerOverlay/index.tsx --format json -o .scratch/t8/eslint_before.json
node -e "const r=require('./.scratch/t8/eslint_before.json');const m=r[0].messages;console.log('problems', r[0].errorCount+r[0].warningCount, 'rules', [...new Set(m.map(x=>x.ruleId).filter(Boolean))].join(','))"
```
Expected: 本机实测 **总数 137**、**本文件 88**、eslint **1677 errors + 29 warnings**、rule 类别就是旧计划 Task 7 记下的那 5 条（`no-var` / `@typescript-eslint/no-var-requires` / `@typescript-eslint/quotes` / `@typescript-eslint/semi` / `comma-dangle`）。数字对不上就先停下：说明工作区被别人动过，报告控制方。

- [ ] **Step 2: 按反编译风格插入**

`:132-138` 这段（原样，只多一行 `coverTexture`）：

```js
var coverBackdrop = (0, require("../../../utils/monet/useCoverSurface").useCoverSurface)();
var coverSurface = hasBackdropImage || !coverBackdrop.enabled ? null : coverBackdrop.surface;
var coverTexture = coverSurface != null ? coverBackdrop.texture : null;
var coverSource = coverSurface != null && coverBackdrop.picUrl ? {
uri: coverBackdrop.picUrl.startsWith('/') ? 'file://' + coverBackdrop.picUrl : coverBackdrop.picUrl,
headers: require("../../common/Image").defaultHeaders,
cache: 'force-cache'
} : null;
```

`:144-161` 的 `children:` 数组整块替换为（三层顺序：**纹理存在 → 只铺纹理；否则 → 模糊封面 + 同色蒙版**）：

```js
children: (0, _jsxRuntime.jsxs)(_jsxRuntime.Fragment, {
children: [hasBackdropImage ? (0, _jsxRuntime.jsx)(_ImageBackground.default, {
style: _reactNative.StyleSheet.absoluteFill,
source: backdropImageSource,
resizeMode: "cover",
blurRadius: 24
}) : null, coverTexture != null ? (0, _jsxRuntime.jsx)(_reactNative.Image, {
style: _reactNative.StyleSheet.absoluteFill,
source: {
uri: coverTexture
},
resizeMode: "stretch"
}) : coverSource != null ? (0, _jsxRuntime.jsx)(_ImageBackground.default, {
style: _reactNative.StyleSheet.absoluteFill,
source: coverSource,
resizeMode: "cover",
blurRadius: 90
}) : null, coverTexture != null ? null : (0, _jsxRuntime.jsx)(_reactNative.View, {
style: [_reactNative.StyleSheet.absoluteFill, {
backgroundColor: coverSurface != null ? coverSurface.base : theme['c-content-background'],
opacity: coverSurface != null ? coverSurface.scrimAlpha : hasBackdropImage ? 0.58 : 0.64
}]
})]
})
```

`Animated.View` 的 `style`（`:141-143`）**一字不改**：`getBackdropFrame(winWidth, winHeight)` 那个"铺满卡片整块"的盒是上一个 bug 的修复成果（真机验过），动了就会退回"只盖顶部 400px 色带"。

- [ ] **Step 3: 闸门计数比对**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c 'error TS' | tee .scratch/t8/tsc_after.txt
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c 'PlayerOverlay/index.tsx' | tee .scratch/t8/tsc_after_file.txt
npx eslint src/components/player/PlayerOverlay/index.tsx --format json -o .scratch/t8/eslint_after.json
node -e "
const before=require('./.scratch/t8/eslint_before.json')[0];
const after=require('./.scratch/t8/eslint_after.json')[0];
const rules=m=>[...new Set(m.map(x=>x.ruleId).filter(Boolean))];
const added=rules(after.messages).filter(r=>!rules(before.messages).includes(r));
console.log('problems before/after', before.errorCount+before.warningCount, after.errorCount+after.warningCount);
console.log('新增 rule 类别:', added.join(',') || '(无)');
"
npx react-native bundle --platform android --dev true --entry-file index.js --bundle-output .scratch/t8/bundle.js --assets-dest .scratch/t8/assets
```
Expected:
- tsc **总数仍 137、本文件仍 88**（旧计划实测：这个文件的插入不会新增 tsc 错误，因为插入的全是 `var` 与无注解调用）。变大了就是插入里写了 TS 风格的代码，按报错行改回反编译风格。
- eslint 的 **problems 允许上涨**（这个文件全文靠存量风格活着，插 12 行必然再摊上十几条），真正的闸门是最后打印的 **「新增 rule 类别: (无)」**。出现任何新 ruleId 说明写法跳出文件风格 —— 按旧计划 Task 7 的裁定：不得改成 `const`/单引号/去分号来迎合 lint，也**不得**加 `eslint-disable`，**禁止 `--fix`**（一次改 1445 行）。
- bundle **exit=0**。

- [ ] **Step 4: 不要提交**

`src/components/player/PlayerOverlay/index.tsx` 带别人的未提交 WIP（旧计划 Ruling P7 同款问题）。**跳过 commit**，在报告里写：本功能对该文件的插入位于 `:132` 与 `:144-161`，与 WIP 混在同一文件，需控制方切分。

---

## Task 9: 回归收尾 + 真机验收清单移交

**Files:**
- Modify: `package.json`（`test` 脚本登记 3 个新测试文件，**不提交**）

- [ ] **Step 1: 全量回归**

```bash
npm test 2>&1 | tail -15
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c 'error TS'
npx eslint src/utils/monet src/utils/nativeModules/palette.ts src/components/player/CoverBackdrop src/utils/monet/png.ts src/utils/monet/texture.ts --ext .ts,.tsx
```
Expected: 测试 **0 fail**（基线 422 + 本计划新增约 30 条，pass 数只增不减）；tsc **137**；eslint **空输出**。

- [ ] **Step 2: 把本功能碰过的文件做一次自查（不碰别人的 WIP）**

```bash
git status --porcelain -- package.json src/components/player/PlayerOverlay/index.tsx src/utils/monet android/app/src/main/java/cn/toside/music/mobile/palette tests
```
Expected: 未提交的只剩 **`package.json`** 与 **`src/components/player/PlayerOverlay/index.tsx`** 这两处（都因带他人 WIP 故意不 commit）。若还有别的本功能文件是 ` M`，说明漏提交，补 `git add <那个文件>` + 一次新 commit（不得 `git add -A`）。

- [ ] **Step 3: 装机前的包（允许 gradle，真机注入由控制方做）**

```bash
cd android && gradlew.bat assembleDebug
```
Expected: `BUILD SUCCESSFUL`。**不得**由子代理执行 `adb install` / `adb shell`。

- [ ] **Step 4: 真机清单（控制方执行；①~⑦ 沿用旧计划，⑧~⑬ 是本计划新增）**

- ①~⑦：旧计划 Task 8 的七条原文照跑（⑤ 要在 black / mid_autumn / naruto / china_ink / happy_new_year 五个带背景图的主题各看一次；⑥ 从进播放页到上色计时）
- ⑧ **data URI 到底渲不渲染**（本机未验证，spec §7.7）：开纹理后全屏播放页应看到云纹，而不是一片纯色。若是一片纯色 → 先查 `console` 有无图片解码报错，然后**报告控制方**；不要自行改成 RNFS 落文件（那会换掉缓存设计）
- ⑨ **同一首歌反复进出播放页**：底色与纹路都完全不变（这条同时验收 Task 2 的取色抖动修复）
- ⑩ **底色先到、纹理后到**：进播放页应先看到底色（+ 短暂模糊封面），几百毫秒内换成云纹，中间不闪白、不闪纯色
- ⑪ **纹理存在时不许再有蒙版压层**（spec §7.7）：纹路的明暗起伏要肉眼看得出来；如果看起来仍像"一片均匀的色"，说明 `scrimAlpha` 层漏在了纹理上面（两处组件都要查）
- ⑫ **快速连切 10 首歌不掉帧**：分块生成期间 morph 动画仍顺（`TEXTURE_ROWS_PER_CHUNK=8` 是按 Hermes 估的，真机若仍卡，把这一处改 4 并在报告里写明耗时）
- ⑬ **暗主题（black）比亮主题纹理更深**是预期（色阶带 36 vs 28，spec §7.5），不要当成 bug 去"抹平"
- ⑭ 关掉「动态背景」后与改动前逐像素一致（闸门未变，回归旧 ① 的判据）

- [ ] **Step 5: 更新项目记忆 + 报告**

把实测结论写进 `C:\Users\30913\.qoder\projects\C--Users-30913-Documents-ChatGPT-music\memory\project-dynamic-background-design.md`（纹理形态、色阶带天花板、取色抖动修法、data URI 是否可用、测试/tsc 计数）。merge / push **属于要停下问用户的动作**，本计划不做。

---

## Self-Review（写完本计划后本机复核）

- **spec §7 的每条要求都能指到任务**：形态与算法 → Task 5；色阶带与 `MIN_CONTRAST` 不动 → Task 3；`scrimAlpha` 让位 → Task 7/8；取色非确定性修法（含哨兵与 canary）→ Task 2；像素几何 → Task 1；缓存与开关作废 → Task 6；data URI 编码与 Metro 可行性 → Task 4；验收增补 → Task 9 Step 4。无遗漏。
- **无占位**：全文没有 TBD / "适当处理" / "同 Task N"；所有代码块都是要落进文件的原文。
- **类型对得上**：`CoverPixels`（Task 1 定义 → Task 5/6 消费）、`ToneBand` / `CoverSurface.band`（Task 3 → Task 5/6）、`TextureRequest`（Task 5 → Task 6）、`getCoverTexture(picUrl, fontColor, outWidth)`（Task 6 → Task 7）、`CoverBackdropState.texture`（Task 7 → Task 8）逐字一致。
- **已知未验证项只有一处**，且已明写为真机闸门：data URI 在 RN 0.73 Android 上能否渲染（Task 9 ⑧）。它不在 JS 侧能证，计划里禁止执行者自行换方案。
