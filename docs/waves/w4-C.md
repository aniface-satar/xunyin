# Wave 4 · Lane C 任务书 —— S15 歌单长尾包：列表菜单补项 + lxmc 导入导出 + 整单导入/链接解析 + 封面链路

> 本文件是 Lane C 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md` 与本文全文。
> **预草稿**（2026-10-26 起草，基线 = Wave3 并入后 core 558 + app 76 = 634）：
> 投用前必须由协调会话在新快照上复核修订（教训 2）。

## 背景

进度文档多轮遗留合成本包（均为歌单/列表侧长尾，文件面与另两条车道不相交）：

- **列表级菜单缺 5 项**（Wave3 候选 5）：去重 / 本地文件 / 同步 / 导入 / 导出
  （RN `src/screens/Home/Views/Mylist/MyList/` 的 `DuplicateMusic.tsx`、
  `ListImportExport.tsx`、`ListMenu.tsx`、`listAction.ts`）。
- **整单导入与路由缺口**（Wave3 集成记录 Lane C 遗留）：外部歌单「整单导入」未移植；
  kw digest/kg 酷狗码/tx playsquare/wy 单段链接等 id 解析入口未接
  （解析函数本身已在 `core/songlist/` 各源 `normalizeId`，缺的是入口与判定链）。
- **封面链路**（B4 待办）：RN `getPicPath` 的校验/磁盘缓存/失败占位未移植
  （`CoverImageLoader.kt` 注释自己承认是 B4 临时实现）。
- `core/backup/BackupManager.kt` 数据层 B1 就闭环了，**UI/SAF 接线一直没做**（B1 验收对照项）。

## 任务

1. **菜单去重**：对照 RN `DuplicateMusic.tsx` 的去重弹层语义（重复组展示、勾选删除）
   落到 `ui/list/`；判定/分组纯规则进 `core/list/`（新增，配 JVM 单测）。
2. **lxmc 导入/导出**：接 `BackupManager` + SAF——导出 `ACTION_CREATE_DOCUMENT`、
   导入 `ACTION_OPEN_DOCUMENT`（项目记忆：导出走 SAF 已在安卓16真机验通、
   **同名不覆盖会堆 `(1)`**——RN 侧同名行为先实证，至少给出提示）；
   导入类型/冲突处理对照 RN `ListImportExport.tsx` 与 B1 已实现的
   `importPlayList` 全类型分支。SAF 辅助类放 `util/`（**本波 `util/` 归本 lane**）。
3. **整单导入 + id/链接解析入口**：外部歌单页（`ui/songlist/` 详情）加
   「导入为新歌单」——**语义按用户 10-19 纠正过的版本：整张外部歌单新建一张自建歌单
   （不是塞进已有列表），与爱心收藏同认人不建两张**；后台补全走既有
   `SonglistDetailPager/getListDetailAll`。链接解析入口做**粘贴式**（对话框粘贴 →
   各源 `normalizeId` 判定链 → 跳既有 `Route.SonglistDetail` 路由——**复用现有路由，
   不许动 HomeNavigator**，本波它归 Lane A）；deeplink intent 过滤不本波做，写遗留。
4. **本地文件 / 同步两项**：依赖未移植能力（本地曲库/服务器），**只做评估**：
   读 RN 对应实现，结论与最小依赖清单写报告，不实现。
5. **封面 getPicPath 链路**：`CoverImageLoader.kt` 补磁盘缓存/校验/失败占位
   （对照 RN `getPicPath`，先实证缓存目录与键规则；内存 LRU 6 张既有行为保持）。
   **本波该文件归本 lane，Lane B 只调用**——扩展公开 API 可以，改既有方法语义不行。
6. **首页列表长按菜单入口**：本波不做（`ui/HomePage.kt` 归 Lane A），写遗留。

## 范围（只许改这里）

- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/list/`
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/songlist/`
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/util/`（本波独占）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/play/CoverImageLoader.kt`
- `android-native/core/src/main/kotlin/cn/toside/music/core/list/`（只新增/扩展，既有语义不动）
- `android-native/core/src/main/kotlin/cn/toside/music/core/songlist/`（仅解析判定链缺口）
- 新增测试放对应包

## 禁触

- `ui/HomePage.kt`、`HomeNavigator.kt`、`ui/radio/`、`core/.../recommend/`、
  `core/.../player/`、`app/.../player/`、`AndroidManifest.xml`（Lane A 范围）
- `ui/share/`、`core/.../share/`、更多菜单 sheet（Lane B 范围——分享入口行由 B 加）
- `ui/settings/`、`core/.../setting/`、`ui/search/`、`core/.../music/search/`、
  `userapi/`、`.github/`、gradle 与版本目录

## 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿；
- 去重分组/导入冲突/id 判定链有 JVM 单测（BackupManager 往返已有，接 UI 后的
  InMemory KvStore 全链路用例补上）；
- 本地文件/同步的评估结论 + 首页长按菜单、deeplink 两项遗留写清楚；
- lane 报告按 RULES 模板追加到本文件末尾并 commit；真机清单（SAF 导入导出各安卓档、
  整单导入语义、封面断网占位）写报告。
