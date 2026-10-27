# Wave 7 总纲（协调会话产出，预草稿 2026-10-26）

> 本文件是 Wave7 的车道切分与派发说明，三条车道的执行会话各自只读自己的  
> `docs/waves/w7-<laneX>.md`，外加 `docs/waves/RULES.md` 与 `AGENTS.md`。  
> 投用前协调会话必须按 §0 重跑复核（教训 2——每一波都靠复核抓到漂移）。

## 0. 波前基线（起草时点实测，2026-10-26）

- 主仓库 `main` = `baa4208`（Wave6 三车道并入 + 主进度文档汇总）。
- 闸门：`cd android-native && GRADLE_USER_HOME=E:/GradleHome ./gradlew.bat ktlintCheck test assembleDebug`  
  → **core 1042 + app 122 = 1164** 全绿，APK **30,986,248 B**，sha256 `b178954d…`。
- Wave6 遗留清单 13 条（W6-1~W6-13）与 Wave5 未关遗留（W5-4/5/6/9/10/13/14/16/17）  
  记在 `docs/kotlin-migration-progress.md`。本波只吃下表所列，其余留给 Wave8 收官批，**不要顺手做**。

## 1. 本波要解决的三个真问题

1. **电台的「相似」还是半残**（W5-4/W6-9）：共现小件 `computeCoOccurrence` 移植了但没有  
   跨歌单倒排索引喂输入（RN `library.ts`/`libraryIndex.ts`），相似曲来源为零；  
   `computeBucketDetailReserve`/`computePoolBucketLimits` 移植了没接线——「桶召回 + 详情预算  
   分配」层整个不存在；发现通道成新率被调用侧写死 `ratio = 1.0`  
   （`RadioRuntime.kt` fetchDiscoveryPlaylist 内有注释解释，需实证后回调）。
2. **本地曲库二轮留了五个已知的糙点**（W6-1~W6-5）：兜底命中的直链不写缓存  
   （`DataRepository.saveMusicUrl/getMusicUrl` 已存在、**全仓零调用**，纯接线活）；  
   兜底可能同名不同歌手无人工确认；重定位歧义候选 `LocalRelink.plan` 已能返回 `ambiguous`  
   但没有选择弹层；内嵌歌词 ogg/flac（Vorbis `LYRICS=`）与流式 m4a（moov 在尾）取不到；  
   `countStale` 逐曲 query 慢。
3. **B6 桌面歌词欠账拖了四波 + 两项 UI 升级被 gradle 卡住**：`DesktopLyricService` 仍是普通  
   `android.app.Service`（Manifest 无 foregroundServiceType），后台被杀的首要风险点；翻译/罗马音  
   独立开关、单行横向滚动、位置小数写侧、`lyricUnplayColor` 渲染都没做；morph 转场（W5-14）与  
   问卷 Slider（W5-6）都因为 **gradle 里没有 `compose.animation` / material 依赖**被禁触两波。

## 2. 车道切分

| 车道         | 主题                                               | 吃的遗留                                             | 主要路径                                                                                                      |
| :--------- | :----------------------------------------------- | :----------------------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| **Lane A** | 推荐与电台收口：共现索引/相似曲来源 + 桶预算接线 + 诊断上 UI + 画像过滤 local | W5-4 / W5-13 / W6-9 / W6-10 / W6-11（+W5-5 时间盒可选） | `core/recommend/**` + `ui/radio/` + `data/Radio*Runtime.kt`                                               |
| **Lane B** | 本地曲库三轮：兜底缓存写回 + 人工确认/歧义弹层 + 内嵌歌词补全               | W6-1 / W6-2 / W6-3 / W6-4 / W6-5（+W5-16 可选）      | `core/local/**` + `data/LocalMusicRuntime.kt` + `userapi/UserApiRuntime.kt` + `ui/list/ListDetailPage.kt` |
| **Lane C** | 桌面歌词/歌词收尾 + gradle 解锁（morph/Slider）+ deeplink 补全 | B6 待办 / W5-6 / W5-10 部分 / W5-14 / W6-6           | `lyric/**` + `ui/settings/**` + `Manifest` + `gradle` + `deeplink/**` + `ui/search`（仅跳转）                  |

**冲突面（波前审计已做，三条车道文件级两两不相交）**：

