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

## 7. 二次迭代：把"重度模糊封面"换成带云纹的柔光底色（2026-10-14）

落地计划：`docs/superpowers/plans/2026-10-14-player-cover-texture.md`

### 7.1 诉求与形态参照

用户给的两张参照图（`cover-tint-muted-comparison.png` / `cover-tint-vivid-comparison.png`）右侧那台 MONET 机的背景不是"糊掉的封面"，而是**带大理石/云烟纹路的柔光底色**：能看出走向、有颗粒、有几团云，但没有可辨认的封面物体。`blurRadius: 90` 那层做不到这个形状。

### 7.2 参照图不是靠眼睛读的，是量出来的

`.scratch/mock_struct.py`（16px 粗网格，把参照机背景场与封面场做皮尔逊相关）：

| 项 | muted 右机 | vivid 右机 |
| --- | --- | --- |
| 背景场 vs 封面场相关系数 r | 0.34（按 cover-fit 铺满最高） | 0.56（按 contain 补边最高） |
| 云团自相关长度 | ≈32px ≈ **屏宽 7%** | 同量级 |
| 颗粒噪声 / 低频幅度 | ≈ **30%** | ≈30% |
| 结构标准差（局部 8px 窗口） | 15.8 | 18.6 |
| 饱和度 | 8.8 | 32.0 |

结论订正了最初的计划：**纹理必须跟着封面自己的结构走**（r 0.34~0.56 说明形状来自封面），纯 seeded 噪声做不到；云团尺度是屏宽的 7%；还要叠一层颗粒。

### 7.3 这个栈里能用什么手段（先排除，再设计）

`package.json` 实测无 react-native-svg / skia / GL / fast-image ⇒ **没有混合模式、没有渐变基元**。所以唯一的实现路径是 **JS 在运行时生成一张位图**，交给普通 `<Image>` 放大铺满。生成物用 PNG：`pako`（HEAD `package.json:58` 已有 `^2.1.0`，Node ESM 具名 import 实测可用）+ 手写最小 PNG 封装（CRC32 + IHDR/IDAT/IEND）。

### 7.4 算法（小样 A，已用真机截图合成验收）

`.scratch/preview_texture.mts` 跑的就是最终算法，全程用仓库真实的色彩数学（`surface.ts` / `sourceColor.ts` / 官方 HCT）：

1. 封面像素先做半径 4（/128 网格）的箱形模糊 —— 只留最大的几块明暗团，否则背景变成"放大糊掉的封面"而不是氛围底色
2. domain-warp 采样：两路 6 阶 fBm（种子化 value noise，纯算术、无 `Math.random`）把采样坐标搅偏 `WARP=0.12`，得到云烟走向；`MARBLE=7` 个周期/纹理图宽 ⇒ 屏幕上云团 ≈ 屏宽 7% ✓
3. **秩归一（rank-equalize）**：把采样到的 tone 换成它在整张封面上的百分位，再映到合法色阶带。线性映射会被封面自身明暗比例压扁，实测结构对比只剩参照的一半
4. 封面结构与抽象云纹按 `COVER_WEIGHT=0.45` 混合，**混合值本身再做一次秩归一** —— 两个均匀百分位场直接一平均会往中间挤，实测带宽从 29 个色阶塌到 17
5. 彩度斜坡：`chroma = min(封面局部彩度, CHROMA_CAP) * (0.35 + 0.65 * (1 - n))` —— 参照图里越暗的云团越饱和
6. 132×294 RGBA → PNG → data URI，由 `<Image resizeMode="stretch">` 放大铺满（V8 实测 87ms；Hermes 上按 24 行分块让出 JS 线程）

几何映射最终取 **stretch**（整幅封面硬拉满屏），这是签字小样用的那个。参照图自己的最佳拟合是 cover-fit（muted）/ contain（vivid），stretch 是已知偏离 —— 形状对了，纵向比例被拉过。真机看过若不对味，改动点只有一处（`sampleCover` 的 `(u,v)` 映射）。

### 7.5 硬天花板：纵深买不到，是数学不是手艺

用户选的是"纹理照抄，但明度摆幅受对比度约束，字永远 ≥4.5:1"。`.scratch/band_probe.mts` / `gamut_probe.mts` 实测（字色取仓库真实的 `c-850`）：

| 主题 | 字色 tone | 合法色阶带 | 带宽 | 结构 std 上限（宽/√12） |
| --- | --- | --- | --- | --- |
| 16 个亮主题（`rgb(66,66,66)`） | 28.0 | [72, 100] | 28.0 | **8.1** |
| black 暗主题（`rgb(219,219,219)`） | 87.4 | [0, 36] | 36.0 | **10.4** |

