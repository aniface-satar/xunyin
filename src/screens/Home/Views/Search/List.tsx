import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ComponentRef } from 'react'
import { View } from 'react-native'
import PagerView, { type PagerViewOnPageSelectedEvent } from 'react-native-pager-view'
import type { InitState as SearchState } from '@/store/search/state'
import type { Source as MusicSource } from '@/store/search/music/state'
import type { Source as SongListSource } from '@/store/search/songlist/state'
import type { Source as AlbumSource } from '@/store/search/album/state'
import type { Source as ArtistSource } from '@/store/search/artist/state'
import MusicList, { type MusicListType } from './MusicList'
import BlankView, { type BlankViewType } from './BlankView'
import SonglistList, { type MusicListType as SonglistListType } from './SonglistList'
import AlbumList, { type AlbumListType } from './AlbumList'
import ArtistList, { type ArtistListType } from './ArtistList'
import { SEARCH_TYPES } from './searchTypes'
import { createStyle } from '@/utils/tools'

type SearchType = SearchState['searchType']
type SearchSource = MusicSource | SongListSource | AlbumSource | ArtistSource

interface ListProps {
  onSearch: (keyword: string) => void
  type: SearchType
  onTypeChange: (type: SearchType) => void
}
export interface ListType {
  loadList: (text: string, source: SearchSource, type: SearchType, force?: boolean) => void
}

export default forwardRef<ListType, ListProps>(({ onSearch, type, onTypeChange }, ref) => {
  const [showBlankView, setShowListView] = useState(true)
  const pagerRef = useRef<ComponentRef<typeof PagerView>>(null)
  const blankViewRef = useRef<BlankViewType>(null)
  const musicListRef = useRef<MusicListType>(null)
  const songlistListRef = useRef<SonglistListType>(null)
  const albumListRef = useRef<AlbumListType>(null)
  const artistListRef = useRef<ArtistListType>(null)
  const typeRef = useRef(type)
  // 每个类型最近一次已加载的关键词+音源；滑回已加载过的标签直接复用，避免列表清空重填
  const loadedRef = useRef<Partial<Record<SearchType, string>>>({})

  const getListRef = (searchType: SearchType) => {
    switch (searchType) {
      case 'songlist':
        return songlistListRef
      case 'album':
        return albumListRef
      case 'artist':
        return artistListRef
      default:
        return musicListRef
    }
  }

  useImperativeHandle(ref, () => ({
    loadList(text, source, type, force = false) {
      if (!text) {
        setShowListView(true)
        requestAnimationFrame(() => {
          blankViewRef.current?.show(source)
        })
        return
      }
      setShowListView(false)
      typeRef.current = type
      const signature = `${source}|${text}`
      if (!force && loadedRef.current[type] == signature) return
      loadedRef.current[type] = signature
      requestAnimationFrame(() => {
        getListRef(type).current?.loadList(text, source)
      })
    },
  }), [])

  useEffect(() => {
    typeRef.current = type
    pagerRef.current?.setPage(SEARCH_TYPES.indexOf(type))
  }, [type])

  const handlePageSelected = useCallback(({ nativeEvent }: PagerViewOnPageSelectedEvent) => {
    const next = SEARCH_TYPES[nativeEvent.position]
    if (next && next != typeRef.current) onTypeChange(next)
  }, [onTypeChange])

  if (showBlankView) return <BlankView ref={blankViewRef} onSearch={onSearch} />

  return (
    <PagerView
      ref={pagerRef}
      style={styles.pagerView}
      initialPage={SEARCH_TYPES.indexOf(type)}
      onPageSelected={handlePageSelected}
    >
      <View collapsable={false} style={styles.page}>
        <MusicList ref={musicListRef} />
      </View>
      <View collapsable={false} style={styles.page}>
        <AlbumList ref={albumListRef} />
      </View>
      <View collapsable={false} style={styles.page}>
        <SonglistList ref={songlistListRef} />
      </View>
      <View collapsable={false} style={styles.page}>
        <ArtistList ref={artistListRef} />
      </View>
    </PagerView>
  )
})

const styles = createStyle({
  pagerView: {
    flex: 1,
  },
  page: {
    flex: 1,
    overflow: 'hidden',
  },
})
