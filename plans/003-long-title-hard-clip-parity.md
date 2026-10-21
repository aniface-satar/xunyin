# 003 — 长标题收起时按静态栏的方式硬裁切，并让连接符不出界

- **Status**: DONE（代码已落地，待真机验收）
- **Commit**: 0ab47cd
- **Severity**: HIGH
- **Category**: Physicality & origin / 端点一致性（001 的长标题分支）
- **Estimated scope**: 3 文件（`transition.ts`、`PlayerOverlay/index.tsx`、`tests/overlayBarSeparatorMorph.test.mts`），约 20 行

## Problem

歌名+歌手长到需要跑马灯时，收起动画的最后一帧与静态控制栏对不上。设备实测（1260px 宽，
`C:\Users\30913\Downloads\1000269487.jpg` = 动画最后一帧，`1000269488.jpg` = 静态栏，均为整屏宽裁切）：

| 元素 | 动画最后一帧 | 静态控制栏 |
| --- | --- | --- |
| 标题墨迹 | x 187–749 | x 187–801 |
| 连接符 "-" | **x 819–834（文字栏外，压在上一曲按钮前）** | 无（尚未滚到） |
| 进度条轨道 | x 187–801 | x 187–801 |

两处独立缺陷：

**A. 裁切语义不同。** 静态栏的文字由 `SynchronizedMarquee` 渲染：文本被放在一个"自然宽度"的
盒子里，外层 mask 只负责 `overflow: 'hidden'` 硬裁，所以最后一个字可以只露一半。

```tsx
/* src/components/common/SynchronizedMarquee.tsx:178-196 — 静态栏实际用的机制 */
<View style={[styles.mask, style]} onLayout={handleContainerLayout}>   // mask: overflow hidden, width 100%
  <Animated.View style={[styles.content, { transform: [{ translateX }] }]}>
    <View collapsable={false} style={itemStyle}>                        // itemStyle: { width: textWidth } 自然宽
      {children}
```

morph 层却是给 `Text` 本身限宽再交给系统省略号：

```jsx
/* src/components/player/PlayerOverlay/index.tsx:1156-1167 — 当前 */
style: [styles.morphTitle, titleStyle],          // morphTitle: { position: 'absolute' }，不裁切
children: <Animated.Text numberOfLines={1} ellipsizeMode="clip"
  style={[styles.morphText, titleTextStyle, ...]} // morphText: { width: '100%' }
```

Android 的 `TruncateAt.CLIP` 会**整字丢弃**放不下的那个字形，于是 morph 停在 749，
静态栏却能露出 764–801 的"背" —— 交接瞬间文字凭空多出一截。

**B. 001 的连接符盒会长到文字栏外面。** `clampedTitleBarRect` 把标题夹满文字栏后，
标题右缘已经是 `barTextRight`（801），而 `clampedArtistBarRect.x` 取的是测量层里的自然位置
（约 950，在栏外）。连接符盒按"标题右缘 → 歌手左缘"取宽：

```ts
/* src/components/player/PlayerOverlay/transition.ts:308-315 — 当前 */
const left = title.x + title.width
return { left, width: Math.max(0, artist.x - left) }   // 801 → 950，宽 149，整盒在文字栏外
```

于是那个 "-" 被画在 819–834，也就是截图里标题区右侧那颗孤零零的短横。
（`plans/README.md` 原先写"001 在长标题下只会退化成不画连接符"，实测不成立，就是这一条。）

## Target

1. morph 的三个文字节点（标题 / 歌手 / 连接符）改成与静态栏同一套裁切语义：
   **外层盒子负责裁切（`overflow: 'hidden'`），内层 `Text` 用自然宽度、不再触发省略号**。
   这样两端都是"最后一个字可以只露一半"，749 与 801 的差异消失。
2. 连接符盒的宽度以**文字栏右缘**为上限：标题已经占满文字栏时宽度归零，绝不越界到按钮区。

## Repo conventions to follow

- 纯几何/淡入淡出判断一律放 `src/components/player/PlayerOverlay/transition.ts`，写成可单测的纯函数
  （`getMorphSeparatorRect` / `getMorphCoverShadowFadeConfig` 是范例）。
- `index.tsx` 是反编译产物，改动保持 `var x = ...` + `(0, require("./transition").fn)(...)` 的既有写法。
- 文字栏右界已有现成量：`barTextRight = barProgress.x + barProgress.width`（`index.tsx:809`），
  实测与静态栏 mask 的右缘同一条竖线（187–801）。
- 不要给 `Text` 加 `elevation` 之类 `ViewStyle` 专属属性（RN 的 Image/Text propTypes 会喂 LogBox，见 [[project-lx-music]]）。

## Steps

