// import { createStyle } from '@/utils/tools'
import { useImperativeHandle, forwardRef, useRef, useState, useMemo } from 'react'
import { Modal, TouchableWithoutFeedback, View, type ModalProps as _ModalProps } from 'react-native'
import { useStatusbarHeight } from '@/store/common/hook'
import { primeBackdropForPanel } from '@/utils/backdropSnapshot'
// import { useWindowSize } from '@/utils/hooks'

// const styles = createStyle({
//   container: {
//     flex: 1,
//   },
//   // mask: {
//   //   position: 'absolute',
//   //   top: 0,
//   //   left: 0,
//   //   bottom: 0,
//   //   right: 0,
//   //   // width: '100%',
//   //   // height: '100%',
//   // },
// })

export interface ModalProps extends Omit<_ModalProps, 'visible'> {
  onHide?: () => void
  /**
   * 按返回键是否隐藏
   */
  keyHide?: boolean
  /**
   * 点击背景是否隐藏
   */
  bgHide?: boolean
  /**
   * 背景颜色
   */
  bgColor?: string
  /**
   * 是否填充状态栏
   */
  statusBarPadding?: boolean
}


export interface ModalType {
  setVisible: (visible: boolean) => void
}

export default forwardRef<ModalType, ModalProps>(({
  onHide = () => {},
  keyHide = true,
  bgHide = true,
  bgColor = 'rgba(0,0,0,0)',
  statusBarPadding = true,
  children,
  ...props
}: ModalProps, ref) => {
  const [visible, setVisible] = useState(false)
  // 打开是异步的（壁纸模式要等背后那一帧拍好），用批次号让"还没开完就点了关"的请求作废
  const openTokenRef = useRef(0)
  // const { window: windowSize } = useWindowSize()
  const statusBarHeight = useStatusbarHeight()
  const handleRequestClose = () => {
    if (keyHide) {
      openTokenRef.current += 1
      setVisible(false)
      onHide()
    }
  }
  const handleBgClose = () => {
    if (bgHide) {
      openTokenRef.current += 1
      setVisible(false)
      onHide()
    }
  }

  useImperativeHandle(ref, () => ({
    setVisible(_visible) {
      if (visible == _visible) return
      if (!_visible) {
        openTokenRef.current += 1
        setVisible(false)
        onHide()
        return
      }
      // 窗一开，里面的玻璃面就得有"背后那一帧"可糊。先开窗再拍的话，第一帧只能空着，
      // 等快照回来才糊上 —— 观感就是背景从清晰突然变模糊。普通主题这里直接返回，不等待。
      const token = ++openTokenRef.current
      void primeBackdropForPanel().then(() => {
        if (openTokenRef.current != token) return
        setVisible(true)
      })
    },
  }))

  const memoChildren = useMemo(() => children, [children])

  return (
    <Modal
      animationType="fade"
      transparent={true}
      hardwareAccelerated={true}
      statusBarTranslucent={true}
      visible={visible}
      onRequestClose={handleRequestClose}
      {...props}
    >
      {/* <StatusBar /> */}
      {/* <View style={{ flex: 1, paddingTop: statusBarPadding ? StatusBar.currentHeight : 0 }}> */}
      <TouchableWithoutFeedback style={{ flex: 1, paddingTop: statusBarPadding ? statusBarHeight : 0 }} onPress={handleBgClose}>
        <View style={{ flex: 1, backgroundColor: bgColor }}>
          {memoChildren}
        </View>
      </TouchableWithoutFeedback>
      {/* </View> */}
    </Modal>
  )
})
