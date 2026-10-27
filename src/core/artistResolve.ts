import musicSdk from '@/utils/musicSdk'
import { getArtistSearchName, pickExactArtistMatch } from './musicLinks'
import type { ArtistSearchItem, ArtistSource } from '@/utils/musicSdk/artistNormalizers'

type ArtistSearchFn = (
  text: string,
  page?: number,
  limit?: number,
) => Promise<{ list?: ArtistSearchItem[] } | null | undefined>

const cache = new Map<string, ArtistSearchItem>()
const pending = new Map<string, Promise<ArtistSearchItem | null>>()

const getSearchFn = (source: ArtistSource): ArtistSearchFn | undefined => {
  const sdk = musicSdk as unknown as Record<string, { artist?: { search?: ArtistSearchFn } }>
  return sdk[source]?.artist?.search
}

export const findArtistByName = async(source: ArtistSource, name: string): Promise<ArtistSearchItem | null> => {
  const keyword = name.trim()
  if (!keyword) return null
  const key = `${source}::${keyword}`
  const cached = cache.get(key)
  if (cached) return cached
  const running = pending.get(key)
  if (running) return running

  const search = getSearchFn(source)
  if (!search) return null

  const task = (async() => {
    try {
      const result = await search(keyword, 1, 10)
      const item = pickExactArtistMatch(result?.list ?? [], keyword)
      if (!item) return null
      cache.set(key, item)
      return item
    } catch {
      cache.delete(key)
      return null
    } finally {
      pending.delete(key)
    }
  })()
  pending.set(key, task)
  return task
}

export const resolveArtistBySources = async(
  sources: readonly ArtistSource[],
  name: string,
): Promise<ArtistSearchItem | null> => {
  for (const source of sources) {
    const item = await findArtistByName(source, name)
    if (item) return item
  }
  return null
}

export const resolveArtistForMusic = async(
  music: { source: LX.Source, singer: string },
): Promise<ArtistSearchItem | null> => {
  if (music.source == 'local') return null
  const name = getArtistSearchName(music.singer)
  if (!name) return null
  return findArtistByName(music.source, name)
}
