# Wave 1 · Lane A 任务书 —— S2 排行榜 tx/wy/mg 榜单详情（收口 + 补全）

> 本文件是 Lane A 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md` 与本文全文。
> 2026-10-25 按波前快照状态重写（旧版 Lane A 的 S1 五源搜索接线已由 B5 第八切片完成，作废）。

## 背景

B5 第九切片已完成 kw/kg 榜单详情与本地分页；主仓库在被叫停的排行榜会话里留下了
**半成品** `TxLeaderboard.kt` / `WyLeaderboard.kt` / `WyWeapi.kt`（未接进运行时、无测试），
`MgLeaderboard.kt` 完全没有。`LeaderboardRuntime.kt` 目前对 tx/wy/mg 的 `getListDetail`
仍返回「未接入」。本 lane 把这三个源的榜单详情收口。

## 任务

1. **先审计快照里的半成品**：`TxLeaderboard.kt` / `WyLeaderboard.kt` / `WyWeapi.kt`
   逐条对照 RN `src/utils/musicSdk/tx/leaderboard.js`、`wy/leaderboard.js`
   （tx：`c.y.qq.com` HTML period 抓取 → `musicu.fcg` GetDetail；
   wy：weapi 加密链 → searchMusicListByRanks → musicDetail 两段）。
   判定可用/需修/需重写，结论写 lane 报告「语义修正」节。
2. **实现 MgLeaderboard**：对照 RN `src/utils/musicSdk/mg/leaderboard.js`
   （`filterMusicInfoList` 链路、`sqsong/getDataByTag` 参数与翻页语义）。
3. **接进运行时**：`LeaderboardRuntime.kt` 的 `isDetailSupported/getListDetail`
   覆盖 tx/wy/mg，移除「该源的榜单详情暂未接入」提示；传输沿用现有
   HttpURLConnection 模式（tx 的 HTML 抓取需要按文本返回，必要时在 runtime 补一个
   fetchHtml 注入口）。
4. **黄金测试**：五源真实响应落盘 fixture 的做法照旧（kw/kg 已示范）——
   在本机用公开接口实际抓取 tx/wy/mg 各一个榜单的第一页响应原样落盘；
   某接口在本机不可达时改用合成 fixture 并在报告注明。
   解析/映射/翻页每个源至少 3 用例（正常、空/错误码门禁、字段缺失容错）。
5. **UI 验证**：`LeaderboardDetailPage` 对新三源的展示（序号高亮、加载更多、
   播放入口走临时列表链路）——只许改 `ui/leaderboard/` 内的行，导航路由不动。

## 范围（只许改这里）

- `android-native/core/src/main/kotlin/cn/toside/music/core/music/leaderboard/`（整个目录，
  含审计与修改 Tx/Wy/Mg 三个文件）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/data/LeaderboardRuntime.kt`
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/leaderboard/`
- 新增测试与 fixture 放对应包（`core/src/test/.../music/leaderboard/` 等）

## 禁触

- `core/.../music/search/`（只许 import `SearchRequest` 等既有类型，不许改）
- `core/.../crypto/`（只调用，不改；weapi 若缺能力，用私有辅助函数放 leaderboard 包内解决并记录）
- `core/.../setting/`、`ui/settings/`、`userapi/`（Lane B 范围）
- `ui/play/`、`core/.../lyric/`、`core/.../player/`（Lane C 范围）
- `AndroidManifest.xml`、`.github/`、gradle 与版本目录

## 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿；
- tx/wy/mg 榜单详情在 `LeaderboardRuntime` 真实可用（不再返回未接入提示）；
- 每源至少 3 个 JVM 用例 + 真实/合成 fixture；
- lane 报告按 RULES.md 模板追加到本文件末尾并 commit。

## 真机验收清单（写进报告，由用户执行）

- tx 榜点开能看到当期歌曲（period 抓取成功）、wy 榜两段链取到完整元数据、
  mg 榜翻页与去重观感与 RN 一致；
- 三源「播放全部」→ 临时列表起播 → 后台补全全表。
