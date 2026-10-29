import { memo, useEffect, useRef, useState } from 'react'
import { Animated, TouchableOpacity, View } from 'react-native'

import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import GlassBackdrop from '@/components/common/GlassBackdrop'
import { pop } from '@/navigation'
import { useTheme } from '@/store/theme/hook'
import { useStatusbarHeight } from '@/store/common/hook'
import { createStyle } from '@/utils/tools'
import { scaleSizeH } from '@/utils/pixelRatio'
import { BorderWidths } from '@/theme'

const STICKY_BAR_HEIGHT = 42

/**
 * 歌单详情页的吸顶标题栏。
 *
 * 歌单的大头部（返回 / 封面 / 歌名 / 播放全部）挂在 OnlineList 的列表头里，上滑会整块滚走。
 * 这里补一条固定在顶部的窄栏：大头部的首行一滚出去就淡入，显示返回键与歌单名，
 * 观感对齐自建歌单详情页（MylistDetail 的 Header 常驻）。
 *
 * 壁纸模式下页面底色是透明的，只铺 `c-content-background` 会让歌曲行从标题下面透出来，
 * 所以和 Dialog / Popup 一样垫一层 GlassBackdrop。
 */
export default memo(({ componentId, embedded, name, visible, onBack }: {
  componentId: string
  embedded?: boolean
  name: string
  visible: boolean
  onBack?: () => void
}) => {
  const fullStatusBarHeight = useStatusbarHeight()
  // 与 Header 保持一致：嵌在首页详情栈里时，上方已经避开状态栏
  const statusBarHeight = embedded ? 0 : fullStatusBarHeight
  const theme = useTheme()
  // 淡出结束后再卸载，否则动画一半就被摘掉
  const [rendered, setRendered] = useState(visible)
  const anim = useRef(new Animated.Value(visible ? 1 : 0)).current

  useEffect(() => {
    if (visible) setRendered(true)
    const task = requestAnimationFrame(() => {
      Animated.timing(anim, {
        toValue: visible ? 1 : 0,
        duration: 160,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && !visible) setRendered(false)
      })
    })
    return () => {
      cancelAnimationFrame(task)
    }
  }, [anim, visible])

  const back = () => {
    if (onBack) {
      onBack()
    } else {
      void pop(componentId)
    }
  }

  if (!rendered) return null

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={{
        ...styles.container,
        paddingTop: statusBarHeight,
        borderBottomColor: theme['c-border-background'],
        backgroundColor: theme['c-content-background'],
        opacity: anim,
        transform: [{
          // createStyle 会按屏幕比例换算高度，这里跟着换算，滑入位移才和实际高度一致
          translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-scaleSizeH(STICKY_BAR_HEIGHT), 0] }),
        }],
      }}
    >
      {theme['is-wallpaper'] ? <GlassBackdrop /> : null}
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          accessibilityRole="button"
          accessibilityLabel={global.i18n.t('back')}
          activeOpacity={0.7}
          onPress={back}
        >
          <Icon name="chevron-left" size={20} color={theme['c-font']} />
        </TouchableOpacity>
        <View style={styles.titleBox}>
          <Text style={styles.title} size={16} color={theme['c-font']} numberOfLines={1}>{name}</Text>
        </View>
        {/* 与返回键同宽的空位，标题才能保持在整条栏的中间 */}
        <View style={styles.actionBtn} />
      </View>
    </Animated.View>
  )
})

const styles = createStyle({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    zIndex: 3,
    borderBottomWidth: BorderWidths.normal,
    overflow: 'hidden',
  },
  row: {
    height: STICKY_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn: {
    width: 44,
    height: '100%',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingLeft: 10,
  },
  titleBox: {
    flex: 1,
    height: '100%',
    justifyContent: 'center',
  },
  title: {
    textAlign: 'center',
  },
  actionBtn: {
    width: 44,
    height: '100%',
  },
})
