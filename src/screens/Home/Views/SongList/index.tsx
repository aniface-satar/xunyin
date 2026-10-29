import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { View } from 'react-native'
import settingState from '@/store/setting/state'
import Content, { type SongListProps, type SongListType } from './Content'
import TagList from './TagList'
import { useTheme } from '@/store/theme/hook'
import DrawerLayoutFixed, { type DrawerLayoutFixedType } from '@/components/common/DrawerLayoutFixed'
import GlassBackdrop from '@/components/common/GlassBackdrop'
import { primeBackdropForPanel } from '@/utils/backdropSnapshot'
import { COMPONENT_IDS } from '@/config/constant'
import { scaleSizeW } from '@/utils/pixelRatio'
import { createStyle } from '@/utils/tools'
import type { InitState as CommonState } from '@/store/common/state'

const MAX_WIDTH = scaleSizeW(560)

interface TagDrawerGlassType {
  remeasure: () => void
}

/**
 * 标签抽屉的玻璃层。
 *
 * 壁纸模式下 `c-content-background` 是全透明的（见 utils/wallpaper/palette.ts），抽屉那块底板
 * 就跟着透明 —— 一整列白色标签直接压在照片纹理上，每一行都要在图的明暗里找字。弹窗
 * （Dialog / Menu / 更新窗口）早就按同一配方处理过：糊掉壁纸 + 压暗，糊图按窗口坐标铺，
 * 与页面上的壁纸对得上。抽屉缺的就是这层，补上即可与弹窗观感一致。
 *
 * 单独抽成组件，是为了把"重测批次"这个 state 关在抽屉子树里：抽屉一次开合会触发
 * 拖动 / 沉降 / 落定三次状态回调，若把 state 提到 SongList 上，每次都要连歌单长列表
 * 一起重渲染。
 */
const TagDrawerGlass = forwardRef<TagDrawerGlassType>((_, ref) => {
  const theme = useTheme()
  const [measureKey, setMeasureKey] = useState(0)
  // 抽屉关闭时它整块在屏幕外，糊底（一张整屏壁纸的模糊位图）没必要一直挂着；
  // 首次打开才挂载，之后不卸载 —— 卸载会让滑出动画里的糊底先闪掉一块。
  const [everOpened, setEverOpened] = useState(false)

  useEffect(() => {
    const handleShow = () => { setEverOpened(true) }
    global.app_event.on('showSonglistTagList', handleShow)
    return () => {
      global.app_event.off('showSonglistTagList', handleShow)
    }
  }, [])

  useImperativeHandle(ref, () => ({
    remeasure() {
      setMeasureKey(key => key + 1)
    },
  }), [])

  // 普通主题不插：那边抽屉本来就是实白底，多铺一层糊图只会改变观感
  return theme['is-wallpaper'] && everOpened
    ? <GlassBackdrop measureKey={measureKey} />
    : null
})

const SongList = forwardRef<SongListType, SongListProps>(({ initialSource }, ref) => {
  const drawer = useRef<DrawerLayoutFixedType>(null)
  const glassRef = useRef<TagDrawerGlassType>(null)
  const theme = useTheme()

  useEffect(() => {
    const handleFixDrawer = (id: CommonState['navActiveId']) => {
      if (id == 'nav_discover') drawer.current?.fixWidth()
    }
    const handleShow = () => {
      // 抽屉与页面同属 Activity window，滑入后再截屏会把抽屉自己也拍进去。
      // 先在关闭状态拍好真正的背后页面，再打开。
      void primeBackdropForPanel().then(() => {
        requestAnimationFrame(() => {
          drawer.current?.openDrawer()
        })
      })
    }
    const handleHide = () => {
      drawer.current?.closeDrawer()
    }

    const handleHomeTabReset = () => {
      drawer.current?.closeDrawer()
    }

    global.state_event.on('navActiveIdUpdated', handleFixDrawer)
    global.app_event.on('showSonglistTagList', handleShow)
    global.app_event.on('hideSonglistTagList', handleHide)
    global.app_event.on('homeTabReset', handleHomeTabReset)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleFixDrawer)
      global.app_event.off('showSonglistTagList', handleShow)
      global.app_event.off('hideSonglistTagList', handleHide)
      global.app_event.off('homeTabReset', handleHomeTabReset)
    }
  }, [])

  const handleDrawerStateChange = useCallback(() => {
    // 抽屉是整块平移的原生视图：关闭态下导航视图在屏幕外（左抽屉 left = -抽屉宽），
    // 所以关闭时测出来的坐标是错的。状态一变（拖动 / 沉降 / 落定）就重新跟帧测一轮，
    // 糊图跟着滑到位，而不是等抽屉停稳后才"跳"正。
    glassRef.current?.remeasure()
  }, [])

  const navigationView = useCallback(() => (
    <View style={styles.navigationView}>
      <TagDrawerGlass ref={glassRef} />
      <TagList />
    </View>
  ), [])
  // console.log('render drawer content')

  return (
    <DrawerLayoutFixed
      ref={drawer}
      visibleNavNames={[COMPONENT_IDS.home]}
      widthPercentage={0.8}
      widthPercentageMax={MAX_WIDTH}
      drawerPosition={settingState.setting['common.drawerLayoutPosition']}
      renderNavigationView={navigationView}
      onDrawerStateChanged={handleDrawerStateChange}
      drawerBackgroundColor={theme['c-content-background']}
      style={{ elevation: 1 }}
    >
      <Content ref={ref} initialSource={initialSource} />
    </DrawerLayoutFixed>
  )
})

export default SongList

export type { SongListProps, SongListType }

const styles = createStyle({
  navigationView: {
    flex: 1,
  },
})
