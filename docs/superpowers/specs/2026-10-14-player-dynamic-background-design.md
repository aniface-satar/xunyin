# 播放页"动态背景"设计（封面莫奈取色）

日期：2026-10-14　状态：已定稿，待实现
落地计划：`docs/superpowers/plans/2026-10-14-player-dynamic-background.md`

## 1. 要解决的问题

全屏播放页背景目前只认主题里那张用户手设的静态图（`theme['bg-image']`，见 `src/components/PageContent.tsx:38`、`src/components/player/PlayerOverlay/index.tsx:132`）。没有封面时整页就是 `c-content-background` 纯色，缺"这张歌的专辑感"。

诉求：背景跟随当前歌曲封面配色，同时**不能出现背景和前景字色混在一起看不清**。

## 2. 两条路线的取舍（已用小样对比过）

| 场景 | 动态取色（Material Palette vibrant） | 莫奈（HCT 色调阶梯 + 削饱和） |
| --- | --- | --- |
| 高饱和封面（落日） | 氛围强，但背景比封面还"燃"，歌词区要靠深色蒙版救 | 奶橘+灰紫，柔和耐看；进度条高亮点会偏淡 |
| 灰暗封面（雨夜） | 冷靛蓝仍有层次，白字对比够用 | 直接糊成灰白，第二行歌词几乎读不出 |

结论：**背景铺莫奈，动态取色只留给前景点缀（本次不做）**。莫奈的失效场景（灰暗封面发灰）由 §4 的"取最丰富色而非最大面积色" + tone 钳制来治。

## 3. 为什么选官方 Monet 链路而不是自己写

`@material/material-color-utilities@0.4.0`（纯 JS、零子依赖）里已经有完整链路，参数都是实测扒出来的：

- 取源色：`QuantizerCelebi.quantize(pixels, 128)` → `Score.score()` 取第一名
- `Score` 常数：目标色度 48、比例权重 0.7、色度高于/低于目标权重 0.3/0.1、**过滤色度 < 5 与占比 ≤ 1%**
- 关键性质：**取"最丰富"的颜色，不是"最大面积"的颜色** —— 灰底少量红会选红
- 源色 → HCT tonal palette（tone 0~100）→ 角色色；变体 `SchemeNeutral` 即"莫奈"观感
- 对比度不靠"取完手动压蒙版"，而是 `ToneDeltaPair`（成对角色强制 tone 差，大元素 > 40 / 小元素 > 50，并绕开 tone 50~59 尴尬带）+ `ContrastCurve`

项目侧的巧合：`src/theme/themes/utils.js:3` 的 `createThemeColors(primary, font, isDark)` 本来就是"一个主色 → 整套 `c-primary-dark/light` 阶梯"，与 HCT tonal palette 结构同构，未来若要整页换肤几乎免费。

## 4. 本次采用的方案

**三层分工，各层都能单独换掉：**

1. **Android 原生只给像素**：新 `PaletteModule` 下载/读本地封面 → `inSampleSize` + `createScaledBitmap` 降到 ≤128 边 → `getPixels` 吐 ARGB 数组。不带任何色彩逻辑，换算法不必重编 APK。
2. **色彩数学全在 JS**：`sourceColor.ts`（量化 + 打分 + 平均色）、`surface.ts`（tone 钳制 + 蒙版算法）。纯函数，`node --test` 直接单测。
3. **渲染只加三层 View**：铺底色 → 模糊封面（`blurRadius: 90`）→ 同色蒙版。

**不背景字色混淆的三道防线：**

- 前景字色**一律沿用 `useTheme()`**，禁止由封面色推导（硬约束）
- 底色 tone 锁在主题字色的对面：暗主题 ≤14、亮主题 ≥92，并迭代校验 `Contrast.ratioOfTones ≥ 4.5`
- 蒙版不透明度按"封面平均色与底色的 tone 差"算：`scrim = 1 - 8 / |Δtone|`，钳在 `[0.45, 0.9]`。白封面压暗底 → 蒙版变实；暗封面 → 允许透出。这是 `ToneDeltaPair` 的土法实现

**边界与回落：**

- 主题自带 `bg-image` 时优先用背景图，封面取色让路
- iOS 无自研原生模块 → 桥返回 `null`，功能自动关闭（本次不加 `.mm`）
- 取色失败 / 无封面 / 色度为 0 → 回落 `c-content-background`，与现状像素一致
- 默认关闭（`theme.dynamicBg = false`），老用户零感知
- 缓存：像素层按 URL 缓存、配色层按 `url|fontArgb` 缓存，各 60 条 + in-flight 合并

## 5. 已知风险

- `src/components/player/PlayerOverlay/index.tsx` 是**从 APK 反编译还原**的文件（无 TS 注解），改动只能做最小插入，且必须真机验 morph 过渡不被破坏
- 该包是 ESM（`"type": "module"`，`exports` 只暴露 `"."`）：只能从包根 import；Metro 0.80 能否打包需实测，兜底是 vendor 用到的几个文件
- 不引入渐变库（项目当前无 linear-gradient/skia），空间层次靠"模糊封面 + 同色蒙版"实现，不是真渐变

## 6. 验收（vivo 真机）

- 开关关闭：与改动前逐像素一致
- 开关打开 × {暗主题, 亮主题} × {高饱和封面, 灰暗封面, 无封面}：歌词/标题/按钮文字全部可读
- 切歌：背景在新歌开始播放后 300ms 内跟上；来回切同一首不重复下载
- 底栏 ↔ 全屏 morph 过渡中背景层跟随位移、不闪烁；歌词页长按"复制模式"的压暗逻辑不受影响
