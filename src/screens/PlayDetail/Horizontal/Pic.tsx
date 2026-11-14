import { memo, useEffect, useState } from 'react'
import { View } from 'react-native'
import { usePlayerMusicInfo } from '@/store/player/hook'
import { useWindowSize } from '@/utils/hooks'
import { useNavigationComponentDidAppear } from '@/navigation'
import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant'
import { createStyle } from '@/utils/tools'
import { HEADER_HEIGHT } from './components/Header'
import Image from '@/components/common/Image'
import { useStatusbarHeight } from '@/store/common/hook'
import commonState from '@/store/common/state'

export default memo(({ componentId }: { componentId: string }) => {
  const musicInfo = usePlayerMusicInfo()
  const { width: winWidth, height: winHeight } = useWindowSize()
  const statusBarHeight = useStatusbarHeight()

  const [animated, setAnimated] = useState(!!commonState.componentIds.playDetail)
  const [pic, setPic] = useState(musicInfo.pic)
  useEffect(() => {
    if (animated) setPic(musicInfo.pic)
  }, [musicInfo.pic, animated])

  useNavigationComponentDidAppear(componentId, () => {
    setAnimated(true)
  })

  let imgWidth = Math.min(
    (winWidth * 0.4 - 40) * 0.72,
    (winHeight - statusBarHeight - HEADER_HEIGHT) * 0.44,
    240,
  )
  imgWidth -= imgWidth * (global.lx.fontSize - 1) * 0.2
  imgWidth = Math.max(imgWidth, 120)

  return (
    <View style={{ ...styles.container, height: imgWidth + 12 }}>
      <View style={{ ...styles.content, elevation: animated ? 4 : 0 }}>
        <Image
          url={pic}
          nativeID={NAV_SHEAR_NATIVE_IDS.playDetail_pic}
          style={{
            width: imgWidth,
            height: imgWidth,
            borderRadius: 14,
          }}
        />
      </View>
    </View>
  )
})

const styles = createStyle({
  container: {
    flexShrink: 1,
    flexGrow: 0,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  content: {
    backgroundColor: 'rgba(0,0,0,0)',
    borderRadius: 14,
  },
})
