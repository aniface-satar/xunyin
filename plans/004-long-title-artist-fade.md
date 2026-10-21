# 004 — 歌名占满文字栏时，歌手改为随行程淡出淡入

- **Status**: DONE（代码已落地；13m48s 构建成功，`xunyin-v1.0.10-arm64-v8a.apk` 19:37:43，`pm install -r` Success，`lastUpdateTime=2026-10-07 19:38:23`；bundle 内 `getMorphArtistFadeConfig` 探针 = 1；待真机验收）
- **Commit**: 未提交（工作区含发版 WIP，按 [[project-git-tracking-gap]] 精确 add）
- **Severity**: HIGH
- **Category**: 端点一致性（003 的长标题分支留下的观感缺陷）
- **Estimated scope**: 3 文件（`transition.ts`、`PlayerOverlay/index.tsx`、`tests/overlayArtistFade.test.mts`），约 30 行

## Problem

装机版（002+003，`lastUpdateTime=2026-10-07 19:08:39`）在歌名超长的曲子上仍然难看，
用户截图 `C:\Users\30913\Downloads\1000269528.jpg`：歌名"不死鸟 (电影《火锅英雄"与歌手
"彭飞、赵英"两段墨迹叠在一起，歌手像躲在一块空白后面。

003 把 morph 文字改成了与静态跑马灯同构的"外层硬裁"，短标题端点已经对齐；但长标题分支
只解决了一半：

1. 静态底部栏此时**根本不画歌手**。`PlayerBar/components/Title.tsx` 把 `歌名 - 歌手` 作为
   一整段文字放进 `SynchronizedMarquee`，mask 只裁到文字栏右缘（实测 187–801），歌名就占满了
   整个窗口，后面的 ` - 歌手` 全部在窗口外。
2. morph 层的歌手是个独立盒子，终态被 `clampedArtistBarRect` 夹成宽 0（`index.tsx:820-826`），
   可它的 **y 终态和歌名同一行**（测量层里 title/artist 都在 `top: 0` 那一行）。于是飞行途中
   它仍带全屏时的宽窗口，一边往右上飞一边被收进零宽裁切框，中途与同样在往上飞的歌名重叠。

结论：长标题下末态就没有歌手可对齐，唯一正确的收尾是**让歌手在行程中淡掉**；展开时反向淡回。
用户明确指定时机为"大概歌名和歌手名重合的地方"。

## Target

1. 判定"歌名自然宽度占满文字栏"这一条件（不靠猜，用已有的测量值算）。
2. 命中该条件时，morph 歌手节点的不透明度在行程内从 1 淡到 0，`progress=1` 必须为 0；
   `progress=0` 必须为 1（回全屏时歌手完整）。淡出起点取两个文本盒首次重合的那一刻。
3. 未命中时行为完全不变（歌手全程不透明、连接符按 001/003 淡入），短标题零回归。

## Repo conventions to follow

- 淡入淡出曲线一律写成 `transition.ts` 里的纯函数，返回 `MorphFadeConfig`
  （`getMorphCoverShadowFadeConfig` 是范例，含 `extrapolate: 'clamp'`）。
- `index.tsx` 是反编译产物，保持 `var x = ...` + `(0, require("./transition").fn)(...)` 写法。
- 文字栏右界用现成的 `barTextRight = barProgress.x + barProgress.width`（`index.tsx:812`）。
- 严禁 `Animated` 原型算术（`.subtract()` 等在 RN 0.73 不存在，见 001 的 Status）。

## Steps

1. **`transition.ts`** — 在 `getMorphCoverShadowFadeConfig` 之后新增：

   ```ts
   export interface MorphTextAnchor {
     y: number
     height: number
   }

   export const getMorphArtistFadeConfig = (
     textMorphThresholds: number[],
     titleStart: MorphTextAnchor,
     artistStart: MorphTextAnchor,
   ): MorphFadeConfig => {
     const travelStart = textMorphThresholds[2] ?? 0.5
     const span = Math.max(0.01, 1 - travelStart)
     const gap = artistStart.y - titleStart.y
     const overlapFraction = gap > titleStart.height
       ? Math.min(0.6, Math.max(0.08, 1 - titleStart.height / gap))
       : 0.08
     return {
       inputRange: [0, travelStart, Math.min(0.99, travelStart + span * overlapFraction), 1],
       outputRange: [1, 1, 0, 0],
       extrapolate: 'clamp',
     }
   }
   ```

   时机推导：全屏时歌名盒与歌手盒竖向相距 `gap`，两者共用 `textMorphThresholds` 的同一段
   线性行程收敛到同一条底线，所以行程比 `u` 处的剩余间距是 `gap * (1 - u)`。首次重合即
   `gap * (1 - u) < titleStart.height`，解出 `u = 1 - h / gap`。实测全屏 `gap = FULL_TITLE_LINE_HEIGHT + 4`，
   `h = FULL_TITLE_LINE_HEIGHT`，得 `u ≈ 0.13`——歌手在刚贴上歌名行盒时就开始淡，落地前早已透明。
   `0.08 / 0.6` 的下上界只防退化输入（gap 为 0 或歌词页摘要那种紧凑排版）。