1. **`transition.ts`** — 给 `getMorphSeparatorRect` 增加文字栏右界参数，把宽度夹住：

   ```ts
   // columnRight 是文字栏右缘（barTextRight）：长标题占满文字栏时歌手被推到栏外，
   // 不夹住的话连接符盒会整个跑到按钮区前面
   export const getMorphSeparatorRect = (title: OverlayRect, artist: OverlayRect, columnRight: number) => {
     const left = title.x + title.width

     return {
       left,
       width: Math.max(0, Math.min(artist.x, columnRight) - left),
     }
   }
   ```

2. **`index.tsx:1076`** — 调用处补上第三个实参：

   ```js
   var morphSeparatorRect = (0, require("./transition").getMorphSeparatorRect)(clampedTitleBarRect, clampedArtistBarRect, barTextRight);
   ```

3. **`index.tsx` styles（`morphTitle` 附近）** — 新增一个只给文字用的裁切样式，并把 `morphText` 的
   `width: '100%'` 换成自然宽度常量（`morphText` 仅被标题/歌手/连接符三处使用，改它不影响别处）：

   ```js
   // 与 SynchronizedMarquee 的 mask 同构：外层裁切、内层按自然宽度排版，
   // 这样长文本的最后一个字能像静态栏一样只露一半，而不是被系统省略号整字丢掉
   morphClip: {
     position: 'absolute',
     overflow: 'hidden'
   },
   ```

   ```js
   var MORPH_TEXT_NATURAL_WIDTH = 10000;
   ```

   ```js
   morphText: {
     width: MORPH_TEXT_NATURAL_WIDTH,
     includeFontPadding: false
   },
   ```

   注：`10000` 与 `SynchronizedMarquee` 里测量层用的 `width: 10000` 同源，不是新发明的数。

4. **`index.tsx:1158 / 1169 / 1180`** — 三个文字外层由 `styles.morphTitle` 换成 `styles.morphClip`。
   **`index.tsx:1191` 那个 `actionColumnStyle`（喜欢/更多按钮列）保持 `styles.morphTitle` 不动**，
   它里面是可点按钮，加 `overflow: 'hidden'` 会削掉 hitSlop 与图标阴影。

5. **`tests/overlayBarSeparatorMorph.test.mts`** — 三条既有用例补第三实参，并新增一条长标题用例：
   标题占满文字栏（`title.x + title.width == columnRight`）而歌手自然位置在栏外时，宽度必须为 0。

## Boundaries

- 不要动 `clampedTitleBarRect` / `clampedArtistBarRect` 的夹取公式（`index.tsx:810-823`）——
  它们算出的盒子右缘本来就等于文字栏右缘，问题只在裁切语义。
- 不要动 `titleWidth` / `artistWidth` / `barSeparatorLeft` 等插值本身，只换外层样式与 `morphText.width`。
- 不要动 `SynchronizedMarquee`、`PlayerBar/components/Title.tsx`、`PlayDetail/Vertical/Player/components/MusicInfo.tsx`
  这些静态侧的代码。
- 不要引入 `Animated` 原型算术（`.subtract()` 等在 RN 0.73 不存在，见 001 的 Status 记录）。
- 若某一步与现状不符，STOP 并报告。

## Verification

- **机械**：`npm test` 全绿；`npx eslint src/components/player/PlayerOverlay/transition.ts tests/overlayBarSeparatorMorph.test.mts` 无输出。
- **产物**：构建后在 APK 的 `assets/index.android.bundle` 里探针 `getMorphSeparatorRect` 仍为 1 次。
- **手感（关键，必须用长标题那首）**：真机上放"不死鸟 (电影《火锅英雄》背景音乐)"这类歌名超长的曲子，
  从全屏页慢慢下拉到贴合控制栏、中途不松手截图，松手后再截一张，用 PIL 比对：

  ```
  python -c "from PIL import Image; import numpy as np; \
    a=np.asarray(Image.open('hold.png').convert('L'))[2440:2500,:]; \
    b=np.asarray(Image.open('settled.png').convert('L'))[2440:2500,:]; \
    print(int((np.abs(a.astype(int)-b.astype(int))>40).sum()))"
  ```

  期望 **0**（两帧标题行墨迹完全一致）。肉眼看还要确认：
  - 最后一帧标题右端与进度条右端（801）齐平，不再停在 749；
  - 标题区右侧、上一曲按钮之前**没有**孤立的 "-"；
  - 松手后文字不重新排、不跳字。
- 反向（点控制栏展开）确认标题/歌手从同一位置长回全屏布局，短标题歌曲行为不变。
- **Done when**：长标题下 `hold` 帧与 `settled` 帧标题行差为 0，且连接符不出现在文字栏外。
