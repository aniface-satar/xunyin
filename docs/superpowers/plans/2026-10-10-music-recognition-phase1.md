# 听歌识曲第一期（网易云引擎 + 原生录音）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在识曲页点一下按钮，录 8 秒环境音，把识别出的歌名与歌手直接显示在识曲页的结果卡上（2026-10-10 用户拍板：不再把结果送进搜索结果列表）。

**Architecture:** 原生 `AudioRecordModule`（Java）做唯一一次 48kHz 单声道 PCM16 采集并以 base64 返回；TS 纯函数把窗口抽取成 8kHz 指纹输入；隐藏 WebView 加载随 APK 分发的网易专有 `afp.wasm` + 打了三处补丁的 ISC 胶水算出约 2KB 指纹；`httpFetch` 免密钥 POST 网易识曲接口；结果按「歌名 + 歌手」落到现成跨源搜索链路。调度层（引擎数组、每日限流、指数退避、静态 JSON 热更新 + 域名白名单）全部写成可单测的纯函数。

**Tech Stack:** React Native 0.73.11 + Hermes、Java（Android 原生层，仓库里没有任何 .kt）、`react-native-webview@13.6.4`（本期新增）、`react-native-fs`、`react-native-quick-base64`、`node --test --experimental-strip-types`。

**Spec:** `docs/superpowers/specs/2026-10-10-music-recognition-design.md`（执行时与代码一起读；下方「与 spec 的偏差」是已经做过的取舍，不要再重新论证）

## Global Constraints

- **竖屏锁定（AGENTS.md）**：不得修改 `android/app/src/main/AndroidManifest.xml` 里 MainActivity 的 `android:screenOrientation="portrait"`；不得修改 `src/navigation/index.ts` 中 `Navigation.setDefaultOptions` 的 `layout.orientation: ['portrait']`；新增页面不得依赖横屏布局、不得调用 `rn-orientation-locker` 的 landscape 接口。本期所有改动都不碰方向相关 API。
- **平台范围**：只做 Android。iOS 本期不接（`ios/LxMusicMobile/Info.plist` 的 `NSMicrophoneUsageDescription` 推到 iOS 期）。JS 侧用 `isAudioRecordSupported()` 做闸门，iOS 走「识别还没接入」文案。
- **新增运行时依赖只有一个**：`react-native-webview@13.6.4`（13.x 里与 RN 0.73 发布期最接近的版本，2024-01-02 发布）。除此之外不装任何新包。
- **隐私硬要求**：只上传指纹（约 2KB），永不上传录音；不在磁盘上留录音文件；只在用户主动点击后开始采集，到达设定时长立刻 `stop()` + `release()`。
- **纯逻辑模块的依赖纪律**：凡是 `tests/*.mts` 要直接 import 的模块（`pcmSplitter.ts`、`ncmApi.ts`、`limiter.ts`、`remoteConfig.ts`、`provider.ts`、`types.ts`）**不得 `import '@/...'`，不得 import 任何 react-native 原生包**。原因：`npm test` 用 `node --test --experimental-strip-types` 直接跑 `.ts`，路径别名与原生模块都解析不了。
- **WebView 桥只能传字符串**：`injectJavaScript` / `postMessage` 的载荷一律是 JSON 或 base64 字符串；`Float32Array`/`Int16Array` 必须在 WebView 上下文内构造。已实测：把宿主 realm 的 `Float32Array` 传进 wasm 绑定会 `BindingError: Cannot pass non-string to std::string`。
- **引擎入参的采样率契约**：`RecognizeEngine.recognize(pcm)` 收到的是**已经抽到 8kHz 的识别窗口**（`WINDOW_LEN_SECONDS = 6`，即 48000 个 Int16 样本），不是原始 48kHz 采集。这条契约跨 Task 1/5/7/8 四个任务，任何一处按 48k 处理都会把采样率搞错一个数量级，识别率归零且不报错。
- **只允许一次音频采集**：Android 10 起同一设备开第二个 `AudioRecord` 客户端在相当一部分机型上会被静音或降权。所有下游格式都从这一次采集降采样，不许「每个引擎各录一次」。
- **调试日志**：任何新增 `console.log` 必须包在 `if (__DEV__) { ... }` 里（release 的 babel 没有 `transform-remove-console`，不门控就会打进产物）。`.js` 文件里用 `__DEV__` 要加 `/* global __DEV__ */`；`.ts`/`.tsx` 不需要。
- **UI 约定**：尺寸数值写在 `createStyle({...})` 里（自动缩放）；颜色只用主题 `c-*` 键（`c-primary`、`c-primary-background`、`c-primary-font`、`c-button-background`、`c-font`、`c-font-label`、`c-300`、`c-border-background`）；文案一律 `t('key')` 且三份语言文件键数齐平；面向用户的措辞用日常语言，不出现「指纹」「urlencoded」「DSP」「服务方」这类术语；失败文案不写成服务承诺。
- **提交纪律**：本工作区当前有 170+ 未提交改动（推荐功能 WIP、图标资源等）。每个任务只 `git add <明确路径>`，**禁止 `git add -A` / `git add .`**。提交后用 `git status --porcelain | wc -l` 核对减少项数 == 本次提交文件数。
- **eslint 范围**：`npm run lint` 的 `--ext` 是 `.js,.jsx,.ts,.tsx`，**不覆盖 `tests/*.mts`**；所以测试文件里的 `as unknown as` 之类写法不受 lint 约束，但 src 文件受。`curly: all` 规则要求所有 if/for 带花括号。
- **验证闸门（每个任务都要跑，判据是数字不是观感）**：
  - `npx tsc --noEmit 2>&1 | tail -1`：错误数必须**等于 Task 0 记录的基线**（历史基线 107，以当场实测为准）
  - `npm run lint`：新增/修改的 src 文件零 error
  - `npm test`：全绿（含本期新增的 5 个测试文件）
  - 动到原生的任务另加 `cd android && ./gradlew.bat assembleDebug` 成功
  - 动到 RN 代码的任务末尾加 Metro 打包检查（命令见 Task 9 Step 4）

## 前置阻塞项（开工前必须由用户拍板，不属于任何任务）

1. **`china_ink.jpg` 的删除**。工作区有未提交删除：`src/theme/themes/images/china_ink.jpg`、`res/drawable-mdpi/src_theme_themes_images_china_ink.jpg`、`android/app/src/main/res/drawable-mdpi/src_theme_themes_images_china_ink.jpg`。而 `src/theme/themes/index.ts:11` 仍在 `require('./images/china_ink.jpg')`、`createThemes.js:288` 仍生成该主题 —— **不解决则 Metro 打包与 `assembleDebug` 直接失败**。恢复命令：
   ```bash
   git checkout -- src/theme/themes/images/china_ink.jpg \
     res/drawable-mdpi/src_theme_themes_images_china_ink.jpg \
     android/app/src/main/res/drawable-mdpi/src_theme_themes_images_china_ink.jpg
   ```
   执行者**不要擅自运行**：这属于用户进行中的改动。开工前先把状态报给用户，拿到答复再继续。
2. 没有真机就验不了的部分：麦克风实际采集、WebView 里 `WebAssembly.instantiate` 的成功率（OPPO PCHM10 / Android 11 的系统 WebView 是重点）、Hermes 上的端到端耗时。这些集中在 Task 9 Step 5 的真机清单，**不许拿单测结论代替**。

## 与 spec 的偏差（已定的取舍，实现时在提交信息里复述，Task 9 统一回写 spec）

| spec 条目 | spec 原话 | 本期实际 | 理由 |
| --- | --- | --- | --- |
| §4.1 | 原生模块用 Kotlin | 用 **Java** | 仓库 `android/app/src/main/java/` 下**没有任何 .kt 文件**，全部 Package/Module 都是 Java；引 Kotlin 要动 `build.gradle` 的插件配置 |
| §4.1 | 原生把 PCM 写进 cache 文件，JS 用 RNFS 读 | 原生**直接 resolve base64 字符串** | 省掉临时文件、RNFS 读、unlink 清理三处可失败点；8 秒 48kHz 单声道 = 768KB → base64 约 1MB，一次性桥接可接受 |
| §4.6 | 新建 `src/store/musicRecognition/{state,action,hook}.ts` | **不建 store**，状态机留在 `RecognizePanel` 的 `useState` | 识曲状态只有识曲页一个消费者，建 store 是无消费者的间接层；本项目 store 范式只在跨界面共享时用 |
| §6 路径 1 | 命中后用网易歌曲 ID 直连 `wy/musicInfo.js` 生成 musicInfo | 本期统一走 §6 路径 2（跨源文本搜索） | ID 精确置顶要把结果列表反过来喂给 `MusicList`，改动面积超过收益；`neteaseSongId` 仍解析并保留在 `RecognizedSong` 里，后续接置顶只改一处 |
| §7 | 拒绝授权时跳系统设置 | 只给一次性文字说明 | 仓库没有通用 `openAppSetting` 原生绑定（只有 `BatteryOptimizationUtil` / `NotificationPermissionUtil` 两个专用入口），为它新增原生方法不属于本期 |
| §4.5 | 调度层 B → A 串行降级 | 引擎数组**只注册 ncm 一个** | spec §10 本身把 ShazamEngine 排第二期；数组与降级逻辑本期就实现，并用假引擎测出「命中短路 / 抛异常降级」两条性质；二期只加一个元素 |
| §4.2 | B 路输出 Float32Array(8kHz) | B 路输出 **Int16Array(8kHz)**，`/32768` 归一化在 WebView 内做 | 桥只传字符串，int16 比 float32 少一半体积且无损（源头本来就是 int16）；Task 2 的离线对拍证明两条路径指纹逐字节相同 |

---

### Task 0: 记录三条闸门的当场基线

**Files:** 无（只读，不提交）

**Interfaces:**
- Produces: 三个数字 —— `TSC_BASELINE`（tsc 错误数）、`TEST_TAIL`（npm test 末行摘要）、`LINT_TAIL`（lint 摘要）、`DIRTY_COUNT`（`git status --porcelain | wc -l`）。后续 8 个任务的闸门以它们为准。

- [ ] **Step 1: 记录工作区脏度**

```bash
git status --porcelain | wc -l
```
记下数字。后续每次提交后重跑，**减少的数量必须等于本次 `git add` 的文件数**；不相等说明误提交了别人的改动。

- [ ] **Step 2: 记录 tsc 基线**

Run: `npx tsc --noEmit 2>&1 | tail -1`
Expected: 形如 `Found 107 errors in ...`。记下这个数字，别沿用文档里的 107。

- [ ] **Step 3: 跑现有测试**

Run: `npm test 2>&1 | tail -6`
Expected: `# fail 0`

- [ ] **Step 4: 跑 lint**

Run: `npm run lint 2>&1 | tail -8`
Expected: 记下既有噪音规模。判据是「**新增文件不产生 error**」，不是「输出为空」。

- [ ] **Step 5: 不提交任何东西**，把四个数字汇报给用户后再进入 Task 1。

---

### Task 1: PCM 抽取纯函数 `pcmSplitter.ts`

**Files:**
- Create: `src/core/musicRecognition/pcmSplitter.ts`
- Test: `tests/music-recognition-pcm-splitter.mts`
- Modify: `package.json`（`scripts.test` 追加新测试路径）

**Interfaces:**
- Consumes: 无
- Produces:
  - `NCM_SAMPLE_RATE = 48000`、`NCM_TARGET_RATE = 8000`、`LISTEN_SECONDS = 8`、`WINDOW_FROM_SECONDS = 1`、`WINDOW_LEN_SECONDS = 6`
  - `decimateTo8k(pcm: Int16Array, sampleRate: number, fromSeconds: number, lenSeconds: number): Int16Array`
  - `toLittleEndianBytes(samples: Int16Array): Uint8Array`

  Task 2 的胶水对拍、Task 8 的面板都消费这两个函数与五个常量。

- [ ] **Step 1: 写失败测试**

创建 `tests/music-recognition-pcm-splitter.mts`：

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NCM_SAMPLE_RATE,
  NCM_TARGET_RATE,
  WINDOW_FROM_SECONDS,
  WINDOW_LEN_SECONDS,
  decimateTo8k,
  toLittleEndianBytes,
} from '../src/core/musicRecognition/pcmSplitter.ts'

// 上游胶水 toNCMBuffer 的取样公式：json[now] = buf[now * sampleRate / 8000 + from * sampleRate]
// 这里独立复写一遍公式，作为被测实现的参照物
const glueReference = (pcm: Int16Array, sampleRate: number, fromSeconds: number, lenSeconds: number): Int16Array => {
  const out = new Int16Array(lenSeconds * NCM_TARGET_RATE)
  for (let now = 0; now < lenSeconds * NCM_TARGET_RATE; now++) {
    out[now] = pcm[now * sampleRate / NCM_TARGET_RATE + fromSeconds * sampleRate]
  }
  return out
}

const makeRamp = (length: number): Int16Array => {
  const pcm = new Int16Array(length)
  for (let i = 0; i < length; i++) pcm[i] = (i % 65536) - 32768
  return pcm
}

test('48k -> 8k 的取样索引与上游胶水公式逐点相等', () => {
  const pcm = makeRamp(8 * NCM_SAMPLE_RATE)
  const actual = decimateTo8k(pcm, NCM_SAMPLE_RATE, WINDOW_FROM_SECONDS, WINDOW_LEN_SECONDS)
  const expected = glueReference(pcm, NCM_SAMPLE_RATE, WINDOW_FROM_SECONDS, WINDOW_LEN_SECONDS)
  assert.equal(actual.length, WINDOW_LEN_SECONDS * NCM_TARGET_RATE)
  assert.deepEqual(Array.from(actual), Array.from(expected))
})

test('跳过的秒数确实被跳过：from=0 与 from=1 不同，且 from=1 从第 48000 个样本开始', () => {
  const pcm = makeRamp(8 * NCM_SAMPLE_RATE)
  const from0 = decimateTo8k(pcm, NCM_SAMPLE_RATE, 0, 1)
  const from1 = decimateTo8k(pcm, NCM_SAMPLE_RATE, 1, 1)
  assert.equal(from1[0], pcm[NCM_SAMPLE_RATE])
  assert.notEqual(from0[0], from1[0])
})

test('最短的负值 -32768 不被截断或溢出', () => {
  const pcm = new Int16Array(6 * NCM_SAMPLE_RATE).fill(-32768)
  const out = decimateTo8k(pcm, NCM_SAMPLE_RATE, 0, 6)
  assert.equal(out[0], -32768)
  assert.equal(out[out.length - 1], -32768)
})

test('录音比窗口短的部分补 0，不越界读取', () => {
  const pcm = new Int16Array(2 * NCM_SAMPLE_RATE).fill(1234)
  const out = decimateTo8k(pcm, NCM_SAMPLE_RATE, 1, 6)
  // from=1s、len=6s 需要覆盖到第 7 秒，只有前 1 秒有数据
  assert.equal(out[0], 1234)
  assert.equal(out[NCM_TARGET_RATE - 1], 1234)
  assert.equal(out[NCM_TARGET_RATE], 0)
  assert.equal(out[out.length - 1], 0)
})

test('输出是小端 Int16 字节，不依赖宿主字节序', () => {
  const bytes = toLittleEndianBytes(new Int16Array([-2, 1, -32768, 32767]))
  assert.deepEqual(Array.from(bytes), [0xfe, 0xff, 0x01, 0x00, 0x00, 0x80, 0xff, 0x7f])
})

test('空输入返回全 0 的定长窗口', () => {
  const out = decimateTo8k(new Int16Array(0), NCM_SAMPLE_RATE, 0, 6)
  assert.equal(out.length, WINDOW_LEN_SECONDS * NCM_TARGET_RATE)
  assert.equal(out[0], 0)
})
```

- [ ] **Step 2: 跑到失败**

Run: `node --test --experimental-strip-types tests/music-recognition-pcm-splitter.mts`
Expected: FAIL，报 `Cannot find module .../pcmSplitter.ts`

- [ ] **Step 3: 写实现**

创建 `src/core/musicRecognition/pcmSplitter.ts`：

```ts
// 48kHz 单声道 PCM16 -> 网易指纹输入的纯降采样。
// 抽取公式必须与上游胶水 toNCMBuffer 逐点一致：out[i] = pcm[from * rate + i * (rate / 8000)]。
// 改了这里等于改了喂给 afp.wasm 的样本顺序，识别会静默变差，不会报错。
export const NCM_SAMPLE_RATE = 48000
export const NCM_TARGET_RATE = 8000
export const LISTEN_SECONDS = 8
export const WINDOW_FROM_SECONDS = 1
export const WINDOW_LEN_SECONDS = 6

