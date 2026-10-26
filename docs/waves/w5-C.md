# Wave 5 · Lane C 任务书 —— S18 入口与分享收尾：首页长按菜单 + deeplink + 系统分享

> 本文件是 Lane C 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md` 与本文全文。
> **起草时点复核**（2026-10-26；基线 = Wave4 并入后 `f214bd8`，core 742 + app 76 = 818）。
> 已复核事实：
>
> - `ui/HomePage.kt` 共 491 行，`MyPage`（第 393 行起）的列表行是 `Item(onClick = ...)`，
>   **全工程没有任何 `combinedClickable` / `onLongClick`** —— 首页列表行长按菜单确实不存在。
> - RN 列表行菜单是 `src/screens/Home/Views/Mylist/MyList/ListMenu.tsx`，**9 项**：
>   新建 / 重命名 / 排序 / 去重 / 本地文件 / 同步 / 导入 / 导出 / 删除（带 `disabled` 规则：
>   default/love 禁重命名与删除、非用户列表禁同步）。
> - `AndroidManifest.xml` 只有 `MAIN` + `LAUNCHER` 一个 intent-filter，**没有 scheme**；
>   `MainActivity` 是 16 行空壳（`setContent { MusicApp() }`），没有 `onNewIntent`。
> - RN deeplink 在 `src/core/init/deeplink/index.ts`：`lxmusic://<type>/<action>/<paths>`，
>   type 有 `music` / `songlist` / `player`，另有文件打开（json、lxmc、js、音频）。
> - `HomeNavigator.Route` 现有 `ListDetail` / `LeaderboardDetail` / `SonglistDetail` / `Radio`。
> - `ShareCardSaver.save(...)` 返回 `ShareSaveResult.Saved(fileName)`，**没有返回 Uri**，
>   所以系统分享现在还发不出去；`DefaultSetting` 里 `common.shareType`（默认 `"system"`）、
>   `shareCard.savePath`、`shareCard.savePathName` **已经存在**，不许再重复造键。
>   **协调会话复核补充**：内部其实**已经持有** MediaStore Uri（私有
>   `writeBitmap(resolver, uri, bitmap)`，`ShareCardSaver.kt:65-80`），只是没往上抛 →
>   任务 3 属「把已有 Uri 带出来」，不需要重做保存链路。

## 背景

三件都被前几波点名留到后面：首页长按菜单（w3/w4 两次遗留）、deeplink（w4-C 明确「不本波做」）、
系统分享（w4-B 遗留 1）。它们的落点全部集中在 `HomePage` / `HomeNavigator` / `MainActivity` /
`Manifest` / `ui/share`，与另两条车道不相交，适合合成一条「入口与分享收尾」车道。

## 任务

1. **首页列表行长按菜单**：给 `MyPage` 的列表行加长按 → 弹出 RN 同构菜单（9 项，含
   `disabled` 规则：试听列表/我的收藏 禁重命名与删除；非用户列表禁同步；导入中禁本地文件）。
   菜单动作实现放**新文件** `ui/list/ListMenuActions.kt`（去重弹层复用既有
   `ui/list/DuplicateMusicDialog.kt`，导入/导出复用 `core/backup/BackupManager` +
   `util/SafDocuments`，排序复用既有排序弹层语义）。
   **`ui/list/ListDetailPage.kt` 归 Lane B（它在加「本地文件」），一个字不许改**——
   因此这里的动作实现与 `ListDetailPage` 内联逻辑短期会重复，属**已知取舍**，
   写进报告遗留（Wave6 统一收口）。
   「本地文件」项调用 Lane B 的公开入口 `LocalMusicRuntime.importTo(...)`；
   B 未落地前该项置灰并写遗留。
2. **deeplink**：`AndroidManifest.xml` 给 `MainActivity` 加 `lxmusic` scheme 的 VIEW intent-filter
   （**禁动 `android:screenOrientation="portrait"`**，AGENTS.md 硬约束；`launchMode` 如需调整
   必须单列说明并记报告）；`MainActivity` 解析 `onCreate` + `onNewIntent`，路由到
   `HomeNavigator`（`songlist` → `Route.SonglistDetail`，`music`/`player` → 播控既有公开方法）。
   文件打开只做 `json` / `lxmc`（复用 `BackupManager`），**`js` 音源导入与音频文件不在本波**
   （前者撞 `userapi`，后者依赖 Lane B），写遗留。
   `app/player/` 归 Lane B，本 lane **只许调用既有公开方法**；若缺方法，降级该分支并记遗留。
3. **系统分享收尾**：`ShareCardSaver.save` 补返回 `uri`（扩展结果类型可以，**不许改既有语义**），
   保存成功后按 `common.shareType` 走 `ACTION_SEND`（图片 + 可选文案），取消/无应用可分享要
   有可读提示；分享类型/默认比例用既有 `DefaultSetting` 键接线（`core/setting/` 只许在表尾追加，
   不许改既有键的默认值）。`ui/share/`、`core/share/` 归本 lane 独占。
4. **播放页 morph 转场（只评估）**：Compose 侧 `SharedTransitionLayout` 与 RN reanimated 的差距、
   代价与风险，结论写报告，本波不实现。
5. **搜索「歌手/专辑」类型**：RN 有 `music/songlist/album/artist` 四类，原生只有前两类——
   属独立 M 级任务（五源 × 两类解析），**本波不做**，在报告里给立项输入（需要新增的 core 文件与
   接口清单），留给 Wave6。

## 范围（只许改这里）

- `android-native/app/.../ui/HomePage.kt`、`HomeNavigator.kt`、`MainActivity.kt`
- `android-native/app/src/main/AndroidManifest.xml`（仅 intent-filter / launchMode；
  **禁动方向属性**）
- `android-native/app/.../ui/share/`、`android-native/core/src/main/kotlin/.../core/share/`
- 新增 `android-native/app/.../ui/list/ListMenuActions.kt`（只新增文件，不改 `ListDetailPage.kt`）
- `android-native/core/.../setting/DefaultSetting.kt`（仅表尾追加）、`ui/settings/`（可选分享小节）
- 新增测试放对应包

## 禁触

- `ui/list/ListDetailPage.kt`、`core/local/`、`app/.../player/PlayerRuntime.kt`、
  `ui/play/CoverImageLoader.kt`、`util/SafDocuments.kt`（Lane B 正在改；`SafDocuments` 只许调用）
- `core/.../recommend/`、`ui/radio/`、`ui/songlist/RecommendPanel.kt`（Lane A 范围）
- `ui/search/`、`core/.../music/search/`、`userapi/`、`core/.../player/`（尽量不改）、
  `.github/`、gradle 与版本目录

## 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿；
- 菜单可用性规则（default/love/非用户列表）有纯规则单测；deeplink 解析做成可测函数
  （`lxmusic://...` 样本表进 JVM 单测），不许把解析逻辑埋在 `onCreate` 里；
- 报告含：9 项菜单的落地/置灰/遗留对照、deeplink 支持矩阵、分享类型矩阵、
  morph 评估结论、搜索类型立项输入、真机清单（长按菜单 / `adb shell am start -a VIEW -d "lxmusic://..."` /
  分享到微信与相册 / 竖屏全程）；
- lane 报告按 RULES 模板追加到本文件末尾并 commit；做完停下等待集成。

---

## Lane 报告（待填）
