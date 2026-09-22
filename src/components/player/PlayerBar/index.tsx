import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, PanResponder, View, type LayoutChangeEvent } from 'react-native'
import { useKeyboard } from '@/utils/hooks'
import { useNavActiveId } from '@/store/common/hook'

import Pic from './components/Pic'
import Title from './components/Title'
import PlayInfo from './components/PlayInfo'
import ControlBtn from './components/ControlBtn'
import { createStyle } from '@/utils/tools'
import { useSettingValue } from '@/store/setting/hook'
import { usePlayerOverlay } from '@/components/player/PlayerOverlay'
import type { PlayerControlLayout, PlayerRect, PlayerTextLayout } from '@/components/player/PlayerOverlay'
import GlassBackdrop from '@/components/common/GlassBackdrop'
import { useTheme } from '@/store/theme/hook'
import { BorderWidths } from '@/theme'


export default memo(({ isHome = false }: { isHome?: boolean }) => {
  // const { onLayout, ...layout } = useLayout()
  const { keyboardShown } = useKeyboard()
  const activeId = useNavActiveId()
  const autoHidePlayBar = useSettingValue('common.autoHidePlayBar')
  const playerOverlay = usePlayerOverlay()
  const theme = useTheme()
  const barRef = useRef<View>(null)
  const [progressVisible, setProgressVisible] = useState(true)
  const [barLayout, setBarLayout] = useState({ x: 0, y: 0, width: 0, height: 0 })
  const [picLayout, setPicLayout] = useState({ x: 0, y: 0, width: 0, height: 0 })
  const [titleLayout, setTitleLayout] = useState<PlayerTextLayout | null>(null)
  const [artistLayout, setArtistLayout] = useState<PlayerTextLayout | null>(null)
  const [progressLayout, setProgressLayout] = useState<PlayerRect | null>(null)
  const [controlLayout, setControlLayout] = useState<PlayerControlLayout | null>(null)
  const playerOverlayRef = useRef(playerOverlay)
  playerOverlayRef.current = playerOverlay
  const overlayProgress = playerOverlay?.progress
  const sourceVisible = playerOverlay?.sourceVisible ?? true
  const barVisibility = useMemo(() => overlayProgress?.interpolate({
    inputRange: [0.9, 1],
    outputRange: [0, 1],
  }) ?? 1, [overlayProgress])
  useEffect(() => {
    if (!overlayProgress) return
    const listenerId = overlayProgress.addListener(({ value }) => {
      setProgressVisible((visible) => {
        const nextVisible = value > 0.99
        return visible == nextVisible ? visible : nextVisible
      })
    })
    return () => {
      overlayProgress.removeListener(listenerId)
    }
  }, [overlayProgress])
  const barVisible = sourceVisible && progressVisible

  useEffect(() => {
    if (!playerOverlayRef.current || !barLayout.width || !picLayout.width || !titleLayout || !artistLayout || !progressLayout || !controlLayout) return
    barRef.current?.measureInWindow((x, y, width, height) => {
      if (!width || !height) return
      playerOverlayRef.current?.setSource({
        bar: { x, y, width, height },
        pic: picLayout,
        title: titleLayout,
        artist: artistLayout,
        progress: progressLayout,
        controls: controlLayout,
      })
    })
  }, [artistLayout, barLayout.height, barLayout.width, controlLayout, picLayout, progressLayout, titleLayout])

  const handleBarLayout = useCallback((event: LayoutChangeEvent) => {
    setBarLayout(event.nativeEvent.layout)
  }, [])

  const handlePicLayout = useCallback((layout: { x: number, y: number, width: number, height: number }) => {
    setPicLayout(layout)
  }, [])

  const handleTitleLayout = useCallback((layout: PlayerTextLayout) => {
    setTitleLayout(layout)
  }, [])

  const handleArtistLayout = useCallback((layout: PlayerTextLayout) => {
    setArtistLayout(layout)
  }, [])

  const handleProgressLayout = useCallback((layout: PlayerRect) => {
    setProgressLayout(layout)
  }, [])

  const handleControlLayout = useCallback((layout: PlayerControlLayout) => {
    setControlLayout(layout)
  }, [])

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponderCapture: () => false,
    onMoveShouldSetPanResponderCapture: (_event, gestureState) => {
      return Boolean(playerOverlayRef.current) &&
        gestureState.dy < -8 &&
        Math.abs(gestureState.dy) > Math.abs(gestureState.dx)
    },
    onPanResponderGrant: () => {
      playerOverlayRef.current?.startGesture()
    },
    onPanResponderMove: (_event, gestureState) => {
      playerOverlayRef.current?.updateGesture(-gestureState.dy)
    },
    onPanResponderRelease: (_event, gestureState) => {
      playerOverlayRef.current?.endGesture(-gestureState.dy, gestureState.vy)
    },
    onPanResponderTerminate: (_event, gestureState) => {
      playerOverlayRef.current?.endGesture(-gestureState.dy, gestureState.vy)
    },
  })).current

  const playerComponent = useMemo(() => (
    <Animated.View
      ref={barRef}
      onLayout={handleBarLayout}
      style={{
        ...styles.container,
        borderTopColor: theme['c-border-background'],
        backgroundColor: theme['c-content-background'],
        zIndex: 3,
        opacity: barVisibility,
      }}
      pointerEvents={barVisible ? 'auto' : 'none'}
      {...panResponder.panHandlers}
    >
      <GlassBackdrop blurRadius={24} overlayOpacity={0.58} />
      <View style={styles.mainRow}>
        <Pic isHome={isHome} onLayout={handlePicLayout} />
        <View style={styles.center}>
          <Title isHome={isHome} onTitleLayout={handleTitleLayout} onArtistLayout={handleArtistLayout} />
          <PlayInfo isHome={isHome} onProgressLayout={handleProgressLayout} />
        </View>
        <View style={styles.right}>
          <ControlBtn onControlLayout={handleControlLayout} />
        </View>
      </View>
    </Animated.View>
  ), [barVisibility, barVisible, handleArtistLayout, handleBarLayout, handleControlLayout, handlePicLayout, handleProgressLayout, handleTitleLayout, isHome, panResponder.panHandlers, theme])

  // console.log('render pb')

  return keyboardShown && (autoHidePlayBar || activeId == 'nav_search') ? null : playerComponent
})


const styles = createStyle({
  container: {
    width: '100%',
    borderTopWidth: BorderWidths.normal,
    paddingTop: 10,
    paddingBottom: 6,
    paddingHorizontal: 12,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    overflow: 'hidden',
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  center: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 10,
    paddingRight: 6,
    justifyContent: 'center',
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 0,
    flexShrink: 0,
  },
})
