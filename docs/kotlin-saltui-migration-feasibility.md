# 迁移到 Kotlin + SaltUI：可行性评估与迁移方案

> 评估日期：2026-10-23。本报告基于当前仓库实测数据与上游项目的一手 LICENSE/README 文本。分批次执行方案见 §七。

## 一、结论先行

**整体可行，但分两档：**

| 事项 | 可行性 | 协议 | 说明 |
|:--|:--|:--|:--|
| ① 全屏播控页背景模糊改为 Salt Player 风格 | ✅ 可行（推荐） | 无风险 | Salt Player App 本体**闭源**，无法抄代码；样式属于通用视觉手法（封面模糊+取色蒙版），实现为原创，不涉及协议问题 |
| ② 整个应用改 Kotlin + SaltUI 架构 | ⚠️ 可行但代价极大 | 无风险 | 724 个 TS/TSX 文件、约 7.7 万行需全部重写；RN 容器与原生模块绑定，建议渐进迁移或新开原生壳工程 |
| ③ SaltUI 组件库直接使用 | ✅ 可行 | Apache 2.0 | `io.github.moriafly:salt-ui`，Maven Central 可拉取，minSdk 23 |

## 二、本应用现状（实测）

- 技术栈：React Native 0.73 + Wix react-native-navigation + Redux + Hermes。
- 规模：`src/` 下 724 个 TS/TSX 文件，共约 **77,238 行**。原项目原生侧 `cn.toside.music.mobile` 共 48 个 Java 文件（音源桥、桌面歌词、音频解码、缓存、加密、QuickJS 等），全部在用。
- 上游：lx-music-mobile（Apache 2.0）。README 带上游补充协议（免责声明/版权数据/非商业等），**与代码无关，不约束界面重写**。
- 现有背景模糊实现：`src/components/player/CoverBackdrop/index.tsx`（243 行）—— Fresco 的 `blurRadius`（9dp/90dp 两档）+ 取色蒙版 + 分台压暗层 + 槽位交叉淡入淡出（先叠后撤）。这套机制不必推倒，只改「视觉参数与层级结构」即可得到 Salt Player 风格。

## 三、协议合规性核实（一手来源）

| 项目 | 协议 | 来源 | 对你的影响 |
|:--|:--|:--|:--|
| SaltUI | **Apache 2.0** | github.com/Moriafly/SaltUI（LICENSE，main/master 同文） | 随便用：商用、修改、分发均可；需在发布物中保留其 LICENSE 副本 + NOTICE（如有） |
| Salt Player 本体 App | **闭源**（SaltPlayerSource 仓库只发 Release/收集反馈，README「Open Source Related」只列 SaltUI 与 media-kit） | github.com/Moriafly/SaltPlayerSource（MIT，但仅覆盖该仓库内容） | 不能反编译/复制其代码与资源；但「封面模糊背景+取色」是通用 UI 手法，独立实现完全合法 |
| SaltPlayerSource 仓库 | MIT | 同上 | 若参考其 README/文案/翻译文件等，保留 MIT 版权声明即可 |
| lx-music-mobile（本应用基座） | Apache 2.0 + 上游补充协议 | 本仓库 LICENSE / README | 继续沿用其代码必须保持 Apache 2.0 并保留归属声明（README 已做）；补充协议约束的是使用行为（版权数据、非商业），不阻止技术重构 |
| 本项目 LICENSE | Apache 2.0 | 仓库根 LICENSE | 保留即可 |

**要点：没有任何一个上游协议（Apache 2.0 / MIT）禁止你做这件事。** 唯一的「不能干」是：把闭源的 Salt Player 本体代码/资源拿来用——而你要的背景模糊样式不需要那样做。

## 四、方案一（推荐）：RN 内实现 Salt Player 风格背景模糊

### 原理对齐

Salt Player 播放页背景的观感（基于公开截图与通用实现手法的分析）：
1. 封面图轻度模糊（模糊半径小，保留大色块）；
2. 上叠一层从封面提取的主色调（动态取色）；
3. 按前景内容（封面/歌词）叠不同程度的压暗/遮罩；
4. （可选）低透明度纹理/噪点，避免纯色底的“塑料感”。

### 落地改动点

改动集中在现有 `CoverBackdrop` 机制上，工程量小、风险低：

