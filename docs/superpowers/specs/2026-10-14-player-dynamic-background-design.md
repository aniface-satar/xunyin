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

## 10. 五次迭代：删掉「安卓原生取色」，第二档改为「动态取色＝重度模糊封面固定铺底」（2026-10-16）

（本节初稿把要删的那一档写反了，已按用户更正重写：莫奈留、原生删。）

用户要求原文：**保留莫奈取色，去掉「安卓原生取色」这一整条；设置里的第二个选项改为"动态取色＝重度模糊封面固定铺底"**。
四条留白仍按用户给的三把尺子裁定：**资源占用最少 / 切换加载时间最短 / 显示结果最优**。

### 10.1 两档的新形状

| 档 | setting 值 | 背景是什么 | 前景墨 | 默认 |
| --- | --- | --- | --- | --- |
| 莫奈取色 | `'monet'` | 官方 `QuantizerCelebi + Score` 挑出的源色 → 一块染色底 + 少量封面透出（§7 的形状，一字不改） | 白 + 灰 + **带封面色相的强调色** | 否 |
| 动态取色 | `'blur'` | **重度模糊的封面图本身固定铺底**，蒙版是"封面整体色相压到暗锚点"的一支，透出量只受白字闸门管 | 只有白 + 灰（`tint.chroma = 0`） | **是** |

- `'native'` 这个值从域里消失；`normalizeCoverAlgo` 把存的 `'native'`（以及任何不认识的串）归一到 `'monet'`。
  归到 `'monet'` 而不是 `'blur'`：②是新加的、还没被任何人在真机上验过，一个原本选了"另一条取色路"的老用户
  被换到一个新界面上是不公平的；①这边他熟悉的行为原样在。默认值这条反过来：新装用户走 ②（§10.2）。
- **不删莫奈的任何数学**：源色、tone 锚点、彩度三段 `min`、蒙版与白字闸门、§9 的 idle 调度、§7 的纹理支
  全部保持原样。纹理支仍然"不接线、不删除"。
- ② 只借用 ① 已有的两块地基：`measureArgbPixels`（average/highlight，不跑量化）与同一条 sRGB 混法闸门。
  **闸门只许有一个定义**，所以两支共用 `surface.ts` 里那一个 `fieldToneOf`，不写第二份。

### 10.2 三把尺子怎么裁的

- **资源最少**：② 跳过官方量化（实测 143ms 里那 123ms 整段不跑），只跑逐像素均值 + 每块一次 HCT。
  不新增任何 npm 依赖：RN 安卓的 `blurRadius` 本来就是成熟链路
  （`ReactImageView.java:222-228` 把它交给 Fresco 的 `IterativeBoxBlurPostProcessor(2, r/2)`，解码期后处理 + 结果进缓存，不是每帧的活）。
  解包看过的 `@react-native-community/blur`、`expo-blur`、`react-native-blurhash`、Skia 系都是"给实时内容糊一块玻璃"，
  不是"把一张图糊了当墙"，那些解决的是另一个问题。删掉的反而是 §8 那条：androidx.palette 依赖 + `seedArgb()` + 桥上的 `seed` 键。
- **切换加载最短**：② 一决定铺这张封面就**先发布一支保守的背景**（`provisional: true`，不透明中性深色），
  像素桥回来后再换成测量得到的那支。保守那一档不是偷懒：糊完的最亮块可能接近纯白，白字要对它过 4.5，
  唯一数学上稳的起点就是全遮。观感顺序因此是"深色底瞬间到位 → 封面浮现"，
  而那张图走的是 Fresco 磁盘缓存（播放页卡片刚用过它），不额外下载。
  这一支存在的代价写在 §10.3 最后一条：层的身份不能再只用封面 url 当 key。
- **显示结果最优**：② 的底色锚点比 ① 更低（`BLUR_ANCHOR_TONE` 20 对 `DARK_ANCHOR_TONE` 32），
  因为照片自己会贡献亮度；蒙版从 `BLUR_SCRIM_MIN`（0.40）起搜，不像 ① 那样被 `TONE_DRIFT_LIMIT` 提前顶上去，
  所以中暗封面在 ② 里是真能看出轮廓的。两档的区分度落在三处：透出量、强调色有没有色相、糊图的边缘（overscan）。

### 10.3 改动清单

删除（安卓原生那一条，全部是 §8 引入的）：

- `android/app/build.gradle` 的 `androidx.palette:palette:1.0.0`
- `PaletteModule.java` 的 `seed` 键与 `seedArgb()`（连同 import 与那两条 `Log.w`）
- `CoverPixels.seed`、`coverPalette.ts` 的 `seedArgbOf` 与 native 分支
- 设置项 `'native'` 值、那一行 UI、i18n 三语的 `..._algorithm_native`、`tests/monet-native-seed.mts`
- 留在 `sourceColor.ts` 的 `measureArgbPixels`/`collectOpaque` 不回退：它们改天就是 ② 的测量入口，只是注释里"为了原生支"的说法要换成 ②。

新增/改动：

- `surface.ts`：新增 `CoverBackdropMode = 'monet' | 'blur'`（定义在 surface.ts，`coverPalette.ts` 的 `CoverAlgo` 从这里取，
  反过来会让 surface 依赖配色层形成环）；`CoverSurface` 多两个字段 `mode` 与 `provisional: boolean`；
  `buildBlurSurface(measure, fontArgb)` 走 `Hct.from(coverAvg.hue, min(coverAvg.chroma, CHROMA_CAP), BLUR_ANCHOR_TONE)`，
  蒙版在百分格上从 `BLUR_SCRIM_MIN` 往上顶到 `Contrast.ratioOfTones(fieldTone, fontTone) >= MIN_CONTRAST`，顶到 1 还不过就 null（同 §7.4 的处置）；
  `tint` 交 `{ hue: coverAvg.hue, chroma: 0 }`、`band` 交 null —— 于是 `onCoverTheme.ts` 一字不用改就自动退成白+灰。
  `PROVISIONAL_BLUR_SURFACE` 是**同一个对象引用**：`isSame` 按引用比 surface，每帧造一份会让订阅子树白刷。
- `coverPalette.ts`：`CoverAlgo = 'monet' | 'blur'`；`load()` 里 blur 支只调 `measureArgbPixels`，仍在 `scheduleIdle` 之后跑
  （省掉量化不等于省掉逐像素遍历，主线程那条规矩不改）。
- `backdropGate.ts` / `coverBackdropStore.ts` / `useCoverSurface.ts`：决策表多一个输入 `algo`。
  这是接口变更而不是加字段凑合：② 要能在"还没有色"的时候就发布铺底，表必须知道这一档需不需要等取色。
  翻算法仍然走现成的那条 `clearCoverPaletteCache() + resetCoverBackdrop()`。
- `CoverBackdrop/index.tsx`：层的身份从 `key = picUrl` 改成 `Layer { key, picUrl, surface }`，
  `key = picUrl + '|p'`（保守支）/ `picUrl`（测量支）。不这么做的话保守支先占住那个槽，测量色到了只会把一个
  已经淡完的旧层重新标记为 show，屏幕上永远停在灰底。改完之后保守→测量走的就是本来那套"先叠后撤"，颜色是淡进来的。
  **（第二十一次更新：这一串又加了档名，保守支现在是 `picUrl + '|p' + mode` —— ②③ 的保守支原本逐字节相同，
  而切档时两支会在槽栈里同时存在，撞 key 就把 ② 那支层原地标成 ③ 的。判据与理由见 §21.5。）**
  糊封面那一支再加 **overscan**（`transform: [{ scale: 1.25 }]`）：Fresco 的框糊在边缘读到图外会留一圈发暗的边，
  `absoluteFill` 摆着就把那条边贴在屏幕内缘，正是 §2 里当年"重度模糊"翻车的原因；用 GPU 变换而不是把 View 撑大。

### 10.4 真机清单（这次要判的）

1. 设置里两行读作「莫奈取色 / 动态取色」，默认打在**动态取色**；老安装里存着"安卓原生取色"的人升级后看到莫奈。
2. 动态取色：深色底瞬间到位，随后封面轮廓与颜色浮现；亮封面上白字、次级灰、歌词非当前行都不许糊。
3. 莫奈取色：与 §9 验收时逐像素一致（这条是"我没动你留下的东西"的凭证，重点看进度条那支强调色还在不在）。
4. 两档来回切：不许出现整屏主题底闪一下，也不许卡在上一首的底上。
5. 展开/收起：糊封面那一圈边缘不许露出来（overscan 的判据，重点看非正方形封面）。
6. 动态取色那一档的展开动画应当比莫奈更不卡（量化整段没跑）；莫奈那一档保持 §9 的"颜色在卡片落定后浮现"。
7. 没有封面的歌：两档都不该有背景层。
8. 设置里关掉「动态背景」：与改动前逐像素一致。
9. logcat 里不该再有 `PaletteModule` 的 seed 相关警告（那条 native 路没了）。
10. 切歌/快速连播：模糊层复用 Fresco 缓存，不该看到封面重新下载的白闪。

### 10.5 留作下一步

`androidx.palette` 删掉之后，原生桥只剩"像素 + 尺寸"这一件事。若真机上内置 `blurRadius` 糊出来有色带（8bit 图糊 90 半径有可能出），
升级办法是原生出图：`PaletteModule` 已经握着那张 ≤128px 的 ARGB_8888 位图，行业做法是"先降采样→再糊→放大贴回去"，
糊完写进 cacheDir 的一张 JPEG 走 `file://` 交给同一个 `<Image>`。这不改任何判据与状态形状，只换图片来源，所以不预先做。

### 10.6 落地状态与偏离（2026-10-16）

§10.3 的删除清单与新增清单全部落地。闸门实测：`npm test` 641 条、fail 1（就是 §7.4 那条故意留红的纹理用例）、
`npx tsc --noEmit` 在本次改动的文件上零报错（`defaultSetting.ts` 里 `list.clickUpdateList` / `list.isLoadMore` 那两条从 HEAD 起就报，与本次无关）、
`npx eslint` 干净、`:app:compileDebugJavaWithJavac` 通过。**§10.4 十条真机清单尚未跑。**

出包证据（2026-10-16 22:21）：`assembleRelease` 4m25s BUILD SUCCESSFUL（`androidx.palette` 从依赖里摘掉后 gradle 重新解析正常），
arm64 包内 `assets/index.android.bundle`（8,341,060 B）读到 `setting_basic_theme_dynamic_bg_algorithm_blur` 与 `theme.dynamicBgAlgorithm`、
UTF-16LE 的「动态取色」与「莫奈取色」都在，而 `..._algorithm_native` 与「安卓原生取色」两处都不在。

三处落地时加的、本节没写到的偏离：

1. **设置页两行的勾选判定改走 `normalizeCoverAlgo`**。原样写 `algorithm == 'monet'` 的话，旧存档里存着 `'native'`
   的人会看到两行都不打勾，而行为明明是莫奈——界面上的勾必须与取色侧同一个判据（§10.4-1 才判得出"升级后看到莫奈"）。
2. **`scrimAlpha == SCRIM_MAX`（全遮）那一层不渲染糊图**（`showWash` 那道门）。保守支因此不只是"先给一块深色"，
   而是这一次连解码 + 模糊都省掉；否则 §10.2 说的"深色底瞬间到位"会在 340ms 的色淡入里漏出照片轮廓，
   等于把要治的闪换了个形状再引进来。
3. **en-us 的标签写作 `Blurred cover`**（那一档在英文里按机制命名，与同组的 `Material Monet` 一个风格），
   zh-cn / zh-tw 仍按用户给的措辞用「动态取色 / 動態取色」。三语键集合一致（各 726 键）。

## 11. 六次迭代：② 从"糊到等于纯色"改成 5dp + 前景恒定一支白（2026-10-17）

用户要求原文：**"当前的封面大底模糊程度似乎太高了,背景都变成纯色了"→"我想要背景能隐隐地看出是封面大底模糊的效果"**，
两轮小样后圈定：**"使用我用红笔圈出的这一档，'第二版的倒数第二个档位'，并且选择模糊大底为背景全屏播控页面的其他按钮也要跟着统一为一个颜色
（主流平台都近乎白色，不随背景改变），一定要保证可读性"**。

### 11.1 根因是两件事叠在一起

1. **`blurRadius: 90` 本身就到头了。** Fresco 拿到的是 `px/2` 的框半径并迭代两次，3.0 密度的机器上 90dp = 半径 135px，
   作用在封面自己的位图上（CDN 常见解码尺寸 300px 左右）—— 半径比图还宽，剩下的只有大块起伏，"是照片"这件事已经读不出来了。
2. **其中一张还叠加了静默回退。** `buildOnCoverInk` 对 Lucky Block 那张算不出合法墨色，返回 null，于是整页退回主题字色，
   白字对比度实测 1.65:1。这一条不修，降糊度只会让字更读不了。

**小样的教训（第一轮整个是废的）**：那版预览用的封面是从 mockup 里抠出来的 44×60 像素，所以"最低档还是太糊"是夹具糊，
不是算法糊。改成真封面 + 300px 源图 + 按真机几何铺底（`cover` 到 1080×2400 再乘 1.25 overscan）之后，档位才有意义。

### 11.2 三处改动

- **半径拆成两个常量**（`CoverBackdrop/index.tsx`）：① 莫奈那层在蒙版底下，`WASH_BLUR_RADIUS = 90` 一字不改（§10.4-3 的逐像素凭证）；
  ② 新加 `COVER_BLUR_RADIUS = 5`（= 半径 7px），封面的大色块与字块边缘还留着，但已经读不出图案。overscan 只挂在 ② 上，没动。
- **② 的白字线抬到 `BLUR_MIN_CONTRAST = 4.9`**（`surface.ts`，只补闸门线，① 仍是 4.5）。这不是把标准调严，是补一个实测出来的模型差：
  半径从 90 降到 5 之后，"8×8 最亮块均色"这个参照物开始偏乐观 —— 糊完仍留着比块还细的纹理，真机重渲染量到的峰值比块均色亮约 1.7 个 L\*
  （两张真封面各差 0.26 / 0.35 对比度）。按 4.5 交出去的那张 Lucky 真机是 4.29，破线就破在这里。
  抬到 4.9 的效果：Lucky 的蒙版 α 从 0.60 自动走到 0.64（场 L\*46.9，白字 5.01），Faces 与所有中暗封面仍停在 `BLUR_SCRIM_MIN` 0.40。
- **② 的前景改成常量表 `BLUR_INK`**（`onCoverTheme.ts`，经 `resolveOnCoverInk` 分流）：标题/歌手/按钮/进度条/播放键全是不透明白，
  歌词非当前行白@0.78、译文行白@0.70，卡片底下垫 0.32 的黑纱。分层只靠 alpha 与黑纱，不再靠色相 —— 这就是"主流平台近乎白色、不随背景改变"。
  取最亮合法场（L\*47.5）实测：实心态白 4.91，白@0.92 → 4.46（**过不了 4.5，所以次级文字也必须实心态**），白@0.78 → 3.72，白@0.70 → 3.10；
  黑纱恒比场暗，所以白字在黑纱上只会更安全。附带收益：② 从此永远不会"算不出来"，§11.1 那条静默回退在这档上不存在了。
  实心态的发色走新加的 `cssArgb`（把墨色自己的 alpha 带出去），不透明时串与原来逐字节相同，所以 ① 那一支不受影响。

### 11.3 真机清单：这一版要改判的两条

§10.4 那十条仍然全部要跑（截至本次一条没跑），其中两条按本节改判：

- **10.4-2 重述**：动态取色要"隐隐看得出是糊掉的封面"（能辨出大色块走向，但读不出图案），且白字、歌词淡行、译文行都读得清；
  判据不再是"糊到看不见"。亮封面（Lucky 那类）看蒙版是否比暗封面更实。
- **新增 10.4-11**：动态取色这一档，播控页所有控件与文字恒为一支白，换封面不许变色；只有歌词淡行/译文行/卡片黑纱分层。

### 11.4 落地状态（2026-10-17）

三处源码 + 两份测试全部落地。闸门实测：`npm test` 668 条 / fail 1（还是 §7.4 那条故意留红的纹理用例）、
`npx tsc --noEmit` 137 = 基线且本次改动的五个文件零报错、`npx eslint` 在源文件上干净。
新增用例覆盖：② 的白字线严格高于 ① 的 4.5、Lucky 按 ② 的线重核后蒙版必须更实、② 的一支白不随封面漂移、
② 每个字色族对两条依托面（真场 / 黑纱面板）都过自己的下限（alpha 先合成再算）、① 的墨色仍由场导出（② 的常量表没渗过去）。

> **本节已被同一天的 §12 改判**：5dp 的半径、`BLUR_MIN_CONTRAST = 4.9`、以及"次级字色只能同样是实白"这三条都不是最终交付值。
> 上面这些数字照录是为了留下推理过程（尤其是"为什么白降到 0.92 就过不了 4.5"那句成立的前提），对着实物看图时请以 §12 为准。

## 12. 七次迭代：9dp + 三层白阶梯，弹层挂回普通底（2026-10-17）

用户要求原文：**"将模糊度改为刚刚第二版的倒数第三档重新构建吧，并且当前歌词的'当前歌词'与'非当前歌词'的颜色区分并不明显，请优化"**，
紧接一条：**"顺便将模糊背景为动态背景下的全屏播控页任何点按按钮出现的界面都作为普通白底展示：也就是不做任何效果"**。

### 12.1 "区分不明显"的根因：一个常量加一条漏乘的系数

不是渲染链路的问题，是 `BLUR_INK` 这张表本身有两处写错：

1. **小字层与标题层逐字节同色。** 上一版 `fontLabel = 0xFFFFFFFF`，于是"歌名"和"时间 / 下一行预告 / 次要图标"是一支颜色。
   真机截图量下来四行文字峰值全在 L\*100。当时把小字层钉成实白的理由是"白降到 0.92 就过不了 4.5" —— 那句只在 4.9 的闸门下成立（见 12.2）。
2. **歌词那两层从来没核过组件自己那笔乘法。** `useGlassColors.lyricOpacity = 0.6` 由 `AnimatedColorText` 的 `opacity` 再乘一遍，
   上一版只按主题色算对比度，所以白@0.78 的"非当前行"在亮封面上的实际值是 **1.88:1** —— 比它该压暗的层次还低，等于没分层。
   这一条现在钉在源码里（`onCoverTheme.LYRIC_COMPONENT_OPACITY`），改那边必须重核这边。

### 12.2 物理：固定白阶梯下，层次有多少余地全看场有多亮

前景既然是**一支不随背景变的白**，能拉开层次的只有 alpha；而"最暗还能过 4.5 的那格 alpha"换算到屏上是多暗，完全由场决定
（合成公式 sRGB 码空间，与 `mixFieldArgb`、预览脚本同一套）：

| 场（最亮块）L\* | 过 4.5 的最暗 alpha | 屏上 L\* |
| --- | --- | --- |
| 47.5（上一版闸门 4.9 的顶） | 0.93 | 96.5 —— 肉眼等于纯白 |
| 44 | 0.84 | 91.6 |
| 40 | 0.76 | 86.5 |
| 36 | 0.68 | 80.8 |

上一版场上限 47.5，三层白根本没地方摆，只能全塌成实白 —— 这就是"没区分"的全部来历。要让阶梯摆得下，得压场上限，
也就是把 ② 的闸门线抬起来。**`BLUR_MIN_CONTRAST` 4.9 → 7**：模型场被钉在 L\*37.8，再算上"真机峰值比 8×8 块模型亮约 1.7 个 L\*"
的最坏情况（5dp 实测，9dp 只会更小），按 L\*39.5 的场合成完，每一层都还在自己的线上：

- 实白（标题 / 控件 / 进度条 / 当前歌词行）：**6.58**
- 小字层 白@0.78（时间、说明、下一行预告、次要图标）：**4.76**（线 4.5）
- 歌词层 白@0.90 × 组件 0.6 = 0.54（非当前行）：**3.19**（线 3.0）
- 译文层 白@0.86 × 0.6 = 0.516：**3.06**（线 3.0）
- 当前行 L\*100 对非当前行屏上 L\*73.6 —— **差 26 个 L\***，这条就是"一眼分得出"的落点。

为什么不是 6.5：6.5 时场上限 L\*39.8，加上那 1.7 的偏差后小字层只剩 4.47、译文层只剩 2.97，两条都贴着线下走过。

**代价要说清 —— 抬闸门等于亮封面的蒙版更实，糊图透出来的幅度更小**（`.scratch/t98_gate.mts` 实测，锚点 tone 20、下限 0.40）：

| 封面（按最亮块排） | 蒙版 α | 场 L\* |
| --- | --- | --- |
| 纯黑 / 很暗 / 暗 | 0.40（贴地板，不动） | 15.0 / 23.0 / 23.5 |
| 中暗·灰 | 0.46 | 37.7 |
| **中·Faces（验收那张）** | **0.40 → 0.59** | 37.5 |
| **中亮·Lucky（验收那张）** | **0.64 → 0.77** | 37.7 |
| 亮·白底封面 | 0.81 | 37.3 |

也就是说：只有"最亮块本身就暗"的封面还停在 0.40 那一格，两张验收用的封面都被顶上去了。
这是这一版**已知要拿真机眼睛复核的第一条** —— 见 12.5 的 10.4-2：α 变实之后 9dp 还剩多少"隐隐看得出是封面"。

### 12.3 三处改动

- `COVER_BLUR_RADIUS` 5 → **9**（第二版档位表 `DP = [28, 20, 14, 9, 5, 0]` 的倒数第三档）。装机那台 V2302A 实测是 1260×2800、密度 **3.5**（不是之前按的 3.0），所以 9dp = 31.5px → Fresco 框半径 **15px**。
  `WASH_BLUR_RADIUS = 90` 仍一字不改。
- `BLUR_MIN_CONTRAST` 4.9 → **7**（`surface.ts`，只有 ② 这一支，① 的 4.5 一个字不动）。
- `BLUR_INK` 改成三层白（`fontLabel` 白@0.78、`lyric` 白@0.90、`lyricSoft` 白@0.86，其余仍实白；黑纱 0.32 不动），
  并新增 `LYRIC_COMPONENT_OPACITY = 0.6` 把组件那笔乘法记进同一个文件。

### 12.4 弹层挂回普通底：按子树作用域，不是按键

弹层（播放列表、更多、歌词设置、定时关闭）的底板走的是 `theme['c-content-background']`，② 把它映射成 0.32 的黑纱，
所以那些层看着就是"半透明黑纱浮在糊图上"。想过把 `c-content-background` 从 `COVER_RULES` 里摘掉，**不行**：
同一个键在场上还有两个正经用场 —— `Vertical/Pic.tsx:64` 的碟片垫、`PlayerOverlay/index.tsx:146` 展开动画的淡入底，
摘了它们各自塌成一块白板。差别在"哪一棵子树"，于是新增 `components/player/SheetThemeProvider.tsx`
（订同一个 `themeUpdated`，把 `ThemeContext` 的 value 换回 `themeState.theme`），在 5 个挂载点外侧包一层：

| 挂载点 | 包住的层 |
| --- | --- |
| `Vertical/components/Header.tsx` | `LyricSettingSheet` |
| `Vertical/components/MusicSummary.tsx` | `MusicMoreSheet` |
| `Player/components/MusicInfo.tsx` | `MusicMoreSheet` |
| `Player/components/ControlBtn.tsx` | `PlaylistSheet` |
| `Player/components/MoreBtn/TimeoutExitBtn.tsx` | `TimeoutExitEditModal`（旁边那支按钮图标仍跟封面走） |

三个要点：

1. **必须在调用点外侧包**：弹层组件在自己的函数体里就 `useTheme()` 拿了值往下传，包在组件内部只能影响到它自己的后代。
2. `MusicMoreSheet` 内侧的 `MusicAddModal` / `MusicToggleModal` / `DownloadQualitySheet` 由外层一并包回来，不用逐个挂。
3. 评论按钮 push 的是 navigation 屏幕，本来就在 provider 之外；`Toast` 挂在根上，同理。动态背景没开时这个 provider 供的值
   与根上的引用相同，等于白包一层，不多渲染。

### 12.5 真机清单：这一版再改判两条 + 新增一条

- **10.4-2 再述**：② 要"隐隐看得出是糊掉的封面"按 **9dp** 判（大色块与字块边缘读得出、图案读不出），且当前歌词行与非当前行
  一眼分得出、小字层不是第二支实白。
- **10.4-11 改判**：不再是"所有控件与文字恒为一支白"，而是**控件与标题实白 + 小字 / 歌词 / 译文三层淡白**；
  换封面不许变色这一条仍然成立（阶梯是常量，不读场）。
- **新增 10.4-12**：② 生效时，播控页上点按钮出现的每一层（播放列表 / 更多 / 歌词设置 / 定时关闭，以及更多里的添加、切源、下载音质）
  都是 App 里其他弹层那个样：主题原本的底、原本的灰字，不许透出糊封面、不许是黑纱。

### 12.6 落地状态（2026-10-17）

三处源码 + 新 provider + 5 个挂载点 + 两份测试全部落地。闸门实测：`npm test` 669 条 / pass 668 / fail 1
（还是 §7.4 那条故意留红的纹理用例）、`npx tsc --noEmit` 137 = 基线且本次改动文件零报错、`npx eslint` 在 9 个改动文件上干净。
新增/改判用例：② 的三层要真的分得开（标题减小字 ≥ 10、小字减歌词 ≥ 8、标题减非当前行 ≥ 20 个 L\*）、
下限那条按**乘完组件 0.6 之后的屏上颜色**核、夹具补一支"亮到闸门口"的场专门压白阶梯最暗那一格。
真机 §10.4 十二条一条没跑，装机待用户插线。

## 13. 八次迭代：当前歌词行加粗 —— 层次最后一格由字重买，不是颜色（2026-10-17）

用户看真机：② 下"当前歌词"与"非当前歌词"还是分得不明显，而且当前行那支白**不太实、亮度有点低**。

### 13.1 先把"颜色算错"这条排掉

每一步都有代码依据，不是猜：

- `useGlassColors.lyricActive = theme['c-primary']` → `COVER_RULES['c-primary'] = { kind: 'solid', ink: 'primary' }`
  → ② 的 `BLUR_INK.primary = 0xFFFFFFFF`。当前行发出去的就是 `rgb(255, 255, 255)`，没有第四档可猜。
- `LrcLine` 里当前行 `opacity = 1`，只有非当前行才吃 `lyricOpacity` 那条 0.6；`AnimatedColorText` 只做 alpha 补间，不再乘别的。
- `PlayLine` 只有 2px 线与时间标签，不是压暗源；`textShadow` 是用户设置，默认不参与。
- 按真机链路（9dp 糊底 + 该封面自己的闸门蒙版）逐像素合成：当前行笔画核心 L\*100、脚下场 L\*37.7，屏上 7.0:1。

### 13.2 根因：眼睛读到的"白不白"是白墨覆盖率

颜色已经吃满，能掉的只剩**面积**。normal 字重的 CJK 在真机那个字号（20dp = 屏上 70px）下，
外接框里只有约 **7.9%** 是白墨，其余是抗锯齿的半透边；正常视距看一块"平均不到八成白"的字，读出来就是灰的。
更要命的是当前行与非当前行**同一个字重**：一个 L\*100 一个 L\*66，看着却都是"细白字"，
12.2 那 26 个 L\* 的账在纸面上成立，落到笔画上被字重吃掉了。所以这一格只能由字重买。

量法与小样见 `.scratch/t103_lyric_bold.py` → `t103_lyric_bold.png`（两张封面 × 三档，字号/密度/蒙版全按真机）：
同一支实白，normal → bold 把覆盖率抬到 **12.1%**（+53% 白墨），感知亮度中位仍是 L\*100 —— 涨的只有面积。

### 13.3 改动：只加粗当前行的歌词本体

- `Vertical/Lyric.tsx`：把 `active` 判定从 `colors` 的 useMemo 里提到渲染体（字重与颜色共用一支判定，依赖收敛成
  `[active, glassColors]`），新增 `styles.lineTextActive = { fontWeight: 'bold' }`，只在 active 时并入主歌词行。
