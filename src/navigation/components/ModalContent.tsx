import { View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import GlassBackdrop from '@/components/common/GlassBackdrop'
// import { useWindowSize } from '@/utils/hooks'
const HEADER_HEIGHT = 20

interface Props {
  children: React.ReactNode
}


export default ({ children }: Props) => {
  const theme = useTheme()

  return (
    <View style={{ ...styles.centeredView, backgroundColor: 'rgba(0,0,0,0.35)' }}>
      <View style={{ ...styles.modalView, backgroundColor: theme['c-content-background'], overflow: 'hidden' }}>
        {
          // 弹层自己的底：壁纸模式下这块实底被换成了透明（`c-content-background`），
          // 更新窗口整篇是更新日志的小字，不糊就等于把那些行摊在照片纹理上找。
          // 糊图铺满整屏、按窗口坐标对齐，所以窗口里那一块的纹理和背后的壁纸接得上 ——
          // 与 Dialog / Popup 那一手同一个配方。普通主题不插：那边本来就是实底。
          theme['is-wallpaper'] ? <GlassBackdrop style={{ borderRadius: 4 }} /> : null
        }
        <View style={{ ...styles.header, backgroundColor: theme['c-primary-light-100-alpha-100'] }}></View>
        {children}
      </View>
    </View>
  )
}


const styles = createStyle({
  centeredView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalView: {
    maxWidth: '90%',
    minWidth: '60%',
    maxHeight: '78%',
    // backgroundColor: 'white',
    borderRadius: 4,
    // shadowColor: '#000',
    // shadowOffset: {
    //   width: 0,
    //   height: 2,
    // },
    // shadowOpacity: 0.25,
    // shadowRadius: 4,
    elevation: 3,
  },
  header: {
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: 'row',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    height: HEADER_HEIGHT,
  },
})