1. **模糊层**：`COVER_BLUR_RADIUS` 从 9dp 调到 12–18dp（Salt Player 风格比现行 9dp 更糊一点，可调参），保留 `OVERSCAN 1.25` 的外扩防暗边方案。
2. **取色蒙版**：沿用现有 monet 管线（`src/utils/monet/`，1872 行的测色/蒙版系统）。把 `browseScrimAlpha`（浏览台遮罩）的取色浓度调高、纯色底 `surface.base` 的饱和度策略微调，向 Salt Player 的“浓取色压在糊封面上”靠拢。
3. **压暗层**：保留分台布光（浏览台亮、歌词台暗）。Salt Player 歌词页背景更暗，正好对应 `stageDim × stageDimAlpha` 那层。
4. **可选纹理**：`src/utils/monet/texture.ts` 已有云纹生成，可加低 alpha 噪点进一步提升质感。
5. **morph 兼容**：`progress` 闸门机制不动，`fullLengthFade` 判据不动（`tests/monet-*.mts` 那组 node --test 继续生效）。

### 工作量与风险

- 工作量：**约 1–3 天**（改参数 + 调蒙版浓度 + 跑通 28 个 monet 测试）。
- 风险：低。不动层结构，不引入新依赖。
- 测试基线：`tests/monet-blur-surface.mts`、`tests/monet-gate.mts` 签发的判定逻辑全保留。

## 五、方案二：整体迁移到 Kotlin + SaltUI

### 工程结构

1. 新建原生 Android 工程（minSdk 26+，建议 28），Kotlin 2.x + Compose Multiplatform 1.12.x（SaltUI 3.0.0-beta03 要求 Compose 1.12.2 / minSdk 23+，按 SaltUI 兼容表配）。
2. 依赖：`io.github.moriafly:salt-ui:3.0.0-beta03`（Apache 2.0），可选 `salt-ui-navigation`（minSdk 24）。
3. 原生侧沿用 lx-music 原生模块思路：播放内核可用 `Moriafly/media-kit`（Salt Player 团队公开的媒体服务库，同为开源）或 Media3 ExoPlayer（Apache 2. 音频流: MediaSession + Media3；桌面歌词：自绘 View / Compose 悬浮窗服务。
4. UI 全部用 SaltUI 组件（SaltTheme 包根）+ 自绘特殊控件（进度条、歌词滚动）。

### 分阶段迁移（降低风险）

- **M0（试点）**：原生壳 + SaltUI 播放页单页（封面、歌词、控制条）+ Media3 播放。背景用本方案四的风格（SaltUI 的 `SaltTheme` + Compose `ImageBlur` 类组件或 RenderEffect 模糊）。
- **M1（核心）**：列表/歌单/搜索三大页 + 播放服务。数据层移植 `src/store`（Redux → 多种方案，见 react-state-management skill，建议 Zustand/Redux Toolkit 前先做图表）。
- **M2（长尾）**：设置、评论、同步、桌面歌词、音源管理（QuickJS 需原生移植 QuickJS Android 绑定）。
→ 每阶段发布对照可用版本，保留 RN 版本作回退。

### 工作量与风险

- **工作量：3–6 人月起步**（7.7 万行 TS 重写 + 原生模块移植）。这不是重构，是重写。QuickJS 音源桥（userApi/Console/JsHandler 那套 8 文件）和桌面歌词（lyric/ 9 文件）是最难啃的硬骨头。
QuickJS 桥是自定义源生态的命根，翻译 JS 侧 `src/core/userApi` 与原生 `userApi/` 的双端协议，漏一处就全废。
- **风险：高**。
  - SaltUI 3.0.0 是 **beta**，API 可能变（2.x 是稳定线）；
  - Compose 1.12 + KMP 对 Windows 构建环境要求高；
  - RN 0.73 的生态（react-native-navigation 等）在纯 Kotlin 侧没有对等物，全部要重新设计；
  - AGENTS.md 约定竖屏锁定不受影响（MainActivity portrait + Navigation layout portrait 不变），但 RN 特有的横屏死代码可一并清理。
- **协议注意**：新项目继续开源 → 保持 Apache 2.0 兼容无压力；若闭源商用 → lx-music 的补充协议（非商业条款）可能构成障碍，**建议保持开源非商业**。

