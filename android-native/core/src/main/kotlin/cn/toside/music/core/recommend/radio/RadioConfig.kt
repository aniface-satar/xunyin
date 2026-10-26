package cn.toside.music.core.recommend.radio

/**
 * 电台 M2 配置 —— RN `core/recommend/config.ts` 中与 M2 引擎有关的逐值移植。
 * M3 专属项（audioFeature / embedding / similarity / diversity / language）不在此列。
 */
object RadioConfig {
    object Behavior {
        const val LIKE = 6.0
        const val ADD_TO_PLAYLIST = 7.0
        const val DISLIKE = -8.0
        const val REPEAT = 4.0
        const val COMPLETE = 1.5
        const val EARLY_SKIP = -2.0
    }

    object Channels {
        const val WINDOW_SIZE = 20
        const val EXPLORATION_AFFINITY_FLOOR = 0.55

        val TARGET_PER_WINDOW: Map<ChannelId, Int> =
            mapOf(ChannelId.A to 7, ChannelId.B to 5, ChannelId.C to 4, ChannelId.D to 2, ChannelId.E to 2)
        val EXPLORE_TARGET_PER_WINDOW: Map<ChannelId, Int> =
            mapOf(ChannelId.A to 3, ChannelId.B to 1, ChannelId.C to 9, ChannelId.D to 7, ChannelId.E to 0)
        val FALLBACK_ORDER: List<ChannelId> = listOf(ChannelId.A, ChannelId.C, ChannelId.B, ChannelId.D, ChannelId.E)
        val EXPLORE_FALLBACK_ORDER: List<ChannelId> = listOf(ChannelId.C, ChannelId.D, ChannelId.A, ChannelId.B)
        val COLD_START_FALLBACK_ORDER: List<ChannelId> = listOf(ChannelId.C, ChannelId.D, ChannelId.A)
    }

    object Bandit {
        const val PRIOR_ALPHA = 1.0
        const val PRIOR_BETA = 1.0
        const val MIN_OBSERVATIONS = 5.0
        const val MIN_BOOST = 0.5
        const val MAX_BOOST = 1.5
        const val HALF_LIFE_DAYS = 30.0
        const val MAX_COUNT = 24.0
    }

    /** 词面 token 学习增量（M1 只移植了读侧因子，写侧增量属于电台结算）。 */
    object NameTokenFeedback {
        const val LIKE_POSITIVE = 0.5
        const val ADD_TO_PLAYLIST_POSITIVE = 0.5
        const val DISLIKE_NEGATIVE = 1.0
        const val COMPLETE_POSITIVE = 0.25
        const val EARLY_SKIP_NEGATIVE = 0.5
    }

    /** 长期歌手先验增量（同 M1 读侧因子配套的写侧）。 */
    object ArtistPriorFeedback {
        const val LIKE_POSITIVE = 1.0
        const val ADD_TO_PLAYLIST_POSITIVE = 1.0
        const val DISLIKE_NEGATIVE = 2.0
        const val COMPLETE_POSITIVE = 0.5
        const val EARLY_SKIP_NEGATIVE = 0.5
    }

    object PlaylistFeedback {
        const val LIKE = 2.0
        const val ADD_TO_PLAYLIST = 1.0
        const val LISTEN_OVER_80 = 1.2
        const val SLIGHT_INTEREST = 0.6
        const val SLIGHT_INTEREST_MIN_COVERAGE = 0.45
        const val LOW_INTEREST = 0.5
        const val LOW_INTEREST_MAX_COVERAGE = 0.25
        const val DISLIKE = 1.0
        const val EARLY_SKIP = 1.5
        const val EARLY_SKIP_MAX_SECONDS = 10.0
        const val EARLY_SKIP_MAX_COVERAGE = 0.15
        const val FULL_SONG_MIN_SECONDS = 60.0
        const val COVERAGE_COMPLETE_THRESHOLD = 0.8
        const val COOLDOWN_MS = 30 * 60 * 1000L
        const val COOLDOWN_NEGATIVE_WEIGHT = 0.75
        const val LEGACY_COOLDOWN_FACTOR = 0.25
        const val INSTANT_SKIP_COOLDOWN_MS = 12 * 60 * 60 * 1000L
        const val INSTANT_SKIP_BAN_MS = 30L * 24 * 60 * 60 * 1000
        const val INSTANT_SKIP_BAN_AFTER_SKIPS = 2
        const val INSTANT_SKIP_BAN_NEGATIVE_WEIGHT = 2.0
        const val INSTANT_SKIP_COOLDOWN_FACTOR = 0.1
        const val IMPORTED_ORIGIN_DISCOUNT = 0.5
        const val FEEDBACK_HALF_LIFE_DAYS = 30.0
    }