- 带上界永远被 tone≤100（纯白）顶死，纵深只能从靠字色的那端挖，所以亮度纵深与可读性是同一笔账
- 参照图 15.8 / 18.6 需要带宽 54.8 / 64.4，对应暗端对比 **1.89 / 1.32** —— 比参照图自家文字（≈2.6:1）还低
- 把 `MIN_CONTRAST` 降到 2.6 也只买到 std 13.0，**仍然够不着**；所以本功能保持 `MIN_CONTRAST = 4.5` 不动（14 套主题的对比度成果零风险）
- 差额从不牺牲对比度的通道补：彩度对齐 vivid（实测候选 33.7 vs 参照 32.0）
- 暗主题纹理会比亮主题更深（10.4 vs 8.1），这是白色天花板造成的真实不对称，不是 bug

色阶带留 **0.1 的余量**（`BAND_HEADROOM`）：HCT→sRGB 有夹色域，实测在带边缘会掉约 0.005。细扫 1° 色相 × 彩度 0~36 × tone 0.25 步，亮主题 971,280 例、暗主题 1,244,880 例 —— 余量 0 时有 10 例破线（最差 4.495 @ hue 30 / c 32 / tone 71），余量 0.1 时**最差 4.632，破线 0**，代价只是带宽 29→28。因此纹理核心不需要逐像素修补。

### 7.6 顺带查出的已上线缺陷：取色不唯一

`analyzeArgbPixels` 实测**同一份像素 50 次调用出 5 种源色 / 4 种底色**（44 次 `rgb(255,244,192)`，1 次 `rgb(231,253,171)`，肉眼可见）。根因不在仓库里，是上游 JS 移植版：`node_modules/@material/material-color-utilities/quantize/quantizer_wsmeans.js:95` 用裸 `Math.random()` 给像素分配初始簇，即使 `QuantizerCelebi` 已经给了 Wu 的起始簇也照样跑；该函数注释写着 "reproducible results for the same inputs" 在 JS 版是假的。影响已提交的 Task 3/6/7（切歌/重进播放页底色会跳），纹理层会把它放大成"纹路每次重绘都变"。

修法（已定）：调用官方量化前后把 `Math.random` 临时换成固定种子的 mulberry32，**调用前用哨兵读回验证改写真的生效**（不生效就原样跑，不留半生效状态），并留一条 canary 用例盯着上游 —— 哪天上游改成确定性实现，这条用例的计数归零，就该删掉这层包裹。

### 7.7 本节的验收增补

- 模糊封面 + 蒙版只在**纹理还没生成好**时出现（拿到配色立刻铺色，纹理到了再换层）；纹理存在时**不再叠 `scrimAlpha` 蒙版**，否则 0.83 的蒙版会把刚做出来的纹路压平（这正是原来那层看起来"只是一片色"的原因之一）
- data URI 位图在 RN 0.73 Android 上能否真渲染：**本机未验证**，装机第一步就看它；不渲染就报告控制方，不自行改成 RNFS 落文件（那会换掉缓存设计）
- 同一首歌反复进播放页：底色与纹路都必须完全不变（这条同时验 7.6 的修复）
- 快速切歌不卡：分块生成期间 morph 动画不掉帧

## 8. 三次迭代：加"安卓原生取色"这条可选路（2026-10-16）

用户要求：保留莫奈取色，「动态背景」开开后下面再给两个选项 —— ① 莫奈取色 ② 安卓原生，并把原生那条真做出来。

### 8.1 接缝只切在"种子色从哪来"，不切在"底色怎么算"

现链路：`像素 → analyzeArgbPixels{source, average, highlight} → buildCoverSurface(tone 钳制 + scrim + MIN_CONTRAST 4.5) → 白/灰墨色`。

**原生只替换 `source` 一支；`average` 与 `highlight` 仍由 JS 从像素算。** 三条理由，按重要性：

1. 可读性保障整个建立在这两个量的定义上。已上线过的那次"底色 4.67 判过闸、屏幕上合成只剩 3.39"就是闸门核错了量（见 §7 与 `surface.ts` 的 `fieldTone`）。Java 再算一份同名不同义的平均色/亮块，等于把闸门的输入搬到测不到的地方 —— 本仓库**没有 JVM 测试设施**，Java 侧只能过编译 + 真机看。
2. 这样 `MIN_CONTRAST 4.5`、白+灰墨色表（`onCoverTheme.ts`）、蒙版算法全部不用改一行，两种取色共用同一套可读性，"一定要保证文字按钮可读性"这条不因换算法而重议。
3. **原生失败不可能导致"没有背景"**：像素本来就在手上，拿不到种子就用莫奈那支 `source` 顶上，不重发请求、不留空窗。

