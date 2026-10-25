# Wave 4 · Lane A 任务书 —— S13 推荐 M2：bandit 全家桶 + 个性电台 + 不感兴趣闭环

> 本文件是 Lane A 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md` 与本文全文。
> **预草稿**（2026-10-26 起草，基线 = Wave3 并入后 core 558 + app 76 = 634，
> APK 28,142,274 B）：投用前必须由协调会话在新快照上复核修订（教训 2）。

## 背景与立项依据

进度文档「Wave3 推荐立项输入：引擎解耦评估」定义 M2 = **电台/探索 = `bandit +
candidate/candidatePool/queue/requestPolicy/sessionHealth/listening` 全家桶**。
M1（画像重排）已由 Wave3 Lane B 落地并有真机清单；Wave3 集成记录点名两条 M2 前置欠账：

- `@play_history` **无写入方**——listening/画像的历史输入现在是空的；
- B2 语义修正表：`playedList` 仅个性电台经 `musicToggled` 写入临时曲（RN `radio.ts:151`），
  该写入点当时明确「留给电台接入时补」。

RN 对照（worktree 内只读，先全部通读实证再动手；路径以实际为准）：
`src/core/recommend/` 的 radio.ts、bandit.ts、candidate.ts、candidatePool.ts、
queue.ts、requestPolicy.ts、sessionHealth.ts、listening.ts、tempQueueOrder.ts、
feedback.ts（除 M1 已移植的 themeNetWeight 外其余）、dislike 相关、
`src/core/dislikeList.ts`、`src/screens/Home/Views/Recommend/`（电台/探索入口 UI）、
onboarding.ts（问卷，**可选项**）。

## 任务

1. **播放历史写入方**：在播控侧补 RN `addPlayHistory` 等价（只写持久化
   `@play_history`，与内存 playedList 无关——B2 表已锁死这条语义），
   写入时机对照 RN 实证；单测锁形状与去重。
2. **`:core` M2 引擎**：bandit/candidate/candidatePool/queue/requestPolicy/
   sessionHealth/listening 纯规则移植（新子包 `recommend/radio/`），
   输入输出普通 Map/List，全 JVM 单测 + 能拿真实数据处落盘黄金 fixture；
   RNG 相关注意可注入（对照莫奈取色的教训：不可注入的 Math.random 会让用例抖动）。
3. **电台编排与接线**：`PlayerCore` 电台态写入点（playedList/tempQueueOrder）
   按 RN 语义补上；app 侧电台 runtime 组合 M1 画像 + M2 引擎 + 取链既有链路；
   **音量均衡开启时 `isEnableAudioOffload` 必须置 false 的既有约束不得被接线碰丢**。
4. **电台 UI**：发现页电台卡片/进入电台/队列反馈（喜欢/不感兴趣→dislikeList
   持久化与过滤闭环）。路由不够用许加 `HomeNavigator.Route`（本波 HomePage/HomeNavigator
   归本 lane）。**「更多」分页与 onboarding 问卷为可选项**：主线收不完就写遗留，不硬赶。
5. **OEM 保活**：以 `docs/waves/w3-A.md` 任务 5 的调研结论为输入，决定是否随电台
   落地 FGS/OEM 白名单动作；不做就按调研结论登记收官遗留。
6. **M3 禁触**：audioEmbedding/melSpectrogram/nativeAudio/diversity/similarity
   一个字不写；发现 M2 有依赖 M3 的分支，降级处理并记报告。

## 范围（只许改这里）

- `android-native/core/src/main/kotlin/cn/toside/music/core/recommend/`（M1 包可扩，
  既有 M1 纯规则文件的函数签名不许改——Wave 后可能另有人接画像）
- `android-native/core/src/main/kotlin/cn/toside/music/core/player/`（电台写入点，
  逐处记报告）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/player/`、
  `data/`（电台 runtime 接线）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/HomePage.kt`、
  `HomeNavigator.kt` + 新目录 `ui/radio/`
- `android-native/app/src/main/AndroidManifest.xml`（仅 OEM/FGS 相关行；禁动方向属性）
- 新增测试放对应包

## 禁触

- `ui/share/`（不存在则本波不存在，归 Lane B 新建）、`util/` 的分享保存类（Lane B）
- `ui/list/`、`core/.../list/`、`core/.../backup/`、`CoverImageLoader`（Lane C 范围）
- `ui/settings/`、`core/.../setting/`（本波无人认领，缺口记报告）
- `ui/search/`、`core/.../music/search/`、`userapi/`、`.github/`、gradle 与版本目录

## 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿；
- M2 引擎每文件有 JVM 单测；RNG 注入化说明写报告；
- 电台「取曲→播放→喜欢/不感兴趣→再取曲」有 JVM 集成用例（FakePlatform/FakeEngine）；
- lane 报告按 RULES 模板追加到本文件末尾并 commit；真机清单（电台全流程、
  后台存活、dislike 过滤生效）写报告。
