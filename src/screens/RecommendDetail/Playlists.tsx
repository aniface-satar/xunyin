import { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'

import Header from './Header'
import List, { type ListType } from '@/screens/Home/Views/SongList/components/Songlist/List'
import { useI18n } from '@/lang'
import homeDetailActions from '@/store/homeDetail/action'
import { getRecommendFeed, loadMoreRecommendPlaylists, refreshRecommendFeed, subscribeRecommendFeed } from '@/screens/Home/Views/Recommend/feed'
import { createStyle } from '@/utils/tools'

/** 推荐歌单「更多>」：画像选出的分类下的歌单，可继续翻页。 */
export default ({ onBack }: { onBack: () => void }) => {
  const t = useI18n()
  const listRef = useRef<ListType>(null)
  const [tagName, setTagName] = useState(() => getRecommendFeed().category?.tagName ?? '')

  const applyFeed = useCallback(() => {
    const feed = getRecommendFeed()
    listRef.current?.setList(feed.playlists)
    setTagName(feed.category?.tagName ?? '')
    if (!feed.playlists.length) {
      listRef.current?.setStatus(feed.loading ? 'loading' : 'error')
    } else if (feed.playlistPage >= feed.playlistMaxPage) {
      listRef.current?.setStatus('end')
    } else {
      listRef.current?.setStatus(feed.playlistLoadingMore ? 'loading' : 'idle')
    }
  }, [])

  useEffect(() => {
    applyFeed()
    const unsubscribe = subscribeRecommendFeed(applyFeed)
    void refreshRecommendFeed()
    return unsubscribe
  }, [applyFeed])

  return (
    <View style={styles.container}>
      <Header title={tagName.length ? tagName : t('recommend_playlists')} onBack={onBack} />
      <List
        ref={listRef}
        onRefresh={() => {
          listRef.current?.setStatus('refreshing')
          void refreshRecommendFeed(true)
        }}
        onLoadMore={() => {
          void loadMoreRecommendPlaylists()
        }}
        onOpenDetail={item => {
          homeDetailActions.push({ type: 'songlist', info: item })
        }}
      />
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
})
