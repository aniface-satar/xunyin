import { useCallback, useRef } from 'react'
import { ScrollView, View } from 'react-native'
import Text from '@/components/common/Text'
import SongRow from '@/components/musicRecognition/SongRow'
import ListMenu, { type ListMenuType, type Position } from '@/components/OnlineList/ListMenu'
import ListMusicAdd, { type MusicAddModalType } from '@/components/MusicAddModal'
import DownloadQualitySheet, { type DownloadQualitySheetType } from '@/components/DownloadQualitySheet'
import { clearMusicUrl, handleDislikeMusic, handlePlay, handlePlayLater, handleShare, handleShowMusicSourceDetail } from '@/components/OnlineList/listAction'
import { useI18n } from '@/lang'
import type { Message } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { songKey } from '@/core/musicRecognition/session'
import { type Resolver } from '@/core/musicRecognition/resolve'
import type { RecognizedSong } from '@/core/musicRecognition/types'
import type { EngineId } from '@/core/musicRecognition/engines'
import { createStyle, getRowInfo } from '@/utils/tools'

interface Group {
  engineId: EngineId
  titleKey: keyof Message
  songs: RecognizedSong[]
}

// 听到一首就长一行，行的两种形态（通用歌曲条 / 暗字占位行）在 SongRow 里，
// 与历史识曲页共用同一套 —— 同一首歌在两个页面必须是同一副样子。
export default ({ groups, resolver }: { groups: Group[], resolver: Resolver }) => {
  const t = useI18n()
  const theme = useTheme()
  const rowInfo = useRef(getRowInfo('medium')).current
  const listMenuRef = useRef<ListMenuType>(null)
  const listMusicAddRef = useRef<MusicAddModalType>(null)
  const downloadQualitySheetRef = useRef<DownloadQualitySheetType>(null)

  const showSongMenu = useCallback((musicInfo: LX.Music.MusicInfoOnline, index: number, position: Position) => {
    listMenuRef.current?.show({ musicInfo, index, single: true, selectedList: [] }, position)
  }, [])

  if (!groups.length) return null

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text size={15} style={styles.heading}>{t('music_recognition_found')}</Text>
        {
          groups.map(group => (
            <View key={group.engineId} style={styles.section}>
              <Text size={11} color={theme['c-font-label']} style={styles.sectionTitle}>{t(group.titleKey)}</Text>
              {
                group.songs.map((song, index) => {
                  const key = songKey(song)
                  return (
                    <SongRow
                      key={key}
                      song={song}
                      entry={resolver.get(key)}
                      rowInfo={rowInfo}
                      index={index}
                      onPlay={info => { handlePlay(info) }}
                      onLookup={() => { resolver.tap(key) }}
                      onShowMenu={showSongMenu}
                    />
                  )
                })
              }
            </View>
          ))
        }
      </ScrollView>
      <ListMenu
        ref={listMenuRef}
        onPlay={info => { handlePlay(info.musicInfo) }}
        onPlayLater={info => { handlePlayLater(info.musicInfo, [], () => {}) }}
        onDownload={info => {
          requestAnimationFrame(() => {
            downloadQualitySheetRef.current?.show([info.musicInfo])
          })
        }}
        onAdd={info => { listMusicAddRef.current?.show({ musicInfo: info.musicInfo, listId: '', isMove: false }) }}
        onCopyName={info => { handleShare(info.musicInfo) }}
        onMusicSourceDetail={info => { void handleShowMusicSourceDetail(info.musicInfo) }}
        onRemoveCache={info => { void clearMusicUrl(info.musicInfo) }}
        onDislikeMusic={info => { void handleDislikeMusic(info.musicInfo) }}
      />
      <ListMusicAdd ref={listMusicAddRef} onAdded={() => {}} />
      <DownloadQualitySheet ref={downloadQualitySheetRef} />
    </>
  )
}

const styles = createStyle({
  container: {
    width: '100%',
    // 结果是在会话中途一条条加进来的。歌曲条每行 68dp，不加限制在小屏上会顶穿整页，
    // 而 ScrollView 在没有确定高度时是按内容长的，光靠 flexShrink 兜不住 —— 百分比
    // maxHeight 让它在小屏上变成"可滚的一截"，大屏上够不到这个上限、照常展开。
    // marginBottom 是给绝对定位的页脚让位：那句建议最多两行，只留一行的空隙会压住最后一行。
    flexGrow: 0,
    flexShrink: 1,
    maxHeight: '46%',
    marginBottom: 56,
  },
  content: {
    paddingTop: 12,
  },
  heading: {
    paddingLeft: 16,
    marginBottom: 2,
  },
  section: {
    marginTop: 4,
  },
  sectionTitle: {
    paddingLeft: 16,
    paddingTop: 6,
    paddingBottom: 2,
  },
})