代价要说明白：16384 个 int 仍然跨桥（`average`/`highlight` 要靠它算）。省下的是 JS 侧 `QuantizerCelebi`（WSMeans 128 簇迭代）+ `Score` 那段**同步跑在 Hermes 主线程**的计算 —— 实测 `analyzeArgbPixels` 在 128×86 封面上 143ms、其中量化 123ms（见 §7 与 `coverPalette.ts:184` 那条注释）。所以这一支必须**真的不走量化**才算省：为此把"平均色 + 最亮块"从 `analyzeArgbPixels` 里拆成独立的 `measureArgbPixels`（那部分只有逐像素均值与 64 次 HCT 取 tone，是量化那 123ms 之外的小头）。

- `monet` 支：`measure` + 官方量化取 source —— 与现状逐字等价（`analyzeArgbPixels` 改为内复用 `measureArgbPixels`，对外行为与现有单测不动）
- `native` 支：`measure` + 原生种子当 source，**整段量化不跑**

### 8.2 数据流与回落矩阵

**种子与像素必须来自同一次原生调用。** 原因不是风格：`PaletteModule` 走的是自家 `HttpURLConnection`（`readBytes`），不是 Fresco 磁盘缓存，另开一个 `getPaletteSeed` 方法等于**同一张封面下载两遍**、还往那条唯一的单线程 executor 里压两次队列。所以桥的返回只多一个键：

```
getArgbPixels(url, 128) → { pixels, width, height, seed }
                                                    └ 无 swatch / 老 APK 缺键 → 该键不存在或为 0

getCoverSurface(url, fontColor, algo)
  ├ algo='monet'  → measureArgbPixels + 官方量化 → source = Monet 那支
  └ algo='native' → seed 有效 → measureArgbPixels + source = seed（量化不跑）
                  → seed 无效 → 整份退回 monet（即上一行）
```

`seed` 无效**不会**产生"没有背景"：像素这一路已经到手了，`average`/`highlight` 都在，只是退回用莫奈那支 source。所以种子也不需要同一条失败账（`pixelFailedAt` 管的是"这次调用整体失败"，种子缺失是这张图自己的性质，重问一百次也一样）。

回落矩阵（每格都必须是"看得见背景"或"与现状像素一致的纯色回落"，不允许第三种）：

| 情形 | 结果 |
| --- | --- |
| iOS / 非 Android | 桥整体返回 `null`，功能照现状关闭；选项行只在 Android 渲染 |
| 老 APK（返回里没有 `seed`） | `seed` 为 `undefined` → 判无效 → 走 monet，不出现"选了原生结果啥都没有" |
| 原生 `Palette` 全桶为空 / swatch rgb 非法 | `seed` 回 0 → 判无效 → 走 monet |
| 整次原生调用失败（下载/解码） | 与 monet 同路：`null` → 负缓存 `NEGATIVE_TTL_MS` → 过窗自愈（既有那套，不新写） |
| 种子值非法（非不透明 ARGB / 越界） | 判无效 → 走 monet |

### 8.3 缓存键加一个维度

- 像素层：仍按 `url`，且**一条 value 里就带着一份 `seed`**（两种算法共用同一份像素与同一个种子）。所以**取色层本身**切算法不需要重下封面、也不再问一次原生 —— 但界面上那条切换走的是 `clearCoverPaletteCache()`，它连像素层一起清空（那是翻开关"立刻清账"的既有语义），**实打实会重下一次封面**。要让切算法不重下，得把清理拆成"只清配色层"的一档；当下没做，代价只是切那一一下多取一张图。
- 配色层：`url|fontArgb` → **`url|fontArgb|algo`**。读写两处的 key 仍只由 coverPalette 里那一条式子生成（历史教训：只数 `fetchPixels` 次数的断言观察不到 key，改错分隔符 8 条用例照样全绿）。
- 切算法 = 复用翻开关那两行 `clearCoverPaletteCache()` + `resetCoverBackdrop()`，让 store 从 IDLE 重新发一次取色；不给 store 加第四个输入字段（`inputs`/`arm`/`settle` 那三条定时器都不用跟着改）。

### 8.4 原生侧契约

不给 JS 新增桥方法，只给 `getArgbPixels` 的返回 map 加一个 `seed` 键（int ARGB，`0xFF` 前缀；取不到 swatch 时给 `0`）：

- 在同一条单线程 executor 上、**在已有的那张 ≤128 降采样 Bitmap 上**跑 `Palette.from(bmp).generate()`，不重新下载也不重新解码。
- swatch 取值顺序：`vibrant → darkVibrant → lightVibrant → dominant → muted → darkMuted → lightMuted`，第一个非空即用；全空给 `0`（**不 reject** —— 那是这张图的性质，不是这次调用的失败）。
- 已有的 `getArgbPixels` 对外行为与自洽校验不得改变；`catch (Throwable)` → `reject` 那条保持不变；`finally` 里 `recycle` 要在 `Palette.generate()` 之后。
- `monet` 模式也会付一次 `Palette.generate()`（在 ≤128px 的位图上，毫秒级、且在原生线程不占 JS 线程）—— 这是"一次调用带两份产出"的代价。
- 依赖：`androidx.palette:palette:1.0.0`（Google Maven 实测 pom 可取 200；本机 gradle 缓存内**原本没有**该包，首次构建需联网）。

