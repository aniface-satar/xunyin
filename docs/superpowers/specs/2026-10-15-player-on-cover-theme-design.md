# 播放页"封面主题"（莫奈取色生效时的前景配色）

日期：2026-10-15 · 分支：`feat/music-recognition-phase1` · 状态：待实现

## 1. 要解决的问题

开关「播放页动态背景」（`theme.dynamicBg`）打开后，播放页背景换成封面莫奈取色的纯色底。
但页面前景（标题、歌手、歌词、按钮图标、进度条、面板）仍然读当前主题的字色：

- 暗主题字色 `rgb(219,219,219)` 落在莫奈底色上勉强能看；
- 亮主题字色 `rgb(66,66,66)` 落在同一支深色底上直接糊成一片，进度条轨道、按钮图标这类中间灰更是看不见。

用户提的形态经过三轮收敛，最终口径是：

1. 播控页的组件颜色**跟着封面走**（不再是主题灰），其他主页面**照旧用主题色**；
2. 跟色不能牺牲可读性 —— **「一定要保证文字按钮可读性」是硬约束**，与"跟封面走"冲突时让位给可读性。

所以这不是"换一套白字"，而是：**当动态背景生效时，播放页整棵子树换成一支由"用户真正看到的那层底色"推导出来的前景色阶，每个角色各自过 WCAG 闸门。**

## 2. 现有链路（改动前）

```
原生像素桥 getArgbPixels(picUrl) → { pixels, width, height }
  → analyzeArgbPixels(pixels) → { source, average }           // Monet 源色 + 全图平均色
  → buildCoverSurface(source, average, fontArgb) → CoverSurface | null
      CoverSurface = { base, scrimAlpha, band|null, tint }
  → resolveCoverBackdrop(dynamicBg, hasThemeBgImage, pic, surface) → { enabled, picUrl, surface }
  → useCoverSurface()  （每个组件各自 useState + useEffect）
  → CoverBackdrop（PlayDetail/Vertical）/ OverlayBackdrop（PlayerOverlay）画三层：
      base 铺底 → blurRadius=90 的糊封面 → surface.base × scrimAlpha 的蒙版
```

主题侧：`useTheme() = useContext(ThemeContext)`（`src/store/theme/hook.ts:38`），
每个 RNN 屏由 `registerScreens.tsx` 的 `<Provider>` 提供 context。
播放页前景色有两条来路：直接 `theme['c-*']`，以及 `useGlassColors()`（它也只是把 8 个 `c-*` 键起了别名）。

## 3. 两块必须先修的地基缺陷

### 3.1 闸门核错了参照物（既有缺陷，不是本次新增）

`buildCoverSurface` 用**全图平均色**估算"封面透出来多少"，但白字破线从来不是破在平均上，
而是破在**糊完之后仍然剩下来的那块最亮区域**。夹具实测（128×128，8×8 分块取块均色，读最亮块的 L\*）：

| 封面 | 全图平均 L\* | 最亮块 L\* | 差 |
|---|---|---|---|
| t16_sunset | 54.4 | 79.8 | +25.4 |
| t16_rainy | 38.6 | 64.2 | +25.6 |
| preview_cover | 48.1 | 89.3 | +41.2 |

锚点 40、蒙版 0.73 时：按平均色算白字 5.59（过闸），按最亮块算只有 **4.29**（破线）；
蒙版 0.55 时 3.33。也就是说**现在已上线的底色闸门对亮封面是系统性乐观的**。

本次改动把前景压到白，破线会从"看不见"变成"标题糊在亮块上"，所以必须先把参照物换成最亮块。

### 3.2 合成空间不是问题（排除掉的假设）

线性光 Y 混合（现算法）与 RN 的 sRGB alpha 混合在同一批夹具上相差 ≤1.4 个 L\*，
而且线性模型算出来的场**更亮** —— 即更保守。故保留线性 Y 混合，不换算法。

（附带一条踩过的坑：库里 `yFromLstar/lstarFromY` 的 Y 是 **0–100** 量纲。手写探针把 0–1 的 Y 喂进
`lstarFromY` 会静默得出 L\*≈2。`surface.ts` 自身两端都用库函数，内部自洽，线上代码没这个问题。）

## 4. 底色锚点：40 → 26（本次唯一会改变"背景观感"的数字）

在"白字必须 ≥4.5"与"要能分出灰（第二级字色）"两条同时成立的前提下，锚点是唯一变量。
按最亮块口径重算，三张夹具 × 三档锚点实测：

