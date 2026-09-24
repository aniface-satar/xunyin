import { forwardRef, useImperativeHandle, useState } from 'react'
import { Animated, Modal, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native'

import GlassBackdrop from '@/components/common/GlassBackdrop'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { useGlassColors } from '@/utils/hooks/useGlassColors'
import { useSheetSlideAnimation } from '@/utils/hooks/useSheetSlideAnimation'

import SettingLyricProgress from '@/screens/PlayDetail/components/SettingPopup/settings/SettingLyricProgress'
import SettingVolume from '@/screens/PlayDetail/components/SettingPopup/settings/SettingVolume'
import SettingPlaybackRate from '@/screens/PlayDetail/components/SettingPopup/settings/SettingPlaybackRate'
import SettingLrcFontSize from '@/screens/PlayDetail/components/SettingPopup/settings/SettingLrcFontSize'
import SettingLrcAlign from '@/screens/PlayDetail/components/SettingPopup/settings/SettingLrcAlign'

export interface LyricSettingSheetType {
  show: () => void
}

const LyricSettingSheet = forwardRef<LyricSettingSheetType>((_, ref) => {
  const theme = useTheme()
  const glassColors = useGlassColors()
  const t = useI18n()
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const slide = useSheetSlideAnimation()

  useImperativeHandle(ref, () => ({
    show() {
      setMounted(true)
      slide.show()
      requestAnimationFrame(() => {
        setVisible(true)
      })
    },
  }))

  const hide = () => {
    slide.hide(() => {
      setVisible(false)
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
              {
                backgroundColor: theme['c-content-background'],
                borderTopColor: theme['c-border-background'],
              },
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
              <View style={styles.header}>
                <Text size={15} style={styles.title} numberOfLines={1} color={glassColors.text}>
                  {t('play_detail_setting_title')}
                </Text>
                <TouchableOpacity onPress={hide} style={styles.closeBtn}>
                  <Icon name="close" size={14} color={glassColors.muted} />
                </TouchableOpacity>
              </View>
              <View style={styles.settings} onStartShouldSetResponder={() => true}>
                <SettingLyricProgress compact />
                <SettingVolume compact />
                <SettingPlaybackRate compact />
                <SettingLrcFontSize compact direction="vertical" />
                <SettingLrcAlign compact />
              </View>
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
    maxHeight: '100%',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderTopWidth: 1,
    overflow: 'hidden',
  },
  content: {
    flex: 0,
    flexGrow: 0,
  },
  settings: {
    paddingBottom: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
  },
  title: {
    flex: 1,
    paddingLeft: 15,
  },
  closeBtn: {
    height: 44,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
})

export default LyricSettingSheet
