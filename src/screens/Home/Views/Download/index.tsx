import { useCallback, useEffect, useState } from 'react'
import { FlatList, View } from 'react-native'

import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import { Icon } from '@/components/common/Icon'
import DetailHeader from '@/screens/RecommendDetail/Header'
import ListItem, { type DownloadItemType } from './ListItem'
import { enqueueDownloads, pauseAll, pauseTask, resumeAll, resumeTask } from '@/core/download/scheduler'
import { ensureUsableSaveDir, getSaveDir, getSaveDirName, isSaveDirUsable, pickSaveDir } from '@/core/download/target'
import { canPause, canResume } from '@/core/download/pausePlan'
import { removeItem } from '@/store/download/action'
import { useDownloadList } from '@/store/download/hook'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'

const Download = ({ onBack }: { onBack: () => void }) => {
  const theme = useTheme()
  const t = useI18n()
  const list = useDownloadList()
  const saveDir = getSaveDir()
  const [saveDirName, setSaveDirName] = useState(getSaveDirName)
  const [isUsable, setIsUsable] = useState(true)
  const [isPicking, setIsPicking] = useState(false)

  // 换文件夹后要重新读一次授权状态，否则选完了还在提示"授权失效"
  useEffect(() => {
    if (!saveDir) {
      setIsUsable(true)
      return
    }
    let mounted = true
    void isSaveDirUsable(saveDir).then(usable => {
      if (mounted) setIsUsable(usable)
    }).catch(() => {
      if (mounted) setIsUsable(false)
    })
    return () => {
      mounted = false
    }
  }, [saveDir])

  const handleChangeDir = useCallback(() => {
    setIsPicking(true)
    void pickSaveDir().finally(() => {
      setIsPicking(false)
      setSaveDirName(getSaveDirName())
    })
  }, [])

  const handleRetry = useCallback((item: DownloadItemType) => {
    // 和音质面板一样：没有可写的公共目录就先去选，别悄悄落到用户看不见的私有目录
    void ensureUsableSaveDir().then((ready) => {
      if (!ready) return
      enqueueDownloads([item.metadata.musicInfo], item.metadata.quality)
    })
  }, [])

  const handleRemove = useCallback((item: DownloadItemType) => {
    removeItem(item.id)
  }, [])

  const handlePause = useCallback((item: DownloadItemType) => {
    pauseTask(item.id)
  }, [])

  const handleResume = useCallback((item: DownloadItemType) => {
    resumeTask(item.id)
  }, [])

  const renderItem = useCallback(({ item }: { item: DownloadItemType }) => (
    <ListItem
      item={item}
      onRetry={handleRetry}
      onPause={handlePause}
      onResume={handleResume}
      onRemove={handleRemove}
    />
  ), [handleRetry, handlePause, handleResume, handleRemove])

  const keyExtractor = useCallback((item: DownloadItemType) => item.id, [])

  const hasPausable = list.some(item => canPause(item.status))
  const hasResumable = list.some(item => canResume(item.status))

  return (
    <View style={styles.container}>
      <DetailHeader title={t('nav_download')} onBack={onBack} />
      <View style={[styles.dirBar, { borderBottomColor: theme['c-border-background'] }]}>
        <Icon name="sd-card" size={14} color={theme['c-font-label']} />
        <Text
          size={12}
          color={theme['c-font-label']}
          numberOfLines={1}
          style={styles.dirText}
        >
          {`${t('download_save_location')} ${saveDir ? saveDirName : t('download_save_location_default')}`}
        </Text>
        <Button
          style={styles.dirButton}
          disabled={isPicking}
          onPress={handleChangeDir}
        >
          <Text size={12} color={theme['c-primary-font']}>{t('download_save_location_change')}</Text>
        </Button>
      </View>
      {
        hasPausable || hasResumable
          ? (
              <View style={[styles.controlBar, { borderBottomColor: theme['c-border-background'] }]}>
                {
                  hasPausable
                    ? (
                        <Button style={styles.controlButton} onPress={pauseAll}>
                          <Icon name="pause" size={12} color={theme['c-font']} />
                          <Text size={12} color={theme['c-font']} style={styles.controlText}>{t('download_pause_all')}</Text>
                        </Button>
                      )
                    : null
                }
                {
                  hasResumable
                    ? (
                        <Button style={styles.controlButton} onPress={resumeAll}>
                          <Icon name="play-outline" size={12} color={theme['c-primary-font']} />
                          <Text size={12} color={theme['c-primary-font']} style={styles.controlText}>{t('download_resume_all')}</Text>
                        </Button>
                      )
                    : null
                }
              </View>
            )
          : null
      }
      {
        saveDir && !isUsable
          ? (
              <Text style={styles.warning} size={12} color={theme['c-font']} numberOfLines={2}>
                {t('download_save_location_unauthorized')}
              </Text>
            )
          : null
      }
      <FlatList
        style={styles.list}
        data={list}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={8}
        removeClippedSubviews={true}
        ListEmptyComponent={(
          <Text style={styles.empty} size={13} color={theme['c-font-label']}>
            {t('download_empty_tip')}
          </Text>
        )}
      />
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  dirBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 36,
    borderBottomWidth: 1,
  },
  dirText: {
    flex: 1,
    marginLeft: 6,
  },
  dirButton: {
    paddingLeft: 10,
    paddingRight: 4,
    hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
  },
  controlBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 34,
    borderBottomWidth: 1,
  },
  controlButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 16,
    hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
  },
  controlText: {
    marginLeft: 4,
  },
  warning: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    lineHeight: 18,
  },
  list: {
    flex: 1,
  },
  empty: {
    paddingTop: 60,
    paddingLeft: 20,
    paddingRight: 20,
    textAlign: 'center',
    lineHeight: 20,
  },
})

export default Download
