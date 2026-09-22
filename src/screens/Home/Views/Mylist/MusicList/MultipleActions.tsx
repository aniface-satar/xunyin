import { useEffect, useMemo, useState } from 'react'
import { ScrollView } from 'react-native'

import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { BorderWidths, BorderRadius } from '@/theme'
import { hasDislike } from '@/core/dislikeList'
import { existsFile } from '@/utils/fs'
import { hasMusicUrlByMusic } from '@/utils/data'

export type MultipleAction = 'play' | 'playLater' | 'add' | 'move' | 'changePosition'
| 'toggleSource' | 'editMetadata' | 'copyName' | 'musicSourceDetail'
| 'removeCache' | 'dislike' | 'remove'

export interface MultipleActionsProps {
  selectedList: LX.Music.MusicInfo[]
  onAction: (action: MultipleAction) => void
}

export default ({ selectedList, onAction }: MultipleActionsProps) => {
  const t = useI18n()
  const theme = useTheme()
  const musicInfo = selectedList[0]
  const [canEditMetadata, setCanEditMetadata] = useState(false)
  const [hasUrlCache, setHasUrlCache] = useState(false)

  useEffect(() => {
    let isCurrent = true
    setCanEditMetadata(false)
    setHasUrlCache(false)
    if (musicInfo?.source == 'local') {
      void existsFile(musicInfo.meta.filePath).then(exists => {
        if (isCurrent) setCanEditMetadata(exists)
      })
    }
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
    const isLocal = musicInfo?.source == 'local'
    const menus: Array<{ action: MultipleAction, label: string, disabled?: boolean }> = [
      { action: 'play', label: t('play'), disabled: !musicInfo },
      { action: 'playLater', label: t('play_later'), disabled: !selectedList.length },
      { action: 'add', label: t('add_to'), disabled: !selectedList.length },
      { action: 'move', label: t('move_to'), disabled: !selectedList.length },
      { action: 'changePosition', label: t('change_position'), disabled: !selectedList.length },
    ]
    if (isLocal) {
      menus.push({ action: 'editMetadata', label: t('edit_metadata'), disabled: !canEditMetadata })
    }
    menus.push(
      { action: 'toggleSource', label: t('toggle_source'), disabled: !musicInfo },
      { action: 'copyName', label: t('copy_name'), disabled: !musicInfo },
      { action: 'musicSourceDetail', label: t('music_source_detail'), disabled: !musicInfo || isLocal },
      { action: 'removeCache', label: t('list_remove_cache'), disabled: !hasUrlCache },
      { action: 'dislike', label: t('dislike'), disabled: !musicInfo || hasDislike(musicInfo) },
      { action: 'remove', label: t('delete'), disabled: !selectedList.length },
    )
    return menus
  }, [canEditMetadata, hasUrlCache, musicInfo, selectedList.length, t])

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ ...styles.content, borderTopColor: theme['c-border-background'] }}
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
            style={{ ...styles.action, backgroundColor: theme['c-button-background'], borderColor: theme['c-border-background'] }}
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
    borderTopWidth: BorderWidths.normal,
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
