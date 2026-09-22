import { TouchableOpacity, View } from 'react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import { navigations } from '@/navigation'
import { usePlayerMusicInfo } from '@/store/player/hook'
import playerState from '@/store/player/state'
import Text from '@/components/common/Text'
import { usePlayerOverlay } from '@/components/player/PlayerOverlay'
import commonState from '@/store/common/state'
import { LIST_IDS } from '@/config/constant'
import { createStyle } from '@/utils/tools'
import { useGlassColors } from '@/utils/hooks/useGlassColors'
import SynchronizedMarquee, { useSynchronizedMarquee } from '@/components/common/SynchronizedMarquee'
import type { PlayerTextLayout } from '@/components/player/PlayerOverlay'


interface TitleProps {
  isHome: boolean
  onTitleLayout?: (layout: PlayerTextLayout) => void
  onArtistLayout?: (layout: PlayerTextLayout) => void
}

const MARQUEE_START_DELAY = 2000

const measureInWindow = (
  ref: React.RefObject<View | null>,
  onLayout?: (layout: PlayerTextLayout) => void,
) => {
  ref.current?.measureInWindow((x, y, width, height) => {
    onLayout?.({ x, y, width, height })
  })
}


export default ({ isHome, onTitleLayout, onArtistLayout }: TitleProps) => {
  // const { t } = useTranslation()
  const musicInfo = usePlayerMusicInfo()
  const glassColors = useGlassColors()
  const playerOverlay = usePlayerOverlay()
  const marquee = useSynchronizedMarquee({ lineCount: 1 })
  const titleRef = useRef<View>(null)
  const artistRef = useRef<View>(null)
  const overlayVisible = playerOverlay?.sourceVisible ?? true
  const barSettled = playerOverlay?.barSettled ?? true
  const [marqueeActive, setMarqueeActive] = useState(false)

  useEffect(() => {
    if (!overlayVisible || !barSettled) {
      setMarqueeActive(false)
      return
    }

    const timeoutId = setTimeout(() => {
      setMarqueeActive(true)
    }, MARQUEE_START_DELAY)
    return () => {
      clearTimeout(timeoutId)
    }
  }, [barSettled, overlayVisible])

  const handlePress = () => {
    // console.log('')
    // console.log(playMusicInfo)
    if (!musicInfo.id) return
    if (playerOverlay) {
      playerOverlay.open()
      return
    }
    navigations.pushPlayDetailScreen(commonState.componentIds.home!)
    // toast(global.i18n.t('play_detail_todo_tip'), 'long')
  }

  const handleLongPress = () => {
    const listId = playerState.playMusicInfo.listId
    if (!listId || listId == LIST_IDS.DOWNLOAD) return
    global.app_event.jumpListPosition()
  }
  // console.log('render title')

  const handleTitleLayout = useCallback(() => {
    measureInWindow(titleRef, onTitleLayout)
  }, [onTitleLayout])

  const handleArtistLayout = useCallback(() => {
    measureInWindow(artistRef, onArtistLayout)
  }, [onArtistLayout])
  // console.log(playMusicInfo)
  return (
    <TouchableOpacity style={styles.container} onLongPress={handleLongPress} onPress={handlePress} activeOpacity={0.7} >
      <View style={styles.titleWrap}>
        <SynchronizedMarquee id="music" controller={marquee} active={marqueeActive}>
          <Text size={15} color={glassColors.text} style={styles.text}>
            {musicInfo.name}
            {
              musicInfo.singer
                ? <Text size={15} color={glassColors.muted}>{` - ${musicInfo.singer}`}</Text>
                : null
            }
          </Text>
        </SynchronizedMarquee>
        <View style={styles.measureLayer} pointerEvents="none" collapsable={false}>
          <View ref={titleRef} style={styles.measureItem} onLayout={handleTitleLayout} collapsable={false}>
            <Text size={15} color={glassColors.text} style={styles.text}>{musicInfo.name}</Text>
          </View>
          {
            musicInfo.singer && <Text size={15} color={glassColors.muted} style={[styles.text, styles.separator]}>{' - '}</Text>
          }
          <View ref={artistRef} style={styles.measureItem} onLayout={handleArtistLayout} collapsable={false}>
            <Text size={15} color={glassColors.muted} style={styles.text}>{musicInfo.singer}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  )
}
// const Singer = () => {
//   const playMusicInfo = useGetter('player', 'playMusicInfo')
//   return (
//     <View style={{ flexGrow: 0, flexShrink: 0 }}>
//       <Text style={{ width: '100%', color: AppColors.normal }} numberOfLines={1}>
//         {playMusicInfo ? playMusicInfo.musicInfo.singer : ''}
//       </Text>
//     </View>
//   )
// }
// const MusicName = () => {
//   const playMusicInfo = useGetter('player', 'playMusicInfo')
//   return (
//     <View style={{ flexGrow: 0, flexShrink: 1 }}>
//       <Text style={{ width: '100%', color: AppColors.normal }} numberOfLines={1}>
//         {playMusicInfo ? playMusicInfo.musicInfo.name : '^-^'}
//       </Text>
//     </View>
//   )
// }

const styles = createStyle({
  container: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 26,
    justifyContent: 'flex-start',
    paddingHorizontal: 3,
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
  },
  text: {
    includeFontPadding: false,
  },
  separator: {
    flexShrink: 0,
  },
  measureLayer: {
    alignItems: 'center',
    bottom: 0,
    flexDirection: 'row',
    left: 0,
    opacity: 0,
    position: 'absolute',
    top: 0,
  },
  measureItem: {
    flexDirection: 'row',
    flexShrink: 0,
  },
})