2. **`index.tsx`（`artistLineHeight` 之后、`var morphOpacity = 1;` 之前）** — 计算闸门与不透明度：

   ```js
   // 歌名自然宽度占满文字栏时，静态底部栏的跑马灯只画到歌名，歌手根本不在末态里；
   // morph 层必须让歌手在飞行途中淡出，否则它会飞进歌名那一行、被零宽裁切框啃成"躲在空白块后面"
   var barTextAvailableWidth = barTextRight - clampTextLeft;
   var titleFillsBarTextColumn = barTextAvailableWidth > 0 && titleBarRect.width > barTextAvailableWidth;
   var artistOpacity = titleFillsBarTextColumn ? progress.interpolate((0, require("./transition").getMorphArtistFadeConfig)(textMorphThresholds, titleStart, artistStart)) : 1;
   ```

   闸门用**自然宽度** `titleBarRect.width`（来自播放栏测量层，未夹取）与可用栏宽比较，
   而不是比较夹取后的宽度——后者恒等于上限，判不出溢出。

3. **`index.tsx` `artistStyle`** — 补 `opacity: artistOpacity`（渲染节点 `styles.morphClip, artistStyle`
   本身不动，`Animated.View` 直接吃插值）。

4. **`tests/overlayArtistFade.test.mts`（新文件）** — 三条用例：全程淡出曲线端点、
   淡出起点等于几何重合点、退化输入下 `inputRange` 严格递增且 `progress=0` 为 1。
   **必须在 `package.json` 的 `scripts.test` 里登记文件名**，该脚本是枚举式的，漏登记就永不执行。

## Boundaries

- 不改 `clampedArtistBarRect` / `clampedTitleBarRect` 的夹取公式（`index.tsx:814-826`）：
  零宽裁切框正是末态"歌手不出现"的正确载体，问题只在飞行途中它一直可见。
- 不改连接符：长标题下 `getMorphSeparatorRect` 的宽度已经夹成 0（003 的 `columnRight`），
  它画不出任何东西，无需再叠一条淡出曲线。
- 不改 `PlayerBar/components/Title.tsx`、`SynchronizedMarquee`、`MusicInfo.tsx` 这些静态侧代码。
- 短标题（歌名+歌手放得下）一律走 `artistOpacity = 1`，与 002/003 的验收结果保持一致。
- 若某一步与现状不符，STOP 并报告。

## Verification

- **机械**：`npm test` 全绿（含新增 3 条）；
  `npx eslint src/components/player/PlayerOverlay/transition.ts tests/overlayArtistFade.test.mts` 无输出；
  `@babel/parser` 解析 `index.tsx` 通过；`npx tsc --noEmit` 不新增本文件相关错误（基线是反编译产物自带的一堆报错）。
- **产物**：构建后在 APK 的 `assets/index.android.bundle` 里探针 `getMorphArtistFadeConfig` 出现次数为 1，
  并以 `getFullscreenActionTop` 作正对照。
- **手感（必须用"不死鸟 (电影《火锅英雄》背景音乐)"这类歌名占满文字栏的曲子）**：
  - 从全屏慢慢下拉，看歌手是否**平滑淡掉**而不是被一块空白啃字；
  - 最后一帧只剩歌名（末字可只露一半），与松手后的静态栏逐像素一致，无重排；
  - 松手交接时不许出现 "-"；
  - 反向点控制栏展开：歌手随行程淡回，全屏页歌名/歌手完整。
  - 短标题回归：普通歌曲歌手全程可见、连接符按 001 时机淡入。
- **Done when**：长标题曲子上，收起途中看不到"歌手躲空白"的重叠帧，且末帧与静态栏一致。
