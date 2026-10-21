# 推荐页首次进入偏好问卷（Onboarding）设计

日期：2026-10-08
状态：已与用户确认定稿。交互两轮修订：①删除 Q3 心情·场景，Q2 风格选项扩全；②答案从"多选勾选"改为**一列选项 + 滑条调百分比**（0%＝不选）。

## 背景与目标

推荐 tab（`src/screens/Home/Views/Recommend`）现在对全新用户完全依赖行为数据的冷启动：没有播放历史/歌单时，画像为空，电台与探索退化为热榜/低曝光轮播。本设计在**首次进入推荐 tab** 时插入一个偏好问卷，让用户用滑条给出"听什么语言、什么风格"的偏好强度，把这些显式偏好作为**先验**注入推荐引擎已有的学习账本，使电台、探索未知、新歌速递、推荐歌单四个出口从第一次取数起就跟着偏好走，并且能命中各音源的网络歌单分类目录（语种/曲风流派组）。

非目标：

- 不做硬过滤（"只推英文歌"）——偏好是乘性先验，会被后续真实反馈覆盖。
- 不做账号/上报——全部本地。
- 不改各区块既有的保鲜、队列只读约束（见 2026-10-07 迭代记录）。

## 用户流程

1. 推荐 tab 挂载时读取引擎状态 `onboarding.completed`；`false` 时整个 tab 渲染问卷页（替代电台卡片/新区块，竖屏，遵守 portrait-only 约定）。
2. 问卷两题，**每题一列选项，右侧显示百分比，滑条调节强度**（0%–100%，步长 10%，默认 0%＝不选；滑到 0% 即取消该项）：
   - **Q1 语言**：华语 / 粤语 / 欧美 / 日语 / 韩语 / 小语种
   - **Q2 风格**：流行 / 摇滚 / 民谣 / R&B / 嘻哈说唱 / 电子舞曲 / 古风国风 / 二次元ACG / 轻音乐 / 爵士 / 蓝调 / 金属 / 朋克 / 乡村 / 拉丁 / DJ
3. 底部"开始推荐"按钮 → 写入引擎状态并生效；右上角"跳过"→ 只记 `completed=true`，清空既有初值（如有），保持现有冷启动行为。
4. 修改偏好入口：**推荐 tab 内**（正常内容顶部一个"调整偏好"小字按钮，重新打开同一问卷并按已存百分比预填）。
   - 注：早前讨论提过"设置页加入口"，因设置页是独立 RNN 栈、回流到 Home tab 覆盖层导航复杂，收编为 tab 内入口；如仍要设置页入口另行迭代。
5. 重提交语义：撤销**上一轮问卷写入的初值**（按记录的 键→初值 清单精确回退），写入新一轮；用户之后的真实反馈不受影响。全部滑条停在 0% 时提交＝跳过。提交/跳过后 `markProfileLearned()` + 强制刷新两个新区块；电台下次启动即按新先验取数。

## 百分比 → 算法权重的语义

- 每个选项的百分比 p（0–100）折算成分类级先验初值：`seed = p / 100 × themeFeedback.saturation`（当前 saturation=4，净权重达 4 即分类偏置满幅）。100%＝满幅先验，50%＝半幅。
- **语言与风格两题同式**，不做"占比合计 100%"约束：各选项是独立强度（想全高就全高，相对大小即配比）。
- 偏好词进入关键词池（电台候选发现 + 两个新区块定向）时按百分比**降序**排列，≥20% 的选项才贡献关键词。
- 分类权重走 `themeWeights` 精确键匹配（tag 名归一化后同名才加分），关键词走包含匹配（歌单/榜单名里出现即加分）——双通道覆盖各源不同的 tag 叫法。

## 方案选型（为什么注入现有账本）

- **A（采用）**：完成问卷时写 `state.themeWeights`（分类级学习，45 天半衰期，`themeAffinityFactor`/`pickPlaylistTag` 已全链路消费）+ 偏好规范词并入关键词池（`buildPlaylistKeywords` 出口与 `candidate.ts` 的 `keywordPool`）。新增代码最少，四个出口自动联动，半衰期让真实反馈自然接管。
- B（否决）：`buildFinalQueueItems` 新增独立显式偏好因子——控制力强但与 theme/token 机制职责重叠，改动面大。
- C（否决）：只影响推荐歌单选分类——电台不感知，违背联动初衷。

## 组件与数据流

### 纯模块 `src/core/recommend/onboarding.ts`

- `ONBOARDING_OPTIONS: { id, question: 'language' | 'genre', aliases: string[] }[]`。`aliases[0]` 为规范词（进关键词池），全量 `aliases` 归一化后作为 `themeWeights` 的键集合（各源叫法不一：语种组"语种/语言"、风格组"曲风流派/风格"；如 欧美→`[欧美, 英文, 西洋]`、嘻哈说唱→`[说唱, 嘻哈, HIPHOP, RAP]`、电子舞曲→`[电子, EDM, 舞曲]`）。键的归一化一律用 `trackKey.normalizeText`。
- `sanitizeWeights(weights)`：只留合法 id，钳到 0–100 并取整到 10 的倍数，丢弃 0。
- `computeSeedWeights(weights)`：`Record<optionId, percent>` → `Record<themeKey, seedValue>`（同键多选项命中时取 max）。
- `applySeedWeights(themes, seeds, now)` / `revokeSeedWeights(themes, seeds)`：按键加/减记录的初值分量；减后钳 0，正负皆 0 的条目删除；已有用户反馈分量原样保留。
- `computePreferenceKeywords(weights)`：≥20% 的选项取规范词（`normalizeText(aliases[0])`），按百分比降序去重。
- `mergePreferenceKeywords(profileKeywords, prefKeywords)`：偏好词置前、去重。