| 锚点 | 蒙版 | 最亮块上的场 L\* | 白字 | 第二级字色能拿到的最暗档 |
|---|---|---|---|---|
| 40 | 0.83–0.92 | ≈44 | 5.48–5.55 | **L\*92**（=只能和主字色一样亮，灰不存在） |
| 33 | 0.87–0.93 | ≈37 | 7.11–7.18 | L\*83 → 4.55 |
| **26** | 0.90–0.94 | ≈30 | 9.18–9.25 | **L\*77 → 4.93**，且图标色 L\*61 还有 3.0 |

选 **26**：只有这一档同时给得出"白 + 灰 + 一支带封面色相的高亮色"三层，
也就是用户要的「白,灰组合」。代价说清楚：

- 播放页底色比现在**明显更暗**（L\*40 → L\*26，场约 L\*30），封面透出来的比例被顶到 0.90–0.94，
  背景基本是"带封面色相的深色"而不是"看得见轮廓的糊封面"；
- "跟封面走"改由**前景色相**承担（灰与高亮色都带封面色相），不再靠背景透出；
- 亮主题用户在播放页也会看到深色页（墨色恒为白，见 §5.1）—— 这是设计意图，不是漏 case；
- 想退回旧观感只要把 `DARK_ANCHOR_TONE` 改回 40：底色照旧，但第二级字色会被闸门顶到 L\*92，
  层次消失（这是数学，不是实现差距）。小样 `.scratch/t64_sheet.png` 是三档并排的实测图。

### 4.1 真机复核后的修订：26 → 32（2026-10-15 晚）

装上真机后用户反馈"背景整体有点暗"。在同一张真机蓝封面夹具上重扫候选锚点
（`.scratch/anchor_probe.mts`，前景走生产的 `pickInkArgb`）：

| 锚点 | 蒙版 | 场 L\* | 白字对场 | 次级灰 / 图标 / 强调 | 歌词 |
|---|---|---|---|---|---|
| 26 | 0.93 | 30.8 | 7.41 | 77 / 75 / 78 | 63 |
| **32** | 0.92 | 36.5 | 6.01 | **83 / 83 / 83** | 69 |
| 36 | 0.92 | 40.3 | 5.21 | 88 / 88 / 88 | 74 |
| 40 | 0.91 | 44.3 | 4.63 | 93 / 93 / 93（=白字） | 79 |

取 **32**：底色亮 6 档，白字闸门还剩 6.0 的余量。代价说清楚 —— "灰 / 控件图标 / 强调"三档
在明度上并成同一层，只靠彩度区分（10 对 24 对 24）；白与它们之间还剩 9 个 L\*，够分开
"主字 vs 一切非主字"，分不开那三档彼此。想回到 §4 的层次就改回 26；40 以上连"灰"这一层都会消失。

## 5. 设计

### 5.1 取色基准：`ON_COVER_FONT` 恒定

`useCoverSurface` 不再传 `theme['c-font']`，改传 `ON_COVER_FONT_CSS = 'rgb(255, 255, 255)'`
（常量已在 `surface.ts` 里备好，注释指向本文件）。两个好处：

1. 底色闸门永远按白字算 —— 与"墨色恒为白"的实现一致；
2. 取色结果不再依赖主题，切主题不会让播放页底色重算一次；缓存 key 退化成"每张封面一份"。

`LIGHT_ANCHOR_TONE` 与 `band` 支（纹理）不删：`buildCoverSurface` 仍是可传任意字色的纯函数，
现有单测按亮/暗两种字色在跑它。

### 5.2 `CoverSurface` 交出"场"

```ts
interface CoverSurface {
  base: string
  scrimAlpha: number
  band: ToneBand | null
  tint: { hue: number, chroma: number }
  fieldTone: number   // 新增：最亮块上、蒙版合成之后用户真正看到的 L*，前景闸门对着它算
}
```

`buildCoverSurface` 签名改为 `buildCoverSurface(measure: CoverMeasure, fontArgb: number)`，
`CoverMeasure = { sourceArgb, averageArgb, highlightArgb }`。四个裸 number 参数极易把
"平均色"和"最亮块"传反（传反了不报错，只是悄悄变乐观），所以改成具名对象。

`analyzeArgbPixels(pixels, width, height)` 多返回 `highlight`：8×8 网格分块、块内求平均色、取 L\* 最大那块。
用"块均色"而不是"最亮单像素"，是因为 blurRadius=90 会把单像素极值抹平，块粒度才是糊完还剩的尺度。