### SaltUI 在 Google Play 的坑（README 原文）

SaltUI 内部使用了 ART 隐藏 API（AndroidHiddenApiBypass），发 Google Play 需在 build.gradle 关闭依赖信息上报：

```kotlin
android {
    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }
}
```

（你目前走 GitHub Release/酷安渠道，暂不受影响，但要记录在案。）

## 六、建议

1. **先做方案一**（背景模糊 Salt Player 化，RN 内改参数+蒙版浓度）：1–3 天见效，零协议风险，先看观感是否达标。
2. **若观感满意但你还想要 SaltUI**：做 M0 试点原生壳，验证 SaltUI beta 的稳定性与观感，再决定是否全量迁移。
3. **不建议一步到位全量迁移**：7.7 万行重写 + beta 组件库 + QuickJS 移植的三重风险叠加，沉没成本极大。

## 七、分批次迁移方案（方案二执行版）

### 总原则

- **原仓库不动**：迁移在 `android-native/`（或独立仓库）进行，原 RN 工程持续可用作对照与回退，直到最后一批收官。
- **每批一个可运行的里程碑**：任何时刻新工程都能 `assembleRelease` 出包、真机能跑，不允许"整体搬家完才能跑"的中间态。
- **协议基线**：新仓库 LICENSE = Apache 2.0 + NOTICE 保留 lx-music-mobile 与 SaltUI 归属（沿用现有 README 的声明结构）；不引入闭源的 Salt Player 本体代码/资源。
- **竖屏约束**（AGENTS.md）：所有 Activity `screenOrientation="portrait"`，Compose 内不写横屏分支。

### 批次总览（自底向上，依赖决定顺序）

| 批次 | 名称 | 内容 | 规模 | 预估 |
|:--:|:--|:--|:--|:--|
| B0 | 工程骨架 | Gradle/KMP/Kotlin 2.x + Compose 1.12 + SaltUI 3.0.0-beta03 依赖接入、CI、骨架页跑通 | ~200 行 | 3–5 天 |
| B1 | 数据与领域层移植 | store（Redux→StateFlow/MVI）、持久化（AsyncStorage→DataStore）、数据模型 | ~2,500 行 | 2–3 周 |
| B2 | 播放内核与原生桥 | Media3 + MediaSession、原生模块等价物（缓存/文件/电池优化等）、音量均衡 | ~1,500 行 | 2–3 周 |
| B3 | 音源生态（QuickJS 桥） | userApi 双端协议、音源脚本运行时、音源更新流 | ~2,000 行 | 3–4 周 |
| B4 | 全屏播控页（SaltUI 风格） | 播放页全家桶：封面、歌词（带桌面级渲染）、控制条、播放列表 sheet、背景模糊 Salt Player 风格 | ~4,950 行 | 3–4 周 |
| B5 | 主界面与列表 | Home（榜单/搜索/歌单/推荐/设置）、通用组件库 | ~16,200 行 | 4–6 周 |
| B6 | 长尾屏幕与桌面歌词 | Comment/MylistDetail/MusicRecognition/ShareCard 等 + 桌面歌词服务（9 个 Java 文件的等价重写） | ~4,500 行 | 3–4 周 |
| B7 | 收官 | 性能、深浅色全链路、无障碍、上架材料、双端对照收官 | — | 2–3 周 |

**总量约 3.4 万行 Kotlin（含缩水：ts 侧的 RN 专有胶水不移植）+ 3–6 个月**（单人兼职节奏；小团队可并行压缩）。

### B0 工程骨架（3–5 天）

1. Gradle 8.x + AGP + KMP 对齐 SaltUI 兼容表（Compose 1.12.2 / Kotlin 2.x / minSdk 26）。
2. 依赖：`io.github.moriafly:salt-ui:3.0.0-beta03`（可选 `salt-ui-navigation:3.0.0-beta03`，minSdk 24）。
3. `SaltTheme { }` 骨架页 + 竖屏锁定 MainActivity + Navigation 骨架（单 Activity + Compose Navigation）。
4. CI（GitHub Actions）：`assembleRelease` + ktlint/detekt + 单元测试骨架。
5. **验收**：真机装包，SaltUI 组件渲染正常（Button/Text/Slider 抽查），CI 绿。

### B1 数据与领域层移植（2–3 周）

