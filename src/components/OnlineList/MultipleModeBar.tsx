import { useState, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react'
import { Animated, View, TouchableOpacity } from 'react-native'

import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { BorderWidths } from '@/theme'

export type SelectMode = 'single' | 'range'

export const MULTI_SELECT_BAR_HEIGHT = 36

export interface MultipleModeBarProps {
  onSwitchMode?: (mode: SelectMode) => void
  onSelectAll: (isAll: boolean) => void
  onExitSelectMode: () => void
  multiSelectStyle?: 'default' | 'mylist'
  selectedCount?: number
}
export interface MultipleModeBarType {
  show: () => void
  setIsSelectAll: (isAll: boolean) => void
  setSwitchMode: (mode: SelectMode) => void
  exitSelectMode: () => void
}

export default forwardRef<MultipleModeBarType, MultipleModeBarProps>(({ onSelectAll, onSwitchMode, onExitSelectMode, multiSelectStyle = 'default', selectedCount = 0 }, ref) => {
  // const isGetDetailFailedRef = useRef(false)
  const [visible, setVisible] = useState(false)
  const [animatePlayed, setAnimatPlayed] = useState(true)
  const animFade = useRef(new Animated.Value(0)).current
  const animTranslateY = useRef(new Animated.Value(0)).current
  const [selectMode, setSelectMode] = useState<SelectMode>('single')
  const [isSelectAll, setIsSelectAll] = useState(false)
  const theme = useTheme()

  useImperativeHandle(ref, () => ({
    show() {
      handleShow()
    },
    setIsSelectAll(isAll) {
      setIsSelectAll(isAll)
    },
    setSwitchMode(mode: SelectMode) {
      setSelectMode(mode)
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
    height: MULTI_SELECT_BAR_HEIGHT,
    // backgroundColor: theme['c-content-background'],
    borderBottomColor: theme['c-border-background'],
    opacity: animFade, // Bind opacity to animated value
    transform: [
      { translateY: animTranslateY },
    ],
  }), [animFade, animTranslateY, theme])

  const handleSelectAll = useCallback(() => {
    const selectAll = !isSelectAll
    setIsSelectAll(selectAll)
    onSelectAll(selectAll)
  }, [isSelectAll, onSelectAll])

  const component = useMemo(() => {
    if (multiSelectStyle == 'mylist') {
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
    }
    return (
      <Animated.View style={animaStyle}>
        <View style={styles.switchBtn}>
          <Button onPress={() => { onSwitchMode?.('single') }} style={{ ...styles.btn, backgroundColor: selectMode == 'single' ? theme['c-button-background'] : 'rgba(0,0,0,0)' }}>
            <Text color={theme['c-button-font']}>{global.i18n.t('list_select_single')}</Text>
          </Button>
          <Button onPress={() => { onSwitchMode?.('range') }} style={{ ...styles.btn, backgroundColor: selectMode == 'range' ? theme['c-button-background'] : 'rgba(0,0,0,0)' }}>
            <Text color={theme['c-button-font']}>{global.i18n.t('list_select_range')}</Text>
          </Button>
        </View>
        <TouchableOpacity onPress={handleSelectAll} style={styles.btn}>
          <Text color={theme['c-button-font']}>{global.i18n.t(isSelectAll ? 'list_select_unall' : 'list_select_all')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onExitSelectMode} style={styles.btn}>
          <Text color={theme['c-button-font']}>{global.i18n.t('list_select_cancel')}</Text>
        </TouchableOpacity>
      </Animated.View>
    )
  }, [animaStyle, selectMode, theme, handleSelectAll, isSelectAll, onExitSelectMode, onSwitchMode, multiSelectStyle, selectedCount])

  return !visible && animatePlayed ? null : component
})

const styles = createStyle({
  container: {
    width: '100%',
    flexShrink: 0,
    flexDirection: 'row',
    borderBottomWidth: BorderWidths.normal,
  },
  switchBtn: {
    flexDirection: 'row',
    flex: 1,
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
