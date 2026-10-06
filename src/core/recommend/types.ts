export type ChannelId = 'A' | 'B' | 'C' | 'D'

/** 电台模式：radio 按画像推荐，explore 主打低曝光与榜单。 */
export type RadioMode = 'radio' | 'explore'

export const CHANNEL_IDS: readonly ChannelId[] = ['A', 'B', 'C', 'D']

export type PlayEndReason =
  | 'natural_end'
  | 'user_next'
  | 'user_select_other'
  | 'dislike'
  | 'play_error'
  | 'load_error'
  | 'app_destroy'
  | 'radio_switch'
  | 'unknown'

export type CandidateSource = 'related' | 'chart'

/** 通道配额 bandit 的一个臂：alpha=正反馈计数，beta=负反馈计数。 */
export interface ChannelBanditArm {
  alpha: number
  beta: number
  lastUpdatedAt: number
}

export type ChannelBandit = Partial<Record<ChannelId, ChannelBanditArm>>

/** 量化后的音频风格嵌入：int8 + per-vector scale，base64 存储。 */
export interface AudioEmbedding {
  q: string
  scale: number
  dim: number
  modelId: string
  analyzedAt: number
}

export interface TrackPreference {
  trackKey: string
  score: number
  playCount: number
  completeCount: number
  skipCount: number
  earlySkipCount: number
  likeCount: number
  dislikeCount: number
  repeatCount: number
  addToPlaylistCount: number
  averageListenRatio: number
  exposureCount: number
  lastPlayTime: number
  lastPositiveTime?: number
  lastNegativeTime?: number
  lastExposureTime?: number
}

/** 歌单分类（主题）级反馈学习：喜欢为所属分类加分，不感兴趣让整个分类降权。 */
export interface ThemePreference {
  themeId: string
  positiveWeight: number
  negativeWeight: number
  lastDecayTime: number
  lastUsedTime: number
}

export interface PlaylistPreference {
  playlistId: string
  score: number
  positiveCount: number
  negativeCount: number
  /** 30 天半衰期衰减后的正反馈权重，用于歌单反馈质量公式。 */
  positiveWeight: number
  /** 30 天半衰期衰减后的负反馈权重。 */
  negativeWeight: number
  /** 上一次衰减计算时间。 */
  lastDecayTime: number
  exposureCount: number
  consecutiveNegativeCount: number
  lastUsedTime: number
  lastNegativeTrackKey?: string
  distinctNegativeTracks?: number
  cooldownUntil?: number
}

export interface SessionTrack {
  trackKey: string
  timestamp: number
  listenRatio?: number
  liked?: boolean
  source?: CandidateSource
  channel?: ChannelId
  sourcePlaylistId?: string
  sourceSeedTrackKey?: string
  sourceClusterId?: string
  sourceChartId?: string
  /** 会话负反馈惩罚需要按歌手归因，结算时冗余记录。 */
  artistKeys?: string[]
}

export interface SessionPreference {
  recentTracks: SessionTrack[]
  recentChannels: ChannelId[]
}
export interface RadioPlayRecord {
  playId: string
  trackKey: string
  channel?: ChannelId
  sourcePlaylistId?: string
  sourceSeedTrackKey?: string
  sourceClusterId?: string
  sourceChartId?: string
  platform?: string
  startedAt: number
  endedAt?: number
  intervals: Array<{ from: number, to: number }>
  listenedMs: number
  wallClockMs: number
  durationMs?: number
  coverage: number
  endReason?: PlayEndReason
  /** 开始播放时的歌名 token 快照，供词面级学习归因。 */
  nameTokens?: string[]
  /** 开始播放时的参与歌手快照，供长期歌手先验归因。 */
  artistKeys?: string[]
  explicitLike?: boolean
  explicitDislike?: boolean
  addToPlaylistListId?: string
  completed?: boolean
  settled?: boolean
  settlementReasons?: string[]
  seekedToEnd?: boolean
}

