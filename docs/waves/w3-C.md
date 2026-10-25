# Wave 3 · Lane C 任务书 —— S12 歌单搜索（五源 songlist 类型）+ 在线歌单详情二轮

> 本文件是 Lane C 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md` 与本文全文。
> **已按 Wave2 并入后快照复核修订**（2026-10-25，协调会话；快照提交为
> `chore(wave3): 任务书按 Wave2 合并后快照修订` 的上一提交 `e7f390a`）。
> **验证基线**：`:core` 470 + `:app` 68 = **538** 全绿（协调会话 `--rerun-tasks`
> 强制实测：61 actionable tasks 全 executed，2m11s，failures/errors/skipped 全 0）。
> 开工自检只许等于或大于这个数。

## 背景

Wave2 集成记录「遗留问题（Wave3 候选）」第 2、3 条：
- 歌单搜索未做：搜索 tab 的 songlist 类型（RN `core/search/songlist.ts`）。
- 歌单详情未移植：「添加到我的歌单」「多选」；封面图未显示（原生仅有 ui/play 的
  CoverImageLoader 未被复用）。下载/分享/相似歌曲三菜单项依赖未移植的能力，本波**不做**。

RN 对照（worktree 内只读，先实证再动手）：
- `src/core/search/songlist.ts`、`src/store/search/songlist/{state,action}.ts`（各源 action 与聚合）
- `src/screens/Home/Views/Search/SearchTypeSelector.tsx`（类型切换 UI；**提交版只有
  `music` / `songlist` 两档**，与任务范围一致）+ `List.tsx` / `SonglistList.tsx`
- `src/screens/SonglistDetail/`（加入歌单弹层、多选）
- 各源 `src/utils/musicSdk/*/songlist.js` 的 search 方法

> 复核备注：预草稿里的 `SonglistSelector.tsx` **在仓库中不存在**（已改为上表的
> `SearchTypeSelector.tsx`）；RN 工作区里未提交的 singer/album 搜索改动不在本波快照内，
> lane 会话以 worktree 的已提交版本为准。

## 任务

1. **`:core` 歌单搜索五源**（新文件放 `music/search/`，不动既有五源**单曲**文件）：
   传输中立解析（沿用 `SearchRequest` 注入模式），各源分页边界/去重/字段映射
   逐条对照 RN；真实响应落盘 fixture 做黄金测试（不可达改合成并注明）。
2. **app 接线**：`data/SearchRuntime.kt` 扩展歌单搜索编排（可新建
   `SonglistSearchRuntime.kt` 避免和单曲编排纠缠）；搜索页加「歌曲/歌单」类型切换
   （对照 RN 类型选择器，**只加歌单类型，singer/album 本波不做**）。
3. **歌单详情二轮**（`ui/songlist/`）：
   - 单曲「加入我的歌单」+ 「多选」模式（交互对齐 Wave1 用户歌单多选页：全选/
     批量加入，重复跳过去重文案对照 RN「该列表已经有这首歌啦」）；
   - 落库走 `ListStore.listMusicAdd`（加歌位置遵循设置）；
   - 封面显示复用 `ui/play/CoverImageLoader.kt`。**复核结论：该类已是公开
     `object CoverImageLoader`、`load()` 公开，`ui/MiniPlayer.kt:66` 已跨包复用，
     预期本文件零改动**；只需要在详情页头部调用。注意其 LRU 只有 6 张，**只加载
     详情页头图一张**，不要给每行歌单曲目加载封面（会互相挤掉播放页缓存）。
     若确实需要工具方法，改动范围仅限新增公开函数，不动缓存与取图逻辑。
4. **可选（第三优先级，时间够才做）**：为 `listMusicAdd` 落曲目附加时间元数据，
   激活排序空操作档位 `add_time_up/down`（进度文档遗留 6）。动了就把
   「play_count 仍为 0 兜底」写清楚；不做就保持现状。

## 范围（只许改这里）

- `android-native/core/src/main/kotlin/cn/toside/music/core/music/search/`
  （只新建歌单搜索文件；既有单曲五源与 `SearchAggregator` 只调用不改）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/search/`
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/data/SearchRuntime.kt`
  （接线）+ 可新建 `SonglistSearchRuntime.kt`
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/songlist/`
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/play/CoverImageLoader.kt`
  （仅可见性/工具方法扩展）
- `android-native/core/src/main/kotlin/cn/toside/music/core/list/`（仅可选任务 4：
  只许新增方法或加元数据，不改既有方法语义，既有 ListStore 用例不许变红）
- 新增测试放对应包

## 禁触

- 推荐通道数据编排（`data/` 里推荐/SonglistRuntime 的重排行——Lane B 本波独占）；
  `core/.../recommend/`
- `ui/HomePage.kt`、`HomeNavigator.kt`（本波两 lane 都不动；路由不够用记报告）
- `player/`、`lyric/`、`ui/settings/`、`ui/play/` 其余文件、`core/.../setting/`（Lane A 范围）
- `ui/leaderboard/`、`core/.../music/leaderboard/`、`userapi/`、`.github/`、gradle 与版本目录

## 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿；
- 歌单搜索每源至少 3 用例 + 黄金 fixture；加入歌单去重/多选批量有 JVM 单测；
- 真机清单（歌单搜索五源观感、类型切换、批量加入、封面显示）写进报告；
- lane 报告按 RULES 模板追加到本文件末尾并 commit。
