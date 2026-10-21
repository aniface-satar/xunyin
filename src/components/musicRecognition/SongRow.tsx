import { TouchableOpacity, View } from 'react-native'
import Text from '@/components/common/Text'
import MusicListItem, { ITEM_HEIGHT } from '@/components/OnlineList/ListItem'
import { useI18n } from '@/lang'
import type { Message } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { BorderWidths } from '@/theme'
import { rowAction, type ResolveEntry } from '@/core/musicRecognition/resolve'
import type { RecognizedSong } from '@/core/musicRecognition/types'
import { createStyle, type RowInfo } from '@/utils/tools'

// 一首命中的歌占一行。结果页与历史页共用它：同一个 songKey 在两边画出来的东西必须一致，
// 否则刚在识曲页看到的行，翻到历史页就变成另一副样子。
//
// 两种形态由 rowAction 决定，不是由页面决定：查好了是通用歌曲条（能播、有徽标），
// 还没查好的是一行暗字占位，行高与歌曲条相同 —— 歌条换上去时列表不跳。

// 本行永不进入多选，传稳定空数组引用以保留歌曲行的 memo
const NO_SELECT: LX.Music.MusicInfoOnline[] = []

export default ({ song, entry, rowInfo, index, timeLabel, onPlay, onLookup, onShowMenu }: {
  song: RecognizedSong
  entry: ResolveEntry | undefined
  rowInfo: RowInfo
  index: number
  // 历史页把「什么时候听到的」放在这一行原本放时长的位置；结果页不传，那边没有这个信息要交代。
  timeLabel?: string
  onPlay: (musicInfo: LX.Music.MusicInfoOnline) => void
  onLookup: () => void
  // 不传就没有三点按钮：历史页只要「点开能播」，菜单在识曲结果页里给过一遍了。
  onShowMenu?: (musicInfo: LX.Music.MusicInfoOnline, index: number, position: { x: number, y: number, w: number, h: number }) => void
}) => {
  const t = useI18n()
  const theme = useTheme()
  const action = rowAction(entry)

  if (action.kind == 'play') {
    return (
      <MusicListItem
        item={action.musicInfo}
        index={index}
        selectedList={NO_SELECT}
        rowInfo={rowInfo}
        isShowAlbumName={false}
        isShowInterval={timeLabel != null}
        intervalText={timeLabel}
        isMultiSelectMode={false}
        activeIndex={-1}
        onPress={info => { onPlay(info) }}
        onShowMenu={onShowMenu}
      />
    )
  }

  const subtitle = [song.singer, song.albumName].filter(text => text).join(' · ')
  const statusKey: keyof Message = entry?.status == 'pending' ? 'music_recognition_resolving' : 'music_recognition_not_found_yet'
  return (
    <TouchableOpacity
      style={[styles.pendingRow, { borderBottomColor: theme['c-border-background'] }]}
      activeOpacity={0.8}
      accessibilityRole="button"
      onPress={() => {
        // 点按的含义由 rowAction 决定：还没查的/查失败的去查，正在查的什么都不做。
        if (action.kind == 'lookup') onLookup()
      }}
    >
      <View style={styles.pendingInfo}>
        <Text size={15} color={theme['c-font']} numberOfLines={1}>{song.name}</Text>
        {
          subtitle
            ? (
                <Text size={12} color={theme['c-font-label']} numberOfLines={1}>{subtitle}</Text>
              )
            : null
        }
        <Text size={11} color={theme['c-font-label']} numberOfLines={1}>{t(statusKey)}</Text>
      </View>
      {
        timeLabel
          ? <Text style={styles.pendingTime} size={12} color={theme['c-250']} numberOfLines={1}>{timeLabel}</Text>
          : null
      }
    </TouchableOpacity>
  )
}

const styles = createStyle({
  // 行高与歌曲条一致：占位行换成歌条时列表不跳。
  pendingRow: {
    height: ITEM_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 16,
    borderBottomWidth: BorderWidths.normal,
  },
  pendingInfo: {
    flex: 1,
    flexGrow: 1,
    flexShrink: 1,
  },
  pendingTime: {
    flexGrow: 0,
    flexShrink: 0,
    paddingLeft: 8,
  },
})
