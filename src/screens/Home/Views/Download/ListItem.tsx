import { memo } from 'react'
import { View } from 'react-native'

import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import { getQualityLabel } from '@/core/download/qualityLabel'
import { canPause, canResume } from '@/core/download/pausePlan'
import { isSaving, progressLabel } from '@/core/download/progress'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import type { Message } from '@/lang'
import { sizeFormate } from '@/utils/common'
import { createStyle } from '@/utils/tools'

export type DownloadItemType = LX.Download.ListItem

interface Props {
  item: DownloadItemType
  onRetry: (item: DownloadItemType) => void
  onPause: (item: DownloadItemType) => void
  onResume: (item: DownloadItemType) => void
  onRemove: (item: DownloadItemType) => void
}

const STATUS_KEYS: Record<LX.Download.DownloadTaskStatus, keyof Message> = {
  waiting: 'download_status_waiting',
  run: 'download_status_run',
  pause: 'download_status_pause',
  error: 'download_status_error',
  completed: 'download_status_completed',
}

const DownloadListItem = ({ item, onRetry, onPause, onResume, onRemove }: Props) => {
  const theme = useTheme()
  const t = useI18n()
  const { musicInfo, quality, fileName } = item.metadata
  const isRunning = item.status == 'run' || item.status == 'waiting'
  const saving = isSaving(item.status, item.progress)

  const sizeText = item.total ? `${sizeFormate(item.downloaded)} / ${sizeFormate(item.total)}` : ''

  let detail = ''
  if (item.status == 'error' || item.status == 'completed') {
    detail = item.status == 'error' ? item.statusText : fileName
  } else if (item.status == 'run') {
    const parts = saving ? [t('download_status_saving')] : [progressLabel(item.progress), item.speed]
    if (sizeText) parts.push(sizeText)
    detail = parts.filter(Boolean).join(' · ')
  }

  return (
    <View style={[styles.container, { borderBottomColor: theme['c-border-background'] }]}>
      <View style={styles.info}>
        <Text size={14} color={theme['c-font']} numberOfLines={1}>{musicInfo.name}</Text>
        <Text size={11} color={theme['c-font-label']} numberOfLines={1} style={styles.subTitle}>
          {`${musicInfo.singer} · ${getQualityLabel(quality, t)} · ${t(STATUS_KEYS[item.status])}`}
        </Text>
        {
          isRunning
            ? (
                <View style={[styles.track, { backgroundColor: theme['c-150'] }]}>
                  <View style={[styles.trackFill, { flexGrow: item.progress, backgroundColor: theme['c-primary'] }]} />
                  <View style={{ flexGrow: 1 - item.progress }} />
                </View>
              )
            : null
        }
        {
          detail
            ? (
                <Text
                  size={11}
                  color={item.status == 'error' ? theme['c-font'] : theme['c-font-label']}
                  numberOfLines={2}
                  style={styles.subTitle}
                >
                  {detail}
                </Text>
              )
            : null
        }
      </View>
      <View style={styles.actions}>
        {
          item.status == 'error'
            ? (
                <Button style={styles.actionButton} onPress={() => { onRetry(item) }}>
                  <Text size={12} color={theme['c-primary-font']}>{t('download_action_retry')}</Text>
                </Button>
              )
            : null
        }
        {
          canPause(item.status)
            ? (
                <Button style={styles.actionButton} onPress={() => { onPause(item) }}>
                  <Text size={12} color={theme['c-font-label']}>{t('download_action_pause')}</Text>
                </Button>
              )
            : null
        }
        {
          canResume(item.status)
            ? (
                <Button style={styles.actionButton} onPress={() => { onResume(item) }}>
                  <Text size={12} color={theme['c-primary-font']}>{t('download_action_resume')}</Text>
                </Button>
              )
            : null
        }
        {
          isRunning
            ? null
            : (
                <Button style={styles.actionButton} onPress={() => { onRemove(item) }}>
                  <Text size={12} color={theme['c-font-label']}>{t('download_action_remove')}</Text>
                </Button>
              )
        }
      </View>
    </View>
  )
}

const styles = createStyle({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  info: {
    flex: 1,
  },
  subTitle: {
    marginTop: 3,
  },
  track: {
    flexDirection: 'row',
    height: 3,
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  trackFill: {
    width: 0,
    height: 3,
  },
  actions: {
    paddingLeft: 8,
  },
  actionButton: {
    padding: 6,
    hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
  },
})

export default memo(DownloadListItem)