观感预期（写在前面，免得真机当成 bug）：`androidx.palette` 走 MedianCut + 自己的 vibrancy/luma 分桶，**偏"稳"**，没有 `Score` 那种"专挑画面里最跳的一块"的脾气（`TARGET_CHROMA=48`、色度 <5 全滤）。所以灰暗封面上原生那条大概率比莫奈更灰；而高饱和封面经过 §5 的彩度钳制（`CHROMA_CAP 24`）后差别主要在**选中哪一块**（色相），不在浓淡。最终以并排小样判观感。

### 8.5 设置页形态

复用仓库既有的两选项模式（`src/screens/Home/Views/Setting/settings/Basic/ShareType.tsx`：`SubTitle` + 横排两个 `CheckBox need`），不新增控件、不改观感语言：

```
☑ 动态背景（跟随封面配色）
   取色方式：  ● 莫奈取色   ○ 安卓原生
```

选项行只在总开关为开时渲染。新键 `theme.dynamicBgAlgorithm: 'monet' | 'native'`，默认 `'monet'`（老用户升级后看到的与现在完全一致）。

### 8.6 测试与验证缺口

- 新增 `tests/monet-native-seed.mts`（RED 先行）：① 种子替换 `source`、底色随种子色相走；② 种子 `null`/reject/非法 → 回落 monet 且仍出色；③ algo 进 key 后两份色互不污染；④ 切 algo 不重下封面（只数 `fetchPixels`）。
- `tests/monet-cover-palette.mts` 现有 28 条：`createCoverPalette` 的新参数一律给默认值，改动应接近零。
- **测不到的两处，如实记**：`coverBackdropStore`（import `./index` → 原生桥）与 Java 侧（无 JVM 测试）。Java 只能 `compileDebugJavaWithJavac` + 真机打印种子值与莫奈 source 对照。
- 闸门基线：`npm test` 510 项 / fail 恒 1（§7 那条故意的纹理红）、`tsc` total 137 / src 107 / monet 0 / PlayerOverlay 88、eslint 覆盖改动文件 exit 0。

### 8.7 代价与不动的东西

- 改 Java → 出包 ETA 6–8 分钟（纯 JS 增量是 2–3 分钟）；**必须重装 APK** 才有这条路。
- 渲染层零改动：`CoverBackdrop` / `OverlayBackdrop` / `PlayerOverlay/index.tsx`（反编译产物）这次都不碰。
- 竖屏约定无关；`theme['bg-image']` 存在时背景图优先那条让路规则不变。

### 8.8 落地状态（2026-10-16 当天）

代码已落地：`sourceColor.ts` 拆出 `measureArgbPixels`、`coverPalette.ts` 接 `algo`、`index.ts` 在边界读设置、`PaletteModule.java` 回传 `seed`、`build.gradle` 加依赖、设置页两选项、三语文案各 +3 键（716/716/716 对齐）。

与本节写法不一致的四处，都记下来免得下次照本节读代码：

1. **`algo` 是 `getCoverSurface` 的第 3 个入参，不是工厂的第 5 个参数。** 写本节时 `createCoverPalette` 还是 3 参；落地那天第 4 格已被 §9 的 `scheduleIdle` 占了，再加一格会让"注入时钟"和"算法"两个都不知位的参数互相顶，所以改成每次调用传。
2. **归一函数放在 `coverPalette` 里导出（`normalizeCoverAlgo`），由 `index.ts` 调用。** 脏值一律按 `monet` 走，`tests/monet-native-seed.mts` 里有一条专门钉它。
3. **纹理支内部那次 `load` 钉死 `'monet'`。** 纹理这条没接算法（`getCoverTexture` 的签名里没有 algo），行为与接线前一字不变。
4. **实测数字**：`tests/monet-native-seed.mts` 11 条（本节原写"4 类断言"，落地拆成 11 条）；`npm test` 586 项 / fail 1（仍是 §7 那条故意的纹理红）；`tsc` src 107、PlayerOverlay 88、`src/utils/monet/*` 0；`:app:compileDebugJavaWithJavac` BUILD SUCCESSFUL，`androidx.palette:1.0.0` 已进本机 gradle 缓存。

**实现期查清的一处（原本以为是风险）**：JS 那道 `(seed >>> 24) === 255` 会不会把安卓种子全判成无效、让"安卓原生"静默等于"莫奈"？拆开 aar（`javap -c`，1.0.0 里只有 `ColorCutQuantizer` / `Palette` / `Palette$Builder` / `Palette$Filter` / `Palette$Swatch` / `Target*`，没有旧 support 版那个直接读位图的 `PaletteGenerator`）逐个看 `mRgb` 的来源：