### 5.3 前景角色表：`src/utils/monet/onCoverTheme.ts`（纯函数，无 RN import）

每个角色给 **目标 L\* / 目标彩度 / 对比下限**，实现是"从目标明度出发往远离场的方向逐格走，
每格内彩度从大到小退让，直到过闸门"（已在 `.scratch/t63_roles.mts` 验证过）。
色相来自 `tint.hue`（封面源色），所以"跟封面走"落在字色的调子上而不是落在灰上。

| 角色 | 目标 L\* | 彩度上限 | 下限 | 夹具实测 |
|---|---|---|---|---|
| `font` 主字色（标题/歌词当前行） | 92 | 18 | **4.5** | 7.50–7.56 |
| `label` 次级字色（时间/说明/小图标） | 77 | 10 | **4.5** | 4.93–4.98 |
| `accent` 控件图标（上/下/播放、选中态） | 74 | 30 | **4.5** | ≥4.5 |
| `primary` 歌词当前行/进度条已填充 | 78 | 34 | **4.5** | ≥5.5 |
| `lyric` 歌词非当前行（大字号） | 62 | 8 | **3.0** | ≥3.4 |
| `lyricSoft` 译文非当前行 | 56 | 6 | **3.0** | ≥3.0 |
| `panel` 卡片/面板底（`c-content-background`） | 场 + 7 | 10 | — | 略亮于页面 |

`lyric`/`lyricSoft` 用 3.0 而不是 4.5，是因为"非当前行有意压暗"是歌词页在**所有 17 套主题里**的既有设计；
它们是大字号文本，适用 WCAG 大字号 3:1 这一档。**主字色、次级字色、图标一律 4.5，不放宽。**

胶囊/选中底不打"深字浅底"这一对：播放页的 `c-button-background` 系是"浅色文字 + 半透明浅底"，
所以统一映射成 `rgba(primary, 0.16)` 的透光板，字色仍是 `accent`；实测板面约 L\*36，
accent L\*74 对其 ≥4.5。这样不需要任何组件改结构就能保住配对关系。

### 5.4 键映射（覆盖播放页子树实际读到的 22 个键）

键清单是脚本数出来的（`PlayDetail/Vertical`、`PlayDetail/components`、`PlayerOverlay`、`CoverBackdrop`
共 37 个文件里 `theme['c-*']` 的出现次数，再并上 `useGlassColors` 的 8 个键）。规则：

- 字色族：`c-font`/`c-primary-font`→font，`c-font-label`→label，`c-button-font(-selected)`→accent，
  `c-primary`/`c-primary-light-100`→primary，`c-350`→lyric，`c-300`→lyricSoft
- 半透明板/细线：`c-primary-alpha-200`→rgba(primary,.8)、`c-primary-alpha-900`→rgba(primary,.12)、
  `c-primary-light-100-alpha-700/-400`、`c-primary-light-300-alpha-800`、`c-primary-light-400-alpha-700`、
  `c-button-background(-hover/-selected/-active)`、`c-primary-background(-hover/-active)`
  → rgba(primary 或 accent, 0.10–0.30)
- 面：`c-content-background`→panel，`c-main-background`→base，`c-border-background`→rgba(label, .26)，
  `c-primary-dark-300-alpha-800`（文字阴影）→rgba(0,0,0,.24)
- 未列出的键：`{ ...theme, ...overrides }` 原样带过去。`bg-image` 不动 —— 主题带背景图时
  `resolveCoverBackdrop` 判 `enabled=false`，整个覆盖根本不发生。

`useGlassColors` **不改**：它读的键全在映射表里，context 一换它就自动对。

### 5.5 作用域：只换两棵子树

- **PlayDetail 屏**（RNN 独立屏）：在 `src/screens/PlayDetail/index.tsx` 用 `<OnCoverThemeProvider>` 包住
  `<PageContent>`。这一屏整棵子树（含 PlaylistSheet / MusicMoreSheet / LyricSettingSheet）一起换。
- **PlayerOverlay 展开态**：`PlayerOverlayProvider` 的返回是
  `<PlayerOverlayContext.Provider>{children}<PlayerOverlay/></PlayerOverlayContext.Provider>`（index.tsx:1407），
  overlay 与 children 是**兄弟**，所以只把 `<PlayerOverlay/>` 那一个元素包进 provider 即可，
  Home 整页不受影响 —— 这条是用户"其他主页面还是主题色"的直接落点，也是唯一动到反编译文件的地方
  （只加一层包裹，不重排、不补类型、不改名）。
