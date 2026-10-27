# Wave 8 · Lane C 任务书 —— 列表与歌词终扫尾：菜单统一（W5-9）+ 同步实装 + 定位元数据 + 路由残留

> 本文件是 Lane C 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md`、`AGENTS.md`、
> `docs/kotlin-migration-progress.md`（B5 待办：W5-9/同步/随机播放收藏全部/排序空档位/
> 搜索路由残留/deeplink intent filter；B6 待办）、`docs/waves/w7-C.md` 报告 与本文全文。
> 分支 `w8/laneC`，车道起点 = Wave7 三车道并入后的 `main`（core 1105 + app 147 = **1252** 全绿）。

## 0. 起草时点复核（2026-10-27，全部实测；协调会话投用前逐条重跑）

> **协调会话复核（2026-10-27，HEAD `20811f9`）**：#1/#2 行号写错、#3/#7 结论需补实测，
> 下表已修订，任务 4/7 随之收窄。

| # | 事实 | 实证位置 |
|:--:|:--|:--|
| 1 | W5-9 撞的两文件都健在：`ListMenuActions.kt` 595 行（九项枚举自建），`ListDetailPage.kt` 1046 行（内联逻辑） | `ui/list/`；枚举 `ListMenuAction` 在 **`ListMenuActions.kt:64-78`**：CREATE/RENAME/SORT/DUPLICATE/LOCAL_FILE/SYNC/IMPORT/EXPORT/REMOVE |
| 2 | 「同步」是占位：SYNC 标签=「更新」，点击 toast「在线列表同步暂未迁移到原生」 | toast 在 `ListMenuActions.kt:390`；`syncSupported=false` `:92`、可用性判定 `:106`；**数据层在 core**：`core/list/ListStore.kt:365 listMusicOverwrite`、`sourceListId/locationUpdateTime` 字段 `:38-40,408-422`；`getListDetailAll` 在 `SonglistRuntime.kt:156`（榜单侧 `LeaderboardRuntime`/`BoardPager`，**不在 ListStore**） |
| 3 | 排序两空档位：`add_time_up/down` 按 0 兜底（`play_count` 同源）；**键常量已存在但零读写者** | `ListDetailPage.kt:370` 注释自证 0 兜底；`core/storage/StorageKeys.kt:56-57` 已有 `@music_add_time`/`@music_play_count`——**别新建键名**，只补读写 |
| 4 | `lxmusic://` scheme filter 已有；**http(s) 无 filter**；文件打开只认 json MIME（lxmc 无标准 MIME，注释指回「应用内导入」） | `AndroidManifest.xml:34-47`（注释自证）；解析能力在 `core/songlist/SonglistLinkParser.kt` |
| 5 | 桌面歌词写侧两位小数已做、读侧被 Int 默认值截断（W7-1 键改归 Lane A） | `w7-C.md` 语义修正 4；`DefaultSetting.kt:66-67`；读侧 `lyric/DesktopLyricConfig.kt:49-50`（`Int` 字段）、`:71-72`（`int(...)` 转换） |
| 6 | W7-2 兜底确认**键常量与钩子已在**（起草时说 grep 无命中是错的），仅缺键默认值+设置 Switch+一行赋值（全归 Lane A） | `core/local/LocalFallbackConfirm.kt:28 SETTING_KEY`；`LocalMusicRuntime.kt:249` 钩子默认 `{ true }`、`:347` 消费、无人赋值 |
| 7 | 逐字歌词 lxlyric **不是字面零代码**：本地曲内嵌 AWLRC 已被抽取成 `lxlyric` 字符串，但无帧解析、无渲染链路 | `core/local/LocalLyric.kt:17,46,59`（仅解 `[awlrc:]` 标签出字符串）；RN 独立链路见 `w7-C.md` W7-11 评估节 |

## 1. 背景

列表线七波攒下四类尾巴：一份菜单逻辑复制在两个文件里（W5-9，两次被挪波）、
「更新」菜单项是 toast、排序的「添加时间」档位永远空转、外部歌单链接解析器造好了
但系统入口没开。本车道一次扫完，并把 Wave7 桌面歌词/本地曲库遗留里属于本车道文件的
收口做掉。三项大功能（下载、递归扫描多目录、歌词增强主体）**不做**，见 §4。

## 2. 任务

1. **W5-9 菜单统一（本车道主场，纯重构）**：`ListDetailPage` 内联的列表操作逻辑
   收口到 `ListMenuActions`（或反向，先画两文件逻辑对照表再动手），行为逐项对齐、
   重构前后各锁一组单测（菜单可用性/禁用规则是纯数据层，已有先例）。不许顺手改语义。
