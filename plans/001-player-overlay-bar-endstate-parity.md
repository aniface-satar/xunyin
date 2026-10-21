# 001 — 让收起动画的最后一帧与底部播放栏逐像素一致

- **Status**: 代码已实现（机械验证通过：119 测试含 3 个新用例、Metro babel preset 解析通过、transition.ts lint 干净）；待真机观感验收
  - 首轮装机暴露：Step 4 的 `left: artistLeft.subtract(w)` 在 RN 0.73 直接崩（`AnimatedInterpolation` 原型无 `subtract`，只有静态 `Animated.subtract`），PlayerOverlay 首次渲染即抛 `TypeError: undefined is not a function`。已改为与 `artistLeft`/`artistTop` 同构的 `progress.interpolate({inputRange: textMorphThresholds, outputRange: [artistStart.x - w, artistStart.x - w, rect.left, rect.left]})`。教训：本文件的 morph 值一律用插值组装，不要对插值节点做原型运算。
- **Commit**: 0ab47cd
- **Severity**: HIGH（动画收尾可见跳变，属于 feel-breaking）
- **Category**: Physicality & origin / 端点一致性（morph 终点必须等于静态布局）
- **Estimated scope**: 3 个文件（`src/components/player/PlayerOverlay/transition.ts`、`src/components/player/PlayerOverlay/index.tsx`、新增 1 个测试文件 + `package.json` 的 test 脚本），约 40 行

## Problem

从全屏播控页收起到底部播放栏时，动画最后一帧（图一）与动画结束后真正显示的静态播放栏（图二）不一致，overlay 卸载的那一帧会发生一次瞬时跳变。

对两张截图做像素级对齐（两图裁剪位置相差 15px，对齐后逐像素求差）后，整个播放栏区域内**只有两处**真实差异，其余（封面尺寸、标题字形、时间文本、控制按钮）差异均在 ±1px 噪声内：

1. **` - ` 连接符凭空出现**
   图一在 x∈[651, 667]、y∈[237, 240] 区域是纯白（像素值 255）；图二同一位置是一条灰值约 154 的短横，即 ` - `。
   标题字形在两帧中的 x 区间完全相同（`Clarity` 212–352、`(Radio` 373–511、`Edit)` 532–628），歌手 `Vicet` 起始位置也相同（686 vs 685）。也就是说 morph 层的标题和歌手已经落位准确，**唯一缺失的是两者中间那段 ` - `**。

   根因：morph 层把歌名和歌手渲染成两个独立的绝对定位盒子，而静态播放栏是一整段 `name - singer`。
   `src/components/player/PlayerBar/components/Title.tsx:88-110` 里，可见文本是单个 `Text`（`{name}{` - ${singer}}`），另外叠了一层 `opacity: 0` 的 `measureLayer` 用来量出 `titleRef`（只有歌名）和 `artistRef`（只有歌手）两个盒子：

   ```tsx
   // src/components/player/PlayerBar/components/Title.tsx:100-110 — 当前
   <View style={styles.measureLayer} pointerEvents="none" collapsable={false}>
     <View ref={titleRef} style={styles.measureItem} onLayout={handleTitleLayout} collapsable={false}>
       <Text size={15} color={glassColors.text} style={styles.text}>{musicInfo.name}</Text>
     </View>
     {
       musicInfo.singer && <Text size={15} color={glassColors.muted} style={[styles.text, styles.separator]}>{' - '}</Text>
     }
     <View ref={artistRef} style={styles.measureItem} onLayout={handleArtistLayout} collapsable={false}>
       <Text size={15} color={glassColors.muted} style={styles.text}>{musicInfo.singer}</Text>
     </View>
   </View>
   ```

   上报给 overlay 的只有 `title` 和 `artist` 两个矩形（`PlayerBar/index.tsx:60-67`），中间那个 ` - ` 盒子被量出来了、却没有任何一方把它画进 morph 层。morph 层的收尾只放了两个文本：

   ```tsx
   // src/components/player/PlayerOverlay/index.tsx:1134-1155 — 当前（标题 + 歌手，中间无连接符）
   {showCoverMorph && (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
     pointerEvents: "none",
     style: [styles.morphTitle, titleStyle],
     children: (0, _jsxRuntime.jsx)(_reactNative.Animated.Text, { numberOfLines: 1, ellipsizeMode: "clip", style: [...], children: musicInfo.name })
   })}{showCoverMorph && (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
     pointerEvents: "none",
     style: [styles.morphTitle, artistStyle],
     children: (0, _jsxRuntime.jsx)(_reactNative.Animated.Text, { numberOfLines: 1, ellipsizeMode: "clip", style: [...], children: musicInfo.singer })
   })}
   ```

   于是 progress=1 时画面是 `Clarity (Radio Edit)` + 一段空白 + `Vicet`，动画一结束静态栏接管，` - ` 才出现。

2. **播放栏顶部那条分隔线在最后一帧消失**
   图二在 row 181 有一条从 x=34 到 x=1226 的连续细线（`PlayerBar` 的 `borderTopWidth`，两端因为 `borderTopLeftRadius: 12` 各内缩约 12dp）；图一在对应行（row 166）整条是纯白 255，完全没有线。

   根因：overlay 自己画了一条 `transitionSeparator` 跟随卡片顶边，但它的透明度在两端都被淡出了：

   ```tsx
   // src/components/player/PlayerOverlay/index.tsx:744-747 — 当前
   var separatorOpacity = progress.interpolate({
     inputRange: [0, 0.08, 0.92, 1],
     outputRange: [0, 1, 1, 0]
   });
   ```

   progress=1 时它等于 0。而此时卡片（`cardStyle.backgroundColor` 不透明，终态矩形与 `source.bar` 完全重合）正好把真实播放栏整个盖住，所以静态栏自己的 `borderTopWidth` 也看不见 → 收尾瞬间凭空冒出一条横线。

   这条线在 progress=1 时**是**播放栏的上边框，本来就该是 1，只应该在接近全屏（0→0.08）时淡出。

## Target

- progress=1（收起动画最后一帧）与静态播放栏之间不再有任何可见差异：` - ` 已经在位、顶部细线已经在位。
- ` - ` 的几何完全由测量值推导，不新增测量链路：它的盒子就是 `title` 盒子右边缘到 `artist` 盒子左边缘之间那段（图一/图二实测 628→686，宽约 55px ≈ 21dp）。
- ` - ` 随歌手盒子一起移动，并在 morph 行程内淡入到位（不是收尾时补一帧），展开方向对称淡出。
- 顶部细线在 progress=1 时保持 opacity 1，并按卡片圆角内缩，使其直线段长度与静态栏 `borderTopWidth` 的直线段一致。

具体目标值（全部照抄，不要近似）：

```tsx
// transition.ts — 新增两个纯函数
// 底部栏静态排版是 "歌名 - 歌手" 一整段，morph 层的标题/歌手是两个独立盒子，
// 中间空出来的正是 " - " 的位置；收尾时必须补上，否则动画结束切静态栏时连接符凭空跳出
export const getMorphSeparatorRect = (title: OverlayRect, artist: OverlayRect) => {
  const left = title.x + title.width
  return { left, width: Math.max(0, artist.x - left) }
}