- 折叠态的 `PlayerBar` **不换**：它坐在 Home 的主题背景上，白字会直接看不见；
  于是上滑转场时标题/图标会有颜色跳变，这是接受的代价（morph 只插值位置，不插值颜色）。

### 5.6 背景与前景必须同帧

`useCoverSurface` 现在是"每个组件各自 useState + 各自跑一次取色"。一旦前景也来自同一个 hook，
就会出现"背景已上色、前景还是主题色"（或反过来）的中间帧 —— 那恰好是可读性最差的瞬间。
所以把状态收进一个模块级 store：

```
src/utils/monet/coverBackdropStore.ts
  getSnapshot() / subscribe()          // useSyncExternalStore 用
  updateInputs(dynamicBg, hasThemeBgImage, picUrl)   // 同步发布 {enabled,picUrl}，必要时踢一次取色
  reset()                              // 供"动态背景"开关调用，与 clearCoverPaletteCache() 成对
```

`useCoverSurface` 改成 `useSyncExternalStore` 订阅 + effect 里 `updateInputs`，
决策表仍在 `backdropGate.ts`（仍能被 `node --test` 直接跑）。换歌时先同步把 surface 置 null
（沿用现有那条"别让上一张封面的色多刷一帧"的判据），再等新色到。

### 5.7 原生栏（状态栏/导航栏）

`pushPlayDetailScreen` 是在 push 那一刻从 `themeState.theme` 取色的（不走 context），
所以那里加一条：store 里有活跃 surface 时，`statusBar.style = 'light'`，
`navigationBar.backgroundColor` / `layout.componentBackgroundColor` 用 `surface.base`，否则原样。
仓库里没有任何 `mergeOptions` 先例，本次也不引入（RNN 在安卓上 merge 有闪烁风险）。
Home 的系统导航栏在 overlay 展开期间仍是主题色 —— 这是改动前就存在的边界（overlay 的背景框不铺到系统栏底下），不在本次范围。

## 6. 测试

新增/改动都进 `package.json` 的 `"test"` 显式列表（**package.json 改了不 commit**）。

1. `tests/monet-source-color.mts`：`highlight` 用例 —— 造一张左半黑右半白的像素图，
   断言 `highlight` 落在白侧、且 `average` 明显低于它（钉住"参照物不是平均色"）。
2. `tests/monet-surface.mts`：签名改 `CoverMeasure` 后全量重写调用点；新增
   "场 = 最亮块合成色，`fieldTone` 与手工算法一致"、"亮封面会把蒙版顶到 ≥0.85"、
   以及**把 `DARK_ANCHOR_TONE` 的断言从 `<=44` 改成贴当前暗锚**（§4 定 26，§4.1 真机复核后改 32）。
3. `tests/monet-on-cover-ink.mts`（新）：角色表纯函数 ——
   每个角色对三档极端场（L\*20 / L\*30 / L\*44）都 ≥ 自己的下限；
   彩度退让真的在退（黄封面 C\*34 会被夹到 ≤ 实测值）；非法入参返回 null。
4. `tests/monet-on-cover-theme.mts`（新）：拿 `src/theme/themes.ts` 里**全部 17 套主题**跑一遍 ——
   每个被映射的键都能被解析成颜色；字色族对它真正的依托面（页面用 `fieldTone`、面板用 panel）≥ 下限；
   未映射键保持原值（守住"其他页面/其他键不受影响"）。
5. `tests/monet-gate.mts` 不动（决策表未改语义）。

闸门：`npm test`、`npx tsc --noEmit`（src 基线 137 条）、
`npx eslint src/utils/monet src/components/player/CoverBackdrop --ext .ts,.tsx`、
`PlayerOverlay/index.tsx` 报错数必须仍是 88。
收尾**只构建不装机**（用户明确要求）。

## 7. 风险与逃生口