### 状态与迁移（`types.ts` / `stateSchema.ts`，STATE_VERSION 6→7）

```ts
export interface OnboardingState {
  completed: boolean
  /** optionId → 百分比（只存 >0 的项），"调整偏好"预填用 */
  weights: Record<string, number>
  /** themeWeights 键 → 本轮写入的初值分量，精确回退用 */
  seededThemeWeights: Record<string, number>
}
```

迁移规则：raw 缺 `onboarding` 时，若已有学习数据（`tracks`/`themeWeights` 任一非空）→ `completed=true`（老用户升级不弹问卷）；否则 `completed=false`（全新安装走问卷）。

### 引擎门面（`index.ts` 的 `RecommendationEngine`）

- `getOnboardingView()`：`{ completed: boolean, weights: Record<string, number> }`，UI 只读。
- `submitOnboarding(weights)`：sanitize → revoke 旧 `seededThemeWeights` → apply 新种子 → 更新 `onboarding`（`completed=true`；空选择时 `weights/seededThemeWeights` 均为空）→ `markProfileLearned()` → `saveState()`。状态未就绪返回 `false`，UI 保留问卷下次重试。

### 注入点（两处，各一行级改动 + 测试）

1. `buildCuratedKeywords()`：画像关键词与 `computePreferenceKeywords(onboarding.weights)` 合并去重（偏好词置前），覆盖新歌速递选榜与推荐歌单选分类。
2. `candidate.ts` 的 `keywordPool`：`CatalogRefreshParams` 增 `explicitKeywords`（同上，按强度降序），插在画像关键词之前、参与既有 rotation 窗口——电台/探索按关键词搜网络歌单的通道由此吃到偏好。

`themeWeights` 无需新接线：`getCuratedPlaylistCategory → pickPlaylistTag(tags, state.themeWeights, …)` 与歌单亲和度偏置已在消费它（净权重查询键 = `normalizeText(tag.name)`，与种子键同一归一化）。

### UI（`src/screens/Home/Views/Recommend/`）

- `Onboarding.tsx`：`ScrollView` 两节；每节 = 标题 + 选项行列表。**选项行布局**：`[名称 | 滑条(flex) | 百分比文本(固定宽)]`，滑条用 `@react-native-community/slider`（min0 max100 step10，轨道色跟随主题，同设置页滑条观感），右侧实时显示 `${p}%`；底部"开始推荐"主按钮 + "跳过"文字按钮。提交调用 `recommendationEngine.submitOnboarding`，成功回调父组件切回正常内容。
- `index.tsx`：挂载时查 `getOnboardingView()`，未完成（或用户点"调整偏好"）渲染 `Onboarding`（预填 `weights`）；正常内容顶部挂"调整偏好"入口。
- 文案进 `src/lang/{zh-cn,zh-tw,en-us}.json`（`recommend_onboarding_*` 键，选项标签键 `recommend_onboarding_opt_<id>`）。

## 错误处理

- 问卷纯本地，不依赖网络；提交即持久化。
- 音源分类目录里没有偏好对应 tag 时静默跳过该偏好对该源的影响（现状 `pickPlaylistTag` 已是轮游走位，不会崩）。
- 引擎状态未就绪（`stateReady=false`，读档失败）时提交返回失败，UI 保留问卷不消失——下次进入重试，避免"问卷白填"。

## 测试

`tests/recommend-onboarding.mts`（node:test，纳入 `npm test` 文件清单）：

1. `sanitizeWeights`：非法 id 丢弃、钳位取整到 10、0 值删除。
2. `computeSeedWeights`：键=归一化别名集、值=百分比×saturation/100、同键取 max。
3. `applySeedWeights`/`revokeSeedWeights`：只回退初值分量，用户反馈净权保留；减到 0 且无负权时删除条目；重复 revoke 幂等。
4. `computePreferenceKeywords`：≥20% 才入选、按百分比降序、去重。
5. 迁移：有学习数据→completed=true；干净状态→completed=false；已有 `onboarding` 字段原样保留。
6. 端到端偏置：`pickPlaylistTag` 对模拟五源分类目录（含"欧美"tag），注入 欧美=100% 种子后 preferred 轮换命中该 tag。

静态闸门沿用项目惯例：`npm test` 全绿 + eslint 干净 + tsc（recommend 目录零报错）+ Metro bundle 产物含 `recommend_onboarding` 键；真机验收由用户在 V2302A 上执行。

## 既有约束复核（来自项目记忆，勿违反）

- 推荐信号仍全部本地、无上报（本问卷是显式本地输入，符合）。
- 两个新区块对电台队列只读的约束不变。
- 音源随机轮换（kw/kg/tx/wy/mg）不变，偏好按别名映射逐源生效。
- "偏好初值会被真实反馈半衰期接管"是本设计有意取舍：问卷是冷启动先验，不是长期订阅。
- 竖屏约定：问卷行布局不得依赖横屏分支。
