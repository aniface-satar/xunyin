# Wave 8 · Lane A 任务书 —— B7 收官：主题全链路 + monet + 无障碍 + 性能 + R8/签名 + RN 数据迁移

> 本文件是 Lane A 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md`、`AGENTS.md`、
> `docs/kotlin-migration-progress.md`（批次速查表、B7 定义=可行性文档 §B7、W7-1/W7-2/W7-10/W7-11）与本文全文。
> 分支 `w8/laneA`，车道起点 = Wave7 三车道并入后的 `main`（core 1105 + app 147 = **1252** 全绿，
> APK 29,263,058 B / sha256 `f4ebfdc6…`）。

## 0. 起草时点复核（2026-10-27，全部实测；协调会话投用前逐条重跑）

> **协调会话复核（2026-10-27，HEAD `20811f9`）**：基线实测 core 1105 + app 147 = **1252**
> 全绿、APK 29,263,058 B / sha256 `f4ebfdc6…`，与进度文档一致。下表已按复核结果修订
> （#2/#3/#6/#8 有漂移）。

| # | 事实 | 实证位置 |
|:--:|:--|:--|
| 1 | 主题三件套已有但未装配：17 内置主题 + 颜色生成器已移植且有黄金单测 | `core/theme/DefaultThemes.kt`（注释对照 RN `createThemes.js`）、`ThemeColors.kt`、`ColorUtils.kt`；`MusicApp.kt:51-53` 仍只按 `isSystemInDarkTheme()` 用 `SaltConfigs.default`，无主题偏好装配；小写 `grep -rln theme app/ui/settings/` 只命中 `DesktopLyricSettingsSection.kt`（其 `theme` 是桌面歌词配色，不是 app 主题） |
| 2 | 主题设置键已在表里（与 RN 同名） | `DefaultSetting.kt:89-95`：`theme.id/lightId/darkId/hideBgDark/fontShadow/dynamicBg/dynamicBgAlgorithm`（96-100 行是 Wave7 追加的桌面歌词两键）；`:110` 有 `theme.id=happy_new_year` 的日期覆盖逻辑；app 侧 grep `theme.id/lightId/darkId` 无消费方 |
| 3 | monet/动态取色原生零代码；键与预取步已留位，但 **PreloadPlan 无 app 执行器** | `grep -ri monet core app` 无命中；`PreloadPlan.kt:18,32,97-98` 有 `dynamicBg` 标志与 `PALETTE` 步，但 `buildPreloadPlan` 在 app 侧**无调用方**（只有 core 定义 + 单测）——PALETTE 不是现成执行管线；RN 侧实现在 `src/.../CoverBackdrop`、`OnCoverThemeProvider`、`Setting/Theme/DynamicBg.tsx` |
| 4 | release 未开 R8、未签名 | `app/build.gradle.kts:21,24` 两段 `isMinifyEnabled = false`；release 块无 `signingConfig` |
| 5 | 无 benchmark/冷启动测量基建 | `settings.gradle.kts` 无 benchmark 模块 |
| 6 | RN 数据迁移只有**格式**兼容层，物理存储不可直达（B1 决策预留） | `core/storage/ShardedKvStore.kt`：v1/v2 分片编解码 + 500k 分片，能解任意键名（`StorageKeys.kt` 40+ 键）；但它只是 `KvStore` 门面，**读不到 RN 的 AsyncStorage SQLite**。两版 applicationId 不同（native `cn.toside.music.mobile.native` / RN `cn.toside.music.mobile`）⇒ 沙箱隔离；DataStore 文件 `xunyin_kv` 与 RN 独立（`DataStoreKvStore.kt` 注释自证） |
| 7 | `desktopLyric.position.x/y` 默认值仍是 Int 0（W7-1 的根因在键表） | `DefaultSetting.kt:66-67` |
| 8 | `local.fallbackConfirm` 键常量与读取钩子已存在，缺的是默认值 + 设置开关 | `core/local/LocalFallbackConfirm.kt:28` 有 `SETTING_KEY`；`app/data/LocalMusicRuntime.kt:249` 的 `fallbackConfirmEnabled` 默认 `{ true }`、`:347` 消费，**无人赋值**；`DefaultSetting` 表里仍无该键 |

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
   `OnCoverThemeProvider`，项目记忆有播放页动态背景的 RN 实测参数）。注意
   `PreloadPlan.PALETTE` **只是 core 侧规则表、无 app 执行器**（`buildPreloadPlan` 零调用方），
   不要当成现成管线：直接在 `ui/play/` 做封面取色接线即可，顺手补执行器属可选加分项、
   不作验收硬条件。Android 12+ 可走系统 Monet、低版本走封面取色。
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
6. **RN 数据一次性迁移**：先**落范围清单**，再「能迁的迁」。复核结论：
   - `ShardedKvStore` 只是分片**格式**编解码（v1/v2、500k 分片），不是 RN AsyncStorage
     物理读取器；两版 applicationId 不同（`:native` vs RN）⇒ 沙箱隔离，**首启直接读
     RN AsyncStorage SQLite 不可行**，不要按这个前提设计；
   - 可达通道只认实测：App 自有 `.lxmc`/allData 备份（走 `BackupManager`，先验设置是否
     含在内）、SAF 用户手动导出文件；
   - 清单逐键对照 RN storage 键表，写明「迁什么/不迁什么/为什么」；起手范围＝歌单 +
     爱心 + 设置键 + 播放历史，其余一律记遗留让用户过目；**范围终稿是拍板门**，清单
     交出即停，不先写迁移实现。
   - 纯规则（分片解码 → 目标键映射）进 `core/backup/` 或 `core/storage/` + JVM 单测，
     fixture 用 RN 真实分片格式；一次性、幂等、可重跑。
7. **三项收尾（从 C 挪来）**：
   - W7-1：`desktopLyric.position.x/y` 默认值 0→`0.0`（**本波唯一改既有键**），补
     `SettingsStoreTest` 的 `33.5` 往返用例；
   - W7-2：`local.fallbackConfirm` 常量与钩子已在（`LocalFallbackConfirm.SETTING_KEY`、
     `LocalMusicRuntime.fallbackConfirmEnabled` 默认 `{ true }` 且 `:347` 消费、**无人赋值**）——
     只差 `DefaultSetting` 表尾默认值、`LocalMusicRuntime` 里一行赋值接线、本地曲库设置
     小节一个 Switch；不要重复建键/建钩子；
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
- `core/player/PreloadPlan.kt`（**可选**：仅当顺手补 PALETTE 执行器时）
- `app/data/LocalMusicRuntime.kt`（**仅一行**：W7-2 的 `fallbackConfirmEnabled` 赋值）
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
- monet/迁移纯规则有 JVM 单测（取色可注入种子；**只对实测可达的迁移通道**做 fixture，
  不可达类别不硬造用例）；
- **迁移范围清单**（逐键迁/不迁/原因）落报告，清单交完即停在拍板门；
- `33.5` 往返、`fallbackConfirm` 默认值有用例；
- 冷启动/包体数字落报告；真机清单（≥6 条：主题切换全 app、monet 观感、TalkBack 主流程、
  冷启动对照、迁移导入、release 包冒烟三条链路）写进报告。

## Lane 报告（执行会话追加区）

按 RULES 收尾三步，在此追加：结论 / commit / 触碰文件清单 / 语义修正 / 遗留与真机清单。

## Lane 报告（2026-10-27）

- 结论：任务 1（主题全链路）、2（monet/动态取色）、3（无障碍抽查与修复）、4（性能基线实测）、7（W7-1/W7-2 落地 + W7-11 评估落纸）完成；任务 5（签名/R8）与任务 6（RN 迁移范围）按**拍板门**只交清单，未动 gradle/签名/迁移实现。
- commit：`a36c8df`；测试数 core 1125 + app 150 = **1275** 全绿（起点 1252，只增不减）；`ktlintCheck test assembleDebug` 全过。
- 触碰文件清单：
  - `core/theme/`：`ActiveTheme.kt`/`CoverPalette.kt`/`CssColor.kt`（新）+ `ActiveThemeTest.kt`/`CoverPaletteTest.kt`（新）
  - `core/setting/DefaultSetting.kt`（position 两键 0→0.0 改既有 + 表尾追加 `local.fallbackConfirm`）+ `SettingsStoreTest`/`SettingMergerTest`/`DesktopLyricSettingKeysTest`（用例跟进）
  - `app/`：`MusicApp.kt`（主题装配+W7-2 绑定）、`ui/settings/SettingsPage.kt`（主题入口+本地曲库 Switch）、`ui/settings/ThemeSettingsPage.kt`（新，主题子页）、`ui/settings/SettingsFormat.kt`（+fallbackConfirmEnabled 纯函数）与其测试、`ui/play/PlayDetailPage.kt`（动态背景接线+无障碍修复）、`ui/play/DynamicBackdrop.kt`（新）、`data/LocalMusicRuntime.kt`（+bindFallbackConfirm 一行接线）
  - 未动 gradle/settings/版本目录/Manifest（拍板门，本波零 gradle 改动）
- 语义修正与实证发现：
  1. **RN `theme.lightId/darkId` 是死键**（RN `getTheme` 里读取代码被注释）；「跟随系统」语义 = `common.isAutoTheme && 系统深色 → 强制 black`，未知 id 回落 `cyan`。原生 `ActiveThemes` 同语义实装，键表三键不再消费（文档化）。
  2. **monet 取色器可注入种子**（`CoverPaletteExtractor.DEFAULT_SEED` 固定），JVM 黄金单测锁死；HSL+WCAG 替代 HCT，不引 @material 依赖（零新依赖）。
  3. **冷启动实测（emulator sdk_gphone64_x86_64, API 36, `am start -W` TotalTime 中位）**：debug 包 AOT 后 ≈ **8.0s**（`cmd package compile -m speed -f` 后仍 8s，瓶颈是 debuggable+Compose tooling instrumentation+大 dex 类加载）；release（本机 debug keystore 自签测量包，AOT）≈ **2.6s**（六次 2693/2654/2624/2504/2550/2609ms）；RN 装机 1.0.2（release 签名，AOT）≈ **2.3s**（2477/2421/2284/2234ms）。结论：以 release 口径对照，原生 ≈ RN +0.3s，离 <2s 目标差 ~0.6s；真机（arm64）预期更低，待真机清单复测。
  4. **AGP debug keystore 实际路径**：`E:\.android\.android\debug.keystore`（按 `ANDROID_SDK_HOME` 拼接解析，2026-07-17 自动生成，弱口令 android/androiddebugkey，SHA-256 `98:62:28:E3…`），**与 RN 的 `android/app/debug.keystore`（2014 老 JKS，SHA-256 `FA:C6:17:45…`）是两把不同钥匙**。
  5. **列表滚动 jank**：模拟器新装包首页无可滚动列表内容，swipe 0 帧产出，未得有效统计；方法留真机清单（`gfxinfo framestats` + reset 后滑动采样）。
- 拍板门清单（三处，等用户确认后才动）：
  - **A. release 签名**：现状 release 无 signingConfig。待拍板：①原生版最终是否与 RN 同 applicationId（`cn.toside.music.mobile`）覆盖升级——若是，签名钥匙**必须**沿用 RN 装机那把（`android/app/debug.keystore` 或 RN 上传钥匙，本机无 `keystore.properties`/`MYAPP_UPLOAD_STORE_FILE`，RN 1.0.2 装机包实为 debug fallback 签名）；若否（保持 `:native` 独立包名），签名任选；②新建正式 keystore 的口令与保管方式（`keystore.properties` 已 gitignore，绝不入库）；③本波维持 debug 签名覆盖装即可。
  - **B. R8 缺口清单**（本波**不打开** `isMinifyEnabled`，仅列面）：SaltUI 3.0.0-beta03（beta 库，混淆规则未验，传递依赖 `org.lsposed:hiddenapibypass` 隐藏 API 反射）、`wang.harlon.quickjs`（JNI 桥，Java 侧回调入口需 keep，库自带 consumer rules 待验）、kotlinx.serialization（core 多处 `@Serializable`：UserApiCatalog/RecommendProfile/RecommendModels/m3 系列/RadioModels/RadioState——编译期生成 serializer，理论安全待实测）、Media3 ExoPlayer/Session（自带 consumer rules）、`androidx.core.content.FileProvider`/两个 Service/MainActivity（Manifest 声明类安全）。开启面建议：只开 release 的 `isMinifyEnabled` + `shrinkResources`，debug 保持关；验证 = release 冒烟三链路（QuickJS 取链/播放/分享卡保存）。
  - **C. RN 数据迁移范围清单**（逐键对照，本波零新增迁移代码）：
    - **可迁**（唯一实测通道 `.lxmc`/json，`playList_v2` 已实装）：歌单三类——试听列表 `default`、我的收藏 `love`（即爱心）、自定义歌单（含曲目元数据 + 在线歌单元信息 source/sourceListId/locationUpdateTime）。入口即现有「列表导入」+ deeplink 文件打开。
    - **不迁**（无实测通道）：设置键（83 键：RN Backup UI 只有列表导入导出，`setting_v2` 仅是提示分支，无导出入口；两版 applicationId 不同 ⇒ `RKStorage` SQLite 沙箱隔离不可达；RN 装机包 flags 无 `ALLOW_BACKUP` ⇒ adb backup 也不可达）、播放历史、下载/缓存记录、推荐画像/隐藏歌单/onboarding、userapi 音源脚本（用户手动导入的文件，重新导入即可，不需要迁移）。
    - 建议：迁移引导文案 = 「旧版设置→备份→导出列表得 .lxmc，新版列表页导入」，现有能力即可达成，不需要新码。
- 无障碍（任务 3）修复与发现：
  - 修复（本车道文件）：PlayDetailPage——封面 contentDescription「专辑封面」、返回/更多 GlyphButton 语义+Role、进度条 48dp 触控区+`setProgress`、文字按钮 48dp、分页指示点 48dp 命中区+「封面页/歌词页」语义+selected；ThemeSettingsPage——主题格 `Role.Button`+selected 语义。
  - 记录未修（别车道文件）：`DesktopLyricSettingsSection.kt` 26dp 主题色点无 contentDescription/触控不足 48dp（已抄送 Lane C 报告遗留）；其余 SaltUI Item 系组件未见结构性问题。
  - 「RN 侧已有的 a11y 整改清单」在仓库 docs 中未找到对应文档（grep TalkBack/无障碍/a11y 无独立清单），按通用 48dp/contentDescription/TalkBack 口径执行。
- W7-11 歌词增强立项评估（只评估，零实现代码）：
  - **逐字 lxlyric**：w7-C 评估已有；本波补实证——`core/local/LocalLyric.kt` 已把内嵌 AWLRC 抽成 `lxlyric` 字符串（仅抽串，无帧解析无渲染）；缺口 = 帧级解析（`[start,duration]` → 字级时间轴）+ LyricView 字级插值渲染。建议 Wave9 独立成波，桌面浮窗不跟进（字号小收益低）。
  - **繁简转换**：内置映射子集 + 设置项默认关（w7-C 同口径），纯函数 JVM 可测。
  - **换源**：本地兜底链路已在（含本波 W7-2 确认开关）；在线换源入口依赖播放页菜单增量，属体验增量，与下载/收藏同波排。
  - **工具模式（复制/海报）**：复用 `ui/share/` 位图管线，缺口在长按进模式+选中态交互，纯 UI。
- 遗留问题与对后续波次的建议：
  1. `PreloadPlan.PALETTE` 执行器未补（可选加分项，封面取色走 `ui/play/DynamicBackdrop` 直取，未走 PreloadPlan）。
  2. Macrobenchmark 模块未建（任务书「不强制」决议），测量方法已落报告（logcat TotalTime + gfxinfo）。
  3. 包体：debug 29,551,706 B（基线 29,263,058，+288KB）/ release 22,845,147 B，≤32MB 达标。
  4. 原生 manifest `allowBackup="true"` 开着——若未来要做「设置迁移」可以考虑 Auto Backup 通道，或关掉它减少面（记 Wave9 候选）。
  5. Lane C 合流后核对：`DesktopLyricConfig.positionX/Y` 已 Double 化，与本波键表 `0.0` 默认值互锁；集成冲突时保留两侧。
- 真机清单（8 条）：
  1. 主题切换全 app 实时生效（设置→主题→换主题，首页/播放页/设置页即变；一月 `happy_new_year` 日期覆盖核对）。
  2. monet 两档观感（封面取色/模糊封面）+ 关闭档纯色回落；低版本（<API31）模糊回落观感。
  3. TalkBack 主流程：播放页（封面→进度→播控→分页点→播放列表弹层）、设置页主题格选中播报。
  4. 冷启动对照：release 装包 `am start -W` 三次取中位，与 RN 版同机对比（本波模拟器数已落报告，真机复测）。
  5. 迁移导入：RN 版导出 .lxmc → 原生版列表页导入 → 三类歌单曲目与元信息核对一致。
  6. release 包冒烟三链路：QuickJS 取链 / 播放 / 分享卡保存（签名拍板后跑）。
  7. 本地兜底确认开关：设置关掉后本地曲同名兜底不再弹层、直接静默换源（W7-2）。
  8. 桌面歌词位置小数重启往返（C 并入后验）：拖到非整数位置 → 杀进程重开 → 位置不漂移。