| 风险 | 处置 |
|---|---|
| 底色变暗是观感改动，可能不是用户想要的 | 单常量 `DARK_ANCHOR_TONE`；改回 40 即回到旧底色，代价是字色层次塌成全白（§4） |
| 播放页子树以后新增读 `theme['c-*']` 的组件，键不在映射表里 → 拿到主题色 | 映射表集中在一处、`tests/monet-on-cover-theme.mts` 的键清单可当查表用；新增键时同批补映射 |
| 前景与背景不同帧闪一下 | §5.6 的 store；实现完在真机按"切歌 20 次"复核 |
| 最亮块口径让蒙版普遍升到 0.90+，糊封面几乎不透出 | 与 §4 同源；接受，背景改由色相承担 |
| 取色的非确定性（上游 `quantizer_wsmeans` 用裸 `Math.random`） | 已用 `PALETTE_SEED` + 哨兵钉住（`sourceColor.ts`），本次新增的 `highlight` 走纯几何计算，不碰随机 |

## 7.1 真机缺陷：时有时无，翻开关才回来（2026-10-15 晚）

现象：播控栏 18:16 还是封面色，18:19 播放页回到主题白底；再去设置里翻一次「动态背景」就有了。

根因不是"取色算错"，是**失败被永久记住**。同一句"这张封面问过没有"分散在三层，三层各有一把永久闩：

| 层 | 原来的判据 | 后果 |
|---|---|---|
| `coverBackdropStore` | `requested: string \| null`（问过就算问过，成功失败都算） | 换回这首歌 / 重听这首歌都不再发第二次请求 |
| `coverPalette` 像素层 | 失败的 promise 按 url 永久缓存 | 一次原生超时 → 这张封面的像素永远拿不到 |
| `coverPalette` 配色层 | `cache.has(key)` 命中就返回那份 null | 同上，且和上一行叠起来是三层永久 |

而 `updateCoverBackdrop` 里 `isSame` 的早退又把"发请求"的触发一起跳过了 —— 于是
"该取色、手里没色、状态又没变"这种组合永远不再开口。代码注释当时是把这当**设计代价**写的
（"瞬时失败即整会话不再上色，出口是翻开关"），真机上它就是缺陷本身。

修复：三层都换成带期限的账。

- 新增 `src/utils/monet/attemptLedger.ts`（纯函数，能 `node --test` 直接跑）：
  一次尝试结束后隔 `ATTEMPT_COOLDOWN_MS = 15s` 可以再问；一条尝试在途超过
  `INFLIGHT_TIMEOUT_MS = 20s` 就当它没在途 —— 原生那个 4s 是**每次 read** 的超时不是总时长，
  慢速服务器能让 JS 这条 promise 永不 settle，不给期限就是把永久闩换个地方重写。
- `coverPalette.ts`：失败条目记落地时刻，过 `NEGATIVE_TTL_MS`（= 冷却 − 5s，由冷却推出来以保证
  "store 的重试点落在缓存层已过期之后"）就把这一格连同 LRU 顺序表里的位置一起摘掉，重新问原生。
  成功条目永不过期（同一张封面的色不会随时间变）。
- `coverBackdropStore.ts`：触发从 `isSame` 早退里搬出来，`arm()` 两种"现在不能问"都挂唤醒定时器
  （冷却剩余 / 在途剩余），`settle()` 在成功、失败、被代数丢弃、桥 reject 四条路径上都跑。

自愈时间线：瞬时失败 → 15s 后 store 醒 → 缓存层那一格已过期 → 重新问原生 → 拿得到就当场 publish。
单次取色慢于 5s 时落到第二个窗口（约 30s），仍然自己好。

代价要说清：老行为是"失败一次整会话不再问"，新行为是"每过一个冷却窗口重问一次"。
一张真坏的封面在被听的时候会被每 ~15s 问一次（一条几十 KB 的图请求，原生 4s 超时）。
翻开关仍然是有用的手动出口 —— 它立刻清账，不等窗口。

测试：`tests/monet-attempt-ledger.mts`（14 条，含跨文件的"冷却 > 保质期"不变量）、
`tests/monet-cover-palette.mts` 新增 2 条（窗口内不重复问、过窗后能拿到真色）。
验证缺口：`coverBackdropStore` 带原生桥、`node --test` 加载不了，那半（arm/settle/定时器）
只能真机看 —— 所以装机后要按"听歌时背景掉了别翻开关，30s 内自己回来"复核。

## 8. 明确不做

- 纹理支（`texture.ts` / `png.ts` / `band`）不动、不接线、不删除 —— 它带着那条有意红的测试，
  删除与否是另一件事。
- 横屏分支不做适配（AGENTS.md：本应用固定竖屏，横屏代码视为死代码）。
- 折叠态 PlayerBar、Home 其他页、其他 RNN 屏一律不换色。
- 不改 `navigationBar`/`statusBar` 的全局默认，只在 push PlayDetail 那一次取 store。
