# 分享图（Apple Music 风格分享卡 + 歌词海报）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让「分享音乐」和「歌词海报」各产出一张 Apple Music 风格的竖图（虚化封面铺底 + 居中圆角卡），可在预览页右上角下载或走系统分享面板。

**Architecture:** 卡片写成普通 RN 组件，`react-native-view-shot` 的 `captureRef` 把预览容器拍成 PNG —— 预览与导出共用同一个组件，只有一份排版。模糊底、封面取色、tone 明暗判定全部复用已有的 monet 链路；文件落地走已在真机验通的 SAF 三件套。

**Tech Stack:** React Native 0.73.11（Hermes，Paper 老架构）、TypeScript、`react-native-view-shot@4.0.3`、`@material/material-color-utilities@0.4.0`、Android Java 原生模块、`node --test`。

**Spec:** `docs/superpowers/specs/2026-10-16-share-card-image-design.md`（本计划逐条实现它，执行时两份一起读）

## Global Constraints

每个任务的隐含要求，值从 spec 逐字抄来：

- **依赖版本锁死 `react-native-view-shot@4.0.3`**。`5.x` peer 要 `react-native >= 0.76`、`6.x` 要 `>= 0.80`，本项目 RN 0.73.11 装不上；`4.0.3` peer 是 `"*"` 且带 `android/src/paper/` 源集。
- **不碰 `src/components/common/Image.tsx`**。封面用私有 `CoverImage` 组件包 RN 核心 `<Image>`，只从 `Image.tsx` import 已导出的 `defaultHeaders`。
- **横屏完全不参与**（AGENTS.md 锁竖屏 + 用户明确要求）。功能只在 `src/screens/PlayDetail/Vertical/` 这条树上。
- **不改 `UtilsModule.shareText`、不改 `res/xml/file_paths.xml`**（现有 `<cache-path name="cache" path="/" />` 已覆盖 view-shot 的临时目录）。
- **其它分享入口本轮保持纯文本**：`OnlineList/listAction.ts:31`、`Mylist/MusicList/listAction.ts:71`、`Recommend/index.tsx:430`、`MusicRecognition/ResultSections.tsx:79`、`SonglistDetail/Header.tsx:102`。
- **纯判据模块必须零 `react-native` import**（沿用 `src/core/lyricCopy.ts` 的规矩：`node --test` 要能直接载）。
- **`npm test` 用的是 package.json 里写死的文件清单**，新增测试文件必须追加到 `"test"` 脚本末尾，否则不会被跑到。
- **验证闸门**：`npx tsc --noEmit`（唯一能查未定义标识符的闸门）+ `npx eslint <自己改过的文件>`；`npm test` 的总数会随别人未提交的 WIP 漂移，判据只用"grep 自己改过的文件没有新增 fail"。
- **改 Java 用 `cd android && ./gradlew :app:compileDebugJavaWithJavac` 验编译**，不要为了验一行 Java 跑整包。
- **落款**：`app-icon-glyph.png` + 紧跟 `Music` 两个字母，不带 App 名。
- **透明度初值**（真机观感调参项，不是判据）：底层 scrim `rgba(0,0,0,0.20)`；深卡卡底 `rgba(28,28,30,0.72)`；亮卡卡底 `#FFFFFF` 不透明。

### 关于真机步骤

本项目的安卓验证全部在真机上做（两台设备）。标了 **[真机]** 的步骤需要用户配合：构建装机由代理执行，屏幕上的判断由用户回报。构建 ETA：纯 JS 增量 2–3 分钟，改 Java 或改依赖 6–8 分钟。

---

### Task 1: 装上 view-shot 并跑三条生死探针

spec §8 的三条探针任何一条挂了就回到 spec 改设计，不要绕过、不要先写正式代码。

**Files:**
- Modify: `package.json`（加依赖）
- Create: `src/components/ShareCard/probe/BlurProbeCard.tsx`（**一次性探针，Task 6 结束前删**）
- Modify: `src/screens/PlayDetail/Vertical/Lyric.tsx:501`（临时把 disabled 按钮接上探针）

**Interfaces:**
- Consumes: 无
- Produces: 三条探针的真机结论（写进 spec §8 下面），以及一个已验证能编译、能 autolink、能拍出文件的 `react-native-view-shot@4.0.3`

- [ ] **Step 1: 装依赖**

```bash
npm i --save-exact react-native-view-shot@4.0.3
```

预期：`package.json` 的 `dependencies` 里出现 `"react-native-view-shot": "4.0.3"`（**不能是 `^4.0.3`**）。postinstall 会跑 `dependencies-patch.js`，输出里不应有 patch 失败。

- [ ] **Step 2: 确认没有嵌套 node_modules 冲突**

```bash
node -e "console.log(require('react-native-view-shot/package.json').version)"
ls node_modules/react-native-view-shot/android/src/paper/java/fr/greweb/reactnativeviewshot/
```

预期：`4.0.3`；列出 `NativeRNViewShotSpec.java`。少了 paper 目录说明装错版本。

- [ ] **Step 3: 写探针卡片**

这个组件同时回答三条探针：背景糊没糊、远程封面拍到没拍到、状态栏在不在图里。它故意把三种情况摆在一张图里。

Create `src/components/ShareCard/probe/BlurProbeCard.tsx`:

```tsx
// 一次性探针（spec §8）。Task 6 的正式 ShareCard 落地后整个 probe 目录删掉。
import { useRef, useState } from 'react'
import { Modal, StyleSheet, Text, TouchableOpacity, View, ImageBackground } from 'react-native'
import { captureRef } from 'react-native-view-shot'
// 默认导出：仓库里全部 react-native-fs 用法都是 `import RNFS from 'react-native-fs'`
import RNFS from 'react-native-fs'
import { defaultHeaders } from '@/components/common/Image'
import { usePlayMusicInfo } from '@/store/player/hook'
import { useWindowSize } from '@/utils/hooks'

const BLUR_RADIUS = 90

const toPath = (uri: string) => uri.replace(/^file:\/\//, '')

export default ({ onClose }: { onClose: () => void }) => {
  const shotRef = useRef<View>(null)
  const [state, setState] = useState('idle')
  const [report, setReport] = useState('')
  const { width, height } = useWindowSize()
  const musicInfo = usePlayMusicInfo()?.musicInfo

  const cover = musicInfo && 'progress' in musicInfo ? musicInfo.metadata.musicInfo.pic : musicInfo?.pic
  const uri = typeof cover == 'string' && cover.startsWith('/') ? `file://${cover}` : cover

  const shoot = async() => {
    setState('shooting')
    try {
      const out = await captureRef(shotRef, { format: 'png', quality: 1, result: 'tmpfile', fileName: 'lxprobe' })
      const path = toPath(out)
      const exists = await RNFS.exists(path)
      const size = exists ? (await RNFS.stat(path)).size : 0
      // 探针只验"拍没拍到"，尺寸与字节数就够判；不往保存目录写
      setReport(`uri=${out}\nexists=${exists} bytes=${size}`)
      setState('done')
    } catch (e) {
      setReport(`captureRef threw: ${String(e)}`)
      setState('failed')
    }
  }

  return (
    // Modal 永远 visible：关闭交给父组件把这层整个撤掉。
    // 反过来用 state 藏 Modal 的话，那枚入口按钮被全屏 Modal 挡在后面，再也点不到 → 探针只能拍一次。
    <Modal visible onRequestClose={onClose} transparent animationType="fade">
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {/* 被拍的就是这一层：它撑满 Modal，所以图里会不会带状态栏，一眼看得出来 */}
        <View ref={shotRef} collapsable={false} style={{ width, height }}>
          <ImageBackground
            blurRadius={BLUR_RADIUS}
            source={uri ? { uri, headers: defaultHeaders } : undefined}
            style={{ flex: 1 }}
          >
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <View style={{ width: width * 0.78, backgroundColor: '#FFF', borderRadius: 28, padding: 20 }}>
                <Text style={{ fontSize: 20, color: '#000' }}>寻音 - 探针</Text>
                <Text style={{ fontSize: 14, color: '#666' }}>{String(cover ?? 'no cover').slice(0, 60)}</Text>
              </View>
            </View>
          </ImageBackground>
        </View>
        <View style={styles.bar}>
          <TouchableOpacity style={styles.btn} onPress={shoot} disabled={state == 'shooting'}>
            <Text style={styles.btnText}>{state == 'shooting' ? '拍摄中' : '拍一张'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={onClose}>
            <Text style={styles.btnText}>关闭</Text>
          </TouchableOpacity>
        </View>
        {report ? <Text style={styles.report}>{report}</Text> : null}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', padding: 16, gap: 12 },
  btn: { paddingHorizontal: 18, paddingVertical: 10, backgroundColor: '#333', borderRadius: 8 },
  btnText: { color: '#FFF' },
  report: { color: '#FFF', paddingHorizontal: 16, fontSize: 11 },
})
```

- [ ] **Step 4: 临时接到歌词海报按钮**

Modify `src/screens/PlayDetail/Vertical/Lyric.tsx`：文件顶部加 `import BlurProbeCard from '@/components/ShareCard/probe/BlurProbeCard'`，组件内加 `const [probeOpen, setProbeOpen] = useState(false)`（`useState` 已在该文件 import 里），把 `:501` 那枚 disabled 按钮换成：

```tsx
<Button style={{ ...styles.toolBtn, backgroundColor: theme['c-button-background'] }} onPress={() => setProbeOpen(true)} accessibilityRole="button">
  <Text size={14} color={theme['c-button-font']} style={styles.toolBtnText}>{t('lyric_tool_poster')}</Text>
