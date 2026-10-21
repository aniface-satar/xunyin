import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import {
  Animated,
  Modal,
  ScrollView,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native'

import GlassBackdrop from '@/components/common/GlassBackdrop'
import Text from '@/components/common/Text'
import { enqueueDownloads } from '@/core/download/scheduler'
import { ensureUsableSaveDir } from '@/core/download/target'
import { getQualityLabel } from '@/core/download/qualityLabel'
import { getSharedQualities, type QualityChoice } from '@/core/download/quality'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import type { Message } from '@/lang'
import { useSheetSlideAnimation } from '@/utils/hooks/useSheetSlideAnimation'
import { createStyle } from '@/utils/tools'

export interface DownloadQualitySheetType {
  show: (musicInfos: LX.Music.MusicInfoOnline[]) => void
}

/** 逐首各取自己的最高/最低档，所以不受"这批歌共同支持"的限制 */
const MODE_CHOICES: Array<{ choice: QualityChoice, labelKey: keyof Message }> = [
  { choice: 'highest', labelKey: 'download_quality_all_highest' },
  { choice: 'lowest', labelKey: 'download_quality_all_lowest' },
]

interface QualityOption {
  quality: LX.Quality
  label: string
  size: string
}

const buildOptions = (
  musicInfos: LX.Music.MusicInfoOnline[],
  t: (key: keyof Message) => string,
): QualityOption[] => {
  return getSharedQualities(musicInfos, source => global.lx.qualityList[source] ?? []).map((quality) => {
    const qualityInfo = musicInfos[0]?.meta._qualitys[quality]
    return {
      quality,
      label: getQualityLabel(quality, t),
      size: qualityInfo?.size ?? '',
    }
  })
}

const DownloadQualitySheet = forwardRef<DownloadQualitySheetType>((_, ref) => {
  const theme = useTheme()
  const t = useI18n()
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [options, setOptions] = useState<QualityOption[]>([])
  // "全部按最高/最低"是给歌单里多选一次下多首用的；单首下载没得挑，不出现这两行
  const [showModeChoices, setShowModeChoices] = useState(false)
  const musicInfosRef = useRef<LX.Music.MusicInfoOnline[]>([])
  const slide = useSheetSlideAnimation()

  useImperativeHandle(ref, () => ({
    show(musicInfos) {
      if (!musicInfos.length) return

      musicInfosRef.current = musicInfos
      setShowModeChoices(musicInfos.length > 1)
      setOptions(buildOptions(musicInfos, t))
      setMounted(true)
      slide.show()
      requestAnimationFrame(() => {
        setVisible(true)
      })
    },
  }))

  useEffect(() => () => {
    musicInfosRef.current = []
  }, [])

  const hide = (after?: () => void) => {
    slide.hide(() => {
      setVisible(false)
      after?.()
    })
  }

  const handlePick = (choice: QualityChoice) => {
    const musicInfos = [...musicInfosRef.current]
    hide(() => {
      // 面板已经收起才弹系统文件夹选择器，盖着 Modal 起 Activity 有些机器会没反应
      void ensureUsableSaveDir().then((ready) => {
        if (!ready) return
        enqueueDownloads(musicInfos, choice)
      })
    })
  }

  if (!mounted) return null

  return (
    <Modal
      animationType="none"
      transparent
      hardwareAccelerated
      statusBarTranslucent
      visible={visible}
      onRequestClose={() => {
        hide()
      }}
      onDismiss={() => {
        if (!visible) setMounted(false)
      }}
    >
      <TouchableWithoutFeedback onPress={() => {
        hide()
      }}>
        <Animated.View style={[styles.mask, { opacity: slide.maskOpacity }]}>
          <Animated.View
            style={[
              styles.sheet,
              { backgroundColor: theme['c-content-background'] },
              { transform: [{ translateY: slide.sheetY }] },
            ]}
            onLayout={slide.onSheetLayout}
            onStartShouldSetResponder={() => true}
          >
            <GlassBackdrop
              blurRadius={24}
              overlayOpacity={0.62}
              style={{ backgroundColor: theme['c-content-background'] }}
            />
            <View style={styles.content}>
              <Text style={styles.title} size={13} color={theme['c-font']}>
                {t('download_quality_title')}
              </Text>
              <ScrollView
                style={styles.options}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {
                  showModeChoices
                    ? MODE_CHOICES.map(({ choice, labelKey }, index) => (
                        <TouchableOpacity
                          key={choice}
                          style={[
                            styles.option,
                            { borderTopColor: theme['c-border-background'] },
                            index === 0 ? styles.optionFirst : null,
                          ]}
                          activeOpacity={0.6}
                          accessibilityRole="button"
                          onPress={() => {
                            handlePick(choice)
                          }}
                        >
                          <Text size={14} color={theme['c-font']}>{t(labelKey)}</Text>
                        </TouchableOpacity>
                    ))
                    : null
                }
                {
                  options.map(({ quality, label, size }, index) => (
                    <TouchableOpacity
                      key={quality}
                      style={[
                        styles.option,
                        { borderTopColor: theme['c-border-background'] },
                        !showModeChoices && index === 0 ? styles.optionFirst : null,
                      ]}
                      activeOpacity={0.6}
                      accessibilityRole="button"
                      onPress={() => {
                        handlePick(quality)
                      }}
                    >
                      <Text size={14} color={theme['c-font']}>{label}</Text>
                      {
                        size
                          ? <Text size={12} color={theme['c-font-label']}>{size}</Text>
                          : null
                      }
                    </TouchableOpacity>
                  ))
                }
              </ScrollView>
            </View>
          </Animated.View>
        </Animated.View>
      </TouchableWithoutFeedback>
    </Modal>
  )
})

const styles = createStyle({
  mask: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    overflow: 'hidden',
  },
  content: {
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: {
    textAlign: 'center',
    marginBottom: 8,
  },
  options: {
    maxHeight: 260,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 46,
    paddingHorizontal: 16,
    borderTopWidth: 1,
  },
  optionFirst: {
    borderTopWidth: 0,
  },
})

export default DownloadQualitySheet