| 文件/目录                                                                                |  A  |         B        |               C              |
| :----------------------------------------------------------------------------------- | :-: | :--------------: | :--------------------------: |
| `core/recommend/**`、`ui/radio/**`、`data/{Radio,Recommend,SimilarArtist,Dislike}*.kt` |  ✔  |         禁        |               禁              |
| `core/local/**`、`data/LocalMusicRuntime.kt`、`ui/list/ListDetailPage.kt`              |  禁  |         ✔        |               禁              |
| `userapi/**`（W6-1 缓存接线在 `UserApiRuntime`）                                            |  禁  |       ✔ 独占       |           只调用既有公开方法          |
| `core/data/DataRepository.kt`                                                        |  禁  | ✔ 只新增（如需缓存键/TTL） |               禁              |
| `lyric/**`（core+app+DesktopLyricService）、`ui/settings/**`、`core/setting/**`          |  禁  |         禁        |               ✔              |
| `AndroidManifest.xml`（仅 FGS 类型）、**gradle 与版本目录**（仅 animation/material）               |  禁  |         禁        |            ✔ 本波唯一            |
| `deeplink/**`、`MainActivity.kt`、`HomeNavigator.kt`、`ui/HomePage.kt`、`ui/play/**`     |  禁  |         禁        |               ✔              |
| `ui/search/SearchPage.kt`（W6-6 仅改详情跳转，不动搜索逻辑）                                        |  禁  |         禁        |               ✔              |
| `ui/list/ListMenuActions.kt` 与 `ListDetailPage` 的逻辑统一（W5-9）                          |  禁  |         禁        | 禁（**挪 Wave8**，纯重构跨 B/C 两家文件） |

跨车道调用关系：C 的 deeplink `music/searchPlay` 调 Lane B（Wave6）落成的 `SearchRuntime`  
公开方法、音频文件打开调 B 的 `LocalMusicRuntime` 公开入口、`.js` 音源导入调 `UserApiRuntime`  
既有公开方法——**全是只调用**；签名若不满足，降级该分支记遗留，不许改 B 的文件。  
唯一文件级例外：`ui/radio/OnboardingSheet.kt`（W5-6 问卷滑条）——`ui/radio/` 归 A，  
但该单文件归 C 只换滑条控件（持久化形状与档位语义不动），A 已在任务书知悉。

## 3. 明确**不在**本波范围（留给 Wave8 收官批）

- W5-9 `ListMenuActions` 与 `ListDetailPage` 逻辑统一（纯重构，Wave8 串行做）。
- W5-10 剩余：歌单「同步（更新）」移植（依赖各源 `songList` 能力与 `sourceListId` 消费方）、  
  `.lxmc` 自定义 MIME（与数据迁移/安装器一起）。
- W5-17 置灰对比度、W6-7 kw `r.s` 边界核对、W6-8 tx 歌手第五源、W6-12 华语配额供给  
  （供给问题非规则问题，等真机数据）——全是「等真机/等数据」项，随真机清账走。
- W6-13 歌手相似/粉丝数（RN 本就没有，不做）。
- **B7 收官整批**（性能/monet 深浅色/无障碍/签名上架/RN 数据迁移/双通道）——Wave8 串行。
- 歌词增强（逐字 lxlyric/歌词搜索换源/工具模式）：Lane C 只交立项输入评估，不写代码。

## 4. 共同纪律

- 严格按 `docs/waves/RULES.md`：只在当前 worktree、不 push/merge/rebase、主进度文档只读、  
  收尾三步（闸门 → commit → lane 报告）必须走完。
- **一个功能点能测的先写纯函数 + 用例，再接 app 装配**（Wave5/6 都吃到了这个顺序的好处）。
- 移植语义以 RN 为准；任务书里的「起草假设」一律先实证再动手，被推翻就记 lane 报告  
  「语义修正」节并按实证改做法（Wave5 三处、Wave6 三处起草假设被推翻，属正常流程）。
- 每次 commit 消息以 `W7-<laneX>:` 开头；跨车道公开入口签名先提交再实现。
- **gradle 与版本目录本波只有 Lane C 可以动**（compose.animation / material 相关行），  
  A/B 若发现缺依赖：降级记报告，不许自己加。

## 5. 真机验收的定位

三条车道都不能只靠 JVM：A 要靠 `channelShare`/`reasons` 看相似曲来源与配额兑现，  
B 要靠真机的同名兜底/授权失效/ogg 歌词，C 要靠真机的后台保活（MIUI/HyperOS 优先）与转场手感。  
任务书各自列了真机清单，写清楚「怎么验、看到什么算通过」。另外 Wave1~6 已累计 **147 条**  
真机清单，本波并完强烈建议安排一次清账，别全压到 Wave8。

---

## 执行结果（2026-10-27，协调会话汇总）

- 三条车道全部并按 **A → B → C** 合入 `main`，零冲突：`42d7b4c` / `6c2b3c1` / `e6a0684`。
- 终态闸门：core 1105 + app 147 = **1252** 全绿，APK 29,263,058 B
  （sha256 `f4ebfdc6…`）；可加性核对见 `docs/kotlin-migration-progress.md`「Wave7 集成记录」。
- 跨车道装配只补了一处（`7ecdd42`）：deeplink 音频打开改用 `LocalMusicRuntime.readFileInfo`
  读真实标签，替掉 Lane C 的占位曲目降级。
- 未做/降级项统一收进主进度文档的 **W7-1~W7-12 遗留清单**；真机验收合计 22 条
  （A 6 / B 7 / C 9），累计 169 条。
