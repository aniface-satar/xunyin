/* eslint-disable require-atomic-updates */
import { getData, saveData, removeData } from '@/plugins/storage'
import { recommendationConfig } from './config.ts'
import type { PoolCandidate } from './types.ts'

const CANDIDATE_CACHE_KEY = 'xunyin_recommend_candidates_v2'

let cache: PoolCandidate[] | null = null

export const loadCandidateCache = async(): Promise<PoolCandidate[]> => {
  if (cache) return cache
  try {
    // eslint-disable-next-line require-atomic-updates
    const loaded = await getData<PoolCandidate[]>(CANDIDATE_CACHE_KEY)
    cache = Array.isArray(loaded) ? loaded : []
  } catch {
    cache = []
  }
  return cache
}

export const getCandidateCache = (): PoolCandidate[] => cache ?? []

export const setCandidateCache = (candidates: PoolCandidate[]) => {
  cache = candidates.slice(0, recommendationConfig.storage.candidateCacheLimit)
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

export const saveCandidateCache = (candidates?: PoolCandidate[]) => {
  if (candidates) setCandidateCache(candidates)
  if (!cache) return
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (!cache) return
    void saveData(CANDIDATE_CACHE_KEY, cache.slice(0, recommendationConfig.storage.candidateCacheLimit)).catch(() => {})
  }, recommendationConfig.storage.candidateSaveDebounceMs)
}

export const saveCandidateCacheNow = async() => {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!cache) return
  await saveData(CANDIDATE_CACHE_KEY, cache.slice(0, recommendationConfig.storage.candidateCacheLimit)).catch(() => {})
}

export const clearCandidateCache = async() => {
  cache = []
  await removeData(CANDIDATE_CACHE_KEY).catch(() => {})
}

export const getCandidateCacheKey = () => CANDIDATE_CACHE_KEY
