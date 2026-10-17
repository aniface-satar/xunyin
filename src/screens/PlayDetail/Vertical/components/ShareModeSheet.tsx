import { forwardRef, useImperativeHandle, useState } from 'react'
import { Animated, Modal, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native'

import GlassBackdrop from '@/components/common/GlassBackdrop'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { useSheetSlideAnimation } from '@/utils/hooks/useSheetSlideAnimation'
import { createStyle } from '@/utils/tools'

export interface ShareModeSheetType {
  show: () => void
}

export type ShareMode = 'text' | 'image'

interface ShareModeSheetProps {
  onSelect: (mode: ShareMode) => void
}

const ACTIONS = [
  { key: 'text', icon: 'comment', label: 'share_mode_text' },
  { key: 'image', icon: 'share', label: 'share_mode_image' },
] as const

const ShareModeSheet = forwardRef<ShareModeSheetType, ShareModeSheetProps>(({ onSelect }, ref) => {
  const theme = useTheme()
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

  const handleSelect = (mode: ShareMode) => {
    hide()
    onSelect(mode)
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
            <View style={styles.content} onStartShouldSetResponder={() => true}>
              <View style={styles.titleRow}>
                <Text size={13} color={theme['c-font-label']}>{t('share_mode_sheet_title')}</Text>
              </View>
              <View style={[styles.separator, { backgroundColor: theme['c-border-background'] }]} />
              <View style={styles.actions}>
                {
                  ACTIONS.map(({ key, icon, label }) => (
                    <TouchableOpacity
                      key={key}
                      style={styles.action}
                      activeOpacity={0.6}
                      accessibilityRole="button"
                      onPress={() => {
                        handleSelect(key)
                      }}
                    >
                      <Icon name={icon} size={20} color={theme['c-primary']} style={styles.actionIcon} />
                      <Text numberOfLines={1} size={14} color={theme['c-font']} style={styles.actionText}>{t(label)}</Text>
                    </TouchableOpacity>
                  ))
                }
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
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    overflow: 'hidden',
  },
  content: {
    paddingBottom: 16,
  },
  titleRow: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  separator: {
    height: 1,
  },
  actions: {
    flexDirection: 'column',
  },
  action: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 54,
    paddingHorizontal: 20,
  },
  actionIcon: {
    width: 30,
  },
  actionText: {
    marginLeft: 10,
  },
})

export default ShareModeSheet
