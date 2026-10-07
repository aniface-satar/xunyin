# 推荐页首次进入偏好问卷（Onboarding）设计

日期：2026-10-08
状态：已与用户确认定稿（Q3 心情·场景删除；Q2 风格选项扩全；答案全部多选）

## 背景与目标

推荐 tab（`src/screens/Home/Views/Recommend`）现在对全新用户完全依赖行为数据的冷启动：没有播放历史/歌单时，画像为空，电台与探索退化为热榜/低曝光轮播。本设计在**首次进入推荐 tab** 时插入一个偏好问卷，让用户多选"听什么语言、什么风格"，把这些显式偏好作为**先验**注入推荐引擎已有的学习账本，使电台、探索未知、新歌速递、推荐歌单四个出口从第一次取数起就跟着偏好走，并且能命中各音源的网络歌单分类目录（语种/曲风流派组）。

非目标：

- 不做硬过滤（"只推英文歌"）——偏好是乘性先验，会被后续真实反馈覆盖。
- 不做账号/上报——全部本地。
- 不改各区块既有的保鲜、队列只读约束（见 2026-10-07 迭代记录）。

## 用户流程

1. 推荐 tab 挂载时读取引擎状态 `onboarding.completed`；`false` 时整个 tab 渲染问卷页（替代电台卡片/新区块，竖屏，遵守 portrait-only 约定）。
2. 问卷两题，**均为多选**（点选高亮、可反选；至少选 1 项才能提交）：
   - **Q1 语言**：华语 / 粤语 / 欧美(英文) / 日语 / 韩语 / 其他小语种
   - **Q2 风格**：流行 / 摇滚 / 民谣 / R&B·灵魂 / 嘻哈·说唱 / 电子·舞曲 / 古风·国风 / 二次元·ACG / 轻音乐·纯音乐 / 爵士 / 蓝调 / 金属 / 朋克 / 乡村 / 拉丁 / DJ·Remix
3. 底部"开始推荐"按钮 → 写入引擎状态并生效；右上角"跳过"→ 只记 `completed=true`，不写任何权重（保持现有冷启动行为）。
4. 修改偏好入口：**推荐 tab 内**（问卷下方区块常驻一个"调整偏好"小字按钮，重新打开同一问卷并预填已选项）。
   - 注：早前讨论提过"设置页加入口"，因设置页是独立 RNN 栈、回流到 Home tab 覆盖层导航复杂，收编为 tab 内入口；如仍要设置页入口另行迭代。
5. 重提交语义：撤销**上一轮问卷写入的初值**（按记录 key 清单精确回退），写入新一轮；用户之后的真实反馈不受影响。提交/跳过后 `markProfileLearned()` + 强制刷新两个新区块；电台下次启动即按新先验取数。

## 方案选型（为什么注入现有账本）

- **A（采用）**：完成问卷时写 `state.themeWeights`（分类级学习，45 天半衰期，`themeAffinityFactor`/`pickPlaylistTag` 已全链路消费）+ 偏好规范词并入关键词池（`buildPlaylistKeywords` 出口与 `candidate.ts` 的 `keywordPool`）。新增代码最少，四个出口自动联动，半衰期让真实反馈自然接管。
- B（否决）：`buildFinalQueueItems` 新增独立显式偏好因子——控制力强但与 theme/token 机制职责重叠，改动面大。
- C（否决）：只影响推荐歌单选分类——电台不感知，违背联动初衷。

## 组件与数据流

### 纯模块 `src/core/recommend/onboarding.ts`

- `ONBOARDING_OPTIONS`：每个选项 `{ id, label, aliases }`。`aliases` 既是与音源分类目录 tag 名做匹配的种子词，也是写入 `themeWeights` 的键集合（各源叫法不一：语种组"语种/语言"、风格组"曲风流派/风格"；如 欧美→`[欧美, 英文, 西洋]`、说唱→`[说唱, 嘻哈, Hip-Hop]`、电子→`[电子, EDM, 舞曲, 节奏]`）。
- `computePreferenceSeeds(optionIds)`：返回 `{ themeKeys: Record<string, positiveWeight>, keywords: string[] }`；初值权重取 `themeFeedback.saturation`（当前 4，净权重达 saturation 即偏置满幅）。
- `revokePreferenceSeeds(themes, seededKeys)`：从 `themeWeights` 精确减去记录在案的初值分量；净权仍为用户反馈的，保留不删。
- 匹配用归一化包含函数（复用 `candidate.ts` 同款 `normalizeText` 思路：小写、去空格）。