export const decimateTo8k = (pcm: Int16Array, sampleRate: number, fromSeconds: number, lenSeconds: number): Int16Array => {
  const step = Math.round(sampleRate / NCM_TARGET_RATE)
  const start = fromSeconds * sampleRate
  const out = new Int16Array(lenSeconds * NCM_TARGET_RATE)
  for (let i = 0; i < out.length; i++) {
    const index = start + i * step
    out[i] = index < pcm.length ? pcm[index] : 0
  }
  return out
}

export const toLittleEndianBytes = (samples: Int16Array): Uint8Array => {
  const view = new DataView(new ArrayBuffer(samples.length * 2))
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i], true)
  return new Uint8Array(view.buffer)
}
```

- [ ] **Step 4: 跑到通过**

Run: `node --test --experimental-strip-types tests/music-recognition-pcm-splitter.mts`
Expected: `# pass 6` / `# fail 0`

- [ ] **Step 5: 挂进 `npm test`**

Modify `package.json`：在 `scripts.test` 末尾（`tests/export-save-path.test.mts` 之后）追加 `tests/music-recognition-pcm-splitter.mts`。

Run: `npm test 2>&1 | tail -4`
Expected: `# fail 0`

- [ ] **Step 6: 闸门 + 提交**

```bash
npx tsc --noEmit 2>&1 | tail -1
npm run lint 2>&1 | grep -E "pcmSplitter" || echo "clean"
git add src/core/musicRecognition/pcmSplitter.ts tests/music-recognition-pcm-splitter.mts package.json package-lock.json
git commit -m "feat(recognition): 48k PCM 抽取 8k 指纹输入的纯函数"
git status --porcelain | wc -l
```
Expected: tsc 数 == `TSC_BASELINE`；`grep pcmSplitter` 输出 `clean`；脏度计数比 Task 0 少 2～3。

---

### Task 2: 供应商资产脚本 + 胶水指纹对拍测试

把网易专有 `afp.wasm` 与 ISC 胶水固化进仓库（用户已拍板接受其法律暴露面），并把「TS 抽取 → base64 传输 → WebView 内还原」这条链在**无设备条件下**证真或证伪。

**Files:**
- Create: `scripts/vendor-recognition-assets.mjs`
- Create（脚本生成，需提交）: `android/app/src/main/assets/recognition/afp.wasm`（231,182 B）
- Create（脚本生成，需提交）: `android/app/src/main/assets/recognition/afp-glue.js`
- Modify: `android/app/build.gradle`（`defaultConfig` 之后插入 `androidResources`，原第 118 行后）
- Test: `tests/music-recognition-afp-glue.mts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1 的 `decimateTo8k`、`toLittleEndianBytes`
- Produces: `afp-glue.js` 在浏览器式上下文里求值后暴露
  - `module.exports.Encode(audiodata, from, len, channel)` —— 上游原样，只用于对拍
  - `module.exports.Encode8kB64(samplesB64: string): Promise<string>` —— 本期生产路径，吃 8kHz Int16 LE 的 base64
  - 求值前必须已存在全局 `__AFP_URL__`（wasm 的 data URL）

- [ ] **Step 1: 写供应商脚本**

创建 `scripts/vendor-recognition-assets.mjs`：

```js
// 把网易识曲所需的 wasm 与胶水固化进 android assets。
// 上游包 ncm-audio-recognize 是 ISC 许可（可自由修改分发），但它是 node CJS 包，
// 在 React Native 的 WebView 里跑不起来，所以这里只做三处机械补丁（锚点不命中就当场炸）：
//   1. 去掉顶层 require('fs' / 'path' / 'crypto')
//   2. wasm 路径从 path.join(__dirname) 改成读全局 __AFP_URL__
//   3. 追加 Encode8kB64 导出，直接吃 8kHz Int16 LE 的 base64
// 产物是提交进仓库的静态文件。重新生成请跑 `node scripts/vendor-recognition-assets.mjs`。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const PKG_SPEC = 'ncm-audio-recognize@1.4.0'
const EXPECTED_WASM_BYTES = 231_182
const TMP_DIR = '.tmp-vendor-afp'
const OUT_DIR = path.join('android', 'app', 'src', 'main', 'assets', 'recognition')

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform == 'win32' })

fs.rmSync(TMP_DIR, { recursive: true, force: true })
fs.mkdirSync(TMP_DIR, { recursive: true })
run('npm', ['pack', PKG_SPEC, '--pack-destination', TMP_DIR])
const tgz = fs.readdirSync(TMP_DIR).find(f => f.endsWith('.tgz'))
if (!tgz) throw new Error('npm pack 没有产出 tgz')
run('tar', ['-xzf', path.join(TMP_DIR, tgz), '-C', TMP_DIR])

const srcDir = path.join(TMP_DIR, 'package', 'src')
const wasm = fs.readFileSync(path.join(srcDir, 'afp.wasm'))
if (wasm.length != EXPECTED_WASM_BYTES) {
  throw new Error(`afp.wasm 体积变了：${wasm.length} != ${EXPECTED_WASM_BYTES}，先确认上游改了什么再放行`)
}

let glue = fs.readFileSync(path.join(srcDir, 'sandbox.bundle.cjs'), 'utf8')
const patch = (anchor, replacement) => {
  if (!glue.includes(anchor)) throw new Error(`补丁锚点没命中，说明上游源码变了：${anchor.slice(0, 48)}`)
  glue = glue.replace(anchor, replacement)
}

patch("const fs = require('fs')\n", '')
patch("const path = require('path')\n", '')
patch("const crypto = require('crypto')\n", '')

patch(
  'tt(Q = "/afp.wasm") || (Q = function (t) {\n' +
  '                return path.join(__dirname, "afp.wasm")\n' +
  '            }(Q));',
  'Q = __AFP_URL__;',
)

patch(
  'module.exports = {\n' +
  '    Encode: (audiodata, from, len, channel = 0) => {\n' +
  '        return NeteaseRecordArrayToBase64(toNCMBuffer(audiodata, from, len, channel))\n' +
  '    }\n' +
  '};',
  'module.exports = {\n' +
  '    Encode: (audiodata, from, len, channel = 0) => {\n' +
  '        return NeteaseRecordArrayToBase64(toNCMBuffer(audiodata, from, len, channel))\n' +
  '    },\n' +
  '    Encode8kB64: (samplesB64) => {\n' +
  '        const bin = atob(samplesB64)\n' +
  '        const bytes = new Uint8Array(bin.length)\n' +
  '        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)\n' +
  '        const i16 = new Int16Array(bytes.buffer)\n' +
  '        const json = {}\n' +
  '        for (let i = 0; i < i16.length; i++) json[i] = i16[i] / 32768\n' +
  '        return NeteaseRecordArrayToBase64(json)\n' +
  '    }\n' +
  '};',
)

const header = [
  '/*',
  ' * 听歌识曲 wasm 胶水，由 scripts/vendor-recognition-assets.mjs 生成，请勿手改。',
  ' * 来源：npm 包 ' + PKG_SPEC + ' 的 src/sandbox.bundle.cjs（ISC 许可）。',
  ' * 相对上游只有三处补丁：剥掉 node 的 fs/path/crypto；wasm 改从全局 __AFP_URL__ 取；',
  ' * 追加 Encode8kB64 直接吃 8kHz Int16 LE 的 base64。',
  ' * 同目录的 afp.wasm 是网易专有二进制，不随本文件的许可授权。',
  ' */',
  '',
].join('\n')

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(path.join(OUT_DIR, 'afp.wasm'), wasm)
fs.writeFileSync(path.join(OUT_DIR, 'afp-glue.js'), header + glue)
fs.rmSync(TMP_DIR, { recursive: true, force: true })
console.log('wrote ' + path.join(OUT_DIR, 'afp.wasm') + ' (' + wasm.length + ' bytes) and afp-glue.js (' + (header + glue).length + ' bytes)')
```

- [ ] **Step 2: 生成资产**

Run: `node scripts/vendor-recognition-assets.mjs`
Expected: `wrote android/app/src/main/assets/recognition/afp.wasm (231182 bytes) and afp-glue.js (89... bytes)`，且 `.tmp-vendor-afp` 已被脚本自己删掉。
（前置：npm registry 可达。本机 2026-10-10 实测 `npm pack ncm-audio-recognize@1.4.0` 产出 112,624 B 的 tgz、含 6 个文件；`afp.wasm` 231,182 B、`sandbox.bundle.cjs` 88,208 B、license ISC。）
若报 `补丁锚点没命中` —— **停下汇报**，不要改锚点凑过生成步骤。

- [ ] **Step 3: 让 wasm 在 APK 里不被压缩**

`react-native-fs` 的 `readFileAssets` 用 `InputStream.available()` 决定缓冲区大小，assets 被 aapt 压缩时这个值不可靠。
Modify `android/app/build.gradle`，在 `defaultConfig { ... }` 的收尾 `}`（原第 118 行）之后插入：

```groovy
    // RNFS.readFileAssets sizes its buffer with InputStream.available(), which can
    // under-report for compressed assets. Keep the recognition wasm stored.
    androidResources {
        noCompress 'wasm'
    }
```

- [ ] **Step 4: 写胶水对拍测试**

创建 `tests/music-recognition-afp-glue.mts`：

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import {
  NCM_SAMPLE_RATE,
  WINDOW_FROM_SECONDS,
  WINDOW_LEN_SECONDS,
  decimateTo8k,
  toLittleEndianBytes,
} from '../src/core/musicRecognition/pcmSplitter.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const assetDir = path.join(here, '..', 'android', 'app', 'src', 'main', 'assets', 'recognition')
const wasmBytes = new Uint8Array(fs.readFileSync(path.join(assetDir, 'afp.wasm')))
const glueSource = fs.readFileSync(path.join(assetDir, 'afp-glue.js'), 'utf8')
const wasmDataUrl = 'data:application/octet-stream;base64,' + Buffer.from(wasmBytes).toString('base64')

interface GlueApi {
  Encode: (audiodata: unknown, from: number, len: number, channel: number) => Promise<string>
  Encode8kB64: (samplesB64: string) => Promise<string>
}

// 模拟 WebView 的宿主环境：有 window / WebAssembly / atob / fetch，没有 process / fs / path
const loadGlue = (): GlueApi => {
  const host: Record<string, unknown> = {
    window: {},
    WebAssembly,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout,
    setInterval,
    clearInterval,
    clearTimeout,
    TextDecoder,
    TextEncoder,
    crypto: {
      getRandomValues: (buffer: Uint8Array) => {
        for (let i = 0; i < buffer.length; i++) buffer[i] = Math.floor(Math.random() * 256)
        return buffer
      },
    },
    btoa: (data: string) => Buffer.from(data, 'binary').toString('base64'),
    atob: (b64: string) => Buffer.from(b64, 'base64').toString('binary'),
    __AFP_URL__: wasmDataUrl,
    fetch: async(url: unknown) => {
      if (String(url).startsWith('data:')) return { ok: true, arrayBuffer: async() => Uint8Array.from(wasmBytes).buffer }
      throw new Error('unexpected fetch target: ' + String(url))
    },
  }
  host.globalThis = host
  const context = vm.createContext(host)
  const mod: { exports: GlueApi } = { exports: {} as GlueApi }
  vm.runInContext('(function(module, exports, require){' + glueSource + '\n})', context, { filename: 'afp-glue.js' })(
    mod,
    mod.exports,
    () => { throw new Error('require is not available in the webview sandbox') },
  )
  return mod.exports
}

// 三个叠加正弦，保证有峰值可提取（纯静音会被胶水的 byteLength <= 64 判据拒掉）
const makeTone = (seconds: number): Int16Array => {
  const pcm = new Int16Array(seconds * NCM_SAMPLE_RATE)
  for (let i = 0; i < pcm.length; i++) {
    const t = i / NCM_SAMPLE_RATE
    const v = Math.sin(2 * Math.PI * 440 * t) * 0.35 +
      Math.sin(2 * Math.PI * 1320 * t) * 0.25 +
      Math.sin(2 * Math.PI * 5200 * t) * 0.15
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)))
  }
  return pcm
}

const floatOf = (pcm: Int16Array): Float32Array => {
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768
  return out
}

const base64Of = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

test('vendored 胶水已经剥掉 node 运行时依赖', () => {
  assert.doesNotMatch(glueSource, /require\(/)
  assert.doesNotMatch(glueSource, /__dirname/)
  assert.match(glueSource, /__AFP_URL__/)
  assert.match(glueSource, /Encode8kB64/)
})

test('afp.wasm 体积没有被改动', () => {
  assert.equal(wasmBytes.length, 231_182)
})

test('RN 侧抽取 + base64 传输 + WebView 还原，与上游 Encode 产出逐字节相同的指纹', { timeout: 120_000 }, async() => {
  const api = loadGlue()
  const pcm = makeTone(WINDOW_FROM_SECONDS + WINDOW_LEN_SECONDS)

  // 参照路径：完全走上游 48k AudioBuffer 接口（本机 spike 已实测该路径能被服务端接受）
  const floats = floatOf(pcm)
  const audiodata = {
    sampleRate: NCM_SAMPLE_RATE,
    length: floats.length,
    numberOfChannels: 1,
    getChannelData: () => floats,
  }
  const expected = await api.Encode(audiodata, WINDOW_FROM_SECONDS, WINDOW_LEN_SECONDS, 0)
  assert.ok(expected.length > 200, '参照指纹过短，wasm 可能没跑起来')

  // 生产路径：TS 抽到 8k -> 小端字节 -> base64 -> WebView 内还原
  const window8k = decimateTo8k(pcm, NCM_SAMPLE_RATE, WINDOW_FROM_SECONDS, WINDOW_LEN_SECONDS)
  const actual = await api.Encode8kB64(base64Of(toLittleEndianBytes(window8k)))

  assert.equal(actual, expected)
})
```

- [ ] **Step 5: 跑到通过**

Run: `node --test --experimental-strip-types tests/music-recognition-afp-glue.mts`
Expected: `# pass 3` / `# fail 0`。第三条相等即同时证明：wasm 能在没有 `AudioContext`/`navigator` 的环境里 instantiate、TS 的抽取索引正确、小端编码与 `/32768` 归一化正确、WebView 侧的还原路径与上游算法等价。
若第 1 条因残留 `require(` 而红 —— **停下汇报**，说明上游包体积/内容变了，不能靠放宽断言放行。

- [ ] **Step 6: 一次性联网复核（不进仓库、不挂测试）**

指纹对拍不等于接口仍然可用。用刚生成的胶手打一次真接口，确认 2026-10-10 的结论没过期：

