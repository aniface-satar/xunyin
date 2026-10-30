import { memo, useRef } from 'react'
import { Animated, TouchableOpacity, View } from 'react-native'
import { useKeyboard } from '@/utils/hooks'

import { NAV_MENUS } from '@/config/constant'
import { type InitState as CommonState } from '@/store/common/state'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import { useNavActiveId, useNavigationBarHeight } from '@/store/common/hook'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { setNavActiveId } from '@/core/common'
import homeDetailActions from '@/store/homeDetail/action'
import { createStyle } from '@/utils/tools'
import { scaleSizeH } from '@/utils/pixelRatio'
import { useGlassColors } from '@/utils/hooks/useGlassColors'
import { BorderRadius, BorderWidths } from '@/theme'
import { usePlayerOverlay } from '@/components/player/PlayerOverlay'
import { BOTTOM_STRIP_SETTLE_SPAN, getBottomBarHeight, getBottomBarInset, getBottomBarRiseRange } from '@/components/player/PlayerOverlay/transition'
import GlassBackdrop from '@/components/common/GlassBackdrop'

const TAB_BAR_HEIGHT = 54

const BottomTabBar = ({ onTabPress }: { onTabPress?: (id: CommonState['navActiveId']) => void } = {}) => {
  const activeId = useNavActiveId()
  const { keyboardShown } = useKeyboard()
  const theme = useTheme()
  const t = useI18n()
  const playerOverlay = usePlayerOverlay()
  const glassColors = useGlassColors()
  const liveNavigationBarHeight = useNavigationBarHeight()
  const frozenNavigationBarHeightRef = useRef(liveNavigationBarHeight)
  const barSettled = playerOverlay?.barSettled !== false
  if (barSettled) frozenNavigationBarHeightRef.current = liveNavigationBarHeight
  // 转场期间（展开动画、整页停留、收起动画）把这条高度钉住，落定后才接真实值（见 transition.ts）
  const navigationBarHeight = getBottomBarInset({
    liveInset: liveNavigationBarHeight,
    frozenInset: frozenNavigationBarHeightRef.current,
    settled: barSettled,
  })

  if (keyboardShown) return null

  if (!playerOverlay) return null

  const { progress } = playerOverlay
  // 系统导航栏（Android 15 起强制边到边）压在屏幕上，条形要多铺这一条：图标文字留在系统栏上沿，
  // 玻璃底一直铺到屏幕底。位移量必须用铺满后的总高度，否则收起时屏底会露出半截。
  // 高度按 scaleSizeH 换算（styles.items 的 54 也走同一套换算），位移量取换算后的实际高度。
  const barContentHeight = scaleSizeH(TAB_BAR_HEIGHT)
  const barHeight = getBottomBarHeight({ baseHeight: barContentHeight, bottomInset: navigationBarHeight })
  // 与卡片下缘共用同一条窗口（见 PlayerOverlay/transition.ts）：展开时进度一离开 1（动画第一帧 / 手指刚动）
  // 导航栏就跟着往下走，展开量到 60% 时整条已在屏幕外；收起时在行程后 60% 里一起升回来。
  // 旧窗口开在整屏一侧（[0, 0.3]），展开要等展开量到 70% 才动 —— 真机反馈"导航栏并没有跟着先动"
  const containerTranslateY = progress.interpolate(getBottomBarRiseRange({ barHeight }))
  // 顶边那条线只在往播放栏那一面收敛时长出来（整屏一侧是透明的），跟回升同窗淡入淡出
  const containerBorderTopColor = progress.interpolate({
    inputRange: [0, BOTTOM_STRIP_SETTLE_SPAN, 1],
    outputRange: ['transparent', 'transparent', theme['c-border-background']],
  })

  return (
    <Animated.View style={{
      ...styles.container,
      // 多出来的这一条在 items 下面，玻璃层仍按整条铺满（绝对定位层的内边距行为不必再赌）
      height: barContentHeight + navigationBarHeight,
      borderTopColor: containerBorderTopColor,
      backgroundColor: theme['c-content-background'],
      zIndex: 3,
      transform: [{ translateY: containerTranslateY }],
    }}>
      <GlassBackdrop blurRadius={24} overlayOpacity={0.58} flat />
      <View style={styles.items}>
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
      </View>
    </Animated.View>
  )
}

const styles = createStyle({
  container: {
    borderTopWidth: BorderWidths.normal,
    overflow: 'hidden',
  },
  items: {
    flexDirection: 'row',
    height: TAB_BAR_HEIGHT,
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