### 状态与迁移（`types.ts` / `stateSchema.ts`，STATE_VERSION 6→7）

```ts
interface OnboardingState {
  completed: boolean
  optionIds: string[]      // 当前生效的选择（供"调整偏好"预填）
  seededThemeKeys: string[] // 上一轮写入 themeWeights 的键清单（供精确回退）
}
```

迁移规则：raw 缺 `onboarding` 时，若已有学习数据（`tracks`/`playlists`/`themeWeights` 任一非空）→ `completed=true`（老用户升级不弹问卷）；否则 `completed=false`（全新安装走问卷）。

### 引擎门面（`index.ts` 的 `RecommendationEngine`）

- `getOnboardingView()`：`{ completed, selectedOptionIds }`，UI 只读。
- `submitOnboarding(optionIds)` / `skipOnboarding()`：revoke 旧种子 → 写新 `themeWeights` 种子与 `optionIds/seededThemeKeys` → `markProfileLearned()` → `saveState()`。空选择＝跳过。

### 注入点（两处，均一行级改动 + 测试）

1. `buildCuratedKeywords()`：画像关键词与 `onboarding.keywords` 合并去重（偏好词置前），覆盖新歌速递选榜与推荐歌单选分类。
2. `candidate.ts` 的 `keywordPool`：`CatalogRefreshParams` 增 `explicitKeywords`（来自 `onboarding.keywords`），插在画像关键词之前、参与既有 rotation 窗口——电台/探索按关键词搜网络歌单的通道由此吃到偏好。

`themeWeights` 无需新接线：`getCuratedPlaylistCategory → pickPlaylistTag(tags, state.themeWeights, …)` 与歌单亲和度偏置已在消费它。

### UI（`src/screens/Home/Views/Recommend/`）

- `Onboarding.tsx`：两题多选 chip 卡（主题色高亮、可选中计数），"开始推荐"/"跳过"；提交后由 `Recommend` 主组件按 `completed` 切回正常内容。
- `index.tsx`：挂载时查 `getOnboardingView()`，未完成渲染 `Onboarding`；正常内容顶部（或新区块 header 行）挂"调整偏好"按钮。
- 文案进 `src/lang/{zh-cn,zh-tw,en-us}.json`（`recommend_onboarding_*` 键）。

## 错误处理

- 问卷纯本地，不依赖网络；提交即持久化。
- 音源分类目录里没有偏好对应 tag 时静默跳过该偏好对该源的影响（现状 `pickPlaylistTag` 已是轮游走位，不会崩）。
- 引擎状态未就绪（`stateReady=false`，读档失败）时提交返回失败，UI 保留问卷不消失——下次进入重试，避免"问卷白填"。

## 测试

`tests/recommend-onboarding.mts`（node:test，纳入 `npm test` 文件清单）：

1. `computePreferenceSeeds`：多选并集、键=别名集、权重=saturation。
2. `revokePreferenceSeeds`：只回退初值分量，用户反馈净权保留；键不存在幂等。
3. 迁移：有学习数据→completed=true；干净状态→completed=false；未知字段丢弃。
4. 关键词合并：偏好词置前、去重、rotation 窗口仍可滑动。
5. 别名匹配：对模拟的五源分类目录样本（含"曲风流派/风格"两组叫法）命中判定。

静态闸门沿用项目惯例：`npm test` 全绿 + eslint 干净 + tsc（recommend 目录零报错）+ Metro bundle 产物含 `recommend_onboarding` 键；真机验收由用户在 V2302A 上执行。

## 既有约束复核（来自项目记忆，勿违反）

- 推荐信号仍全部本地、无上报（本问卷是显式本地输入，符合）。
- 两个新区块对电台队列只读的约束不变。
- 音源随机轮换（kw/kg/tx/wy/mg）不变，偏好按别名映射逐源生效。
- "偏好初值会被真实反馈半衰期接管"是本设计有意取舍：问卷是冷启动先验，不是长期订阅。
