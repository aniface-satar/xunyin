import { recommendationConfig } from './config.ts'
import { createThemePreference } from './feedback.ts'
import { normalizeText } from './trackKey.ts'
import type { ThemePreference } from './types.ts'

/**
 * 首次进入推荐页的偏好问卷：纯数据与纯函数。
 * 选项 id 是持久化键（onboarding.weights），标签文案在 lang（recommend_onboarding_opt_<id>）。
 * aliases[0] 为规范词（进关键词池做包含匹配），全量 aliases 归一化后作为 themeWeights 的精确键——
 * 各音源分类目录叫法不一（欧美/英文/西洋），多别名各占一键，同名 tag 才会吃到净权。
 */

export type OnboardingQuestion = 'language' | 'genre'

export type OnboardingOptionId =
  | 'zh' | 'cantonese' | 'western' | 'ja' | 'ko' | 'other'
  | 'pop' | 'rock' | 'folk' | 'rnb' | 'hiphop' | 'electronic' | 'gufeng' | 'acg'
  | 'light' | 'jazz' | 'blues' | 'metal' | 'punk' | 'country' | 'latin' | 'dj'

export interface OnboardingOption {
  id: OnboardingOptionId
  question: OnboardingQuestion
  aliases: string[]
}

export const ONBOARDING_OPTIONS: readonly OnboardingOption[] = [
  { id: 'zh', question: 'language', aliases: ['华语', '国语', '中文', '内地'] },
  { id: 'cantonese', question: 'language', aliases: ['粤语', '广东歌'] },
  { id: 'western', question: 'language', aliases: ['欧美', '英文', '英语', '西洋'] },
  { id: 'ja', question: 'language', aliases: ['日语', '日文', '日本'] },
  { id: 'ko', question: 'language', aliases: ['韩语', '韩国', 'KPOP'] },
  { id: 'other', question: 'language', aliases: ['小语种', '俄语', '法语', '德语'] },
  { id: 'pop', question: 'genre', aliases: ['流行'] },
  { id: 'rock', question: 'genre', aliases: ['摇滚', 'ROCK'] },
  { id: 'folk', question: 'genre', aliases: ['民谣'] },
  { id: 'rnb', question: 'genre', aliases: ['R&B', '节奏布鲁斯', '灵魂'] },
  { id: 'hiphop', question: 'genre', aliases: ['说唱', '嘻哈', 'HIPHOP', 'RAP'] },
  { id: 'electronic', question: 'genre', aliases: ['电子', 'EDM', '舞曲', 'DJ'] },
  { id: 'gufeng', question: 'genre', aliases: ['古风', '国风', '中国风'] },
  { id: 'acg', question: 'genre', aliases: ['二次元', 'ACG', '动漫'] },
  { id: 'light', question: 'genre', aliases: ['轻音乐', '纯音乐'] },
  { id: 'jazz', question: 'genre', aliases: ['爵士', 'JAZZ'] },
  { id: 'blues', question: 'genre', aliases: ['蓝调', '布鲁斯', 'BLUES'] },
  { id: 'metal', question: 'genre', aliases: ['金属', 'METAL'] },
  { id: 'punk', question: 'genre', aliases: ['朋克', 'PUNK'] },
  { id: 'country', question: 'genre', aliases: ['乡村', 'COUNTRY'] },
  { id: 'latin', question: 'genre', aliases: ['拉丁', 'LATIN'] },
  { id: 'dj', question: 'genre', aliases: ['DJ', 'REMIX', '串烧'] },
]

/** 只留合法 id，钳到 0-100 并取整到 10 的倍数，0 值删除。 */
export const sanitizeWeights = (weights: Record<string, number>): Record<string, number> => {
  const result: Record<string, number> = {}
  for (const option of ONBOARDING_OPTIONS) {
    const raw = weights[option.id]
    if (typeof raw != 'number' || !Number.isFinite(raw)) continue
    const percent = Math.round(Math.max(0, Math.min(100, raw)) / 10) * 10
    if (percent > 0) result[option.id] = percent
  }
  return result
}

const seedValueFor = (percent: number) => percent / 100 * recommendationConfig.themeFeedback.saturation

/** optionId→百分比 映射成 themeWeights 键→初值分量；同键多选项命中取 max。 */
export const computeSeedWeights = (weights: Record<string, number>): Record<string, number> => {
  const seeds: Record<string, number> = {}
  for (const option of ONBOARDING_OPTIONS) {
    const percent = weights[option.id]
    if (!percent) continue
    for (const alias of option.aliases) {
      const key = normalizeText(alias)
      if (!key) continue
      seeds[key] = Math.max(seeds[key] ?? 0, seedValueFor(percent))
    }
  }
  return seeds
}

/** 把初值分量加进分类净权的正反馈侧；直接改动传入 map（与状态存储共享引用）。 */
export const applySeedWeights = (
  themes: Record<string, ThemePreference>,
  seeds: Record<string, number>,
  now = Date.now(),
): void => {
  for (const [key, seed] of Object.entries(seeds)) {
    const base = themes[key] ?? createThemePreference(key, now)
    themes[key] = { ...base, positiveWeight: base.positiveWeight + seed, lastUsedTime: now }
  }
}

/** 只回退记录在案的初值分量：减后钳 0，正负皆 0 才删条目，用户反馈净权保留。 */
export const revokeSeedWeights = (
  themes: Record<string, ThemePreference>,
  seeds: Record<string, number>,
): void => {
  for (const [key, seed] of Object.entries(seeds)) {
    const pref = themes[key]
    if (!pref) continue
    const positiveWeight = Math.max(0, pref.positiveWeight - seed)
    if (positiveWeight == 0 && pref.negativeWeight == 0) delete themes[key]
    else themes[key] = { ...pref, positiveWeight }
  }
}

const MIN_KEYWORD_PERCENT = 20

/** 进关键词池的规范词：≥20% 才贡献，按百分比降序（rotation 窗口从强偏好起滑）。 */
export const computePreferenceKeywords = (weights: Record<string, number>): string[] => {
  return ONBOARDING_OPTIONS
    .filter(option => (weights[option.id] ?? 0) >= MIN_KEYWORD_PERCENT)
    .sort((a, b) => (weights[b.id] ?? 0) - (weights[a.id] ?? 0))
    .map(option => normalizeText(option.aliases[0]))
    .filter(Boolean)
}

export const mergePreferenceKeywords = (
  profileKeywords: readonly string[],
  preferenceKeywords: readonly string[],
): string[] => [...new Set([...preferenceKeywords, ...profileKeywords])]
