# 002 — 让 morph 封面的阴影在落到控制栏前淡到 0

- **Status**: DONE（代码已落地，待真机验收）
- **Commit**: 0ab47cd
- **Severity**: HIGH
- **Category**: Physicality & origin / 端点一致性
- **Estimated scope**: 2 文件（`transition.ts`、`PlayerOverlay/index.tsx`）+ 1 个测试文件，约 30 行

## Problem

收起动画的最后一帧，封面下方仍然带着全屏页的重阴影；overlay 卸载、换成静态播放栏的那一帧，阴影凭空消失 —— 视觉上就是"跳一下"。

根因是两端阴影能力不对等：

```js
/* src/components/player/PlayerOverlay/index.tsx:1420 — 当前（morph 层） */
  coverShadow: {
    position: 'absolute',
    backgroundColor: 'transparent',
    elevation: 18,          // 安卓真实阴影
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18
  },
```

```js
/* src/components/player/PlayerOverlay/index.tsx:755 — 当前（淡入淡出配置） */
  var coverShadowOpacity = isLyricOrigin ? progress.interpolate({
    inputRange: [0, require("./transition").LYRIC_FADE_OUT_END],
    outputRange: [0, 1],
    extrapolate: 'clamp'
  }) : 1;                   // ← 歌曲页全程恒为 1，progress=1 时阴影满档
```

```tsx
{/* src/components/player/PlayerBar/components/Pic.tsx:72-86 — 静态播放栏封面 */}
<Image
  url={musicInfo.pic}
  style={{
    ...styles.image,
    backgroundColor: theme['c-content-background'],
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18,
    borderWidth: BorderWidths.normal,
    borderColor: theme['c-border-background'],
  }}
/>
```

静态栏这一处**没有 `elevation`**，而 `shadow*` 是 iOS-only 属性、且挂在 `Image` 上（RN 的 `ReactImageView` 不走 View background，Drawee 层级不画 iOS 阴影）。所以安卓上静态栏封面**根本没有阴影** —— 见 [[project-lx-music]] 里 2026-10-02 修 `elevation` 无效 prop 的那一条：当时删掉的正是这一行。

对照全屏静态页 `src/screens/PlayDetail/Vertical/Pic.tsx:93-97`：那里 `elevation: 18` 与 morph 层同源，所以 progress=0 两端一致，问题只出在 progress=1 这一端。

## Target

阴影随封面飞行整段缓慢淡掉，`progress == 1` 时精确为 0；两端点与静态布局一一对应：

- progress=0（全屏）：非歌词页来源 → 阴影满档 1（与 `PlayDetail/Vertical/Pic.tsx` 一致）；歌词页来源 → 0（摘要小封面本就没阴影）。
- progress=1（控制栏）：**两条分支都必须 0**（静态栏画不出阴影）。
- 中间：从封面开始飞行的那个 progress 线性淡到 0，"缓慢消失"而不是末端突然撤掉。

## Repo conventions to follow

- morph 的淡入淡出配置一律做成 `transition.ts` 里的纯函数（`getGhostFadeConfig`、`getMorphSeparatorFadeConfig` 是范例），返回 `{ inputRange, outputRange, extrapolate }` 交给 `progress.interpolate(...)`。
- 阈值来自 `index.tsx` 已算好的布局量，不要另起一套常量：封面在 `[0, textSettleThreshold, textMoveThreshold, 1]`（`coverMorphThresholds`，`index.tsx:395`）上运动，`textMoveThreshold` 就是它离开全屏位置、开始飞行的时刻（`index.tsx:390`）。
- `index.tsx` 是反编译产物，改动必须写成 `var x = progress.interpolate((0, require("./transition").fn)(args));` 这种既有惯用法。
- **不要对插值节点做原型运算**（`.subtract()` 等在 RN 0.73 不存在，会首渲崩，见 001 的 Status 记录）。
- 纯函数测试放 `tests/*.test.mts`，用 `node --test --experimental-strip-types`，并把文件名追加进 `package.json` 的 `scripts.test`（该脚本是枚举式的，不加就不跑）。

## Steps