映射表：

| RN 侧 | Kotlin 侧 |
|:--|:--|
| `src/store`（Redux，61 文件 2,490 行） | StateFlow/MVI（每 slice 一个 ViewModel + immutable state），或 Redux Toolkit 思路的单 store |
| `AsyncStorage` | Jetpack DataStore（Preferences/Proto） |
| `react-native-fs`/file-system | Okio + kotlinx.serialization |
| `src/utils/musicSdk`（音源 API 桥，721 行） | Ktor client 或 OkHttp + kotlinx.serialization |
| `src/lang`（2 文件 136 行 + json 资源） | strings.xml / Compose |
| `src/theme`（4,413 行生成的主题表） | 重新生成器：从 `createThemes.js` 逻辑生成 Kotlin `Color` 表 |

关键决策点：Redux → MVI 的映射要在本批一次性定调（slice 边界 = ViewModel 边界），避免 B5 时返工。

**验收**：单测覆盖核心 reducer/state 迁移；数据导入（lxmc 备份文件）在原生壳里跑通。

### B2 播放内核与原生桥（2–3 周）

1. **播放**：Media3 ExoPlayer + MediaSessionService + 通知栏（对应 rn-track-player fork 的自研定制部分——注意该 fork 是 lyswhut 定制版，需对照 [media-kit](https://glyph.moriafly.com/media-kit/) 或直接读 fork diff 确认哪些定制必须保留）。
2. **原生模块等价物**（对应 `cn.toside.music.mobile` 48 个 Java 文件里的非音源部分）：
   - `cache/`（4 文件）→ Okio 缓存管理
   - `utils/`（7 文件）→ 各系统工具（电池优化、通知权限等）
   - `audioRecord/`+`audioFeature/`（5 文件）→ AudioRecord + TFLite（音乐识别用）
   - `volumeBalancer/`（2 文件）→ AudioTrack 均衡
   - `island/`（2 文件）→ 灵动岛/通知样式
   - `palette/`（2 文件）→ Palette API（背景取色直接受益）
   - `crypto/`（4 文件）→ javax.crypto 等价
3. **验收**：通知栏播放/暂停/切歌、后台播放存活（Doze 下 30 分钟）、缓存清理入口可用。

### B3 音源生态 QuickJS 桥（3–4 周，最高风险批）

这是自定义源生态的命根（`src/core/userApi`+`userApiUpdate` 1,301 行 + 原生 `userApi/` 8 个 Java 文件的双端协议）。

1. 移植 QuickJS Android 绑定（社区版 quickjs-android / 自建 JNI 封装），对齐现有 `EVENT_NAMES`、`on/send/request` 消息协议。
2. 移植 `src/core/userApi` 的 JS 侧管理逻辑（音源列表、启停、事件转发、错误码）。
3. 移植 `userApiUpdate`（音源自更新流，1,301 行）。
4. 内置音源（`src/config/builtinSources/`）脚本不动——**它们是纯 JS,运行在 QuickJS 里，跨架构零成本**。
5. **验收**：现有用户最常用的 2–3 个音源脚本在原生壳里加载、搜索、取链、播放成功；音源自更新跑通。

### B4 全屏播控页（3–4 周，效果验收批）

规模：`PlayDetail` 52 文件 4,950 行 + `components/player` 15 文件 3,362 行。

1. SaltUI 组件搭骨架：`SaltTheme` + 自绘封面台（缩放/阴影/圆角 morphia 动画对应 PlayerOverlay 的 morph 转场）。
2. **背景模糊（Salt Player 风格）**：Compose 路线——封面 `Image` + `Modifier.blur()`（RenderEffect，API 31+）或 `Modifier.graphicsLayer`+`RenderEffect.createBlurEffect`（低版本退化 StackBlur 软件模糊或直接用大半径低清位图），上叠 `Palette` 提取主色的蒙版层 + 压暗层。分台布光（浏览台亮/歌词台暗）用 Compose `animateFloatAsState` 翻页联动。
3. **歌词渲染**：`lrc-file-parser` 等价物（KMP 纯 Kotlin LRC 解析器）+ Compose 惰性歌词列；桌面级渲染（描边/渐变填充）用 Canvas 自绘。B6 再做桌面歌词浮窗。
4. 播放列表 sheet、分享卡（保留现有 png 自绘逻辑思路）、音量/倍速/定时关闭 sheets。
5. **验收**：真机对照 Salt Player 截图主观打分（背景模糊观感、歌词滚动流畅度）；切歌/展开收起无闪烁（对齐原 CoverBackdrop 的"先叠后撤"验收标准）。

### B5 主界面与列表（4–6 周，体量批）

规模：Home 181 文件 16,187 行 + components 99 文件 11,475 行。

1. 先做通用组件库（common/ 37 文件 3,352 行 → SaltUI 优先、自绘补齐：Badge/Modal/Slider 等）。
2. 榜单（Leaderboard）、搜索（Search + SearchTipList）、歌单（Mylist）、推荐（recommend 48 文件 9,727 行——最大单块，算法逻辑用纯 Kotlin 重写，可 node --test → kotlin.test 对照移植）。
3. 设置页树（Setting + settings/Basic 等）。
4. **验收**：主界面四大 Tab 全功能可用；推荐算法单测与 ts 版 golden case 对照一致。

### B6 长尾屏幕与桌面歌词（3–4 周）

1. Comment（9 文件 916 行）、MylistDetail/ArtistDetail/SonglistDetail/LeaderboardDetail/RecommendDetail（合计 ~2,366 行）、MusicRecognition（4 文件 825 行，依赖 B2 的 audioRecord/TFLite）。
2. ShareCard（10 文件 1,020 行）。
3. **桌面歌词服务**：`lyric/` 9 个 Java 文件 + DesktopLyricEnable 组件的等价重写（TYPE_APPLICATION_OVERLAY 悬浮窗 + Compose/自绘 View + 歌词行滚动/锁屏行显示）。**注意逐帧滚动与 OEM 兼容是 lx 系播放器的老大难，预留 buffer。**
4. **验收**：桌面歌词在 MIUI/HyperOS、ColorOS、OriginOS 至少各一台真机过一遍（手头没有的机型记入已知问题）。

### B7 收官（2–3 周）

1. 性能：冷启动 < 2s（对照 RN 版）、列表滚动 jank 检测（Macrobenchmark）、包体目标 ≤ 32MB。
2. 深浅色全链路（SaltUI 主题系统 + monet 管线移植）、动态取色（Android 12+ monet API）。
3. 无障碍：contentDescription 抽查、48dp 触达、TalkBack 主流程。
4. 上架材料：隐私政策、版本签名（沿用现 keystore？B0 起就要定）、渠道包。
5. **双版本并行期**：发布原 RN 版与原生版双通道 1–2 个版本周期，收集反馈后原仓库转维护模式。

### 并行化建议（多人时）

- **单人流**：B0→B1→B2→B3→B4→B5→B6→B7 严格串行。
- **三人流**：B1 与 B2 可并行（数据层/播放层接口先定）；B3 独立（QuickJS 专精）；B4 在 B2 完成后立即并行 B5；B6 在 B4/B5 任一完成后跟进。关键路径是 B3→B4（音源可用才能真机验收播放页）。

### 风险登记（按批次）

| 风险 | 批次 | 缓解 |
|:--|:--:|:--|
| SaltUI beta API 变动 | 全局 | 锁 3.0.0-beta03 + 提交间 changelog 盯 release notes；必要时 pin 2.x |
| QuickJS 桥协议偏差导致音源生态报废 | B3 | 双端协议用契约测试锁死（golden 脚本 + 事件序列断言） |
| 桌面歌词 OEM 兼容 | B6 | 沿用 lx 原生模块已知 workaround 清单，逐机型记录 |
| morph 转场等价性 | B4 | 用原 28 个 monet/overlay 测试的判定逻辑做 Kotlin 版等价测试 |
| 主题表 4,413 行生成器迁移 | B1 | `createThemes.js` 改造成双目标（JS+Kotlin）输出，避免手工抄 |

## 八、引用

- [SaltUI 仓库（Apache 2.0）](https://github.com/Moriafly/SaltUI) — LICENSE 与 README 一手文本
- [SaltPlayerSource 仓库（MIT，App 本体闭源）](https://github.com/Moriafly/SaltPlayerSource) — LICENSE 与 README 一手文本
- 本仓库 `LICENSE`（Apache 2.0）与 `README.md`（上游补充协议）
