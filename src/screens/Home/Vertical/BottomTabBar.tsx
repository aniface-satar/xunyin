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
import { createStyle } from '@/utils/tools'
import { useGlassColors } from '@/utils/hooks/useGlassColors'
import { BorderRadius, BorderWidths } from '@/theme'
import { usePlayerOverlay } from '@/components/player/PlayerOverlay'
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
  const containerTranslateY = progress.interpolate({
    inputRange: [0, 0.75, 1],
    outputRange: [TAB_BAR_HEIGHT, TAB_BAR_HEIGHT, 0],
  })
  const containerBorderTopColor = progress.interpolate({
    inputRange: [0, 0.75, 1],
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
      <GlassBackdrop blurRadius={24} overlayOpacity={0.58} />
      {
        NAV_MENUS.map(({ id, icon }) => {
          const active = activeId == id
          return (
            <TouchableOpacity
              key={id}
              style={styles.item}
              activeOpacity={0.8}
              onPress={() => {
                global.app_event.homeTabReset()
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

