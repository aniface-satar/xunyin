# Wave 8 后收尾三段提示词（2026-10-27）

**使用说明**：Wave 8 三车道分支（`w8/laneA@9ae7950`、`w8/laneB@e5a2b4f`、`w8/laneC@80a810c`）已完成并各带 lane 报告，但**尚未并回 main**（main = `c4c8791`）。本文三段提示词对应收官期剩余工作，**串行投用**：

```
① Wave8 集成收口（三车道并 main + 闸门 + 进度文档收口，另行提示词/协调会话执行）
        ↓
② RN 改动验证提交   ← 仅依赖 ① 的进度文档节，可与 ① 收尾并行
        ↓
③ 真机验收清账      ← 强依赖 ①：必须装「合并后 main」构建的 release 包
        ↓
④ 签名/上架/迁移/双通道 ← 强依赖 ③：清账过关才发版；含多个用户拍板点
```

计数口径勘误：真机清单 W1~7 各节合计 **169 条**（24+16+20+27+39+21+22，见进度文档
行 1324/1419/1505/1628/1807/1957/2084），W8 三车道报告另约 **21 条**（laneA 8、laneB 5、
laneC 8，尚未汇总进文档），**总计约 190 条**（此前「147/168」口径漏计了 Wave7 的 22 条）。

---

## 提示词 ②：主工作区 RN 改动验证提交

```text
你是本仓库（C:/Users/30913/Documents/ChatGPT/music，LX Music 衍生 RN 工程）的集成验证会话。
任务：主工作区有一批未提交的 RN 侧改动（专辑/歌手搜索与详情，对齐原生 Wave6 Lane B 的
跨源搜索能力），验证后提交入库。不要动 android-native/ 下任何文件（Wave8 三车道分支
w8/laneA|B|C 尚未并回 main，原生侧由集成会话负责）。

【现状（2026-10-27 实测，先重跑 git status 核对再动手）】
- 已跟踪修改 28 文件，核心语义：
  - src/config/constant.ts：search.type 扩为 'music'|'songlist'|'album'|'artist'
  - src/core/songlist.ts：getListDetail 按 isAlbumListId 分流到 album.getAlbumDetail
  - src/utils/musicSdk/{kg,tx,wy,mg,kw}/album.js 与 singer.js|artist.js：专辑/歌手取数
  - src/screens/Home/Views/Search/*、src/store/search/*：搜索类型 tab 与状态
  - src/screens/PlayDetail/*、MylistDetail/*、DetailStack.tsx：详情与列表入口
  - src/lang/{zh-cn,zh-tw,en-us}.json：文案
  - package.json：test 脚本追加 7 个新测试
  - docs/waves/w5-prompts.md：仅行尾空白差异（CRLF 类），提交时单独还原或一并说明
- 未跟踪新文件（应入库）：src/core/{artist,artistResolve,musicLinks,mylistLibrary}.ts、
  src/core/search/{album,artist}.ts、src/screens/ArtistDetail/（整目录）、
  src/screens/Home/Views/Search/{AlbumList,ArtistGrid,ArtistList}.tsx、
  src/screens/MylistDetail/{AlbumTab,ArtistTab,useLikedSongs}.*、
  src/store/search/{album,artist}/（整目录）、src/utils/hooks/useOpenMusicDetail.ts、
  src/utils/musicSdk/{albumNormalizers,artistNormalizers}.ts、
  src/utils/musicSdk/{kg,kw,mg,tx,wy}/artist.js、tests/ 下 7 个新 .mts 测试
- 不应入库（临时脚本）：.tmp-boards-*.json、.tmp-extract-boards.cjs、.tmp-gen-boards.cjs、
  .tmp-weapi-golden.cjs、txsinger5.mjs —— 提交前与用户确认：删除，或加入 .gitignore

【步骤】
1. 向用户确认改动来源与意图（这批改动不在任何 wave 任务书范围内，先问一句是否
   就是要提交的「RN 侧专辑/歌手搜索收口」，避免误提交他人半成品）。
2. npm test（node --test 全量，含 7 个新测试），记录通过/失败数；失败先修再继续，
   修不动就停下汇报，不得跳过测试提交。
3. npm run lint；仅修本次改动引入的问题。
4. 检查 AGENTS.md 竖屏约定：新增 ArtistDetail 等页面不得含横屏依赖。
5. 提交：一次提交，message 用
   feat(rn): 专辑/歌手搜索与详情（对齐原生 Wave6 跨源搜索）+ mylistLibrary/musicLinks
   提交后 git status 确认工作区只剩 .tmp-* 与 txsinger5.mjs。
6. 在 docs/kotlin-migration-progress.md 追加一行记录（改动范围 + 测试数）。

【验收】npm test 全绿、lint 无新增告警、提交后工作区干净（除临时脚本）、
进度文档有记录。产出：commit hash + 测试数 + 遗留（如有）汇报给用户。
```