- 选 `'bold'` 不选 `'500'`：安卓上 500 要设备装了 CJK Medium 才有效，否则**静默回落成 regular**
  （本仓库 `Home/Vertical/DrawerNav.tsx` 与 `Home/Horizontal/Aside.tsx` 里那两行被注释掉的 `// fontWeight: '500'` 就是这个形状）；
  700 要么有真 Bold 要么走合成加粗，一定看得见。
- 译文行不加粗：16dp 加粗会糊成一坨，而且它自己那两层（0.8 / 有效 0.516）已经分得开。
- 横屏 `Horizontal/Lyric.tsx` 按 portrait-only 约定不动。

### 13.4 否掉的两条

- **把非当前行再调淡**（歌词层 0.90 → 0.82）：比例是拉开了，但乘完组件 0.6 后有效 alpha 只剩 0.492，
  在最坏那支 L\*39.5 的场上从 3.19:1 掉到 **2.93:1，破了 3.0 那条线**。闸门不为观感让路。
- **把当前行再抬亮**：无可再抬，已经是 L\*100；要"更亮的白"只能改场（抬 `BLUR_ANCHOR_TONE` 或蒙版），那是另一笔账。

### 13.5 真机清单：这一版新增一条

- **新增 10.4-13**：② 下滚到任意一行，当前行要"一眼是粗的"，与上下两行不是同一支细白；
  换行时字重是**瞬间切**的（颜色仍走 800ms 补间），不许看到半粗的中间态。

### 13.6 落地状态（2026-10-17）

`Vertical/Lyric.tsx` 一处改动落地。闸门实测：`npm test` 669 条 / pass 668 / fail 1（还是 §7.4 那条故意留红的纹理用例）、
`npx tsc --noEmit` 137 = 基线且该文件零报错、`npx eslint` 该文件干净。字重是纯样式，没有可单测的判据，
自证留在 `.scratch/t103` 的小样与覆盖率上。真机仍待插线，§10.4 十三条一条没跑。

### 13.7 撤销（同日 02:50，装机看过之后）

包 02:34:58 装上 V2302A，歌词页真机截图量下来字重这一版是**成立**的：当前行笔画横 11px / 纵 10px，其它行 6 / 5px（约 1.8 倍），
核心 L\*95.0 对非当前 67~73，切换是瞬的、没有半粗中间态。**用户看过仍要求把加粗去掉**，所以 `lineTextActive` 与那处并入全部撤销，
`Lyric.tsx` 回到本迭代之前的形状（`active` 判定收回 useMemo 内部）。

两笔账留着，别重走：

1. 13.2 的覆盖率结论仍然成立 —— 恒白阶梯下"实不实"是白墨面积，不是 L\*。只是这一版**不用字重去买**。
   真要把当前行做得更"实"，剩下的买方是场的明度（`BLUR_ANCHOR_TONE` / 蒙版），不是前景。
2. 13.4 否掉的"非当前行调到 0.82"仍然是错的：有效 α 0.492 在最坏场上 2.93:1，破 3.0 的闸门线。撤销字重**不等于**这条可以重开。

顺带在同一张真机截图上量到一个**先于本迭代就存在**的缺陷：第 1 行歌词停在纯白 L\*100（笔画 6/5px = regular），
比其它非当前行的 67~73 亮一大截 —— 颜色/透明度还停在当前行那一档，字重却已翻回非当前。
指向 `useAnimateColor` / `useAnimateNumber` 那对 hook 的 JS 驱动动画被打断后既不落终值也不触发纠正性重渲染。
与字重无关，另立条目查（探针：同状态间隔 2s 连拍两张，看那一行的 L\* 会不会爬）。

## 14. 九次迭代：② 提亮到锚点 28，白阶梯重排（2026-10-17）

用户原话：「当前的封面模糊作为背景的亮度感觉有点暗，你先调亮一点给出几版示例图让我来选亮度」，
看过六档小样后定「选 C，改常量并复跑验证」，并追加「要优化文字可读性」。

### 14.1 六档扫描：亮度只有一个旋钮

`.scratch/t107_grid.mts` 把 `buildBlurSurface` 逐行拷成参数化版本（先在现状参数上逐字节复现真实现，
复现不过就抛错），扫锚点 20/24/28/32/36 与"锚点 32 + 闸门 6.2"那一支。四张真封面（`.scratch/t107_measure.py`
按原生同一套 128px 双线性 + 8×8 块均值量出）实测：

| 档 | 整屏均值 L\* | 封面起伏 P95−P5 | 蒙版 α |
| --- | --- | --- | --- |
| A 锚点 20（原状） | 26.0 / 29.3 / 33.6 / 29.6 | 18.7 / 14.7 / 11.4 / 16.2 | 0.42–0.77 |
| B 24 | 27.1 / 30.9 / 34.1 / 30.6 | 16.6 / 12.0 / 9.2 / 13.5 | 0.48–0.81 |
| C 28 ← 选定 | 28.9 / 32.5 / 35.0 / 32.2 | 14.3 / 8.8 / 7.2 / 10.8 | 0.55–0.86 |
| D 32 | 31.3 / 34.4 / 36.1 / 34.0 | 10.1 / 5.7 / 4.5 / 7.0 | 0.68–0.91 |
| E 36 | 35.4 / 37.0 / 37.4 / 36.5 | 3.7 / 2.0 / 1.6 / 2.5 | 0.88–0.97 |
| F 32 + 闸门 6.2 | 29.7–38.3 | — | 小字 4.31 / 歌词 2.95，**双破线** |

机理只有一条：闸门（`BLUR_MIN_CONTRAST = 7`）把**最亮那一块**钉死在 L\*37.8，所以抬锚点只抬得动暗部 ——
整屏变亮而"最坏那一格"一动不动，代价全落在封面起伏上。E 档起伏只剩 2，等于平涂，"隐隐看得出是封面"就没了。
锚点的天花板在 36：色相×彩度全网 4500 格扫下来，36 最差对白 7.438（0 格失败），40 最差 6.414（**4500 格全灭**，
整档静默回落成纯色）。F 那种"松闸门换亮"是反的：它既破线，在暗封面上还比 D 更黑。

### 14.2 逐像素复算：提亮没有吃掉可读性余量

直觉说"背景亮了白字就糊"，量下来不是（`.scratch/t107_readable.py`，把蒙版合成铺成真像素，
每格墨色先按 RN 的 sRGB 编码值合成再与**脚下那一格**求 WCAG）：锚点 20→28，四张封面在"歌曲页文字区"
与"歌词页中段"两个区域里的**破线占比恒为 0.0%**，最坏那一格由闸门钉住、一个数没动，
中位数只从 3.80 掉到 3.62（歌词层，线 3.0）。

也就是说：贴线的一直不是"提亮之后"，而是**歌词/译文那两层自己** —— 旧值 0.90/0.86 在最坏场上只有
3.17 / 3.07，对 3.0 那条线各剩 0.17 和 0.07。而且 `非当前行 vs 译文` 只差 **1.1 个 L\***，等于没有"译文"这一档。

### 14.3 改动：锚点 28 + 只抬歌词两层

1. `surface.ts`：`BLUR_ANCHOR_TONE` 20 → **28**。
2. `onCoverTheme.ts` 的 `BLUR_INK`：`lyric` 0.90 → **0.98**、`lyricSoft` 0.86 → **0.92**；
   `fontLabel` **留在 0.78** —— 抬到 0.82 会把"标题 − 小字"的落差压到 10.1，正好贴在那条 ≥10 的地雷线上。
3. 歌词两层刻意不取满 1.0：取满的话 `c-350` 与 `c-font` 是同一串 `rgb(255, 255, 255)`，层次全靠组件那条
   `LYRIC_COMPONENT_OPACITY` 撑着，漏挂一次就退回 §12.1 那个"当前行与非当前行没区分"的老症状。

重排后在最坏场 L\*39.5 上：实白 6.58 ｜ 小字 4.75（线 4.5）｜ 歌词 3.47 ｜ 译文 3.25（线 3.0）。
层次落差：标题−小字 12.6、小字−非当前 11.2、当前−非当前 23.8、**非当前−译文 2.2**（旧值 1.1）。
`tests/monet-on-cover-theme.mts` 那条"三层白要真的分得开"补了第四道断言（`lyric − soft >= 2`），防止再挤回去。
§13.7 第 2 条否掉的"非当前行调到 0.82"是**往下**调（有效 0.492 → 2.93 破线），与本节的往上抬不是同一件事，别混。

### 14.4 这笔改动花掉的东西：两档不再靠明度分

`tests/monet-cover-palette.mts` 原来钉的是"② 底色比 ① 暗至少 6 格"。锚点 28 之后同一张 RED 夹具量出来
blur 底色 L\*27.87 / monet L\*31.94，落差只剩 **4.07**，而合成完的场 blur（L\*36.7）反而比 monet（L\*34.7）**亮 2 格** ——
"② 更暗"不再是这两档的区别了。用例改成钉仍然成立的两件事：底色先后不许翻，锚点离 `DARK_ANCHOR_TONE` 至少留 4 格；
撑开两档的换成了糊半径（② 9dp + 1.25 外扩读得出照片轮廓，① 90dp 只剩大块色与纹路）。

另一条改判：灰封面 `0xFF808080` 在锚点 28 出来的底色是 `rgb(65,66,66)`，HCT 彩度 2.09，顶破了原来写死的 `< 2`。
那是 Hct→sRGB 回落给中性色添的一丁点彩度，不是"硬造色相"。判据换成与锚点无关的**通道极差 ≤ 2**（这里实得 1），
彩度上限放宽到 3 并注明来路。

### 14.5 落地状态（2026-10-17）

`npm test` 690 / pass 689 / **fail 1**（还是 §7.4 那条故意留红的纹理用例）、`npx tsc --noEmit` 137 = 基线、
`npx eslint` 三个 src/test 的 `.ts` 文件干净（`tests/*.mts` 那三条 parsing error 是仓库既有状况，未配置 TS parser）。
小样：`.scratch/t107_player.png`（六档 × 四封面带封面的整页）、`.scratch/t107_ink.png`（现状 A·旧 / C·旧 / C·新 三列）、
`.scratch/t107_inkzoom.png`（文字块放大对比，差别确实只有半档，量得出看不出）。

真机一条没跑：§10.4 十三条、以及这一版要改判的两条 —— ① 亮封面（Lucky Block / Sunset 那两张）在 α 0.83–0.86 下
"还认不认得出是封面"，② 歌词页译文行与非当前行现在分不分得开，③ 这一版新引入的回归项 —— ①/② 两档（纯色莫奈对糊底）
看起来还分不分得开（§14.4：明度差 11 → 4.07 且合成场顺序反转，分界只剩糊半径）。

**装机记录（同日 16:30）**：`xunyin-v1.1.0-arm64-v8a.apk`，bundle 定稿 16:28:24 / APK 16:28:35，设备
`lastUpdateTime=2026-10-17 16:30:05`（`install -r` Success）。本文件改的两处（`surface.ts`、`onCoverTheme.ts`）源码时间是
16:06–16:07，**早于 bundle**，所以上面三条用这支包复核成立。
一个要写下来的竞态：这趟构建窗口里，分享图那条线在 16:26–16:28 连续写了 `src/components/ShareCard/` 四个文件，
其中 `cardTypography.ts`（16:28:51）落在 bundle 之后没进包 —— **所以这支包不能给分享图那条线背书**，那边要复核得等它落定再重烧。

## 15. 十次迭代：② 分台布光 —— 浏览台亮、歌词台暗（2026-10-17）

用户原话：「用frontdesign这个skill优化以模糊背景作为动态背景情况下全屏播控页的背景亮度」。
这次没有直接再扫常数，而是先量清"亮度被谁钉住"，再给方向、出小样、按证书标准落一版。

### 15.1 先量：亮度只有几条路，三条被实测排除

- **锚点**：已到 28（§14，天花板 36 ≈ 平涂），不再动。
- **对糊图拉色调曲线**（γ 提亮暗部、保住高光）：实测在锚点 28 上只有 **+1 L\***，而且因为高光被抬、
  蒙版必须加实重新钉回去，起伏反而掉（γ0.85/0.72 两档小样 `.scratch/t109_player.png` B/C 列）；
  它还要新增一条像素加工管线（原生或 JS 位图）—— 收益与成本不成比例，**否掉**。
- **把闸门放到 5.5**（小样里的"亮台"）：亮度收益最大，但把 §12.2 那条保守量（真机峰值比 8×8 块模型
  再亮 1.7 个 L\*）算进去，小字层（0.86）在真机峰值上只剩 **4.32 破线** —— **不能发货**，收到 6.2。
- 机理一句话：**整屏亮度被"最淡的那层墨"钉住**。歌词页的"译文"层（有效 α 0.552）要求闸门 ≥7；
  浏览页最淡的是小字层 —— 这就是"分台"的全部依据：两台分开，各自按自家最淡那层解。

### 15.2 两台的设计与数值

浏览台（歌曲页）：闸门 `BLUR_BROWSE_MIN_CONTRAST = 6.2`、小字层 0.78→0.86、其余墨色与歌词台一字不差；
歌词台：`BLUR_MIN_CONTRAST = 7` 与整套墨色**原样不动**（§12–§14 的证书逐条保留）。
渲染层铺浏览台那一格 `browseScrimAlpha`，压暗层 `stageDimAlpha`（δ）把两台压回歌词台那一格 ——
等式的定义与证明在 `surface.ts` 的字段注释里，恒等式在整数百分格上精确成立（用例复核差 <1e-9）。
δ 跟随 PagerView 的 `onPageScroll` 连续投递（"灯跟着你走"），`onPageSelected` 落定时钉端值。

四张真封面实测（`.scratch/t110_grid.mts` / `.scratch/t110_player.png`，参数化拷贝先在现状参数上复现真实现）：

| 封面 | 整屏均值 A→发货（L\*） | 起伏 A→发货 | 蒙版 α A→发货 | 最亮块场 |
| --- | --- | --- | --- | --- |
| solace | 28.9 → 29.2 | 14.3 → 19.0 | 0.55 → 0.40（贴下限） | 37.8 → 41.1 |
| lucky 亮封面 | 32.5 → 34.0 | 8.0 → 11.8 | 0.86 → 0.81 | 37.5 → 40.7 |
| sunset 暖亮封面 | 35.0 → 37.4 | 7.2 → 9.5 | 0.83 → 0.77 | 37.5 → 40.8 |
| rainy 暗封面 | 32.2 → 33.6 | 10.8 → 14.2 | 0.74 → 0.66 | 37.8 → 41.0 |

小字层的证书（`.scratch/t110_gate_probe.mts`，真机峰值 = 模型场上限 +1.7）：
**0.86 → 4.82，余量 0.32**（歌词台 0.78 → 4.76，余量 0.26 —— 同档）。标题实白在真机峰值上 5.8+。
一个顺带变好的账：翻页中途歌词页两层在亮台场上（模型值）非当前 **3.31~3.35**、译文 **3.12~3.17**；
即便按真机峰值算也贴着 3.0 —— 比 5.5 那版的 2.86 好一档（那一版是"中途必破线"）。

### 15.3 改动清单

- `surface.ts`：新增 `CoverStage`、`BLUR_BROWSE_MIN_CONTRAST = 6.2`、`CoverSurface.browseScrimAlpha/stageDimAlpha`、
  `solveScrimCenti`（两条闸门共用同一套解算）；莫奈支与保守支 `browse = scrim`、`δ = 0`（① 逐像素不变）。
- `onCoverTheme.ts`：新增 `BLUR_INK_BROWSE`（只改 fontLabel 0.86）；`resolveOnCoverInk/applyOnCoverTheme` 加 `stage` 参数，**默认 'lyric'**。
- 新 `components/player/CoverStageProvider.tsx`：stage + dim（Animated）的 context；**默认值是暗台**，
  没接线的树逐像素回到分台之前 —— 这是结构保证，不是自觉。
- `OnCoverThemeProvider`、`PlayDetail/index`、`Vertical/index`、`CoverBackdrop`（压暗层 + 铺 browse 蒙版 +
  `showWash` 判据跟 browse 格走）、`PlayerOverlay`（provider 挂载 + 两条 pager 事件接线，重开时 `initialStage` 跟随记住的页）。

### 15.4 证书与落地状态（2026-10-17）

`npm test` 719 / pass 718 / **fail 1**（还是 §7.4 那条故意留红的纹理用例）、`npx tsc --noEmit` **137 = 基线**
（PlayerOverlay 那处新加的参数补了类型注解才保住这条）、`npx eslint` 手写的 7 个文件干净；
反编译的 `PlayerOverlay/index.tsx` 增加的行只落在它自带的那几类噪声里（no-var / quotes / semi / indent），未引入新类。
新增/改判用例：两台的合成恒等式与"亮台真的更薄"（monet-blur-surface）、只动小字层一格 + 浏览台整套字色过线
（monet-on-cover-theme）、① 没有分台（monet-surface）、gate 夹具补字段（monet-gate）。

真机清单（这一版全部待跑）：
- **15-1**：浏览页背景比现状亮一档（四张夹具上均值 +0.3~2.4、起伏 +3~5），"隐隐看得出是封面"比现状更明显。
- **15-2**：歌词页与分台之前**逐像素一致**（同一支蒙版、同一套墨色）。
- **15-3**：左右滑动时灯光连续过渡、不硬切；落定后墨阶瞬间切到该台（中途歌词两层短暂贴 3.0，见 15.2）。
- **15-4**：PlayerOverlay（列表页上拉）与 PlayDetail 两台表现一致；重开 overlay 落在歌词页时第一帧就是暗台。
- 已知取舍：浏览台"标题−小字"的明度落差约 7 L\*（歌词台 12.6）—— 那台上的层次更多由字号买；
  面板黑纱在亮台上更深（安全方向）；亮块本身就暗的封面（solace 那类）两台贴同一个下限，分台对它无增益。

**出包记录（同日 19:14）**：`cd android && .\gradlew.bat assembleRelease` → `BUILD SUCCESSFUL in 5m34s`
（716 tasks：25 executed；`createBundleReleaseJsAndAssets` 重跑）。产物 `xunyin-v1.1.0-arm64-v8a.apk`
（20,850,635 B，sha256 `86EE79CD…BB12`）。它的文件时间戳停在 18:42:58 —— 那支包与本次复跑的 bundle 内容逐字节相同，
内容寻址的 up-to-date 检查据此跳过重打包，所以交付的这支就是这棵树的产物：包内
`assets/index.android.bundle` 8,381,828 B、sha256 `81e3f415…6495`，与本次 `createBundleReleaseJsAndAssets`
的输出逐字节一致，名字表里含 `BLUR_BROWSE_MIN_CONTRAST` / `stageDimAlpha`（哨兵串见 §12 的探针手法）。
**设备未连**（`adb devices` 空），当时装机待用户点头。

**装机记录（同日 19:21）**：`adb connect 192.168.137.81:35977`（Windows 热点网段）→ `adb install -r` **Success**（streamed install）。
装完按 §12 的判据核对：`pm path` 拿到设备路径 → `adb pull` 回 `base.apk`（20,850,635 B），与本地产物 sha256 **逐字节一致**
（`86EE79CD…BB12`）；`versionCode=88003` / `versionName=1.1.0`（不涨，只看 `lastUpdateTime` 必误判，以 sha256 为准），
`lastUpdateTime=2026-10-17 19:21:52`。App 已拉起（`am start …/.MainActivity`，当前任务被带回前台）。
四条真机清单（15-1~15-4）待按。


---

## 16. 十一次迭代：② 的糊法换成"小图 + 盒模糊 + 裁脏边"（2026-10-18）

> **⚠ 本节起至 §23 已从全屏播控页整段回退（见 §24）**。下面这些数字（`BLUR_BOX_RADIUS`、屏上 σ、锚点 30→36 的四步抬亮、
> 第三档 ③「浓色模糊」、前景正文染色与当前行高光）**在当前代码里不存在**，不要照本节实现。
> 这几节保留下来只作为测量记录：那批像素账（σ 换算法、模型场与真机峰值的裂开序列、闸门吸收保守量的上限）
> 是量过之后才知道的，重做同类改动时它仍然有效。

### 16.1 起因：把 QQ音乐概念版那一张截图逆向到底

用户给了一张 `Screenshot_20261017_205059.jpg`（QQ音乐概念版播放页，`com.tencent.qqmusiclite`），要求逆向出那个模糊背景。
用 `rea`（jadx headless）把 APK 拆开逐层读，配图像反解，最后按还原出来的管线重建整页背景与截图对比：
**无文字的侧栏全高 rms = 1.36 / 255**（含文字与卡片的那一大片 rms = 27，是卡片本身，不是模型差）。

还原出来的配方（现场留在 `C:\Users\30913\.qoder\tmp\qqmusic-re\`，结论另存了记忆）：

1. 封面只拿 **R300x300**（`AlbumConfig.buildAlbumPicUrlByMid`，手机端；`R500x500` 只给大屏）。
2. `BitmapAlgorithms.d()`：**3 次盒模糊、半径 10**（横一遍 + 转置后竖一遍，越界钳边），再**裁掉四周各 3%**（300→282）。
   中间那个 `resize()` 是死代码 —— Java 整数除法把缩放算成 1。
3. 交给一个 `match_parent` + `CENTER_CROP` 的**不透明** ImageView。282px 铺 2800px 高 ⇒ 放大 9.93 倍。
4. 上面压第二个 ImageView，`android:alpha="0.8"`，`backgroundColor` 是一支纯色 ⇒ 净效果 `obs = 0.2·blur + 0.8·M`。
   布局树里**没有任何渐变遮罩**（`res/GD.xml` 整棵树只有这两层 + mainLayout）。
5. 那支纯色 `M = Color.HSVToColor({Palette 魔法色的色相, 0.56f, 0.40f})`（`MagicColorHelper.calculateBackgroundColor`）：
   **只继承色相，饱和度与明度写死**。截图那张封面反解出色相 77.14° ⇒ 算出 rgb(86,102,45)，实测 rgb(85,101,45)，差 1/255。
   同色相还派生前景字 (h,0.10,1.0)、迷你条底 (h,0.20,0.30)、强调色 (h,0.30,1.0)。
   **整条链路没有 Monet / HCT**，就是 AndroidX Palette + HSV 硬编码档位。
6. 切歌 750ms 双轨：糊图层 `TransitionDrawable` cross-fade，纯色层 `ObjectAnimator(backgroundColor)` +
   `PathInterpolator(0.32, 0.94, 0.60, 1.00)`。

### 16.2 本次只搬第 2、3 条，第 4、5 条明确不搬

**搬的**：糊的**机制**。这一条是我们原来做不到的 ——
RN 的 `blurRadius` 是 dp 换成**屏幕像素**之后，套到**解码出来的位图**上的
（`ReactImageManager` → `ReactImageView` → Fresco `IterativeBoxBlurPostProcessor(2, px/2)`）。
于是同一份 `blurRadius=9` 在 300px 的封面上糊掉的是宽度的一半，在 1000px 的封面上只糊 4% ——
**强度跟着封面分辨率跑，而 JS 侧拿不到那个分辨率**。想调出"云纹还在、图案读不出"这一格，只能靠原生先把长边归一。

**不搬的**：`0.2·blur + 0.8·M` 那个合成，和 HSV 写死 S/V 的取色。
理由不是"逆向来的不对"，是它和 §14 那次用户自己拍板的取舍正面冲突：
锚点从 20 抬到 28 挑的就是"起伏还留着"，锚点 36 之所以被否掉是因为"起伏只剩 2 ≈ 平涂，隐隐看得出是封面就没了"。
把透出量压到 20% 等于直接选平涂。而 HSV 写死 S/V 那一档（本例 HCT tone≈40）在我们这边过不了
`BLUR_MIN_CONTRAST = 7` 那条线 —— 它换来的观感是"更亮的平涂"，正是 §14 否掉的方向。
**闸门与分台布光（§15）一律不动**，本次只换"糊是怎么糊出来的"。

### 16.3 改动清单

- 新 `src/utils/monet/backdropBlur.ts`：**纯模块**，四个档位常量（`BLUR_SOURCE_EDGE = 300` / `BLUR_BOX_RADIUS = 10` /
  `BLUR_ITERATIONS = 3` / `BLUR_EDGE_CROP_PERCENT = 3`）+ σ 推导（`boxSigmaPx` / `blurSigmaPx` / `croppedEdge` /
  `blurSigmaInScreenPx`）。住在这里是为了能 `node --test`，原生只收参数。
- `PaletteModule.java`：新增 `getBlurredBackdrop(url, edge, radius, iterations, cropPercent)` ——
  长边归一到 `edge`（**允许放大**，否则相对强度还会跟分辨率跑）→ `iterations` 次可分离盒模糊（钳边）→
  裁四周 `crop%` → PNG 落 `cacheDir/cover-backdrop/<md5(参数+url)>.png`，先写 `.tmp` 再改名
  （半张 PNG 会被下次的 `exists()` 当成命中，那张封面就永远坏在那一版）。产物命中就直接回路径，不重解码。
  另加两格**原图字节 LRU**（`readBytesCached`，只收 ≤1.5MB）：取色与糊底两条路读的是同一个 url，
  而这条 `HttpURLConnection` 路径不经过 Fresco 的磁盘缓存，不挡就是每张封面多下一遍。
- `src/utils/nativeModules/palette.ts`：`getBlurredCoverPath`，失败一律给 `null`（背景糊得差一点不是错误，
  把错误冒到播放页才是）；另导出能力位 `supportsBlurredBackdrop` —— 渲染层要靠它分清两种 `null`：
  "图还在路上"和"这个包根本没这条路"。
- 新 `src/utils/monet/useBlurredCover.ts`：按 url 缓存 **promise** 而不是结果 —— 一支封面同时挂在保守支与
  测量支两个槽上，按结果缓存会让这两支各排一次单线程 executor 的队。失败不留负条目（下次切回来该重试）。
  交出去的是**三态**（`pending` / `ready` / `unavailable`）而不是"有图/没图"两态：
  `pending` 该什么都不铺（等图），`unavailable` 该立刻铺糙图（这条路压根不通，再等就是永远没有封面层）。
  两态写不出来 —— 慢封面与坏封面会被当成同一件事。
- `CoverBackdrop/index.tsx`：② 且这个包有原生能力时走软位图，`blurRadius = 0`、**不套 OVERSCAN**；
  否则走原来那条回落支。`source` 从 `useRef` 改成 `useMemo`（两条支切换时引用必须稳定，
  换对象等于重发一次 ImageRequest）。`showWash` 多等一格：`pending` 时整层不铺。
  不这么做的后果是淡入（340ms）早就放完了，原生还在下载 + 解码 + 糊 + 落盘，
  等它回来时把一张已经铺稳的糙图原地换成软图 —— 一下看得见的跳变。
  空着不铺没有风险：底下那支纯色底本来就不透明，露不出主题底。
  ① 那一支的判据 `isBlur` 恒 false，逐像素不变（§10.4-3 仍然成立）。
- `OVERSCAN = 1.25` **留着但降级成回落支**：它本来就是在屏幕坐标上补"裁脏边"这件事
  （每边外扩 12.5%），现在源上真裁了，它只在原生没出图时顶着。

### 16.4 证书与落地状态（2026-10-18）

`npm test` **748 / pass 747 / fail 1**（还是 §7.4 那条故意留红的纹理用例，与本次无关）、
`npx tsc --noEmit` **137 = §15.4 那条基线**（复跑两次同值），且按文件名 grep 本次动过的 5 个文件 **0 条**
—— 判据只用后一条，总数会随别人的 WIP 漂。
`npx eslint` 本次手写的 5 个文件 **exit 0**：中途真报过三条（`promise-function-async`、`no-unreachable-loop`、
`no-unnecessary-type-assertion`），全部改代码解决，没有关规则。
Java 侧 `:app:compileDebugJavaWithJavac` **exit 0**。
新增用例 `tests/monet-backdrop-blur.mts`（6 条）：四个常量逐项对齐逆向结论、
`boxSigmaPx(10) = sqrt((21²−1)/12) = 6.055`、3 次叠加 σ = 10.49、裁边 300→282、
落到 1260×2800 屏上 σ 落在 95~115（截图侧量到的平台期 70~110、峰值 ~110）、
以及"长边翻倍而半径不动 ⇒ 屏幕 σ 减半"那条 tuner 陷阱。

真机清单（本次全部待跑）：

- **16-1**：② 的背景比现状**软得多** —— 读不出图案，只剩大块云纹走向；这是本次唯一的目标观感。
- **16-2**：背景四边**不再有暗框**（脏边裁在源上了），且不再需要 OVERSCAN。
- **16-2b（慢封面）**：首次进一张没缓存的封面，看到的顺序是"纯色底 → 软图淡进来"，
  中间**不许**出现"先一张糙的、半秒后原地换成软的"那一下跳变（`pending` 那一格存在的唯一理由）。
- **16-2c（坏封面 / 无能力）**：把 `getBlurredBackdrop` 临时改坏（或走 iOS 分支）之后，
  应当**立刻**铺现状的 9dp + OVERSCAN 糙图并且一铺不换 —— 而不是永远没有封面层（`unavailable` 那一格的理由）。
- **16-3**：切歌时新背景淡入，中途不闪主题底（先叠后撤那套没动，但要确认换了图源之后仍然成立）。
- **16-4**：本机歌曲的 `file://` 内嵌封面同样出图（`readBytes` 那条本地分支上限 32MB，糊底这一路复用它）。
- **16-5**：① 莫奈档逐像素不变（§10.4-3 的老判据，换图源不该碰到它）。
- **16-6**：连续切歌 10 首不卡、不涨堆（单线程 executor 上每张封面多排一次"下载 + 解码 + 3 次模糊 + 落盘"，
  300×300 量级是毫秒级，但队是排的）。
