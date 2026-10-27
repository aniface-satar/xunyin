# Wave 8 · Lane A 任务书 —— B7 收官：主题全链路 + monet + 无障碍 + 性能 + R8/签名 + RN 数据迁移

> 本文件是 Lane A 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md`、`AGENTS.md`、
> `docs/kotlin-migration-progress.md`（批次速查表、B7 定义=可行性文档 §B7、W7-1/W7-2/W7-10/W7-11）与本文全文。
> 分支 `w8/laneA`，车道起点 = Wave7 三车道并入后的 `main`（core 1105 + app 147 = **1252** 全绿，
> APK 29,263,058 B / sha256 `f4ebfdc6…`）。

## 0. 起草时点复核（2026-10-27，全部实测；协调会话投用前逐条重跑）

| # | 事实 | 实证位置 |
|:--:|:--|:--|
| 1 | 主题三件套已有但未装配：17 内置主题 + 颜色生成器已移植且有黄金单测 | `core/theme/DefaultThemes.kt`（注释对照 RN `createThemes.js`）、`ThemeColors.kt`、`ColorUtils.kt`；`grep -rln theme app/ui/settings/ → 只命中 DesktopLyricSettingsSection.kt` |
| 2 | 主题设置键已在表里（与 RN 同名） | `DefaultSetting.kt:89-97`：`theme.id/lightId/darkId/hideBgDark/fontShadow/dynamicBg/dynamicBgAlgorithm`；`:110` 有 `theme.id=happy_new_year` 的日期覆盖逻辑 |
| 3 | monet/动态取色原生零代码；键与预取步已留位 | `grep Monet\|monet core app` 无命中；`PreloadPlan.kt:32,97` 有 `dynamicBg` 标志与 `PALETTE` 步；RN 侧实现在 `src/.../CoverBackdrop`、`OnCoverThemeProvider`、`Setting/Theme/DynamicBg.tsx` |
| 4 | release 未开 R8、未签名 | `app/build.gradle.kts:21,24` 两段 `isMinifyEnabled = false` |
| 5 | 无 benchmark/冷启动测量基建 | `settings.gradle.kts` 无 benchmark 模块 |
| 6 | RN 数据迁移兼容层已存在（B1 决策预留） | `app/data/ShardedKvStore.kt`（B1 决策表：「B7 一次性迁移导入用 ShardedKvStore 兼容层读 RN 分片格式」） |
| 7 | `desktopLyric.position.x/y` 默认值仍是 Int 0（W7-1 的根因在键表） | `DefaultSetting.kt:66-67` |
| 8 | `local.fallbackConfirm` 键不存在（W7-2 待表尾加键） | grep 无命中；注入点见 `w7-B.md` 报告 |

## 1. 背景

B0–B6 的功能车道跑了七波，B7 收官整批一直没人动：主题表移植了但没有设置入口，
monet 键留了位没有实现，release 还是 debug 签名，冷启动/包体从没量化过，RN 数据一次性
迁移是双通道并行的前置。本车道把「发版」这条线一次收掉。另有三项桌面歌词/本地曲库的
**小收尾**从 Lane C 挪来（C 已满载），都是本车道独占文件里加一行消费的事。

## 2. 任务

1. **主题全链路**：设置页主题小节（内置主题选择网格、`theme.id/lightId/darkId` 三键语义
   对照 RN `useTheme`——深浅色与「跟随系统」怎么落到 lightId/darkId 要先读 RN 源码实证）；
   主题切换实时生效全 app；`happy_new_year` 日期覆盖逻辑核对 RN 等价条件（W7-10 的
   「皮肤」实质就是这套 + 个别样式覆盖，覆盖不到的记遗留）。
2. **monet / 动态取色（dynamicBg）**：对照 RN 的 monet 管线（`CoverBackdrop`/
   `OnCoverThemeProvider`，项目记忆有播放页动态背景的 RN 实测参数）。Android 12+
   走系统 Monet、低版本走封面取色（`PreloadPlan` 的 PALETTE 步已有预留）。
   **取色器必须可注入确定性种子**（莫奈抖动教训），纯规则进 `core/theme/` + JVM 单测。
3. **无障碍抽查与修复**：contentDescription、48dp 触达、TalkBack 主流程——按 RN 侧
   已有的 a11y 整改清单对照；发现的结构性问题只修本车道文件，其余记报告。
4. **性能基线**：冷启动（对照 RN 版，目标 <2s——先用 logcat `TotalTime` 实测出数，
   **不强制建 Macrobenchmark 模块**；要建须保证 assembleDebug 路径不变）、列表滚动
   jank 观察、包体 ≤32MB 核对（当前 29.26 MB，有 monet 依赖余量）。测量步骤写进报告，
   数字进集成会话的收官记录。
5. **release 签名 + R8**：先交**拍板清单**（沿用现 keystore？R8 开启面、beta 库混淆规则
   缺口清单），**涉及 keystore 落地与 R8 打开的改动必须停下等用户确认**（RULES §越权边界）；
   确认后才动 `build.gradle.kts` 签名块与 `isMinifyEnabled`，并验证 release 包冒烟
   （QuickJS 取链 + 播放 + 分享卡保存三条链路 release 包过一遍）。
6. **RN 数据一次性迁移**：首启检测 RN 侧 AsyncStorage 分片（`ShardedKvStore` 兼容层），
   迁移范围清单（歌单/设置/历史爱心——逐键对照 RN storage 键表，明确迁什么、不迁什么、
   为什么）；迁移逻辑纯规则进 `core/backup/` 或 `core/storage/` + JVM 单测（fixture 用
   RN 真实分片格式）；一次性、幂等、可重跑。
7. **三项收尾（从 C 挪来）**：
   - W7-1：`desktopLyric.position.x/y` 默认值 0→`0.0`（**本波唯一改既有键**），补
     `SettingsStoreTest` 的 `33.5` 往返用例；
   - W7-2：`local.fallbackConfirm` 键表尾加默认值 + 本地曲库设置小节一个 Switch；
   - W7-11：歌词增强四项（逐字 lxlyric/繁简/换源/工具模式）**立项评估落纸**——只写
     评估进报告，一行实现代码都不许有。

## 3. 范围（只许改这里）

- `core/src/main/kotlin/cn/toside/music/core/theme/`（含新建文件）
- `core/setting/DefaultSetting.kt`（仅 2.7 两键：position 改既有 + fallbackConfirm 表尾追加）
- `core/backup/`、`core/storage/`（迁移纯规则）
- `app/ui/settings/SettingsPage.kt`、`SettingsFormat.kt`（主题/迁移小节）、新建主题子页
- `app/MusicApp.kt`、`MainActivity.kt`、`NavStack.kt`、`HomeNavigator.kt`、`HomePage.kt`
  （主题装配与首启迁移检查；C 的歌词小节在 `DesktopLyricSettingsSection.kt`，**不动**）
- `app/build.gradle.kts`、`settings.gradle.kts`、`gradle/libs.versions.toml`
  （**本波唯一可动 gradle 的车道**；签名/R8 行等拍板）
- `AndroidManifest.xml`（仅权限/签名相关行；**screenOrientation 禁触**——AGENTS.md）
- `ui/play/`（仅动态背景渲染接线；morph/LyricView 不动）
- `core/player/PreloadPlan.kt`（仅 PALETTE 步消费接线）
- 新增测试放对应包；可选 benchmark 模块放 `android-native/benchmark/`

## 4. 禁触

- `core/recommend/**`、`ui/radio/`、`data/{Radio,Recommend,Dislike,SimilarArtist}*Runtime.kt`（Lane B）
- `ui/list/**`、`core/list/**`、`lyric/**`（core+app+DesktopLyricService 实现）、
  `DesktopLyricSettingsSection.kt`、`BackgroundPlayHelpPage.kt`、`deeplink/**`（Lane C）
- `userapi/**`、`QuickJS*`（动它=重跑取链真机验收，本波不做）
- 主进度文档（只读，按 RULES）
- **签名密钥落地、R8 打开、迁移范围终稿** 三处是用户拍板门：备好清单即停下报告。

## 5. 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿（1252 只增不减）；
- monet/迁移纯规则有 JVM 单测（取色可注入种子；迁移 fixture 用 RN 真实分片格式）；
- `33.5` 往返、`fallbackConfirm` 默认值有用例；
- 冷启动/包体数字落报告；真机清单（≥6 条：主题切换全 app、monet 观感、TalkBack 主流程、
  冷启动对照、迁移导入、release 包冒烟三条链路）写进报告。

## Lane 报告（执行会话追加区）

按 RULES 收尾三步，在此追加：结论 / commit / 触碰文件清单 / 语义修正 / 遗留与真机清单。