</Button>
```

并在 `:507` 的 `) : null` 之后、`</View>` 之前加 `{probeOpen ? <BlurProbeCard onClose={() => setProbeOpen(false)} /> : null}`（探针自己没有能重开的入口，关闭必须交回父组件卸载这层）。

- [ ] **Step 5: 过编译闸门**

```bash
npx tsc --noEmit
```

预期：报错条数与改动前一致（本机基线 137 条，全是既有 WIP 带来的）。**只要没出现 `ShareCard/probe` 或 `react-native-view-shot` 的新增行就算过。** 若出现 `Cannot find module 'react-native-view-shot'`，说明 4.0.3 的 `types: src/index.d.ts` 里那个 `declare module` 没被认下来 —— 记下报错原文，这是要回写 spec 的偏离。

- [ ] **Step 6: [真机] 构建装机**

先记下 adb 设备与构建 PID。构建 ETA 6–8 分钟（多了 autolink 一个新原生模块）。

```bash
cd android && ./gradlew assembleDebug
adb -s <serial> install -r app/build/outputs/apk/debug/app-debug.apk
```

预期：BUILD SUCCESSFUL。若 Metro 报解析不到 `./specs/NativeRNViewShot`，就是 node_modules 里的 `.ts` 没被 transform —— 退路是在 `metro.config.js` 的 `resolver` 里加 `sourceExts` 含 `'ts'`（RN 0.73 默认已含，先确认再动）。

- [ ] **Step 7: [真机] 跑三条探针**

让用户：打开 App → 播放一首**有远程封面**的歌 → 进播放页歌词页 → 长按任意一行 → 点「歌词海报」→ 点「拍一张」。

三条判据（逐条向用户要结论，不要自己猜）：

1. **模糊有没有被拍到**：拍出来的 PNG 里背景是糊的还是清晰的？清晰 = `blurRadius` 没进 `view.draw()`，探针失败。
2. **封面有没有**：卡外面那层背景有没有封面内容？全黑/纯色 = 远程封面没在拍摄前加载完。
3. **状态栏在不在**：屏幕上预览是全屏的，但**报告里的 bytes 与 uri 只能证明拍到了**；要判状态栏得把图拉出来看：

```bash
adb -s <serial> shell "run-as cn.toside.music.mobile cat /data/data/cn.toside.music.mobile/cache/$(adb -s <serial> shell 'ls /data/data/cn.toside.music.mobile/cache | grep lxprobe' | tr -d '\r')" > /tmp/probe.png 2>/dev/null || echo "run-as 拿不到，改用分享按钮"
```

拿不到文件就退一步：让用户点系统里任意方式把 `uri` 那个文件发出来看。**判据是图本身，不是 `exists=true`。**

- [ ] **Step 8: 把结论写回 spec**

Modify `docs/superpowers/specs/2026-10-16-share-card-image-design.md`，在 §8 每条探针后面加一行实测结论（`通过` / `不通过：<现象>` + 日期）。

- [ ] **Step 9: 提交**

```bash
git add package.json package-lock.json src/components/ShareCard/probe src/screens/PlayDetail/Vertical/Lyric.tsx docs/superpowers/specs/2026-10-16-share-card-image-design.md
git commit -m "spike(分享图): 装上 view-shot 4.0.3 并跑通三条导出探针"
```

**若探针 1 不通过**：改用 monet 已有的像素 + `src/utils/monet/png.ts` 自己编码一张模糊小图当底（spec §8 已写明这条退路仍零新依赖），然后回到本计划 Task 6 重排。
**若探针 2 不通过**：Task 5 的 `CoverImage` 必须真的等到 `onLoad` 才放行拍摄，且预览页在放行前要显示"正在准备"。
**若探针 3 不通过**：Task 9 的被拍容器加 `paddingTop: statusBarHeight`。

---

### Task 2: `fitLyricBlock` —— 歌词块最大高度判据

**Files:**
- Create: `src/components/ShareCard/fitLyricBlock.ts`
- Test: `tests/share-card-fit-lyric-block.mts`
- Modify: `package.json`（`"test"` 脚本末尾追加该测试文件）

**Interfaces:**
- Consumes: 无（零 import）
- Produces:
  - `interface LyricBlockLine { text: string, extendedLyrics?: string[] | null }`
  - `interface FitLyricOptions { maxHeight: number, tiers?: readonly number[], lineHeightRatio?: number, extendedTierFloor?: number }`
  - `interface FitLyricResult { fontSize: number, extendedFontSize: number, visibleCount: number, truncated: boolean }`
  - `const LYRIC_TIERS: readonly number[]`（`[24, 22, 20, 18, 16]`）、`const EXTENDED_TIER_FLOOR = 12`、`const LYRIC_LINE_HEIGHT_RATIO = 1.5`
  - `const fitLyricBlock: (lines: readonly LyricBlockLine[], options: FitLyricOptions) => FitLyricResult`
  - Task 6 的 `LyricCard` 用它决定字号与显示行数。

- [ ] **Step 1: 写失败的测试**

Create `tests/share-card-fit-lyric-block.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { EXTENDED_TIER_FLOOR, LYRIC_LINE_HEIGHT_RATIO, LYRIC_TIERS, fitLyricBlock } from '../src/components/ShareCard/fitLyricBlock.ts'

const line = (text: string, extendedLyrics: string[] = []) => ({ text, extendedLyrics })

test('picks the largest tier that fits every line', () => {
  const lines = [line('第一句'), line('第二句')]
  // 两句 × 24 × 1.5 = 72，给 100 应该拿到最大档 24
  assert.deepEqual(fitLyricBlock(lines, { maxHeight: 100 }), {
    fontSize: 24, extendedFontSize: 22, visibleCount: 2, truncated: false,
  })
})

test('steps down one tier at a time before it truncates', () => {
  const lines = Array.from({ length: 6 }, (_, i) => line(`第${i}句`))
  // 6 × 24 × 1.5 = 216 装不进 150；6 × 22 × 1.5 = 198 也装不进；6 × 20 × 1.5 = 180 装不进；
  // 6 × 18 × 1.5 = 162 装不进；6 × 16 × 1.5 = 144 装得进 → 最低档
  assert.equal(fitLyricBlock(lines, { maxHeight: 150 }).fontSize, 16)
  assert.equal(fitLyricBlock(lines, { maxHeight: 150 }).truncated, false)
})

test('truncates at the smallest tier instead of shrinking further', () => {
  const lines = Array.from({ length: 30 }, (_, i) => line(`第${i}句`))
  const r = fitLyricBlock(lines, { maxHeight: 200 })
  assert.equal(r.fontSize, 16)
  assert.equal(r.extendedFontSize, EXTENDED_TIER_FLOOR)
  // 200 / (16 × 1.5) = 8.33 → 只装得下 8 句
  assert.equal(r.visibleCount, 8)
  assert.equal(r.truncated, true)
})

test('keeps the bigger font when both tiers show the same line count', () => {
  // 两句 × 24 档 36 = 72 超了，但 40 高每档都恰好装得下 1 句（16 档 24 ≤ 40 < 48）：
  // 一路算到最低档都是 1 句，改判只在"严格更多"时发生，所以留最大字号
  const r = fitLyricBlock([line('第一句'), line('第二句')], { maxHeight: 40 })
  assert.deepEqual(r, { fontSize: 24, extendedFontSize: 22, visibleCount: 1, truncated: true })
})

test('a body line and its translation are one block that never splits', () => {
  const lines = [line('正文一', ['译文一']), line('正文二', ['译文二'])]
  // 一句 = 正文一行 + 译文一行。40 高时 24 档要 24×1.5 + 22×1.5 = 69，一句都放不下；
  // 降到 16 档要 16×1.5 + 12×1.5 = 42，仍超 40 → 五档全部显示 0 句。
  // 关键判据：绝不"只画正文、把译文切掉"，宁可整块不显示。
  assert.deepEqual(fitLyricBlock(lines, { maxHeight: 40 }), {
    fontSize: 24, extendedFontSize: 22, visibleCount: 0, truncated: true,
  })
  // 45 高时 16 档那一句（42）刚好装得下，但两句（84）超了 → 显示 1 句并截断
  assert.deepEqual(fitLyricBlock(lines, { maxHeight: 45 }), {
    fontSize: 16, extendedFontSize: 12, visibleCount: 1, truncated: true,
  })
})

test('empty selection yields the top tier with nothing shown', () => {
  assert.deepEqual(fitLyricBlock([], { maxHeight: 300 }), {
    fontSize: LYRIC_TIERS[0], extendedFontSize: LYRIC_TIERS[1], visibleCount: 0, truncated: false,
  })
})

test('blank body with only a translation still occupies a row', () => {
  const lines = [line('', ['只有译文']), line('', ['只有译文二'])]
  const r = fitLyricBlock(lines, { maxHeight: 300 })
  // 正文全空 → 24 档下每句只有译文一行 22×1.5=33，两句 66，装得下
  assert.equal(r.visibleCount, 2)
  assert.equal(r.fontSize, 24)
})

test('a single line taller than maxHeight shows nothing rather than overflowing', () => {
  const r = fitLyricBlock([line('很长很长的一句话')], { maxHeight: 10 })
  assert.equal(r.visibleCount, 0)
  assert.equal(r.truncated, true)
  // 五档全显示 0 句 → 平局留大字号，所以是最高档而不是最低档
  assert.equal(r.fontSize, LYRIC_TIERS[0])
})

