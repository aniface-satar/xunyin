import { useCallback, useEffect, useRef } from 'react'

import Songlist, { type SonglistProps, type SonglistType } from '@/screens/Home/Views/SongList/components/Songlist'
import { getArtistAlbums } from '@/core/artist'
import { type AlbumSearchItem } from '@/utils/musicSdk/albumNormalizers'
import { type ArtistSource } from '@/utils/musicSdk/artistNormalizers'

const PAGE_SIZE = 30

export default ({ source, artistId, active }: {
  source: ArtistSource
  artistId: string
  active: boolean
}) => {
  const listRef = useRef<SonglistType>(null)
  const dataRef = useRef<AlbumSearchItem[]>([])
  const pageRef = useRef(0)
  const hasMoreRef = useRef(true)
  const loadingRef = useRef(false)
  const startedRef = useRef(false)
  const isUnmountedRef = useRef(false)

  const loadPage = useCallback(async(page: number, append: boolean, refreshing = false) => {
    if (loadingRef.current) return
    loadingRef.current = true
    listRef.current?.setStatus(refreshing ? 'refreshing' : 'loading')
    try {
      const result = await getArtistAlbums(source, artistId, page, PAGE_SIZE)
      if (isUnmountedRef.current) return
      pageRef.current = page
      hasMoreRef.current = result.hasMore
      dataRef.current = append ? [...dataRef.current, ...result.list] : result.list
      listRef.current?.setList(dataRef.current)
      listRef.current?.setStatus(result.hasMore ? 'idle' : 'end')
    } catch {
      if (isUnmountedRef.current) return
      listRef.current?.setStatus('error')
    } finally {
      loadingRef.current = false
    }
  }, [artistId, source])

  useEffect(() => {
    isUnmountedRef.current = false
    return () => {
      isUnmountedRef.current = true
    }
  }, [])

  // 专辑接口要翻页，标签没露出前不拉，免得白跑一次请求
  useEffect(() => {
    if (!active || startedRef.current) return
    startedRef.current = true
    void loadPage(1, false)
  }, [active, loadPage])

  const handleRefresh: SonglistProps['onRefresh'] = () => {
    void loadPage(1, false, true)
  }
  const handleLoadMore: SonglistProps['onLoadMore'] = () => {
    if (loadingRef.current || !hasMoreRef.current) return
    void loadPage(pageRef.current + 1, pageRef.current > 0)
  }

  return <Songlist
    ref={listRef}
    onRefresh={handleRefresh}
    onLoadMore={handleLoadMore}
  />
}
