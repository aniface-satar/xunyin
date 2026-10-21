import { View } from 'react-native'
import Header from './Header'
import Main from './Main'
import { HomeDetailStacks } from '../DetailStack'
import BottomTabBar from './BottomTabBar'
import PlayerBar from '@/components/player/PlayerBar'
import { useHomeDetailStack } from '@/store/homeDetail/hook'
import { useNavActiveId } from '@/store/common/hook'
import { createStyle } from '@/utils/tools'

const Content = () => {
  const activeId = useNavActiveId()
  const hasDetail = useHomeDetailStack().length > 0
  const detailVisible = hasDetail && activeId != 'nav_setting'

  return (
    <View style={styles.container}>
      <View style={styles.body}>
        <View
          style={detailVisible ? styles.mainCovered : styles.main}
          pointerEvents={detailVisible ? 'none' : 'auto'}
        >
          <Header />
          <View style={styles.mainVisible}>
            <Main />
          </View>
        </View>
        {
          // 详情页只能用覆盖层，不能把 Main 设为 display:none：
          // PagerView 被摘下再挂回来会显示第 0 页，而原生页码未变导致 setPage 成为空操作
        }
        <View style={styles.detailContainer} pointerEvents={detailVisible ? 'auto' : 'none'}>
          <HomeDetailStacks activeId={activeId} />
        </View>
      </View>
      <PlayerBar isHome />
      <BottomTabBar />
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
  main: {
    flex: 1,
  },
  // 必须保留布局：display:'none' 会让 PagerView 摘下再挂回来时落回第 0 页
  mainCovered: {
    flex: 1,
    opacity: 0,
  },
  mainVisible: {
    flex: 1,
  },
  detailContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
  },
})

export default Content
