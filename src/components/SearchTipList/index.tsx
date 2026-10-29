import { useRef, useState, useCallback, useMemo, forwardRef, useImperativeHandle, type Ref } from 'react'
import { View, Animated } from 'react-native'
import { createStyle } from '@/utils/tools'
// import PropTypes from 'prop-types'
// import { AppColors } from '@/theme'
import { useTheme } from '@/store/theme/hook'
import GlassBackdrop from '@/components/common/GlassBackdrop'
import { primeBackdropForPanel } from '@/utils/backdropSnapshot'
import List, { type ItemT, type ListProps, type ListType } from './List'
// import InsetShadow from 'react-native-inset-shadow'

export interface SearchTipListProps<T> extends ListProps<T> {
  onPressBg?: () => void
}
/** 下拉面板静止时所在的窗口坐标（由宿主页面在 onLayout 时测量） */
export interface SearchTipListAnchor {
  x: number
  y: number
}
export interface SearchTipListType<T> {
  setList: (list: T[]) => void
  setHeight: (height: number, anchor?: SearchTipListAnchor) => void
}

const noop = () => {}

const Component = <T extends ItemT<T>>({ onPressBg = noop, ...props }: SearchTipListProps<T>, ref: Ref<SearchTipListType<T>>) => {
  const theme = useTheme()
  const translateY = useRef(new Animated.Value(0)).current
  const scaleY = useRef(new Animated.Value(0)).current
  const [visible, setVisible] = useState(false)
  const [animatePlayed, setAnimatPlayed] = useState(true)
  const listRef = useRef<ListType<T>>(null)
  const prevListRef = useRef<T[]>([])
  const heightRef = useRef(0)
  // 等截图的那一小段时间里列表可能已经被清空，用批次号让过期的 show 作废
  const showTokenRef = useRef(0)
  const [anchor, setAnchor] = useState<SearchTipListAnchor | null>(null)

  useImperativeHandle(ref, () => ({
    setList(list) {
      if (prevListRef.current.length) {
        if (!list.length) handleHide()
      } else if (list.length) handleShow()
      prevListRef.current = list
      requestAnimationFrame(() => {
        listRef.current?.setList(list)
      })
    },
    setHeight(height, nextAnchor) {
      heightRef.current = height
      if (nextAnchor == null) return
      setAnchor((prev) => {
        return prev != null && prev.x == nextAnchor.x && prev.y == nextAnchor.y ? prev : nextAnchor
      })
    },
  }))


  const handleShow = useCallback(() => {
    if (!heightRef.current) return
    const token = ++showTokenRef.current
    // 这个下拉是页面里的绝对定位层（不是 Modal），captureScreen 连它自己一起拍 ——
    // 先拍再挂，糊图里才是它背后那一帧；反过来拍到的画面里带着面板本身，一眼能看出换了底。
    void primeBackdropForPanel().then(() => {
      if (showTokenRef.current != token) return
      setVisible(true)
      setAnimatPlayed(false)
      requestAnimationFrame(() => {
        translateY.setValue(-heightRef.current / 2)
        scaleY.setValue(0)

        Animated.parallel([
        // Animated.timing(fade, {
        //   toValue: 1,
        //   duration: 300,
        //   useNativeDriver: true,
        // }),
          Animated.timing(translateY, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(scaleY, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start(() => {
          setAnimatPlayed(true)
        })
      })
    })
  }, [translateY, scaleY])

  const handleHide = useCallback(() => {
    showTokenRef.current += 1
    setAnimatPlayed(false)
    Animated.parallel([
      // Animated.timing(fade, {
      //   toValue: 0,
      //   duration: 200,
      //   useNativeDriver: true,
      // }),
      Animated.timing(translateY, {
        toValue: -heightRef.current / 2,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(scaleY, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start((finished) => {
      // console.log(finished)
      if (!finished) return
      setVisible(false)
      setAnimatPlayed(true)
    })
  }, [translateY, scaleY])


  const component = useMemo(() => (
    <Animated.View
      style={{
        ...styles.anima,
        transform: [
          { translateY },
          { scaleY },
        ],
      }}>
      <View style={{ ...styles.container, backgroundColor: theme['c-content-background'] }}>
        {
          // 壁纸模式下 c-content-background 是透明，不糊就是一行行字直接压在照片纹理上。
          // 这一块只占屏幕上半截、四周还看得见原图，压得太狠会像一个深色对话框 —— 模糊与压暗都比面板轻一档
          theme['is-wallpaper'] ? <GlassBackdrop restOffset={anchor} /> : null
        }
        <List ref={listRef} {...props} />
      </View>
      <View style={styles.blank} onTouchStart={onPressBg}></View>
    </Animated.View>
  ), [anchor, onPressBg, props, scaleY, theme, translateY])

  return !visible && animatePlayed ? null : component
}

export default forwardRef(Component) as
  <T,>(p: SearchTipListProps<T> & { ref?: Ref<SearchTipListType<T>> }) => JSX.Element | null

const styles = createStyle({
  anima: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: '100%',
    width: '100%',
    zIndex: 10,
  },
  container: {
    flex: 0,
    // flexGrow: 0,
    // borderBottomWidth: BorderWidths.normal,
    elevation: 2,
    maxHeight: '80%',
  },
  blank: {
    flex: 1,
    flexGrow: 1,
    // backgroundColor: 'transparent',
    // backgroundColor: 'rgba(0,0,0,0.2)',
  },
})