1. **`src/components/player/PlayerOverlay/transition.ts`** — 在 `getMorphSeparatorFadeConfig` 之后追加：

   ```ts
   export interface MorphFadeConfig {
     inputRange: number[]
     outputRange: number[]
     extrapolate: 'clamp'
   }

   // 阴影只属于全屏页的大封面：静态控制栏的封面（PlayerBar/components/Pic.tsx）只写了 iOS 阴影属性、
   // 没有 elevation，在安卓上画不出影子。收起时若阴影一路保持到 progress=1，overlay 卸载的那一帧
   // 就会看到影子凭空消失。这里让它随封面飞行整段缓慢淡掉，最后一帧与静态控制栏一致。
   // coverTravelStart 是封面离开全屏位置、开始飞行的 progress（即 textMoveThreshold）。
   export const getMorphCoverShadowFadeConfig = (isLyricOrigin: boolean, coverTravelStart: number): MorphFadeConfig => {
     const travelStart = Math.min(Math.max(coverTravelStart, 0.2), 0.9)
     if (!isLyricOrigin) {
       return { inputRange: [0, travelStart, 1], outputRange: [1, 1, 0], extrapolate: 'clamp' }
     }
     // 歌词页摘要的小封面本身没有阴影，仍按原时机先淡入托住飞行中的卡片，落到控制栏前再淡掉
     const appearEnd = Math.min(LYRIC_FADE_OUT_END, travelStart * 0.8)
     return { inputRange: [0, appearEnd, travelStart, 1], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' }
   }
   ```

   `travelStart` 夹到 `[0.2, 0.9]`、`appearEnd` 取 `min(0.5, travelStart * 0.8)`，是为了让 `inputRange` 在任何布局下都严格递增 —— Animated 遇到非递增区间会直接抛错。

2. **`src/components/player/PlayerOverlay/index.tsx:755-759`** — 把三元 + 常量 1 的写法整体换成一次插值：

   ```js
   var coverShadowOpacity = progress.interpolate((0, require("./transition").getMorphCoverShadowFadeConfig)(isLyricOrigin, textMoveThreshold));
   ```

   `textMoveThreshold` 在 `index.tsx:390` 声明，早于此处，作用域没问题。渲染侧 `index.tsx:1243` 的 `opacity: coverShadowOpacity` 不动 —— 这个节点本来就是靠 `opacity` 淡阴影（歌词页分支一直是这么跑的，机制已被真机验证）。

3. **`tests/overlayCoverShadowFade.test.mts`（新建）** — 三条断言：歌曲页在全屏段保持 1、行程中点约 0.5、`progress=1` 归 0；歌词页来源先淡入再淡出；两条分支在 `coverTravelStart` 取 0.02/0.08/0.5/0.94/0.99 时 `inputRange` 都严格递增且与 `outputRange` 等长。

4. **`package.json`** — `scripts.test` 末尾追加 ` tests/overlayCoverShadowFade.test.mts`。

## Boundaries

- 只动阴影的**不透明度曲线**。不要给 `PlayerBar/components/Pic.tsx` 补 `elevation`（那会改变静态栏外观，且 `elevation` 在 `Image` 上是无效 prop、会再触发一次 LogBox 报警）。
- 不要动 `coverShadow` 样式里的 `elevation: 18` / `shadow*` 数值 —— 那组值与全屏静态页同源，是 progress=0 端的一致性保证。
- 不要动 `coverBorderWidth`（`index.tsx:761-765`）：静态栏确实有 `borderWidth`，描边在 progress=1 保持可见是对的。
- 不要动 `ghostFadeConfig` / `heartOpacity` 等其它 ghost 淡入淡出区间。
- 若某一步对不上代码现状（行号漂移），STOP 并报告，不要即兴改。

## Verification

- **机械**：`npm test` → 全绿（本次改动后为 122 pass / 0 fail）；`npx eslint src/components/player/PlayerOverlay/transition.ts tests/overlayCoverShadowFade.test.mts` → 无输出；`npx tsc --noEmit` 的报错数与基线（约 322，全部来自 `_archive/`、嵌套 `lx-music-mobile/` 和 `index.tsx` 既有 implicit-any）一致，且没有新增指向 `transition.ts` 的行。
- **产物**：构建后用 `python -c` + `zipfile` 读 APK 内 `assets/index.android.bundle`，`getMorphCoverShadowFadeConfig` 计数应为 1（同批正对照 `getMorphSeparatorRect` 也是 1）。
- **手感**：真机上从全屏页慢慢下拉到贴合控制栏、中途不松手 —— 阴影应当随着封面下移一路变淡，贴到栏位时已经看不见了；松手换成静态栏，不该出现"影子被抽走"的跳变。反向（点栏展开）时阴影应在飞行途中长回来，而不是展开完才啪地出现。
- 两条来源分支都要看：歌曲页（大封面）和歌词页（顶部小封面摘要）各收起一次；歌词页那条在行程前段应仍是"淡入再淡出"的驼峰。
- **Done when**：`progress=1` 时 `coverShadowOpacity` 为 0，且真机上松手瞬间封面向下不再有可见阴影。