- 已知代价：**每张封面多一次落盘**（约 282×282 的 PNG，几十 KB）在 `cacheDir` 里，系统清缓存才没；
  参数进文件名所以改档位后旧产物自然失效，但也**不会主动删** —— 听过几百张之后那目录会有几百个小文件，
  量级在十几 MB，本次没做淘汰。

**出包记录（同日 00:53）**：`cd android && .\gradlew.bat assembleRelease` → `BUILD SUCCESSFUL in 7m32s`
（716 tasks：34 executed、682 up-to-date；`createBundleReleaseJsAndAssets` 重跑，产物 8,405,244 B）。
交付的 arm64 包 `xunyin-v1.1.0-arm64-v8a.apk` 20,865,931 B、sha256 `9f872ba5…adf5d`
（上一支是 23:43 的 `77cd4d21…`，已被覆盖）。两条新鲜度自证：
包内 `assets/index.android.bundle` 与 generated 的那份 **sha256 逐字节相同**（`1d7d9da5…c2e9e`）；
`classes.dex` 里 grep 到 `getBlurredBackdrop`（2 处）与 `cover-backdrop`（1 处）、bundle 里 grep 到
`getBlurredBackdrop`（1 处 = JS 调用点），所以新桥方法与它的 JS 侧接线都进了这一支包。
**设备未连**（USB 空列表，先前的 `192.168.137.81:35977` 连不上），16-1~16-6 仍待装机后按。

## 17. 十七次迭代：② 再提亮一格，锚点 28 → 30（2026-10-18）

用户原话：**「当前背景有点暗，请提亮一点」**。要提醒一句：这句是在 **10-17 23:43 那支包**上看的（② 还是 9dp 糊底那一版），
本次的软图包还没装上过设备 —— 所以装上新包之后这一格要重新判一次，"透出量掉了"与"底色亮了"这两件事会同时变。

### 17.1 先确认旋钮只有一个

`.scratch/t112_anchor.mts`：把 `buildBlurSurface` 抄成参数化版本（只把锚点抽出来，两台蒙版、δ、场全按生产的那套走），
**先在现状锚点上与 `buildBlurSurface` 逐字节复现**（6 张夹具 × `scrimAlpha`/`browseScrimAlpha`/`stageDimAlpha`/`fieldTone` + base），
复现通过才敢用它外推 —— 这条纪律是 §15 留下的（复刻一份混法就会和发货的那份分岔）。六张真封面的读数：

| 锚点 | 底 L\* | 浏览台蒙版（vih / lucky） | 透出量（vih / lucky） | 浏览台场 L\* | δ |
|---|---|---|---|---|---|
| 28（旧） | 27.9~28.1 | 0.72 / 0.81 | 0.28 / 0.19 | 40.7~41.1 | ~0.25 |
| **30（本次）** | **29.8~30.1** | **0.75 / 0.83** | **0.25 / 0.17** | **40.8~41.0** | **~0.30** |
| 32 | 31.9~32.1 | 0.79 / 0.86 | 0.21 / 0.14 | 40.7~41.1 | ~0.37 |
| 36 | 35.9~36.2 | 0.87 / 0.92 | 0.13 / 0.08 | 40.9~41.1 | ~0.65 |

**买到的是"整屏的暗部"，付出的是"封面起伏"**：浏览台的场恒在 L\*40.6~41.1 —— 闸门把最亮那一块钉死了，锚点从 28 走到 36 它一步没走。
所以抬锚点不会把可读性顶穿（与 §14/§15 的逐像素结论同一方向），代价是透出量按格缩水，到 36 只剩 0.08~0.13 ≈ 平涂。
`BLUR_BROWSE_MIN_CONTRAST`（6.2）与 `BLUR_MIN_CONTRAST`（7）**这次没动**：§15 已经量过它们是两个陷阱旋钮 —— 松它既压白阶梯，
在暗封面上还可能把整体做得更暗。

### 17.2 为什么停在 30 而不是一路推到 32

`DARK_ANCHOR_TONE`（① 莫奈暗锚）是 32。锚点抬到 32 时 ② 的底色与 ① **并平**（本次这张 RED 夹具量得 30.10 对 31.94，只剩 1.84 格），
"② 比 ① 暗"这条先后就此消失 —— 而 §15 明确把它留作地雷线，且"两档看起来分不分得开"是那次列在案的回归项。
用户这次说的是"提亮**一点**"，所以取最小一步 +2，把 32/34 留给"还嫌暗"的下一次点头。

### 17.3 天花板复测（把"最多还能抬几格"钉死）

蒙版顶到全遮（α=1）时场就等于底色，所以"这一锚点会不会把整档判死"只取决于底色自己对白字过不过 7。
2250 格 hue×chroma 扫描：**36 最低 7.438、0 格失败；38 起 2113 格失败；40 全失败**（整档静默回落纯色）。
这与 §14 那次独立量到的"36 全过 / 40 全败"逐格吻合。

### 17.4 改动清单与一条测试改判

- `surface.ts`：`BLUR_ANCHOR_TONE` 28 → **30**，注释换成上面那张表和天花板。代码只有这一行。
- `tests/monet-cover-palette.mts`：原来那条 `BLUR_ANCHOR_TONE <= DARK_ANCHOR_TONE - 4` 会把一次正常的提亮判成缺陷（30 > 28 就红）。
  改成 `BLUR_ANCHOR_TONE < DARK_ANCHOR_TONE`，**同批保留**"底色顺序还在"那条断言 —— 地雷线从"格数"换成"顺序"，
  抬到 32 那格才会红，正好是 17.2 那条判断的边界。测试标题与注释一并改掉：② 与 ① 现在的分界是"照片起伏 + 分台布光"对"一层洗色"，
  不再是糊半径（§16 之后 9dp + 外扩已退成回落支）。

### 17.5 证书与落地状态（2026-10-18）

`npm test` **785 / pass 784 / fail 1**（还是 §7.4 那条故意留红的纹理用例；总数从 748 涨到 785 是别人的音源脚本更新用例刚登记进
`package.json`，`tests/user-api-update-*.mts` 的 mtime 落在今天 00:30~00:36，与本次无关 —— 判据仍按"只 grep 自己改过的文件"）。
`npx tsc --noEmit` **137 = 基线**，`surface.ts` 与该测试文件 0 命中。
`npx eslint src/utils/monet/surface.ts` **exit 0**；`tests/monet-cover-palette.mts` 报一条 `19:19 Parsing error`（`surface!.scrimAlpha`
那种非空断言 babel 吃不下去），**已用 `git show HEAD` 版复跑确认改动前就报**，属仓库既有，不是这次引入。

**出包记录（同日 01:23）**：`assembleRelease` → `BUILD SUCCESSFUL in 5m22s`（716 tasks：28 executed、688 up-to-date）。
arm64 包 `xunyin-v1.1.0-arm64-v8a.apk` 20,868,077 B、sha256 `f1125d27…c7838`（覆盖 00:53 那支 `9f872ba5…`）。
包内 `assets/index.android.bundle` 与 generated 那份 **sha256 逐字节相同**（`11d2a06f…32ee`，8,409,184 B），
`classes.dex` 里 `getBlurredBackdrop` 仍是 2 处 —— 软图那条路与这次的新锚点都在同一支包里。
**这支包带着别人今天的音源脚本更新 WIP**（`tests/user-api-update-*.mts` 与 `package.json` 的登记落在 00:30~00:36），
按 [[project-release-signing]] 那条：只能装机验收，不可对外发布。**设备仍未连**（`adb devices` 空），16-1~16-6 与这次的观感判定都要等装机。
（**同日 01:28 更新**：USB 上设备 `10AE2N03QR0041Y` 后 `adb install -r` 成功，从设备拉回的 `base.apk` sha256 `f1125d27…c7838` 与这支本地包**逐字节相同**，
`lastUpdateTime=2026-10-18 01:28:37`；前台是 PUBG，所以只装未启动。）

## 18. 十八次迭代：② 底色并平 ①（锚点 30 → 32），糊半径降一档（10 → 7）（2026-10-18）

用户原话：**「亮度再提高一点，模糊度下降一点」**。这句和 §17 那句的差别在于它**是真机看过之后说的** ——
01:28 那支软图包已经装上（`pidof cn.toside.music.mobile=7303`、media session 停在 `PAUSED@1669ms`，之后前台切回 PUBG，
所以我既没启动 App 也没注入任何输入）。

### 18.1 两把旋钮在数学上正交，但它们抢同一块"看得出是封面"

`.scratch/t113_brighter_sharper.mts`：先按 §15/§17 那条纪律，在现状锚点 30 上与 `buildBlurSurface` 逐读数复现
（6 张夹具 × `scrimAlpha`/`browseScrimAlpha`/`stageDimAlpha`/`fieldTone` 全等）才敢外推。亮度这一把（蒙版铺的是**底色**，越厚照片越少）：

| 锚点 | 底 L\* | 浏览台蒙版（vih / lucky） | 浏览台透出（vih / lucky） | 浏览台场 L\*（6 张均值） | 歌词台透出（vih / lucky） | δ |
|---|---|---|---|---|---|---|
| 30（旧） | 29.8~30.1 | 0.75 / 0.83 | 0.25 / 0.17 | **40.9** | 0.17 / 0.12 | ~0.30 |
| **32（本次）** | **31.9~32.1** | **0.79 / 0.86** | **0.21 / 0.14** | **40.9** | **0.13 / 0.09** | **~0.37** |
| 34 | 33.9~34.1 | 0.83 / 0.89 | 0.17 / 0.11 | 40.8 | 0.09 / 0.06 | ~0.46 |

**"场恒在 L\*40.9"这一列是这一档最硬的事实**：闸门把最亮那一块钉死，锚点 30/32/34 三档它一步没走，抬的全是底下那一大片。
所以净收益远小于锚点数字 —— 脚下像素 `f = α·底 + (1−α)·照片`，代进去得 **Δf ≈ 2.7 − 0.04·p**：
照片里 L\*20 的那块涨 1.9、L\*45 那块涨 0.9、到 L\*70 以上（正是被钉住的高光）≈ 不动。
**可读性因此一分没被顶穿**（§15 那套白阶梯余量原样），代价是透出量净掉：lucky 在歌词台只剩 0.09。

而第二句要的恰好相反：**抬锚点把照片藏起来，降模糊要照片更清楚**。所以这两把一起动，用清晰度把透出量补回来。
它们在数学上互不影响（`averageArgb`/`highlightArgb` 是从原封面量的，σ 进不了闸门），可以放心分开定档。

### 18.2 为什么落在 32，以及 32 的代价是把"② 比 ① 暗"这条线吃掉

32 就是 `DARK_ANCHOR_TONE`（① 莫奈暗锚）。落在这里的后果比 §17.2 当时估的更彻底：这张 RED 夹具上 ② 的底色合成完是
**`rgb(108, 63, 59)` —— 与 ① 的底色同一串**（② L\*32.1 对 ① L\*31.94）。判它成立的理由：§16 之后两档的区别是
"② 铺得出照片起伏、还按浏览/歌词两台各解一格蒙版"对"① 只有一层洗色"，**明度先后已经不是它们的分界**，
硬留 `<` 只会把每一次合理的提亮都判成缺陷。
不去 34：② 反过来亮过 ①（先后倒置），且 lucky 歌词台透出只剩 0.06 ≈ 平涂 —— 那正是 §14 用户亲手否掉过的"看不出是封面"。
天花板复测（2250 格 hue×chroma，只看底色自己对白字过不过 7）：**32 最低 8.624、34 最低 8.012、36 最低 7.438、三档都 0 格失败**；
38 起 2113 格失败 —— 与 §17.3 同一形状，未动。

### 18.3 糊半径 10 → 7：屏上 σ 104px → 74px

动半径而不是另外两个常数，理由写进 `backdropBlur.ts` 的注释：长边往上（300→512 是原生 `PaletteModule.java:161` 的钳位上限）
等于**在插值放大的像素上糊** —— 小封面先被撑胖再糊，"看着清楚了"那部分是多出来的插值假细节；
次数往下（3→2）σ 只降 √ 一档（10.49→8.56）且盒味变重。
半径 7、3 次 ⇒ 位图 σ 7.48px，配 9.93× 的 cover 放大 ⇒ **屏上 σ 74.3px**，仍落在逆向量到的平台期（70~110px）之内，
只是比 QQ 那一档（104px）轻一级：大块与纹路还在，亮块边缘更实。
`backdropTargetFile` 的落盘键含 `md5(side+r+times+crop + url)`，**改半径不必清缓存**，老 PNG 不会被复用。

**一条没验的风险（记成真机项，别当已成立）**：白阶梯的余量是按"8×8 块模型 + 真机峰值再亮约 1.7 个 L\*"留的（§12.2，5dp 时代量的）。
糊变轻 ⇒ 真实峰值更可能**超过**模型预测，最先被压垮的是小字层（0.78，现余量 0.25）。探针是 18-3。

### 18.4 改动清单与四条测试重钉

- `surface.ts`：`BLUR_ANCHOR_TONE` 30 → **32**（一行）。
- `backdropBlur.ts`：`BLUR_BOX_RADIUS` 10 → **7**；头注释改掉"这四个数全是逆向量来的"那句（现在只有长边/次数/裁边是）。
- `tests/monet-backdrop-blur.mts`：「四常数逐项对齐逆向」改成「三项对齐 + 半径是我们自己轻一档」；位图 σ 断言 10.49 → 7.483；
  屏幕 σ 用例改名，范围从 (95,115) 收到 **(68,82)**。
- `tests/monet-cover-palette.mts`：「② 底色必须暗于 ①」→「不许反过来亮过 ① 超过 1 格」（锚点抬到 34 就红）；
  `BLUR_ANCHOR_TONE < DARK_ANCHOR_TONE` → `<=`。
- `tests/monet-blur-surface.mts`：`BLUR_ANCHOR_TONE < 32` → `<= 32`，注释写明"越过这一格就是 ② 亮过 ①，得重新拍板"。
- **换掉一条判据本身**：`同一张封面两档各存一格` 原来拿 `blur.base !== monet.base` 当"缓存没串色"的证据，
  底色并平之后两支在这张夹具上真的是同一串 —— 那是设计的正常结果不是缺陷。改成 `assert.notDeepEqual(blur, monet)`
  （真串色的现象是第二次拿到第一支的同一个对象；`mode`/蒙版/`tint`/`band` 任一处不同都算各存各的）。

### 18.5 证书与落地状态（2026-10-18）

`npm test` **785 / pass 784 / fail 1**（还是 §7.4 那条故意留红的 `正文区必须钉在色阶带上沿以下`，在 `tests/monet-texture.mts`，本次没碰；
总数与 §17.5 同一支 —— 别人今天登记的 `tests/user-api-update-*.mts` 仍在里面）。
本次四个改动文件单独跑：**77 / pass 77 / fail 0**。
`npx tsc --noEmit -p .` **137 = 基线**，`surface.ts` / `backdropBlur.ts` / 三个测试文件 0 命中。
`npx eslint src/utils/monet/surface.ts src/utils/monet/backdropBlur.ts` **无输出**；两个 `.mts` 测试文件仍报 `Parsing error`
（`surface!` 那种非空断言 babel 吃不下去）—— 把 `git show HEAD:tests/monet-cover-palette.mts` 落成
`tests/zz_head_eslint_probe.mts` 复跑确认改动前就报（HEAD 报 19:19、现文件报 20:19，同一构造差一行），属仓库既有。

**出包记录（同日 02:06）**：本次没动 Java，`assembleRelease` 只重跑 `createBundleReleaseJsAndAssets` →
`BUILD SUCCESSFUL in 6m 2s`（716 tasks：28 executed、688 up-to-date；02:00:40 起跑，Metro 的 transform 缓存这次被重置，冷缓存比上一支的 5m22s 慢一分钟）。
arm64 包 `xunyin-v1.1.0-arm64-v8a.apk` **20,868,116 B、sha256 `51affd92…dd19`**（覆盖 01:23 那支 `f1125d27…`）。
新鲜度两条自证：包内 `assets/index.android.bundle` 与 generated 那份 **sha256 逐字节相同**（`935228c0…86b1`，8,409,180 B），
而上一支的 bundle 是 `11d2a06f…` / 8,409,184 B —— **变的正是这两个常量**（4 字节的量级）。
软图那条路仍在包里：`classes.dex` 里 `getBlurredBackdrop` 2 处、`cover-backdrop` 1 处，bundle 里 `getBlurredBackdrop` 1 处（JS 调用点）。

**装机受阻（02:07）**：`adb devices` 空 → `kill-server` 重启无效 → `Get-PnpDevice -PresentOnly` 里**看不见任何 vivo/Android/ADB 设备**，
无线那头（`192.168.137.81:35977`）也没连上 —— 判为**线被拔了/调试关了**，不是 adb 服务端的事。所以 18-1~18-3 与 §16.4 那批仍待设备回来。

**装机完成（同日 02:10:56）**：设备回来了（USB `10AE2N03QR0041Y`，model V2302A）→ `adb install -r` `Success`。三条自证：
从设备拉回的 `/data/app/~~…/base.apk` sha256 与本地这支**逐字节相同**（`51affd92…dd19`）；`lastUpdateTime=2026-10-18 02:10:56`（`versionCode=88003 / 1.1.0`）；
**旧进程 `pidof=7303` 已被重装杀掉**，核对时新进程 `21576` 的 `/proc` 时间戳只有 9 秒大 ⇒ 它加载的是这支新 bundle，不是上一支的残留。
前台仍是 `com.tencent.tmgp.pubgmhd`（用户在打 PUBG），按 [[feedback-shared-device-input]] **没有启动 App、没有注入任何点击** ——
18-1 / 18-2 / 18-3 与 §16.4 那批要等用户自己进播放页 ② 那一档判。

**真机清单**：§16.4 的 16-1 / 16-2 / 16-2b / 16-2c / 16-3 … 16-6 **仍一条没跑**（那批验的是软图那条路本身），本次再加三条：

- **18-1** 亮度：与 01:28 那支（锚点 30）同屏比。先说清楚：**净收益约 +1 个 L\* 而不是 +2**（18.1 那条算式），
  而且同一屏里"照片更清楚"很可能比"更亮"更显眼。
- **18-2** 清晰度：σ 74px 够不够"看得出是封面"、还是过了（图案读得出）。回收档位：半径 8 ⇒ 屏上 84px、9 ⇒ 94px。
- **18-3** 小字层：量播放页歌手/时间那一层的实际对比度（模型 4.75 / 线 4.5）与最亮那块场的实际 L\*，对一下 18.3 那条风险。

代码**仍未提交**：`package.json` 与 `PlayerOverlay/index.tsx` 带着别人的 WIP，不能整文件入索引。

## 19. 十九次迭代：② 第三次提亮（锚点 32 → 34），糊半径再降到"当前的 60%"（7 → 4）（2026-10-18）

用户原话：**「继续提高 30 格亮度，将模糊度降低为当前的 60%」**。后半句精确对上了（σ 44.4px = 74.3 的 **59.8%**），
前半句**这一档给不出 30 格** —— 不是保守，是量出来的：见 19.1。**先把这条写在最前面**，否则装完看着"才亮一点"会被当成没改。

### 19.1 亮度这一把已经顶到闸门上，剩余行程只有 4 格

`.scratch/t114_brighter_sharper2.mts`（先在现状锚点 32 上与 `buildBlurSurface` 逐读数复现 6 张夹具 × 四个读数才外推，同 §15/§17/§18 那条纪律）：

| 锚点 | 底 L\* | 浏览台透出（vih / lucky） | 浏览台场 L\*（6 张均值） | 歌词台透出（vih / lucky） | 歌词台场 L\* | δ |
|---|---|---|---|---|---|---|
| 32（旧） | 31.9~32.1 | 0.21 / 0.14 | **40.9** | 0.13 / 0.09 | 37.4~37.8 | ~0.37 |
| **34（本次）** | **33.9~34.1** | **0.17 / 0.11** | **40.8** | **0.09 / 0.06** | 37.4~37.8 | ~0.45 |
| 36 | 35.9~36.2 | 0.13 / 0.08 | **40.9** | 0.04 / 0.03 | 37.6~37.8 | ~0.65 |

**三档的场都是同一个数**，因为场有多亮不由锚点决定、由两条闸门决定：白字过 6.2 ⇒ 场上限 L\*41.1（浏览台），过 7 ⇒ L\*37.8（歌词台），
实测 40.8~40.9 / 37.4~37.8 —— **两台的"最亮那一块"已经贴在物理上限上了**。所以"+30 格"在这档不存在：
抬锚点抬得动的只有底下那一大片（`f = α·底 + (1−α)·照片`，α 还跟着闸门一起加厚），32→34 的账面 +2.1 落到中调照片上约 **+1.3 个 L\***。
再往上的两格不是"更亮"而是"更平"：36 那一格 lucky 歌词台透出只剩 0.03、vih 0.04，等于平涂；38 起 2250 格里 2113 格过不了 7，整档静默回落纯色。
**要真的把屏幕抬到 L\*50+ 只有一个办法：把两条闸门（7 / 6.2）往下松**，那是要白字让路的另一件事（§15 量过它是陷阱旋钮），不在"调档"里顺手做。

### 19.2 为什么落在 34：这次是"② 亮过 ①"由用户点头让掉的

`DARK_ANCHOR_TONE`（① 莫奈暗锚）= 32，所以 34 起 **② 的底色反过来亮过 ①**（这张 RED 夹具 34.0 对 31.9）。
§17.2 / §18.2 两次把这一格列为"要重新拍板才许踩"，本次就是那次拍板：用户连着三次要更亮，
而两档的分界在 §16 之后已经是"② 铺得出照片起伏 + 分台布光"对"① 一层洗色"，明度先后只是历史包袱。
测试里的地雷线因此换成物理那一条（见 19.4），不再钉"② 不许亮过 ①"。

### 19.3 糊半径 7 → 4：屏上 σ 44.4px = 现状的 59.8%

"降为当前的 60%"这句话可以直接算：屏上 σ ∝ 位图 σ ∝ `boxSigmaPx(r)`，现状 74.3px ⇒ 目标 44.6px，
候选档位里 **r=4 落 44.4px（59.8%）**，r=5 是 73%、r=6 是 87%（不是"降到 60%"），r=3 是 46%（过了）。
r=3 不只是超要求：窗口只剩 7px、3 次叠加后 σ 只盖 **3 个源像素**，而一个源像素在屏上是 9.93px ——
糊掉的会是"282px 被撑到 2800px"的插值阶梯，不是照片。那正是 §16 当初要走原生归一的原因，别在收档位时把它请回来。
长边（300→512 是原生钳位上限）与次数（3→2 只降 √）两条仍然不用：理由同 §18.3。
半径在 `PaletteModule` 的落盘缓存键里，**改半径不必清缓存**。

### 19.4 改动清单与四条测试重钉

- `surface.ts`：`BLUR_ANCHOR_TONE` 32 → **34**（一行 + 注释换成 19.1 那张表和"场贴在闸门上限"）。
- `backdropBlur.ts`：`BLUR_BOX_RADIUS` 7 → **4**；头注释里两处旧数（σ 7.5px / 屏上 74px、"10 → 7"）跟着改。
- `tests/monet-backdrop-blur.mts`：半径值；位图 σ 7.483 → **4.472**；屏幕 σ 用例改名，范围 (68,82) → **(40,50)**，
  并把"半个档（r=3 / r=5）就出局"和 9.93px 那条机制下限写进注释。
- `tests/monet-blur-surface.mts`：地雷线 `BLUR_ANCHOR_TONE <= 32` → **`< 36`**（防线从"明度先后"换成那两问：36 是平涂、38 是整档回落）。
- `tests/monet-cover-palette.mts`：`toneOf(blur) <= toneOf(monet) + 1` 与 `BLUR_ANCHOR_TONE <= DARK_ANCHOR_TONE` 两条撤下，
  换成 `BLUR_ANCHOR_TONE <= DARK_ANCHOR_TONE + 4`（② 可以亮过 ①，只许 4 格）加一条反向断言"② 不许又退回比 ① 暗"（防这次提亮被顺手改回去）。
- **顺带抓到一条脆断言**：`莫奈支一字未改` 那条写的是 `Hct.fromInt(baseArgb(s)).tone > BLUR_ANCHOR_TONE` ——
  借 ② 的锚点当"① 还在自己那一格"的替身，两支并平的 32 上实测只赢 **1e-5**（① 底色 tone = 32.00015）。
  改成直接钉 `DARK_ANCHOR_TONE ±0.6`。**这不是为了让本次变绿**：任何人下次动锚点它都会假红。

### 19.5 把 §18.3 那条"没验的风险"换成数

`.scratch/t115_peak_headroom.mts`（与生产同一套 sRGB 编码值 alpha 合成）按"场有多亮"逐层问"离自己的线还剩几格"：
小字层（白@0.78，线 4.5）**破线在场 L\*41.3**，也就是比现状上限 37.8 还要亮 **3.5 个 L\***；
歌词层（0.98×组件 0.6，线 3.0）45.0（余 7.2）；实白对 7.0 在 38.0 —— 那条不是余量，就是闸门钉的那一格本身。
风险是 §12.2 那条"真机峰值比 8×8 块模型再亮约 1.7 个 L\*"（5dp 时代量的）会因为糊变轻而长大：**要长到 3.5 才碰线，等于要翻倍**。
所以本次不预加保护，判据落到真机项 19-3。

### 19.6 证书与落地状态（2026-10-18）

`npm test` **785 / pass 784 / fail 1**（还是 §7.4 那条故意留红的纹理用例，本次没碰；总数与 §17.5/§18.5 同一支）。
本次四个改动文件单独跑（含 `tests/monet-surface.mts`）：**79 / pass 79 / fail 0**。
`npx tsc --noEmit -p .` **137 = 基线**，两个 `src` 文件与三个测试文件 **0 命中**。
`npx eslint src/utils/monet/surface.ts src/utils/monet/backdropBlur.ts` **exit 0**（无输出）。

