import { useState, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react'
import { Animated, View, TouchableOpacity } from 'react-native'

import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { BorderWidths } from '@/theme'

export type SelectMode = 'single' | 'range'

export interface MultipleModeBarProps {
  onSelectAll: (isAll: boolean) => void
  selectedCount: number
}
export interface MultipleModeBarType {
  show: () => void
  setVisibleBar: (visible: boolean) => void
  setIsSelectAll: (isAll: boolean) => void
  exitSelectMode: () => void
}

export default forwardRef<MultipleModeBarType, MultipleModeBarProps>(({ onSelectAll, selectedCount }, ref) => {
  // const isGetDetailFailedRef = useRef(false)
  const [visible, setVisible] = useState(false)
  const [animatePlayed, setAnimatPlayed] = useState(true)
  const animFade = useRef(new Animated.Value(0)).current
  const animTranslateY = useRef(new Animated.Value(0)).current
  const [isSelectAll, setIsSelectAll] = useState(false)
  const [visibleBar, setVisibleBar] = useState(true)
  const theme = useTheme()

  useImperativeHandle(ref, () => ({
    show() {
      handleShow()
    },
    setVisibleBar(visible) {
      setVisibleBar(visible)
    },
    setIsSelectAll(isAll) {
      setIsSelectAll(isAll)
    },
    exitSelectMode() {
      handleHide()
    },
  }))

  const handleShow = useCallback(() => {
    // console.log('show List')
    setVisible(true)
    setAnimatPlayed(false)
    requestAnimationFrame(() => {
      animTranslateY.setValue(-20)

      Animated.parallel([
        Animated.timing(animFade, {
          toValue: 0.92,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(animTranslateY, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setAnimatPlayed(true)
      })
    })
  }, [animFade, animTranslateY])

  const handleHide = useCallback(() => {
    setAnimatPlayed(false)
    Animated.parallel([
      Animated.timing(animFade, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(animTranslateY, {
        toValue: -20,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(finished => {
      if (!finished) return
      setVisible(false)
      setAnimatPlayed(true)
    })
  }, [animFade, animTranslateY])


  const animaStyle = useMemo(() => ({
    ...styles.container,
    // backgroundColor: theme['c-content-background'],
    borderBottomColor: theme['c-border-background'],
    opacity: visibleBar ? animFade : 0, // Bind opacity to animated value
    transform: [
      { translateY: animTranslateY },
    ],
  }), [animFade, animTranslateY, theme, visibleBar])

  const handleSelectAll = useCallback(() => {
    const selectAll = !isSelectAll
    setIsSelectAll(selectAll)
    onSelectAll(selectAll)
  }, [isSelectAll, onSelectAll])

  const component = useMemo(() => {
    return (
      <Animated.View style={animaStyle}>
        <View style={styles.countBox}>
          <Text size={13} color={theme['c-button-font']}>{global.i18n.t('list_select_selected_count', { count: selectedCount })}</Text>
        </View>
        <TouchableOpacity onPress={handleSelectAll} style={styles.btn}>
          <Text color={theme['c-button-font']}>{global.i18n.t(isSelectAll ? 'list_select_unall' : 'list_select_all')}</Text>
        </TouchableOpacity>

      </Animated.View>
    )
  }, [animaStyle, theme, handleSelectAll, isSelectAll, selectedCount])

  return !visible && animatePlayed ? null : component
})

const styles = createStyle({
  container: {
    width: '100%',
    height: 36,
    flexShrink: 0,
    flexDirection: 'row',
    borderBottomWidth: BorderWidths.normal,
  },
  countBox: {
    flex: 1,
    paddingLeft: 18,
    justifyContent: 'center',
  },
  btn: {
    // flex: 1,
    paddingLeft: 18,
    paddingRight: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