---

## 提示词 ③：真机验收清账

```text
你是本仓库（C:/Users/30913/Documents/ChatGPT/music）的真机验收会话。
前提（先核实）：① Wave8 三车道已并回 main 且闸门全绿；② 已按合并后 main 构建
release 包（android-native/gradlew.bat assembleRelease，无签名也可用 debug keystore
自签测量包——laneA 已验证此口径可用）；③ 用户真机已连 adb（arm64，MIUI/HyperOS
优先，另备一台非国产 ROM 更佳）。

【清单位置（全量盘点，先汇总成一张总表再动手）】
- docs/kotlin-migration-progress.md 七节真机清单，共 169 条：
  行 1324（Wave1，24）/ 1419（Wave2，16）/ 1505（Wave3，20）/ 1628（Wave4，27）/
  1807（Wave5，39）/ 1957（Wave6，21）/ 2084（Wave7，22）
- Wave8 车道报告（已并 main 后在 docs/waves/w8-A|B|C.md 的「Lane 报告」节）约 21 条：
  laneA 8（主题切换全 app / monet 观感 / TalkBack 主流程 / 冷启动对照 / 迁移导入 /
  release 冒烟三链路 / 列表 jank / 桌面歌词 26dp 主题点触达）、
  laneB 5（导入在线歌单后诊断卡 reasons 归因路径 / @ 歌名踩雷双侧判重 / 相似歌曲入口
  且不违反「同歌手连推」/ 发现页分类随 themeWeights 可观测 / 隐藏歌单对照 RN）、
  laneC 8（在线歌单「更新」全流程 / 随机播放与收藏全部 / 自定义排序「添加时间」对
  新加歌生效 / 外部 https 歌单链接直达 / 桌面歌词位置小数重启往返 / 1000 首 countStale
  耗时 / lxmc 与五源 intent-filter 外部打开 / 同步冲突文案）
- 总计约 190 条；部分条目互相依赖或已被后续 wave 改动覆盖，逐条判定
  「仍需执行 / 已被覆盖（写明依据）/ 合并同类」后再执行。

【执行顺序（按功能组，从核心链路往外扩）】
1. B3 取链五源（kw/wy 含签名请求、kg/mg 响应、tx）——播放一切的前提
2. B2 播放内核：通知栏命令、后台存活、缓存清理入口、音量均衡、退出收尾
3. B4 分享卡视觉与手感、播放页弹层
4. B5 搜索/榜单/在线歌单/导航壳/迷你播放条/拖拽排序
5. B6 桌面歌词（FGS 保活、厂商白名单引导、位置小数重启往返）
6. 本地曲库全链路（SAF 授权、扫描、local 直连、失效重定位、内嵌歌词 ogg/flac/m4a）
7. 推荐/电台（M3 配额、问卷、归因诊断卡、themeWeights、prefill 冷却）
8. W8 主题/monet/TalkBack/性能（方法 laneA 已给：am start -W 三次取中位对照 RN 版；
   gfxinfo framestats + reset 后滑动采样统计 jank；TalkBack 走主流程三链路）
9. countStale 千首计时（灌 1000 首 → 列表详情「本地文件」触发，logcat 打点）

【记录与产出】
- 每条结果写回进度文档对应清单：通过打 [x] 并附实测数字（如冷启动 ms、jank 比例、
  countStale 秒）；不通过记新遗留节「真机清账遗留（YYYY-MM-DD）」，写复现步骤。
- 优先修复「播放/取链/数据丢失」级 bug（回到对应模块修复后重验）；
  视觉/手感级可攒批。
- 最终汇报：通过 N / 失败 M / 判定被覆盖 K，附 release 冷启动与 RN 冷启动对照数字
  （laneA 模拟器口径：原生 ≈2.6s vs RN ≈2.3s，真机预期差值收窄）。

【禁区】不改任何功能代码（修 bug 另开会话）；不动 gradle/签名（④ 的事）；
模拟器测得的性能数字只作参考，一律以真机复测为准。
```

---