- `Swatch(int color, int population)`：`mRgb = color` 原样存 —— alpha 取决于传进来的那个色
- `Swatch(int r, int g, int b, int population)`：`mRgb = Color.rgb(r,g,b)`，恒 `0xFF` 前缀
- `Swatch(float[] hsl, int population)`：先 `ColorUtils.HSLToColor(hsl)` 再走第一条，而 `HSLToColor` 给的 alpha 恒 255
- 第一条那个"原样存"的色，来自 `ColorCutQuantizer`，而它唯一的出色路径是 `approximateToRgb888(int,int,int)` → `Color.rgb(III)` —— 同样恒 255

所以种子到 JS 手上一定是 `0xFFRRGGBB`，alpha 闸门只会挡掉哨兵 `0` 和"键不存在"（老 APK），挡不掉真色。**这是静态读字节码得到的结论，不是真机跑出来的**：真机那一步要看的仍然是"同一张封面、两种算法的底色确实不一样"，以及灰暗封面上原生那条是否如 §8.4 所说更稳（不那么跳）。

**真机回来后的一条对账（2026-10-16 晚，用户："有些封面两个效果看起来就是一样的"）**：先排除"没装上新包"—— 装机判据用 `adb pull /data/app/…/base.apk` + `sha256sum` 与本地 `xunyin-v1.1.0-arm64-v8a.apk` 逐字节比（versionCode 不涨，只看 `lastUpdateTime` 会误判）；同一次核对里 Java/JS 两侧的接线都读了一遍，`seed` 从 `putInt` 到 `CoverPixels.seed` 到 `source: seed` 全程无损，`CoverFields` 只有 `average/highlight`，展开顺序不会把种子盖掉。

结论是**这条链路本来就只能差色相**：明度走锚点（暗 32 / 亮 78）与种子无关，彩度 `min(source.chroma, 24, max(6, 0.65×封面平均彩度))` 多数封面由第三项 binding、也与种子无关。`.scratch/t75_hue_sweep.mts`（三张真封面 × 两支墨色，只改种子色相、其余照公式走）实测 RGB 欧氏距离：

| 封面（最终彩度） | Δ10° | Δ20° | Δ40° | Δ80° |
| --- | --- | --- | --- | --- |
| 落日 · 深墨（22.1） | 6.2 | 12.5 | 22.5 | 34.9 |
| 雨夜 · 深墨（7.6） | 2.0 | 3.3 | 5.2 | 11.4 |
| preview · 浅墨（10.9） | 3.7 | 8.3 | 16.7 | 30.0 |

`Score` 与 `androidx.palette` 的 vibrant 都在同一张图里追饱和块，选中的色相通常落在同一家族（几度到二十度），落进上表就是"看不出差别"；只有双色构成、或两支各挑走一边的封面才分得出来。**要让两档在任何封面都明显不同，得动的是彩度那一项（§5）而不是取色器** —— 那属于改观感，不在本次范围。用户已按"有些封面本来就一样"接受。

## 9. 四次迭代：把取色量化挪出展开动画（2026-10-16）

用户报的两种卡顿，同一条根因的两种撞法：

- 拖动控制栏到全屏的**过程中**颜色算出来了 → 卡一下
- 切了歌、颜色还没到，**点击**控制栏到全屏 → 卡约 0.8 秒

### 9.1 根因：那 143ms 是同步的，而补间也住在 JS 线程

`.scratch/quantize_cost_probe.mts`（桌面 V8，构造多色噪声封面以逼出真实簇数）实测：

| 像素（原生默认回 128 边长） | `analyzeArgbPixels` | 其中 `QuantizerCelebi` + `Score` |
| --- | --- | --- |
| 128×86 | **143.0ms** | **123.6ms** |
| 128×128 | 110.6ms | 74.8ms |
| 64×64 | 51.2ms | 35.2ms |

另外两步都不是大头：分块最亮块 1.8~2.7ms，把 16384 个数摊平成数组 0.5~1.1ms。真机 Hermes 还要慢几倍。

撞上的那段时间窗：morph 补间是 `useNativeDriver:false`、`TRANSITION_DURATION_MS=800`，帧帧都要 JS 线程参与 —— 于是"色到手的那一刻"把动画饿死。紧随其后的 publish → 播放页子树重渲染 → 新的 `blurRadius=90` 图层挂载挤在同一瞬间，所以把计算推后就等于把这三件事一起推后。

### 9.2 交互句柄只缺一半，补的是那一半

