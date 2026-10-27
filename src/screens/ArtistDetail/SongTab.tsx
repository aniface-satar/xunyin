import { useCallback, useEffect, useRef, useState } from 'react'
import { TouchableOpacity, View } from 'react-native'

import OnlineList, { type OnlineListType, type OnlineListProps } from '@/components/OnlineList'
import Text from '@/components/common/Text'
import { getArtistSongs } from '@/core/artist'
import { setTempList } from '@/core/list'
import { playList } from '@/core/player/player'
import { LIST_IDS } from '@/config/constant'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { type ArtistSongSort, type ArtistSource } from '@/utils/musicSdk/artistNormalizers'

const PAGE_SIZE = 30

const SORT_LABEL = {
  hot: 'songlist_hot',
  new: 'songlist_new',
} as const

export default ({ source, artistId }: {
  source: ArtistSource
  artistId: string
}) => {
  const t = useI18n()
  const theme = useTheme()
  const [sort, setSort] = useState<ArtistSongSort>('hot')
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false)
  const listRef = useRef<OnlineListType>(null)
  const dataRef = useRef<LX.Music.MusicInfoOnline[]>([])
  const pageRef = useRef(0)
  const hasMoreRef = useRef(true)
  const loadingRef = useRef(false)
  const requestGenRef = useRef(0)
  const isUnmountedRef = useRef(false)

  const loadPage = useCallback(async(page: number, append: boolean, sort: ArtistSongSort, refreshing = false) => {
    const gen = ++requestGenRef.current
    loadingRef.current = true
    listRef.current?.setStatus(refreshing ? 'refreshing' : 'loading')
    try {
      const result = await getArtistSongs(source, artistId, page, PAGE_SIZE, sort)
      if (isUnmountedRef.current || gen !== requestGenRef.current) return
      pageRef.current = page
      hasMoreRef.current = result.hasMore
      dataRef.current = append ? [...dataRef.current, ...result.list] : result.list
      listRef.current?.setList(result.list, append)
      listRef.current?.setStatus(result.hasMore ? 'idle' : 'end')
    } catch {
      if (isUnmountedRef.current || gen !== requestGenRef.current) return
      listRef.current?.setStatus('error')
    } finally {
      if (gen === requestGenRef.current) loadingRef.current = false
    }
  }, [artistId, source])

  useEffect(() => {
    isUnmountedRef.current = false
    dataRef.current = []
    pageRef.current = 0
    hasMoreRef.current = true
    loadingRef.current = false
    setIsMultiSelectMode(false)
    void loadPage(1, false, sort)
    return () => {
      isUnmountedRef.current = true
    }
  }, [loadPage, sort])

  const handleToggleSort = () => {
    requestGenRef.current++
    setSort(sort == 'hot' ? 'new' : 'hot')
  }
  const handleRefresh: OnlineListProps['onRefresh'] = () => {
    void loadPage(1, false, sort, true)
  }
  const handleLoadMore: OnlineListProps['onLoadMore'] = () => {
    if (loadingRef.current || !hasMoreRef.current) return
    void loadPage(pageRef.current + 1, pageRef.current > 0, sort)
  }
  const handlePlayList: OnlineListProps['onPlayList'] = (index) => {
    if (!dataRef.current.length) return
    void setTempList(`${source}__artist__${artistId}`, [...dataRef.current]).then(() => {
      void playList(LIST_IDS.TEMP, index)
    })
  }
  const handleToggleMultiSelect = () => {
    if (isMultiSelectMode) listRef.current?.exitMultiSelect()
    else listRef.current?.showMultiSelect()
  }

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        {
          source != 'mg'
            ? <TouchableOpacity
                style={styles.toolButton}
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                activeOpacity={0.7}
                accessibilityRole="button"
                onPress={handleToggleSort}
              >
                <Text size={14} color={theme['c-primary']}>{t(SORT_LABEL[sort])}</Text>
              </TouchableOpacity>
            : null
        }
        <TouchableOpacity
          style={{ ...styles.toolButton, marginLeft: 14 }}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
          activeOpacity={0.7}
          accessibilityRole="button"
          onPress={handleToggleMultiSelect}
        >
          <Text size={14} color={theme['c-primary']}>{t(isMultiSelectMode ? 'list_select_cancel' : 'mylist_multi_select')}</Text>
        </TouchableOpacity>
      </View>
      <OnlineList
        key={sort}
        ref={listRef}
        onRefresh={handleRefresh}
        onLoadMore={handleLoadMore}
        onPlayList={handlePlayList}
        onMultiSelectModeChange={setIsMultiSelectMode}
        multiSelectStyle="mylist"
        multiSelectBarPosition="header"
      />
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: 38,
    paddingRight: 10,
  },
  toolButton: {
    height: 26,
    paddingLeft: 4,
    paddingRight: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
