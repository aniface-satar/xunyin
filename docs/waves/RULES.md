# Wave 并行协作规则（所有 lane 会话必读）

本仓库正在按 git worktree 三车道并行方式推进 Kotlin 迁移。你是其中一条独立 lane
的执行会话，本目录就是你的专属 worktree。其他会话在别的目录、别的分支工作——
你看不到他们的改动，他们也看不到你的。不要试图同步，不要离开本目录，不要切分支。

## 开工自检（任何一项不过 → 停下报告，不要自行补救）

1. `git status` 干净，当前分支为你被告知的分支名（`w1/laneA` / `w1/laneB` / `w1/laneC`）。
2. `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿；
   测试总数与本目录 `docs/kotlin-migration-progress.md`「验证基线」记录一致
   （只会等于，不会少于；变少 = 有人删测试，停下报告）。
3. `local.properties` 缺失时停下报告，不要自己创建。
4. 依次完整阅读：`AGENTS.md`（竖屏约束：不改 `screenOrientation`，不写横屏分支）、
   `docs/kotlin-migration-progress.md`（批次状态与各批详情）、你被指派的
   `docs/waves/w<N>-<laneX>.md` 任务书全文。

## 工作纪律

1. **只在当前 worktree 工作**；禁止 `checkout` 切分支 / `push` / `merge` / `rebase` /
   `stash` / 修改 git 历史。只允许 `status / diff / add / commit / log`。
2. **主进度文档 `docs/kotlin-migration-progress.md` 只读**——你的发现、语义修正、
   遗留问题、触碰清单全部写进自己的 lane 报告（见收尾三步），由集成会话统一汇总。
3. **RN 原仓库（`src/`、`android/`）只读对照**；发现“RN 侧需要配合修改”时记入
   lane 报告，不要动手。
4. 默认禁触：`.github/`、CI workflow、gradle 与版本目录（`libs.versions.toml`
   等）、任务书「禁触」清单列出的范围。任务书声明的范围之外，只有编译/测试必需的
   最小修复允许，且必须记入 lane 报告。
5. 禁止全局重命名/移动文件、批量重排版、删除既有测试（确属测试写错，记录理由后
   修断言，不许删）。
6. 移植语义以 RN 实现为准；RN 行为与直觉不符时先实证源码，把结论记入 lane 报告
   的「语义修正」节（参照进度文档 B2 语义修正表的格式）。
7. **允许并鼓励按逻辑小块中途 commit**（消息以 `W1-<laneX>:` 开头，如
   `W1-laneA: MgLeaderboard 解析 + 用例`），防止会话中断丢工作；收尾仍要走下方三步。
8. `:core` 可测逻辑全部配 JVM 单测；能拿到真实响应的落盘 fixture 做黄金测试。
9. 音量均衡开启时 `isEnableAudioOffload` 必须置 false（RN player.ts:251）。
10. 竖屏约束：所有界面改动遵守 AGENTS.md。

## 收尾三步（任务做不完也要走完；宁可少做，不可不收尾）

1. 重跑 `cd android-native && gradlew.bat ktlintCheck test assembleDebug`，全绿。
2. `git add -A && git commit`，消息格式：
   `W<n>-<laneX>: <任务名>（core X + app Y 全绿）`
3. 写 lane 报告 `docs/waves/w<n>-<laneX>.md`（在报告区追加，不覆盖任务书），固定格式：

   ```
   ## Lane 报告（<日期>）
   - 结论：完成/部分完成，做到哪、剩什么
   - commit：<短哈希>；测试数 core X + app Y 全绿
   - 触碰文件清单：<供集成会话定位 merge 冲突，逐文件列>
   - 语义修正与实证发现：<参照 B2 语义修正表格式，无则写"无">
   - 遗留问题与对后续波次的建议：<无则写"无">
   ```

   然后 `git add docs/waves && git commit -m 'W<n>-<laneX>: lane 报告'`。
   完成后停下等待集成，不要自行开始其他任务。