2. **「更新」同步实装**（W5-10）：对照 RN `list_sync_confirm_tip` 流程——
   `core/list/ListStore.kt:365 listMusicOverwrite` + `SonglistRuntime.kt:156 getListDetailAll`
   刷新、`locationUpdateTime` 更新、`sourceListId` 第一次有消费方；确认弹层文案通俗
   （面向用户文案规矩）；源不支持 songList 时保持现有 disabled 判定（`syncSupported`）。
   加入路径（整单导入）已写 source/sourceListId，存量老歌单没有元数据时的禁用行为要一致。
3. **默认列表批量操作补齐**：随机播放（对照 RN `PlayerRandom`）与收藏全部
   （整单加入爱心，走 `listMusicAdd` 批量路径）；**与 Lane B 交界**：B 给 `listMusicAdd`
   加可选 `origin` 参数——你只调用现状签名，集成顺序 B 先并，装配由集成会话补一行。
4. **`add_time` 定位元数据**：加歌路径写「添加时间」（对照 RN data.ts 的元数据形状，
   先实证 RN 键名/位置再定 schema）。键常量**已在** `core/storage/StorageKeys.kt:56-57`
   （`@music_add_time`/`@music_play_count`），零读写者——只补读写、别新建键名；
   排序空档位复活；存量曲目无元数据时维持 0 兜底且排序稳定（用例锁住）。
5. **W7-1 读侧收口**：Lane A 把 `desktopLyric.position.x/y` 默认值改 `0.0` 后，
   你在 `DesktopLyricSettingsSection`/服务读侧验证小数往返不再截断（补一条用例：
   `33.5` 写→读等值）；A 未并之前此任务挂起，不要自己改键表。
6. **http(s) intent filter + 歌单链接外部直达**：Manifest 开 https filter（host 白名单
   按 `SonglistLinkParser` 支持的五源域名列），启动分发到歌单详情（解析器已有，
   接线 `DeeplinkRuntime`）；lxmc 外部 MIME 按注释决议仅做 `.lxmc` 扩展名 filter 增量，
   拿不到稳定 MIME 就记遗留（W7-9 同类）。
7. **歌词增强可选任务（时间盒）**：主线 1–6 全收后才碰。判据先落纸：逐字 lxlyric 的
   帧结构/显示精度对照 RN `Lyric` 组件与项目记忆的歌词页机制；注意原生**已有**内嵌
   AWLRC 抽取（`core/local/LocalLyric.kt` 出 `lxlyric` 字符串），缺的是帧解析与渲染——
   有余力只做**解析纯函数 + 单测**，渲染接线不动（渲染归 Lane A 的 play 禁区之外，别越界）。

## 3. 范围（只许改这里）

- `app/.../ui/list/`（ListMenuActions/ListDetailPage/DuplicateMusicDialog/LocalFileImportDialog）
- `core/list/**`（仅同步与 add_time 元数据所需的签名/存储增量；**本波与 Lane B 共管**，
  见提示词冲突矩阵——B 独占 `listMusicAdd` 的 origin 参数行，其余归你）
- `app/.../lyric/**`、`core/lyric/**`、`ui/settings/DesktopLyricSettingsSection.kt`、
  `ui/settings/BackgroundPlayHelpPage.kt`
- `app/.../deeplink/**`、`MainActivity.kt` 中 deeplink 分发行
- `AndroidManifest.xml`：**仅 intent-filter 增删行**（screenOrientation 禁触——AGENTS.md；
  Lane A 动权限/签名块，两车道各改各的段，集成保留两侧）
- 新增测试放对应包。

## 4. 禁触

- `core/theme/**`、`DefaultSetting.kt`、`ui/settings/SettingsPage.kt`、gradle/版本目录、
  `ui/play/**`（Lane A；position 键默认值是 A 的活）
- `core/recommend/**`、`ui/radio/`、`ui/songlist/`、`ui/search/`（Lane B；
  `ListDetailPage` 行菜单若需给 B 的「相似歌曲」留位，等集成合流，不自己加）
- **下载功能**、**W7-5 递归扫描/多目录**（产品口径未拍板）、**W7-11 歌词工具模式/换源**
  （立项归 Wave9）、`userapi/**`、主进度文档（只读）。

## 5. 验收

- 闸门全绿、1252 只增不减；同步/菜单统一/add_time 排序各有 JVM 单测
  （菜单统一必须有「重构前后行为等值」的对照用例）；
- 真机清单（≥6 条）：在线歌单「更新」全流程（含确认文案/无元数据禁用态）、
  随机播放与收藏全部、自定义排序「添加时间」档对新加歌生效、外部 https 歌单链接直达、
  桌面歌词位置小数重启往返（W7-1 合流后）、1000 首 `countStale` 耗时记录（W7-6 顺手量）。

## Lane 报告（执行会话追加区）

按 RULES 收尾三步，在此追加：结论 / commit / 触碰文件清单 / 语义修正 / 遗留与真机清单。
