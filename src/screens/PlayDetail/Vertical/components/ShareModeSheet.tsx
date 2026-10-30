import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { Animated, Modal, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native'

import GlassBackdrop from '@/components/common/GlassBackdrop'
import Text from '@/components/common/Text'
import { FeatureIcon } from '@/components/common/Icon'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { useNavigationBarHeight } from '@/store/common/hook'
import { useSheetSlideAnimation } from '@/utils/hooks/useSheetSlideAnimation'
import { primeBackdropForPanel } from '@/utils/backdropSnapshot'
import { createStyle } from '@/utils/tools'
import { scaleSizeH } from '@/utils/pixelRatio'

export interface ShareModeSheetType {
  show: () => void
}

export type ShareMode = 'text' | 'image'

interface ShareModeSheetProps {
  onSelect: (mode: ShareMode) => void
}

const ACTIONS = [
  { key: 'text', icon: 'link-variant', label: 'share_mode_text' },
  { key: 'image', icon: 'music-box-outline', label: 'share_mode_image' },
] as const

const ShareModeSheet = forwardRef<ShareModeSheetType, ShareModeSheetProps>(({ onSelect }, ref) => {
  const theme = useTheme()
  const t = useI18n()
  // 强制边到边后三键导航压在面板下缘，选项要让开它
  const navigationBarHeight = useNavigationBarHeight()
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const slide = useSheetSlideAnimation()

  // 退场那 200ms 里面板还挂在屏上、还能被命中：slide.hide 自己有闸（useSheetSlideAnimation.ts:51），
  // handleSelect 没有 —— 不挡就是第二次 shareMusic，或者再叠一个 Modal 窗口。
  // 只在 hide 的回调真正落定时擦掉；show 也擦一次，免得上一轮的 true 漏到这一轮。
  const exitingRef = useRef(false)

  useImperativeHandle(ref, () => ({
    show() {
      exitingRef.current = false
      // 先拍背后那一帧再挂面板，玻璃面首帧即最终形态
      void primeBackdropForPanel().then(() => {
        setMounted(true)
        slide.show()
        requestAnimationFrame(() => {
          setVisible(true)
        })
      })
    },
  }))

  const hide = (onHidden?: () => void) => {
    exitingRef.current = true
    slide.hide(() => {
      exitingRef.current = false
      setVisible(false)
      onHidden?.()
    })
  }

  const handleSelect = (mode: ShareMode) => {
    if (exitingRef.current) return
    if (mode === 'text') {
      // 文字这条路不叠第二个 Modal 窗口，时序保持今天的形状：立即触发，不等退场动画
      hide()
      onSelect(mode)
      return
    }
    // 图片这条路要挂一个全屏 Modal：两个 RN Modal 就是两个 Android Dialog 窗口，
    // 面板还在退场（EXIT_DURATION=200ms，useSheetSlideAnimation.ts:5）就叠上去正是黑屏闪一下的来源。
    // 照 MusicMoreSheet.tsx:128-148 那条现成的路：等 exit 动画落定、再下一帧挂。
    hide(() => {
      requestAnimationFrame(() => { onSelect(mode) })
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
              overlayOpacity={0.62}
              restOffset={slide.sheetLayout}
              style={{ backgroundColor: theme['c-content-background'] }}
            />
            <View style={{ paddingBottom: scaleSizeH(16) + navigationBarHeight }} onStartShouldSetResponder={() => true}>
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
                      <FeatureIcon name={icon} size={20} color={theme['c-primary']} style={styles.actionIcon} />
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
    flex: 1,
    marginLeft: 10,
  },
})

export default ShareModeSheet