## 提示词 ④：签名/上架材料/RN 数据迁移/双通道发布

```text
你是本仓库（C:/Users/30913/Documents/ChatGPT/music）的发版筹备会话。
前提（先核实）：① Wave8 已并 main；② 真机清账（提示词③）已过关或用户明示带病发版；
③ 本任务含四个用户拍板点，凡标 [拍板] 处先问后做，不得替用户决定。

【现状（2026-10-27 实测）】
- android-native/app/build.gradle.kts：release 块 isMinifyEnabled=false（R8 未开）、
  无 signingConfig；laneA 用本机 debug keystore（E:\.android\.android\debug.keystore，
  弱口令）自签测量包，仅作性能测量不可发布。
- 包名：RN 版 cn.toside.music.mobile vs 原生版 cn.toside.music.mobile.native——
  两包可并列安装，签名互不影响升级；但正式 keystore 仍必须新签（不得用 debug 钥匙）。
- 渠道现状（可行性文档 §五）：GitHub Release / 酷安，不受应用商店政策影响；
 dependenciesInfo 已按 Google Play 要求关闭（注释在 build.gradle.kts:32-34）。
- RN 数据存储：@react-native-async-storage/async-storage ~2.1.2；
  原生侧 core/data/DataRepository.kt。迁移路径按可行性文档 B1 验收定义：
  「lxmc 备份文件在原生壳里导入跑通」——原生 lxmc SAF 导入 Wave4 Lane C 已实装。
- laneA 报告「任务 6（RN 迁移范围）按拍板门只交清单」：先读 w8/laneA 分支或
  docs/waves/w8-A.md 的清单节，按其口径执行。

【任务与拍板点】
1. [拍板] 正式 keystore：新建（推荐，包名不同无升级兼容负担，密码入密码管理器、
   文件离线备份两份、record SHA-256 进 docs）。生成后配 release signingConfig
   （凭据走 local.properties 或环境变量，禁止硬编码进 gradle）。
2. [拍板] R8/资源收缩：现在关着。先量未开 R8 的 release 包体对照 ≤32MB 目标
   （当前基线 30,986,248 B≈29.5MB，未开 R8 已可能达标）；若达标建议本版不开，
   开 R8 需为 QuickJS/反射/SaltUI 写 keep 规则并重跑全量真机冒烟，收益存疑。
3. [拍板] RN 数据迁移方案：
   A（推荐，按可行性文档定义）:发布说明引导用户在 RN 版「导出 lxmc」→ 原生版
   「SAF 导入」，零代码，导入链路真机清单已覆盖；
   B：原生版加「从 AsyncStorage 直读」一次性迁移（需备份权限，工程量大，
   laneA 清单若未立项则不推荐）。
   无论 A/B：迁移导入必须作为真机清单既有条目复验一次并记录。
4. 上架材料（不涉拍板，直接起草交用户审）：
   - 隐私政策页（数据不收集声明 + 网络取数说明 + 第三方音源来源声明）；
   - 版本说明（CHANGELOG.md 汇总 Wave5~8 用户可感知项）；
   - 权限说明表（悬浮窗 / FGS specialUse / SAF / 通知）；
   - 酷安图文素材（截图建议：首页/播放页/推荐电台/主题 monet/桌面歌词）。
5. [拍板] 版本号与双通道：建议原生首发 1.1.0(10)，GitHub Release + 酷安双通道
   1-2 个版本周期，RN 版冻结不再发新功能；并行期结束 RN 仓库转维护。
6. 发布：GitHub Release 打 tag 传 apk（附 sha256）；酷安按其后台流程。
   发布后 48h 盯 issue/酷安评论，崩溃归档进进度文档。

【禁区】不修功能 bug（回③流程）；不动 RN 工程；签名凭据不进 git；
发布动作（tag/上传）必须在用户最终确认后执行。

【产出】正式签名 release apk + sha256、隐私政策页、权限说明表、CHANGELOG 增量、
发布说明（含迁移指引）、GitHub Release 与酷安发布记录。
```

---

**三段之外的提醒**：①（Wave8 集成收口）若尚未执行，其要点为——三车道文件零交集可依序
merge；合并后重跑 `ktlintCheck test`（各车道报告基线 1252→1275/1282 不一，以合并后
实测为准）；构建 release 对照包体；进度文档补 Wave8 集成记录 + 遗留 + 真机清单汇总节；
清理 6 个 worktree（`_wt7`×3、`music-w8`×3）与 6 条车道分支。