```bash
node -e "
const fs=require('node:fs'),vm=require('node:vm');
const wasm=new Uint8Array(fs.readFileSync('android/app/src/main/assets/recognition/afp.wasm'));
const glue=fs.readFileSync('android/app/src/main/assets/recognition/afp-glue.js','utf8');
const host={window:{},WebAssembly,console,setInterval,clearInterval,setTimeout,clearTimeout,TextDecoder,TextEncoder,
  crypto:{getRandomValues:b=>{for(let i=0;i<b.length;i++)b[i]=(Math.random()*256)|0;return b}},
  btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),
  __AFP_URL__:'data:application/octet-stream;base64,'+Buffer.from(wasm).toString('base64'),
  fetch:async()=>({ok:true,arrayBuffer:async()=>Uint8Array.from(wasm).buffer})};
host.globalThis=host;const ctx=vm.createContext(host);const m={exports:{}};
vm.runInContext('(function(module,exports,require){'+glue+chr(10)+'})',ctx)(m,m.exports,()=>{throw new Error('no require')});
const pcm=new Int16Array(6*8000);
for(let i=0;i<pcm.length;i++){const t=i/8000;const v=Math.sin(2*Math.PI*392*t)*0.4+Math.sin(2*Math.PI*880*t)*0.3+Math.sin(2*Math.PI*1960*t)*0.2;pcm[i]=Math.max(-32768,Math.min(32767,Math.round(v*32767)))}
m.exports.Encode8kB64(Buffer.from(pcm.buffer).toString('base64')).then(async raw=>{
  const body=new URLSearchParams({sessionId:'probe-'+Date.now(),algorithmCode:'shazam_v2',duration:'6',rawdata:raw,times:'2',decrypt:'1'});
  const r=await fetch('https://interface.music.163.com/api/music/audio/match',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});
  const j=await r.json();
  console.log('fingerprint',(raw.length/1024).toFixed(1)+'KB','http',r.status,'code',j.code,'resultLen',Array.isArray(j?.data?.result)?j.data.result.length:null,'noMatchReason',j?.data?.noMatchReason??null);
}).catch(e=>{console.log('FAILED',String(e))});
"
```
（`chr(10)` 是 bash 双引号里的换行占位，实际执行时用 `'\n'` 的字面反斜杠写法：`'(function(module,exports,require){'+glue+String.fromCharCode(10)+'})'`。这只是一次性脚本，照抄时以能跑通为准。）

Expected: 打印 `fingerprint ~2KB http 200 code 200`。合成正弦音命中不了真实曲库，`resultLen 0` 或带 `noMatchReason` **是正常结果**；本步只验两件事：指纹体积落在 2KB 量级（说明 wasm 真跑了）+ 接口仍然免密钥应答。
若 `http` 不是 200、`code` 变成 `-462`、或返回要求鉴权 —— **立即停下汇报**，这是 spec §9 第一行风险成真，本期方案的前提没了。

- [ ] **Step 7: 挂测试并跑全量**

在 `package.json` 的 `scripts.test` 追加 `tests/music-recognition-afp-glue.mts`。
Run: `npm test 2>&1 | tail -4`
Expected: `# fail 0`

- [ ] **Step 8: 闸门 + 提交**

```bash
npx tsc --noEmit 2>&1 | tail -1
git add scripts/vendor-recognition-assets.mjs \
  android/app/src/main/assets/recognition/afp.wasm \
  android/app/src/main/assets/recognition/afp-glue.js \
  android/app/build.gradle \
  tests/music-recognition-afp-glue.mts package.json package-lock.json
git commit -m "feat(recognition): 固化网易 wasm 与打补丁胶水，并加离线指纹对拍"
git status --porcelain
```
Expected: tsc 数不变；`git status` 里不再出现 `recognition/afp.wasm`（说明 231KB 二进制确实被跟踪，没被 .gitignore 吃掉）。若被忽略，检查 `.gitignore` 并**报告给用户**再决定，不要擅自改忽略规则。

---

### Task 3: 网易识曲接口的请求构造与响应解析 `ncmApi.ts`

**Files:**
- Create: `src/core/musicRecognition/ncmApi.ts`
- Test: `tests/music-recognition-ncm-api.mts`
- Modify: `package.json`

**Interfaces:**
- Consumes: 无（零依赖纯函数）
- Produces:
  - `MATCH_ENDPOINT: string`
  - `interface MatchForm { sessionId, algorithmCode, duration, rawdata, times, decrypt }`（全部 `string`）
  - `buildMatchForm(rawdata: string, durationSeconds: number, sessionId: string): MatchForm`
  - `createSessionId(random?: () => number): string`
  - `parseMatchResponse(body: unknown): RecognizedSong | null`（`RecognizedSong` 在 Task 3 本地声明，Task 5 搬到 `types.ts` 再 re-export）

- [ ] **Step 1: 写失败测试**

创建 `tests/music-recognition-ncm-api.mts`：

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MATCH_ENDPOINT,
  buildMatchForm,
  createSessionId,
  parseMatchResponse,
} from '../src/core/musicRecognition/ncmApi.ts'

// 2026-10-10 本机实测响应（浆果 - TINY7），字段形状按原样保留、无关字段删掉
const hitResponse = {
  code: 200,
  data: {
    result: [
      {
        startTime: 20020,
        song: {
          id: 2015896805,
          name: '浆果',
          artists: [{ name: 'TINY7', id: 0 }],
          album: { name: '浆果', id: 148317673, picUrl: 'https://p1.music.126.net/x.jpg' },
        },
      },
    ],
  },
}

const noMatchResponse = { code: 200, data: { result: null, noMatchReason: 'no result' } }

test('接口地址是免密钥的 match 端点', () => {
  assert.equal(MATCH_ENDPOINT, 'https://interface.music.163.com/api/music/audio/match')
})

test('表单体固定六个字段，duration 跟随窗口秒数', () => {
  assert.deepEqual(buildMatchForm('RAW==', 6, 'sid-1'), {
    sessionId: 'sid-1',
    algorithmCode: 'shazam_v2',
    duration: '6',
    rawdata: 'RAW==',
    times: '2',
    decrypt: '1',
  })
})