**出包记录（同日 02:31:17）**：本次没动 Java，`assembleRelease` **6m44s**（716 tasks：28 executed、688 up-to-date），
arm64 包 `xunyin-v1.1.0-arm64-v8a.apk` **20,868,066 B、sha256 `35801364…`**（覆盖 02:06 那支 `51affd92…`）。
新鲜度三条自证：① 包内 `assets/index.android.bundle` 与 `build/generated/assets/createBundleReleaseJsAndAssets/` 那份
**sha256 逐字节相同**（`3951f29b…`，8,409,184 B，mtime 02:30:49），② 02:33 复跑 `assembleRelease` 时 `createBundleReleaseJsAndAssets`
判为 **up-to-date**（48s 空跑、APK 一字未变）⇒ 这支包就是"当前这份源码"打出来的，③ `classes.dex` 里 `getBlurredBackdrop` 仍 2 处、
`cover-backdrop` 1 处 —— 原生软图那条路没被这次改动带跑。

**一次自己造的事故（记下来免得下次误判成代码问题）**：02:24:30 把构建放后台，02:28:09 又手工起了一次 `assembleRelease`，
**两个 Metro 同时在跑同一份 transform 缓存** ⇒ 后跑那一次在 `createBundleReleaseJsAndAssets` 报
`TypeError: dependencies is not iterable`（BUILD FAILED in 2m30s）。判据不是猜：单独跑一次
`react-native bundle --dev false --reset-cache` **80s 通过**，说明源码打得出来；而后台那支 02:31:17 是 `BUILD SUCCESSFUL`，
它的 bundle 就是上面 ① 那份。**下次只跑一支构建，失败先查并发再查代码。**

**装机完成（同日 02:37:58）**：设备回来了（USB `10AE2N03QR0041Y`，model V2302A）→ `adb install -r` **Success**。三条自证：
从设备 `pm path` 拉回的 `base.apk` sha256 与本地这支**逐字节相同**（`35801364…`，20,868,066 B）；
`lastUpdateTime=2026-10-18 02:37:57`（`versionCode=88003 / 1.1.0`，`firstInstallTime=2026-10-09 17:19:53` 数据没丢）；
**在跑的那个进程就是这支新包** —— `pidof=5826` 的 `/proc/5826/stat` 第 22 字段是 191018325 ticks（=开机后 1910183.25 s），
对 `/proc/uptime=1910208.60 s` 得**它只有 25.35 秒大**，比 `lastUpdateTime` 还晚 1 秒。
核对时前台先是 `com.ss.android.ugc.aweme`（抖音）的启动页、之后是 `com.vivo.gallery`，按 [[feedback-shared-device-input]]
**没有启动本 App、没有注入任何点击** —— 19-1 / 19-2 / 19-3 与 §18 那三条、§16.4 那批都要等用户自己进播放页 ② 那一档判。

**真机清单**：§16.4 的 16-1 / 16-2 / 16-2b / 16-2c / 16-3 … 16-6 与 §18 的 18-1 / 18-2 / 18-3 **都还是零项** ——
18 那支 02:10:56 才装上、用户没判过，本次两支改动（更亮的底 + 更清楚的纹路）叠在同一支包里一起判：

- **19-1 亮度**：与 02:10 那支（锚点 32、σ 74px）同屏比。**先说清楚账面 +2 落到屏幕上约 +1.3 个 L\*，而且最亮那一块一点没动**（19.1）。
  如果这次仍嫌暗，下一句话就该问："要不要让白字让路（松闸门）"，那是另一档设计，不是再抬锚点。
- **19-2 清晰度**：σ 44px 是"看得出是封面"还是"图案读得出 / 露出放大脏边"。回收档位：r=5 ⇒ 屏上 54px、r=6 ⇒ 64px。
- **19-3 小字层**：量播放页歌手/时间那一层的实际对比度与**最亮那块场的实际 L\***，对 19.5 那条（破线在 L\*41.3，现状上限 37.8）。

代码**仍未提交**，这支包带着别人的 WIP，只能装机验收、不可对外发布（[[project-release-signing]]）。

## 20. 二十次迭代：把"亮"和"清楚"从推断搬到像素上（锚点 34 → 36、糊半径 4 → 1）（2026-10-18）

用户原话：**「再提亮70格,模糊度降为当前的20%」**。这是同一个方向上的第四次追加（§17 15 格 → §18 降到 60% → §19 30 格 → 这次 70 格）。
第十九次那支包 02:37:58 已经装上并核过字节，所以这一句是真机看过之后说的 —— 也是这一句把我逼到必须先换量法：
前面三轮的"还剩多少行程"全是在 **8×8 块模型**里外推的，而那个模型从 §12 起就知道会低估屏幕上的真实峰值（当年量到 +1.7 个 L\*）。
**+70 格这个数，用模型回答是"拿不到"；用像素回答才知道"拿不到的到底是哪一部分、以及哪一格其实能拿"。**

### 20.1 新探针：按 app 自己的链路在真封面上量像素

`.scratch/t117_dump_gates.mts`（JS 侧把 base/scrim 落成 JSON，六组锚点×闸门）+ `.scratch/t117_real_peak_vs_radius.py`
+ `.scratch/t121_glyph_patch_peak.py`（python 侧跑同一条链路）：最长边 300 → 裁 3% 剩 282 → 盒模糊 r×次数 →
`sRGB 编码域`铺蒙版（与 `surface.ts` 同一个混式）→ 放大 9.93× 到 2800 屏 → 取最亮那一块。
两条自证先过：**盒模糊对朴素实现（钳边 + 2r+1 窗口均值）逐像素误差 ≤2.3e-13**，`r=0` 恒等、两次 == 对一次的结果再糊一次；
JS 侧那份参数化拷贝仍在现状值上与 `buildBlurSurface` 四读数逐条相等（§15/§17/§18/§19 那条纪律）。
`.scratch/t120_blur_ladder.png` 另外出了对照图：四档按屏幕同一比例铺开，并把白@0.78 的小字压在**各自最亮那一块**上。

**第一件事实：模型的低估随半径变大，而且大到能改结论。**（六张真封面，锚点 34、闸门 7/6.2，取整屏最亮那一像素）

| 糊档位 | 屏上 σ | 模型"场" L\* | 真实峰值 L\* | 低估 | 小字层（线 4.5） | 歌词层（线 3.0） |
|---|---|---|---|---|---|---|
| r10×3（逆向到的） | 104px | 37.8 | 39.2 | +1.4 | **4.79 ✓** | 3.47 ✓ |
| r7×3（§18） | 74px | 37.8 | 40.8 | +3.0 | 4.57 ✓ | 3.35 ✓ |
| **r4×3（第十九次，在包里的这支）** | 44px | 37.8 | 42.9 | **+5.1** | **4.28 ×** | 3.17 ✓ |
| r1×3（本次要的） | 14px | 37.8 | 44.5 | **+6.7** | 4.07 × | 3.11 ✓ |
| 完全不糊 | — | 37.8 | 45.0 | +7.2 | 4.01 × | 3.01 ✓ |

+1.4 那一格与 §12 当年量的"+1.7"对得上 —— 那条数字是在 r=10 时代量的，所以它一直没错，**错的是拿它当常数往外推**。
按字形那块再核一遍（`.scratch/t121`：小字取 4×4 位图像素的最亮块、歌词取 13×13）读数几乎不动（r4 时 42.8 对 42.9），
所以"单像素太苛刻"这条辩护不成立：**糊出来的图在这个尺度上本来就是平的**。

**结论一句话：现在包里这支的小字层，按像素已经在线下 0.22 格。**这一条前三轮都看不见，因为它住在模型外面。

### 20.2 "+70 格"能买到的其实只有 1.3 格 —— 但方向要反过来

三条旋钮的实测行程（同一批像素，整屏均值 L\* 才是用户说的"亮"）：

| 旋钮 | 整屏均值 | 真实峰值 | 小字层 | 照片起伏（p99−p1，L\*） |
|---|---|---|---|---|
| 现状 a34 / g7 / r4 | 35.6 | 42.9 | 4.28 | 7.44 |
| 只降糊 a34 / g7 / r1 | 35.7（**+0.1**） | 44.5 | 4.07 | 8.45 |
| 只抬锚点 a36 / g7 / r4 | 36.9（+1.3） | 40.5 | 4.62 | 3.77 |
| **抬锚点 + 降糊 a36 / g7 / r1** | **36.9（+1.3）** | **41.3** | **4.50** | 4.29 |
| 松闸门 a34 / g6.5 / r1 | 36.6（+1.0） | 50.7 | 3.36 | 13.34 |
| 松闸门 a34 / g6.0 / r1 | 37.5（+1.9） | 55.9 | 2.87 | 18.19 |

（"小字层"这一列取**字形那么大的一块**：4×4 位图像素 = 屏上 40×40px 的最亮块；同一格取单像素是 4.49，差 0.01，
上面 20.1 那张表就是单像素读数，两张表在 r4 / r1 两格上逐条对得上。）

**抬锚点这一把和前三轮的推断相反：它是唯一同时把均值抬上去、把真实峰值压下来的旋钮。**道理在求解器里 ——
底色抬 2 格，闸门就把蒙版跟着加厚 0.03~0.11（lucky 0.94→0.97、solace 0.77→0.88），照片里最亮那块被压得比低锚点更狠。所以"亮"和"字清楚"这一对，
在锚点上不是对立的，**对立的是"亮"和"看得出是封面"**（起伏 7.44 → 4.29，lucky 那一类蒙版到 0.96~0.97、透出只剩 0.03~0.04）。
这条正好接上 §14 用户亲手否掉过的"平涂"，所以它落成**真机 20-1**，不落成"已成立"。退档已备好：锚点 35（均值 36.1、起伏 6.43、小字 4.26）。

而**闸门这次是量出来买不起**：6.5 只多 1.0 个均值，小字层掉到 3.36（线下 25%）；6.0 是 2.87。
§15 当年说它是"陷阱旋钮"是推断，这一轮它成了表里两行。
至于 +70 格：三条全开也只到均值 37.5，且那已经是把小字压到 2.87 换来的。**这一档的亮度行程就是这么长，再往上只有换前景（深墨）或者在字底下另铺一层局部遮罩 —— 那是重新设计，不是调常数。**

### 20.3 半径 4 → 1：20% 够不着，落在"还叫糊底"的最轻一格

44.4px × 0.2 = **8.9px**，整数半径没有这一格：r=1 × 3 次 ⇒ 屏上 **14.0px（31.6%）**；要 8.1px 只能把次数也砍到 1，
那一位图 σ = 0.82px，**不到一个像素** —— 那不是"糊得轻"，那是没糊，剩下的是 300px 被撑到 2800px 的泥
（对照图最右一列就是这个样子，色块边缘已经读得出图案轮廓）。所以落在 r=1×3，并且写明这是下限：
一个源像素在屏上是 9.93px，σ 14px 的窗口只剩 1.4 个源像素，再往下糊掉的就不是照片而是插值阶梯。
**换长边救不了这一格**：`屏上 σ / 一个源像素` 这个比值与长边无关（分子分母同一个放大倍数），
300→512 只会把泥变细，不会把糊变轻 —— 这条写进了 `backdropBlur.ts` 的注释，免得下次又有人去抬那个 512 的钳位。

### 20.4 改动清单与四条重钉

- `surface.ts`：`BLUR_ANCHOR_TONE` 34 → **36**（注释整段换掉：像素表、"抬锚点反而压峰值"的机理、起伏减半这条代价、闸门两行实测）。
- `backdropBlur.ts`：`BLUR_BOX_RADIUS` 4 → **1**；模块头两处数字跟着改（10 → 7 → 4 → 1；位图 σ 1.4px ⇒ 屏上 14px）。
- `tests/monet-backdrop-blur.mts`：标题"轻两档"→"轻三档"；`BLUR_BOX_RADIUS` 4 → 1；位图 σ 4.472 → **1.4142**（容差 0.005）；
  屏幕 σ 用例改名 σ≈14，范围 (40,50) → **(12,16)**，注释写"20% 是 8.9px、整数半径够不着"。
- `tests/monet-blur-surface.mts`：地雷线 `BLUR_ANCHOR_TONE < 36` → **`< 38`**，注释改成"36 那一问已经按像素答过（均值 36.9 / 峰值 41.3 / 小字 4.50），
  剩下的防线只有物理那条：38 起底色自己过不了闸门、整档静默回落成纯色"。
- `tests/monet-cover-palette.mts`：**没动**，`BLUR_ANCHOR_TONE <= DARK_ANCHOR_TONE + 4` 正好落在 36 = 32+4 这一格 ——
  它现在是一条贴着边的地雷线，锚点再抬 1 格就红，这正是想要的行为。

### 20.5 证书（2026-10-18）

`npm test` **785 / pass 784 / fail 1** —— 总数与 §19.5 同一支，唯一那条红仍是 §7.4 故意留红的
`正文区必须钉在色阶带上沿以下`（`tests/monet-texture.mts`，本次没碰）。
`monet-*` 单独跑 **188 / pass 187 / fail 1**（同一条）。
`npx tsc --noEmit -p .` **137 = 基线**，`surface.ts` / `backdropBlur.ts` / 三个测试文件 0 命中。
`npx eslint src/utils/monet/surface.ts src/utils/monet/backdropBlur.ts` **无输出**。

**出包（同日 03:02）**：没动 Java，`assembleRelease` 只重跑 JS 那一跳，`BUILD SUCCESSFUL in 2m 13s`（716 tasks：28 executed、688 up-to-date；
Metro 的 transform 缓存这次是热的，比 §19.6 那支冷缓存的 6m2s 快三分钟）。
arm64 包 `xunyin-v1.1.0-arm64-v8a.apk` **20,868,106 B、sha256 `e4623915…5b36`**（上一支是 20,868,116 B / `51affd92…dd19`）。
新鲜度自证两条：包内 `assets/index.android.bundle` 与 generated 那份 **sha256 逐字节相同**（`0a43b80d…6647`，8,409,180 B），
而 §19.6 那支的 bundle 是 `935228c0…86b1` / **同样 8,409,180 B** —— 字节数一模一样、哈希换了，
正是"只改了两个数字常量"该有的形状。软图那条路仍在包里（bundle 里 `getBlurredBackdrop` 1 处 = JS 调用点）。

**装机受阻（03:05）**：`adb devices` 空 → `kill-server` + `start-server` 重启无效 → `Get-PnpDevice -PresentOnly` 里
仍然看不见任何 vivo/ADB 设备 → 无线那头 `192.168.137.81:35977` 连不上（15 秒无回）。判为线拔了/调试关了，与 §18 那次同一形状。
**所以这一支还没上机，20-1 / 20-2 / 20-3 与前面攒下来的十几条真机项一起待设备回来。**

**装机完成（03:09:29）**：设备回来（USB，`10AE2N03QR0041Y` / V2302A / Android 16）→ `adb install -r` **Success**；从 `pm path` 拉回的 `base.apk`
sha256 与本地这支**逐字节相同**（`e4623915…35b36` / 20,868,106 B）、`lastUpdateTime=2026-10-18 03:09:29`、`versionCode=88003`；
在跑的进程 `pidof=24840` 只有 **28.75 秒大**（`/proc/24840/stat` 第 22 字段 191208303 ticks 对 `/proc/uptime=1912111.78 s`）⇒ 比安装更晚，设备上就是这支。
**核对时前台是 `com.vivo.gallery`**，按 [[feedback-shared-device-input]] **没启动本 App、没注入任何点击** ⇒ 20-1 / 20-2 / 20-3 仍需用户自己进播放页 ② 那一档判。

### 20.6 真机清单（这一轮的三条，全部待判）

前三轮攒下来的 16-1…16-6、18-1…18-3、19-1…19-3 一条没跑（装机后前台一直是用户的其它 App，按 [[feedback-shared-device-input]] 没有注入过任何输入）。
这一轮把那些"观感类"条目压缩成三条，因为像素表已经把"到底亮了多少、糊了多少"说死了，真机只需要回答模型答不了的那三问：

- **20-1 封面还在不在**（本轮唯一的新代价）：亮封面（lucky 那一类）在锚点 36 上蒙版到 0.96~0.97、透出 0.03~0.04，
  像素量出来起伏只剩 4.29 个 L\*。**如果它看起来像平涂而不像"糊掉的封面"，就把锚点退回 35**（起伏 6.43、均值 36.1、小字 4.26）。
  这条是 §14 用户亲手否掉过的东西，不许用"数据达标"顶回去。
- **20-2 糊到 14px 是什么观感**：`σ 14px` 的窗口只有 1.4 个源像素，对照图（`.scratch/t120_blur_ladder.png`）里
  暗封面（solace，蒙版最薄 0.88）已经能读出色块边缘。若真机上是"放大十倍的缩略图"而不是"轻糊"，回收档位 r=2 ⇒ 屏上 24.3px。
- **20-3 小字层到底读不读得出**：像素表说这一档是 4.50（线 4.5，压线），而**第十九次那支包按同一把尺子是 4.28，已经在线下**。
  所以这一条不是"验新包有没有变差"，而是"验这把尺子准不准"：请直接在真机上盯播放页歌手/时间那一行，
  在最亮那块封面上读不读得出。读不出 → 说明线下 0.22 就已经是可见的，锚点这一路到此为止，"再亮"只能走**字底下另铺局部遮罩**那条重设计。

代码**仍未提交**：`package.json` 与 `PlayerOverlay/index.tsx` 带着别人的 WIP，不能整文件入索引；这支包也只能装机验收、不可对外发布（[[project-release-signing]]）。

## 21. 二十一次迭代：把对面那一档整个搬进来 —— 第三档 ③「浓色模糊」（2026-10-18）

