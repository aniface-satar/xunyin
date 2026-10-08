import { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'

import OnlineList, { type OnlineListType } from '@/components/OnlineList'
import Header from './Header'
import { useI18n } from '@/lang'
import { getRecommendFeed, playCuratedNewSong, refreshRecommendFeed, subscribeRecommendFeed } from '@/screens/Home/Views/Recommend/feed'
import { createStyle } from '@/utils/tools'

/** 新歌速递「更多>」：画像定向选中的新歌榜整页曲目（已按画像排序）。 */
export default ({ onBack }: { onBack: () => void }) => {
  const t = useI18n()
  const listRef = useRef<OnlineListType>(null)
  const [boardName, setBoardName] = useState(() => getRecommendFeed().newSongs.boardName)

  const applyFeed = useCallback(() => {
    const feed = getRecommendFeed()
    listRef.current?.setList(feed.newSongs.tracks)
    setBoardName(feed.newSongs.boardName)
    if (feed.loading) {
      listRef.current?.setStatus('loading')
    } else if (feed.newSongs.tracks.length) {
      listRef.current?.setStatus('end')
    } else if (feed.newSongs.source == null) {
      listRef.current?.setStatus('error')
    } else {
      listRef.current?.setStatus('end')
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
      <Header title={boardName.length ? boardName : t('recommend_new_songs')} onBack={onBack} />
      <OnlineList
        ref={listRef}
        checkHomePagerIdle={false}
        rowType="medium"
        onRefresh={() => {
          void refreshRecommendFeed(true)
        }}
        onLoadMore={() => {
          listRef.current?.setStatus('end')
        }}
        onPlayList={index => {
          playCuratedNewSong(index)
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