// " - " 只存在于底部栏，全屏页没有；它随歌手盒子一起淡入，避免卸载瞬间凭空出现
export const getMorphSeparatorFadeConfig = (textMorphThresholds: number[]) => ({
  inputRange: textMorphThresholds,
  outputRange: [0, 0, 1, 1],
})

// index.tsx — 分隔线透明度：终态保持可见，只在靠近全屏时淡出
var separatorOpacity = progress.interpolate({
  inputRange: [0, 0.08, 1],
  outputRange: [0, 1, 1]
});

// index.tsx — 分隔线按卡片圆角内缩（卡片终态圆角 12，与 PlayerBar 的 borderTopLeftRadius: 12 同源）
var separatorStyle = {
  left: 12,
  top: 0,
  width: winWidth - 24,
  opacity: separatorOpacity,
  transform: [ /* translateX / translateY / scaleX 三个插值保持原样，元素中心仍是 winWidth/2 */ ]
};
```

## Repo conventions to follow

- morph 层的几何一律拆成 `transition.ts` 里的纯函数 + `index.tsx` 里 `progress.interpolate` 组装；已有同类范例：`getActionColumnTarget`、`getFullscreenActionTop`（`transition.ts:56-77`），以及它们对应的中文注释风格（说明"为什么"而不是"是什么"）。
- 端点一致性是这个模块的既定原则，注释里已多次声明，改动时沿用同一措辞逻辑：
  - `index.tsx:389` “最后一段动画直接锁定静态全屏文本布局，避免动画结束时字号和可见宽度再跳变”
  - `index.tsx:824` “动画终点必须与静态全屏布局完全一致，否则收尾时会跳变”
  - `transition.ts:54-55` 关于 `paddingTop` 必须两条路径都补的说明
- 动画层的裸 `Animated.Text` 必须带 `textShadowStyle`（`index.tsx:167-174` 的注释明确要求，否则开启文字阴影时切换瞬间会闪阴影）。
- 文本样式复用：`styles.morphTitle`（`{position:'absolute'}`）+ `styles.morphText`（`{width:'100%', includeFontPadding:false}`），字号/行高直接复用歌手的插值值（歌手与 ` - ` 在静态栏里同为 `size={15}` → `setSpText(15)`，即 `MINI_ARTIST_FONT_SIZE`）。
- 纯函数测试放在 `tests/*.test.mts`，用 `node:test` + `node:assert/strict`，从 `../src/components/player/PlayerOverlay/transition.ts` 直接 import，并写中文注释说明被守护的跳变场景。范例：`tests/overlayFullscreenActionTop.test.mts`。
- `npm test` 脚本是**逐个列举文件**的（`package.json` 的 `test` 字段），新增测试文件必须同时加进该列表，否则不会跑。

## Steps

1. **`src/components/player/PlayerOverlay/transition.ts`** — 在 `getGhostFadeConfig` / `getLyricPagerFadeConfig` 附近（文件末尾 `LYRIC_FADE_OUT_END` 之前）新增上面 Target 代码块里的两个导出函数 `getMorphSeparatorRect`、`getMorphSeparatorFadeConfig`，连同中文注释。`OverlayRect` 类型已在 `transition.ts:105-110` 定义，直接复用。

2. **`src/components/player/PlayerOverlay/index.tsx:744-747`** — 把 `separatorOpacity` 的 `inputRange` 改为 `[0, 0.08, 1]`、`outputRange` 改为 `[0, 1, 1]`。其余插值不动。

3. **`src/components/player/PlayerOverlay/index.tsx:1019-1040`** — 把 `separatorStyle` 的 `left: 0` 改为 `left: 12`、`width: winWidth` 改为 `width: winWidth - 24`；`opacity` 与 `transform` 里的三个 `progress.interpolate` 原样保留（元素中心仍为 `winWidth / 2`，所以既有的 `translateX`/`scaleX` 落点不变）。

4. **`src/components/player/PlayerOverlay/index.tsx`** — 在 `artistTextStyle`（约 1064-1067 行）之后新增连接符的几何与样式：

   ```tsx
   // 静态底部栏是一整段 "歌名 - 歌手"，morph 层拆成两个盒子；把中间那段 " - " 补回来，
   // 收尾时才不会凭空跳出连接符
   var separatorRect = (0, require("./transition").getMorphSeparatorRect)(clampedTitleBarRect, clampedArtistBarRect);
   var separatorOpacity2 = progress.interpolate((0, require("./transition").getMorphSeparatorFadeConfig)(textMorphThresholds));
   var separatorTextStyle = {
     fontSize: artistFontSize,
     lineHeight: artistLineHeight
   };
   var separatorBoxStyle = {
     left: progress.interpolate({
       inputRange: textMorphThresholds,
       outputRange: [artistStart.x - separatorRect.width, artistStart.x - separatorRect.width, separatorRect.left, separatorRect.left],
     }),
     top: artistTop,
     width: separatorRect.width,
     height: artistHeight,
     opacity: separatorOpacity2
   };
   ```

   注意：`artistLeft` / `artistTop` / `artistHeight` / `artistFontSize` / `artistLineHeight` 都是本作用域内已有的 `progress.interpolate` 结果（`index.tsx:873-896`），`separatorRect` 用到的 `clampedTitleBarRect` / `clampedArtistBarRect` 在 `index.tsx:811-823`，`textMorphThresholds` 在 `index.tsx:391` —— 新增代码必须放在这些声明之后。局部变量名不要与已有的 `separatorOpacity`、`separatorStyle` 冲突（上面用 `separatorOpacity2` 只是为了示意，实际请命名为 `barSeparatorOpacity` / `barSeparatorStyle` / `barSeparatorTextStyle`，与顶部细线的 `separatorOpacity` / `separatorStyle` 区分开）。

5. **`src/components/player/PlayerOverlay/index.tsx:1145-1155`** — 在歌手那个 `showCoverMorph && ...` 元素**之后**、喜欢按钮那段 `{showCoverMorph && <>` **之前**，插入连接符节点，与歌手节点保持同样的 `pointerEvents` / 样式组合：

   ```tsx
   {showCoverMorph && musicInfo.singer ? (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
     pointerEvents: "none",
     style: [styles.morphTitle, barSeparatorStyle],
     children: (0, _jsxRuntime.jsx)(_reactNative.Animated.Text, {
       numberOfLines: 1,
       ellipsizeMode: "clip",
       style: [styles.morphText, barSeparatorTextStyle, { color: glassColors.muted }, textShadowStyle],
       children: ' - '
     })
   }) : null}
   ```

   （本文件是反编译还原的产物，JSX 编译形态混用 `(0, _jsxRuntime.jsx)` 与裸 JSX；与相邻节点保持同一种写法即可。）

6. **新增 `tests/overlayBarSeparatorMorph.test.mts`** — 覆盖两个纯函数，参照 `tests/overlayFullscreenActionTop.test.mts` 的结构（`import test from 'node:test'` / `import assert from 'node:assert/strict'` / 从 `../src/components/player/PlayerOverlay/transition.ts` import）：
   - `getMorphSeparatorRect({x: 100, y: 0, width: 200, height: 20}, {x: 321, y: 0, width: 80, height: 20})` → `{left: 300, width: 21}`。
   - 歌手与标题紧贴（`artist.x === title.x + title.width`）时 `width` 为 0。
   - 标题被夹取后歌手被推到标题右缘之外时（`artist.x < title.x + title.width`）`width` 仍为 0、不得为负。
   - `getMorphSeparatorFadeConfig([0, 0.05, 0.6, 1])` → `inputRange` 原样透传、`outputRange` 为 `[0, 0, 1, 1]`。

7. **`package.json`** — 在 `scripts.test` 末尾追加 `tests/overlayBarSeparatorMorph.test.mts`。

## Boundaries

- 只改 `src/components/player/PlayerOverlay/transition.ts`、`src/components/player/PlayerOverlay/index.tsx`、`package.json` 的 `scripts.test`，以及新增那一个测试文件。
- **不要**改 `src/components/player/PlayerBar/**`（`Title.tsx` 的测量层、`index.tsx` 的 `barVisibility`/`borderTopWidth` 都已正确，是 morph 层欠账）。不要为此新增第三个上报矩形或扩 `PlayerSourceLayout` 类型。
- **不要**改 `getCardMorphTransformRange`、`textMorphThresholds`、`TRANSITION_DURATION_MS`、`TRANSITION_SPRING_CONFIG`、`Easing.bezier(0.22, 1, 0.36, 1)` —— 动画时长与缓动不在本计划范围内。
- **不要**处理“超长歌名被 `clampedTitleBarRect` 夹取后歌手宽度归零”的问题（`index.tsx:810-823`）。那是另一处端点不一致，需要改夹取策略，另开计划。本次改动在该场景下会退化成 `width: 0`（连接符不画），不会新增崩溃或负宽度。
- **不要**动屏幕方向相关代码（本仓库 portrait-only：`AndroidManifest.xml` 的 `screenOrientation`、`src/navigation/index.ts` 的 `layout.orientation`）。
- **不要**改 `lx-music-mobile/lx-music-mobile-master/` 下的那份未跟踪副本，构建入口用的是根目录 `src/`。
- 不新增依赖。
- 若上述行号/代码与当前文件对不上（相对 commit 0ab47cd 已漂移），**停下来说明**，不要凭猜测改写。

## Verification

- **Mechanical**
  - `npm test` → 全部通过，且输出里能看到新增的 4 个断言用例（`tests/overlayBarSeparatorMorph.test.mts`）。
  - `npx tsc --noEmit` → 不新增错误（本文件历史上带 `@ts-nocheck` 类容错，只需确认没有引入新的语法/类型报错）。
  - `npm run lint` → 无新增 error。
- **Feel check（真机；adb 在 `E:\Android\Sdk\platform-tools`）**
  1. `npm run bundle-android` + 装机，或用 Metro 调试。
  2. 播一首**歌名和歌手都较短**的歌（例如 `Clarity (Radio Edit)` / `Vicetone` 这类），打开全屏播控页。
  3. **用慢速下拉手势**把进度拖到几乎贴底但**手指不松开**（progress 停在 ≈1，此时 morph 层仍在），截一张图；松手让动画结束、overlay 卸载后，再截一张图。两张图应当**完全一致**，尤其：
     - 歌名与歌手之间能看到 ` - `；
     - 播放栏顶部那条细线在两张图里都存在、且两端内缩量一致。
  4. 完整点“收起”按钮走一次自动动画，肉眼盯住最后 200ms：连接符与顶部细线不得在收尾瞬间凭空出现。
  5. 反向再来一次（点播放栏展开）：` - ` 与顶部细线应随卡片放大而淡出，全屏页上不残留任何 ` - `。
  6. 歌词页为起点再收起一次（`transitionOrigin == 'lyric'` 分支，标题/歌手从顶部小封面摘要出发），确认连接符同样在行程中淡入、收尾不跳变。
- **Done when**：步骤 3 的两张截图在 `x∈[640, 690]`、`y∈[230, 250]`（同一裁剪基准下）逐像素相同，且步骤 4/5 肉眼无跳变。可用如下脚本求差（把两张截图放到 `C:/Users/30913/Downloads/`）：

  ```bash
  python -c "
  from PIL import Image; import numpy as np
  a=np.array(Image.open('A.jpg').convert('L')).astype(int)
  b=np.array(Image.open('B.jpg').convert('L')).astype(int)
  print(int((np.abs(a[230:250,640:690]-b[230:250,640:690])>20).sum()))"
  ```

  期望输出 `0`。
