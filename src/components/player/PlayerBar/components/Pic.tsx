import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useCallback, useRef } from 'react'
import { navigations } from '@/navigation'
import { usePlayerMusicInfo } from '@/store/player/hook'
import { scaleSizeH } from '@/utils/pixelRatio'
import commonState from '@/store/common/state'
import playerState from '@/store/player/state'
import { LIST_IDS, NAV_SHEAR_NATIVE_IDS } from '@/config/constant'
import Image from '@/components/common/Image'
import { usePlayerOverlay } from '@/components/player/PlayerOverlay'
import { setLoadErrorPicUrl, setMusicInfo } from '@/core/player/playInfo'
import { BAR_COVER_RADIUS } from '@/screens/PlayDetail/Vertical/layout'
import { BorderWidths } from '@/theme'
import { useTheme } from '@/store/theme/hook'

const PIC_HEIGHT = scaleSizeH(46)

const styles = StyleSheet.create({

  image: {
    width: PIC_HEIGHT,
    height: PIC_HEIGHT,
    borderRadius: BAR_COVER_RADIUS,
  },
})

interface PicProps {
  isHome: boolean
  onLayout?: (layout: { x: number, y: number, width: number, height: number }) => void
}

export default ({ isHome, onLayout }: PicProps) => {
  const musicInfo = usePlayerMusicInfo()
  const theme = useTheme()
  const playerOverlay = usePlayerOverlay()
  const picRef = useRef<View>(null)
  const handleLayout = useCallback(() => {
    picRef.current?.measureInWindow((x, y, width, height) => {
      onLayout?.({ x, y, width, height })
    })
  }, [onLayout])
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
    if (!isHome) return
    const listId = playerState.playMusicInfo.listId
    if (!listId || listId == LIST_IDS.DOWNLOAD) return
    global.app_event.jumpListPosition()
  }

  const handleError = useCallback((url: string | number) => {
    setLoadErrorPicUrl(url as string)
    setMusicInfo({
      pic: null,
    })
  }, [])

  return (
    <View ref={picRef} onLayout={handleLayout}>
      <TouchableOpacity onLongPress={handleLongPress} onPress={handlePress} activeOpacity={0.7} >
        <Image
          url={musicInfo.pic}
          nativeID={NAV_SHEAR_NATIVE_IDS.playDetail_pic}
          style={{
            ...styles.image,
            backgroundColor: theme['c-content-background'],
            elevation: 18,
            shadowColor: '#000',
            shadowOpacity: 0.34,
            shadowOffset: { width: 0, height: 8 },
            shadowRadius: 18,
            borderWidth: BorderWidths.normal,
            borderColor: theme['c-border-background'],
          }}
          onError={handleError}
        />
      </TouchableOpacity>
    </View>
  )
}


// const styles = StyleSheet.create({
//   playInfoImg: {

//   },
// })
