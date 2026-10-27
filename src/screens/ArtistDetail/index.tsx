import { useCallback, useEffect, useRef, useState } from 'react'
import { TouchableOpacity, View } from 'react-native'

import { getArtistDetail } from '@/core/artist'
import { BorderWidths } from '@/theme'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'
import { type ArtistDetail as ArtistDetailInfo, type ArtistSearchItem } from '@/utils/musicSdk/artistNormalizers'
import Header from './Header'
import SongTab from './SongTab'
import AlbumTab from './AlbumTab'
import IntroTab, { type IntroStatus } from './IntroTab'

type ArtistTab = 'songs' | 'albums' | 'intro'

const TAB_LIST = [
  { id: 'songs', label: 'artist_tab_songs' },
  { id: 'albums', label: 'artist_tab_albums' },
  { id: 'intro', label: 'artist_tab_intro' },
] as const

export default ({ info, onBack }: {
  info: ArtistSearchItem
  onBack?: () => void
}) => {
  const theme = useTheme()
  const t = useI18n()
  const [activeTab, setActiveTab] = useState<ArtistTab>('songs')
  const [detail, setDetail] = useState<ArtistDetailInfo>({
    name: info.name,
    alias: info.alias,
    img: info.img,
    songCount: info.songCount,
    albumCount: info.albumCount,
    desc: '',
  })
  const [detailStatus, setDetailStatus] = useState<IntroStatus>('loading')
  const isUnmountedRef = useRef(false)

  const loadDetail = useCallback(() => {
    setDetailStatus('loading')
    getArtistDetail(info.source, info).then(result => {
      if (isUnmountedRef.current) return
      setDetail(result)
      setDetailStatus('done')
    }).catch(() => {
      if (isUnmountedRef.current) return
      setDetailStatus('error')
    })
  }, [info])

  useEffect(() => {
    isUnmountedRef.current = false
    loadDetail()
    return () => {
      isUnmountedRef.current = true
    }
  }, [loadDetail])

  return (
    <View style={styles.container}>
      <Header info={detail} onBack={onBack} />
      <View style={{ ...styles.tabBar, borderBottomColor: theme['c-border-background'] }}>
        {TAB_LIST.map(tab => (
          <TouchableOpacity
            key={tab.id}
            style={styles.tabButton}
            activeOpacity={0.7}
            onPress={() => { setActiveTab(tab.id) }}
          >
            <Text
              style={{
                ...styles.tabText,
                borderBottomColor: activeTab == tab.id ? theme['c-primary-background-active'] : 'transparent',
              }}
              color={activeTab == tab.id ? theme['c-primary-font-active'] : theme['c-font']}
            >{t(tab.label)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={{ ...styles.tabContent, display: activeTab == 'songs' ? 'flex' : 'none' }}>
        <SongTab source={info.source} artistId={info.id} />
      </View>
      <View style={{ ...styles.tabContent, display: activeTab == 'albums' ? 'flex' : 'none' }}>
        <AlbumTab source={info.source} artistId={info.id} active={activeTab == 'albums'} />
      </View>
      <View style={{ ...styles.tabContent, display: activeTab == 'intro' ? 'flex' : 'none' }}>
        <IntroTab desc={detail.desc} status={detailStatus} onRetry={loadDetail} />
      </View>
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 6,
    borderBottomWidth: BorderWidths.normal,
  },
  tabButton: {
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 10,
    paddingBottom: 6,
  },
  tabText: {
    fontSize: 14,
    paddingLeft: 2,
    paddingRight: 2,
    paddingBottom: 4,
    borderBottomWidth: BorderWidths.normal3,
  },
  tabContent: {
    flex: 1,
    overflow: 'hidden',
  },
})