- **拖拽那一半 RN 已经给了**：`PanResponder.js:466` 在 onGrant 时 `createInteractionHandle()`，`:569` 在 release/terminate 时归还。所以拖动期间 `runAfterInteractions` 的排队本来是压住的。
- **补间那一半没人给**：`Libraries/Animated/`（`Animation.js` / `animations/*.js`）里没有任何 InteractionManager 调用。所以 `PlayerOverlay.animateTo` 自己在 `animation.start` 前登记、在回调里归还。
- 归还必须是回调**第一行**：外部 `stop()` 也会走进这条回调（`TimingAnimation.js:173-178` 的 `__debouncedOnEnd({finished:false})`），而下面第一句就是 `if (!finished) return`。句柄漏还一次 = 全局 `runAfterInteractions` 永久饿死（本仓库另一处用法 `ListMusicSort.tsx:75` 会一起中招）。卸载路径靠 `index.tsx` 那条 unmount 里的 `animationRef.current.stop()` 兜住。
- 一个查过才敢写的时序细节：release 时 PanResponder **先**归还自己的句柄、**再**调我们的回调（`PanResponder.js:562-575`），中间不会有缝让排队的活钻出去 —— 默认 `_deadline = -1` 时 `_scheduleUpdate` 走 `setImmediate`，增删集合在下一次 `_processUpdate` 里一起结算（`InteractionManager.js:180-196`），而我们那次 `createInteractionHandle` 与它同批同步。

### 9.3 落地形态：判据住纯模块，跑法靠注入

- `src/utils/monet/analysisGate.ts`（**不许 import react-native**）：idle 与 `ANALYSIS_IDLE_FALLBACK_MS = 1500` 的兜底期限赛跑，只许赢一次，谁赢谁撤掉另一边；task 抛错必须 reject（挂住不清会把整条取色链卡死）。兜底定时器存在的原因是 `InteractionManager.setDeadline` 是全局的，动它会连累 `ListMusicSort`。
- `coverPalette.ts`：第 4 个注入参数 `scheduleIdle`，默认值是"立刻跑"（既有 28 条用例与没接线的纹理支行为一字不变）；`load()` 里 `analyzeArgbPixels` 那一步改成 `await scheduleIdle(...)`，位置在 `fetchOnce` **之后** —— 像素那条 promise 已经进缓存，等调度器期间不会重问原生。
- `monet/index.ts`：全模块唯一允许 import react-native 的那层，把 `InteractionManager` / `setTimeout` / `clearTimeout` 注进 runner。
- 测试：`tests/monet-analysis-gate.mts` 5 条（假 InteractionManager 把两条路的竞态跑完）+ `tests/monet-cover-palette.mts` 第 29 条（调度器扣住时不落地、像素只问一次；放行后正常出色）。闸门：`npm test` 561 项 / fail 恒 1（§7.7 那条纹理红是故意的）、`tsc` total 137 / src 107 / monet 0 / PlayerOverlay 88、eslint 改动文件 0。

### 9.4 否掉的两条捷径

- **把量化搬原生**（§8 那条路顺带就能做到）：JS 侧的确定性包裹（§7.6）和那 28 条用例全部失效，iOS 还没有对应物。留作 §8 的附带收益，不作为这次的修法。
- **把 `maxSize` 从 128 调小到 64**：确实省一半时间，但换掉的是"采样到哪几个色"，属于借卡顿之名改观感。

### 9.5 代价与真机清单

卡顿换成"颜色在卡片落定之后才到"（约 800ms 那一刻），底色那层再走它自己的 110/340ms 淡入 —— 观感上是"展开干净、颜色随后浮现"，不是"展开途中慢慢染上"。真机判的清单：

1. 拖控制栏到全屏：中途不该出现颜色，整段拖动 + 展开没有掉帧感
2. 切歌后立刻点控制栏：不该有约 0.8 秒的停顿，颜色在卡片停稳后浮现
3. 颜色落定后再翻歌词 / 滚动列表不卡
4. 关掉「动态背景」：展开收起与改动前一致（句柄照样登记，但那一刻没有后台活可扣）
5. 同一首歌反复进播放页，底色与纹路完全不变（§7.6 那个成果不回退）
6. 快速连播数首：`preloadNextMusic` 的 `palette` 步也走同一个闸门，预热那 143ms 不再落在滑动列表中间

---

## 10. 五次迭代：删掉莫奈，第二档改成「重度模糊封面固定铺底」（2026-10-16）

用户要求原文：**把莫奈取色的相关逻辑代码全部删除，设置里的第二个选项改成"动态取色＝重度模糊封面固定铺底"**。
§7（云纹纹理）、§8（原生种子那条 seam 的莫奈半支）、§9（把量化挪出展开动画）里被这次删除作废的部分**保留原文不回改**，
只在下面声明作废范围——那三段记录的是"当时为什么那样做"，删代码不等于删结论。

四条留白的决定按用户给的三把尺子裁定：**资源占用最少 / 切换加载时间最短 / 显示结果最优**。

### 10.1 两档的新形状

| 档 | setting 值 | 背景是什么 | 默认 |
| --- | --- | --- | --- |
| 安卓原生取色 | `'native'` | androidx.palette 给的种子色，压暗成一块**纯色**铺底；不画模糊封面 | 否 |
| 动态取色 | `'blur'` | **重度模糊的封面图本身固定铺底**，上面压一层由封面平均色压暗得到的蒙版 | **是** |