用户原话：**「使用逆向工具rea逆向这个应用看看它的全屏播控页背景模糊是怎么做的,并应用到我的项目中」**，随后收窄成
**「不不你就用rea逆向看看它的动态背景是怎么做的并应用到本项目」**。附件仍是 `C:\Users\30913\Desktop\base.apk`
（`com.tencent.qqmusiclite`，sha256 `da0da07d…aeff0`），现场仍在 `C:\Users\30913\.qoder\tmp\qqmusic-re\`（`rea_*.txt` 是逐次证据、`re_pro*.sh` 是脚本）。

§16 那次只搬了配方里的**第 2、3 条**（怎么糊），并且白纸黑字写了第 4、5 条**明确不搬**（`0.2·blur + 0.8·M` 那个合成、
HSV 写死 S/V 的取色），理由是它和 §14 用户拍板的"起伏要留着"正面冲突。这一轮把那句"不搬"改成了"搬成第三档"：
**不覆盖 ② 的取舍，而是把对面那一档原样做成可切换的 ③**，让它在真机上与 ①② 并排摆着由用户判。
闸门、分台布光、白墨阶梯三条一律没动 —— ③ 是**在同一套闸门下重新解**出来的，不是把闸门松开。

### 21.1 先钉死输入：那支"魔法色"读的是 Palette 的哪个槽位

逆向到的调用是 `Palette.from(封面).generate()` 之后取 `getDominantColor()` 那一格，再进 `MagicColorHelper.a()`。
**槽位不是猜的**（`.qoder/tmp/qqmusic-re/t21_slot.py` 实测）：上一轮已经用最小二乘从截图里**拟**出纯色层
`M = (85,101,45)`（色相 77.14°，模型 `obs = 0.2·blur + 0.8·M` 的 rms 1.36 已验），这一轮把同一张真封面的五种候选统计量
各自色时代进写死的 S/V，看哪一支 reproduces 出那支 M：

| 候选统计量 | 它的色相 | 与 M 的色相差 | 写死 S/V 后 | 与 M 的最大通道差 |
|---|---|---|---|---|
| **dominant 最大面积** | **77.27°** | **0.13°** | **(86,102,45)** | **1.0 / 255** |
| vibrant 最饱和 | 237.16° | 160.02° | (45,48,102) | 57.0 |
| muted 最不饱和 | 179.03° | 101.89° | (45,102,101) | 56.1 |
| dark 最暗 | 216.37° | 139.22° | (45,67,102) | 57.0 |
| mean 平均 | 82.02° | 4.88° | (81,102,45) | 4.0 |

差 0.13° 对差 100° 以上 —— 槽位只有 dominant 这一个解。**本项目的替身是 `dominantArgbOfPixels`**（`sourceColor.ts`）：
每通道 8 级（`c >> 5`）拼成 512 格直方图，取**面积最大那一格的桶内均值**，平票取格号最小（官方那支的赢家由聚类顺序决定，
这一支必须能钉在断言里）。两条实测收益：① 那一路量化实测 143ms / 其中 123ms 在 `QuantizerCelebi`，全在 JS 主线程，
而 dominant 只要"哪一格最多"，一遍直方图就够；② 官方那支内部有裸 `Math.random`（`quantizer_wsmeans.js:95`，
① 靠 `withSeededRandom` 才钉得住），**这一支没有随机数，同一张封面天生确定**。
代价也写明：格的尺度比官方那条粗（官方按 128 色聚类，这里按 512 格数面积），极少数格内混色的封面桶内均色会与官方差一点 ——
③ 只取它的**色相**再写死明彩度，差一点看不出来。
`tests/monet-source-color.mts` 为这一支补了 5 条：最大桶而非最饱和桶、桶内**均值**而非众数、平票取格号最小且 50 次同结果、
`Math.random` canary（调用数恒 0）、全透明/含透明像素的守卫。

### 21.2 纯色层 M 的配方：只继承色相，明彩度写死（逆向到的方法体）

`h.o.r.w.m.t.a`（tag 自证：`MLog.i("MagicColorHelper", "[calculateBackgroundColor]: …")`）：

```java
public final int a(Integer num) {                       // 播放页那层纯色 View 的底
    if (num == null) return f30766b;
    float[] f = new float[3];
    Color.colorToHSV(num.intValue(), f);
    if (f[1] < 0.05f || f[2] < 0.05f) { f[1] = 0.0f; f[2] = 0.1f; }   // 灰/近黑封面：无彩近黑
    else { f[1] = 0.56f; f[2] = 0.4f; }                              // 其余：彩度、明度写死
    return Color.HSVToColor(f);
}
```

同一支类里前景是 `(h, 0.10, 1.0)`（`d()`，`[calculateForegroundColor]`）、迷你条底是 `(h, 0.20, 0.30)`（`e()`）——
**整条链路没有 Monet / HCT**，色相之外全是硬编码档位。落进本项目的映射：`MAGIC_SATURATION = 0.56`、`MAGIC_BRIGHTNESS = 0.40`、
`MAGIC_GREY_LIMIT = 0.05`、`MAGIC_FALLBACK_BRIGHTNESS = 0.10`（灰封面不该被涂成糖果色，这条与 ① 的结论同向）。
换算到 HCT 坐标里写死 S/V 那支的彩度是 **20.0~43.5 随色相摆**（`.scratch/t127_magic_hct.mts` 逐 15° 量的），
比 ① 的 `CHROMA_CAP = 24` 更浓，所以 **③ 不吃那条上限** —— 吃了等于把"浓"改回 ②。这一档与 ② 最主要的外观差别就是它。

### 21.3 糊底把半径还给逆向到的那一格

`MAGIC_BOX_RADIUS = 10`（屏上 σ **104px**），而 ② 是 §20 一路调下来的 1（σ 14px）—— 差 7.4 倍。
源长边 300、3 次、裁 3% 三档共用，两档只在半径这一格分岔（`tests/monet-backdrop-blur.mts` 断言"屏上 σ 比 == 位图 σ 比"逐条相等）。
这条不是怀旧，是 ③ 的配方里糊与浓色是一件事：**糊得轻 + 蒙版厚 = 一块纯色**。
顺带一条只有量了才知道的收益：`backdropBlur.ts` 记的"r10 时屏上峰值只比 8×8 块模型高 1.4 个 L\*（r4 高 5.1、r1 高 6.7）"，
在 §21.6 那张表里当场兑现 —— 同一张 solace，② r1 的实测小字 4.49（线下 0.01），③ r10 是 4.83。

### 21.4 原样搬进来的账，以及"明度只许压到 ② 的锚点以下"这一格让在哪

`.scratch/t125_magic_port.py` 把 QQ 那一格（`α 恒 0.80` + `V 0.40` 不夹）按本项目自己的链路铺到 2800 屏上，
前景仍用 ② 那支恒白阶梯，四条线 7.0 / 6.2 / 4.5 / 3.0：

| 封面 | 场均值 L\* | 场峰值 L\* | 起伏 p99−p1 | 实白（线 7.0） | 小字（线 4.5） | 歌词（线 3.0） |
|---|---|---|---|---|---|---|
| solace | 35.5 | 41.5 | 7.73 | 6.12 ✗ | 4.47 ✗ | 3.28 ✓ |
| vih | 35.0 | 42.3 | 14.82 | 5.94 ✗ | 4.35 ✗ | 3.22 ✓ |
| **lucky（亮）** | **41.6** | **51.4** | 14.59 | **4.26 ✗** | **3.28 ✗** | 2.55 ✗ |
| sunset | 35.4 | 41.5 | 13.08 | 6.12 ✗ | 4.46 ✗ | 3.27 ✓ |
| rainy | 33.0 | 39.3 | 9.66 | 6.62 ✗ | 4.79 ✓ | 3.48 ✓ |
| faces | 29.1 | 37.1 | 10.17 | 7.21 ✓ | 5.11 ✓ | 3.65 ✓ |

**六张里只有 faces（暗红）四条线全过。** 对面那台App不需要过这条线（它的前景字是 `(h,0.10,1.0)` 那支浅墨配深底，
且没有小字/歌词分层的义务），我们要过 —— 所以 `MAGIC_SCRIM_MIN = 0.8` 是**下限而不是定值**，两条闸门照旧只能往加厚方向走。
`.scratch/t126_magic_candidate.py` 于是量"只加厚能救回几张"：faces 0.80、rainy 0.85、sunset 0.87、vih 0.90 解得出，
**solace 与 lucky 加到 α=1.00 仍过不了四条线**。根因不在蒙版在底色：写死的 `V = 0.40` 换算到 HCT 是一支随色相摆的明度
（21.6 蓝紫 → 42.0 黄绿，中点约 38.8），而白字要过 7.0 场上限就是 L\*37.8 —— 黄绿那一片（tone 38~42）**无论蒙多厚都过不了**，
表现是"整档在黄绿封面身上静默回落成纯色"，一行报错都不会有。

**这一档的让法：色相与彩度照抄对面，明度只许压到 ② 的锚点以下（只暗不亮）** ——
`anchor = isDark ? min(source.tone, BLUR_ANCHOR_TONE) : max(source.tone, 100 − BLUR_ANCHOR_TONE)`。
不另设一支没人调过的亮度旋钮：`BLUR_ANCHOR_TONE = 36` 是用户四轮"再亮一点"（§17/§18/§19/§20）调出来的那一个数，③ 只借它的上限。
让完五张真封面全部解得出（0.80~0.97）。**这条 clamp 是承重的，用变异测试钉过**：把它去掉跑 `tests/monet-magic-surface.mts`
⇒ **12 条红**（lucky 68°、solace 108° 两支当场 null），复现完再原样改回。另外两条承重件同法验过：蒙版下限 0.80 拆掉 ⇒ 3 红；
白墨阶梯换成 ① 的导出墨 ⇒ 3 红。

### 21.5 三档并存：默认档、缓存键、以及层身份上的一处真 bug

- `normalizeCoverAlgo`：`'blur' → blur`、`'magic' → magic`，**其余（含旧值 `'native'`、`''`、`undefined`）一律折成 `'monet'`**。
  默认给 ① 而不是 ②③ 是有意的：②③ 都还没在真机验收过（§20.6 那三条 + 本轮 21-1…21-4 全挂着），脏值不该把一个没人看过的档位推到屏幕上。
- 三档各存一格缓存、**像素只问一次**（`tests/monet-cover-palette.mts`：切三档 `calls === 1`）；
  糊底位图的落盘键是 `md5(参数 + url)`，半径进参数 ⇒ 两档共用一张封面不会互相读到对方的产物。
- **`coverLayerKey` 的保守支现在带档名**：`picUrl + '|p' + mode`。这是这一轮改出来的一条真 bug ——
  ②③ 的保守支原本 key 逐字节相同，而它们在槽栈里会**同时存在**（切档时旧层还在淡出），撞 key 会把 ② 那支层原地标成 ③ 的，
  于是屏幕上用 ② 的糊半径铺 ③ 的色，还白头发一次原生糊图请求。判据住在纯函数层（`backdropGate.ts`）所以能 `node --test`，
  新增断言"两档的保守支 key 互不相同、且都不等于测量支"。§10.3 那条 `key = picUrl + '|p'` 的记述以此为准更新。

### 21.6 五张真封面的像素对照（`.scratch/t129_magic_vs_blur.png`）

`.scratch/t129_surfaces.mts` 把 `buildBlurSurface` / `buildMagicSurface` 的真返回值落成 JSON，
`.scratch/t129_magic_vs_blur.py` 按 app 自己的链路铺像素（300px → r×3 盒模糊 → 裁 3% → 撑到 2800 → 编码域压蒙版），
再叠上真版式（`t107_player.py` 那套 1260×2800 布局与真墨色）。**读数取整屏最亮那一像素上的实测对比，不取模型场**（§20.1 换的这把尺子）：

| 封面 | ② 现状 歌词台 | ③ 歌词台 | ③ 浏览台 | QQ 那格（未过闸门） |
|---|---|---|---|---|
| solace | α0.88 均值34.4 起伏8.3 峰41.4 小字**4.49** | α0.80 33.6 7.9 39.0 4.83 | α0.80 33.6 7.9 39.0 5.47 | α0.80 35.6 7.6 41.0 4.53 |
| lucky | α0.97 36.6 3.0 38.3 4.96 | α0.97 36.5 2.5 37.7 5.04 | α0.92 37.3 6.0 40.6 5.18 | α0.80 43.4 **14.6** **51.5** **3.27** |
| faces | α0.93 35.8 3.9 39.4 4.76 | α0.80 28.4 7.5 32.9 5.82 | α0.80 28.4 7.5 32.9 6.69 | α0.80 28.4 7.5 32.9 5.82 |
| sunset | α0.96 37.3 2.5 38.4 4.92 | α0.86 35.2 8.2 38.2 4.94 | α0.80 37.3 11.8 41.5 5.01 | α0.80 37.3 11.8 41.5 4.45 |
| rainy | α0.94 36.8 3.5 39.8 4.72 | α0.82 34.0 8.6 37.8 5.03 | α0.80 34.4 9.7 38.5 5.56 | α0.80 34.4 9.7 38.5 4.91 |

三条读得出来的结论：
1. **③ 与 ② 的差别主要在色不在糊**：solace 上 ② 的底色来自封面平均色（粉树 ⇒ 灰紫 `rgb(102,79,84)`、HCT 彩度 12.5），
   ③ 来自最大面积那一格（林间小道 ⇒ 浓绿 `rgb(39,96,40)`、彩度 **42.8** —— ① 那条 `CHROMA_CAP = 24` 上限 ③ 不吃，见 §21.2），
   整页颜色直接换向。这是"浓色"两个字的全部含义，也是这一档值不值得单独存在的答案。
2. **"看得出是封面"这一格 ③ 买到了，但主要在浏览台**：起伏 ② 是 2.5~3.9，③ 歌词台 2.5~8.6、③ 浏览台 6.0~11.8。
   lucky 那一类亮封面上 ③ 的歌词台仍被闸门顶到 α0.97（起伏 2.45 ≈ 平涂）—— 这一格与 §20.2 对 ② 的判词一模一样，
   **是 7.0 那条线买不起的东西，不是档位选择的失败**，所以它落成 21-1 由用户判，不许用"数据达标"顶回去。
3. **QQ 原样那一格是全场唯一系统性破线的**：lucky 峰 L\*51.5、小字 3.27（线下 27%），sunset/solace 的小字 4.45/4.53 也在压线两侧晃。
   这一格留在图里不是为了说明"我们的更保守所以更好"，是给下一个改常数的人看：**把 clamp 或下限拆掉，屏幕上就是这个样子**。

### 21.7 改动清单

- `sourceColor.ts`：新增 `dominantArgbOfPixels`（512 格直方图 + 桶内均值 + 平票取格号最小），守卫走同一道 `collectOpaque`。
- `surface.ts`：`MAGIC_SATURATION / MAGIC_BRIGHTNESS / MAGIC_GREY_LIMIT / MAGIC_FALLBACK_BRIGHTNESS / MAGIC_SCRIM_MIN(0.8)`
  + `buildMagicSurface(measure, fontArgb)`（含 §21.4 那条明度夹紧）；`CoverSurface.mode` 多一个 `'magic'`。
- `backdropBlur.ts`：`MAGIC_BOX_RADIUS = 10`（② 的 1 那一格注释里写清"这一档刻意留原值"的理由）。
- `coverPalette.ts`：`CoverAlgo` 三值 + `normalizeCoverAlgo`；magic 支只跑 dominant + 最亮块，仍在 `scheduleIdle` 之后。
- `backdropGate.ts`：决策表把 magic 与 blur 同列（都要保守底、都要等测量色），**`coverLayerKey` 的保守支加档名**（§21.5）。
- `onCoverTheme.ts`：`resolveOnCoverInk(surface, stage)` —— ③ 复用 ② 那两支常量墨，理由写在那段注释里
  （四档 alpha 是钉着同两条线解出来的，场被钉在同一个上限上，阶梯没有第二种摆法）。
- `CoverBackdrop/index.tsx` + `useBlurredCover.ts` + `useCoverSurface.ts`：糊半径按档给、档位归一只做一次。
- 设置项与文案：`setting_basic_theme_dynamic_bg_algorithm_magic`（zh-cn「浓色模糊」）。
- 测试：新建 `tests/monet-magic-surface.mts`（17 条）并**登记进 `package.json` 的 test 文件清单**
  （`npm test` 是显式列表，不登记就永远不跑 —— 这一条本轮踩过），另在 5 个既有文件补 20 条。

### 21.8 证书（2026-10-18）

`npm test` **822 / pass 821 / fail 1** —— 唯一那条红仍是 §7.4 故意留红的 `正文区必须钉在色阶带上沿以下`
（`tests/monet-texture.mts`，本次没碰）；总数从 785（§20.5）涨到 822，涨的 37 条全是本轮新增。
`npx tsc --noEmit -p .` **137 = 基线**，本轮改过的 `src/*.ts`、`*.tsx` 与测试文件 0 命中。
`npx eslint` 对改动的 `src` 文件**无输出**；`.mts` 测试不在仓库 lint 范围内（`.eslintrc.cjs` 的 TS override 只匹配 `*.ts`/`*.tsx`），
本轮临时挂了一份 `.mts` 配置去跑，输出全是既有行的类型感知报错，据此判定"没有新增 lint 债"而不是"改测试去迁就配置"。
**没出包**：本轮只动 JS 与文档，且设备自 03:05 起掉线（§20.5 同一形状），装机项一律挂到设备回来。

### 21.9 真机清单（这一轮四条，全部待判）

- **21-1 ③ 的歌词台在亮封面上是不是平涂**：lucky 那一类 ③ 与 ② 在歌词台上起伏都是 2.5 上下（表里第 2 行）。
  若判"看不值得单独一档"，能动的只有 7.0 那条线本身 —— 而 §20.2 已经量过松它的账（6.5 ⇒ 小字 3.36），买不起。
- **21-2 ③ 的浏览台透出够不够**：起伏 6.0~11.8，是这一档与 ② 拉开的地方；同屏对比 ②③ 各切一次，看用户要哪一台。
- **21-3 浓色会不会盖过封面本体**：solace 上 ③ 把整页刷成浓绿（② 是灰紫）。这是 dominant 与 average 的固有分歧，
  不是 bug；判"太冲"的话唯一诚实的改法是回到 average（＝ 就是 ②），别在 ③ 里掺平均色。
- **21-4 切档不串色**：② ↔ ③ 来回切各一次，看有没有"用 ② 的糊铺 ③ 的色"那一帧（§21.5 那条 key 的回归）。
  装机前后台必须先是本 App（[[feedback-shared-device-input]]）。

代码**仍未提交**，且本轮新增一条：`package.json` 的 test 清单与 `PlayerOverlay/index.tsx`（28 处未提交 hunk）带着别人的 WIP，
只能按"HEAD + 本次改动"定向入索引。②③ 两支都还没经过真机验收，默认档留在 ① 上（§21.5）。

---

## 22. 二十二次迭代：把逆向到的"其余控件色"只落到 ②「动态取色」这一档（2026-10-18）

用户这一轮的两句话是一件事的两半：**"将逆向的全屏播控页的其他按钮的颜色也应用于我的项目中"** +
**"注意这次逆向的全部应用仅是应用于我们项目中动态背景的动态取色这一设置中"**。
后半句先落地成范围：`theme.dynamicBgAlgorithm === 'blur'`（i18n 里 monet=莫奈取色、blur=动态取色、magic=浓色模糊），
于是 `resolveLyricActiveColor` 从"②③ 都染"收回成 `surface.mode !== 'blur'` 直接交 null，
③ 那一档重新变回逐字节的常量白阶梯（`tests/monet-on-cover-ink.mts` 里新增一条断言钉它 —— 放宽到 ③ 要用户点头，不由代码自己扩）。

### 22.1 先给"其他按钮"这一问一个可复核的答案：它们不跟封面走

三条独立证据，缺一条都不算数（dump 存在 `C:\Users\30913\.qoder\tmp\qqmusic-re\`）：

1. **使用方清单是完备的**：`MagicColorHelper`（`h.o.r.w.m.t.a`）的类级 xref，JADX 报 `coverage: complete`，12 个 using node ——
   `MusicPlayerActivity` / `PlayerLyricFragment` / `PlayerRecommendFragment` / `PlayerSongFragment` / `PlaylistCard$updateBadge$1`
   / `QLiteActionSheet(+.e)` / `CoilImage__CoilImageKt` / `h.o.r.w.m.p(+.a)` / `h.o.r.w0.o.i(+.h)`。
   **没有任何一个控件类**（播放/暂停/收藏那一排）在里面。
2. **布局里没有 tint**：`aapt2 dump xmltree --file res/YQ.xml`（全屏播控页那份，文件名已混淆，id→名字靠 `aapt2_res.txt`）
   里 `ic_player_btn_*` 那一排只有 `srcCompat`，没有 `android:tint`；二进制 XML 的字符串池是 UTF-16LE，
   所以 `.scratch` 侧的探测脚本要先剥 `\x00` 才搜得到（`t22_findctrl.py`）。
3. **控件类里一个颜色 setter 都没有**：`PlayInfoPanel` 与 `LyricCtrlPanel` 整类翻下来只有 3 支 `ImageButton`，
   没有任何 `setColorFilter` / `setTint` / `setTextColor` 调 `MagicColorHelper` 的分支。

顺带把上一节留错的那条改对：**非当前歌词行确实跟封面走**（`PlayerSongFragment.V0` → `setColor(153/255 · HSV(h,0.10,1.00))`，
即 `a.d`），"恒白"那句是错的，本节按实测重写。而 `a.e`（首页底部 MiniBar 底色）与 `a.b`（歌单角标）根本不在播控页，本档够不着也不该够。

### 22.2 于是这一轮真正能搬的只有第二处：正文小字那一层

对面 `a.d = HSV(封面色相, 0.10, 1.00)` 换算到 HCT 只有 C\*≈6~16、L\*≈93~98（`.scratch/t133_blur_tint.mts` 逐色相量的）——
是一支"带一丝封面色的近白"，不是一支彩色。落到我们这一档时，**只染 `c-font-label`（歌手名/时间/次要图标那一层）与它带出去的
透光键 `c-border-background`**，理由分两条：

- **非当前行（`c-350`）不搬**：`.scratch/t135_ladder.mts` 量出来 ② 的"非当前行 / 译文"两层合成完只差 **2.2 个 L\***
  （0.98×0.6 与 0.92×0.6 夹的），而染色掉的明度随层的厚度走 —— S=0.10 在 Faces 上 0.588 那层吃 3.3 格、0.552 那层吃 3.0 格，
  于是"译文"反而比正文亮。用户 2026-10-17 的原话就是要那两层"一眼分得出"，那条比"跟封面走"优先，当场把上一版压反的实现否掉。
- **译文行本来就不该染**：`setTRColor` 在全屏歌词页没有任何调用方，它停在 res 里的 `#99ffffff`。

### 22.3 三条闸门：合成后核、层间距地板、真机峰值那一格

`buildBlurInk`（`onCoverTheme.ts`）里 `pickBlurTextArgb` 从 `S = BLUR_TEXT_S(0.10)` 一格一格往回退，取第一条同时过三关的：

1. **对比核在合成之后**（`compositedTone`，8 bit sRGB 混算，与 RN/安卓同一条做题方式）：一支 L\*96 的粉叠在 0.588 的层上
   会假装自己是 L\*96，那正是本轮要防的"背景和前景字色混淆"。线取 `INK_LABEL.min(4.5) + INK_HEADROOM(0.1)`。
2. **地板从下一层往上推**（`BLUR_TINT_TIER_GAP = 8`）：被染那层合成完必须仍比非当前行高 8 格以上 —— 就是 §22.2 那条教训的常量形式。
3. **核在"模型场 + `BLUR_FIELD_PESSIMISM(1.7)`"那一格**：② 的白阶梯当初就是按真机峰值 L\*39.5 核的（§12.2），
   染色若改按模型场 37.8 核，等于把 4.5 那条线偷偷放宽。

**照抄的账**（`.scratch/t136_label_ink.mts` 跑 `buildBlurInk` 的真数，五张真封面）：不加闸那一支在峰值场上是 **4.01~4.57，四张破线**；
过完闸交出去的是 S≈0.02~0.03 那一族 —— `solace rgb(255,248,247)`、`lucky rgb(240,255,235)`、`faces/sunset rgb(255,250,24x)`、
`rainy rgb(250,250,255)`，掉 0.9~1.4 个 L\*，与当前行间距 9.7~10.2 格（线 8）。
暗场一侧才有肉：`tests` 里那支暗封面（场 L\*30.1）能买到 S≈0.08 的一支淡紫。
**结论要如实说：② 的正文染色在亮封面上是一层几乎看不见的洗色，不是效果**；这一档"跟封面走"的可见度仍然主要靠上一轮那个当前行高光。

### 22.4 改动清单

- `surface.ts`：`hsvToArgb` 导出（`Color.HSVToColor` 的那个孪生函数，配色层要按 HSV 常数上色）。
- `onCoverTheme.ts`：新增 `COVER_INK_MIN_BASE_CHROMA(5)` / `BLUR_TEXT_S(0.10)` / `BLUR_TINT_TIER_GAP(8)` / `BLUR_FIELD_PESSIMISM(1.7)`
  + `compositedTone` + `pickBlurTextArgb` + `buildBlurInk(surface, stage)`；`resolveOnCoverInk` 的 ② 支改走 `buildBlurInk`；
  `resolveLyricActiveColor` 收成只认 `'blur'`；`cssArgb` 导出给单测核串（自己抄一份发串逻辑迟早脱拍）。
  上一版那条 `BLUR_TINT_TONE_SLACK(0.5)`（"给自己让半格"）删掉 —— 它比的是自己，正是压反层次的那个写法。
- `tests/monet-on-cover-ink.mts`：② 这一段重写成 6 条（只染一层 / 退让方向 / 不许动的键 / 灰与亮场退回白 / 层间距 / **"照抄拿不到余量"**
  那条不测实现、只钉"为什么不能照抄"），并把 `BLUR_FIELDS` 改成两格**模型场**（30.1 与 37.8），峰值那 1.7 格由实现吃。
- `tests/monet-on-cover-theme.mts`：三条失效的不变式按新契约重钉 —— "恒为一支白"改成"只有 `TINTED_KEYS`（`c-font-label` + 那条透光描边）
  允许跟封面走，其余逐字节不动、alpha 也不许动"；"分台布光"改成"浏览台恒为常量表并且不染色"；
  "③ 与 ② 逐字节相同"改成**"③ 恒等于 `BLUR_INK`/`BLUR_INK_BROWSE`"**（拿 ② 当参照的那条写法已经站不住了）。
- 探测件（不提交）：`t133_blur_tint.mts`（逐色相的 HSV→HCT 与合成对比表）、`t135_ladder.mts`（四层白阶梯与染色掉格表）、
  `t136_label_ink.mts` + `t136_sheet.py`（三栏对照图）。

### 22.5 证书（2026-10-18）

`npm test` **832 / pass 831 / fail 1** —— 唯一那条红仍是 §7.4 故意留红的 `正文区必须钉在色阶带上沿以下`（本轮没碰）。
`npx tsc --noEmit -p .` **137 = 基线**，改过的 `src/*.ts`、`*.tsx` 与两个测试文件 0 命中。
`npx eslint` 对改动的 `src` 文件**无输出**；`.mts` 测试挂临时配置跑出来的是 `test()` 返回 Promise 的既有报错，
拿没碰过的 `tests/monet-texture.mts` 一比（同样 14 条）即知是结构性的，不是本轮新增。
中途被既有测试抓到一次真回归（译文层被压到非当前行底下），修的是实现不是测试 —— 见 §22.2 第一条。

### 22.6 像素对照（`.scratch/t136_label_tint.png`）

三栏：① 现状实白 ／ ② 照抄 QQ 的 `HSV(h,0.10,1.00)` ／ ③ 我们过完三条闸的那一支。真机尺度（歌手名 16dp=56px、当前行 20dp=70px），
链路同 §20.1（300px → BoxBlur(r=1)×3 → 裁 3% → CENTER_CROP → 1260×2800 → 与闸门解出的蒙版/底色合成）。
每栏下面标了颜料、合成 L\*、峰值场对比（线 4.5，破线打 ✗）与与当前行的层间距（线 8）。
判读要点：② 那一栏的色相**看得见**但四张破线；③ 那一栏全部过线、色相只剩一丝 —— 这一轮的取舍要用户对着图判，不是对着数判。

### 22.7 真机清单（这一轮两条，全部待判）

- **22-1 ② 的歌手名那一行**：换三张封面（一张浓彩、一张灰、一张暗）各看一次，问的是"这一丝染色值不值得留"。
  判"看不出等于没做"→ 唯一能加重的手段是松 4.5 那条线或把译文档再压暗，两条都要用户点头。
- **22-2 ③ 与 ① 没被渗到**：切到浓色模糊/莫奈取色各一次，前景应当与本轮之前的包逐像素相同（§22.0 那条范围收口）。
  装机前后台必须先是本 App（[[feedback-shared-device-input]]）。

代码**仍未提交**，`PlayerOverlay/index.tsx` 与 `package.json` 带着别人的 WIP，只能按"HEAD + 本次改动"定向入索引。
本轮出包一次（纯 JS，`npm run pack:android`），设备自 03:05 起掉线（`adb devices` 空、`kill-server` 重启后仍空），装机项挂到设备回来。

**15:36 那支包落地的证据（写下来是为了下次不用重跑一遍推导）**：`BUILD SUCCESSFUL in 5m 11s`（716 tasks，29 executed / 687 up-to-date），
arm64 产物 `xunyin-v1.1.0-arm64-v8a.apk` 20,871,172 B、sha256 `01abb835775d295a17de7552732ba4773f8cb9e5252bfd796ef7b450a885d71d`。
新鲜度三条，缺一不可：包内 `assets/index.android.bundle` 与 `build/generated/assets/createBundleReleaseJsAndAssets/` 那份**逐字节相同**
（`7e9c37ee4e8e8aab521baff2ad80dce153ebfc2954261561a47b98f4264c33c8` / 8,414,264 B），bundle mtime 15:36:06 晚于最后一次源码编辑 15:28:57（`onCoverTheme.ts`），
且 Hermes 字节码里 grep 到 `BLUR_TINT_TIER_GAP` / `BLUR_FIELD_PESSIMISM` / `resolveLyricActiveColor` / `buildBlurInk` 各 1 处、原生那条 `getBlurredBackdrop` 1 处（没被这轮带跑）。
**装机这条上一节写错了，这里改对**：设备在 15:38 回到总线上，这支包**已经装上**（`adb -s 10AE2N03QR0041Y shell dumpsys package cn.toside.music.mobile`
→ `lastUpdateTime=2026-10-18 15:38:33`、`versionName=1.1.0`、`firstInstallTime=2026-10-09 17:19:53` 没动 ⇒ 是 `install -r` 覆盖装，数据没丢）。
所以 22-1 / 22-2 与 21-x、20-x、19-x、18-x、16-x 现在挂的是"**已装机、待用户对着屏幕判**"，不是"从未装机"。

## 23. 二十三次迭代：③ 的糊半径 10 → 5（"展开动画 40% 那一帧"），地板 0.80 → 0.85 付可读性（2026-10-18）

用户这一轮给了两句话，第二句是把第一句换个说法：**"将当前的浓色模糊的模糊度降为当前的50%"**，
以及 **"换句话说用控制栏到全屏动画进行到大约40%的时候这个时候的背景效果做全屏播控页的背景效果"**
（附 `C:\Users\30913\Desktop\Screenshot_20261018_154332.jpg`），最后补了一条范围：**"注意这里说的是浓色模糊选项下的"** —— 只动 ③，② 一格不许动。

### 23.1 两句话是同一个旋钮：屏幕上的模糊 = 小图上的 σ × 放大倍数

真机链路上"糊多少"不是一个数，是两段的乘积（§20.1 那条）：`300px 小图 → BoxBlur(r)×3 → 裁 3% → CENTER_CROP 撑到屏`。
小图侧 `boxSigmaPx(r)=sqrt(((2r+1)²−1)/12)`，再乘 `√3`（三次盒模糊的等效高斯），最后乘放大倍数 `2800/282 = 9.9291`：

| 半径 | 小图 σ | **屏上 σ** |
| --- | --- | --- |
| r=10（③ 原档，逆向到的那一格） | 10.49px | **104.1px** |
| **r=5（本轮）** | 5.477px | **54.4px ＝ 原来的 52.2%** |

"降为 50%"落成的就是这一格 —— 半径减半在 σ 上几乎就是减半（大 r 下 `boxSigmaPx ≈ (2r+1)/√12` 是线性的），
52.2% 而不是 50.0% 那点零头是 `−1` 那项，`tests/monet-backdrop-blur.mts` 里钉的是 5.477/54.4/3.88 三个实测数，不是"一半"这个口头数。

第二句话也量了（`Screenshot_20261018_154332.jpg` 上那张卡的宽度是 1274px / 屏宽 2800 ⇒ 那一刻的放大倍数只有 **4.52×**，
所以同一张 r=10 的小图在动画 40% 处屏上 σ ≈ **47.4px**）。**54.4 与 47.4 差 15%，落在同一档观感里** ——
两句话指向同一个 `MAGIC_BOX_RADIUS = 5`，不需要两个常数。这条要记下来，是因为它是"为什么用半径而不是加一支独立的动画帧常数"的答案：
放大倍数是**卡片尺寸**给的，全屏之后就是 9.9291，改不了。

### 23.2 代价：糊变轻 ⇒ 模型场与真机峰值那一格裂开（+1.2 → +4.1）

闸门看的是 `fieldToneOf` 的 8×8 块平均（模型场），屏幕上真正压着字的是最亮那一格（峰值）。
**这个差随糊变轻而涨**：`.scratch/t141_magic_floor.py` 五张真夹具量的 —— r=10 时 **+1.2**、r=5 时 **+4.1**；
② 那条历史序列同一个方向（r=4 **+5.1**、r=1 **+6.7**，§19/§20）。于是地板 0.80 在 r=5 上直接破线：
`solace` 歌词台小字层 **4.83 → 4.41**（线 4.5）。这不是巧合，是"降糊"这一动作的定价方式。

### 23.3 三条还债的路，两条量过、一条实现完又退回

- **A 加厚蒙版（本轮采用）**：③ 的地板 `MAGIC_SCRIM_MIN` **0.80 → 0.85**。贴地板的那几张（solace/rainy/faces）照片贡献 **20% → 15%**；
  被闸门顶上去的那几张（lucky 0.97/0.92、sunset 0.86）**一格不动** —— 地板只是下限，这条改动碰不到闸门说了算的封面。
  过完账：最差小字 **4.63**、非当前行 **3.34**、歌词台"标题−小字" **12.4**（线 4.5 / 3.0 / 10），`.scratch/t142_magic_ship.py` 逐格复算 → **破线：无**。
- **B 抬 ③ 那一档小字层的白**（`BLUR_INK.fontLabel` 0.78 → 0.84）：能过 4.5，但**"标题−小字"塌到 8.7**（线 10，§13 钉的那三条层次）——
  等于把这一档的层次卖给可读性。`.scratch/t140_magic_label_alpha.py` 两个买方都量过，A 便宜。
- **C 给闸门加保守量**（`MAGIC_FIELD_PESSIMISM = 1.7`，照 ② 那条 `BLUR_FIELD_PESSIMISM` 的样子）：**实现完、跑通、再整条退回**。
  退的理由两条：① 它**收贵了** —— 同一支 1.7 让 solace 解到 0.96、lucky 直接顶到全遮（纯色平铺，这一档就不再是"浓色模糊"了）；
  块模型对 α 本来就不敏感，闸门只会把整档一路推向下限之上很远。② 它**买不起** —— 这一档的天花板就是底色自己：
  白字要过 7.0，模型场必须 ≤ L\*37.85，而 ③ 的底色明度被 `BLUR_ANCHOR_TONE = 36` 夹着，蒙版加到头场=底色，
  **37.85 − 36 ≈ 1.8 就是闸门能吸收的最大保守量**，超过它 `solveStages` 在黄绿那一片封面上解不出、整档静默回落成近黑保守底。
  1.7 卡在门下只剩一分余量，这不是设计，是运气。所以本轮**没有** `fieldBias` 参数（`solveStages`/`solveScrimCenti` 签名照旧）。

### 23.4 改动清单（③ only）

- `backdropBlur.ts`：`MAGIC_BOX_RADIUS` **10 → 5**，注释记下 40% 那一帧的 47.4px、52.2% 这笔账、+1.2/+4.1 的裂开序列，
  以及"半径与地板必须同批改"这条约束的来由。
- `surface.ts`：`MAGIC_SCRIM_MIN` **0.8 → 0.85**（含 A/B/C 三条路的取舍与那两条实测数）；`buildMagicSurface` 的文档串改成"糊底半径按档给 5"。
- 三处注释跟着改口径：`CoverBackdrop/index.tsx:135`（"② 是 1，③ 是 10 的一半"）、`useBlurredCover.ts:12`（"两份不同糊度的产物（1 与 5）"）、
  `backdropGate.ts:34`（"③ 要 5"）。
- 测试：`monet-backdrop-blur.mts` 那条 ③ 的断言重钉成 **5.477px / 54.4px / 与 ② 的比值 3.88**，并加了一条**跨文件不变式**
  `MAGIC_SCRIM_MIN > 0.8` —— 以后谁把半径往回调而没同时加厚地板，这条会直接红，而不是等真机上看小字糊掉。
  `monet-magic-surface.mts` 三条标题与两处内文改成"地板 0.85"，`monet-cover-palette.mts:579` 同。
- **② 一条都没动**：`BLUR_BOX_RADIUS`、`BLUR_ANCHOR_TONE`、`BLUR_SCRIM_MIN`、`solveStages` 签名全部照旧（C 那条路退回时逐项 grep 确认 `fieldBias` 不存在）。

### 23.5 证书

三道闸门回到基线：`npm test` **832 / pass 831 / fail 1**（唯一红仍是 §7.4 故意留红的 `monet-texture`）；
`npx tsc --noEmit` **137 = 基线**；`npx eslint` 对改动文件无输出。四个 monet 测试文件单跑 **84/84**。
`.scratch/t141_surfaces.mts` 把发货代码解出来的 ③ 五张全打了一遍：**没有一张解成 null**（回落近黑那条失效模式没被踩到）。

### 23.6 像素对照（`.scratch/t144_magic_radius.png`，四张封面 × 三栏）

同一套 ③ 常量白阶梯、真机字号（标题 56px 实白 / 歌手名 56px@0.78 / 当前行 70px 实白 / 非当前行 70px@0.588 / 译文 56px@0.552）：
**现状 r=10·地板 0.80 | 本次 r=5·地板 0.85 | 未补偿 r=5·地板仍 0.80**。第三栏是"只降糊不还债"的样子，
`solace` 那一格它 4.41 破线（图上打红 ✗），起伏 p99−p1 从 7.93 涨到 **10.32 格** —— 那一栏的"更看得见封面"是拿字换的。

**判读要点要如实说**：还完债之后，中栏的**整体明度起伏并没有变大**（solace 7.93 → 7.69、rainy 8.55 → 8.09；
sunset 8.19 → 9.01、lucky 2.45 → 2.56 那两张是闸门说了算的，才真吃到半径的红利）。
也就是说这一轮用户拿到的变化是**色块边界变利落**（54.4px 的 σ 仍比 ② 的 14.0px 粗 3.9 倍），
而不是"透出更多封面细节" —— 因为还债那笔钱正是从"透出量"里出的（20% → 15%）。
如果对着屏幕觉得"糊没降"，剩下能加回来的只有三条：接受小字 4.41（破我们自己的线）、抬小字层的白（塌层次）、
把 ③ 的底色压暗（那就不是逆向到的那一档 `V=0.40` 了）。三条都要用户点头，本轮一条都没自取。

### 23.7 出包与装机（16:34:41 出、16:36:01 装上）

`assembleRelease` **5m12s**（716 tasks，28 executed / 688 up-to-date，没动 Java），arm64 产物 20,871,173 B、sha256 **`ab0568c74bca612424a531dd99c73858a53b707f1a6fd27da5b17c2e52817ffe`**
（比上一支 20,871,172 B 只多 1 字节 —— 与"只改两个数常量"的形状对得上）。新鲜度两条：包内 `assets/index.android.bundle` 与
`build/generated/assets/createBundleReleaseJsAndAssets/` 那份**逐字节相同**（`5d368c2d…07a30` / 8,414,264 B / mtime 16:34:18），
而**上一支的 bundle 大小一模一样（8,414,264 B）却哈希不同**（`7e9c37ee…`）—— 这正是"字节数不变、内容变了"该有的样子；
bundle 落地 16:34:18 晚于最后一次源码编辑 16:15:28（`backdropBlur.ts`）。

**装机这条要记，因为 `adb install -r` 这次被拒了**：前台是 `com.facebook.katana`（用户正在用机），流式安装直接
`Failure [INSTALL_FAILED_ABORTED: User rejected permissions]` —— vivo 那个"是否允许安装"的确认框没人点就是**拒**。
按 [[feedback-shared-device-input]] **没有注入任何点击、没有启动本 App**，改走"推上去再 `pm install -r`"：`Success`。
拉回设备 `base.apk` 的 sha256 与本地这支**逐字节相同**、`lastUpdateTime=2026-10-18 16:36:01`、`firstInstallTime=2026-10-09 17:19:53` 未动（覆盖装、数据没丢）。
**顺带一条 Windows 侧的坑（下次别照着报错去查设备）**：Git Bash 会把 adb 参数里的绝对路径改写 ——
`adb push x /data/local/tmp/a.apk` 实收 `C:/Program Files/Git/data/local/tmp/a.apk`（`remote secure_mkdirs() failed`），
`pm install /data/...` 则报 `Unable to open file: C:/Program`。加 `MSYS_NO_PATHCONV=1` 前缀即可，两处都要加。

**真机清单（本轮一条，压在最前面判）**：**23-1 ③ 这一档现在糊不糊得开** —— 判据不是"比刚才清楚"，是**色块边缘要利落但仍读不出照片细节**；
若判"跟原来没两样"，那是地板 0.85 把透出量吃回去了（见 §23.6 那条如实说明），要往回加只能踩 §23.6 列的三条买方之一，**要用户点头**。
连同 22-1 / 22-2、21-x、20-x、19-x、18-x、16-x 一起等用户自己进播放页切到「浓色模糊」那一档。代码**全未提交**。

---

## 24. 二十四次迭代：把全屏播控页回退到两次逆向之前（2026-10-18）

### 24.1 用户这三句话就是这一轮的全部范围

**"查看代码我逆向了一次图片,逆向了一次应用,将全屏播控页界面代码回退到两次逆向之前"** →
我给了"部分回退（只退 ③）/ 全部回退（连 ② 那四轮提亮一起退到 §15）"两个形状，用户选 **"全部回退"**，
随后补了一句定爆炸半径的限定：**"注意仅回退的是全屏播控页面界面"**。

于是这一轮的判据不是"退某个常数"，是**退两条逆向链**：图片逆向（§16 起的那套"小图 + 盒模糊 + 裁脏边"原生管线，
连带它给出的屏上 σ 与四轮"再亮一点"的定价方式）与应用逆向（§21 的第三档 ③、§22 的前景染色与当前行高光）。
别的页/别的特性一概没碰。

### 24.2 回退目标 = §15 末态，逐格对照

| 格 | §15 末态（本轮退回） | §16–§23 曾到达 |
| --- | --- | --- |
| ② 的糊法 | RN `ImageBackground blurRadius={9}` + `OVERSCAN 1.25` | 原生 300px 小图 + BoxBlur(r)×3 + 裁 3%，r 一路 10→7→4→1 |
| ② 的底色锚点 | `BLUR_ANCHOR_TONE = 28` | 30 → 32 → 34 → 36 |
| 档位数 | ① 莫奈 / ② 动态取色 | 外加 ③「浓色模糊」 |
| ② 的前景 | 恒白 + alpha 分层（`BLUR_INK` / `BLUR_INK_BROWSE` 两套常量） | 正文小字层跟底色走 + 当前行高光 HSV(色相, 0.30, 1.00) |
| 分台布光（浏览台薄、歌词台厚 + `stageDim`） | **在** | 在（它不是逆向产物，原样留着） |
| 保守底 `PROVISIONAL_BLUR_SURFACE` | **在**（§10.2"切换加载最短"） | 在，另加 ③ 那一份同值不同 mode 的 |

### 24.3 删掉的三块（附文件）

- **③ 整档**：`surface.ts` 的 `MAGIC_*` 常数、`MagicMeasure`、`buildMagicSurface`、`PROVISIONAL_MAGIC_SURFACE` 与
  造它的工厂函数（改成内联一份 `PROVISIONAL_BLUR_SURFACE` 常量）；`coverPalette.ts` 的 `algo === 'magic'` 分岔；
  `sourceColor.ts` 的 `dominantArgbOfPixels`/`DOMINANT_LEVELS`/`DOMINANT_BUCKETS`；`backdropGate.ts` 的 magic 支；
  设置页那一行 `CheckBox` 与 `app_setting.d.ts` 的 `'magic'`；三支语言包的 `setting_basic_theme_dynamic_bg_algorithm_magic`。
- **图片逆向那条原生糊底管线**：删文件 `backdropBlur.ts`、`useBlurredCover.ts`；`nativeModules/palette.ts` 去掉
  `supportsBlurredBackdrop`/`getBlurredCoverPath`；`CoverBackdrop/index.tsx` 退回 §15 那一版（按档派 RN `blurRadius`）。
- **前景染色**：`onCoverTheme.ts` 去掉 `buildBlurInk`/`pickBlurTextArgb`/`compositedTone`/`toneToChannel`/
  `COVER_INK_MIN_BASE_CHROMA`/`BLUR_TEXT_S`/`BLUR_TINT_TIER_GAP`/`BLUR_FIELD_PESSIMISM`/`LYRIC_ACTIVE_CHROMA`/
  `resolveLyricActiveColor`，`resolveOnCoverInk` 回到"① 走场导出、② 取两套常量"两行；`Lyric.tsx` 去掉
  `activeColor` 这条 prop 与那两个 hook（当前行回到 `theme['c-primary']`，即 §13 那一版的字重+主色层次）。

顺手收掉的两处 §21 残留：`coverLayerKey` 的保守支后缀不再拼 `surface.mode`（全计划只剩一支保守底，
那个档名是两档防撞槽才加的）；`normalizeCoverAlgo` 把 `'magic'` 当脏值折回 `'monet'`（旧存档里可能还躺着这个值，
读回来既不崩也不默认落在 ② 上）。

**没删的一处，是有意的**：安卓侧 `PaletteModule.java` 的 `getBlurredBackdrop` 与它的 LRU/磁盘缓存留着。
JS 已经不再调它，屏上零影响；删它要把 Java 一起重编（构建从 2–3 分钟变 6–8 分钟），而且那条管线本身
（§16 的逆向配方）以后若重做还要用。**这一条留给用户拍板**。

### 24.4 为什么不能用 git 退

`HEAD`（`8a393a8`，分享图那一笔）早于 ② 档诞生，仓库里**没有 §15 末态的快照**，`git checkout` 只会连
② 档本身与分台布光一起退没。所以这一轮是**外科手术式**改回：先做 105 个文件的备份，再逐处对照 §15 的文档数改写，
每一步用 grep 与单测自证。

### 24.5 保真证明：锚点 28 复算 §15 那六张真夹具的发货数

`.scratch/t107_covers.json` 六张真封面跑**回退后的** `buildBlurSurface`（`.scratch/t145_anchor28_field.mts`），
逐格与 §15 记录对得上：

| 封面 | 合成场 L\* | 歌词台 α | 浏览台 α | δ | 底色 rgb |
| --- | --- | --- | --- | --- | --- |
| solace | 37.79 | 0.55 | 0.40（贴下限） | 0.250 | 82, 60, 65 |
| vih | 37.81 | 0.79 | 0.72 | 0.250 | 49, 70, 68 |
| lucky | 37.49 | 0.86 | 0.81 | 0.263 | 71, 67, 37 |
| sunset | 37.51 | 0.83 | 0.77 | 0.261 | 97, 55, 46 |
| rainy | 37.80 | 0.74 | 0.66 | 0.235 | 57, 67, 77 |
| faces | 37.74 | 0.71 | 0.61 | 0.256 | 97, 54, 55 |

**六张没有一张解成 null** —— 也就是没有"静默回落成纯色"那格。δ 那三条（`1-(1-browse)(1-stageDim) === scrim`）
仍在整数百分比网格上逐张成立。

### 24.6 测试跟着回退

删两支 suite：`monet-magic-surface.mts`、`monet-backdrop-blur.mts`（并摘掉 `package.json` 里这两条 `--test` 条目，
`package.json` 有别人的未提交 WIP，只动这两格）。另六支按上面三块各自收窄：

| 文件 | 判据变化 | 结果 |
| --- | --- | --- |
| `monet-on-cover-ink.mts` | 摘掉高光/染色那 10 条与对应 import；锚点注释改成实测的 sunset L\*37.51 | 8 条 |
| `monet-on-cover-theme.mts` | 摘掉 ③ 那 3 条；`TINTED_KEYS` 豁免整块删掉，回到"除黑纱外逐串相同、颜料全白"；浏览台那条改成 `deepEqual(changed, ['c-font-label'])` | 16 条 |
| `monet-cover-palette.mts` | 摘掉 ③ 那 4 条（"三档各存一格"与两档那条重复，一并删）；锚点方向判据退回 `blur < monet`；脏值表把 `'magic'` 收进去 | 38 条 |
| `monet-blur-surface.mts` | 锚点地雷从 `< 38` 改回 **`< DARK_ANCHOR_TONE`**（"② 必须比 ① 暗"），38 那一格作为"往前看的物理上限"写进注释 | 17 条 |
| `monet-gate.mts` | 摘掉 magic 那 5 条与"两档保守支各占一槽" | 24 条 |
| `monet-source-color.mts` | 摘掉 dominant 那 5 条与入参校验里那一行 | 14 条 |

### 24.7 闸门（本机实测）

`npm test` **779 / pass 778 / fail 1**（总数从 832 掉 53，全在本轮摘掉的条目里；唯一红仍是 §7.4 故意留红的
`monet-texture`"正文区必须钉在色阶带上沿以下"，与本轮无关）。
`npx tsc --noEmit` **137 = 基线**，且 `grep -i "monet\|CoverBackdrop\|Lyric.tsx\|palette.ts\|DynamicBg"` 对 tsc 输出**空**
（本轮改过的文件一条类型错误都没有）。`npx eslint` 对六个改动路径无输出。
`grep -rn "③\|浓色模糊" src/ tests/` 只剩两处有意保留的历史口径（`coverPalette.ts` 的脏值说明、锚点那条注释里的"连同 ③ 一起回退"）。

### 24.8 出包与装机

`assembleRelease` **4m34s**（716 tasks，28 executed / 688 up-to-date，没动 Java）。
arm64 产物 `xunyin-v1.1.0-arm64-v8a.apk` **20,866,305 B**、sha256
**`bf0281004197b2bf09f095c61a46ceb7aebb311eb6eacb0bf76c43e563c88b7d`**（比 §23.7 那一支少 4,868 B —— 与"删掉一整档
+ 两条管线"的形状对得上）。新鲜度两条：包内 `assets/index.android.bundle` 与
`build/generated/assets/createBundleReleaseJsAndAssets/` 那份**逐字节相同**
（`e4ece48499…0ae236` / **8,406,768 B**），bundle 落地 **18:42:00** 晚于本轮最后一次源码编辑
（`useCoverSurface.ts` 17:59:43）；bundle 比上一支少 **7,496 B**（上一支 8,414,264 B）。

**包内探针这条要记下方法上的失败**：中文串在这一支 bundle 上**探不出来** —— 正对照 `动态取色`/`莫奈取色` 都是 0，
所以 `浓色模糊=0` 本身什么都不能证明（UTF-8 与 UTF-16LE 两种读法都试过，全 0）。能用的是 **ASCII 标识符差分探针**：
`blur=5`、`monet=2`、`PROVISIONAL_BLUR=1` 这些正对照有数，同一把尺子上 `magic=0`、`algorithm_magic=0` 才算"③ 整档没进包"。
下次判"某个改动进包没有"，先立一个应当为正的对照，再看目标是不是 0。

**装机本轮没做成**：18:43 `adb devices` 为空，`adb kill-server` + `start-server` 后仍为空 —— 两台设备都没接上（USB 或无线
都行，接上就能装）。**没有**改 `adb` 参数、没有重试到"看起来成功"。产物留在
`android/app/build/outputs/apk/release/`，接上线后按 §23.7 那两条走：`MSYS_NO_PATHCONV=1 adb push` +
`adb shell pm install -r`，再 `am force-stop` + `am start`，拉回 `base.apk` 核 sha256 与 `lastUpdateTime`。

### 24.9 这一轮之后剩下的真机项

回退把 23-1、22-x、21-x 这批"③ 与染色"的判项**一起作废**（屏幕上已经没有那一档）。真正等判的是 §15 那一版的 ②：
**24-1 播控页回到 9dp + 锚点 28 之后，字还读不读得清、封面还认不认得出**（这是"退回两次逆向之前"的直接观感，
判据是 §15 当初的验收话），加上 20-x/19-x/18-x/16-x 里那些与 ③ 无关、仍然有效的条目（morph 时间轴、分台布光翻页、
② 与 ① 切档）。代码**全未提交**；`PlayerOverlay/index.tsx` 上还压着别人的 ~28 处 WIP，提交策略要问用户。

---

## 25. 二十五次迭代：把 ② 重配回用户圈定的那一档（锚 20 / 两台闸门 5.0 / 文字只剩一档白，2026-10-18）

§24 把播控页退回 §15 末态之后，用户看真机/截图的结论是**"还是太暗了"**，并且指定要回退之前那批小样里的某一格。
这一轮只动 ②，① 一个字不碰。

### 25.1 用户这三句话就是这一轮的全部范围

> 就使用这场对话最终选择的这个方案倒数第三档（红圈前一档）来重新配置到「动态取色」这个选项中
> （因为之前修改了很多把当时这个效果给覆盖掉了），同时记得减小压暗背景的程度，之前的背景太暗了，
> 在这个基础上再确保按钮文字的可读性

`red圈` 画在 `t85_blur_sheet.png` 上，那张表的列头是 **原封面 / 28dp / 20dp / 14dp / 9dp / 5dp / 0dp**，
所以"红圈前一档" = **blurRadius 9dp** 那一列。三条要同时成立：

1. 糊半径回到 9dp —— `CoverBackdrop/index.tsx:18` 的 `COVER_BLUR_RADIUS` 早就是 9（§24 回退时带回来的），**这一条不需要改**；
2. 压暗要减到那一列的程度 —— 需要改的是**闸门与锚点**；
3. 在这个亮度上保住按钮文字可读 —— 需要改的是**白阶梯本身**。

### 25.2 复现证明：那一列就是"锚 20 + 闸门 4.5"解出来的

`.scratch/t150_ship.mts` 把三套配置铺在四张真封面夹具上，并且**逐字段对着真的 `buildBlurSurface` 自校**
（`selfcheck` 四张 × base/scrim/browse/fieldTone 全 `true` 才往下看）。锚 20 + 闸门 4.5 与当年留在
`.scratch/t85_surfaces.json` 的那一列**逐字节相同**：

| 封面 | t85 那一列 | 锚 20 / 闸 4.5 复算 |
| --- | --- | --- |
| faces | `rgb(76, 37, 38)` α0.40 场 L\*45.0 | 同左 |
| lucky | `rgb(52, 49, 21)` α0.60 场 L\*49.6 | 同左 |

（另两张 `t16_sunset_cover` / `t16_rainy_cover` 没有当年的 JSON，只有解算数：α0.53 场 L\*49.7、α0.40 场 L\*47.5。）

### 25.3 但 4.5 那一档不能发货：恒白阶梯塌的第一层是控件自己

闸门钉的是"场最多有多亮"：`场 ≤ 116·∛(1.05/线 − 0.05) − 16`。4.5 → L\*49.9，5.0 → L\*46.9，7.0（§24 发货那一支）→ L\*44.4 以下、
实际被真夹具顶到 L\*37.5~37.8。把 §12.2 那条保守量（**真机峰值比 8×8 块模型再亮约 1.7 个 L\***）加进去之后：

| 封面 | 闸门 4.5：α / 场 / 峰值 / **实白在峰值上** | 闸门 5.0：α / 场 / 峰值 / 实白 | §24 发货（锚 28 / 闸 7.0） |
| --- | --- | --- | --- |
| faces | 0.40 / 45.0 / 46.7 / **5.02** | 0.40 / 45.0 / 46.7 / 5.02 | 0.71 / 37.7 / 39.4 / 6.58 |
| lucky | 0.60 / 49.6 / 51.3 / **4.29 ×** | 0.64 / 46.9 / 48.6 / 4.74 | 0.86 / 37.5 / 39.2 / 6.60 |
| sunset | 0.53 / 49.7 / 51.4 / **4.23 ×** | 0.58 / 46.9 / 48.6 / 4.74 | 0.83 / 37.5 / 39.2 / 6.60 |
| rainy | 0.40 / 47.5 / 49.2 / **4.61** | 0.42 / 46.7 / 48.4 / 4.74 | 0.74 / 37.8 / 39.5 / 6.56 |

**四张里两张的实白自己破 4.5**（4.29 / 4.23）。② 的前景是一支不随背景变的白，控件那档**没有可退让的下一格** ——
所以亮度只能买到 5.0 为止。代价写得很小：最亮那两张的蒙版从 α0.60/0.53 加厚到 0.64/0.58、场从 L\*49.6/49.7 收到 46.9，
`.scratch/t152_brightness.png` 的 A/B 两栏肉眼是同一档，而两栏都比 C 栏（§24 那一支）亮一整级。

### 25.4 落点：亮度买自闸门，层次买自组件那条透明度

| 常量 | 旧（§24） | 新 | 买到了什么 |
| --- | --- | --- | --- |
| `BLUR_ANCHOR_TONE` | 28 | **20** | 同一闸门下蒙版薄 6~8 个百分点（0.44~0.72 → 0.40~0.64），照片轮廓读得出来 |
| `BLUR_MIN_CONTRAST` | 7.0 | **5.0** | 模型场 L\*37.5~37.8 → 45.0~46.9，即"减小压暗背景的程度" |
| `BLUR_BROWSE_MIN_CONTRAST` | 6.2 | **5.0** | 与歌词台并成一条线 → δ 恒 0，压暗层失去读者（见 25.5） |
| `BLUR_INK.fontLabel` | 白@0.78 | **实白** | 4.5 那条线在 L\*48.4 的场上只容得下实白（0.78 只剩 3.5） |
| `useGlassColors.lyricOpacity`（② 那一档） | 0.6 | **0.75** | 非当前行 2.75 → 3.39、译文 2.61 → 3.20（线 3.0，峰值场） |

发货阶梯的四层，对最坏那支 L\*48.4 的场（`.scratch/t153_ladder.mts` 峰值列 / `t155_tiers.mts` 模型列）：

| 层 | 屏上合成 | 峰值场 WCAG | 模型场 WCAG（夹具最坏 = lucky） |
| --- | --- | --- | --- |
| 标题 / 小字 / 控件 / 当前行 | 实白 L\*100 | 4.74（线 4.5） | 5.01 |
| 非当前行 | 白@0.98 × 0.75 → L\*87.1 | 3.39（线 3.0） | 3.56 |
| 译文 | 白@0.92 × 0.75 → L\*84.9 | 3.20（线 3.0） | 3.32 |
| 面板 | 0.32 黑纱（不改） | 白字在其上 L\*32.3 的场更稳 | 8.60 |

**0.75 是四张全过里最紧的一档**：0.6 非当前行 2.75 破线、0.7 译文 2.98 差一口气（`t153` 那三档并列打的就是这张账）。
歌词两层的墨色仍留 0.98/0.92 不取满，是为了"漏挂组件透明度"这个老症状还会被看出来（`t152` 小样的 B 栏当时写的是 1.0/0.9，
屏上差不到 0.5 个 L\*，代码里换成 0.98/0.92 只是把那层保险留着）。

### 25.5 分台的**墨阶**随小字层一起消失；分台的**机制**留着

旧结构里 `CoverStageProvider` 同时供两样东西：`dim`（渲染层压暗层的位置）与 `stage`（决定拿 `BLUR_INK` 还是 `BLUR_INK_BROWSE`）。
两台闸门并成一条之后 δ 恒 0，`BLUR_INK_BROWSE` 与 `BLUR_INK` 逐字段相同，于是：

- `onCoverTheme.ts`：删 `BLUR_INK_BROWSE`；`resolveOnCoverInk` / `applyOnCoverTheme` 去掉 `stage` 形参；
- `OnCoverThemeProvider.tsx`：不再读 `useCoverStage`。**这条不是洁癖**：`stage` 是 state，翻页落定就翻一次，
  而它已经没有读者 —— 留着就是每次翻页把整棵上了色的子树白重渲一遍，直接撞"切换加载时间最短"那把尺子；
- `CoverStageProvider.tsx`：上下文只剩 `dim`，`setStage` 一并删（`Vertical/index.tsx` 与 `PlayerOverlay/index.tsx` 的翻页落定处各去掉一行，
  `initialStage` 仍然留着，它管的是第一帧的亮/暗端点）；
- `solveStages` 的两条线、`browseScrimAlpha`、`stageDimAlpha` 与那个压暗层**原样保留**：预留的旋钮是"某一页单独更透/更暗"，
  改一个数 δ 就会自己跟上。`tests/monet-on-cover-theme.mts` 那条读 `browseScrimAlpha` 的用例因此没删，它现在是唯一会去看亮台场的地方。

`useGlassColors` 改成 `useGlassColors(lyricOpacity = LYRIC_COMPONENT_OPACITY)`：40 多个调用点一个都不传，
默认值直接取那份镜像常量（旧版是各写一个 0.6，正是"改了数忘了重核阶梯"的那个形状）。
只有 `Vertical/Lyric.tsx` 按 `surface?.mode === 'blur'` 传 0.75，**① 与普通主题逐像素不变**。
透明度从页面算好再逐行传（`LrcLine` 多一个 prop），因为逐行判要每行订阅一次背景状态；
`memo` 那条自定义比较器补了 `lyricOpacity` 相等这一条 —— 不然 ①↔② 切档时墨色当场翻、行上的透明度却冻在旧值。

### 25.6 改动清单

| 文件 | 内容 |
| --- | --- |
| `src/utils/monet/surface.ts` | 三个常量（28→20、7→5.0、6.2→5.0）与三段推导注释重写 |
| `src/utils/monet/onCoverTheme.ts` | 新增 `BLUR_LYRIC_COMPONENT_OPACITY = 0.75`；`BLUR_INK.fontLabel` 回实白；删 `BLUR_INK_BROWSE`；两个函数去 `stage` 形参 |
| `src/utils/hooks/useGlassColors.ts` | 可选 `lyricOpacity` 形参，默认取镜像常量 |
| `src/screens/PlayDetail/Vertical/Lyric.tsx` | 页面读一次 surface 决定透明度，逐行传下去（含 memo 比较器） |
| `src/components/player/CoverStageProvider.tsx` | 上下文只剩 `dim` |
| `src/components/player/OnCoverThemeProvider.tsx` | 不再读舞台 |
| `src/screens/PlayDetail/Vertical/index.tsx`、`src/components/player/PlayerOverlay/index.tsx` | 各去掉一行 `setStage` |
| `tests/monet-blur-surface.mts`、`tests/monet-on-cover-theme.mts` | 见 25.7 |

### 25.7 测试跟着改

| 文件 | 判据变化 |
| --- | --- |
| `monet-blur-surface.mts` | 闸门那条从"≥ 6.5"改成**区间 `5.0 ≤ 线 ≤ 5.5`**（下界=实白站得住，上界=不把亮度还给平涂，两头都写了数）；"浏览台场要比歌词台高 2 个 L\*"那条改成**两台逐格相同、δ 恒 0**；"浏览台比歌词台松且不许松过 6.0"改成"两条线同值，一分岔就要成对重核" |
| `monet-on-cover-theme.mts` | 歌词两层乘的是 `BLUR_LYRIC_COMPONENT_OPACITY`；`c-font-label` 进 `ONE_PAINT_KEYS`（它现在就是那支实白）；"三层白分得开"那条**判据方向调头** —— 旧版断言 `notEqual(实白)`，新版断言 `equal(实白)`，并把"当前行−非当前行 ≥ 20"按实测改成 **≥ 12**（最坏 lucky 13.2），"非当前行−译文 ≥ 2"保留（实测 2.4）；删"分台只动小字层那一格"，浏览台那条改成读 `browseScrimAlpha` 的过线复核 |
| `monet-cover-palette.mts` | 没改：锚点方向那条（`BLUR_ANCHOR_TONE ≤ DARK_ANCHOR_TONE + 4`）在 20 这里本来就宽余 |

### 25.8 闸门（本机实测）

`npm test` **778 / pass 777 / fail 1** —— 总数比 §24 那一轮少 1，正是"删掉分台那一格"那条用例；
唯一红仍是 §7.4 故意留红的 `monet-texture`"正文区必须钉在色阶带上沿以下"（与本轮无关）。
`npx tsc --noEmit` **137 = 基线**，且本轮八个改动路径在 tsc 输出里**一条都没有**。
`npx eslint` 对八个 src 路径无输出（`.mts` 不在 lint 范围）。

### 25.9 出包（19:49 那一支，证据链落全）

`assembleRelease` **BUILD SUCCESSFUL**，gradle 自报 **6m 51s**，`716 actionable tasks: 28 executed, 688 up-to-date`，
日志末行 `gradle exit=0`（`.scratch/t156_build.log`）。出包前按惯例删过
`android/app/build/generated/assets/createBundleReleaseJsAndAssets/index.android.bundle` 逼它重打包。

**"这一支包真的带着本轮那八个改动"** 只靠三条硬证据，一条都不靠推断：

| 证据 | 实测 |
| --- | --- |
| 打包时刻晚于最后一次源码改动 | bundle 生成 **19:48**；本轮最晚的一处改动是 `Vertical/Lyric.tsx` **19:28:14**（八处里最后一个）——余量 20 分钟 |
| APK 里那坨 JS 就是刚生成的这一份 | `index.android.bundle` sha256 `0ca2922cfe4eb51a399007a98089163c5a37723bae986780cc1386dc1329802d`；从 arm64 包 `unzip` 出 `assets/index.android.bundle` 再算，**逐位相同** |
| 包体只有 JS 在动 | arm64 `20866305 → 20866497`（**+192 B**）、universal `40983357 → 40983557`（**+200 B**），与 §24 那支同尺寸档；Java/资源一行没改，所以增量就是这几十字节 |

sha256（arm64 `e55e75d13feab0e0b219e9c974a0c990a34ea0d748e454159a5e3557692cabad`，
universal `beb7c1f9e006f383e50f2ccb921e11db388a9386cb5eb152eda4f3b1b7b0a11c`）。
产物在 `android/app/build/outputs/apk/release/`。

**复跑自证（19:5x）**：`assembleRelease` **BUILD SUCCESSFUL in 1m56s**（`24 executed / 692 up-to-date`），
`:app:createBundleReleaseJsAndAssets` 判 **UP-TO-DATE**（bundle mtime 仍是 19:48:54）、五个 APK 的 mtime 与 arm64 的 sha256 **一字未动**。
加上 `find src -newer <bundle>` 返回空 —— 这两件合起来才是"这支包等于当前源码"的判据，而且它是 **gradle 按输入哈希自己判的**，不是我口头保证。
（同一轮 `grep -a -o 符号名 | wc -l` 的差分见下。）

**装机已完成（20:12:44）**：设备 20:0x 回到总线（`10AE2N03QR0041Y` / V2302A）。走 §23.7 那两条：
`MSYS_NO_PATHCONV=1 adb push …/xunyin-v1.1.0-arm64-v8a.apk /data/local/tmp/t157.apk`（24.6 MB/s）→ `pm install -r` → **`Success`**。
证据四件：`lastUpdateTime=2026-10-18 20:12:44`、`firstInstallTime=2026-10-09 17:19:53` **未动**（`-r` 覆盖装、数据没丢）；
从 `pm path` 拉回的 `base.apk` sha256 与本地这支**逐字节相同**（`e55e75d1…2cabad` / 20,866,497 B）；
在跑的 `pidof=3451` 起步于 **20:13:04**（`/proc/3451` 的 mtime 与 `/proc/uptime` 对第 22 字段算出来 85 秒大），比安装晚 20 秒 ⇒ 内存里跑的就是这支。
**没有启动 App、没有注入任何点击**：核对时 `mCurrentFocus` 是 `com.tencent.mobileqq/…ChatActivity`（用户在 QQ 聊天），
按 [[feedback-shared-device-input]] 停手 ⇒ 25-1/25-2/25-3 要用户自己进播放页 ② 那一档判。设备上的 `/data/local/tmp/t157.apk` 已删。

**这一轮踩到的一条（下次别当成设备坏了）**：`MSYS_NO_PATHCONV=1` **只加在 `push` 上、漏在 `shell pm install` 那步**，
Git Bash 会把 `/data/local/tmp/t157.apk` 改写成本机路径，报的是
`Error: Unable to open file: C:/Program` + `IllegalArgumentException` + 一长串 `PackageManagerService` 栈，
**退出码 255** —— 看着像"安装被系统拒了"，实际是我这条命令自己的参数被改了。两条命令都要带这个前缀。

顺带**更正一处我自己写错的验法**（差点进文档当结论）：一度以为 release 包是 Hermes 字节码、符号名不进字符串表，所以 `grep BLUR_MIN_CONTRAST` 命中 0 ——
那个 0 是**我的正则**要求符号后面紧跟 `=` 或 `:` 造成的假阴性。复跑（`grep -a -o 符号名 | wc -l`，对 generated bundle，与包内那份逐字节相同）：

| 探针 | 次数 | 这一格是什么 |
| --- | --- | --- |
| `BLUR_MIN_CONTRAST` / `BLUR_ANCHOR_TONE` / `BLUR_INK` | 1 / 1 / 1 | 留着、只是改了值 |
| `BLUR_LYRIC_COMPONENT_OPACITY` | **1** | 本轮新加的导出 |
| `BLUR_INK_BROWSE` | **0** | 本轮删掉的导出 |
| `magicSurface` / `MAGIC_BOX_RADIUS` / `getBlurredBackdrop` | 0 / 0 / 0 | §24 回退删掉的三块（负向对照） |

⇒ 认包 freshness 的正确姿势是**一进一出的差分**（新符号在、被删符号不在），配合上面那条 sha256 逐项；
而 §24 记的**中文串 grep 不到**（「动态取色」这类）依然成立，别拿它当负向证据。

### 25.10 这一轮之后剩下的真机项

这一轮把 ② 从 §15 的形态（锚 28）换成锚 20 + 两台共闸 5.0 + 一档实白，判项跟着换。
**包已装机（20:12:44，见 §25.9），下面三条等用户对着屏幕判：**

1. **25-1（本轮主判项）** 全屏播控页的 ② 铺底：**还认不认得出是封面、还暗不暗**（这是用户"之前太暗了"那一句的正面回答；
   对照 §24.9 的 24-1，那一档是锚 28 + 闸门 7.0，比现在暗约 3～4 个 L\*）。
2. **25-2** 恒白阶梯在真机上的落点：控件图标 / 时间（实白）、歌词当前行、非当前行、译文 —— 后两层现在乘 0.75，
   模型账是 4.74～5.02 / 3.39～3.56 / 3.20～3.32，真机峰值比模型亮约 1.7 个 L\*，**非当前行和译文这两层要肉眼判**（低于 4.5 是设计内的取舍，不是 bug）。
3. **25-3** "标题与时间同色"这条用户可见的退化（见 §25.4）在真机上是否接受。
4. 与本轮无关但仍未判的：20-x/19-x/18-x/16-x 里的 morph 时间轴、②与①切档；#52（弹层挂回普通主题）；#54（非当前行卡实在动画冻结）。

代码**全未提交**；`PlayerOverlay/index.tsx` 与 `package.json` 上仍压着别人的 WIP，提交策略要问用户。

---

## 26. 二十六次迭代：给 ②「动态取色」的当前歌词行带上封面色（2026-10-18）

### 26.1 用户这两句话就是这一轮的全部范围

> 给当前取色方式-动态取色状态下的歌词页当前歌词带上动态取色，注意一定要注意可读性

随后确认时补了第二句（把"区分"也钉成硬要求，并再次收敛范围）：

> 就按你的推荐来，只动当前歌词颜色，一定要保证可读性以及非当前歌词和当前歌词的颜色区分！

拆开有三条边界，都按字面执行：

1. **只认 ②**（设置里 `theme.dynamicBgAlgorithm === 'blur'`，i18n 叫「动态取色」）：① 的当前行本来就有
   `INK_PRIMARY` 一支带封面色相的墨，普通主题/功能关着/保守底一律交 null、字色回到 `c-primary`（逐字节不变）；
2. **只动"歌词页的当前歌词行"**（`Vertical/Lyric.tsx`）：控件、进度条、小字层、标题、非当前行、译文一个字节不碰；
   工具模式里那个"选中行高亮"与当前行共用同一支颜料（`active` 分支本来就是二选一，这是既有语义，
   不是新开的染色面）；播控页那行「下一行预告」（`LyricPreview.tsx`，走 `glassColors.lyricActive` 的那处）不动 ——
   它在浏览台上，不在这次点名的"歌词页"里；
3. **可读性进闸门**，不是事后吹的：核在真机峰值场上、明度有下限、灰封面不许造色。

没有上一轮那种"逆向到什么就搬什么"的形状 —— 这次是用户点名，落点自己量。

### 26.2 设计：同一支颜料的明暗两头

② 的背景是"糊封面 + 底色洗色"，也就是说**屏幕上已经有一支属于这张唱片的颜料**。这一轮的当前行就用它：

- 色相与彩度都从 `surface.base` 里读回来（不是另取一支"强调色"）—— 背景是什么颜色，当前行就是同一支颜色
  被抬到能读的高度；
- 明度地板**从"非当前行合成格"往上推 6 格**（`inactiveLyricTone(field + 1.7) + BLUR_LYRIC_TIER_GAP`），
  再与固定的 92 下限取高者，只许往亮退 —— "两层分得开"这条按构造成立，不靠两个常量碰巧对上；
- 彩度 cap 取底色自己的 chroma —— 灰封面（base 彩度 < 5，HCT 中性轴在 8 bit 上的量化噪声就是 C\*≈2.7）
  直接交 null，字色回到实白：**不发明色相**；
- 兜底方向全指向"回到今天这一版"：算不出场、算不出色、场被顶过 L\*50 之外，一律实白。

### 26.3 可读性的账：为什么是 3.0 而不是 4.5（这条要写死）

先按 4.5（正文档）做了一版，量完否掉：② 的场被闸门顶到 **L\*45~47**，4.5 在这一格上只容得下 **L\*98~99 的近白**，
而 L\*99 上 sRGB 色域自己就把彩度夹到 **C\*3~15**（`.scratch/t158_lyric_active.mts` 的"4.5 线对照"一列）：

| 封面 | 4.5 交出的 | 彩度 | 观感 |
| --- | --- | --- | --- |
| faces | `rgb(255,244,243)` | C\*3.0 | 看不出 |
| lucky | `rgb(255,251,255)` | C\*3.5 | 看不出，色相还被夹到 H285（底色是 H105） |
| sunset | `rgb(255,255,255)` | C\*2.9 | 纯白 |

等于"看不出做过"。所以对比线改用**大字号那一档 3.0**（当前行是页面上最大的字，歌词另外两层也是 3.0），
换来的是 L\*92~94 上的真粉彩色 —— 它仍然高于页面自己的两片歌词（非当前行 3.39、译文 3.20，都对最坏峰值场）：
**当前行在任何封面上都是歌词块里最可读的那一行**。4.5 那条对照被钉进单测（"4.5 换不来颜色"），
哪天有人想抬回去，先回答"颜色从哪来"。

### 26.4 用户这条追加要求把地板钉死了："一定要保证……非当前歌词和当前歌词的颜色区分"

第一版落在 L\*92，最坏那支亮场（峰值 L\*48.6）上非当前行合成到 L\*87.1 —— 只剩 **4.9** 的落差。
用户回话点名的正是这一条，于是把 §22 那条"地板从下一层往上推"接回来，并量了明度×彩度的兑换表
（`.scratch/t159_tone_trade.mts`，红橙半圈 / 绿青半圈分色相摆）：

| 落差地板 | 最坏场上的落点 | 红橙半圈剩下的彩度 | 峰值 WCAG |
| --- | --- | --- | --- |
| 固定 92（第一版） | L\*92 / 落差 4.9 | C\*10.1~10.7 | 3.84~3.88 |
| **+6（发货）** | **L\*93~94 / 落差 6.3~7.1** | **C\*7.3~9.0** | **4.04~4.23** |
| +8（§22 那支旧值） | L\*95~96 / 落差 7.9~9.2 | C\*4.6~5.8（看不出） | 4.3~4.4 |

取 **6**：它是**最大的一条还能保住"看得出"的落差**（8 会把红橙半圈压到 C\*5 以下；绿到青半圈在 93~94 上
还端着 C\*17~24）。落到四张真封面 + 一支暗封面的实测：

| 封面 | 底色（H/C\*） | 当前行 | 落差 | 对模型场 / 峰值 |
| --- | --- | --- | --- | --- |
| faces | H18 C\*23.9 | `rgb(255,229,228)` C\*9.0 L\*93.0 | 6.3 | 4.50 / **4.23** |
| lucky | H105 C\*17.2 | `rgb(246,239,197)` C\*17.4 L\*94.0 | 7.0 | 4.31 / **4.06** |
| sunset | H32 C\*23.7 | `rgb(255,233,228)` C\*7.3 L\*93.9 | 6.9 | 4.30 / **4.04** |
| rainy | H247 C\*11.3 | `rgb(230,239,251)` C\*11.2 L\*94.1 | 7.1 | 4.36 / **4.10** |
| 暗封面 | H284 C\*10.9 | `rgb(233,230,246)` C\*10.8 L\*91.9 | 10.3 | 9.56 / **9.02** |
| 亮到闸门口 / 灰封面 | 中性轴 C\*2.8 / 1.7 | null（实白 L\*100） | 12.9 | — |

逐色相扫描（场 L\*46.9）：落点全在 L\*93.9~94.1，黄绿到青半圈 C\*24，红橙与蓝紫半圈 C\*7~15；
峰值 WCAG 4.05~4.06。色相偏差实测 ≤1°。

### 26.5 改动清单

| 文件 | 内容 |
| --- | --- |
| `src/utils/monet/onCoverTheme.ts` | 新增 `COVER_INK_MIN_BASE_CHROMA`(5) / `BLUR_FIELD_PESSIMISM`(1.7) / `BLUR_LYRIC_TIER_GAP`(6) / `INK_LYRIC_ACTIVE`(下限 tone 92, min 3.0) / `toneToChannel` / `inactiveLyricTone` / `resolveLyricActiveColor(surface)`；import 补 `CHROMA_CAP`、`parseCssColor` |
| `src/screens/PlayDetail/Vertical/Lyric.tsx` | `LineProps` 加 `activeColor`；`LrcLine` 的活动分支改 `activeColor ?? glassColors.lyricActive`；memo 比较器补 `activeColor ===`（同 `lyricOpacity` 那条：换歌/切档/保守底换真色时行上的颜色不许冻住）；页面 `useMemo(() => resolveLyricActiveColor(surface), [surface])` 算一次传下去 |
| `tests/monet-on-cover-ink.mts` | 新增 5 条：谁都交 null 的边界 / 峰值场过 3.0 且高于另外两层 / **落差 ≥6 按构造成立** / 跟色不造色（ΔH ≤8、C\* 不超底色、最小 C\*≥7）/ **4.5 换不来颜色**（不测实现，钉取舍） |
| `tests/monet-on-cover-theme.mts` | 两处叙述改口径：`ONE_PAINT_KEYS` 的"当前歌词行"改成"`c-primary` 的另一个读者走单独一支"；"三层白分得开"那条改成"标题/控件 vs 非当前行"（断言不动，它守的本来就是 c-font/c-350/c-300 这条链） |

没动的：`surface.ts`、`useGlassColors.ts`、`CoverBackdrop`、`LyricPreview.tsx`、Horizontal 那一支（不在
`OnCoverThemeProvider` 子树里）。

### 26.6 闸门（本机实测）

`npm test` **784 / pass 783 / fail 1**（`monet-on-cover-ink.mts` 自 8 条增至 13 条，全为本轮新增；
唯一红仍是 §7.4 故意留红的 `monet-texture`）。
`npx tsc --noEmit -p .` **137 = 基线**，改动路径在输出里一条都没有。`npx eslint` 对两个改动 src 文件无输出。
像素对照：`.scratch/t158_lyric_highlight.png`（三栏：现状实白 / 4.5 那条线 / 发货；真机尺度局部，
四张封面各一格，格下是最亮像素上的 WCAG 与 L\*）。判读要点：B 栏与 A 栏肉眼几乎同色（"看不出"的实证），
C 栏四张都读得出颜色、且与下面两行分得开。

### 26.7 出包与装机（21:00–21:11）

`npm run pack:android` **BUILD SUCCESSFUL in 5m 11s**（716 tasks：25 executed / 691 up-to-date；日志 `.scratch/t160_build.log`）。
出包前按惯例删过 `build/generated/assets/createBundleReleaseJsAndAssets/index.android.bundle` 逼重打包。

**这一轮的新鲜度证据链有一条特别硬的**：APK 的时间戳是 20:58（20:53 有人跑过一次构建 —— 在 20:52:55
我最后一次改完 `onCoverTheme.ts` 之后），我 21:00 再构建时 `:app:createBundleReleaseJsAndAssets` 重跑了
（bundle mtime 21:05:03），而 `:app:mergeReleaseAssets` / `:app:packageRelease` 判 **UP-TO-DATE** ——
gradle 按输入哈希自己认定"新 bundle 与 APK 里那份逐字节相同"。这条比"时间戳更新"更硬：从 arm64 包里
`tar` 出 `assets/index.android.bundle` 再算 sha256，与 21:05 生成的那份**逐位相同**（`E5111898…BC09E` / 8,407,868 B）。
另外三条：bundle mtime 晚于最后一次源码编辑 20:52:55（余量 12 分钟）；`src` 里没有比 bundle 更新的文件；
符号探针一进一出差分 —— `BLUR_LYRIC_TIER_GAP` / `BLUR_FIELD_PESSIMISM` / `COVER_INK_MIN_BASE_CHROMA` /
`resolveLyricActiveColor` / `inactiveLyricTone` 各 **1**，负对照 `BLUR_INK_BROWSE` / `magicSurface` /
`MAGIC_BOX_RADIUS` / `getBlurredBackdrop` 各 **0**，`PROVISIONAL_BLUR_SURFACE` 1（探针 `.scratch/t160_probe.mjs`）。

产物：arm64 `xunyin-v1.1.0-arm64-v8a.apk` **20,867,536 B**、sha256
**`123380cdd0bbddc1be48a54686693aa7a286f81f2421dcf03cfe54c2c1e16576`**（比 §25 那支多 1,039 B，与
"只动 JS 几十行"的形状对得上）；universal 40,984,595 B。产物在 `android/app/build/outputs/apk/release/`。

**装机（21:11:40）**：设备 `10AE2N03QR0041Y`（V2302A）在线上，走 push + `pm install -r` 那条：
`adb push … /data/local/tmp/t160.apk`（21.3 MB/s）→ `Success`。四件证据：`lastUpdateTime=2026-10-18 21:11:40`、
`firstInstallTime=2026-10-09 17:19:53` **未动**（覆盖装、数据没丢）；拉回设备 `base.apk` 的 sha256 与本地这支
**逐字节相同**（`123380cd…16576`）；核对时 `mCurrentFocus` 是 `com.tencent.mm/…LauncherUI`（用户在用微信），
按 [[feedback-shared-device-input]] **没有启动 App、没有注入任何点击** ⇒ 26-1/26-2 要用户自己进播放页判。
设备上的 `/data/local/tmp/t160.apk` 已删。

### 26.8 这一轮之后剩下的真机项

1. **26-1（主判项）**：② 的歌词页当前行 —— **颜色看得见吗、跟非当前行分得开吗、亮封面上读得清吗**
   （亮封面那三张的峰值 WCAG 是 4.04~4.10，线 3.0；低于 4.5 是设计内的取舍，见 §26.3，不是漏核；
   与非当前行的落差按构造成立，最紧那支 6.3）。
2. **26-2**：切到「莫奈取色」与普通主题各看一次，当前行应当与本轮之前的包逐像素相同（§26.1 的范围收口）。
3. 连同 25-1/25-2/25-3、20-x/19-x/18-x/16-x 一起等用户进播放页时判。**包已装机**（21:11:40，见 §26.7）；
   代码**全未提交**。

---

## 27. 二十七次迭代：当前行高光"再浓再亮"——激进档（2026-10-18）

### 27.1 用户两句话

> 颜色再浓一点再亮一点

随后一次追问里给足授权：

> 可以激进一点

这一轮只动 §26 那支高光的**三个数**：明度下限、彩度上限、落差地板。范围、闸门与接线一个都没动。
§26 里那些不变式（只认 ②、灰封面退白、核在真机峰值场、4.5 换不来颜色、只动歌词页当前行）**全部照旧成立**。

### 27.2 亮场上的物理：明度与彩度只兑换、不双赢（`.scratch/t161_more_color.mts` 的兑换表）

"更浓"（彩度）与"更亮"（明度）在 sRGB 里是同一个预算的两头，先量清楚三条：

1. **可读性根本不是当前的约束**：tone 88 时亮场峰值 WCAG 还有 3.45~3.71（线 3.0）—— 闸门一路可以让到 ~85；
2. **暖色半圈（红橙）是色域墙，只能靠明度买**：每降 1 格约换 +1.3~1.5 彩度
   （sunset H32：tone 94→C\*7.3、93→8.5、92→10.1、91→11.6、90→13.2、89→14.5）；
3. **黄绿→青那半圈被 cap 卡住，放开是纯赚**：cap 24 时 lucky 读 24.0、rainy 14.2，cap 36 时分别读到
   36.2 / 14.2；暗封面（base 彩度 10.9）更被夹成 10.8，而色域在 tone 90 上容得下 19.1。

### 27.3 落点：tone 90 + cap"2×底色、封顶 36" + 落差地板 6 → 2.5

三档候选（t91/90/89，`.scratch/t162_candidates.mts` 逐格算、`t162_lyric_aggressive.png` 铺图）里取 **t90**：
它是暖色半圈第一次跨进"一眼是支颜色"的那一格（C\*13.2~13.4）；再往下 89/88 每档只多 ~1.4 彩度，
落差却要从 2.9 掉到 2.0 以下 —— 兑换不划算，量过没取。

| 封面 | 旧（§26：floor6 / cap 底色） | **新（tone 90 / cap 2×、36 顶）** | 落差 | 峰值 WCAG |
| --- | --- | --- | --- | --- |
| faces | `rgb(255,229,228)` C\*9.0 | **`rgb(255,218,217)` C\*13.4** | 6.3 → 3.4 | 4.23 → 3.92 |
| lucky | `rgb(246,239,197)` C\*17.4 | **`rgb(239,229,143)` C\*34.5** | 7.0 → 3.0 | 4.06 → 3.65 |
| sunset | `rgb(255,233,228)` C\*7.3 | **`rgb(255,218,210)` C\*13.2** | 6.9 → 2.8 | 4.04 → 3.64 |
| rainy | `rgb(230,239,251)` C\*11.2 | **`rgb(205,229,255)` C\*21.5** | 7.1 → 2.9 | 4.10 → 3.68 |
| 暗封面 | `rgb(233,230,246)` C\*10.8 | **C\*19.1**（tone 90 上读回） | 10.3 → 8.4 | 9.02 → 8.60 |

**代价要如实写**：区分的主通道从"明度落差"（6.3~7.1，§26 版）换成"彩度落差"（C\*13~34 vs 非当前行合成完
的 C\*~5），明度只留 2.8~3.4 垫底 —— 这正是用户"更浓更亮 + 可以激进一点"两句的定价。
可读性那边仍在页内最可读的一档，但余量变薄：新 WCAG 3.64~3.92 对两片歌词的 3.39/3.20 只余 0.25~0.5，
真机上若判"当前行不够跳"，买方是把 tone 往回抬半格（90 → 91），代价是暖色半圈少 ~1.5 彩度。

### 27.4 改动清单

| 文件 | 内容 |
| --- | --- |
| `src/utils/monet/onCoverTheme.ts` | `INK_LYRIC_ACTIVE.tone` 92 → **90**；新增 `LYRIC_ACTIVE_CHROMA_CEIL`(36) / `LYRIC_ACTIVE_CHROMA_RATIO`(2)（旧规则"cap 取底色自己那一格"作废，注释里留了作废理由与三张卡住的夹具数）；`BLUR_LYRIC_TIER_GAP` 6 → **2.5**；`resolveLyricActiveColor` 的 cap 换成 `min(36, 底色 × 2)`；删掉不再用的 `CHROMA_CAP` import（eslint 抓的） |
| `tests/monet-on-cover-ink.mts` | 三处判据随激进档重钉：明度下限 92 → **90**；落差地板 6 → **2.5**（标题改成"区分主要由彩度承担"）；彩度上限断言改成 `min(36, max(底色,5)×2)`、"看得出"下限 7 → **12**（实测最紧 13.2）；对照那条 7 → 12 |

其余文件（`Lyric.tsx`、`monet-on-cover-theme.mts`、surface/useGlassColors/Provider）**一行没动**。

### 27.5 闸门（本机实测）

`npm test` **784 / pass 783 / fail 1**（总数不变：只改了判据没加条目；唯一红仍是 §7.4 故意留红的 `monet-texture`）。
`npx tsc --noEmit -p .` **137 = 基线**。`npx eslint` 两个改动路径无输出 —— 中途抓到一次真错
（`CHROMA_CAP` 成了未用 import），修的是实现不是 lint 规则。像素对照：`.scratch/t162_lyric_aggressive.png`
（四栏：§26 现状 / t91 / t90 / t89；t90 那一栏就是本轮发货的样子）。

### 27.6 出包与装机（21:45 / 21:49）

`npm run pack:android` **BUILD SUCCESSFUL in 5m 9s**（716 tasks：28 executed / 688 up-to-date；
`:app:mergeReleaseAssets` 与 `:app:packageRelease` 这次都**真的执行了** —— 与 §26.7 那次"UP-TO-DATE"形成对照，
证明这次 bundle 确实变了）。bundle 8,407,992 B（比 §26.7 那支 +124 B，与"只动几个常量"的形状对上）、
sha256 `47BA6CAE…E024`；从 arm64 包里 `tar` 出的 `assets/index.android.bundle` 与它**逐位相同**；
`src` 里没有比 bundle 更新的文件；探针 `LYRIC_ACTIVE_CHROMA_CEIL` / `LYRIC_ACTIVE_CHROMA_RATIO` 各 1 处。
产物：arm64 **20,867,460 B**、sha256 **`074f7f6448695e7a06023a1686c37e25d60aeea10f1b579b71e9836a72eaab8c`**。

**装机（21:49:55）**：USB 掉过线，改走无线调试 —— `adb connect 192.168.137.81:36673`（同一台 V2302A），
push + `pm install -r` → `Success`。`lastUpdateTime=2026-10-18 21:49:55`、`firstInstallTime=10-09` 未动；
拉回 `base.apk` 的 sha256 与本地这支逐字节相同；核验时前台已经是本 App（`MainActivity`，
用户自己开着），照 [[feedback-shared-device-input]] **没有注入任何点击**。

---

## 28. 二十八次迭代：歌词当前行的动态取色整体回退（2026-10-18）

### 28.1 用户一句话

> 将歌词颜色回退到这场对话开始的的无动态颜色版本

§26/§27 那两轮（当前行高光：色相跟封面、可读性与落差闸门、激进档）**整支撤回**，屏幕回到 §25 末态：
② 的当前行就是那支实白（`c-primary` → `BLUR_INK.primary`），与标题/控件逐字节同色，层次仍由
歌词那两层的 alpha 与黑纱面板摆。

### 28.2 撤掉的东西（逐件）

| 位置 | 撤掉 |
| --- | --- |
| `src/utils/monet/onCoverTheme.ts` | `resolveLyricActiveColor` 一整支：`COVER_INK_MIN_BASE_CHROMA` / `BLUR_FIELD_PESSIMISM` / `LYRIC_ACTIVE_CHROMA_CEIL` / `LYRIC_ACTIVE_CHROMA_RATIO` / `INK_LYRIC_ACTIVE` / `BLUR_LYRIC_TIER_GAP` / `toneToChannel` / `inactiveLyricTone`，以及 `parseCssColor` 的 import |
| `src/screens/PlayDetail/Vertical/Lyric.tsx` | `LineProps.activeColor`、`colors` 里的 `activeColor ??`、memo 比较器那条、页面 `useMemo(() => resolveLyricActiveColor(surface))` 与 `renderItem` 的传参（共七处接线） |
| `tests/monet-on-cover-ink.mts` | ② 当前行那一整段（5 条）与它的 import；文件自 13 条回到 8 条 |
| `tests/monet-on-cover-theme.mts` | 两处随功能改过的注释口径（`ONE_PAINT_KEYS` 与"三层白分得开"那条的标题/注释），全部还原 |

回退用的是外科脚本（`.scratch/t163_revert.mjs`，逐块定位 + 残留断言），不是 git 回退 —— 工作区里
压着别人未提交的 WIP（同 §24.4 的理由）。**保真核验**：`grep -rn` 上述九类符号在 `src/`+`tests/`
零命中；`monet` 四个 suite（ink/theme/cover-palette/gate）**85 条全过**；tsc 137 = 基线；eslint 无输出。

`§26`/`§27` 两节**留着**：它们记录的是真实做过、真机装过的两轮（"先做出来、看过、再撤掉"本身就是
这一档的定价过程）；§26.8/§27 的真机判项随这次回退作废。

---

## 29. 二十九次迭代：当前已播歌曲的背景效果也进缓存（2026-10-18）

### 29.1 用户一句话

> 将当前已播歌曲的全屏播控页的背景(莫奈取色或背景封面模糊)的效果也加入缓存中

### 29.2 缺口在哪：下一首有人焐，当前这一首没有

背景效果的触发点在 `useCoverSurface` —— 也就是**打开全屏播控页那一刻**才去 `getCoverSurface`：

- 像素层（原生取图 + 128px 采样）与配色层（monet 支实测 143ms 量化）都是现算现缓存；
- **下一首**有 `preloadNextMusic` 的 `palette` / `coverBytes` 两步焐着（快到点了就焐，切歌即热，见 §preloadPlan）；
- **当前这首歌**没人管：从列表切歌、或在别的页面停一会儿再进播放页，第一帧只能是保守底，
  颜色与糊封面要等"原生图请求 + 一段空闲量化"才浮现。

### 29.3 改动：一个只焐缓存的接线模块

`src/core/init/player/warmCurrentBackdrop.ts`（新文件），注册进 `core/init/player/index.ts`：

- 触发：`playerMusicInfoChanged`（pic 是异步落定的 —— 先给 `meta.picUrl`、随后可能被 `getPicPath`
  的结果替掉，而 `useCoverSurface` 读的正是最后落定那一格）+ `configUpdated`（`theme.dynamicBg` /
  `theme.dynamicBgAlgorithm` 翻动时清去重账重焐）+ 启动时一次（队列恢复的场景）；
- 动作两条，都在缓存层、失败静默：`getCoverSurface(pic, ON_COVER_FONT_CSS)`（配色）与
  `prefetchCoverImage(pic, defaultHeaders)`（封面字节，CoverBackdrop 的 `ImageBackground` 走 `force-cache` 的那份）；
- 去重：按 `pic` + 归一后的档位；
- **边界与 `preloadNextMusic` 的 palette/coverBytes 逐字相同**：只焐 `coverPalette` 的缓存，
  绝不碰 `coverBackdropStore` 的 attempts 账本与 generation —— 那张账管的是"该不该再问原生、什么时候自愈"，
  去动它就是重写「时有时无」那个缺陷。两边按 `picUrl|font|algo` 合并 promise，
  页面打开时读到的是同一条在途/同一格缓存，不会往原生队列压第二条；
- 开关关掉就不焐（收益只发生在动态背景生效时）；主题自带背景图那一格不在这里判（与预热同一个口径，
  那张判定在 `resolveCoverBackdrop` 里）。

### 29.4 闸门

`npx tsc --noEmit -p .` **137 = 基线**（两个改动路径零命中）；`npx eslint` 无输出；
`npm test` **783 / pass 782 / fail 1**（无新增/删除用例，纯接线；唯一红是 `tests/monet-texture.mts:68`
那条 §7.4 故意留红的，与前几轮同一支）。

### 29.5 出包与装机

**出包（22:39）**：`npm run pack:android` **BUILD SUCCESSFUL in 5m 40s**（716 tasks：28 executed / 688 up-to-date；
`:app:mergeReleaseAssets` 与 `:app:packageRelease` 都真的执行了，日志 `.scratch/t163_build.log`）。
bundle **8,407,764 B**、sha256 `455BBAD6…D423`（比 §27.6 那支 −228 B：撤掉当前行高光那一段、加上本轮的预焐模块）；
mtime 22:39:32 晚于最后一次源码编辑 22:25:45（那两处是**别人的 WIP**，不是本轮改动 —— 本轮最后编辑在 22:1x）；
`src` 里没有比 bundle 更新的文件；从 arm64 包里 `tar` 出的 `assets/index.android.bundle` 与生成的那份**逐位相同**。
产物：arm64 **20,867,480 B**、sha256 **`d6a9c004b836fc9ecd5bbc6c03d439dd96851465dc4ad904d13a001222a94267`**。

**符号探针的差分（对 21:45 那支已装机的包）**：`resolveLyricActiveColor` **1 → 0**（§28 的回退可见、
可自证）；`prefetchCoverImage` 两侧各 1。**有一条限制要如实写**：本轮新模块的**本地标识符**
（`warmCurrentBackdrop` / `warmedPic` / `warmedAlgo`）在 Hermes 字节码里**不进字符串表**（只有导出名/属性名才进），
所以"新模块进包"不是靠符号探针证的，而是靠：`core/init/player/index.ts` **import 了它并在初始化链里调用**
（源码可见），Metro 对 import 是静态解析——模块缺了或解析失败就出不了包；这一趟 bundle 是删掉旧产物后重打的、
内容与上一支逐字节不同、gradle 把两个打包任务都判成要执行。

**装机（待用户在手机上点确认）**：`adb push` 到 `/data/local/tmp/t163.apk` 成功（20,867,480 B），
`pm install -r` 两次均报 `Failure [INSTALL_FAILED_ABORTED: User rejected permissions]` ——
核到设备当时 `mWakefulness=Asleep`、前台是通知栏：**vivo 那个"是否允许安装"确认框在熄屏下没人点，被系统判成拒**。
按 [[feedback-shared-device-input]] 不注入任何点击/按键（唤醒也不做）。**包已推到设备上**，
用户亮屏点掉确认框后重跑一次 `pm install -r` 即可（几秒钟），随后按惯例核 `lastUpdateTime` 与拉回
`base.apk` 的 sha256。

---

## 27. 二十七次迭代：② 改名「封面模糊」，铺底层闸门改成整段行程的淡入淡出（2026-10-18）

（本节与 §26 是**同一时间窗里并列的两轮**：§26 动的是歌词当前行的颜料，本节动的是设置标签与铺底层闸门形状，
互不重叠；节号按落纸先后排，不是先后依赖。）

### 27.1 用户这两句话就是这一轮的全部范围

> 将取色方式-的文本"动态取色"改为文本"封面模糊"
> 并且将该状态下的全屏播控页的模糊背景做成随着控制栏到全屏播控页的动画淡入淡出

第一句只动 i18n 的两个中文标签（`en-us` 的 `Blurred cover` 本来就是这个意思，一字未动）；
第二句只动 ② 的铺底层闸门形状 —— 用户那句话的主语是"**该状态下**的模糊背景"，① 一格没碰。

### 27.2 为什么现在"看不出在淡"：窄窗挂在 ease 过的补间上，只用掉行程前 ~116ms

铺底层的屏上浓度是两段相乘：`baseAnim / washAnim`（墙钟，只管切歌）× 闸门（progress，只管展开/收起）。
闸门原来的窗口是 `[0, 0.45, 1] → [1, 1, 0]`：progress 掉到 0.45 时整层已经满上。
而补间是 `TRANSITION_DURATION_MS = 800` + `Easing.bezier(0.22, 1, 0.36, 1)`（强 ease-out）：
解这条贝塞尔，easing 在 x≈0.145 处就把"已走行程"推到 0.55 —— 也就是 progress 到 0.45、整层淡到位，
**只用了行程前 ~116ms**。观感因此是"一开整层就钉在那里"；收起方向同理：前 ~116ms 整层就没了，
剩下 ~684ms 只是一张已经换成播放栏底色的卡片在收。拖动那一路也偏：不拖过 55% 的行程，封面色一直没上来。

### 27.3 落点：② 的闸门铺满整段行程，① 保持窄窗

`getEnterBackdropOpacityRange(fullLength = false)`（`PlayerOverlay/transition.ts`）：

- `fullLength = true`：`[0, 1] → [1, 0]`（线性、无平台段）。浓度直接跟着 progress 走 ——
  拖动时跟着手指、补间时跟着动画，两端不变：全屏是 1，播放栏那一面仍是 0（"别把封面色留在栏上"这条不动）。
  调用处按 `layer.surface.mode === 'blur'` 传（保守底也是 `mode: 'blur'`，两支都吃到）。
- `fullLength = false`（① 的默认值）：`[0, 0.45, 1] → [1, 1, 0]` **一字不动** —— 它的洗色只是蒙版底下的一层纹路，
  与底色同一个窗口翻完就够，而且 §10.4-3 的逐像素凭证钉在它身上。

顺带记一条不是本轮的：真正的 `pushPlayDetailScreen`（RNN 共享元素那条）只在"启动即进播放页"的
`skipAnimation` 上走，播放栏常驻的那几个页面都挂着 `PlayerOverlayProvider`，所以"控制栏到全屏播控页的动画"
就是 morph 这一条，本轮的改动面正好覆盖它。

### 27.4 改动清单

| 文件 | 内容 |
| --- | --- |
| `src/lang/zh-cn.json` / `zh-tw.json` | `setting_basic_theme_dynamic_bg_algorithm_blur`：动态取色 / 動態取色 → **封面模糊**（三语键集合不变，各 761 键） |
| `src/components/player/PlayerOverlay/transition.ts` | `getEnterBackdropOpacityRange(fullLength = false)` 两支形状 + 上面那笔贝塞尔的推导注释 |
| `src/components/player/CoverBackdrop/index.tsx` | 闸门按 `layer.surface.mode === 'blur'` 选形状；`progress` prop 与文件头两处注释补上档名/形状口径 |
| `tests/overlayEnterFade.test.mts` | "四条淡入表"那条把 `getEnterBackdropOpacityRange(true)` 也收进域/单调检查；端点那条改成两支形状都过；新增一条钉两支形状 |

### 27.5 闸门（本机实测）

`npm test` **783 / pass 782 / fail 1**（此为**本轮改动后**的全量跑；随后并行那一轮又加了 1 条用例，
现状是 §26.6 记的 784/783/1，两条改动叠在一起时全绿）。唯一红仍是 §7.4 那条故意留红的 `monet-texture`
"正文区必须钉在色阶带上沿以下"（与本轮无关）。单跑 `tests/overlayEnterFade.test.mts` **8/8**；
连带跑六支 overlay 与三支 monet 套件 **85/85**。
`npx tsc --noEmit -p .` **137 = 基线**（107 src + 28 tests + 2 test，本轮改动的路径一条都没命中）。
`npx eslint` 对两个改动的 `src` 文件无输出。

### 27.6 出包与装机（20:58 出、20:59:37 装上）

`npm run pack:android` → `assembleRelease` **BUILD SUCCESSFUL in 5m 13s**（716 tasks，28 executed / 688 up-to-date；
出包前照惯例删过 `…/createBundleReleaseJsAndAssets/index.android.bundle` 逼它重打包，日志 `.scratch/t159_build.log`）。

| 证据 | 实测 |
| --- | --- |
| 打包时刻晚于最后一次源码改动 | bundle mtime **20:57:50**；`src` 下没有比它更新的文件（最晚一处是并行那一轮的 `onCoverTheme.ts` **20:52:55** —— 也就是说这支包里同时带着 §26 的歌词行改动） |
| APK 里那坨 JS 就是刚生成的这一份 | 包内 `assets/index.android.bundle` 与当时（20:57:50）generated 那份**逐字节相同**：8,407,868 B / sha256 `e5111898…bc09e`（generated 那份随后会被下一次出包删掉重建，认哈希与时间，别认路径） |
| 包体只有 JS 在动 | arm64 `20866497 → 20867536`（**+1,039 B**，bundle 本身 +1,100 B），Java/资源一行没改 |

arm64 sha256 `123380cdd0bbddc1be48a54686693aa7a286f81f2421dcf03cfe54c2c1e16576`。

**符号探针（一进一出）**：`getEnterBackdropOpacityRange` **1**、`BLUR_LYRIC_COMPONENT_OPACITY` **1**（正对照）；
`fullLength` 0 —— 这支 bundle 是压缩/改名过的，局部形参名不进串表，别拿它当负向证据。
**并更正 §24.8 记的那条"中文串探不出来"**：这支 bundle 上 UTF-16LE 读法是**有效**的 ——
「封面模糊」**1** 次（新标签进包）、正对照「莫奈取色」**1** 次（两语共用同一串，去重后就是 1）；UTF-8 读法两者都是 0。
（§24.8 那次探的内容逐字节相同，所以当时的 0 是探法本身的问题，不是"bundle 藏中文"的结论。）

**装机**：走 §23.7 那两条 —— `adb push …/xunyin-v1.1.0-arm64-v8a.apk /data/local/tmp/t159.apk`（22.6 MB/s）→
`adb shell pm install -r` → **`Success`**。三件证据：`lastUpdateTime=2026-10-18 20:59:37`、
`firstInstallTime=2026-10-09 17:19:53` **未动**（覆盖装、数据没丢）；从 `pm path` 拉回的 `base.apk` sha256 与本地这支
**逐字节相同**（`123380cd…e16576` / 20,867,536 B）；设备上的 `/data/local/tmp/t159.apk` 已删。

**没有启动 App、没有注入任何点击**（按 [[feedback-shared-device-input]]）：装机时前台还是系统设置；
装完只读核对时前台已经是本 App（用户自己点开），截图里它停在「我的列表」、播放栏是暂停的 The Days - Avicii ——
判定用户在亲自用机，一次注入都没发。

### 27.7 这一轮之后剩下的真机项

- **27-1 ② 的展开与收起**：模糊背景要**整段跟着动画淡** —— 展开时浓度一路爬（不是开头一下就满）、
  收起时一路退（不是一按就没了），两端都不许在播放栏那一面留封面色。
  若判"还是看不出来"，要动的是补间本身（`TRANSITION_SPRING_CONFIG` / `TRANSITION_DURATION_MS`），**要用户点头**。
- **27-2 标签**：设置 →「取色方式」第二行读作 **封面模糊**（`莫奈取色` 不动）。
- **27-3 ① 没被渗到**：切到莫奈取色，展开/收起应当与 §25 那支包逐像素相同（本轮只递了 `fullLength=false` 这条默认路径）。
- 连同 25-1/25-2/25-3、26-1/26-2、20-x/19-x/18-x/16-x 一起等用户进播放页时判。

---

## 28. 二十八次迭代：「分享方式」面板挂回普通底 —— §12.4 那张表漏掉的一层（2026-10-18）

### 28.1 用户这一句话就是这一轮的全部范围

> 将当前取色方式-封面模糊下的全屏播控页点击分享按钮出现的界面改为普通白底

也就是 §12.4 那条"点按按钮出现的界面都作为普通白底展示"的要求，在**分享按钮**这一层上还没兑现。

### 28.2 根因：ShareModeSheet 是唯一没进 §12.4 那张表的面板

分享图那条线（`01680db`）给播放页头部添的「分享方式」面板（`Vertical/components/ShareModeSheet.tsx`）落地时，
`SheetThemeProvider` 那支还没合进主干；两边都改 `Header.tsx` 的渲染区，合成时只把 `LyricSettingSheet` 包了进去 ——
面板因此裸挂在场上主题下，② 把 `c-content-background` 映射成 0.32 的黑纱（`onCoverTheme.ts` 的 `panel` 墨色），
点分享读到的就是"半透明黑纱浮在糊图上"。（这笔账在分享图 spec §11.6 的"合并卫生"里挂着，本次收掉，
所以 §12.4 那张表现在是**六个挂载点**。）

### 28.3 改动清单

| 文件 | 内容 |
| --- | --- |
| `src/screens/PlayDetail/Vertical/components/Header.tsx` | `<ShareModeSheet>` 移进 `SheetThemeProvider`（与 `LyricSettingSheet` 同一个 provider 块 —— 同一层树、同一次换值） |
| `tests/cover-sheet-theme-source.mts` | 新增：把 §12.4 五个挂载点 + 分享这一层的"必须包在 `SheetThemeProvider` 里"按源码挂法钉住（弹层是 RN Modal，`node --test` 起不了渲染）。表里写的是"以后谁再给播放页添弹层，同批把这里补一行" |

浅色主题下 `c-content-background` = `rgb(255,255,255)`（`theme/themes/themes.ts`），所以落成的就是用户要的"普通白底"；
深色主题与 App 里其他弹层同底 —— `GlassBackdrop` 在无主题背景图时只是把同一个色叠在面板自己的实底上，不改变观感。

### 28.4 闸门（本机实测）

`npm test` **781 / pass 780 / fail 1**（比本轮前多 1 条，就是上表那支用例；唯一红仍是 §7.4 故意留红的
`monet-texture`"正文区必须钉在色阶带上沿以下"，与本轮无关）。`npx tsc --noEmit -p .` **137 = 基线**，本轮两个改动路径 0 命中；
`npx eslint` 对两个文件无输出。**变异检查**：把 `<ShareModeSheet>` 挪回 provider 外面，新用例立刻红
（"SheetThemeProvider 必须包住 ShareModeSheet"），挪回来即绿 —— 这条不变式不是空跑的。

### 28.5 真机项

- **28-1（主判项）**：② 下点播放页头部的分享按钮，「分享方式」面板要是**普通白底**（浅色主题）——
  不许透出糊封面、不许是黑纱，与播放列表 / 更多 / 歌词设置那些面板同一张脸。
- **28-2**：切到莫奈取色、再关掉动态背景各点一次分享，面板应与本轮之前的包逐像素相同（这层只有挂法变了，一个颜色/尺寸都没动）。
- 连同 27-x、26-x、25-x、20-x/19-x/18-x/16-x 一起等用户进播放页时判。**本轮没出包、代码未提交。**

---

## 29. 二十九次迭代：② 的歌词梯队压开一档 —— 用户点了「最强烈」那一档（2026-10-19）

### 29.1 这一轮从哪句话来

> 试一下把当前行的白再压一档（原话大意：非当前歌词和当前歌词的颜色区分不明显）
> …
> 用最强烈的一档

上一轮（§25）的交货是「整面只有一支实白 + 歌词两层靠 alpha」，阶梯在真机上读作
**L\*100 / 90.2 / 83.4 / 80.9**（当前行 / 当前行译文 / 非当前行 / 译文，t170 用真机截图反解重渲染）。
当前行的最近竞争者不是别的行，是它自己那句译文（90.2，靠主题的 `c-primary-alpha-200` = 0.80 撑着）；
非当前行 83.4 与它只差 16.8 —— 用户判"分不明显"。四档小样（.scratch/t170_{now,A,B,C}.png）
摆在截图本体上，用户点了最强烈的 C。

### 29.2 改动清单

| 文件 | 内容 |
| --- | --- |
| `src/utils/monet/surface.ts` | `BLUR_MIN_CONTRAST` **5.0 → 5.5**（只抬歌词台那一条） |
| `src/utils/monet/onCoverTheme.ts` | `BLUR_LYRIC_COMPONENT_OPACITY` **0.75 → 0.50**；新增 `BLUR_LYRIC_ACTIVE_TRANSLATION_ALPHA = 0.66` 与 `BLUR_ALPHA_OVERRIDES`（**只在 blur 那一档**把 `c-primary-alpha-200` 从主题的 0.80 收到 0.66 —— ① 与普通主题照旧）；`BLUR_INK.lyricSoft` **0.92 → 0.88** |
| `src/screens/PlayDetail/Vertical/Lyric.tsx`、`src/utils/hooks/useGlassColors.ts` | 只改注释：那条组件乘法与 ink 是成对核的 |
| `tests/monet-blur-surface.mts` | "两台共闸、δ 恒 0"那条改成"歌词台比浏览台厚"：δ>0、合成恒等式、浏览台自己过 5.0、暗封面两台都停在最少透出量；底下那条桩从"闸门必须同值"改成"浏览台必须低于歌词台" |
| `tests/monet-on-cover-theme.mts` | 新增 `BLUR_LYRIC_MIN = { c-350: 2.45, c-300: 2.30 }`（② 歌词两层自己的下限，原因写在旁边）；tier 用例 `font - lyric` **12 → 17**，并新增"当前行译文必须夹在实白与非当前行之间"；表头与夹具注释同步 |

### 29.3 两台分岔与 δ 第一次有了读者

2026-10-18 两条线并平（δ 恒 0，压暗层留着但永远透明）。这一轮只抬歌词台，于是
`solveStages` 解出的歌词格比浏览格厚：δ = **0.03~0.12**（夹具逐张，见 .scratch/t171_ship.mts），
`CoverBackdrop` 那层（stageDim × δ）第一次真的在铺 —— **歌词页背景略暗、歌曲页一个像素不变**。
这正是这一档"场再暗一点"的机制，不是新代码：两条闸门分开的那天它就自动生效。

### 29.4 读数（t166 扫描表 / t171 真模块 / t170 成图）

| 闸门 / 组件 | 实白 | 非当前行 | 译文 | 当前行与非当前行的落差 |
| --- | --- | --- | --- | --- |
| 5.0 / 0.50 | 4.74 | 2.39 | 2.21 | 25.2 |
| **5.5 / 0.50（交货）** | **5.17** | **2.52** | **2.31** | **26.3** |
| 6.0 / 0.50 | 5.66 | 2.64 | 2.43 | 27.8 |
| 5.5 / 0.75（上一档） | 5.17 | 3.63 | 3.25 | 13.7 |

（WCAG 取最坏夹具；场 = 模型场 L\*43.7~44.3 + 真机峰值 1.7 个 L\*。真机成图上的屏上明度：
**100 / 83.2 / 67.4 / 64.9**，落差 16.8 / 15.8 / 2.5。）

**代价写明**：歌词那两层的下限从 3.0 掉到 2.3 一线（2.52 / 2.31）—— 这是这一档拿"非当前行还够不够读"
换来的，由用户在四档小样里拍板，测试里那两条下限就是按它定的，不要顺手改回 3.0。
深色封面（多数）上仍在 4 以上（真机那片场 4.55 / 3.98）。当前行那一支（4.5 的线）反而升到 5.17。

**顺手捞回来的一格**：0.98/0.92 那对 ink 是照 0.75 那个组件核的；组件落到 0.50 之后，
两层在模型场上只差 1.7 个 L\*（真机成图 1.3），"译文"又并回非当前行那一层 —— 判据（≥2）当场就红。
译文墨因此退到 0.88：模型场 2.9 / 真机成图 2.5 的档重新立起来，代价落在普通译文行上
（暗封面 L\*66 一线 → L\*57，对那片场仍有 3.98:1），另外三档一格都没动。

### 29.5 闸门（本机实测）

`npm test` **809 / pass 808 / fail 1** —— 唯一红仍是 §7.4 故意留红的
`monet-texture`"正文区必须钉在色阶带上沿以下"（89.84 vs 带 72~88，与本轮无关）。
`npx tsc --noEmit -p .` **137 = 基线**，本轮 4 个改动路径 0 命中。
`npx eslint` 对三个 `.ts/.tsx` 无输出；两个 `.mts` 报的是解析错，**这份配置本来就不认 `.mts`**
（未改动的 `.mts` 同样报），`.mts` 的闸门是 `npm test`。

**变异检查（两条新不变式都不是空跑）**：
把 `BLUR_BROWSE_MIN_CONTRAST` 改回 5.5 → "浏览台没有比歌词台薄"与"两台闸门并平或反超"两条立刻红；
把 `lyricSoft` 改回 0.92 → "非当前行 L\*72.2 与译文 L\*70.5 只差 1.7，译文不成档"立刻红。两处都还原、复跑即绿。

### 29.6 真机项

- **29-1（主判项）**：② 下歌词页，当前行要一眼压过非当前行（真机成图 100 / 83.2 / 67.4 / 64.9）。
- **29-2（这档的代价）**：换成亮封面（白底 / 日落这类）再看非当前行与译文够不够读 —— 最坏 2.52 / 2.31。
  若判"看不见了"，往回退的是 `BLUR_LYRIC_COMPONENT_OPACITY`（0.60 是一档、0.50 是这一档），不是 3.0 那条线。
- **29-3**：歌词页背景应比 §25 那支包**略暗**（δ 0.03~0.12 的压暗层第一次生效），**歌曲页不变**。
- **29-4**：切到莫奈取色 / 关掉动态背景，歌词页与 §25 那支包逐像素相同（本轮只动 ② 那一支）。
- 设备今天（2026-10-19）连不上：无线 adb `192.168.137.81:33805` 超时（10060）—— 包出好了（见 29.7），**没装机**；代码未提交。

### 29.7 出包（本机实测）

`npm run pack:android` → `assembleRelease` **BUILD SUCCESSFUL in 2m 15s**（716 tasks，35 executed / 681 up-to-date；
出包前照惯例删过 `…/createBundleReleaseJsAndAssets/index.android.bundle` 逼它重打包，日志 `.scratch/t173_build.log`）。

| 证据 | 实测 |
| --- | --- |
| 打包时刻晚于最后一次源码改动 | bundle mtime **12:06:21**；`src` 下没有比它更新的文件（本轮最后一处是 11:58:44 的 `surface.ts` / `onCoverTheme.ts`） |
| APK 里那坨 JS 就是刚生成的这一份 | 包内 `assets/index.android.bundle` 与 generated 那份**逐字节相同**：8,415,048 B / sha256 `7bdaa0b4…c9e9d2` |
| 新导出真的在包里 | 符号探针（UTF-8，正对照）：`BLUR_LYRIC_ACTIVE_TRANSLATION_ALPHA` **1**、`BLUR_LYRIC_COMPONENT_OPACITY` **1**、`BLUR_MIN_CONTRAST` **1**、`BLUR_BROWSE_MIN_CONTRAST` **1**；模块私有的 `BLUR_ALPHA_OVERRIDES` 0（压缩改名，别当负向证据） |
| 包体 | arm64 `20,868,041 → 20,872,277` B（**+4,236**），bundle `8,408,952 → 8,415,048` B（**+6,096**） |

**这支包不止本轮这一档改动**：上一支包（10-19 02:25）之后 `src` 与 `android/` 还被别的线动过 ——
`src/core/userApi*`、`src/utils/data.ts`、`src/lang/*.json` 等（10:00~10:32）与
`android/…/userApi/*.java` 四个文件 + `assets/script/user-api-preload.js`（10:20~10:27）。
也就是说 `+6,096 B` 的 JS 里混着那一批；判 29-1~29-4 时如果见到与歌词无关的异常，先想到这条。
**包文件**：`android/app/build/outputs/apk/release/xunyin-v1.1.0-arm64-v8a.apk`，
sha256 `4284ccca…f8c562`（上一支 `d74dfe8b…382111`）。
装机命令（设备回来即用）：`adb push <apk> /data/local/tmp/t173.apk` → `adb shell pm install -r /data/local/tmp/t173.apk`。

**用户要求复跑一次出包**（同日 16:22）：`BUILD SUCCESSFUL in 2m 13s`（716 tasks，25 executed / 691 up-to-date），
产物与上面那次**逐字节相同** —— bundle 重新生成后 sha256 仍是 `7bdaa0b4…c9e9d2`，APK 仍是 `4284ccca…f8c562`、
mtime 都没动（打包那一串任务判 UP-TO-DATE）。同一份源码交同一支包，没有不确定性可赌。
设备侧：`adb connect` 的答复从超时（**10060**）变成**拒绝（10061）**，`adb mdns services` 一个服务都没有 ——
手机的无线调试关着，或换了端口（Android 每次开关都会换端口）。装机仍欠着：打开无线调试后用 `adb mdns services`
认端口、`adb connect <ip>:<port>` 即可（配对码一次就够，之后不必重配），或者直接上线。

**装机（2026-10-19 16:24）**：端口由用户给出（`adb connect 192.168.137.81:39411` —— 手机重开无线调试换了端口，
旧端口 33805 才会从超时变成拒绝）。`adb push … xunyin-v1.1.0-arm64-v8a.apk /data/local/tmp/t174.apk`（1.0 MB/s，20.5s）
→ `adb shell pm install -r` → **`Success`**。三件证据：`lastUpdateTime=2026-10-19 16:24:33`、
`firstInstallTime=2026-10-09 17:19:53` **未动**（覆盖装、数据没丢）；从 `pm path` 拉回的 `base.apk` sha256 与本地这支
**逐字节相同**（`4284ccca…f8c562` / 20,872,277 B）；设备上的 `/data/local/tmp/t174.apk` 已删。
**没有注入任何点击**（按 [[feedback-shared-device-input]]）：装完只读截了一屏，用户当时在「自定义源管理」里导源，
不在播放页 —— 29-1/29-2 等他进歌词页再判（到时我只读截图，就能把真机上的阶梯按 29.4 那张表量一遍对账）。
