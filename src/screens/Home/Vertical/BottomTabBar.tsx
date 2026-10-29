import { memo } from 'react'
import { Animated, TouchableOpacity, View } from 'react-native'
import { useKeyboard } from '@/utils/hooks'

import { NAV_MENUS } from '@/config/constant'
import { type InitState as CommonState } from '@/store/common/state'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import { useNavActiveId } from '@/store/common/hook'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { setNavActiveId } from '@/core/common'
import homeDetailActions from '@/store/homeDetail/action'
import { createStyle } from '@/utils/tools'
import { useGlassColors } from '@/utils/hooks/useGlassColors'
import { BorderRadius, BorderWidths } from '@/theme'
import { usePlayerOverlay } from '@/components/player/PlayerOverlay'
import { BOTTOM_STRIP_SETTLE_SPAN, getBottomBarRiseRange } from '@/components/player/PlayerOverlay/transition'
import GlassBackdrop from '@/components/common/GlassBackdrop'

const TAB_BAR_HEIGHT = 54

const BottomTabBar = ({ onTabPress }: { onTabPress?: (id: CommonState['navActiveId']) => void } = {}) => {
  const activeId = useNavActiveId()
  const { keyboardShown } = useKeyboard()
  const theme = useTheme()
  const t = useI18n()
  const playerOverlay = usePlayerOverlay()
  const glassColors = useGlassColors()

  if (keyboardShown) return null

  if (!playerOverlay) return null

  const { progress } = playerOverlay
  // 与卡片下缘共用同一条窗口（见 PlayerOverlay/transition.ts）：展开时进度一离开 1（动画第一帧 / 手指刚动）
  // 导航栏就跟着往下走，展开量到 60% 时整条已在屏幕外；收起时在行程后 60% 里一起升回来。
  // 旧窗口开在整屏一侧（[0, 0.3]），展开要等展开量到 70% 才动 —— 真机反馈"导航栏并没有跟着先动"
  const containerTranslateY = progress.interpolate(getBottomBarRiseRange({ barHeight: TAB_BAR_HEIGHT }))
  // 顶边那条线只在往播放栏那一面收敛时长出来（整屏一侧是透明的），跟回升同窗淡入淡出
  const containerBorderTopColor = progress.interpolate({
    inputRange: [0, BOTTOM_STRIP_SETTLE_SPAN, 1],
    outputRange: ['transparent', 'transparent', theme['c-border-background']],
  })

  return (
    <Animated.View style={{
      ...styles.container,
      borderTopColor: containerBorderTopColor,
      backgroundColor: theme['c-content-background'],
      zIndex: 3,
      transform: [{ translateY: containerTranslateY }],
    }}>
      <GlassBackdrop blurRadius={24} overlayOpacity={0.58} flat />
      {
        NAV_MENUS.map(({ id, icon }) => {
          const active = activeId == id
          return (
            <TouchableOpacity
              key={id}
              style={styles.item}
              activeOpacity={0.8}
              onPress={() => {
                // 重复点当前 tab 才回最初页；切换到别的 tab 时原 tab 的详情栈与子页状态都保留
                if (activeId == id) {
                  homeDetailActions.reset(id)
                  global.app_event.homeTabReset()
                }
                onTabPress?.(id)
                setNavActiveId(id)
              }}
            >
              <View style={{ ...styles.iconContent, backgroundColor: active ? glassColors.activeBackground : 'transparent' }}>
                <Icon name={icon} size={18} color={active ? glassColors.accent : glassColors.muted} />
              </View>
              <Text size={11} color={active ? glassColors.accent : glassColors.muted}>{t(id == 'nav_love' ? 'nav_mine' : id)}</Text>
            </TouchableOpacity>
          )
        })
      }
    </Animated.View>
  )
}

const styles = createStyle({
  container: {
    flexDirection: 'row',
    height: 54,
    borderTopWidth: BorderWidths.normal,
    overflow: 'hidden',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContent: {
    width: 38,
    height: 26,
    borderRadius: BorderRadius.normal,
    alignItems: 'center',
    justifyContent: 'center',
  },
})

export default memo(BottomTabBar)