- `'monet'` 这个值从域里消失；`normalizeCoverAlgo` 把老用户存的 `'monet'`（以及任何不认识的串）归一到 `'blur'`。
  归到 `'blur'` 而不是 `'native'`：①是"这次才真正做对"的那一档，②是新默认，老设置里那半吊子的莫奈色没有任何理由继续留着。
- **①彻底不透封面**（`scrimAlpha` 恒为 1，糊封面那一支整支不渲染）。这是 §8.8 那个"两档看起来一模一样"的直接修法：
  色相是种子色唯一还活着的通道，光换种子换不出区分度，那就把差异放到"看不看得到封面"这条通道上。
- ② 的取色种子失败（原生没给 swatch、老 APK 没这个键）→ **退到②的形态而不是"没有背景"**：
  ② 本来就不依赖种子，只需要封面平均色（JS 算）与那张图。① 拿不到种子时同样退到 ②。
- ② 的前景只做**白 + 灰**，不再有带封面色相的强调色，也不会中途翻色相。
  理由：色彩由糊封面自己提供（那才是用户要的"显示结果最优"），再叠一层取色来的色相就是两套语言；
  而且删掉 HCT 之后没有可靠的"同色相摆明度"工具，用 sRGB 缩放自己造会得到发灰的强调色——那是造色，不是跟色。

### 10.2 三把尺子怎么裁的

- **资源最少**：删掉 `@material/material-color-utilities` 的全部引用（源码里只有 4 个文件用它）、整条量化、
  纹理支（`texture.ts`/`png.ts`/`pako.d.ts`）和 §9 那套 idle 调度（`analysisGate.ts` + `InteractionManager` 接线）。
  取色耗时从实测 143ms 降到 2ms 级别，于是"颜色要排在交互空档"这个问题连它的答案一起消失。
  **不新增任何 npm 依赖**：RN 安卓的 `blurRadius` 本来就是成熟链路
  （`ReactImageView.java:222-228` 把它交给 Fresco 的 `IterativeBoxBlurPostProcessor(2, r/2)`，解码期后处理 + 结果进缓存，不是每帧的活）。
  解包看过的 `@react-native-community/blur`、`expo-blur`、`react-native-blurhash`、Skia 系都是"给实时内容糊一块玻璃"，
  不是"把一张图糊了当墙"——那些解决的是另一个问题。
- **切换加载最短**：② 一决定铺这张封面就**立刻发布一支保守的背景**（`base` 用中性深灰、`scrimAlpha = 1`，
  等于先铺一块不透明的深色），原生像素桥回来后再把蒙版放松到封面真能透出来。
  保守那一档不是偷懒：糊完的最亮块可能接近纯白，白字要对它过 4.5，唯一数学上稳的起点就是全遮。
  观感顺序因此是"深色底瞬间到位 → 封面浮现"，而那张图走的还是 Fresco 磁盘缓存（播放页卡片刚用过它），不额外下载。
- **显示结果最优**：糊底保留封面自己的色相与轮廓（这是莫奈纯色底永远给不了的），蒙版色由**封面平均色在线性光里压暗**得到，
  所以暗下来的是同一支颜色，不是一块灰纱。压暗倍数与蒙版透明度都按 0.01 的格点搜，证书核的是合成之后那一层。

### 10.3 删除清单与新的模块边界

删除（连同各自的用例）：`texture.ts`、`png.ts`、`pako.d.ts`、`analysisGate.ts`、`sourceColor.ts` 里的
`analyzeArgbPixels`/`QUANTIZE_COLORS`/`CoverAnalysis` 与那层 `withSeededRandom`（§7.6 的确定性包裹只为量化而存在，
它随之失效——`monet-tone-band`/`monet-png`/`monet-texture`/`monet-analysis-gate` 四条测试文件一起消失，
**那条故意红的用例没了，`npm test` 的 fail 从 1 变 0**，§7.7 的记录同时作废）。

`npm` 包 `pako` **留着**：Backup/Sync/Other 几处界面和 musicSdk 的解码器在用，与纹理支无关。

新的边界（每个文件只做一件事）：

- `lstar.ts`（新增，纯数学、不许 import 任何东西）：sRGB↔线性、`lstarOf(argb)`、`contrastRatio(a, b)`、
  `lstarToChannel`、`shadeArgb(argb, factor)`（线性光按倍数压暗，色相逐通道保持）、`cssRgb`/`parseCssColor`。
  这是原来由 `Contrast` + `Hct` 承担的那一小块，约 20 行。