    object ThemeFeedback {
        const val POSITIVE_FACTOR = 0.6
        const val NEGATIVE_FACTOR = 1.5
        const val AFFINITY_BIAS = 0.6
        const val SATURATION = 4.0
    }

    object SessionHealth {
        const val STREAK_THRESHOLD = 2
        const val WINDOW = 10
        const val NEGATIVE_LISTEN_RATIO = 0.3
        const val EXPLORATION_THROTTLE_START = 0.34
        const val EXPLORATION_THROTTLE_END = 0.67
        const val EXPLORATION_FACTOR_FLOOR = 0.25
        const val MIN_EXPLORATION_SAMPLES = 3
        const val SAFE_MODE_COOLDOWN_MS = 60_000L
        const val MAX_DEFERRALS_PER_TRIGGER = 10
        const val DEFER_PENALTY_THRESHOLD = 1.8
        const val ARTIST_PENALTY_WEIGHT = 0.6
        const val PLAYLIST_PENALTY_WEIGHT = 0.4
        const val PENALTY_RECENCY_DECAY = 0.85
        const val PENALTY_CAP = 3.0
        const val POSITIVE_STREAK_THRESHOLD = 3
        const val POSITIVE_EXPLORATION_BOOST = 1.25
    }

    object RadioExploration {
        const val FACTOR_CAP = 0.6
        const val GAP = 2
    }

    object Softmax {
        const val TEMPERATURE = 0.6
        const val SAFE_MODE_TEMPERATURE = 0.35
        const val QUALITY_GATE_RATIO = 0.6
        const val MIN_WEIGHT = 1e-4
    }

    object CandidatePool {
        const val TARGET_SIZE = 500
        const val MAX_SIZE = 1500
        const val MIN_CACHE_FOR_INSTANT_START = 20
        const val CANDIDATE_TTL_MS = 24L * 60 * 60 * 1000
        const val DETAIL_FETCHES_PER_REFRESH = 4

        /**
         * 池子按语种配额淘汰时的宽松系数（RN `candidatePool.poolEvictOverQuotaSlack`）：
         * 淘汰是慢变量（下次抓取才能补货），卡太死会让某语种突然断供。
         */
        const val POOL_EVICT_OVER_QUOTA_SLACK = 1.5
    }

    /** 闲置深度巡捞：池子低于目标且距上次抓取足够久时，用加倍预算补池（不阻塞播放）。 */
    object IdleCrawl {
        const val MIN_INTERVAL_MS = 30L * 60 * 1000
        const val BUDGET_MULTIPLIER = 2
    }

    /** 画像反馈补池：反馈累计到阈值后按新画像异步补一轮候选。 */
    object ProfileRefresh {
        const val REVISION_THRESHOLD = 8
        const val MIN_INTERVAL_MS = 15L * 60 * 1000
        const val BUDGET = 6
    }

    object Queue {
        const val TARGET_SIZE = 20
    }

    object Storage {
        const val RECENTLY_PLAYED_LIMIT = 60
        const val RADIO_HISTORY_LIMIT = 500
        const val RADIO_HISTORY_RETENTION_MS = 30L * 24 * 60 * 60 * 1000
        const val DISLIKED_TRACK_LIMIT = 2000
        const val FEEDBACK_LEDGER_LIMIT = 2000
        const val TRACK_PREFERENCE_LIMIT = 5000
        const val EXPOSURE_COUNT_LIMIT = 5000
        const val THEME_WEIGHT_LIMIT = 200
        const val ARTIST_STATS_LIMIT = 800
    }

    object Session {
        const val RECENT_TRACKS_LIMIT = 20
    }

    object Profile {
        const val MIN_PROFILE_SEEDS = 8
        const val MIN_STRONG_ARTISTS = 5
        const val STRONG_ARTIST_WEIGHT_RATIO = 0.25
    }

    object Request {
        const val TIMEOUT_MS = 12_000L
        const val RETRY_COUNT = 2
        const val BACKOFF_BASE_MS = 400L
        const val BACKOFF_MAX_MS = 5000L
        const val SOURCE_COOLDOWN_MS = 60_000L
        const val MAX_REQUESTS_PER_REFRESH = 14
    }

    object Exclusions {
        const val RECENT_RADIO_DAYS = 7
    }
}