test('default ratio is 1.5 and is overridable', () => {
  assert.equal(LYRIC_LINE_HEIGHT_RATIO, 1.5)
  const lines = Array.from({ length: 4 }, (_, i) => line(`第${i}句`))
  // 4 × 24 × 1.2 = 115.2 装得进 120，但 4 × 24 × 1.5 = 144 装不进
  assert.equal(fitLyricBlock(lines, { maxHeight: 120, lineHeightRatio: 1.2 }).fontSize, 24)
  // 1.5 档下逐档：24→144 超、22→132 超、20→120 **恰好等于**上限（判据是 >，等于算装得下）
  assert.equal(fitLyricBlock(lines, { maxHeight: 120 }).fontSize, 20)
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/share-card-fit-lyric-block.mts
```

预期：FAIL，`Cannot find module '.../fitLyricBlock.ts'`。

- [ ] **Step 3: 写实现**

Create `src/components/ShareCard/fitLyricBlock.ts`:

```ts
/**
 * 歌词海报的"装得下多少句"判据。本模块必须保持零 import：
 * node --test 直接载它跑单测（规矩同 src/core/lyricCopy.ts）。
 */

export interface LyricBlockLine {
  text: string
  extendedLyrics?: string[] | null
}

export interface FitLyricOptions {
  /** 歌词块可用高度，单位 dp（不是物理像素） */
  maxHeight: number
  tiers?: readonly number[]
  lineHeightRatio?: number
  extendedTierFloor?: number
}

export interface FitLyricResult {
  fontSize: number
  extendedFontSize: number
  /** 能整句显示出来的行数（按"句"计，译文跟着自己的正文行走） */
  visibleCount: number
  truncated: boolean
}

export const LYRIC_TIERS: readonly number[] = [24, 22, 20, 18, 16]
/** 正文已在最低档时译文的下探地板，不再随档位继续往下 */
export const EXTENDED_TIER_FLOOR = 12
export const LYRIC_LINE_HEIGHT_RATIO = 1.5

const rowHeight = (fontSize: number, ratio: number) => fontSize * ratio

/** 一句占多高：正文一行 + 每个非空译文一行；空白行不占高（与 hasLyricText 同一口径） */
const blockHeight = (line: LyricBlockLine, body: number, ext: number, ratio: number) => {
  let height = line.text?.trim() ? rowHeight(body, ratio) : 0
  for (const text of line.extendedLyrics ?? []) {
    if (text?.trim()) height += rowHeight(ext, ratio)
  }
  return height
}

export const fitLyricBlock = (lines: readonly LyricBlockLine[], options: FitLyricOptions): FitLyricResult => {
  const tiers = options.tiers ?? LYRIC_TIERS
  const ratio = options.lineHeightRatio ?? LYRIC_LINE_HEIGHT_RATIO
  const floor = options.extendedTierFloor ?? EXTENDED_TIER_FLOOR
  // 兜底先按最低档摆好，visibleCount 给 -1 是为了让第一档一定"严格更多"从而接管它；
  // 之后同句数的平局就自然留在更大的字号上。tiers 传空数组才会走到这一条（生产传不到）。
  let fallback: FitLyricResult = {
    fontSize: tiers[tiers.length - 1],
    extendedFontSize: floor,
    visibleCount: -1,
    truncated: lines.length > 0,
  }

  for (let i = 0; i < tiers.length; i++) {
    const body = tiers[i]
    const ext = tiers[i + 1] ?? floor
    let height = 0
    let count = 0
    for (const line of lines) {
      const h = blockHeight(line, body, ext, ratio)
      // 整句才收：装不下的那一句连同它的译文一起丢掉（宁可少一句，不切半句）
      if (height + h > options.maxHeight) break
      height += h
      count++
    }
    // 档位越高字越大、装得下的越少，所以第一个"全装得下"的就是答案
    if (count === lines.length) return { fontSize: body, extendedFontSize: ext, visibleCount: count, truncated: false }
    if (count > fallback.visibleCount) {
      fallback = { fontSize: body, extendedFontSize: ext, visibleCount: count, truncated: true }
    }
  }
  return fallback
}
```

`visibleCount: -1` 那颗种子是承重的：改成 `0` 以后，"五档全都显示 0 句"那种情况就不再触发任何一次改判，函数会退回兜底那条**最低**档 —— 平局该留大字号的约定（第 8 条用例）当场反掉。

- [ ] **Step 4: 跑测试确认通过**

```bash
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/share-card-fit-lyric-block.mts
```

预期：9 条全 PASS。

- [ ] **Step 5: 挂进 npm test 清单并过 lint**

Modify `package.json`：`"test"` 脚本**末尾**追加 ` tests/share-card-fit-lyric-block.mts`（当前最后一项是 `tests/download-progress.mts`，用空格分隔跟在它后面）。

```bash
npx eslint src/components/ShareCard/fitLyricBlock.ts tests/share-card-fit-lyric-block.mts
```

预期：0 error。

- [ ] **Step 6: 提交**

```bash
git add src/components/ShareCard/fitLyricBlock.ts tests/share-card-fit-lyric-block.mts package.json
git commit -m "feat(分享图): 歌词块最大高度与截断判据"
```

---

### Task 3: `cardTheme` —— 卡片明暗判据

**Files:**
- Create: `src/components/ShareCard/cardTheme.ts`
- Test: `tests/share-card-theme.mts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `@material/material-color-utilities/hct/hct.js` 的 `Hct`（子路径 import，靠 `dependencies-patch.js` 已放开的 `exports`）
- Produces:
  - `interface CardTheme { cardBackground: string, titleColor: string, subtitleColor: string, lyricColor: string, scrimColor: string }`
  - `const LIGHT_CARD_TONE = 50`、`const LIGHT_CARD_THEME: CardTheme`、`const DARK_CARD_THEME: CardTheme`、`const LYRIC_CARD_THEME: CardTheme`
  - `const isLightCover: (averageArgb: number | null | undefined) => boolean`
  - `const pickMusicCardTheme: (averageArgb: number | null | undefined) => CardTheme`
  - Task 6 的 `ShareCard` 用它挑卡底与字色。

- [ ] **Step 1: 写失败的测试**

Create `tests/share-card-theme.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { DARK_CARD_THEME, LIGHT_CARD_TONE, LIGHT_CARD_THEME, LYRIC_CARD_THEME, isLightCover, pickMusicCardTheme } from '../src/components/ShareCard/cardTheme.ts'

const argb = (r: number, g: number, b: number) => ((255 << 24) | (r << 16) | (g << 8) | b) >>> 0

test('a white cover reads light', () => {
  assert.equal(isLightCover(argb(255, 255, 255)), true)
})

test('a black cover reads dark', () => {
  assert.equal(isLightCover(argb(0, 0, 0)), false)
})

test('tone 50 is the boundary and it is exclusive', () => {
  assert.equal(LIGHT_CARD_TONE, 50)
  // 逐灰阶找翻转点：tone 严格大于 50 才算亮。
  // 注意 HCT 的 tone 就是 CIE L*，不是 sRGB 通道值 —— 实测 L*=50 对应灰阶 119（118 判暗、119 判亮）。
  let lastDark = 0
  let firstLight = 0
  for (let v = 0; v <= 255; v++) {
    if (isLightCover(argb(v, v, v))) { if (!firstLight) firstLight = v } else { lastDark = v }
  }
  assert.equal(lastDark, 118)
  assert.equal(firstLight, 119)
})

test('missing or broken argb falls back to dark', () => {
  assert.equal(isLightCover(null), false)
  assert.equal(isLightCover(undefined), false)
  assert.equal(isLightCover(Number.NaN), false)
  assert.equal(isLightCover('0' as unknown as number), false)
})

test('music card theme follows the cover', () => {
  assert.equal(pickMusicCardTheme(argb(250, 245, 240)), LIGHT_CARD_THEME)
  assert.equal(pickMusicCardTheme(argb(20, 20, 24)), DARK_CARD_THEME)
  assert.equal(pickMusicCardTheme(null), DARK_CARD_THEME)
})

test('lyric card never follows the cover', () => {
  assert.equal(LYRIC_CARD_THEME.cardBackground, 'rgba(28,28,30,0.72)')
})

test('light card is opaque and dark card is translucent', () => {
  assert.equal(LIGHT_CARD_THEME.cardBackground, '#FFFFFF')
  assert.equal(DARK_CARD_THEME.cardBackground, 'rgba(28,28,30,0.72)')
  assert.equal(LIGHT_CARD_THEME.titleColor, '#1C1C1E')
  assert.equal(DARK_CARD_THEME.titleColor, '#FFFFFF')
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/share-card-theme.mts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 写实现**

Create `src/components/ShareCard/cardTheme.ts`:

```ts
import { Hct } from '@material/material-color-utilities/hct/hct.js'

export interface CardTheme {
  cardBackground: string
  titleColor: string
  subtitleColor: string
  lyricColor: string
  scrimColor: string
}

/** tone 严格大于这个值才算亮封面。与 surface.ts 的 `font.tone > 50` 同写法，但输入是封面平均色而不是主题字色 */
export const LIGHT_CARD_TONE = 50

export const LIGHT_CARD_THEME: CardTheme = {
  cardBackground: '#FFFFFF',
  titleColor: '#1C1C1E',
  subtitleColor: '#8E8E93',
  lyricColor: '#1C1C1E',
  scrimColor: 'rgba(0,0,0,0.20)',
}

export const DARK_CARD_THEME: CardTheme = {
  cardBackground: 'rgba(28,28,30,0.72)',
  titleColor: '#FFFFFF',
  subtitleColor: 'rgba(255,255,255,0.72)',
  lyricColor: '#FFFFFF',
  scrimColor: 'rgba(0,0,0,0.20)',
}

/** 歌词卡固定深卡半透明（spec §3），不参与封面自适应 */
export const LYRIC_CARD_THEME: CardTheme = DARK_CARD_THEME

const toneOf = (argb: number) => Hct.fromInt(argb >>> 0).tone

export const isLightCover = (averageArgb: number | null | undefined): boolean => {
  if (typeof averageArgb !== 'number' || !Number.isFinite(averageArgb)) return false
  return toneOf(averageArgb) > LIGHT_CARD_TONE
}

export const pickMusicCardTheme = (averageArgb: number | null | undefined): CardTheme =>
  isLightCover(averageArgb) ? LIGHT_CARD_THEME : DARK_CARD_THEME
```

- [ ] **Step 4: 跑测试确认通过**

```bash
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/share-card-theme.mts
```

预期：7 条全 PASS。若 `Hct.fromInt` 那条灰阶翻转点断言失败，把实测翻转灰阶值报出来再调判据，**不要为了过测试去挪 `LIGHT_CARD_TONE`**（那是 spec 定的值）。

- [ ] **Step 5: 挂进 npm test 清单并过 lint**

Modify `package.json`：`"test"` 末尾追加 ` tests/share-card-theme.mts`。

```bash
npx eslint src/components/ShareCard/cardTheme.ts tests/share-card-theme.mts
```

- [ ] **Step 6: 提交**

```bash
git add src/components/ShareCard/cardTheme.ts tests/share-card-theme.mts package.json
git commit -m "feat(分享图): 卡片明暗判据（跟随封面平均色 tone）"
```

---

### Task 4: monet 出口 `getCoverAverageArgb`

**Files:**
- Modify: `src/utils/monet/coverPalette.ts`（`createCoverPalette` 的返回对象）
- Modify: `src/utils/monet/index.ts`
- Test: `tests/monet-cover-average.mts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `coverPalette` 内部已有的 `fetchOnce`（像素层按 url 的 LRU + 失败保质期）、`measureArgbPixels`
- Produces: `const getCoverAverageArgb: (picUrl: string | null | undefined) => Promise<number | null>`（`@/utils/monet`），返回 `>>> 0` 的无符号 ARGB，失败/无封面给 `null`。Task 6 的 `ShareCard` 喂给 `pickMusicCardTheme`。

- [ ] **Step 1: 写失败的测试**

Create `tests/monet-cover-average.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { createCoverPalette } from '../src/utils/monet/coverPalette.ts'
import type { CoverPixels } from '../src/utils/monet/sourceColor.ts'

// 2×2 全白
const white: CoverPixels = { width: 2, height: 2, pixels: [0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF] }
// 2×2 全黑
const black: CoverPixels = { width: 2, height: 2, pixels: [0xFF000000, 0xFF000000, 0xFF000000, 0xFF000000] }

const build = (pixels: CoverPixels | null, calls: string[]) => createCoverPalette(
  async(url: string) => { calls.push(url); return pixels },
  async() => null,
)

test('returns the average argb of the cover', async() => {
  const calls: string[] = []
  const palette = build(white, calls)
  const avg = await palette.getCoverAverageArgb('http://x/a.jpg')
  assert.equal(calls.length, 1)
  assert.equal(avg, 0xFFFFFFFF)
  assert.equal(avg! >>> 24, 255)
})

test('shares one native fetch with the surface branch', async() => {
  const calls: string[] = []
  const palette = build(white, calls)
  await palette.getCoverSurface('http://x/b.jpg', 'rgb(255, 255, 255)', 'monet')
  await palette.getCoverAverageArgb('http://x/b.jpg')
  assert.equal(calls.length, 1, '像素层缓存要能被两个出口共用，否则同一张封面下载两遍')
})

test('the average branch does not need the font colour', async() => {
  const calls: string[] = []
  const palette = build(black, calls)
  const avg = await palette.getCoverAverageArgb('http://x/c.jpg')
  assert.equal(avg, 0xFF000000)
  assert.equal(calls.length, 1)
})

test('null url and null pixels both resolve to null', async() => {
  const calls: string[] = []
  const palette = build(null, calls)
  assert.equal(await palette.getCoverAverageArgb(null), null)
  assert.equal(await palette.getCoverAverageArgb(undefined), null)
  assert.equal(calls.length, 0, '空 url 不该问原生')
  assert.equal(await palette.getCoverAverageArgb('http://x/d.jpg'), null)
})

test('fully transparent cover resolves to null, not NaN', async() => {
  const transparent: CoverPixels = { width: 2, height: 2, pixels: [0, 0, 0, 0] }
  const palette = build(transparent, [])
  assert.equal(await palette.getCoverAverageArgb('http://x/e.png'), null)
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-cover-average.mts
```

预期：FAIL，`palette.getCoverAverageArgb is not a function`。

- [ ] **Step 3: 加实现**

Modify `src/utils/monet/coverPalette.ts`，在返回对象的 `getCoverTexture` 之后、`clearCache` 之前插入：

```ts
    // 分享卡的明暗判定只看"这张封面整体偏亮还是偏暗"，所以只要平均色，不跑官方量化那 123ms。
    // 复用像素层的 fetchOnce：同一张封面在播放页已经暖过，海报页不该再问一次原生。
    getCoverAverageArgb: async(picUrl: string | null | undefined): Promise<number | null> => {
      if (!picUrl) return null
      const pixels = await fetchOnce(picUrl)
      if (pixels == null) return null
      return measureArgbPixels(pixels)?.average ?? null
    },
```

- [ ] **Step 4: 跑测试确认通过**

```bash
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-cover-average.mts
```

预期：5 条全 PASS。

- [ ] **Step 5: 加 index 出口**

Modify `src/utils/monet/index.ts`，在 `getCoverTexture` 导出之后加：

```ts
// 包一层箭头的原因同上面两条导出（@typescript-eslint/unbound-method）
export const getCoverAverageArgb = async(picUrl: string | null | undefined) =>
  palette.getCoverAverageArgb(picUrl)
```

- [ ] **Step 6: 过闸门**

```bash
npx tsc --noEmit
npx eslint src/utils/monet/coverPalette.ts src/utils/monet/index.ts tests/monet-cover-average.mts
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/monet-cover-palette.mts
```

预期：tsc 报错数不变；eslint 0 error；既有的 `monet-cover-palette` 仍全绿（这条改动只加了一个返回字段，不该动到旧行为）。

- [ ] **Step 7: 挂进 npm test 清单并提交**

Modify `package.json`：`"test"` 末尾追加 ` tests/monet-cover-average.mts`。

```bash
git add src/utils/monet/coverPalette.ts src/utils/monet/index.ts tests/monet-cover-average.mts package.json
git commit -m "feat(monet): 加 getCoverAverageArgb 出口，与配色层共用像素缓存"
```

---

### Task 5: `CoverImage` —— 私有封面组件（onLoad 门控）

**Files:**
- Create: `src/components/ShareCard/CoverImage.tsx`

**Interfaces:**
- Consumes: `defaultHeaders`（`@/components/common/Image` 已导出）
- Produces:
  - `interface CoverImageProps { url: string | null | undefined, style: StyleProp<ImageStyle>, resizeMode?: 'cover' | 'contain' | 'stretch', onReady?: (ready: boolean) => void }`
  - `default CoverImage`
  - `const normalizeCoverUri: (url: string | null | undefined) => string | null`（`'/'` 开头的本地路径补成 `file://`）—— Task 6 的铺底层与 `MusicCard` 都 import 它，必须导出。
  - Task 6 用 `onReady(true)` 才放行拍摄；无封面 / 加载失败也算 ready（否则导出永远卡住）。

- [ ] **Step 1: 写实现**

Create `src/components/ShareCard/CoverImage.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { Image, type ImageStyle, type StyleProp, View } from 'react-native'

import { defaultHeaders } from '@/components/common/Image'

export interface CoverImageProps {
  url: string | null | undefined
  style: StyleProp<ImageStyle>
  resizeMode?: 'cover' | 'contain' | 'stretch'
  /** 就绪 = 图已解出来 / 根本没有图 / 图坏了。后两种也算就绪，否则导出会永远卡在"正在准备"。 */
  onReady?: (ready: boolean) => void
}

export const normalizeCoverUri = (url: string | null | undefined): string | null => {
  if (!url) return null
  return url.startsWith('/') ? 'file://' + url : url
}

/**
 * 分享卡专用的封面。故意不复用 src/components/common/Image：那层没有 onLoad，
 * 而拍摄前必须真的等到图解出来（spec §8 探针 2）。共享组件一行都不改，横屏零风险。
 * 不收 ref —— 被拍的是 ShareCard 最外那一层，这一层只是"报就绪"。
 */
const CoverImage = ({ url, style, resizeMode = 'cover', onReady }: CoverImageProps) => {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const uri = useMemo(() => normalizeCoverUri(url), [url])

  // 换封面（换歌）必须重新等一次 onLoad，否则会把上一首的图解当成已就绪
  useEffect(() => {
    setLoaded(false)
    setFailed(false)
  }, [uri])

  const ready = !uri || failed || loaded
  // 同一个 (uri, ready) 只报一次：onReady 的函数身份每次渲染都在变，不锁这个会循环上报
  const reported = useRef<string | null>(null)
  useEffect(() => {
    const token = `${uri}|${ready}`
    if (reported.current === token) return
    reported.current = token
    onReady?.(ready)
  }, [ready, uri, onReady])

  // 卸载时回到未就绪：预览页关掉再为另一首歌打开时，是另一个实例、另一个 true/false 周期，
  // 但 ready 态留在父组件里 —— 这里补一次 false，父组件不会拿着上一首的 true 直接放行拍摄。
  useEffect(() => () => onReady?.(false), [onReady])

  if (!uri) return <View style={style} collapsable={false} />
  return (
    <Image
      style={style}
      source={{ uri, headers: defaultHeaders }}
      resizeMode={resizeMode}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />
  )
}

export default CoverImage
```

卸载回调里那次 `onReady?.(false)` 在父组件已经自己 unmount 时也会跑到（`handleReady` 是 `useCallback` 稳定的），多设一次 `false` 不会渲染到已经不存在的树上，RN 那边 setState 到已卸载组件是静默的 —— 这条链的代价是"重开预览要重等一次封面"，正是想要的。

- [ ] **Step 2: 过闸门**

```bash
npx tsc --noEmit
npx eslint src/components/ShareCard/CoverImage.tsx
```

预期：tsc 报错数不变；eslint 0 error。这个组件的行为靠 Task 1 已验过的拍摄链路 + Task 6 的真机清单判，不写 JS 单测（要 mock RN 渲染，成本高于收益）。

- [ ] **Step 3: 提交**

```bash
git add src/components/ShareCard/CoverImage.tsx
git commit -m "feat(分享图): 私有封面组件，拍摄前真等 onLoad"
```

---

### Task 6: `ShareCard` 视觉层（两层结构 + 两种内容）

**Files:**
- Create: `src/components/ShareCard/MusicCard.tsx`
- Create: `src/components/ShareCard/LyricCard.tsx`
- Create: `src/components/ShareCard/index.tsx`
- Delete: `src/components/ShareCard/probe/BlurProbeCard.tsx`（连同 `probe/` 目录）

**Interfaces:**
- Consumes: `fitLyricBlock`（Task 2）、`pickMusicCardTheme` / `LYRIC_CARD_THEME` / `CardTheme`（Task 3）、`getCoverAverageArgb`（Task 4）、`CoverImage` / `normalizeCoverUri`（Task 5）、`defaultHeaders`（`@/components/common/Image` 已导出）、`LyricCopyLine`（`@/core/lyricCopy`）
- `LyricCopyLine` 与 Task 2 的 `LyricBlockLine` 结构同形（都是 `{ text, extendedLyrics? }`），TS 结构化类型直接互通 —— **不要写转换函数**，Task 10 把 `pickLyricLinesForCopy(...)` 的返回值原样传给 `lyricLines` 就行。
- Produces:
  - `interface ShareCardData { name: string, singer: string, pic: string | null | undefined }`
  - `interface ShareCardProps { mode: 'music' | 'lyric', musicInfo: ShareCardData, lyricLines?: readonly LyricBlockLine[], width: number, height: number, onReadyChange?: (ready: boolean) => void }`
  - `default ShareCard`（`forwardRef<View>`，ref 指向**被拍的那一层**）
  - `MusicCard` / `LyricCard` 各接一个可选 `onCoverReady?: (ready: boolean) => void`，由 ShareCard 把 `onReadyChange` 原样透下去（就绪链只有这一条，别在中间层再存一份 state）
  - `const CARD_WIDTH_RATIO = 0.78`、`const CARD_MAX_HEIGHT_RATIO = 0.62`、`const CARD_PADDING = 20`、`const BLUR_RADIUS = 90`

- [ ] **Step 1: 音乐卡内容**

Create `src/components/ShareCard/MusicCard.tsx`:

```tsx
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { BrandLine } from './BrandLine'
import CoverImage from './CoverImage'
import { type CardTheme } from './cardTheme'

interface Props {
  name: string
  singer: string
  pic: string | null | undefined
  coverSize: number
  theme: CardTheme
  /** 原样透传给 CoverImage：图没解出来时预览页那两枚按钮该禁用（spec §8 探针 2） */
  onCoverReady?: (ready: boolean) => void
}

export default ({ name, singer, pic, coverSize, theme, onCoverReady }: Props) => {
  return (
    <>
      <CoverImage url={pic} onReady={onCoverReady} style={{ ...styles.cover, width: coverSize, height: coverSize }} />
      <Text numberOfLines={3} style={{ ...styles.title, color: theme.titleColor }}>{name}</Text>
      <Text numberOfLines={2} style={{ ...styles.singer, color: theme.subtitleColor }}>{singer}</Text>
      <BrandLine color={theme.subtitleColor} />
    </>
  )
}

const styles = createStyle({
  cover: { borderRadius: 18 },
  title: { marginTop: 18, fontSize: 24, lineHeight: 30 },
  singer: { marginTop: 6, fontSize: 18 },
})
```

- [ ] **Step 2: 落款（两种卡共用）**

Create `src/components/ShareCard/BrandLine.tsx`:

```tsx
import { Image, View } from 'react-native'

import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'

// 与 src/components/common/LocateButton.tsx:7 同一写法：require + @/resources 别名，Metro 认。
// 不加 tintColor —— 这个字形自带青色，染色就不是 App 图标了。
const glyph = require('@/resources/images/app-icon-glyph.png')

export const BrandLine = ({ color }: { color: string }) => {
  return (
    <View style={styles.row}>
      {/* 透明底的青色字形（spec §1 实测四角 alpha=0），深卡亮卡共用同一张图 */}
      <Image source={glyph} style={styles.glyph} resizeMode="contain" />
      <Text style={[styles.word, { color }]}>Music</Text>
    </View>
  )
}

const styles = createStyle({
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  glyph: { width: 20, height: 20, marginRight: 4 },
  word: { fontSize: 17, letterSpacing: 0.2 },
})
```

- [ ] **Step 3: 把字形资源放进 JS 资源目录**

```bash
cp android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png src/resources/images/app-icon-glyph.png
```

预期：`src/resources/images/app-icon-glyph.png` 存在，约 71 KB（`src/resources/images/` 目录已有，只需加这一个文件）。这个文件是 `ic_launcher_foreground.png` 的副本（同一份青色字形，透明底），**不要求同步进 mipmap**：launcher 资源仍由 `doc/images/icon.png` 那条链生成。

- [ ] **Step 4: 歌词卡内容**

Create `src/components/ShareCard/LyricCard.tsx`:

```tsx
import { StyleSheet, View } from 'react-native'

import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { BrandLine } from './BrandLine'
import CoverImage from './CoverImage'
import { type CardTheme } from './cardTheme'
import { type LyricBlockLine, fitLyricBlock } from './fitLyricBlock'

interface Props {
  lines: readonly LyricBlockLine[]
  name: string
  singer: string
  pic: string | null | undefined
  lyricMaxHeight: number
  theme: CardTheme
  onCoverReady?: (ready: boolean) => void
}

export default ({ lines, name, singer, pic, lyricMaxHeight, theme, onCoverReady }: Props) => {
  const fit = fitLyricBlock(lines, { maxHeight: lyricMaxHeight })
  const shown = lines.slice(0, fit.visibleCount)
  return (
    <>
      <View>
        {
          shown.map((line, index) => (
            <View key={`${index}-${line.text}`}>
              { line.text?.trim() ? <Text style={{ fontSize: fit.fontSize, lineHeight: fit.fontSize * 1.5, color: theme.lyricColor }}>{line.text}</Text> : null }
              {
                (line.extendedLyrics ?? []).map((text, i) => text?.trim()
                  ? <Text key={i} style={{ fontSize: fit.extendedFontSize, lineHeight: fit.extendedFontSize * 1.5, color: theme.subtitleColor }}>{text}</Text>
                  : null)
              }
            </View>
          ))
        }
        { fit.truncated ? <Text style={{ fontSize: fit.extendedFontSize, color: theme.subtitleColor }}>…</Text> : null }
      </View>
      <View style={[styles.separator, { backgroundColor: theme.subtitleColor }]} />
      <View style={styles.footer}>
        <CoverImage url={pic} onReady={onCoverReady} style={styles.miniCover} />
        <View style={styles.footerText}>
          <Text numberOfLines={2} style={{ fontSize: 16, color: theme.titleColor }}>{name}</Text>
          <Text numberOfLines={1} style={{ fontSize: 14, color: theme.subtitleColor, marginTop: 2 }}>{singer}</Text>
          <BrandLine color={theme.subtitleColor} />
        </View>
      </View>
    </>
  )
}

const styles = createStyle({
  separator: { height: StyleSheet.hairlineWidth, opacity: 0.35, marginVertical: 14 },
  footer: { flexDirection: 'row', alignItems: 'center' },
  miniCover: { width: 56, height: 56, borderRadius: 8, marginRight: 12 },
  footerText: { flex: 1 },
})
```

歌词块本身不写高度：整块能多高由 `fitLyricBlock` 保证，卡自己再受 `maxHeight: cardMaxHeight` 约束，两处不要都设死。

- [ ] **Step 5: 组装两层**

Create `src/components/ShareCard/index.tsx`:

```tsx
import { forwardRef, useEffect, useState } from 'react'
import { ImageBackground, StyleSheet, View } from 'react-native'

import { defaultHeaders } from '@/components/common/Image'
import { getCoverAverageArgb } from '@/utils/monet'
import { createStyle } from '@/utils/tools'
import LyricCard from './LyricCard'
import MusicCard from './MusicCard'
import { normalizeCoverUri } from './CoverImage'
import { LYRIC_CARD_THEME, pickMusicCardTheme, type CardTheme } from './cardTheme'
import { type LyricBlockLine } from './fitLyricBlock'

export const CARD_WIDTH_RATIO = 0.78
export const CARD_MAX_HEIGHT_RATIO = 0.62
export const CARD_PADDING = 20
// 与 CoverBackdrop 同一个值（spec §1）：分享卡的底就是播放页那张模糊底的静态版
export const BLUR_RADIUS = 90

// 歌词卡底部那一坨：分隔线 + 小封面行（含落款）+ 上下卡内边距
const LYRIC_FOOTER_RESERVE = 140

export interface ShareCardData {
  name: string
  singer: string
  pic: string | null | undefined
}

interface Props {
  mode: 'music' | 'lyric'
  musicInfo: ShareCardData
  lyricLines?: readonly LyricBlockLine[]
  width: number
  height: number
  /** false = 封面还没解出来，拍摄按钮该禁用（Task 1 探针 2 的结论落在这里）。
   *  不在这层存 state：就绪与否只有卡里那个 CoverImage 知道，直接把它透下去。
   *  没有封面（本地歌）时 CoverImage 也会报 true，导出不会永远卡住。 */
  onReadyChange?: (ready: boolean) => void
}

const ShareCard = forwardRef<View, Props>(({ mode, musicInfo, lyricLines, width, height, onReadyChange }, ref) => {
  const [averageArgb, setAverageArgb] = useState<number | null>(null)
  const uri = normalizeCoverUri(musicInfo.pic)

  useEffect(() => {
    let cancelled = false
    setAverageArgb(null)
    if (!musicInfo.pic) return
    void getCoverAverageArgb(musicInfo.pic).then(value => {
      if (!cancelled) setAverageArgb(value)
    })
    return () => { cancelled = true }
  }, [musicInfo.pic])

  const theme: CardTheme = mode === 'lyric' ? LYRIC_CARD_THEME : pickMusicCardTheme(averageArgb)
  const cardWidth = width * CARD_WIDTH_RATIO
  const coverSize = cardWidth - CARD_PADDING * 2
  const cardMaxHeight = height * CARD_MAX_HEIGHT_RATIO
  const lyricMaxHeight = Math.max(0, cardMaxHeight - CARD_PADDING * 2 - LYRIC_FOOTER_RESERVE)

  return (
    <View ref={ref} collapsable={false} style={{ width, height }}>
      <ImageBackground
        blurRadius={BLUR_RADIUS}
        source={uri ? { uri, headers: defaultHeaders } : undefined}
        style={[styles.fill, { backgroundColor: '#111114' }]}
      >
        <View style={[styles.fill, { backgroundColor: theme.scrimColor }]} />
      </ImageBackground>
      <View style={styles.center}>
        <View style={{ width: cardWidth, maxHeight: cardMaxHeight, backgroundColor: theme.cardBackground, borderRadius: 28, padding: CARD_PADDING }}>
          {
            mode === 'music'
              ? <MusicCard {...musicInfo} coverSize={coverSize} theme={theme} onCoverReady={onReadyChange} />
              : <LyricCard lines={lyricLines ?? []} {...musicInfo} lyricMaxHeight={lyricMaxHeight} theme={theme} onCoverReady={onReadyChange} />
          }
        </View>
      </View>
    </View>
  )
})

const styles = createStyle({
  fill: StyleSheet.absoluteFillObject,
  center: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
})

export default ShareCard
```

`averageArgb` 初值是 `null` → 取色还没回来（或失败）时 `pickMusicCardTheme(null)` 给深卡，这与 spec §3「取不到色就不赌」一致；色回来后组件重渲染，卡从深翻成亮，预览页里看得见这一次翻转，不用额外提示。

- [ ] **Step 6: 过闸门**

```bash
npx tsc --noEmit
npx eslint src/components/ShareCard
```

预期：tsc 报错数不变；eslint 0 error。

- [ ] **Step 7: 删掉探针**

```bash
git rm -r src/components/ShareCard/probe
```

同时把 `Lyric.tsx` 里 Task 1 临时加的 `import BlurProbeCard` / `probeOpen` state / 那行 `{probeOpen ? <BlurProbeCard /> : null}` 撤掉（按钮先留 disabled，Task 10 再接）。

- [ ] **Step 8: 提交**

```bash
git add src/components/ShareCard src/resources/images/app-icon-glyph.png src/screens/PlayDetail/Vertical/Lyric.tsx
git commit -m "feat(分享图): ShareCard 两层结构与两种内容"
```

---

### Task 7: 导出与系统分享（`captureShareCard` + `UtilsModule.shareImage`）

**Files:**
- Create: `src/utils/shareCard/exportCard.ts`
- Modify: `android/app/src/main/java/cn/toside/music/mobile/utils/UtilsModule.java`（在 `shareText` 之后插入）
- Modify: `src/utils/nativeModules/utils.ts`

**Interfaces:**
- Consumes: `react-native-view-shot` 的 `captureRef`；`APP_PROVIDER_NAME`（`@/config/constant`，值 `'cn.toside.music.mobile.provider'`，与 manifest 的 `${applicationId}.provider` 对得上，`applicationId` 无 suffix）
- Produces:
  - `interface CapturedCard { uri: string, path: string }`
  - `const captureShareCard: (ref: RefObject<View | null>, fileName: string) => Promise<CapturedCard>`
  - `const shareCapturedCard: (path: string, shareTitle: string, title: string, text: string) => Promise<void>`

- [ ] **Step 1: Java 侧加 `shareImage`**

Modify `android/app/src/main/java/cn/toside/music/mobile/utils/UtilsModule.java`，紧跟现有 `shareText` 方法之后插入：

```java
  // 分享一张导出的图。故意不复用 shareText 的 Uri.fromFile 写法：
  // 那条在 API 24+ 会让收端抛 FileUriExposedException，而 view-shot 的临时文件在
  // getCacheDir() 里，manifest 的 <cache-path name="cache" path="/" /> 已经覆盖得到。
  @ReactMethod
  public void shareImage(String filePath, String authority, String shareTitle, String title, String text, Promise promise) {
    File file = new File(filePath);
    if (!file.exists()) {
      promise.reject("SHARE_IMAGE_FAILED", "file not found: " + filePath);
      return;
    }
    Uri contentUri;
    try {
      contentUri = FileProvider.getUriForFile(getReactApplicationContext(), authority, file);
    } catch (Exception e) {
      promise.reject("SHARE_IMAGE_FAILED", "FileProvider rejected " + filePath + ": " + e.getMessage());
      return;
    }
    Intent shareIntent = new Intent(Intent.ACTION_SEND);
    shareIntent.setType("image/png");
    shareIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
    shareIntent.putExtra(Intent.EXTRA_SUBJECT, title);
    shareIntent.putExtra(Intent.EXTRA_TEXT, text);
    shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
    try {
      Objects.requireNonNull(reactContext.getCurrentActivity())
        .startActivity(Intent.createChooser(shareIntent, shareTitle));
      promise.resolve(null);
    } catch (Exception e) {
      promise.reject("SHARE_IMAGE_FAILED", e.getMessage());
    }
  }
```

`File`、`Uri`、`FileProvider`、`Intent`、`Objects`、`Promise`、`ReactMethod` 该文件顶部都已 import，不用加。

- [ ] **Step 2: 验 Java 编译**

```bash
cd android && ./gradlew :app:compileDebugJavaWithJavac
```

预期：BUILD SUCCESSFUL。

- [ ] **Step 3: JS 桥**

Modify `src/utils/nativeModules/utils.ts`，在 `shareText` 之后加：

**不要加 `Platform.OS` 判断。** 该文件 `:3` 就是 `const { UtilsModule } = NativeModules`，`:5` 立刻解引用 `UtilsModule.exitApp`——整个文件本来就只在安卓上跑得起来（`ios/` 下没有任何 `UtilsModule` 实现，grep 过），单独给 `shareImage` 包一层平台判断既救不了 iOS，又和同文件另外 14 个导出的写法不一致。iOS 在 spec §10 里就是范围外。

```ts
export const shareImage = async(filePath: string, authority: string, shareTitle: string, title: string, text: string): Promise<void> => {
  UtilsModule.shareImage(filePath, authority, shareTitle, title, text)
}
```

- [ ] **Step 4: 导出层**

Create `src/utils/shareCard/exportCard.ts`:

```ts
import type { RefObject } from 'react'
import type { View } from 'react-native'
import { captureRef } from 'react-native-view-shot'

import { APP_PROVIDER_NAME } from '@/config/constant'
import { shareImage } from '@/utils/nativeModules/utils'

export interface CapturedCard {
  /** Android 侧是 `file:///...`；剥掉前缀才是 shareImage 要的绝对路径 */
  uri: string
  path: string
}

/** view-shot 的 fileName 在安卓上要求至少 3 个字符 */
const safeFileName = (name: string) => {
  const cleaned = name.replace(/[^A-Za-z0-9_.-]/g, '_')
  return cleaned.length >= 3 ? cleaned : `lx_${cleaned}`
}

export const captureShareCard = async(ref: RefObject<View | null>, fileName: string): Promise<CapturedCard> => {
  const uri = await captureRef(ref, {
    format: 'png',
    quality: 1,
    result: 'tmpfile',
    fileName: safeFileName(fileName),
    // 不传 width/height：view-shot 是"按视图尺寸画 → createScaledBitmap"，
    // 传尺寸只会拿到放大后的糊图（spec §5）
  })
  return { uri, path: uri.replace(/^file:\/\//, '') }
}

export const shareCapturedCard = async(path: string, shareTitle: string, title: string, text: string) => {
  await shareImage(path, APP_PROVIDER_NAME, shareTitle, title, text)
}
```

- [ ] **Step 5: 过闸门**

```bash
npx tsc --noEmit
npx eslint src/utils/shareCard/exportCard.ts src/utils/nativeModules/utils.ts
```

- [ ] **Step 6: 提交**

```bash
git add android/app/src/main/java/cn/toside/music/mobile/utils/UtilsModule.java src/utils/nativeModules/utils.ts src/utils/shareCard/exportCard.ts
git commit -m "feat(分享图): captureRef 导出与 FileProvider 图片分享"
```

---

### Task 8: 保存到相册（SAF + 独立设置键）

**Files:**
- Create: `src/utils/shareCard/cardFileName.ts`（零 import 的纯判据）
- Create: `src/utils/shareCard/saveCard.ts`
- Modify: `src/types/app_setting.d.ts`（在 `download.savePathName` 之后）
- Modify: `src/config/defaultSetting.ts`（在 `:74` 之后）
- Test: `tests/share-card-file-name.mts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `@/utils/fs` 的 `copyFile` / `existsFile` / `selectManagedFolder` / `getPersistedUriList`；`@/core/download/safPath` 的 `isDirGranted` / `childWritePath` / `childRealPath`；`@/core/download/target` 的 `uniqueChildName`；`@/core/common` 的 `updateSetting`；`settingState`
- Produces:
  - `const cardFileName: (name: string, singer: string) => string`（纯函数，去非法字符；住在 `cardFileName.ts`）
  - `const saveShareCard: (tempPath: string, baseName: string) => Promise<string | null>`（返回落地的文件名，用户取消选择器返回 `null`）
  - 新设置键 `shareCard.savePath` / `shareCard.savePathName`

- [ ] **Step 1: 写失败的测试**

Create `tests/share-card-file-name.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { cardFileName } from '../src/utils/shareCard/cardFileName.ts'

test('joins name and singer with a separator', () => {
  assert.equal(cardFileName('平凡之路', '朴树'), '平凡之路 - 朴树')
})

test('drops characters the filesystem refuses', () => {
  // 非法字符直接去掉（不是替换成下划线），剩下的字不动
  assert.equal(cardFileName('A/B:C*D?E"F<G>H|I', '朴树'), 'ABCDEFGHI - 朴树')
})

test('falls back to the title alone when the singer is empty', () => {
  assert.equal(cardFileName('平凡之路', ''), '平凡之路')
  assert.equal(cardFileName('平凡之路', '   '), '平凡之路')
})

test('truncates very long titles so the path stays writable', () => {
  const long = '字'.repeat(400)
  assert.ok(cardFileName(long, '歌手').length <= 80)
})

test('collapses the whitespace left behind by stripped characters', () => {
  assert.equal(cardFileName('歌 名', 'A  B'), '歌 名 - A B')
})
```

期望值是按 Step 3 那张非法字符表逐字符算出来的，改表就要同时改这几条断言。

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/share-card-file-name.mts
```

预期：FAIL，`Cannot find module '.../cardFileName.ts'`。

- [ ] **Step 3: 写实现（两个文件，判据单独一层）**

Create `src/utils/shareCard/cardFileName.ts`:

```ts
/**
 * 分享图文件名的判据。本模块必须保持零 import（规矩同 src/core/lyricCopy.ts）：
 * node --test 不解析 tsconfig 里的 @/ 别名，而 saveCard.ts 顶层有 react-native-fs 与 store，
 * 从那里 import 会直接载不动。
 */
const MAX_BASE_NAME = 72

/** 文件名里的非法字符一律去掉：SAF 那边不会替你报错，只会写不出或者写歪。 */
export const cardFileName = (name: string, singer: string) => {
  const clean = (value: string) => value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim()
  const title = clean(name)
  const artist = clean(singer)
  const joined = artist ? `${title} - ${artist}` : title
  return (joined || 'lyric-poster').slice(0, MAX_BASE_NAME)
}
```

Create `src/utils/shareCard/saveCard.ts`:

```ts
import RNFS from 'react-native-fs'

import { updateSetting } from '@/core/common'
import { childRealPath, childWritePath, isDirGranted } from '@/core/download/safPath'
import { uniqueChildName } from '@/core/download/target'
import settingState from '@/store/setting/state'
import { existsFile, getPersistedUriList, copyFile, selectManagedFolder } from '@/utils/fs'
import { cardFileName } from './cardFileName'

const getDir = () => settingState.setting['shareCard.savePath']

const isUsableDir = async(dir: string) => {
  const persisted = await getPersistedUriList().catch(() => [])
  if (!isDirGranted(persisted, dir)) return false
  return existsFile(dir).catch(() => false)
}

/** 弹系统文件夹选择器并持久授权；用户取消返回 null */
const pickDir = async() => {
  const dir = await selectManagedFolder(true).catch(() => null)
  if (!dir?.path || !dir.isDirectory) return null
  updateSetting({
    'shareCard.savePath': dir.path,
    'shareCard.savePathName': dir.name || dir.path,
  })
  return dir.path
}

/**
 * 把导出的临时 PNG 落到用户选的目录。与下载共用 SAF 那三件套（安卓 16 真机已验通），
 * 但用独立的 shareCard.savePath —— 海报不该混进下载的音乐文件里（spec §5）。
 * 返回落地的文件名；用户没选位置就返回 null。
 */
export const saveShareCard = async(tempPath: string, baseName: string): Promise<string | null> => {
  let dir = getDir()
  if (!dir || !await isUsableDir(dir)) dir = (await pickDir()) ?? ''
  if (!dir) return null
  const name = await uniqueChildName(dir, baseName, 'png')
  await copyFile(tempPath, childWritePath(dir, name))
  const realPath = childRealPath(dir, name)
  if (realPath) void RNFS.scanFile(realPath).catch(() => {})
  return name
}
```

`cardFileName` 导在 `saveCard.ts` 里再转一次是多余的，Task 9/10 一律从 `@/utils/shareCard/cardFileName` 取。

- [ ] **Step 4: 跑测试确认通过**

```bash
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/share-card-file-name.mts
```

预期：5 条全 PASS（或按 Step 3 末尾说的拆完再全 PASS）。

- [ ] **Step 5: 加设置键**

Modify `src/types/app_setting.d.ts`，在 `'download.savePathName'` 那段之后加：

```ts
    /**
     * 分享图/歌词海报的保存位置（系统文件夹选择器返回的位置）
     */
    'shareCard.savePath': string

    /**
     * 分享图保存位置的展示名称
     */
    'shareCard.savePathName': string
```

Modify `src/config/defaultSetting.ts`，在 `'download.savePathName': '',` 之后加：

```ts
  'shareCard.savePath': '',
  'shareCard.savePathName': '',
```

- [ ] **Step 6: 过闸门**

```bash
npx tsc --noEmit
npx eslint src/utils/shareCard src/types/app_setting.d.ts src/config/defaultSetting.ts tests/share-card-file-name.mts
```

- [ ] **Step 7: 挂进 npm test 清单并提交**

Modify `package.json`：`"test"` 末尾追加 ` tests/share-card-file-name.mts`。

```bash
git add src/utils/shareCard src/types/app_setting.d.ts src/config/defaultSetting.ts tests/share-card-file-name.mts package.json
git commit -m "feat(分享图): SAF 保存到相册，独立 shareCard.savePath 设置键"
```

---

### Task 9: `ShareCardModal`（全屏预览 + 右上角两枚按钮）

**Files:**
- Create: `src/components/ShareCard/ShareCardModal.tsx`

**Interfaces:**
- Consumes: `ShareCard`（Task 6）、`captureShareCard` / `shareCapturedCard`（Task 7）、`saveShareCard`（Task 8）、`cardFileName`（Task 8 的纯模块）、`useWindowSize`、`useStatusbarHeight`（`@/store/common/hook`）、`toast`、`useI18n`、`Icon`（`download-2` / `share` 两枚字形已在用）
- Produces:
  - `interface ShareCardModalProps { visible: boolean, mode: 'music' | 'lyric', musicInfo: ShareCardData, lyricLines?: readonly LyricBlockLine[], onClose: () => void }`
  - `default ShareCardModal`

- [ ] **Step 1: 写实现**

Create `src/components/ShareCard/ShareCardModal.tsx`:

```tsx
import { useCallback, useRef, useState } from 'react'
import { Modal, TouchableOpacity, View } from 'react-native'

import { Icon } from '@/components/common/Icon'
import ShareCard, { type ShareCardData } from '@/components/ShareCard'
import { useI18n } from '@/lang'
import { useStatusbarHeight } from '@/store/common/hook'
import { useWindowSize } from '@/utils/hooks'
import { cardFileName } from '@/utils/shareCard/cardFileName'
import { type LyricBlockLine } from './fitLyricBlock'
import { captureShareCard, shareCapturedCard } from '@/utils/shareCard/exportCard'
import { saveShareCard } from '@/utils/shareCard/saveCard'
import { createStyle, toast } from '@/utils/tools'

interface Props {
  visible: boolean
  mode: 'music' | 'lyric'
  musicInfo: ShareCardData
  lyricLines?: readonly LyricBlockLine[]
  onClose: () => void
}

export default ({ visible, mode, musicInfo, lyricLines, onClose }: Props) => {
  const t = useI18n()
  const { width, height } = useWindowSize()
  const statusBarHeight = useStatusbarHeight()
  const shotRef = useRef<View>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleReady = useCallback((value: boolean) => setReady(value), [])

  const shoot = () => captureShareCard(shotRef, cardFileName(musicInfo.name, musicInfo.singer))

  const handleShare = async() => {
    setBusy(true)
    try {
      const { path } = await shoot()
      // 三个入参与 shareMusic（src/utils/tools.ts:349）逐位对齐：chooser 标题、EXTRA_SUBJECT、EXTRA_TEXT。
      // share_card_title_music 与 share_title_music 都是已有键，图片这条路不该另起一句文案。
      await shareCapturedCard(path,
        t('share_card_title_music', { name: musicInfo.name }),
        t('share_title_music'),
        `${musicInfo.name} - ${musicInfo.singer}`)
    } catch {
      toast(t('share_card_capture_failed'))
    } finally {
      setBusy(false)
    }
  }

  const handleSave = async() => {
    setBusy(true)
    try {
      const { path } = await shoot()
      const name = await saveShareCard(path, cardFileName(musicInfo.name, musicInfo.singer))
      // null = 用户在文件夹选择器里取消了，那不叫失败，也不该说"已保存"
      if (name) toast(t('share_card_saved', { name }))
      else toast(t('share_card_save_canceled'))
    } catch {
      toast(t('share_card_save_failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible={visible} onRequestClose={onClose} statusBarTranslucent animationType="fade">
      <View style={styles.root}>
        {/* 被拍的只有这一层：两枚按钮挂在它外面，所以不会进图（spec §5） */}
        <ShareCard
          ref={shotRef}
          mode={mode}
          musicInfo={musicInfo}
          lyricLines={lyricLines}
          width={width}
          height={height}
          onReadyChange={handleReady}
        />
        <View style={[styles.actions, { paddingTop: statusBarHeight + 6 }]}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleSave} disabled={busy || !ready} accessibilityRole="button" accessibilityLabel={t('share_card_save')}>
            <Icon name="download-2" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={handleShare} disabled={busy || !ready} accessibilityRole="button" accessibilityLabel={t('share_title_music')}>
            <Icon name="share" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const styles = createStyle({
  root: { flex: 1, backgroundColor: '#000' },
  actions: { position: 'absolute', top: 0, right: 0, flexDirection: 'row', paddingRight: 12 },
  actionBtn: {
    width: 44,
    height: 44,
    margin: 4,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
})
```

`statusBarTranslucent` + 按钮层 `paddingTop: statusBarHeight` 是探针 3 的处置：预览仍然铺满，但**被拍的 `ShareCard` 高度用的是 `useWindowSize().height`（不含状态栏）**，所以图里不会带状态栏。若真机发现带，就把 `ShareCard` 的 `height` 改成 `height - statusBarHeight` 并回报。

- [ ] **Step 2: 过闸门**

```bash
npx tsc --noEmit
npx eslint src/components/ShareCard/ShareCardModal.tsx
```

- [ ] **Step 3: 提交**

```bash
git add src/components/ShareCard/ShareCardModal.tsx
git commit -m "feat(分享图): 全屏预览 Modal，下载与分享按钮在被拍层之外"
```

---

### Task 10: 接线两个入口 + 文案

**Files:**
- Modify: `src/screens/PlayDetail/Vertical/Lyric.tsx:501`
- Create: `src/screens/PlayDetail/Vertical/components/ShareModeSheet.tsx`
- Modify: `src/screens/PlayDetail/Vertical/components/Header.tsx:51-59,103-105`
- Modify: `src/lang/zh-cn.json`、`src/lang/zh-tw.json`、`src/lang/en-us.json`

**Interfaces:**
- Consumes: `ShareCardModal`（Task 9）、`pickLyricLinesForCopy` / `hasLyricText`（`@/core/lyricCopy`）、`shareMusic`（`@/utils/tools`，文本那条路原样保留）
- Produces: 用户可见的两个入口 + i18n key `share_mode_sheet_title` / `share_mode_text` / `share_mode_image` / `share_card_save` / `share_card_saved` / `share_card_save_failed` / `share_card_save_canceled` / `share_card_capture_failed` / `share_card_no_selection`

- [ ] **Step 1: 歌词海报按钮接上**

Modify `src/screens/PlayDetail/Vertical/Lyric.tsx`：

顶部 import 加两行（`playerState` 该文件已有，`usePlayMusicInfo` 没有）：

```ts
import ShareCardModal from '@/components/ShareCard/ShareCardModal'
import { usePlayMusicInfo } from '@/store/player/hook'
```

组件内加（放在 `handleCopyLyric` 附近即可）：

```ts
const [posterOpen, setPosterOpen] = useState(false)
const playMusicInfo = usePlayMusicInfo()
// musicInfo 有两种形态（带进度的在 metadata 里，见 Header.tsx:57），不归一本地歌就拿不到 name
const rawMusic = playMusicInfo.musicInfo
const cardMusic = rawMusic ? ('progress' in rawMusic ? rawMusic.metadata.musicInfo : rawMusic) : null
```

这里只读 hook 那一份，**不要**照抄 Header 里 `playerState.playMusicInfo.musicInfo ?? playMusicInfo.musicInfo` 的写法 —— 那个是给"点击那一刻取最新值"用的，渲染里必须跟着 hook 走，否则换歌后卡上的字不更新。

把 `:501` 那枚 disabled 按钮换成：

```tsx
<Button style={{ ...styles.toolBtn, backgroundColor: theme['c-button-background'] }} onPress={handleOpenPoster} accessibilityRole="button">
  <Text size={14} color={theme['c-button-font']} style={styles.toolBtnText}>{t('lyric_tool_poster')}</Text>
</Button>
```

在 `handleCopyLyric`（`:418`）之后加：

```ts
const handleOpenPoster = useCallback(() => {
  if (!selectedLinesRef.current.size) {
    toast(t('share_card_no_selection'))
    return
  }
  setPosterOpen(true)
}, [t])
```

在 `return (` 的最外层 `</View>` 之前加：

```tsx
{
  posterOpen && cardMusic ? (
    <ShareCardModal
      visible
      mode="lyric"
      musicInfo={{ name: cardMusic.name, singer: cardMusic.singer, pic: cardMusic.pic }}
      lyricLines={pickLyricLinesForCopy(lyricLinesRef.current, selectedLinesRef.current)}
      onClose={() => setPosterOpen(false)}
    />
  ) : null
}
```

`cardMusic` 为 null（没有在播的歌）时不渲染 Modal；`lyricLines` 直接吃 `pickLyricLinesForCopy` 的返回值，与 Task 2 的 `LyricBlockLine` 结构同形，不用转换。

- [ ] **Step 2: 分享方式面板**

Create `src/screens/PlayDetail/Vertical/components/ShareModeSheet.tsx`，照 `MusicMoreSheet.tsx` 的 `Modal + GlassBackdrop + useSheetSlideAnimation` 结构写两行（`download-2` 那类图标已有）。行项：

```ts
const ACTIONS = [
  { key: 'text', icon: 'comment', label: 'share_mode_text' },
  { key: 'image', icon: 'share', label: 'share_mode_image' },
] as const
```

对外接口：

```ts
export interface ShareModeSheetType {
  show: () => void
}
export type ShareMode = 'text' | 'image'
// props: onSelect: (mode: ShareMode) => void
```

- [ ] **Step 3: Header 接上面板**

Modify `src/screens/PlayDetail/Vertical/components/Header.tsx`：

- import 增项：`react` 那条补 `useState`（现在写的是 `import { Fragment, memo, useRef } from 'react'`）；再加三条：

```ts
import ShareCardModal from '@/components/ShareCard/ShareCardModal'
import ShareModeSheet, { type ShareMode, type ShareModeSheetType } from './ShareModeSheet'
import type { ShareCardData } from '@/components/ShareCard'
```
- 组件内加：

```ts
const shareSheetRef = useRef<ShareModeSheetType>(null)
const [shareCardData, setShareCardData] = useState<ShareCardData | null>(null)
```

- `share()`（`:51`）整个换成只开面板：

```ts
const share = () => {
  shareSheetRef.current?.show()
}
```

- 面板选完回落这里，**一次算好数据**，Modal 只读 state（渲染里现取 `playerState` 会在换歌后不更新）：

```ts
const handleShareMode = (mode: ShareMode) => {
  const currentMusic = playerState.playMusicInfo.musicInfo ?? playMusicInfo.musicInfo
  if (!currentMusic) return
  const musicInfo = 'progress' in currentMusic ? currentMusic.metadata.musicInfo : currentMusic
  if (mode === 'text') {
    shareMusic(shareType, downloadFileName, musicInfo)
    return
  }
  setShareCardData({ name: musicInfo.name, singer: musicInfo.singer, pic: musicInfo.pic })
}
```

- 在 `<LyricSettingSheet ref={settingSheetRef} />` 旁边加 `<ShareModeSheet ref={shareSheetRef} onSelect={handleShareMode} />`，并在组件末尾（同一个 `<View>` 内）加：

```tsx
{
  shareCardData ? (
    <ShareCardModal
      visible
      mode="music"
      musicInfo={shareCardData}
      onClose={() => setShareCardData(null)}
    />
  ) : null
}
```

**文本那条路一行都不改**（`shareMusic` 原样调用，含 `common.shareType === 'clipboard'` 的剪贴板分支）。

- [ ] **Step 4: 文案**

Modify `src/lang/zh-cn.json`：插到已有的 `share_card_title_music` / `share_title_music` 那几行旁边即可（**这三个文件都不是全字母序**，实测 `share_card_title_songlist` 就排在 `share_title_music` 之后，别为了一枚 key 重排整表）：

```json
  "share_card_capture_failed": "生成图片失败",
  "share_card_no_selection": "先勾选几句歌词",
  "share_card_save": "保存图片",
  "share_card_save_canceled": "未选择保存位置",
  "share_card_save_failed": "保存失败",
  "share_card_saved": "已保存：{name}",
  "share_mode_image": "分享图片",
  "share_mode_sheet_title": "分享方式",
  "share_mode_text": "分享文字",
```

`zh-tw.json` 同样这 **9** 个 key（三份必须齐，Step 5 那条脚本逐份查缺）：

```json
  "share_card_capture_failed": "產生圖片失敗",
  "share_card_no_selection": "先勾選幾句歌詞",
  "share_card_save": "儲存圖片",
  "share_card_save_canceled": "未選擇儲存位置",
  "share_card_save_failed": "儲存失敗",
  "share_card_saved": "已儲存：{name}",
  "share_mode_image": "分享圖片",
  "share_mode_sheet_title": "分享方式",
  "share_mode_text": "分享文字",
```

`en-us.json`：

```json
  "share_card_capture_failed": "Couldn't create the image",
  "share_card_no_selection": "Pick some lyric lines first",
  "share_card_save": "Save image",
  "share_card_save_canceled": "No folder chosen",
  "share_card_save_failed": "Couldn't save",
  "share_card_saved": "Saved as {name}",
  "share_mode_image": "Share image",
  "share_mode_sheet_title": "Share as",
  "share_mode_text": "Share text",
```

- [ ] **Step 5: 过闸门**

```bash
npx tsc --noEmit
npx eslint src/screens/PlayDetail/Vertical src/components/ShareCard
node -e "for (const f of ['zh-cn','zh-tw','en-us']) { const j=require('./src/lang/'+f+'.json'); for (const k of ['share_card_capture_failed','share_card_no_selection','share_card_save','share_card_save_canceled','share_card_save_failed','share_card_saved','share_mode_image','share_mode_sheet_title','share_mode_text']) if (!(k in j)) throw new Error(f+' missing '+k) } console.log('i18n ok')"
```

预期：tsc 报错数不变；eslint 0 error；`i18n ok`。

- [ ] **Step 6: 提交**

```bash
git add src/screens/PlayDetail/Vertical src/lang
git commit -m "feat(分享图): 接上歌词海报按钮与播放页分享入口"
```

---

### Task 11: 全量闸门 + 真机验收 + spec 回写

**Files:**
- Modify: `docs/superpowers/specs/2026-10-16-share-card-image-design.md`（状态行 + 落地情况）

- [ ] **Step 1: 跑全量闸门**

```bash
npm test
npx tsc --noEmit
npx eslint . --ext .js,.jsx,.ts,.tsx
```

预期：`npm test` 无新增 fail（本机基线恒有 1 条既有失败）；tsc 条数不变；eslint 在自己改过的文件上 0 error。

- [ ] **Step 2: [真机] 构建装机**

ETA 6–8 分钟（Task 1 起过 Java 改动后首次）。

```bash
cd android && ./gradlew assembleDebug && adb -s <serial> install -r app/build/outputs/apk/debug/app-debug.apk
```

- [ ] **Step 3: [真机] 十条验收清单**

逐条向用户要结论并记进 spec：

1. 亮封面（白色系专辑）→ 白卡黑字。
2. 暗封面（黑金专辑）→ 深卡白字。
3. 本地歌无封面 → 深卡 + 空封面位不崩、导出按钮仍可用。
4. 歌词卡只选 1 句 → 大字号、卡偏矮。
5. 歌词卡全选 20+ 句 → 先缩字号，缩到 16 还装不下就截断补 `…`。
6. 选带译文的段落 → 译文紧跟自己那行、字更小。
7. 首次点下载 → 弹系统文件夹选择器，落地文件在系统图库里能看到。
8. 点分享 → 系统面板收到的是 PNG 图，不是文本。
9. 导出图里**没有**右上角那两枚按钮。
10. 预览页按返回 → 只关预览，回到歌词工具模式（不是一退两级回播放页）。

- [ ] **Step 4: 回写 spec 状态**

Modify `docs/superpowers/specs/2026-10-16-share-card-image-design.md`：状态行从"已定稿，待实现"改成实际，并把真机清单里不通过的条目、以及实现中偏离 spec 的地方逐条写进 §8/§5 对应位置（本仓库既有 spec 都这么做）。

- [ ] **Step 5: 提交**

```bash
git add docs/superpowers/specs/2026-10-16-share-card-image-design.md
git commit -m "docs(分享图): 真机验收结论与实现偏离回写"
```

---

## 自查（写完后跑一遍）

1. **spec 覆盖**：spec §2 依赖选型 → Task 1；§3 两层结构与明暗 → Task 3/4/6；§4 最大高度 → Task 2；§5 导出/分享/下载 → Task 7/8/9；§6 入口 → Task 10；§8 探针 → Task 1；§9 测试 → 各任务 + Task 11。无遗漏。
2. **占位符**：0 处。每段代码都是要落下去的最终形态，包括 `BrandLine`（真 `<Image source={require(...)}>`）和 Task 8 的第 2 条测试（期望串已按非法字符表算准）。
3. **类型一致性**：`LyricBlockLine`（Task 2 定义，Task 6/9/10 消费，与 `@/core/lyricCopy` 的 `LyricCopyLine` 结构同形）、`CardTheme`（Task 3 定义，Task 6 消费）、`ShareCardData`（Task 6 定义，Task 9/10 消费）、`CapturedCard`（Task 7 定义，Task 9 消费）。
   就绪链只有一条：`CoverImage.onReady` → `MusicCard/LyricCard.onCoverReady` → `ShareCard.onReadyChange` → `ShareCardModal.handleReady` → 两枚按钮的 `disabled`。中间任何一层都不许再存一份 state。
   `cardFileName` 住在 `src/utils/shareCard/cardFileName.ts`（零 import），Task 9 与单测都从那里取；`saveCard.ts` 也只从那里 import，不再二次导出。
4. **这轮自查里真跑过、不是推断的**：
   - HCT tone 50 的灰阶翻转点 = **119**（118 判暗、119 判亮，`Hct.fromInt` 实测），所以 Task 3 断言写死这两个值。
   - `comment` / `share` / `download-2` 三枚字形在 `src/resources/fonts/selection.json`（全站 53 枚）里都有。
   - `require('@/resources/images/*.png')` 的既有先例：`src/components/common/LocateButton.tsx:7`，且 `src/resources/images/` 目录已存在。
   - `android/gradle.properties:37` 是 `newArchEnabled=false` → 纯 Paper，给 `UtilsModule` 加方法**不需要** codegen spec。
   - Task 2 的 9 条用例逐档推演过（平局留大字号、`>` 判据下"正好等于上限"算装得下、译文跟着正文行走）。
5. **与 spec §7 文件清单的偏离**（都是有意为之，Task 11 Step 4 要回写进 spec）：
   - `src/utils/shareCard/export.ts` → 实名 **`exportCard.ts`**：`export` 是 JS 关键字，文件名与 `tsc` 的模块解析放一起容易踩坑，同目录已有 `saveCard.ts` 的命名风格。
   - spec 只列了一个导出层，本计划多拆出 **`cardFileName.ts`**：文件名的非法字符判据要能被 `node --test` 直接加载，而 `saveCard.ts` 带 RNFS 与 store import，加载不动（Task 8）。
   - spec §7 没列 `BrandLine.tsx`，本计划拆出来（Task 6）：音乐卡与歌词卡的落款完全同形同逻辑，不拆就是两份间距常数。
6. **iOS 为什么一行都不写**：`src/utils/nativeModules/utils.ts` 在模块顶层解引用 `NativeModules.UtilsModule`，`ios/` 侧没有对应实现（grep 过 `ios/**` 零命中）→ 这条路本来就只有安卓通。spec §10 也明确"iOS 不测、不写 `.mm`"。
