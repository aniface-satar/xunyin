export const recommendationConfig = {
  /**
   * 单曲级反馈分值。喜欢 +6 / 不感兴趣 -8 为显式信号，
   * 完整听完 +1.5、秒切 -2 为隐式信号。分档条件见 feedback.ts settlePlayRecord。
   */
  behavior: {
    like: 6,
    addToPlaylist: 7,
    dislike: -8,
    repeat: 4,
    complete: 1.5,
    earlySkip: -2,
  },

  /**
   * 四路候选的最终选歌配额。默认每 20 首：A 9 / B 5 / C 4 / D 2。
   * A 画像关联外部歌单；B 正反馈来源歌单及其关联；C 最新/低曝光；D 榜单/主题。
   */
  channels: {
    windowSize: 20,
    /** radio 模式下 C/D 候选权重的亲和度闸门下限：affinity=0 的候选最多降到该比例。 */
    explorationAffinityFloor: 0.55,
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    targetPerWindow: { A: 7, B: 5, C: 4, D: 2, E: 2 } as Record<'A' | 'B' | 'C' | 'D' | 'E', number>,
    /** 探索模式反过来：画像只留少量额度，主要靠低曝光与榜单撞新；E 在探索模式不供货。 */
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    exploreTargetPerWindow: { A: 3, B: 1, C: 9, D: 7, E: 0 } as Record<'A' | 'B' | 'C' | 'D' | 'E', number>,
    fallbackOrder: ['A', 'C', 'B', 'D', 'E'] as Array<'A' | 'B' | 'C' | 'D' | 'E'>,
    exploreFallbackOrder: ['C', 'D', 'A', 'B'] as Array<'A' | 'B' | 'C' | 'D' | 'E'>,
    // 冷启动没有 topArtists 就没有种子歌手，E 必然空跑，别放进兜底顺序
    coldStartFallbackOrder: ['C', 'D', 'A'] as Array<'A' | 'B' | 'C' | 'D' | 'E'>,
  },

  /**
   * 词面级学习：歌名 token（DJ版/Live/翻唱/伴奏、风格词等）随结算记正负反馈，
   * 打分时按 token 命中乘性调整权重。负向因子刻意大于正向——避开踩雷优先。
   */
  nameToken: {
    halfLifeDays: 30,
    maxWeight: 6,
    likePositive: 0.5,
    addToPlaylistPositive: 0.5,
    dislikeNegative: 1,
    completePositive: 0.25,
    earlySkipNegative: 0.5,
    positiveFactor: 0.15,
    negativeFactor: 0.35,
    floor: 0.5,
    ceiling: 1.25,
  },

  /**
   * SAR 式会话共现：与画像种子歌在同一场收听（间隔 ≤ sessionGapMs）里出现、
   * 且自身未早切的歌获得加分，按时间半衰期衰减后饱和归一化到 0~1。
   */
  sessionCoOccurrence: {
    sessionGapMs: 30 * 60 * 1000,
    halfLifeDays: 14,
    maxRecords: 300,
    anchorMinCoverage: 0.8,
    memberMinCoverage: 0.5,
  },

  /**
   * 通道配额的 Thompson bandit：每个通道维护 Beta(alpha,beta)，
   * 完播/喜欢记 alpha，早切/不喜欢记 beta，读取时按半衰期衰减（品味漂移）。
   * 样本不足 minObservations 的通道保持中性 multiplier=1。
   */
  bandit: {
    priorAlpha: 1,
    priorBeta: 1,
    minObservations: 5,
    minBoost: 0.5,
    maxBoost: 1.5,
    halfLifeDays: 30,
    maxCount: 24,
  },

  /**
   * 设备端音频风格嵌入（Android，MusiCNN 系 TFLite）。模型文件是可选资源：
   * 先找 APK assets 的 modelAssetPath，再找应用文档目录的 modelDocFileName，
   * 都缺失则功能待命。分析是 best-effort：链接解析/解码/推理任一失败静默跳过。
   */
  audioFeature: {
    enabled: true,
    modelAssetPath: 'asset:///models/musiconn-discogs.tflite',
    modelDocFileName: 'musiconn-discogs.tflite',
    analyzeSeconds: 30,
    /** 两次分析的最小间隔（后台任务，避免抢网络/CPU）。 */
    minIntervalMs: 5 * 60 * 1000,
    dailyLimit: 20,
    embeddingLimit: 600,
    /** 歌单内已分析歌曲占比低于该值时不计算音频亲和度，避免小样本噪声。 */
    playlistMinCoverage: 0.3,
    /** 解码网络音频透传的请求头（部分源要求 UA）。 */
    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36' },
  },

  playlistScore: {
    weights: {
      affinity: 0.5,
      feedback: 0.3,
      exploration: 0.2,
    },
    feedbackHalfLifeDays: 30,
    explorationExposureScale: 4,
  },

  /**
   * 歌单反馈 P/N 的默认更新量。进度分档：<10s（或覆盖<15%）秒切重罚；
   * 15%-25% 轻罚；25%-45% 中性；45%-80% 轻奖；≥80% 完播重奖。
   */
  playlistFeedback: {
    like: 2,
    addToPlaylist: 1,
    listenOver80: 1.2,
    slightInterest: 0.6,
    slightInterestMinCoverage: 0.45,
    lowInterest: 0.5,
    lowInterestMaxCoverage: 0.25,
    dislike: 1,
    earlySkip: 1.5,
    earlySkipMaxSeconds: 10,
    earlySkipMaxCoverage: 0.15,
    fullSongMinSeconds: 60,
    coverageCompleteThreshold: 0.8,
    /** 同歌单多首不同歌曲持续负反馈后的临时冷却。 */
    cooldownMs: 30 * 60 * 1000,
    cooldownNegativeWeight: 0.75,
    legacyCooldownFactor: 0.25,
    /** 秒切软拉黑：首次 12h 冷却；再次秒切或负分累计超阈值拉黑 30 天；任意正反馈解除。 */
    instantSkipCooldownMs: 12 * 60 * 60 * 1000,
    instantSkipBanMs: 30 * 24 * 60 * 60 * 1000,
    instantSkipBanAfterSkips: 2,
    instantSkipBanNegativeWeight: 2,
    instantSkipCooldownFactor: 0.1,
    /** 导入来源歌单只记打折正反馈：电台推荐路径已有全额归因，避免一次喜欢记两次。 */
    importedOriginDiscount: 0.5,
  },

  /**
   * 分类（主题）级学习：歌单正/负反馈按系数折算到其所属分类。
   * negativeFactor 刻意大于 positiveFactor——"不感兴趣"要让整个分类明显降温。
   * affinityBias：主题净权重对歌单候选亲和力的乘性偏置幅度（±上限）。
   */
  themeFeedback: {
    positiveFactor: 0.6,
    negativeFactor: 1.5,
    halfLifeDays: 45,
    affinityBias: 0.6,
    /** 净权重绝对值超过该值即饱和到最大偏置。 */
    saturation: 4,
  },

  /**
   * 画像抽取：约 30 首代表歌曲，单歌手默认最多 3 首。
   */
  profile: {
    maxSeeds: 30,
    maxSeedsPerArtist: 3,
    maxSeedsPerDirection: 8,
    longTermWeight: 0.7,
    sessionWeight: 0.3,
    /** 三类画像证据的强度先验：我喜欢 > 自建歌单 > 最近听过。 */
    directionPrior: {
      love: 1,
      playlist: 0.8,
      track: 0.6,
    },
    /** "最近听过"这类证据的半衰期，超出后只保留下限权重。 */
    recentListenHalfLifeDays: 14,
    /** 画像门槛：代表歌曲或强歌手任一达标就脱离热榜冷启动。 */
    coldStart: {
      minProfileSeeds: 8,
      minStrongArtists: 5,
      /** 歌手权重达到最高歌手的 1/4 才算"强歌手"。 */
      strongArtistWeightRatio: 0.25,
    },
    weights: {
      like: 3,
      addToPlaylist: 2,
      complete: 1,
      repeat: 0.5,
      passivePlay: 0.2,
    },
  },

  /**
   * 外部候选池容量与每轮抓取预算。
   */
  candidatePool: {
    targetSize: 500,
    maxSize: 1500,
    /** 每轮最多为几个缺货语种桶抓歌单列表（各 1 次发现请求）。 */
    bucketFetchesPerRefresh: 1,
    /** 每个缺货桶取前几张歌单当摘要：第一张读到空歌单时靠下一张替补。 */
    bucketPlaylistsPerBucket: 2,
    /** 详情额度里为语种桶召回预留几格（从常规摘要份额里让）。 */
    bucketDetailReserve: 1,
    /** 池内 unknown 占比过高时预留位加到几格。 */
    bucketDetailReserveWhenUnknownHigh: 2,
    /** 触发上面这条扩容的 unknown 占比阈值。 */
    unknownShareEscalate: 0.3,
    playlistFetchTracks: 50,
    maxPagesPerPlaylist: 2,
    searchSeedsPerRefresh: 4,
    detailFetchesPerRefresh: 4,
    minCacheForInstantStart: 20,
    candidateTtlMs: 24 * 60 * 60 * 1000,
    similarPlaylistThreshold: 0.35,
    /** 分类歌单列表按 最新:最热 = 7:3 轮转，让小众新歌单出现得更多。 */
    newestListRatio: 0.7,
    /** 每轮直采的画像强歌手数（各搜一次热门歌，轮换不同歌手）。曾经取 2 人×15 首，单轮 30 首同批候选把池子带偏。 */
    artistHitsPerRefresh: 1,
    /** 淘汰限额相对"窗口目标数按池规模等比放大"再乘的宽松系数。低于 1 会被抬到 1：再紧就会把某语种在池里清零、直接断供。 */
    poolEvictOverQuotaSlack: 1.5,
  },

  /**
   * 歌手语言表（spec §3.1 L3/§9）。表只存归一化歌手名→单一分桶，
   * artistTableLimit：容量，超出按"得票最低、最久没再听见"淘汰；
   * saveDebounceMs：换歌很频繁，观察合并成批写。
   */
  language: {
    artistTableLimit: 500,
    saveDebounceMs: 20000,
    /** 本轮上限相对缺口多给的余量（首）。只允许向下收紧，不回溯删除已排进队列的曲目。 */
    capTolerance: 1,
    /** 同一种语言最多连播几首（硬规则，配额放开档也守）。 */
    maxConsecutiveSameLang: 2,
    /** 纯音乐在 20 首窗口里的上限；不占语言名额。 */
    instrumentalPerWindow: 2,
  },

  exclusions: {
    /** 最近 7 天电台已播歌曲不再作为候选。 */
    recentRadioDays: 7,
  },

  /**
   * 最终排队阶段的强约束。
   */
  antiRepeat: {
    artistGap: 8,
    sameArtistInLast30: 2,
    samePlaylistInLast20: 2,
    sameAlbumInLast20: 2,
    sameSeedInLast20: 2,
    sameChartInLast20: 3,
    similarGroupRatioIn20: 0.4,
    /** 同一作品不同版本（Live/Remix 等）在最近 20 首内再次入选时的软降频系数。 */
    variantSoftFactor: 0.4,
    /** 分类轮换的 softmax 温度：越小越只顾高权重分类，越大越均匀。 */
    categoryRotationTemperature: 1.2,
    /** 相邻两个探索通道（C/D）曲目之间至少要隔多少首非探索曲目，防止连续 unfamiliar。 */
    explorationGap: 1,
    /** 候选不足时放宽歌手间隔的阶梯表；本表值下限 4 首，即档位 0~3 里同歌手至少隔 4 首，末档不受本表约束、可松到下面的 minArtistGap。阶梯并不按顺序读它：只有 [1]（值 6）喂档位 2、[2]（值 4）喂档位 3，[0] 目前没有档位引用；末档不取本数组，直读 minArtistGap。 */
    relaxArtistGaps: [8, 6, 4],
    /** 最后一档（所有候选都满足不了间隔时）也保持的最小间隔；0 会直接造成同歌手连推。diversity.ts 的阶梯末档直读它；取值不得大于 relaxArtistGaps 的末值，否则阶梯越放宽越宽——这条护栏钉在 tests/recommend-algorithm.mts 的 "artist relaxation never dips below the four-song floor before the last rung" 用例里。 */
    minArtistGap: 2,
    /** 抽样软惩罚：同歌手出现在最近 N 首内时权重乘该系数（硬门槛之外的第二道闸）。
     * 调这两个窗口/系数的自动化护栏是 recommend-algorithm.mts 里"两个歌手都等到末档"那条用例：
     * 两个候选同时卡在 sameArtistInLast30、基础分又都过质量闸门时，档位差就是唯一决定因素，
     * 所以"近侧必须比中间档更狠"和窗口边界都能被钉红（实测 0.35→0.6、窗口 6→4、6→12 都让它变红）。
     * 钉不住的只有 0.35 这个强度本身合不合适——那半截只认真机观感。 */
    recentArtistWindow: 6,
    recentArtistFactor: 0.35,
    midArtistWindow: 12,
    midArtistFactor: 0.6,
    relaxSameArtistInLast30: 6,
    relaxSamePlaylistInLast20: 4,
    relaxSameAlbumInLast20: 4,
    relaxSimilarGroupRatioIn20: 0.7,
  },

  ingest: {
    /** 一次超过该数量的收藏/入单视为批量导入（画像数据更新），不逐首计显式反馈。 */
    maxTracksPerExplicitBatch: 5,
  },

  softmax: {
    temperature: 0.6,
    /** 安全模式（连续负反馈）下降低温度，更偏向高分候选。 */
    safeModeTemperature: 0.35,
    /**
     * 抽样前的相对质量门槛：同通道内低于最高分 × 该比例的候选不参与抽样，
     * 防止大量低分候选靠数量压过少量高分候选；过滤后为空时回退到未过滤集合。
     */
    qualityGateRatio: 0.6,
    minWeight: 1e-4,
    /** 温度越高越随机；0 表示退化为取最高分。 */
    minTemperature: 0.05,
    maxTemperature: 2,
  },

  queue: {
    targetSize: 20,
  },

  /**
   * 电台模式的"偏熟悉"约束：探索额度封顶、相邻探索曲目之间至少隔这么多首非探索曲目。
   * 只作用于 radio 模式；探索未知卡主打撞新，不受此约束。
   */
  radioExploration: {
    factorCap: 0.6,
    gap: 2,
  },

  /**
   * 时段画像（轻量版）：从播放历史按"当前时段"聚合歌手正负信号。
   * positiveMinCoverage/negativeMaxCoverage 与结算语义一致（完播≥0.8 算正、早切<0.3 算负）。
   */
  timeSlot: {
    morningStart: 5,
    afternoonStart: 11,
    eveningStart: 17,
    positiveMinCoverage: 0.8,
    negativeMaxCoverage: 0.3,
    minSamples: 4,
    factorCeiling: 1.12,
    factorFloor: 0.9,
  },

  /**
   * 闲置深度巡捞：池子低于目标且距上次抓取足够久时，用加倍预算补池。
   * 用户探索偏好（三档）之外的自动补池，不阻塞播放（异步单飞）。
   */
  idleCrawl: {
    minIntervalMs: 30 * 60 * 1000,
    budgetMultiplier: 2,
  },

  /**
   * 画像反馈补池：赞/踩/收藏/完播等反馈累计到阈值后，按新画像异步补一轮候选。
   * 阈值太小时每首歌都重抓，太大则偏好已经变了池子还是旧的；冷却用于合并连续反馈。
   */
  profileRefresh: {
    revisionThreshold: 8,
    minIntervalMs: 15 * 60 * 1000,
    budget: 6,
  },

  /**
   * 相似歌手通道 E（MB 检索 → LB 相似 → MB 规范名 → kg 搜歌）。
   * budgetPerRun 计入每轮总请求预算，不是额外额度；歌单召回永远先花，剩不足 minBudget 时整条链路跳过。
   * MB/LB 全局 1 req/s 串行（实测超限直接 503 busy），所以一条 8 请求的链路必然跨刷新续跑。
   */
  similarArtist: {
    budgetPerRun: 4,
    minBudget: 2,
    /** 每 3 次刷新起 1 位新种子歌手；在途任务优先续跑。 */
    seedIntervalRefreshes: 3,
    /** LB 前 N 位做 MB 规范名反查（LB 的名字繁简/拉丁混排，不能直接拿来搜歌）。 */
    aliasLookups: 3,
    /** 每轮最多给几位相似歌手搜歌。 */
    songFetchesPerRun: 3,
    songsPerArtist: 8,
    cacheLimit: 200,
    cacheTtlMs: 30 * 24 * 60 * 60 * 1000,
    /** 同一批相似歌手刚搜过歌后，冷却期内不再重复花 kg 请求。 */
    cacheReuseCooldownMs: 6 * 60 * 60 * 1000,
    minRequestIntervalMs: 1000,
    requestTimeoutMs: 12000,
  },

  session: {
    recentTracksLimit: 20,
  },

  /**
   * 会话健康度：用最近曲目的早切/低完成度/不喜欢信号做"连击"检测，
   * 连续不合胃口时收缩探索额度、给来源歌手/歌单降分，并触发安全模式清队重建。
   */
  sessionHealth: {
    /** 连续 N 个负反馈触发安全模式（撤下已排队的高风险曲目并转画像优先）。 */
    streakThreshold: 2,
    /** 观察窗口：参与统计的最近曲目数。 */
    window: 10,
    /** 听完比例低于该值视为负反馈（liked / 在库 disliked 优先判定）。 */
    negativeListenRatio: 0.3,
    /** C/D 通道负反馈占比达到该值起开始收缩探索额度。 */
    explorationThrottleStart: 0.34,
    /** 占比达到该值时收缩到下限。 */
    explorationThrottleEnd: 0.67,
    /** 探索额度收缩下限：保留撞新能力，不彻底关死。 */
    explorationFactorFloor: 0.25,
    /** C/D 观察样本不足该数时，用总体负反馈率代替。 */
    minExplorationSamples: 3,
    /** 安全模式熔断最小间隔，防止连续快切反复清队。 */
    safeModeCooldownMs: 60_000,
    /** 单次熔断最多撤下的已排队曲目数。 */
    maxDeferralsPerTrigger: 10,
    /** 撤队阈值：歌手/歌单惩罚权重达到该值才从队列移除（低于只降分不撤队）。 */
    deferPenaltyThreshold: 1.8,
    /** 会话负反馈对候选打分的乘性惩罚强度（factor = 1/(1+w*p)）。 */
    artistPenaltyWeight: 0.6,
    playlistPenaltyWeight: 0.4,
    /** 越靠前的负反馈权重越高，按该系数逐位衰减。 */
    penaltyRecencyDecay: 0.85,
    /** 单歌手/歌单惩罚上限，一次坏体验不封死来源。 */
    penaltyCap: 3,
    /** 连续 N 首正反馈（完播/喜欢）后临时放大探索额度——听得开心时多撞新。 */
    positiveStreakThreshold: 3,
    /** 正反馈连击下的探索额度上限（>1，与负反馈收缩共用一个通道缩放入口）。 */
    positiveExplorationBoost: 1.25,
  },

  /**
   * 长期歌手先验：与歌名 token 学习同构，但按歌手归因且半衰期更长。
   * 历史上总被切的歌手持续降权（会话惩罚只看最近 10 首，先验管"一直"）。
   */
  artistPrior: {
    halfLifeDays: 45,
    maxWeight: 8,
    likePositive: 1,
    addToPlaylistPositive: 1,
    dislikeNegative: 2,
    completePositive: 0.5,
    earlySkipNegative: 0.5,
    positiveFactor: 0.1,
    negativeFactor: 0.25,
    floor: 0.55,
    ceiling: 1.15,
  },

  similarity: {
    /** 共现贡献的热门阻尼指数。 */
    popularityDamping: 1,
    /** 单个候选跨多个歌单的共现贡献饱和上限（相对单歌单贡献的倍数）。 */
    maxMultiPlaylistBoost: 2.5,
  },


  storage: {
    recentlyPlayedLimit: 100,
    /** 独立电台播放记录容量与保留期。 */
    radioHistoryLimit: 500,
    radioHistoryRetentionMs: 30 * 24 * 60 * 60 * 1000,
    playlistObservationLimit: 100,
    observedTrackIndexLimit: 20000,
    candidateCacheLimit: 1500,
    feedbackLedgerLimit: 2000,
    trackPreferenceLimit: 5000,
    exposureCountLimit: 5000,
    dislikedTrackLimit: 2000,
    themeWeightLimit: 200,
    artistStatsLimit: 800,
    saveDebounceMs: 1500,
    candidateSaveDebounceMs: 10000,
  },

  request: {
    timeoutMs: 12000,
    retryCount: 2,
    backoffBaseMs: 400,
    backoffMaxMs: 5000,
    sourceCooldownMs: 60 * 1000,
    /** 一轮抓取总请求数 = 发现 10（歌单搜索4 + 歌手直采2 + 标签/列表2 + 榜单2）+ 歌单详情 4。 */
    maxRequestsPerRefresh: 14,
  },
}

export type RecommendationConfig = typeof recommendationConfig