- `sourceColor.ts`（缩到测量）：`CoverPixels`（含 `seed?`）、`CoverFields{average, highlight}`、`measureArgbPixels`、`BLOCK_GRID`。
- `surface.ts`（两块 builder，不再有 HCT/色阶带/`tint`）：
  - `CoverSurface = { mode: 'native'|'blur', base: string, scrimAlpha: number, fieldLstar: number }`
    （`fieldTone` 改名 `fieldLstar`：HCT 的 tone 本来就是 L\*，换了实现就换个诚实的名字）
  - `buildNativeSurface(seedArgb, fontArgb)`：`factor` 从 1 往下按 0.01 搜，第一个让白字过 `MIN_CONTRAST` 的就交；
    搜穿到 0 仍不过 → null。`scrimAlpha` 恒 1、`fieldLstar` 就是 base 自己的 L\*。
  - `buildBlurSurface(measure | null, fontArgb)`：`measure == null` 交保守那支；有测量时
    `base = shadeArgb(average, BLUR_BASE_SHADE)`（起步 `0.15`：中等亮度的封面平均色压到 L\*20 上下，
    蒙版自己就先是一块够暗的色而不是黑，具体深浅留作真机调的观感参数），`scrimAlpha` 从 `BLUR_SCRIM_MIN`（起步 `0.55`，沿用 §4 那个"最少透出量"）
    起按 0.01 往上顶到 `contrastRatio(white, field) >= MIN_CONTRAST` 为止（`field` 按 sRGB 通道混，理由仍见 §7.4：RN 的 alpha 混合就在编码值上做）。
- `coverPalette.ts`：`CoverAlgo = 'native' | 'blur'`，缓存键仍是 `url|fontArgb|algo`；① 的产物不需要 `measure`，
  ② 需要；两种子都只要一次像素请求。
- `backdropGate.ts` / `coverBackdropStore.ts` / `useCoverSurface.ts`：状态里**带上模式**。
  这是接口变更，不是加字段凑合：② 必须能在"还没有色"的时候就发布铺底（那张图不需要色就能画），
  所以表要多知道一件事——这一档到底需不需要等取色。
- `CoverBackdrop/index.tsx`：糊封面那一支加 **overscan**（`transform: [{ scale: 1.25 }]`）。
  Fresco 的框糊在边缘读到图外，会留一圈发暗/半透的边；`StyleSheet.absoluteFill` 摆着就把那条边贴在屏幕内缘，
  正是 §2 里当年"重度模糊"翻车的原因。用 GPU 变换放大而不是把 View 撑大：不重排、多出的只是采样。
  `scrimAlpha >= 1` 时那一支整体不渲染（① 的省法）。
- `onCoverTheme.ts`：`pickInkArgb(hue, role, chromaCap, backing)` 换成 `pickGreyLstar(targetLstar, backingLstar, min)`
  —— 从角色目标 L\* 出发朝远离依托面的方向逐整数格走，直到过 `min + INK_HEADROOM`；灰的对比度与同侧纯白/纯黑同档，
  所以依托面只要过了白字那道闸，这里最坏也只是层次塌成全白，不会返回失败。角色表的数值（92/77/74/78/62/56 与面板 -6）一个不改。

### 10.4 真机清单（这次要判的）

1. 设置里两行读作「安卓原生取色 / 动态取色」，默认打在**动态取色**上；老安装升级后第一次进播放页就是动态取色。
2. 动态取色：深色底瞬间到位，随后封面轮廓浮现；全程白字可读（亮封面尤其要看歌词非当前行那两档）。
3. 安卓原生取色：整屏是一块纯色，**看不到封面的轮廓**（这是两档的区分度，回退就是没做成）。
4. 两档来回切：不许出现"整屏主题底闪一下"，也不许卡在上一首的底上。
5. 全屏↔播放栏展开收起：糊封面那一圈边缘不许露出来（overscan 的判据；重点看横竖比例异常的封面）。
6. 切歌、快速连播：糊底的图不走第二次网络请求（同一张封面卡片刚用过）。
7. 展开动画里没有卡顿感——这次是"根本没有 143ms 那段活"，不是"把它排到了空档"。
8. 关掉「动态背景」：与改动前逐像素一致。
9. 没有封面的歌：不该有背景层（不是铺一块保守深灰）。
10. 长条/极扁的畸形封面图：不崩、不整屏黑（`measureArgbPixels` 的空块回落仍在）。

### 10.5 留给真机之后的第二条路

若真机上内置 `blurRadius` 糊出来有色带/断层（8bit 图糊 90 半径是有可能出的），升级办法是**原生出图**：
`PaletteModule` 已经握着那张 ≤128px 的 ARGB_8888 位图，行业做法是"先降采样→再糊→放大贴回去"，
把它糊完写成 cacheDir 里的一张 JPEG、走 `file://` 交给同一个 `<Image>`。这条不改任何判据与状态形状，
只换图片来源，所以不预先做——它属于"内置糊不行"之后的一步，不是这次的一部分。