test('sessionId 是 uuid v4 形状，随机源可注入且默认每次不同', () => {
  assert.match(createSessionId(() => 0.5), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(new Set([createSessionId(), createSessionId()]).size, 2)
})

test('命中时取第一条结果并给出门派歌曲 ID', () => {
  const song = parseMatchResponse(hitResponse)
  assert.notEqual(song, null)
  assert.equal(song!.name, '浆果')
  assert.equal(song!.singer, 'TINY7')
  assert.equal(song!.albumName, '浆果')
  assert.equal(song!.neteaseSongId, '2015896805')
  assert.equal(song!.startTimeMs, 20020)
})

test('多歌手用 / 连接，缺字段不抛异常', () => {
  const song = parseMatchResponse({
    data: { result: [{ song: { name: 'X', artists: [{ name: 'A' }, { name: 'B' }, {}], album: {} } }] },
  })
  assert.equal(song!.name, 'X')
  assert.equal(song!.singer, 'A/B')
  assert.equal(song!.albumName, '')
  assert.equal(song!.neteaseSongId, '')
  assert.equal(song!.startTimeMs, 0)
})

test('未命中（result 为 null）返回 null', () => {
  assert.equal(parseMatchResponse(noMatchResponse), null)
})

test('畸形响应一律返回 null 而不是抛异常', () => {
  assert.equal(parseMatchResponse(undefined), null)
  assert.equal(parseMatchResponse(null), null)
  assert.equal(parseMatchResponse('not json'), null)
  assert.equal(parseMatchResponse({ data: { result: [] } }), null)
  assert.equal(parseMatchResponse({ data: { result: [{}] } }), null)
  assert.equal(parseMatchResponse({ data: { result: [{ song: { name: '' } }] } }), null)
  assert.equal(parseMatchResponse({ data: { result: 'oops' } }), null)
})
```

- [ ] **Step 2: 跑到失败**

Run: `node --test --experimental-strip-types tests/music-recognition-ncm-api.mts`
Expected: FAIL，`Cannot find module .../ncmApi.ts`

- [ ] **Step 3: 写实现**

创建 `src/core/musicRecognition/ncmApi.ts`：

```ts
import type { RecognizedSong } from './types'

export type { RecognizedSong }

// 网易识曲接口（逆向、非公开、无 SLA）。本文件刻意零依赖：
// 只管请求体的形状与响应的解析，网络与 UI 都不许进来。
export const MATCH_ENDPOINT = 'https://interface.music.163.com/api/music/audio/match'

export interface MatchForm {
  sessionId: string
  algorithmCode: string
  duration: string
  rawdata: string
  times: string
  decrypt: string
}

export const buildMatchForm = (rawdata: string, durationSeconds: number, sessionId: string): MatchForm => ({
  sessionId,
  algorithmCode: 'shazam_v2',
  duration: String(durationSeconds),
  rawdata,
  times: '2',
  decrypt: '1',
})

const hex = (length: number, random: () => number): string => {
  let out = ''
  for (let i = 0; i < length; i++) out += Math.floor(random() * 16).toString(16)
  return out
}

// Hermes 没有 crypto.randomUUID，服务端也不校验这个值的形状，本地拼一个够用
export const createSessionId = (random: () => number = Math.random): string => {
  return `${hex(8, random)}-${hex(4, random)}-4${hex(3, random)}-a${hex(3, random)}-${hex(12, random)}`
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  return typeof value == 'object' && value != null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

const asList = (value: unknown): unknown[] => Array.isArray(value) ? value : []

const asText = (value: unknown): string => {
  if (typeof value == 'string') return value
  if (typeof value == 'number') return String(value)
  return ''
}

export const parseMatchResponse = (body: unknown): RecognizedSong | null => {
  const data = asRecord(asRecord(body)?.data)
  const results = asList(data?.result)
  if (!results.length) return null
  const first = asRecord(results[0])
  const song = asRecord(first?.song)
  const name = asText(song?.name)
  if (!name) return null
  const singer = asList(song?.artists)
    .map(item => asText(asRecord(item)?.name))
    .filter(text => text)
    .join('/')
  return {
    name,
    singer,
    albumName: asText(asRecord(song?.album)?.name),
    neteaseSongId: asText(song?.id),
    startTimeMs: Number(first?.startTime) || 0,
  }
}
```

**注意**：这里已经 `import type { RecognizedSong } from './types'`，而 `types.ts` 是 Task 5 才创建的文件 —— 所以 **Task 3 先创建 `types.ts` 的最小版本**（见下一步），Task 5 只往里追加 `RecognizeReason` / `RecognizeOutcome` / `RecognizeEngine` / `Guard`，不再改动 `RecognizedSong`。这样两个任务各自都能独立编译，不存在「先改坏再改回」。

- [ ] **Step 4: 先建 `types.ts` 的最小版本**

创建 `src/core/musicRecognition/types.ts`：

```ts
export interface RecognizedSong {
  name: string
  singer: string
  albumName: string
  neteaseSongId: string
  startTimeMs: number
}
```

- [ ] **Step 5: 跑到通过**

Run: `node --test --experimental-strip-types tests/music-recognition-ncm-api.mts`
Expected: `# pass 7` / `# fail 0`

- [ ] **Step 6: 挂测试 + 闸门 + 提交**

追加 `tests/music-recognition-ncm-api.mts` 到 `scripts.test`。

```bash
npm test 2>&1 | tail -4
npx tsc --noEmit 2>&1 | tail -1
npm run lint 2>&1 | grep -E "ncmApi|musicRecognition/types" || echo "clean"
git add src/core/musicRecognition/ncmApi.ts src/core/musicRecognition/types.ts tests/music-recognition-ncm-api.mts package.json package-lock.json
git commit -m "feat(recognition): 网易识曲接口请求体与响应解析"
```

---

### Task 4: 本地限流 `limiter.ts` 与热更新配置 `remoteConfig.ts`

**Files:**
- Create: `src/core/musicRecognition/limiter.ts`
- Create: `src/core/musicRecognition/remoteConfig.ts`
- Test: `tests/music-recognition-limiter.mts`
- Test: `tests/music-recognition-remote-config.mts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 3 的 `MATCH_ENDPOINT`
- Produces:
  - `BACKOFF_MS = [1000, 5000, 30000]`；`interface GuardStorage { get(): Promise<string | null>, set(v: string): Promise<void> }`；`type GuardResult = 'allow' | 'daily' | 'cooldown'`
  - `createGuard(opts: { maxPerDay: number, storage: GuardStorage, now: () => number })` → `{ check, onAttempt, onSuccess, onFailure }`
  - `interface EngineConfig { id: string, enabled: boolean, endpoint: string }`、`interface RecognitionConfig { version: number, engines: EngineConfig[] }`、`type FetchImpl`
  - `DEFAULT_CONFIG`、`CONFIG_URLS`、`KNOWN_ENGINE_IDS`、`sanitizeConfig(raw: unknown): RecognitionConfig`、`fetchRemoteConfig(fetchImpl: FetchImpl, urls?: string[]): Promise<RecognitionConfig>`

- [ ] **Step 1: 写限流失败测试**

创建 `tests/music-recognition-limiter.mts`：

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { BACKOFF_MS, createGuard, type GuardStorage } from '../src/core/musicRecognition/limiter.ts'

const makeStorage = (initial: string | null = null) => {
  let value: string | null = initial
  const storage: GuardStorage & { peek(): string | null } = {
    peek: () => value,
    get: async() => value,
    set: async(next: string) => { value = next },
  }
  return storage
}

const DAY_MS = 86_400_000
const day1 = new Date(2026, 9, 10, 4, 0, 0).getTime()

test('没有记录时直接放行', async() => {
  const guard = createGuard({ maxPerDay: 30, storage: makeStorage(), now: () => day1 })
  assert.equal(await guard.check(), 'allow')
})

test('到达每日上限后返回 daily，且不再累加计数', async() => {
  const storage = makeStorage()
  const guard = createGuard({ maxPerDay: 3, storage, now: () => day1 })
  for (let i = 0; i < 3; i++) {
    assert.equal(await guard.check(), 'allow')
    await guard.onAttempt()
  }
  assert.equal(await guard.check(), 'daily')
  await guard.onAttempt()
  assert.equal(JSON.parse(storage.peek()!).count, 3)
})

test('跨自然日重置计数', async() => {
  let now = day1
  const guard = createGuard({ maxPerDay: 1, storage: makeStorage(), now: () => now })
  await guard.onAttempt()
  assert.equal(await guard.check(), 'daily')
  now += DAY_MS
  assert.equal(await guard.check(), 'allow')
})

test('连续失败按 1s / 5s / 30s 退避，之后保持 30s', async() => {
  let now = day1
  const guard = createGuard({ maxPerDay: 30, storage: makeStorage(), now: () => now })
  for (const wait of [1000, 5000, 30000, 30000]) {
    assert.equal(await guard.check(), 'allow')
    await guard.onFailure()
    assert.equal(await guard.check(), 'cooldown')
    now += wait - 1
    assert.equal(await guard.check(), 'cooldown')
    now += 1
    assert.equal(await guard.check(), 'allow')
  }
  assert.deepEqual(BACKOFF_MS, [1000, 5000, 30000])
})

test('一次成功清零失败计数与冷却', async() => {
  const storage = makeStorage()
  const guard = createGuard({ maxPerDay: 30, storage, now: () => day1 })
  await guard.onFailure()
  await guard.onFailure()
  assert.equal(await guard.check(), 'cooldown')
  await guard.onSuccess()
  assert.equal(await guard.check(), 'allow')
  assert.equal(JSON.parse(storage.peek()!).fails, 0)
  assert.equal(JSON.parse(storage.peek()!).blockedUntil, 0)
})

test('存储里是脏数据 / 读取抛异常时退回空状态，不炸', async() => {
  assert.equal(await createGuard({ maxPerDay: 30, storage: makeStorage('{"count":'), now: () => day1 }).check(), 'allow')
  const broken: GuardStorage = { get: async() => { throw new Error('storage down') }, set: async() => {} }
  assert.equal(await createGuard({ maxPerDay: 30, storage: broken, now: () => day1 }).check(), 'allow')
})
```

- [ ] **Step 2: 写限流实现**

创建 `src/core/musicRecognition/limiter.ts`：

```ts
export const BACKOFF_MS = [1000, 5000, 30000]

export interface GuardStorage {
  get: () => Promise<string | null>
  set: (value: string) => Promise<void>
}

export type GuardResult = 'allow' | 'daily' | 'cooldown'

interface GuardState {
  day: string
  count: number
  fails: number
  blockedUntil: number
}

// 按本地自然日计数的闸门。计数存储与时钟都走注入，
// 这样跨时区、跨日、退避序列都能在单测里确定性复现。
const localDay = (now: number): string => {
  const date = new Date(now)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const emptyState = (day: string): GuardState => ({ day, count: 0, fails: 0, blockedUntil: 0 })

export const createGuard = (opts: { maxPerDay: number, storage: GuardStorage, now: () => number }) => {
  const read = async(): Promise<GuardState> => {
    let raw: string | null = null
    try {
      raw = await opts.storage.get()
    } catch {
      return emptyState(localDay(opts.now()))
    }
    if (!raw) return emptyState(localDay(opts.now()))
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return emptyState(localDay(opts.now()))
    }
    const state = parsed as Partial<GuardState>
    return {
      day: typeof state.day == 'string' ? state.day : localDay(opts.now()),
      count: typeof state.count == 'number' ? state.count : 0,
      fails: typeof state.fails == 'number' ? state.fails : 0,
      blockedUntil: typeof state.blockedUntil == 'number' ? state.blockedUntil : 0,
    }
  }

  return {
    async check(): Promise<GuardResult> {
      const state = await read()
      if (state.day != localDay(opts.now())) return 'allow'
      if (state.count >= opts.maxPerDay) return 'daily'
      if (state.blockedUntil > opts.now()) return 'cooldown'
      return 'allow'
    },
    async onAttempt(): Promise<void> {
      const state = await read()
      state.day = localDay(opts.now())
      if (state.count >= opts.maxPerDay) return
      state.count += 1
      await opts.storage.set(JSON.stringify(state))
    },
    async onSuccess(): Promise<void> {
      const state = await read()
      state.fails = 0
      state.blockedUntil = 0
      await opts.storage.set(JSON.stringify(state))
    },
    async onFailure(): Promise<void> {
      const state = await read()
      const wait = BACKOFF_MS[Math.min(state.fails, BACKOFF_MS.length - 1)]
      state.fails += 1
      state.blockedUntil = opts.now() + wait
      await opts.storage.set(JSON.stringify(state))
    },
  }
}
```

- [ ] **Step 3: 跑到通过**

Run: `node --test --experimental-strip-types tests/music-recognition-limiter.mts`
Expected: `# pass 7` / `# fail 0`

- [ ] **Step 4: 写热更新配置失败测试**

创建 `tests/music-recognition-remote-config.mts`：

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONFIG_URLS,
  DEFAULT_CONFIG,
  KNOWN_ENGINE_IDS,
  fetchRemoteConfig,
  sanitizeConfig,
  type FetchImpl,
} from '../src/core/musicRecognition/remoteConfig.ts'

const okFetch = (body: string, status = 200): FetchImpl => async() => ({ status, ok: status >= 200 && status < 300, text: async() => body })

test('配置源只有自家仓库的 CDN 地址，且没有可执行代码', () => {
  assert.ok(CONFIG_URLS.length >= 3)
  for (const url of CONFIG_URLS) {
    assert.match(url, /^https:\/\//)
    assert.match(url, /recognition-config\.json$/)
  }
})

test('合法配置原样采用', () => {
  const config = sanitizeConfig({
    version: 2,
    engines: [{ id: 'ncm', enabled: true, endpoint: 'https://interface.music.163.com/api/music/audio/match' }],
  })
  assert.equal(config.version, 2)
  assert.equal(config.engines.length, 1)
  assert.equal(config.engines[0].endpoint, 'https://interface.music.163.com/api/music/audio/match')
})

test('白名单外的域名一律丢弃 —— 这是把静态文件当配置源的前提', () => {
  const config = sanitizeConfig({
    version: 2,
    engines: [
      { id: 'ncm', enabled: true, endpoint: 'https://evil.example.com/match' },
      { id: 'ncm', enabled: true, endpoint: 'http://interface.music.163.com/match' },
      { id: 'ncm', enabled: true, endpoint: 'https://interface.music.163.com.evil.net/match' },
      { id: 'ncm', enabled: true, endpoint: 'https://evil.net/?x=https://music.163.com/' },
    ],
  })
  assert.deepEqual(config.engines, DEFAULT_CONFIG.engines)
})

test('未知引擎 id 与畸形条目被丢掉，合法条目保留（含 enabled=false）', () => {
  const config = sanitizeConfig({
    version: 3,
    engines: [
      { id: 'mine', enabled: true, endpoint: 'https://music.163.com/x' },
      'not an object',
      { id: 'ncm', endpoint: 'https://interface.music.163.com/api/music/audio/match' },
      { id: 'ncm', enabled: false, endpoint: 'https://music.163.com/api/music/audio/match' },
    ],
  })
  assert.ok(KNOWN_ENGINE_IDS.includes('ncm'))
  assert.equal(config.engines.length, 2)
  assert.equal(config.engines[0].enabled, true)
  assert.equal(config.engines[1].enabled, false)
})

test('非对象 / 空 engines / 类型错乱的输入一律退回内置默认值', () => {
  assert.deepEqual(sanitizeConfig(null), DEFAULT_CONFIG)
  assert.deepEqual(sanitizeConfig('[]'), DEFAULT_CONFIG)
  assert.deepEqual(sanitizeConfig({ version: 'two', engines: [] }), DEFAULT_CONFIG)
})

test('逐个地址尝试，第一个成功的胜出', async() => {
  let called = 0
  const good = JSON.stringify({ version: 9, engines: [{ id: 'ncm', enabled: true, endpoint: 'https://music.163.com/api/music/audio/match' }] })
  const config = await fetchRemoteConfig(async() => {
    called += 1
    if (called == 1) return { ok: false, status: 404, text: async() => '' }
    return { ok: true, status: 200, text: async() => good }
  })
  assert.equal(called, 2)
  assert.equal(config.version, 9)
})

test('全部地址失败、或响应不是 JSON 时退回默认配置，不抛异常', async() => {
  assert.deepEqual(await fetchRemoteConfig(async() => { throw new Error('offline') }), DEFAULT_CONFIG)
  assert.deepEqual(await fetchRemoteConfig(okFetch('<html>hit me</html>')), DEFAULT_CONFIG)
})

test('地址可由调用方覆盖（测试与降级用）', async() => {
  let hitUrl = ''
  await fetchRemoteConfig(async(url: string) => { hitUrl = url; return { ok: false, status: 500, text: async() => '' } }, ['https://example.org/custom.json'])
  assert.equal(hitUrl, 'https://example.org/custom.json')
})
```

- [ ] **Step 5: 写热更新配置实现**

创建 `src/core/musicRecognition/remoteConfig.ts`（不 import `@/utils/version` —— 那个文件是 `.js` 且混着更新逻辑，这里只要地址形状）：

```ts
import { MATCH_ENDPOINT } from './ncmApi'

// 热更新只是从自家仓库的 CDN 拉一个静态 JSON，不是后端。
// 正因为这个文件一改就全量生效，端点必须过域名白名单：
// 白名单只放识别服务自己的官方域，谁把这个文件改了也指不到别处去。
export interface EngineConfig {
  id: string
  enabled: boolean
  endpoint: string
}

export interface RecognitionConfig {
  version: number
  engines: EngineConfig[]
}

export type FetchImpl = (url: string) => Promise<{ ok: boolean, status: number, text: () => Promise<string> }>

export const KNOWN_ENGINE_IDS = ['ncm']

// 只允许 https + 识别服务的官方域（含其子域），其余一律丢
const ALLOWED_HOSTS = ['interface.music.163.com', 'music.163.com', 'amp.shazam.com']

export const DEFAULT_CONFIG: RecognitionConfig = {
  version: 1,
  engines: [{ id: 'ncm', enabled: true, endpoint: MATCH_ENDPOINT }],
}

const repository = 'aniface-satar/xunyin'
const giteeRepository = 'not-a-chanci/xunyin'

// 与 src/utils/version.js 取版本号用的是同一组镜像地址，只是换成配置文件
export const CONFIG_URLS: string[] = [
  `https://aniface-satar.github.io/xunyin/recognition-config.json`,
  `https://gitee.com/${giteeRepository}/raw/main/publish/recognition-config.json`,
  `https://cdn.jsdmirror.cn/gh/${repository}@main/publish/recognition-config.json`,
  `https://cdn.jsdelivr.net/gh/${repository}@main/publish/recognition-config.json`,
  `https://raw.githubusercontent.com/${repository}/main/publish/recognition-config.json`,
]

const httpsHost = (endpoint: unknown): string | null => {
  if (typeof endpoint != 'string') return null
  const matched = /^https:\/\/([^/?#:]+)(?::\d+)?(?:[/?#]|$)/.exec(endpoint)
  if (!matched) return null
  const host = matched[1].toLowerCase()
  for (const allowed of ALLOWED_HOSTS) {
    if (host == allowed || host.endsWith(`.${allowed}`)) return host
  }
  return null
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  return typeof value == 'object' && value != null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

const sanitizeEngine = (value: unknown): EngineConfig | null => {
  const engine = asRecord(value)
  if (!engine) return null
  const id = engine.id
  if (typeof id != 'string' || !KNOWN_ENGINE_IDS.includes(id)) return null
  if (httpsHost(engine.endpoint) == null) return null
  return { id, enabled: engine.enabled !== false, endpoint: String(engine.endpoint) }
}

export const sanitizeConfig = (raw: unknown): RecognitionConfig => {
  const config = asRecord(raw)
  if (!config || !Array.isArray(config.engines)) return DEFAULT_CONFIG
  const engines = config.engines.map(sanitizeEngine).filter((item): item is EngineConfig => item != null)
  if (!engines.length) return DEFAULT_CONFIG
  return {
    version: typeof config.version == 'number' ? config.version : DEFAULT_CONFIG.version,
    engines,
  }
}

export const fetchRemoteConfig = async(fetchImpl: FetchImpl, urls: string[] = CONFIG_URLS): Promise<RecognitionConfig> => {
  for (const url of urls) {
    try {
      const response = await fetchImpl(url)
      if (!response.ok) continue
      return sanitizeConfig(JSON.parse(await response.text()) as unknown)
    } catch {
      continue
    }
  }
  return DEFAULT_CONFIG
}
```

- [ ] **Step 6: 跑到通过**

Run: `node --test --experimental-strip-types tests/music-recognition-remote-config.mts`
Expected: `# pass 8` / `# fail 0`

- [ ] **Step 7: 挂测试 + 闸门 + 提交**

追加 `tests/music-recognition-limiter.mts`、`tests/music-recognition-remote-config.mts` 到 `scripts.test`。

```bash
npm test 2>&1 | tail -4
npx tsc --noEmit 2>&1 | tail -1
npm run lint 2>&1 | grep -E "limiter|remoteConfig" || echo "clean"
git add src/core/musicRecognition/limiter.ts src/core/musicRecognition/remoteConfig.ts \
  tests/music-recognition-limiter.mts tests/music-recognition-remote-config.mts package.json package-lock.json
git commit -m "feat(recognition): 每日限流退避闸门与带域名白名单的热更新配置"
```

---

### Task 5: 引擎数组调度层 `provider.ts`

**Files:**
- Modify: `src/core/musicRecognition/types.ts`（追加 4 个类型，`RecognizedSong` 不动）
- Create: `src/core/musicRecognition/provider.ts`
- Test: `tests/music-recognition-provider.mts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `RecognizedSong`（Task 3 已建）
- Produces:
  - `types.ts`：`RecognizeReason = 'no_match' | 'failed' | 'daily' | 'cooldown' | 'unsupported'`、`RecognizeOutcome`、`RecognizeEngine`、`Guard`
  - `provider.ts`：`recognizeWithEngines(engines: RecognizeEngine[], pcm: Int16Array, guard: Guard): Promise<RecognizeOutcome>`
  - 契约重申：`recognize(pcm)` 的 `pcm` 是 **8kHz Int16 识别窗口**（见 Global Constraints）

- [ ] **Step 1: 写失败测试**

创建 `tests/music-recognition-provider.mts`：

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { recognizeWithEngines } from '../src/core/musicRecognition/provider.ts'
import type { Guard, RecognizeEngine, RecognizedSong } from '../src/core/musicRecognition/types.ts'

const song = (name: string): RecognizedSong => ({ name, singer: 'x', albumName: '', neteaseSongId: '', startTimeMs: 0 })

type Gate = 'allow' | 'daily' | 'cooldown'

const makeGuard = (gate: Gate = 'allow') => {
  const calls: string[] = []
  const guard: Guard = {
    check: async() => { calls.push('check'); return gate },
    onAttempt: async() => { calls.push('attempt') },
    onSuccess: async() => { calls.push('success') },
    onFailure: async() => { calls.push('failure') },
  }
  return { calls, guard }
}

const fakeEngine = (id: string, behaviour: { result?: RecognizedSong | null, error?: string }): RecognizeEngine => ({
  id,
  recognize: async() => {
    if (behaviour.error) throw new Error(behaviour.error)
    return behaviour.result ?? null
  },
})

test('第一个引擎命中就返回，绝不问第二个', async() => {
  const touched: string[] = []
  const engines: RecognizeEngine[] = [
    { id: 'ncm', recognize: async() => { touched.push('ncm'); return song('A') } },
    { id: 'shazam', recognize: async() => { touched.push('shazam'); return song('B') } },
  ]
  const outcome = await recognizeWithEngines(engines, new Int16Array(8), makeGuard().guard)
  assert.deepEqual(touched, ['ncm'])
  assert.equal(outcome.ok, true)
  if (outcome.ok) {
    assert.equal(outcome.song.name, 'A')
    assert.equal(outcome.engineId, 'ncm')
  }
})

test('第一个引擎抛异常要降级到第二个', async() => {
  const engines = [fakeEngine('ncm', { error: 'boom' }), fakeEngine('shazam', { result: song('B') })]
  const outcome = await recognizeWithEngines(engines, new Int16Array(8), makeGuard().guard)
  assert.equal(outcome.ok, true)
  if (outcome.ok) assert.equal(outcome.engineId, 'shazam')
})

test('有引擎抛异常且全部没命中：reason 是 failed，并走退避', async() => {
  const { calls, guard } = makeGuard()
  const engines = [fakeEngine('ncm', { error: 'boom' }), fakeEngine('shazam', { result: null })]
  const outcome = await recognizeWithEngines(engines, new Int16Array(8), guard)
  assert.equal(outcome.ok, false)
  if (!outcome.ok) assert.equal(outcome.reason, 'failed')
  assert.deepEqual(calls, ['check', 'attempt', 'failure'])
})

test('全都安静地没命中：reason 是 no_match，既不退避也不清零', async() => {
  const { calls, guard } = makeGuard()
  const engines = [fakeEngine('ncm', { result: null }), fakeEngine('shazam', { result: null })]
  const outcome = await recognizeWithEngines(engines, new Int16Array(8), guard)
  assert.equal(outcome.ok, false)
  if (!outcome.ok) assert.equal(outcome.reason, 'no_match')
  assert.deepEqual(calls, ['check', 'attempt'])
})

test('闸门挡住时一个引擎都不发请求', async() => {
  for (const gate of ['daily', 'cooldown'] as const) {
    let touched = false
    const engines: RecognizeEngine[] = [{ id: 'ncm', recognize: async() => { touched = true; return song('A') } }]
    const outcome = await recognizeWithEngines(engines, new Int16Array(8), makeGuard(gate).guard)
    assert.equal(touched, false)
    assert.equal(outcome.ok, false)
    if (!outcome.ok) assert.equal(outcome.reason, gate)
  }
})

test('没有可用引擎（比如 iOS 或 Shazam 标签）时 reason 是 unsupported', async() => {
  const { calls, guard } = makeGuard()
  const outcome = await recognizeWithEngines([], new Int16Array(8), guard)
  assert.equal(outcome.ok, false)
  if (!outcome.ok) assert.equal(outcome.reason, 'unsupported')
  assert.deepEqual(calls, ['check'], '没有引擎时不该占用每日次数')
})

test('命中后 onSuccess 被调用一次', async() => {
  const { calls, guard } = makeGuard()
  await recognizeWithEngines([fakeEngine('ncm', { result: song('A') })], new Int16Array(8), guard)
  assert.deepEqual(calls, ['check', 'attempt', 'success'])
})

test('单个引擎的 recognize 收到的是调用方给的同一份 8k 窗口', async() => {
  let seen: Int16Array | null = null
  const engines: RecognizeEngine[] = [{ id: 'ncm', recognize: async(pcm) => { seen = pcm; return null } }]
  const pcm = new Int16Array([1, 2, 3])
  await recognizeWithEngines(engines, pcm, makeGuard().guard)
  assert.equal(seen, pcm)
})
```

- [ ] **Step 2: 追加类型**

Modify `src/core/musicRecognition/types.ts`，在 `RecognizedSong` 之后追加：

```ts
export type RecognizeReason = 'no_match' | 'failed' | 'daily' | 'cooldown' | 'unsupported'

export type RecognizeOutcome =
  { ok: true, song: RecognizedSong, engineId: string }
  | { ok: false, reason: RecognizeReason }

/** 识曲引擎。recognize 收到的 pcm 是 8kHz 单声道 Int16 识别窗口，不是原始 48k 采集。 */
export interface RecognizeEngine {
  id: string
  recognize: (pcm: Int16Array) => Promise<RecognizedSong | null>
}

export interface Guard {
  check: () => Promise<'allow' | 'daily' | 'cooldown'>
  onAttempt: () => Promise<void>
  onSuccess: () => Promise<void>
  onFailure: () => Promise<void>
}
```

- [ ] **Step 3: 写 provider**

创建 `src/core/musicRecognition/provider.ts`：

```ts
import type { Guard, RecognizeEngine, RecognizeOutcome } from './types'

// 按数组顺序串行降级：第一个给出结果的引擎就收工。
// 本期数组里只有 ncm；二期接 Shazam 时往尾部加一项，UI 与录音链路不动。
export const recognizeWithEngines = async(
  engines: RecognizeEngine[],
  pcm: Int16Array,
  guard: Guard,
): Promise<RecognizeOutcome> => {
  const gate = await guard.check()
  if (gate != 'allow') return { ok: false, reason: gate }
  if (!engines.length) return { ok: false, reason: 'unsupported' }

  await guard.onAttempt()
  let threw = false
  for (const engine of engines) {
    try {
      const song = await engine.recognize(pcm)
      if (song) {
        await guard.onSuccess()
        return { ok: true, song, engineId: engine.id }
      }
    } catch {
      threw = true
    }
  }
  if (threw) {
    await guard.onFailure()
    return { ok: false, reason: 'failed' }
  }
  return { ok: false, reason: 'no_match' }
}
```

- [ ] **Step 4: 跑到通过（含 Task 3 回归）**

Run: `node --test --experimental-strip-types tests/music-recognition-provider.mts`
Expected: `# pass 8` / `# fail 0`
Run: `npm test 2>&1 | tail -4`
Expected: `# fail 0`

- [ ] **Step 5: 挂测试 + 闸门 + 提交**

追加 `tests/music-recognition-provider.mts` 到 `scripts.test`。

```bash
npx tsc --noEmit 2>&1 | tail -1
npm run lint 2>&1 | grep -E "provider|musicRecognition/types" || echo "clean"
git add src/core/musicRecognition/types.ts src/core/musicRecognition/provider.ts tests/music-recognition-provider.mts package.json package-lock.json
git commit -m "feat(recognition): 识曲引擎串行降级调度与限流闸门接缝"
```

---

### Task 6: 原生录音模块 + 安装 react-native-webview

两处原生改动放进一个任务，只用一次 `assembleDebug` 验证。

**Files:**
- Create: `android/app/src/main/java/cn/toside/music/mobile/audioRecord/AudioRecordModule.java`
- Create: `android/app/src/main/java/cn/toside/music/mobile/audioRecord/AudioRecordPackage.java`
- Modify: `android/app/src/main/java/cn/toside/music/mobile/MainApplication.java`（import 块 + `getPackages()`）
- Modify: `android/app/src/main/AndroidManifest.xml`（第 20 行之后）
- Create: `src/utils/nativeModules/audioRecord.ts`
- Modify: `package.json` / `package-lock.json`

**Interfaces:**
- Produces:
  - Native module `MusicAudioRecord`：`start(seconds: number): Promise<string>`（resolve 48kHz 单声道 PCM16 **小端** base64）、`cancel(): void`
  - `src/utils/nativeModules/audioRecord.ts`：`isAudioRecordSupported(): boolean`、`requestRecordPermission(): Promise<boolean>`、`recordPcm(seconds: number): Promise<{ pcm: Int16Array, sampleRate: 48000 }>`、`cancelRecord(): void`

- [ ] **Step 1: 装依赖**

```bash
npm i react-native-webview@13.6.4
node dependencies-patch.js
```
Expected: `package.json` 出现 `"react-native-webview": "13.6.4"`；patch 脚本全部输出 `Skipping ... (already patched)`（本期不需要给它加新补丁）。webview 走 RN autolinking，**不用手工注册 Package**。

- [ ] **Step 2: 声明权限**

Modify `android/app/src/main/AndroidManifest.xml`，在第 20 行 `MODIFY_AUDIO_SETTINGS` 之后插入：

```xml
    <!-- 听歌识曲只在用户主动点击时采几秒环境音，且只上传指纹、不落盘。 -->
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
```
**不要碰**同一文件里 MainActivity 的 `android:screenOrientation="portrait"`。

- [ ] **Step 3: 写原生模块**

创建 `android/app/src/main/java/cn/toside/music/mobile/audioRecord/AudioRecordModule.java`：

```java
package cn.toside.music.mobile.audioRecord;

import android.Manifest;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Base64;

import androidx.core.content.ContextCompat;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Records a short clip of the microphone and returns it as base64-encoded
 * 48 kHz mono PCM16 (little endian). One-shot by design: no streaming, no
 * background capture, no foreground service, and the bytes never touch disk.
 *
 * The whole feature relies on this single capture: since Android 10 a second
 * concurrent AudioRecord client gets muted on a fair share of devices, so every
 * downstream format must be decimated from this one stream in JS.
 */
public class AudioRecordModule extends ReactContextBaseJavaModule {

  private static final int SAMPLE_RATE = 48000;
  private static final int MAX_SECONDS = 10;
  // 2400 samples = 50 ms per read, which also bounds the cancel latency.
  private static final int CHUNK_BYTES = 2400 * 2;

  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  private final AtomicBoolean recording = new AtomicBoolean(false);
  private final AtomicBoolean cancelRequested = new AtomicBoolean(false);

  public AudioRecordModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return "MusicAudioRecord";
  }

  @ReactMethod
  public void start(int seconds, Promise promise) {
    if (seconds < 1 || seconds > MAX_SECONDS) {
      promise.reject("EINVAL", "seconds must be within 1.." + MAX_SECONDS);
      return;
    }
    if (recording.get()) {
      promise.reject("EBUSY", "another recording is still running");
      return;
    }
    if (ContextCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.RECORD_AUDIO)
        != PackageManager.PERMISSION_GRANTED) {
      promise.reject("EPERM", "RECORD_AUDIO is not granted");
      return;
    }

    recording.set(true);
    cancelRequested.set(false);
    final int totalBytes = seconds * SAMPLE_RATE * 2;

    executor.execute(() -> {
      AudioRecord record = null;
      try {
        int minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (minBuffer <= 0) {
          promise.reject("EAUDIODEV", "getMinBufferSize returned " + minBuffer);
          return;
        }
        record = new AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
            Math.max(minBuffer, SAMPLE_RATE * 2));
        if (record.getState() != AudioRecord.STATE_INITIALIZED) {
          promise.reject("EAUDIODEV", "AudioRecord failed to initialise");
          return;
        }

        byte[] bytes = new byte[totalBytes];
        record.startRecording();
        int written = 0;
        while (written < totalBytes) {
          if (cancelRequested.get()) {
            promise.reject("ECANCEL", "recording cancelled");
            return;
          }
          int read = record.read(bytes, written, Math.min(CHUNK_BYTES, totalBytes - written));
          if (read <= 0) {
            promise.reject("EIO", "AudioRecord.read returned " + read);
            return;
          }
          written += read;
        }
        promise.resolve(Base64.encodeToString(bytes, Base64.NO_WRAP));
      } catch (Exception e) {
        promise.reject("EREC", e.getMessage());
      } finally {
        if (record != null) {
          try {
            if (record.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
              record.stop();
            }
          } catch (Exception ignored) {
          }
          record.release();
        }
        recording.set(false);
      }
    });
  }

  /** Aborts the running capture; the pending promise rejects with ECANCEL. */
  @ReactMethod
  public void cancel() {
    cancelRequested.set(true);
  }
}
```

- [ ] **Step 4: 写 Package 并注册**

创建 `android/app/src/main/java/cn/toside/music/mobile/audioRecord/AudioRecordPackage.java`（照抄同仓库 `audioFeature/AudioFeaturePackage.java` 的写法）：

```java
package cn.toside.music.mobile.audioRecord;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public class AudioRecordPackage implements ReactPackage {

  @Override
  public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
    return Collections.emptyList();
  }

  @Override
  public List<NativeModule> createNativeModules(ReactApplicationContext reactContext) {
    return Arrays.<NativeModule>asList(new AudioRecordModule(reactContext));
  }
}
```

Modify `MainApplication.java`：在 `import cn.toside.music.mobile.volumeBalancer.VolumeBalancerPackage;`（第 19 行）之后加

```java
import cn.toside.music.mobile.audioRecord.AudioRecordPackage;
```
在 `packages.add(new AudioFeaturePackage());`（第 43 行）之后加

```java
          packages.add(new AudioRecordPackage());
```

- [ ] **Step 5: 写 JS 绑定**

创建 `src/utils/nativeModules/audioRecord.ts`：

```ts
import { NativeModules, PermissionsAndroid, Platform } from 'react-native'
import { toByteArray } from 'react-native-quick-base64'

interface MusicAudioRecordModule {
  start: (seconds: number) => Promise<string>
  cancel: () => void
}

const audioRecordModule = (NativeModules.MusicAudioRecord ?? null) as MusicAudioRecordModule | null

export const isAudioRecordSupported = (): boolean => Platform.OS == 'android' && audioRecordModule != null

export const requestRecordPermission = async(): Promise<boolean> => {
  if (Platform.OS != 'android') return false
  const status = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
  return status === PermissionsAndroid.RESULTS.GRANTED
}

// 显式拷进新 buffer：toByteArray 返回的 Uint8Array 可能带非零 byteOffset，
// 直接拿它的 .buffer 构造 Int16Array 会抛 RangeError。
const toInt16Array = (base64: string): Int16Array => {
  const bytes = toByteArray(base64)
  const buffer = new ArrayBuffer(bytes.length)
  new Uint8Array(buffer).set(bytes)
  return new Int16Array(buffer)
}

export const recordPcm = async(seconds: number): Promise<{ pcm: Int16Array, sampleRate: number }> => {
  if (!audioRecordModule) throw new Error('audio record module is not available')
  const base64 = await audioRecordModule.start(seconds)
  return { pcm: toInt16Array(base64), sampleRate: 48000 }
}

export const cancelRecord = () => {
  audioRecordModule?.cancel()
}
```

- [ ] **Step 6: 编译验证**

Run: `cd android && ./gradlew.bat assembleDebug 2>&1 | tail -5`
Expected: `BUILD SUCCESSFUL`。这是本期唯一能证明两处原生改动成立的闸门。**无设备时不许把「依赖装好了」当成「能录音」或「WebView 能跑 wasm」** —— 那两件事留在 Task 9 的真机清单。
若报 `cannot find symbol ContextCompat`（androidx.core 未传递进来），改用平台 API：
```java
    if (getReactApplicationContext().checkSelfPermission(Manifest.permission.RECORD_AUDIO)
        != PackageManager.PERMISSION_GRANTED) {
```
并删掉 `androidx.core.content.ContextCompat` 与 `android.content.pm.PackageManager` 之外多余的 import，在提交信息里注明换法的原因。

- [ ] **Step 7: JS 闸门 + 提交**

```bash
npx tsc --noEmit 2>&1 | tail -1
npm run lint 2>&1 | grep -E "nativeModules/audioRecord" || echo "clean"
git add android/app/src/main/java/cn/toside/music/mobile/audioRecord/AudioRecordModule.java \
  android/app/src/main/java/cn/toside/music/mobile/audioRecord/AudioRecordPackage.java \
  android/app/src/main/java/cn/toside/music/mobile/MainApplication.java \
  android/app/src/main/AndroidManifest.xml \
  src/utils/nativeModules/audioRecord.ts package.json package-lock.json
git commit -m "feat(recognition): 原生一次性麦克风采集与 webview 依赖"
```
Expected: tsc 数不变（`NativeModules.MusicAudioRecord` 在 RN 类型里是索引访问，不会产生新错误；若确实报未定义，用 `(NativeModules as Record<string, ...>)` 收窄，不要 `as any`）。

---

### Task 7: 隐藏 WebView 指纹桥 + 引擎装配

**Files:**
- Create: `src/core/musicRecognition/wasmBridge.ts`
- Create: `src/core/musicRecognition/configStore.ts`
- Create: `src/core/musicRecognition/ncmEngine.ts`
- Create: `src/components/musicRecognition/AfpWasmView.tsx`

**Interfaces:**
- Consumes: Task 1 `toLittleEndianBytes`/`WINDOW_LEN_SECONDS`；Task 3 `buildMatchForm`/`createSessionId`/`parseMatchResponse`；Task 4 `fetchRemoteConfig`/`DEFAULT_CONFIG`/`type RecognitionConfig`/`type FetchImpl`；Task 5 `RecognizeEngine`；Task 2 生成的两个 asset
- Produces:
  - `wasmBridge.ts`：`setWasmRequester(fn: WasmRequester | null): void`、`isWasmReady(): boolean`、`fingerprintFromWasm(samplesB64: string): Promise<string>`
  - `configStore.ts`：`getNcmEndpoint(): Promise<string>`（返回空串表示引擎被远程配置关掉或配置不可用）
  - `ncmEngine.ts`：`createNcmEngine(): RecognizeEngine`
  - `AfpWasmView.tsx`：默认导出的 1×1 透明 WebView（挂载即注册 requester，卸载即注销）

**本任务没有单测**，这是有意的：`react-native-webview` 与 `react-native-fs` 都无法在 `node --test` 下解析。它的正确性由三件事共同兜住 —— Task 2 的离线对拍（证明字节与算法等价）、本任务的 tsc/eslint/Metro 打包、Task 9 的真机验收。**执行者不要在提交信息里声称本任务有测试覆盖。**

- [ ] **Step 1: 写桥**

创建 `src/core/musicRecognition/wasmBridge.ts`：

```ts
// RN 与隐藏 WebView 之间的唯一接缝。桥只能传字符串，
// 所以 Int16Array/Float32Array 一律在 WebView 上下文里构造。
export type WasmRequester = (samplesB64: string) => Promise<string>

let requester: WasmRequester | null = null

export const setWasmRequester = (fn: WasmRequester | null) => {
  requester = fn
}

export const isWasmReady = (): boolean => requester != null

export const fingerprintFromWasm = async(samplesB64: string): Promise<string> => {
  if (!requester) throw new Error('fingerprint webview is not ready')
  return requester(samplesB64)
}
```

- [ ] **Step 2: 写配置缓存**

创建 `src/core/musicRecognition/configStore.ts`：

```ts
import { httpFetch } from '@/utils/request'
import { fetchRemoteConfig, type FetchImpl, type RecognitionConfig } from './remoteConfig'

const CACHE_MS = 60 * 60 * 1000

let cached: { config: RecognitionConfig, at: number } | null = null

// httpFetch 的 promise 给的是 { statusCode, body }，适配成 remoteConfig 的 FetchImpl。
// 白名单校验留在 sanitizeConfig 里做，所以这里必须把原文交出去。
const fetchImpl: FetchImpl = async(url) => {
  const { statusCode, body } = await httpFetch(url).promise
  const raw: unknown = body
  return {
    ok: statusCode >= 200 && statusCode < 300,
    status: statusCode,
    text: async() => typeof raw == 'string' ? raw : JSON.stringify(raw ?? null),
  }
}

const loadConfig = async(): Promise<RecognitionConfig> => {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_MS) return cached.config
  const config = await fetchRemoteConfig(fetchImpl)
  cached = { config, at: now }
  if (__DEV__) console.log('[recognition] engine config version:', config.version)
  return config
}

export const getNcmEndpoint = async(): Promise<string> => {
  let config: RecognitionConfig
  try {
    config = await loadConfig()
  } catch {
    config = (cached?.config) ?? { version: 0, engines: [] }
  }
  const engine = config.engines.find(item => item.id == 'ncm' && item.enabled)
  return engine?.endpoint ?? ''
}
```

- [ ] **Step 3: 写 WebView 容器**

创建 `src/components/musicRecognition/AfpWasmView.tsx`：

```tsx
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import WebView, { type WebViewMessageEvent } from 'react-native-webview'
import RNFS from 'react-native-fs'
import { createStyle } from '@/utils/tools'
import { setWasmRequester } from '@/core/musicRecognition/wasmBridge'

const WASM_ASSET = 'recognition/afp.wasm'
const GLUE_ASSET = 'recognition/afp-glue.js'
const REQUEST_TIMEOUT_MS = 15000

interface Assets { wasmB64: string, glue: string }
interface Pending { resolve: (value: string) => void, reject: (reason: Error) => void, timer: NodeJS.Timeout }
interface BridgeMessage { ready?: boolean, id?: string, ok?: boolean, data?: string, error?: string }

// wasm base64 约 308KB、胶水约 89KB，注入一次就常驻；每次识别都重建的话光注入就够慢
let cachedAssets: Assets | null = null
const loadAssets = async(): Promise<Assets> => {
  if (cachedAssets) return cachedAssets
  const [wasmB64, glue] = await Promise.all([
    RNFS.readFileAssets(WASM_ASSET, 'base64'),
    RNFS.readFileAssets(GLUE_ASSET, 'utf8'),
  ])
  cachedAssets = { wasmB64, glue }
  return cachedAssets
}

const bootScript = (assets: Assets): string => {
  const url = 'data:application/octet-stream;base64,' + assets.wasmB64
  return 'window.__AFP_URL__ = ' + JSON.stringify(url) + ';\n' +
    'var __afpModule = { exports: {} };\n' +
    '(function(module, exports, require){\n' + assets.glue + '\n})' +
    '(__afpModule, __afpModule.exports, function(){ throw new Error("require is not available"); });\n' +
    'window.__ask = function(id, samplesB64) {\n' +
    '  var send = function(payload) { window.ReactNativeWebView.postMessage(JSON.stringify(payload)); };\n' +
    '  try {\n' +
    '    Promise.resolve(__afpModule.exports.Encode8kB64(samplesB64)).then(\n' +
    '      function(fp) { send({ id: id, ok: true, data: fp }); },\n' +
    '      function(err) { send({ id: id, ok: false, error: String(err) }); }\n' +
    '    );\n' +
    '  } catch (e) { send({ id: id, ok: false, error: String(e) }); }\n' +
    '};\n' +
    'window.ReactNativeWebView.postMessage(JSON.stringify({ ready: typeof window.__ask === "function" }));\n' +
    'true;'
}

/**
 * 隐藏 WebView：加载 afp.wasm 与打补丁的胶水，把 8kHz 样本换成指纹字符串。
 * 只负责算指纹，不碰麦克风、不联网。
 */
export default () => {
  const webViewRef = useRef<WebView>(null)
  const pending = useRef(new Map<string, Pending>())
  const seq = useRef(0)
  const booted = useRef(false)
  const assetsRef = useRef<Assets | null>(null)
  const [source, setSource] = useState<{ html: string } | null>(null)

  const requestFingerprint = (samplesB64: string): Promise<string> => new Promise((resolve, reject) => {
    if (!booted.current) {
      reject(new Error('fingerprint webview is not ready'))
      return
    }
    seq.current += 1
    const id = String(seq.current)
    const timer = setTimeout(() => {
      pending.current.delete(id)
      reject(new Error('fingerprint timeout'))
    }, REQUEST_TIMEOUT_MS)
    pending.current.set(id, { resolve, reject, timer })
    const code = 'window.__ask(' + JSON.stringify(id) + ',' + JSON.stringify(samplesB64) + '); true;'
    try {
      webViewRef.current?.injectJavaScript(code)
    } catch (err) {
      clearTimeout(timer)
      pending.current.delete(id)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })

  useEffect(() => {
    void loadAssets().then(assets => {
      assetsRef.current = assets
      // 空壳文档：真正的脚本注入走 onLoadEnd，避免把 308KB base64 塞进 HTML
      setSource({ html: '<html><head><meta charset="utf-8"></head><body></body></html>' })
    }, () => {
      if (__DEV__) console.log('[recognition] wasm assets unavailable')
    })
    return () => {
      setWasmRequester(null)
      booted.current = false
      for (const item of pending.current.values()) clearTimeout(item.timer)
      pending.current.clear()
    }
  }, [])

  const handleLoadEnd = () => {
    if (booted.current) return // onLoadEnd 在 Android 上可能触发多次，注入必须幂等
    const assets = assetsRef.current
    if (!assets) return
    webViewRef.current?.injectJavaScript(bootScript(assets))
  }

  const handleMessage = (event: WebViewMessageEvent) => {
    let message: BridgeMessage
    try {
      message = JSON.parse(event.nativeEvent.data) as BridgeMessage
    } catch {
      return
    }
    if (message.ready != null) {
      if (message.ready) {
        booted.current = true
        setWasmRequester(requestFingerprint)
      } else if (__DEV__) {
        console.log('[recognition] glue boot failed')
      }
      return
    }
    const id = message.id
    if (!id) return
    const item = pending.current.get(id)
    if (!item) return
    pending.current.delete(id)
    clearTimeout(item.timer)
    if (message.ok && typeof message.data == 'string') item.resolve(message.data)
    else item.reject(new Error(message.error ?? 'fingerprint failed'))
  }

  if (!source) return <View style={styles.hidden} />

  return (
    <View pointerEvents="none" style={styles.hidden}>
      <WebView
        ref={webViewRef}
        source={source}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={false}
        originWhitelist={['*']}
        onError={() => { if (__DEV__) console.log('[recognition] webview load error') }}
        onLoadEnd={handleLoadEnd}
        onMessage={handleMessage}
      />
    </View>
  )
}

// 用 1×1 + opacity 0 而不是 display:none / 0×0：后者在部分 Android WebView 版本上不保证创建 JS 上下文
const styles = createStyle({
  hidden: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 1,
    height: 1,
    opacity: 0,
  },
  webview: {
    width: 1,
    height: 1,
    backgroundColor: 'transparent',
  },
})
```

- [ ] **Step 4: 写引擎装配**

创建 `src/core/musicRecognition/ncmEngine.ts`：

```ts
import { fromByteArray } from 'react-native-quick-base64'
import { httpFetch } from '@/utils/request'
import { buildMatchForm, createSessionId, parseMatchResponse } from './ncmApi'
import { toLittleEndianBytes, WINDOW_LEN_SECONDS } from './pcmSplitter'
import { fingerprintFromWasm } from './wasmBridge'
import { getNcmEndpoint } from './configStore'
import type { RecognizeEngine, RecognizedSong } from './types'

const REQUEST_TIMEOUT_MS = 10000

const withTimeout = function<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(label + ' timeout')) }, ms)
    promise.then(resolve, reject)
      .then(() => { clearTimeout(timer) }, () => { clearTimeout(timer) })
  })
}

// 入参 pcm 是 8kHz 识别窗口（见 types.ts 的契约），不要再降采样
export const recognizeNcm = async(pcm: Int16Array): Promise<RecognizedSong | null> => {
  const endpoint = await getNcmEndpoint()
  if (!endpoint) return null

  const rawdata = await fingerprintFromWasm(fromByteArray(toLittleEndianBytes(pcm)))
  if (__DEV__) console.log('[recognition] fingerprint:', (rawdata.length / 1024).toFixed(1) + 'KB')

  const form = buildMatchForm(rawdata, WINDOW_LEN_SECONDS, createSessionId())
  const { body } = await withTimeout(httpFetch(endpoint, { method: 'post', form }).promise, REQUEST_TIMEOUT_MS, 'match')
  return parseMatchResponse(body)
}

export const createNcmEngine = (): RecognizeEngine => ({
  id: 'ncm',
  recognize: recognizeNcm,
})
```

- [ ] **Step 5: 静态闸门**

```bash
npx tsc --noEmit 2>&1 | tail -1
npm run lint 2>&1 | grep -E "wasmBridge|configStore|ncmEngine|AfpWasmView" || echo "clean"
```
Expected: tsc == `TSC_BASELINE`；新文件零 error。若 `withTimeout` 的泛型箭头函数触发解析抱怨，改成 `function withTimeout<T>(...)` 声明式写法（别加 `any`）。

- [ ] **Step 6: Metro 打包闸门**

```bash
mkdir -p .bundle-check-tmp
npx react-native bundle --platform android --dev false --entry-file index.js \
  --bundle-output .bundle-check-tmp/index.android.bundle --assets-dest .bundle-check-tmp/res 2>&1 | tail -3
rm -rf .bundle-check-tmp
```
Expected: 末尾出现 `Done Writing bundle`。若因 `china_ink.jpg` 缺失而失败 —— 回到「前置阻塞项 1」找用户拍板，**不要顺手恢复别人的删除**。

- [ ] **Step 7: 提交**

```bash
git add src/core/musicRecognition/wasmBridge.ts src/core/musicRecognition/configStore.ts \
  src/core/musicRecognition/ncmEngine.ts src/components/musicRecognition/AfpWasmView.tsx
git commit -m "feat(recognition): 隐藏 WebView 指纹桥与网易引擎装配"
```

---

### Task 8: 识曲页接真实流程 + 页内展示结果

**用户拍板（2026-10-10，覆盖了本任务原先的「结果落到搜索」）：识别结果直接在识曲页展示，不跳搜索页、不切 tab。** 因此本任务**不动** `src/event/appEvent.ts`、**不动** `src/screens/Home/Views/Search/index.tsx`、**不动** `src/screens/MusicRecognition/index.tsx`（不需要把 `componentId` 传进面板——那个参数原本只服务于「pop 回搜索页」）。

**Files:**
- Modify: `src/lang/zh-cn.json` / `src/lang/zh-tw.json` / `src/lang/en-us.json`（各 +6 键，666 → 672）
- Modify: `src/core/musicRecognition/engines.ts`（`EngineInfo` 加 `implemented`）
- Create: `src/screens/MusicRecognition/ResultCard.tsx`
- Modify: `src/screens/MusicRecognition/RecognizePanel.tsx`（整文件替换）
- Modify: `src/components/musicRecognition/AfpWasmView.tsx`（**只改注释**，见 Step 4 的「挂载位置说明」）

**Interfaces:**
- Consumes: Task 6 `isAudioRecordSupported`/`requestRecordPermission`/`recordPcm`/`cancelRecord`；Task 7 `AfpWasmView`/`createNcmEngine`/`isNcmEngineEnabled`/`isWasmReady`；Task 5 `recognizeWithEngines`；Task 4 `createGuard`；Task 1 `LISTEN_SECONDS`/`NCM_SAMPLE_RATE`/`WINDOW_FROM_SECONDS`/`WINDOW_LEN_SECONDS`/`decimateTo8k`
- Produces: `RecognizePanel({ engine })`

- [ ] **Step 1: 先补 6 个文案键（顺序很重要：后面两步引用它们）**

原计划的第 7 个键 `music_recognition_find`（「找这首歌」）随「结果落到搜索」一起去掉了；页内只需要「听出来了」+「再听一次」。

三份文件都插在既有识曲键簇的 `music_recognition_privacy` 之后（该簇位于 `move_to` 与 `music_more_add_to_mylist` 之间）。

zh-cn：
```json
  "music_recognition_denied": "需要麦克风权限才能识曲，请在系统设置里允许「音寻」使用麦克风",
  "music_recognition_no_match": "没听出来，靠近音响、多听几秒再试一次",
  "music_recognition_failed": "识曲服务暂时没响应，过一会儿再试",
  "music_recognition_limited": "今天的识曲次数用完了，明天再来",
  "music_recognition_found": "听出来了",
  "music_recognition_again": "再听一次",
```
zh-tw：
```json
  "music_recognition_denied": "需要麥克風權限才能識曲，請在系統設定裡允許「音尋」使用麥克風",
  "music_recognition_no_match": "沒聽出來，靠近音響、多聽幾秒再試一次",
  "music_recognition_failed": "識曲服務暫時沒有回應，過一會兒再試",
  "music_recognition_limited": "今天的識曲次數用完了，明天再來",
  "music_recognition_found": "聽出來了",
  "music_recognition_again": "再聽一次",
```
en-us：
```json
  "music_recognition_denied": "Microphone access is required. Allow the microphone for this app in system settings.",
  "music_recognition_no_match": "Couldn't recognise that. Move closer to the speaker and try again.",
  "music_recognition_failed": "The recognition service isn't responding. Try again in a while.",
  "music_recognition_limited": "You've used up today's recognition attempts. Come back tomorrow.",
  "music_recognition_found": "Got it",
  "music_recognition_again": "Listen again",
```

Run（键数齐平校验，**不许凭 Edit 的回显判断落盘**）:
```bash
node -e "
const fs=require('node:fs');
const keys=p=>Object.keys(JSON.parse(fs.readFileSync(p,'utf8')));
const a=keys('src/lang/zh-cn.json'),b=keys('src/lang/zh-tw.json'),c=keys('src/lang/en-us.json');
console.log('counts',a.length,b.length,c.length);
const diff=(x,y)=>x.filter(k=>!y.includes(k));
console.log('cn-tw',diff(a,b).length,'tw-cn',diff(b,a).length,'cn-en',diff(a,c).length,'en-cn',diff(c,a).length);
"
```
Expected: `counts 672 672 672` 且四个差集都是 `0`。历史上 en-us 有过「Edit 报成功但没落盘」，必须看这条输出。

- [ ] **Step 2: 引擎元信息加 `implemented`**

Modify `src/core/musicRecognition/engines.ts`，把 `EngineInfo` 与 `ENGINES` 换成（其余保留不动）：

```ts
export interface EngineInfo {
  id: EngineId
  nameKey: LangKey
  descKey: LangKey
  tipKey: LangKey
  /** 该引擎的识别链路是否已接通；未接通时面板保持「识别还没接入」 */
  implemented: boolean
}

export const ENGINES: EngineInfo[] = [
  {
    id: 'ncm',
    nameKey: 'music_recognition_engine_ncm',
    descKey: 'music_recognition_ncm_desc',
    tipKey: 'music_recognition_ncm_tip',
    implemented: true,
  },
  {
    id: 'shazam',
    nameKey: 'music_recognition_engine_shazam',
    descKey: 'music_recognition_shazam_desc',
    tipKey: 'music_recognition_shazam_tip',
    implemented: false,
  },
]
```
（原文件里这两项的 key 名以文件现状为准，本步骤只**增加** `implemented` 字段，不要改 key 名。）

- [ ] **Step 3: 结果卡片**

创建 `src/screens/MusicRecognition/ResultCard.tsx`：

```tsx
import { TouchableOpacity, View } from 'react-native'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import type { RecognizedSong } from '@/core/musicRecognition/types'
import { createStyle } from '@/utils/tools'

interface Props {
  song: RecognizedSong
  onAgain: () => void
}

export default ({ song, onAgain }: Props) => {
  const t = useI18n()
  const theme = useTheme()
  const subtitle = [song.singer, song.albumName].filter(text => text).join(' · ')

  return (
    <View style={styles.container}>
      <Text size={12} color={theme['c-font-label']} style={styles.eyebrow}>{t('music_recognition_found')}</Text>
      <Text size={18} color={theme['c-font']} style={styles.name} numberOfLines={2}>{song.name}</Text>
      {
        subtitle
          ? <Text size={13} color={theme['c-font-label']} style={styles.subtitle} numberOfLines={2}>{subtitle}</Text>
          : null
      }
      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: theme['c-primary-background'] }]}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={t('music_recognition_again')}
          onPress={onAgain}
        >
          <Text size={14} color={theme['c-primary-font']}>{t('music_recognition_again')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = createStyle({
  container: {
    width: '100%',
    marginTop: 20,
  },
  eyebrow: {
    marginBottom: 6,
  },
  name: {
    marginBottom: 4,
  },
  subtitle: {
    lineHeight: 20,
  },
  buttons: {
    flexDirection: 'row',
    marginTop: 16,
  },
  button: {
    flex: 1,
    height: 38,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
```

- [ ] **Step 4: 面板接真实流程**

把 `src/screens/MusicRecognition/RecognizePanel.tsx` 整体替换为（相比原计划：去掉 `pop`/`setNavActiveId`/`setSearchText`/`componentId` 这条「跳搜索」链路，去掉 `openInSearch`，并按 Ruling T7a 用 `isNcmEngineEnabled()` 决定引擎数组、按 Ruling T5a 把 `recognizeWithEngines` 包进 try）：

```tsx
import { useEffect, useRef, useState } from 'react'
import { TouchableOpacity, View } from 'react-native'
import Text from '@/components/common/Text'
import Waveform from '@/components/musicRecognition/Waveform'
import AfpWasmView from '@/components/musicRecognition/AfpWasmView'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { type EngineInfo } from '@/core/musicRecognition/engines'
import { createGuard } from '@/core/musicRecognition/limiter'
import { recognizeWithEngines } from '@/core/musicRecognition/provider'
import { isNcmEngineEnabled } from '@/core/musicRecognition/configStore'
import { isWasmReady } from '@/core/musicRecognition/wasmBridge'
import { LISTEN_SECONDS, NCM_SAMPLE_RATE, WINDOW_FROM_SECONDS, WINDOW_LEN_SECONDS, decimateTo8k } from '@/core/musicRecognition/pcmSplitter'
import { createNcmEngine } from '@/core/musicRecognition/ncmEngine'
import { type Guard, type RecognizeOutcome, type RecognizedSong, type RecognizeReason } from '@/core/musicRecognition/types'
import { cancelRecord, isAudioRecordSupported, recordPcm, requestRecordPermission } from '@/utils/nativeModules/audioRecord'
import { getData, saveData } from '@/plugins/storage'
import { createStyle } from '@/utils/tools'
import ResultCard from './ResultCard'

type Phase = 'idle' | 'listening' | 'matching' | 'result' | 'error' | 'not_ready'

const MAX_PER_DAY = 30
const GUARD_STORAGE_KEY = 'musicRecognition.guard'

const guardStorage = {
  get: async() => {
    const value = await getData<string>(GUARD_STORAGE_KEY)
    return typeof value == 'string' ? value : null
  },
  set: async(value: string) => {
    await saveData(GUARD_STORAGE_KEY, value)
  },
}

const createGuardInstance = (): Guard => createGuard({ maxPerDay: MAX_PER_DAY, storage: guardStorage, now: Date.now })

export default ({ engine }: { engine: EngineInfo }) => {
  const t = useI18n()
  const theme = useTheme()
  const [phase, setPhase] = useState<Phase>(() => (engine.implemented && isAudioRecordSupported() ? 'idle' : 'not_ready'))
  const [remain, setRemain] = useState(LISTEN_SECONDS)
  const [song, setSong] = useState<RecognizedSong | null>(null)
  // 'denied' 是面板自己的状态（麦克风没给权限），不属于 provider 的 RecognizeReason；
  // 两者各用各的文案：权限缺失要教用户去设置里开，运营关停只该说「暂时不可用」。
  const [reason, setReason] = useState<RecognizeReason | 'denied' | null>(null)
  const tickRef = useRef<NodeJS.Timeout | null>(null)
  const cancelledRef = useRef(false)
  const isUnmountedRef = useRef(false)

  const clearTick = () => {
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
  }

  useEffect(() => {
    isUnmountedRef.current = false
    return () => {
      isUnmountedRef.current = true
      clearTick()
      // 卸载时无论处于哪个阶段都通知原生停止：没有采集在跑时 cancel() 只是改一个布尔量
      cancelRecord()
    }
  }, [])

  const reset = () => {
    cancelledRef.current = true
    clearTick()
    cancelRecord()
    setSong(null)
    setReason(null)
    setRemain(LISTEN_SECONDS)
    setPhase('idle')
  }

  const errorText = (why: RecognizeReason | 'denied' | null): string => {
    switch (why) {
      case 'daily':
        return t('music_recognition_limited')
      case 'denied':
        return t('music_recognition_denied')
      case 'unsupported':
        return t('music_recognition_not_ready')
      case 'no_match':
        return t('music_recognition_no_match')
      default:
        return t('music_recognition_failed')
    }
  }

  const run = async() => {
    // 桥没就绪时连录音都别开始。顺序很关键：provider 是先 `guard.onAttempt()` 扣掉每日额度、
    // 再让引擎去 `fingerprintFromWasm` 抛「not ready」的。在那种 WebView 起不来的设备上
    // （被厂商禁用、系统 WebView 过旧、资产缺失），用户每次都要白等 8 秒录音、白扣 1/30 额度，
    // 最后只看到一句「识曲服务暂时没响应」。这里提前拒，把「这台设备用不了」说清楚，一克额度都不花。
    // 唯一误伤是「刚进页 1 秒内就点」——注入还没回 ready，会看到「识别还没接入」，再点一次就好；
    // 不要为此加轮询重试，那会把闸门挪到识别路径上去。
    if (!isWasmReady()) {
      setReason('unsupported')
      setPhase('error')
      return
    }
    cancelledRef.current = false
    setSong(null)
    setReason(null)
    setPhase('listening')
    setRemain(LISTEN_SECONDS)

    const granted = await requestRecordPermission()
    if (isUnmountedRef.current || cancelledRef.current) return
    if (!granted) {
      setReason('denied')
      setPhase('error')
      return
    }

    let left = LISTEN_SECONDS
    tickRef.current = setInterval(() => {
      left -= 1
      setRemain(left > 0 ? left : 0)
      if (left <= 0) clearTick()
    }, 1000)

    let pcm: Int16Array
    try {
      pcm = (await recordPcm(LISTEN_SECONDS)).pcm
    } catch {
      clearTick()
      if (!isUnmountedRef.current && !cancelledRef.current) {
        setReason('failed')
        setPhase('error')
      }
      return
    }
    clearTick()
    if (isUnmountedRef.current || cancelledRef.current) return

    setPhase('matching')
    // 一次采集多路输出：这里抽成引擎约定的 8kHz 识别窗口
    const window8k = decimateTo8k(pcm, NCM_SAMPLE_RATE, WINDOW_FROM_SECONDS, WINDOW_LEN_SECONDS)
    let outcome: RecognizeOutcome
    try {
      // Ruling T5b/T7a：运营把 ncm 关掉时数组必须真的是空，让 provider 回 unsupported（页内说「暂时不可用」），
      // 既不能把关掉的引擎照样发出去，也不能伪装成「没听到歌」。
      const engines = (engine.implemented && await isNcmEngineEnabled()) ? [createNcmEngine()] : []
      outcome = await recognizeWithEngines(engines, window8k, createGuardInstance())
    } catch {
      // Ruling T5a：provider 里 check/onAttempt/onSuccess/onFailure 四处 await 都在 try 之外，
      // 闸门自己一抛就会冒到这里。不兜住的话 phase 永远停在「匹配中」，比报错更糟。
      if (isUnmountedRef.current || cancelledRef.current) return
      setReason('failed')
      setPhase('error')
      return
    }
    if (isUnmountedRef.current || cancelledRef.current) return

    if (outcome.ok) {
      setSong(outcome.song)
      setPhase('result')
    } else {
      setReason(outcome.reason)
      setPhase('error')
    }
  }

  const busy = phase == 'listening' || phase == 'matching'
  const statusText = phase == 'listening'
    ? `${t('music_recognition_listening')} ${remain}s`
    : phase == 'matching'
      ? t('music_recognition_matching')
      : phase == 'not_ready'
        ? t('music_recognition_not_ready')
        : phase == 'error'
          ? errorText(reason)
          : t('music_recognition_idle')

  return (
    <View style={styles.container}>
      <Text size={13} color={theme['c-font-label']} style={styles.desc}>{t(engine.descKey)}</Text>
      <TouchableOpacity
        style={[styles.disc, {
          borderColor: busy ? theme['c-primary'] : theme['c-300'],
          backgroundColor: busy ? theme['c-primary-background'] : theme['c-button-background'],
        }]}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={t('music_recognition')}
        onPress={() => {
          if (busy) {
            reset()
          } else {
            void run()
          }
        }}
      >
        <Waveform
          active={busy}
          bars={11}
          height={busy ? 44 : 30}
          color={busy ? theme['c-primary'] : theme['c-300']}
        />
      </TouchableOpacity>
      <Text size={16} style={styles.status}>{statusText}</Text>
      {
        phase == 'not_ready'
          ? <Text size={12} color={theme['c-font-label']} style={styles.hint}>{t('music_recognition_not_ready_desc')}</Text>
          : null
      }
      {
        busy
          ? (
              <TouchableOpacity style={styles.stopBtn} activeOpacity={0.8} accessibilityRole="button" onPress={reset}>
                <Text size={13} color={theme['c-primary-font']}>{t('music_recognition_stop')}</Text>
              </TouchableOpacity>
            )
          : null
      }
      {
        phase == 'result' && song
          ? <ResultCard song={song} onAgain={() => { void run() }} />
          : null
      }
      <View style={styles.footer}>
        <Text size={12} color={theme['c-font-label']} style={styles.footerText}>{t(engine.tipKey)}</Text>
        <Text size={12} color={theme['c-font-label']} style={styles.footerText}>{t('music_recognition_privacy')}</Text>
      </View>
      {engine.implemented ? <AfpWasmView /> : null}
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 20,
    paddingRight: 20,
  },
  desc: {
    marginBottom: 22,
    textAlign: 'center',
  },
  disc: {
    width: 168,
    height: 168,
    borderRadius: 84,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: {
    marginTop: 24,
    textAlign: 'center',
    lineHeight: 22,
  },
  hint: {
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 18,
  },
  stopBtn: {
    marginTop: 18,
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 6,
    paddingBottom: 6,
  },
  footer: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 18,
  },
  footerText: {
    textAlign: 'center',
    lineHeight: 18,
  },
})
```

- [ ] **Step 4b: 改掉 `AfpWasmView` 里那条与本页冲突的注释（只动注释，一行代码都不许动）**

Task 7 评审的 Minor-9 让实现者写了一段「必须挂在 App 根」的文档注释，但本任务把它挂在 `RecognizePanel` 里（`{engine.implemented ? <AfpWasmView /> : null}`）。这条注释现在是**错的**，而错误的注释会让后来者「顺手」把挂载点挪到 App 根去，所以必须就地改正。把文件顶部组件的那段 docblock 整体替换为：

```ts
/**
 * 隐藏 WebView：加载 afp.wasm 与打补丁的胶水，把 8kHz 样本换成指纹字符串。
 * 只负责算指纹，不碰麦克风、不联网。
 * 挂载位置：RecognizePanel 内，只在 implemented 的引擎标签打开时存在。
 * 代价是每次进页重注入一次（assets 有模块级缓存，省掉重复读 308KB）；换来的是从不进识曲页的
 * 设备不必常驻一个 WebView 和它的 wasm 堆。因此调用方必须先问 isWasmReady() 再开始录：
 * 桥没就绪时 provider 已经扣掉每日额度了，白录 8 秒还白花钱。
 */
```

Run:
```bash
git diff --stat src/components/musicRecognition/AfpWasmView.tsx
```
Expected: 只有注释行的改动（`+/-` 全在 docblock 范围内）。若 diff 里出现任何 `useRef`/`injectJavaScript`/`postMessage` 行，说明你动了逻辑，撤回去。

- [ ] **Step 5: 闸门**

`src/screens/MusicRecognition/index.tsx` **不动**：原计划的 Step 7（把 `componentId` 传进面板）只为「pop 回搜索页」服务，一并作废。

```bash
npm test 2>&1 | tail -4
npx tsc --noEmit 2>&1 | tail -1
npm run lint 2>&1 | grep -E "RecognizePanel|ResultCard|musicRecognition/engines" || echo "clean"
```
Expected: `# fail 0`；tsc == 基线；`clean`。
若 tsc 报 `isNcmEngineEnabled` 或 `RecognizeOutcome` 找不到，说明 Task 7 的 `configStore.ts` 导出或 `types.ts` 类型没接上；不要改成 `(… as any)`。

- [ ] **Step 6: Metro 打包 + 提交**

打包闸门分两步，别一上来就跑全量（全量会先撞本仓库既有的 `china_ink.jpg` 缺失，与本任务无关）：

```bash
# 6a 先证明「我改的这几个模块」能被 Metro 解析、能过 Babel
cat > recognition-bundle-check.js <<'EOF'
import '@/screens/MusicRecognition/RecognizePanel'
import '@/screens/MusicRecognition/ResultCard'
import '@/core/musicRecognition/engines'
EOF
mkdir -p .bundle-check-tmp
npx react-native bundle --platform android --dev false --entry-file recognition-bundle-check.js \
  --bundle-output .bundle-check-tmp/index.android.bundle --assets-dest .bundle-check-tmp/res 2>&1 | tail -3
rm -f recognition-bundle-check.js
rm -rf .bundle-check-tmp
```
Expected: `Done writing bundle`（或 `Done Writing bundle`）。这一步红才是本任务的缺陷。

```bash
# 6b 全量打包：已知会因 china_ink.jpg 失败，记录原文，不要顺手恢复别人的删除（Ruling P3）
mkdir -p .bundle-check-tmp
npx react-native bundle --platform android --dev false --entry-file index.js \
  --bundle-output .bundle-check-tmp/index.android.bundle --assets-dest .bundle-check-tmp/res 2>&1 | tail -2
rm -rf .bundle-check-tmp
```
若 6b 报的**不是** `china_ink.jpg`（或其他主题图片）解析失败，而是本任务这几个文件里的任何一个，那才是你的问题，修完再提交。

- [ ] **Step 6c: 提交 lang 时必须按 Ruling T8d 做「部分暂存」，不能直接 `git add src/lang/*.json`**

**这是本任务最容易犯的一次污染。** 三份 lang 在 HEAD 里是 **579 键**，工作区是 **672 键** —— 中间 93 键里只有 22 键是识曲的（第 0 期 16 键 + 本任务 6 键），**另外 71 键是别人未提交的推荐问卷/协议弹窗文案**（`recommend_onboarding_*`、`recommend_radio_status_*`、`pact_*`、`play_detail_tab_*`…）。直接 `git add` 会把别人没准备提交的文案写进本功能的提交里，将来这个分支推出去就是替别人发版。**工作区那份 672 键一个字都不许动**，只把「HEAD + 22 个识曲键」这一份推进 index：

```bash
node C:/Users/30913/AppData/Local/Temp/t8pure/make-pure-lang.cjs   # 生成并自证三份候选
git add src/core/musicRecognition/engines.ts \
  src/screens/MusicRecognition/RecognizePanel.tsx src/screens/MusicRecognition/ResultCard.tsx \
  src/components/musicRecognition/AfpWasmView.tsx
for f in zh-cn zh-tw en-us; do
  blob=$(git hash-object -w "C:/Users/30913/AppData/Local/Temp/t8pure/$f.json")
  git update-index --cacheinfo 100644,"$blob","src/lang/$f.json"
done
git diff --cached --stat   # 必须只有这 7 个路径
```
提交前自证（**三条都要满足才许 commit**）：
```bash
for f in zh-cn zh-tw en-us; do
  git show :src/lang/$f.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);const k=Object.keys(o);
console.log('$f', k.length, 'foreign', k.filter(x=>/^(recommend_|pact_|play_detail_tab_|play_mode|music_more_play_next|more_actions|clear$)/.test(x)).length, 'recognition', k.filter(x=>x.startsWith('music_recognition')).length)})"
done
```
Expected: 每行 `601 foreign 0 recognition 22`。之后
```bash
git commit -m "feat(recognition): 识曲页接录音与识别流程，结果页内展示"
git status --porcelain src/lang/   # 应重新出现 3 条 M —— 别人的 71 键回到未提交状态，这才是对的
```
若那三条 `M` 没回来，说明你把别人的改动一起提交了，立刻 `git show HEAD -- src/lang/zh-cn.json` 查清楚再处理。
（`make-pure-lang.cjs` 是控制方写的只读生成器：它取 HEAD blob、按工作区原样插入 22 个 `music_recognition*` 行、并自证「HEAD 键零漂移 + 识曲键与工作区逐字相同 + 顺序一致」，输出 601 键。**不要**自己改写它，也不要改用「整份覆盖」的偷懒写法。）

---

### Task 9: 全量验证、spec 回写与真机验收

**Files:**
- Modify: `docs/superpowers/specs/2026-10-10-music-recognition-design.md`

**Interfaces:**
- Consumes: 前 8 个任务的全部产物
- Produces: 与代码一致的 spec + 一份逐条如实标注的真机结论

- [x] **Step 1: 全量静态闸门**（已实跑，命令按本机可复现的形态改过——原写法有三处会假绿/假红）

```bash
npm test 2>&1 | tail -8                      # 必须看整排计数器，不能只看 pass 那一行
npx tsc --noEmit 2>&1 | grep -c "error TS"   # 必须是 grep -c，见下
npx eslint --ext .ts,.tsx src/screens/MusicRecognition/ src/components/musicRecognition/ \
  src/core/musicRecognition/ src/utils/nativeModules/audioRecord.ts; echo "exit=$?"
cd android && JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" ./gradlew assembleDebug 2>&1 | tail -3
```

Expected（**2026-10-11 在 `af9fc1d` 上的实测值**）：

- `npm test` ⇒ `tests 221 / pass 221 / fail 0 / cancelled 0 / skipped 0`。**`tail -4` 不够**：它只截到 `pass/fail/cancelled`，看不到 `skipped: 0`，而"没有用例被静默跳过"必须整排引出来才算。本期新增 **6 个测试文件、64 个用例**（不是原计划写的 5 个）：`pcm-splitter` 6、`afp-glue` 3、`ncm-api` 16、`limiter` 15、`remote-config` 13、`provider` 11。
- tsc ⇒ **137 == `TSC_BASELINE`**。原计划的 `npx tsc --noEmit 2>&1 | tail -1` **在这台机器上永远拿不到数字**：管道里的 tsc 不打印 `Found N errors` 汇总（只有直接写终端时才打），所以 `tail -1` 是空行，看起来"没报错"其实是没输出。唯一正确的计数器是 `grep -c "error TS"`。
- 本功能文件 eslint ⇒ **exit 0、零输出**。全量 `npm run lint` 有约 **1718 条既有问题**（他人基线），拿它的 `tail -8` 当闸门只会让人顺手去修别人的代码。另注：`--ext` 覆盖不到 `.mts`（测试文件）也覆盖不到 `.java`。
- `assembleDebug` ⇒ **BUILD SUCCESSFUL in 2m19s**，5 个 ABI 的 APK。**Git Bash 里要写 `./gradlew` 并显式给 `JAVA_HOME`**，`gradlew.bat` 是 cmd 那条路径。

再加一道**只读自洽闸门**（这次真的抓到东西）：在 **HEAD 的 blob** 上解析本功能所有文件的相对/`@/` import，逐个 `git cat-file -e HEAD:<候选路径>`。参考实现在 `Temp/tipcheck.cjs`（只读、不进仓库）。它抓到的正是 `src/screens/index.ts` 漏掉的那一行桶文件导出——**脏工作区上的 tsc/打包全绿完全掩盖不了"干净 checkout 编不过"**，所以每笔"补齐型"提交后都要跑它，而不是只信本机的 137。

- [x] **Step 2: 打包产物自检**（已实跑于最终 HEAD `2a00700`；全量打包**已转绿**：用户拍板「只恢复那 3 张图片」后，挡在 `src/theme/themes/index.ts:11` 的 `china_ink.jpg` 解析失败消失了）

```bash
mkdir -p .bundle-check-tmp
npx react-native bundle --platform android --dev false --entry-file index.js \
  --bundle-output .bundle-check-tmp/index.android.bundle --assets-dest .bundle-check-tmp/res 2>&1 | tail -3
for s in MusicAudioRecord Encode8kB64 api/music/audio/match recognition/afp.wasm \
         music_recognition_found music_recognition_limited music_recognition_listening music_recognition_matching; do
  printf '%s => %s\n' "$s" "$(grep -c -F "$s" .bundle-check-tmp/index.android.bundle)"
done
rm -rf .bundle-check-tmp
```

Expected: 末三行 `info Done writing bundle output` / `Copying 9 asset files` / `Done copying assets`；八个字符串**全部 ≥ 1**。实测：`af9fc1d` 时 bundle **8331352 字节**；轮次 2 + 收尾两笔之后（最终 HEAD `2a00700`）八个字符串 **1/1/1/1/4/4/4/4**、bundle **8331533 字节**（+181 是新增的两处闸门与预热的代码，注释不会进 release bundle）。同一 HEAD 上另三条静态闸门与 `tipcheck.cjs` 全部复跑过：`npm test` 221/0、`tsc` 137、本功能 eslint exit 0、HEAD blob 上除 5 条既有注释掉的导出外全部可解析。

**两条被证伪的探针（写下来免得下次又把探针当成缺陷）**：

- `ExtractQueryFP` **不在** JS bundle 里，而且**不该在**。它只存在于 `android/app/src/main/assets/recognition/afp-glue.js` 与 `afp.wasm`（两份都已 git 跟踪且干净，88861 / 231182 字节），经 RNFS 从 asset 读，不经 Metro。拿它当 bundle 探针会得到假红。
- `music_recognition_recognizing` **不是真实键名**。真实的过程文案是 `music_recognition_listening`（「正在聆听」）与 `music_recognition_matching`（「正在匹配」）；`_found`/`_limited`/`_not_ready`/`_denied`/`_no_match`/`_failed`/`_again`/`_idle`/`_stop` 与那四个引擎/说明键才是全部识曲键。用 `grep -c -F` 逐条数比"看起来在"可靠。

`grep -c "__DEV__"` 那条旧自检可以去掉：release bundle 里 `__DEV__` 已被替换成 `!1`，数它证明不了日志剥没剥，剥不剥要靠 python 探 Hermes 字节码里的字符串常量（见 `project-release-build-hygiene`）。

- [x] **Step 3: 回写 spec**（已做完，且范围比原列的七条大——实现期推翻设计的部分必须全部落回正文，否则照计划重跑会把已修的坑装回去）

`docs/superpowers/specs/2026-10-10-music-recognition-design.md` 现状：**§2.3 入口理由、§3 架构图与依赖现状、§4.1–§4.6、§5 状态机、§6 结果落地、§7 权限隐私、§8 测试策略、§9 风险表**都已改成 shipped 形态。原七条之外的增补：

1. §4.1 Kotlin → **Java**；实际封装名 `recordPcm/requestRecordPermission/cancelRecord/isAudioRecordSupported`，原生名 `MusicAudioRecord.start(int, Promise)` / `cancel()`；补上 `EBUSY`（第二路并发）与 `EPERM`（中途撤权）两条语义。
2. §4.3 整节重写：四文件拆分、`recognize(pcm: Int16Array)` 的真实契约、**WebView 挂 `RecognizePanel` 而非 App 根**、跨桥只传字符串、资产字节数与 `noCompress 'wasm'`、业务 `code != 200` 要抛、15s 与"上下文失效当场结算"。
3. §4.5 补：四处闸门 await **故意在 try 外**、`limiter` 已自带兜底所以包装别再套 try、**原设计的 PCM/指纹内存缓存未实现且不该补**、`ALLOWED_HOSTS` 白名单与 `\@` 伪装、镜像 4s 超时 + stale-while-revalidate + **面板 mount 预热（不在 App 启动预热）**、`DEFAULT_CONFIG` 的关停悖论 runbook。
4. §4.6 删掉"新建 store"与"仅前端落地"两段，改为面板内部状态 + **页内结果卡**，并给出**失败文案 → 键名**对照表（含 T8-f1：`unsupported` 已不再渲染「识别还没接入」）。
5. §6 整节改写为"已改为页内展示，两条下游路径都没接"，并把 `musicInfo`/`findMusic` 的确切入口留在文中标为后续期用。
6. §8 换成真实的六个测试文件与用例数、221/137 基线、**"面板与 WebView 没有单测"的如实声明**、变异收口约定。
7. §9 风险表去掉两条不存在的保险：**第一期没有 B→A 降级**（A 是二期），**也没有"换个结果"通路**（结果卡只有「再听一次」）。

- [ ] **Step 4: 提交 spec —— 控制方决定不做，等用户裁定**

原计划要 `git add docs/superpowers/specs/2026-10-10-music-recognition-design.md && git commit`。**现在不能这么干**：这份文档同时带着另一条工作线的并发未提交编辑（同一目录下 `2026-10-08-recommend-onboarding-design.md` 也在 ` M`，且本文档 §10/§11 与 §8 真机清单第 6–8 条不是本轮控制方写的）。提交它等于替别人发版，正是 Ruling T8d 要避免的事。JSON 能靠只读生成器切净，散文切不净。

**处置**：保持未提交，交付说明里写明"spec 已回写但未提交，等用户决定由谁提交哪一段"。（原写法留在这里作为偏差记录，`git add` 那行**不要执行**。）

- [ ] **Step 5: 真机验收清单（单测结论不能代替；本项目 adb 文本注入进不了 RN 输入框、toast 抓不到，全部看屏内状态文本）**

> **状态（2026-10-11，两台真机跑完；完整证据在 `.superpowers/sdd/2026-10-10-music-recognition-phase1/progress.md` 的两段 Step 5 记录里）**：
> **已验** —— 1（vivo 拒绝后不反复弹 / OPPO 第 3 次起 ColorOS 永久静默拒）、2、3（两台都无 `EBUSY`）、4 的展示半边、5（Android 16 与 Android 11 两侧 `afp.wasm` 都 instantiate 成功）、**6（在 vivo 的 release 包上真把 30 次额度用光，第 19 轮屏内翻成「今天的识曲次数用完了，明天再来」；BACK 退出重进面板后判定不变 ⇒ 计数器在盘上不在内存）**、8、9（含「该标签不挂 WebView」的 `ps`/logcat 反证）、10（强制横屏后布局不变）、11（取消后 1 秒内重录正常，无串台）。
> **未验（写清楚原因，别当已通过）** —— 4 的「再听一次」半边、12②：② 要临时改 JS 常量或控制远端镜像，两台现在装的都是 release（无 Metro），额度与配置判定都只能靠真数据触发；7 的来电半边：没有可拨入的号码；13：非 root 的 adb 杀不掉 isolated renderer，页内 OOM 代理被自己的 `catch` 吞掉；2/4 在 OPPO 的正例半边：用户要求测试期间不外放，音量 1 档时构造不出有效声源。
> **清单本身有一处写错了复现路径**：12① 说「在系统里撤掉 `RECORD_AUDIO` 后重进页面应落『识别还没接入』」——不成立。`isAudioRecordSupported()` 是 `Platform.OS == 'android' && NativeModules.MusicAudioRecord != null`（`audioRecord.ts:17`）的编译期探针，跟运行时权限无关；撤权限后重进只会（也应该）落「需要麦克风权限…」。该分支只能在 iOS 或没编进原生采集模块的包里验。
> **跑清单时新量到的两条真实延迟**（不崩，但影响观感）：取消后立刻重录时，圆盘 tap 到 JS 进 `listening` 约 2s、进 `listening` 到原生 `AudioRecord start` 约 1.9s ⇒ 「正在聆听 8s」的头两秒可能是静音。

两台都跑：vivo（Android 16，无线调试，会话易掉线、端口会轮换）与 OPPO PCHM10（Android 11）。真机注入前先确认前台是目标 App。

1. 首次点圆形按钮 → 系统弹麦克风权限；选**拒绝** → 屏内出现「需要麦克风权限…」，且不会反复弹窗
2. 选**允许** → 「正在聆听 Ns」倒数到 0，随后切到「正在匹配」，再出结果卡或失败文案（用外放自家歌曲自识别是最快的正例）
3. 录制途中点「停止」→ 立刻回 idle；紧接着第二次点击能正常重新采集（验证原生 `EBUSY`/`ECANCEL` 没把 `AudioRecord` 卡住）
4. 结果卡在**识曲页内**出现（歌名/歌手/专辑齐全，不跳走）；「再听一次」→ 同页重新进入倒数采集，不需要退出页面重进
5. **重点**：OPPO Android 11 的系统 WebView 能否稳定 `WebAssembly.instantiate` 约 308KB 模块 —— 失败表现是卡在「正在匹配」最后出「识曲服务暂时没响应」。若坐实，spec §3 的 WebView 选型要回炉重评 wasm3 原生方案
6. 连点 31 次（或把 `MAX_PER_DAY` 临时改成 2 再装 debug 包，验完改回）→ 「今天的识曲次数用完了」
7. 识别期间来电 / 切后台再回来 → 不崩、不永久卡在「正在匹配」（靠 15s 指纹超时与 10s 请求超时兜住）
8. 安静环境下点一下 → 走「没听出来」，不崩不挂
9. 切到 Shazam 标签 → 仍是「识别还没接入」（确认 `implemented: false` 生效，且该标签不挂 WebView）
10. 全程竖屏锁定，横放设备不改变布局（AGENTS.md 约定）
11. **轮次 2 的竞态回归**：放一首歌让它进「正在匹配」（网络请求要几秒），点「停止」后**在 1 秒内**再点圆盘。期望：新轮正常倒数采集，不出现上一轮结果卡串台、波形不冻、「停止」按钮不消失、不报 `EBUSY` 类「服务暂时没响应」。这条只能真机跑——单测摸不到面板
12. **轮次 2 的文案分界**：① 找一台无采集能力的包（或在系统里撤掉 `RECORD_AUDIO` 后重进页面）→ 应落「识别还没接入」而不是「需要麦克风权限」；② 把热更新配置改成 `enabled:false` 重进页面 → 应是「识曲服务暂时没响应，过一会儿再试」，**绝不能是「识别还没接入」**（功能已接上，那句是假话 = T8-f1）
13. **Residual C（本轮最弱一环）**：识别前把 App 压后台直到系统杀掉 WebView renderer，再回来点识曲。期望第一次可能落「暂时没响应」，**再点一次应能恢复**（`reload()` 能否救回被杀 renderer 从未验过，原生只发事件不重建 view；API 21–25 那一档根本不发 `onRenderProcessGone`）。救不回来就把挂载方式改成 key 重挂组件，别加轮询

跑完把 1～13 的实际结果逐条如实回报，**没跑过的标「未验」**，不要把清单当已完成。

---

## 完成判据

同时满足才算第一期完成：

1. `npm test` 含 **6 个**新增测试文件全绿（221 pass / 0 fail / cancelled 0 / skipped 0 整排都要引出来），且 `npx tsc --noEmit | grep -c "error TS"` == Task 0 基线 **137**
2. `cd android && JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" ./gradlew assembleDebug` ⇒ `BUILD SUCCESSFUL`
3. Task 9 Step 2 的**八个**字符串在 release bundle 里都能查到（`ExtractQueryFP` 不算 bug，它只在 APK asset 里）
4. Task 2 Step 6 的联网复核在**交付当天**仍然返回 `http 200 code 200`（逆向接口无 SLA，隔天的结论不算结论）
5. **只读自洽闸门**：HEAD blob 上本功能所有 import 全部可解析（见 Step 1 末段）。脏工作区的绿不算绿
6. 轮次 2（F1–F7）经**限定范围复评**收口：每条 finding 判 ADDRESSED、修复本身没引入新 Critical/Important
7. 真机清单 1～4、9、**11、12** 已实跑并有结论（10、13 若因设备/系统版本不可用而未跑，必须在交付说明里写明「未验」）
8. spec 已按 Task 9 Step 3 回写成 shipped 形态。**"并提交"这条由用户裁定**：这份文档此刻同时带着他人工作线的并发编辑，控制方不替别人发版

**未满足第 7 条时，不许把目标标成完成。** 第 8 条未定时，交付说明必须写明 spec 是「已回写、未提交」。是否把本分支推双远程（GitHub + Gitee）属于用户决定，未获授权前一律不推。
