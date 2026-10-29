import { useEffect, useMemo, useState } from 'react'
import { ScrollView } from 'react-native'

import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { BorderWidths, BorderRadius } from '@/theme'
import { hasDislike } from '@/core/dislikeList'
import { hasMusicUrlByMusic } from '@/utils/data'

export type MultipleAction = 'playLater' | 'download' | 'add' | 'toggleSource' | 'copyName' | 'musicSourceDetail' | 'removeCache' | 'dislike'

/**
 * 多选批量操作按钮条，贴在列表底部，带顶部分割线。
 */
export default ({ selectedList, onAction }: {
  selectedList: LX.Music.MusicInfoOnline[]
  onAction: (action: MultipleAction) => void
}) => {
  const t = useI18n()
  const theme = useTheme()
  const musicInfo = selectedList[0]
  const [hasUrlCache, setHasUrlCache] = useState(false)

  useEffect(() => {
    let isCurrent = true
    setHasUrlCache(false)
    if (musicInfo) {
      void hasMusicUrlByMusic(musicInfo).then(exists => {
        if (isCurrent) setHasUrlCache(exists)
      })
    }
    return () => {
      isCurrent = false
    }
  }, [musicInfo])

  const actions = useMemo(() => {
    const menus: Array<{ action: MultipleAction, label: string, disabled?: boolean }> = [
      { action: 'playLater', label: t('play_later'), disabled: !selectedList.length },
      { action: 'download', label: t('download_menu'), disabled: !selectedList.length },
      { action: 'add', label: t('add_to'), disabled: !selectedList.length },
      { action: 'toggleSource', label: t('toggle_source'), disabled: !musicInfo },
      { action: 'copyName', label: t('copy_name'), disabled: !musicInfo },
      { action: 'musicSourceDetail', label: t('music_source_detail'), disabled: !musicInfo },
      { action: 'removeCache', label: t('list_remove_cache'), disabled: !hasUrlCache },
      { action: 'dislike', label: t('dislike'), disabled: !musicInfo || hasDislike(musicInfo) },
    ]
    return menus
  }, [hasUrlCache, musicInfo, selectedList.length, t])

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{
        ...styles.content,
        borderTopWidth: BorderWidths.normal,
        borderTopColor: theme['c-border-background'],
      }}
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {
        actions.map(action => (
          <Button
            key={action.action}
            disabled={action.disabled}
            onPress={() => { onAction(action.action) }}
            style={{
              ...styles.action,
              backgroundColor: theme['c-button-background'],
              borderColor: theme['c-border-background'],
            }}
          >
            <Text size={12} numberOfLines={1} color={theme['c-button-font']}>{action.label}</Text>
          </Button>
        ))
      }
    </ScrollView>
  )
}

const styles = createStyle({
  container: {
    flexGrow: 0,
    flexShrink: 0,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 8,
    paddingRight: 2,
    paddingVertical: 7,
  },
  action: {
    height: 30,
    paddingLeft: 12,
    paddingRight: 12,
    marginRight: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.normal,
    borderWidth: BorderWidths.normal,
    overflow: 'hidden',
  },
})
