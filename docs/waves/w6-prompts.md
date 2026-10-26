# Wave 6 总纲（协调会话产出）

> 本文件是 Wave6 的车道切分与派发说明，三条车道的执行会话各自只读自己的
> `docs/waves/w6-<laneX>.md`，外加 `docs/waves/RULES.md` 与 `AGENTS.md`。

## 0. 波前基线（起草时点实测，2026-10-26）

- 主仓库 `main` = `1a837fd`（Wave5 三车道并入 + 装配补做 + 主进度文档汇总）。
- 闸门：`cd android-native && GRADLE_USER_HOME=E:/GradleHome ./gradlew ktlintCheck test assembleDebug`
  → **core 883 + app 111 = 994** 全绿，APK **28,925,062 B**，sha256 `0103f78…`。
- Wave5 遗留清单 17 条记在 `docs/kotlin-migration-progress.md`「Wave5 遗留清单」，编号 W5-1~W5-17。
  本波只吃其中 6 条（见 §2），其余留给 Wave7，**不要顺手做**（并行车道互不可见，越界必冲突）。

## 1. 本波要解决的三个真问题

1. **M3 规则在真机等于没跑**（W5-1/W5-2）：`Diversity.select` 写完了但没人调用，
   `RadioEngine` 仍在用 M2 的 `RadioSelection.select`；`PoolCandidate.lang` 字段写完了但
   没有任何生产方（全仓 grep 只有模型定义）。结果是 MMR、同作品软降频、分类轮换、
   **语种硬配额**全部不生效——Wave5 的问卷答了等于白答。**这是本波第一优先级。**
2. **搜索缺两类**（W5-15）：RN 是 music / songlist / album / artist 四类，原生只有前两类。
   RN 侧五源都有 `album.js` + `artist.js` 且共用 `albumNormalizers.ts` / `artistNormalizers.ts`，
   移植路径清晰、互不牵连其他模块，适合整条车道独立完成。
3. **本地曲库只到「能播」**（W5-7/W5-8/W5-11）：没有重定位入口、本地缺标签时不会去在线兜底
   （RN 有 `getOtherSourceByLocal`）、内嵌歌词没读、分享还得先污染相册。

## 2. 车道切分

| 车道 | 主题 | 吃的遗留 | 主要路径 |
|:--|:--|:--|:--|
| **Lane A** | 推荐 M3 供给层接线：让 Wave5 写的规则真生效 | W5-1 / W5-2 / W5-3 | `core/recommend/**` + `app/.../data/RadioRuntime.kt` |
| **Lane B** | 搜索「专辑 / 歌手」两类（五源） | W5-15 | `core/music/search/**` + `app/.../ui/search/` + `app/.../data/SearchRuntime.kt` |
| **Lane C** | 本地曲库二轮：重定位 + 在线兜底 + 内嵌歌词 + 分享不落相册 | W5-7 / W5-8 / W5-11 | `app/.../data/LocalMusicRuntime.kt` + `player/PlayerRuntime.kt` + `ui/share/` + `AndroidManifest.xml` |

**三条车道互不重叠**（A 碰 `core/recommend` + `data/RadioRuntime`，B 碰 `core/music/search` +
`ui/search` + `data/SearchRuntime`，C 碰 `data/LocalMusicRuntime` + `player/` + `ui/share` +
Manifest）。唯一的理论交叉是 `data/` 目录下三个不同文件，文件级不冲突。

## 3. 明确**不在**本波范围（留给 Wave7，别顺手做）

- W5-5 音频特征路线 A（纯谱特征 FFT）——独立 M 级任务，需要先定「有没有用」的评测口径。
- W5-14 播放页 morph 转场——**必须先动 gradle 依赖**（`compose.animation`），本波禁触。
- W5-10 同步（更新）移植、`.lxmc` 自定义 MIME、`.js` 音源导入、`music/searchPlay`。
- W5-9 `ListFileActions` 抽取、W5-6 问卷 Slider（要 material）、W5-13 本地曲进画像口径、W5-16 递归扫描。

## 4. 共同纪律

- 严格按 `docs/waves/RULES.md`：只在当前 worktree、不 push/merge/rebase、主进度文档只读、
  收尾三步（闸门 → commit → lane 报告）必须走完。
- **一个功能点能测的先写纯函数 + 用例，再接 app 装配**（Wave5 三条车道都吃到了这个顺序的好处）。
- 移植语义以 RN 为准；任务书里写的「起草假设」**一律先实证再动手**，被推翻就记进
  lane 报告「语义修正」节，并按实证改做法（Wave5 有 3 处起草假设被实证推翻，属于正常流程）。
- 每次 commit 消息以 `W6-<laneX>:` 开头；跨车道的公开入口（如果有）签名先提交再实现。

## 5. 真机验收的定位

三条车道的验收都**不能只靠 JVM**：A 要靠 `reasons` 与 `channelShare` 看配额是否真兑现，
B 要靠五源真实响应看字段，C 要靠真机的授权失效/文件被删/分享到微信。任务书各自列了
真机清单，写完代码不算完成，清单要写清楚「怎么验、看到什么算通过」。
