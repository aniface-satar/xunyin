import { memo, useEffect } from 'react'
import { View, AppState } from 'react-native'
import { screenkeepAwake, screenUnkeepAwake } from '@/utils/nativeModules/utils'
import StatusBar from '@/components/common/StatusBar'
import MoreBtn from './MoreBtn'

import Header from './components/Header'
import { setComponentId } from '@/core/common'
import { COMPONENT_IDS } from '@/config/constant'
import PageContent from '@/components/PageContent'
import commonState, { type InitState as CommonState } from '@/store/common/state'
import { usePlayerMusicInfo } from '@/store/player/hook'
import { useGlassColors } from '@/utils/hooks/useGlassColors'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'

import Pic from './Pic'
import Lyric from './Lyric'
import Player from './Player'
import { createStyle } from '@/utils/tools'
import { useStatusbarHeight } from '@/store/common/hook'

const SongTitle = memo(() => {
  const musicInfo = usePlayerMusicInfo()
  const glassColors = useGlassColors()

  return (
    <View style={styles.titleBox}>
      <Text numberOfLines={2} style={styles.songName} size={17} color={glassColors.text}>
        {musicInfo.name}
      </Text>
      <Text numberOfLines={1} style={styles.singerName} size={13} color={glassColors.muted}>
        {musicInfo.singer}
      </Text>
    </View>
  )
})

export default memo(({ componentId }: { componentId: string }) => {
  const statusBarHeight = useStatusbarHeight()
  const theme = useTheme()

  useEffect(() => {
    setComponentId(COMPONENT_IDS.playDetail, componentId)
    screenkeepAwake()
    let appstateListener = AppState.addEventListener('change', (state) => {
      switch (state) {
        case 'active':
          if (!commonState.componentIds.comment) screenkeepAwake()
          break
        case 'background':
          screenUnkeepAwake()
          break
      }
    })

    const handleComponentIdsChange = (ids: CommonState['componentIds']) => {
      if (ids.comment) screenUnkeepAwake()
      else if (AppState.currentState == 'active') screenkeepAwake()
    }

    global.state_event.on('componentIdsUpdated', handleComponentIdsChange)

    return () => {
      global.state_event.off('componentIdsUpdated', handleComponentIdsChange)
      appstateListener.remove()
      screenUnkeepAwake()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <PageContent>
      <StatusBar />
      <View style={{ ...styles.container, paddingTop: statusBarHeight }}>
        <View style={styles.left}>
          <Header />
          <View style={styles.leftContent}>
            <MoreBtn />
            <Pic componentId={componentId} />
            <SongTitle />
          </View>
          <Player />
        </View>
        <View style={{ ...styles.right, borderLeftColor: theme['c-border-background'] }}>
          <Lyric />
        </View>
      </View>
    </PageContent>
  )
})

const styles = createStyle({
  container: {
    flex: 1,
    flexDirection: 'row',
  },
  left: {
    width: '40%',
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: 'space-between',
    paddingBottom: 16,
  },
  leftContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 20,
    paddingRight: 20,
  },
  titleBox: {
    width: '100%',
    alignItems: 'center',
    marginTop: 12,
    paddingLeft: 8,
    paddingRight: 8,
  },
  songName: {
    textAlign: 'center',
  },
  singerName: {
    textAlign: 'center',
    marginTop: 4,
  },
  right: {
    width: '60%',
    flexGrow: 0,
    flexShrink: 0,
    borderLeftWidth: 1,
  },
})