export interface ObservedPlaylist {
  id: string
  source: LX.OnlineSource
  name?: string
  author?: string
  desc?: string
  category?: string
  playCount?: number | null
  totalTracks?: number
  fetchedTracks: string[]
  pagesFetched: number
  seedOverlap: number
  seedTrackKeys: string[]
  coverage: number
  confidence: number
  groupId?: string
  weakThemeScore: number
  firstSeenAt: number
  lastFetchedAt: number
  confirmed: boolean
}

export interface TrackPlaylistIndexEntry {
  playlistIds: string[]
  updatedAt: number
}
export interface PoolCandidate {
  trackKey: string
  musicInfo: LX.Music.MusicInfoOnline
  channels: ChannelId[]
  channelSourceId: Partial<Record<ChannelId, string>>
  playlistIds: string[]
  seedTrackKeys: string[]
  groupIds: string[]
  chartId?: string
  chartRank?: number
  publishedTime?: number
  playCount?: number | null
  affinity: number
  coOccurrence: number
  exploration: number
  localFrequency: number
  observedPlaylistFrequency: number
  exposureCount: number
  albumKey: string
  artistKeys: string[]
  primaryArtist: string
  addedAt: number
  confirmedSeedPlaylist: boolean
  reasons: string[]
}

export interface RecommendationState {
  version: number
  tracks: Record<string, TrackPreference>
  playlists: Record<string, PlaylistPreference>
  themeWeights: Record<string, ThemePreference>
  trackPlaylists: Record<string, string[]>
  dislikedTracks: Record<string, number>
  recentlyPlayed: Array<{ trackKey: string, timestamp: number }>
  session: SessionPreference
  radioHistory: RadioPlayRecord[]
  settledPlayIds: Record<string, {
    timestamp: number
    trackReward: number
    playlistPositive: number
    playlistNegative: number
    explicitNegative?: boolean
    explicitLike?: boolean
    explicitAdd?: boolean
    explicitRepeat?: boolean
    completion?: boolean
    earlySkip?: boolean
    banditCounted?: boolean
  }>
  observedPlaylists: Record<string, ObservedPlaylist>
  trackPlaylistIndex: Record<string, TrackPlaylistIndexEntry>
  candidateCache: PoolCandidate[]
  candidateCacheFetchedAt: number
  sourceCooldowns: Record<string, number>
  exposureCounts: Record<string, number>
  /** 歌名 token 级正负反馈（DJ版/Live/翻唱、风格词等），词面学习的存储。 */
  tokenWeights: Record<string, ThemePreference>
  /** 通道配额 bandit 计数。 */
  channelBandit: ChannelBandit
  /** 长期歌手先验（完播/切歌的歌手级统计），key 为归一化歌手名。 */
  artistStats: Record<string, ThemePreference>
  /** 音频风格嵌入（int8 量化），按 trackKey 索引。 */
  audioEmbeddings: Record<string, AudioEmbedding>
  /** 音频分析每日节流元数据。 */
  audioAnalysis: { dayKey: string, dayCount: number, lastRunAt: number }
}
export interface InterestDirection {
  directionId: string
  kind: 'love' | 'playlist' | 'track'
  name?: string
  playlistId?: string
  tracks: ProfileSeedTrack[]
  weight: number
  artistKeys: string[]
}

export interface ProfileSeedTrack {
  trackKey: string
  musicInfo: LX.Music.MusicInfo
  artistKeys: string[]
  primaryArtist: string
  longTermScore: number
  sessionScore: number
  score: number
  directionId: string
  fromLike: boolean
  fromAddToPlaylist: boolean
  fromPassiveComplete: boolean
}

export interface RadioProfile {
  directions: InterestDirection[]
  seeds: ProfileSeedTrack[]
  seedKeys: Set<string>
  topArtists: Array<{ artist: string, weight: number }>
  updatedAt: number
}
export interface RecommendQueueItem {
  musicInfo: LX.Music.MusicInfoOnline
  source: CandidateSource
  channel: ChannelId
  sourcePlaylistId?: string
  sourceSeedTrackKey?: string
  sourceClusterId?: string
  sourceChartId?: number
  batchId: number
  playId?: string
  /** 人类可读的入选线索（如 artist_hits:周杰伦），供推荐理由展示。 */
  reason?: string
}
