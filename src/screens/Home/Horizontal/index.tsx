import { View } from 'react-native'
import Aside from './Aside'
import PlayerBar from '@/components/player/PlayerBar'
import StatusBar from '@/components/common/StatusBar'
import Header from './Header'
import Main from './Main'
import DetailStack from '../DetailStack'
import { useHomeDetailStack } from '@/store/homeDetail/hook'
import { createStyle } from '@/utils/tools'

const styles = createStyle({
  root: {
    flex: 1,
  },
  container: {
    flex: 1,
    flexDirection: 'row',
  },
  content: {
    flex: 1,
    overflow: 'hidden',
  },
  detailContainer: {
    flex: 1,
    overflow: 'hidden',
  },
})

export default () => {
  const hasDetail = useHomeDetailStack().length > 0

  return (
    <View style={styles.root}>
      <StatusBar />
      {
        hasDetail
          ? <View style={styles.detailContainer}><DetailStack /></View>
          : (
            <View style={styles.container}>
              <Aside />
              <View style={styles.content}>
                <Header />
                <Main />
              </View>
            </View>
            )
      }
      <PlayerBar isHome />
    </View>
  )
}
