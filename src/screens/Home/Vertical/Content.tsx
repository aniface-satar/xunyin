import { View } from 'react-native'
import Header from './Header'
import Main from './Main'
import DetailStack from '../DetailStack'
import BottomTabBar from './BottomTabBar'
import PlayerBar from '@/components/player/PlayerBar'
import { useHomeDetailStack } from '@/store/homeDetail/hook'
import { createStyle } from '@/utils/tools'

const Content = () => {
  const hasDetail = useHomeDetailStack().length > 0

  return (
    <View style={styles.container}>
      {
        hasDetail
          ? <View style={styles.detailContainer}><DetailStack /></View>
          : (
              <>
                <Header />
                <View style={styles.mainVisible}>
                  <Main />
                </View>
              </>
            )
      }
      <PlayerBar isHome />
      <BottomTabBar />
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  detailContainer: {
    flex: 1,
    overflow: 'hidden',
  },
  mainVisible: {
    flex: 1,
  },
})

export default Content
