import { useImperativeHandle, forwardRef, useMemo, useRef } from 'react'
import { View, TouchableHighlight } from 'react-native'

import Modal, { type ModalType } from './Modal'
import { Icon } from '@/components/common/Icon'
import { useKeyboard } from '@/utils/hooks'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import GlassBackdrop from './GlassBackdrop'
import Text from './Text'
import { scaleSizeH } from '@/utils/pixelRatio'

const HEADER_HEIGHT = 20
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
  title: {
    paddingLeft: 5,
    paddingRight: 25,
    lineHeight: HEADER_HEIGHT,
  },
  closeBtn: {
    position: 'absolute',
    right: 0,
    borderTopRightRadius: 4,
    flexGrow: 0,
    flexShrink: 0,
    height: HEADER_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
})

export interface DialogProps {
  onHide?: () => void
  keyHide?: boolean
  bgHide?: boolean
  closeBtn?: boolean
  title?: string
  children: React.ReactNode | React.ReactNode[]
  height?: number | `${number}%`
}

export interface DialogType {
  setVisible: (visible: boolean) => void
}

export default forwardRef<DialogType, DialogProps>(({
  onHide,
  keyHide = true,
  bgHide = true,
  closeBtn = true,
  title = '',
  children,
  height,
}: DialogProps, ref) => {
  const theme = useTheme()
  const { keyboardShown, keyboardHeight } = useKeyboard()
  const modalRef = useRef<ModalType>(null)

  useImperativeHandle(ref, () => ({
    setVisible(visible: boolean) {
      modalRef.current?.setVisible(visible)
    },
  }))

  const closeBtnComponent = useMemo(() => {
    return closeBtn
      ? <TouchableHighlight style={{ ...styles.closeBtn, width: scaleSizeH(HEADER_HEIGHT) }} hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }} underlayColor={theme['c-primary-dark-200-alpha-600']} onPress={() => modalRef.current?.setVisible(false)} accessibilityRole="button" accessibilityLabel={global.i18n.t('close')}>
          <Icon name="close" color={theme['c-primary-dark-500-alpha-500']} size={10} />
        </TouchableHighlight>
      : null
  }, [closeBtn, theme])

  return (
    <Modal onHide={onHide} keyHide={keyHide} bgHide={bgHide} bgColor="rgba(0,0,0,0.35)" navigationBarPadding={!keyboardShown} ref={modalRef}>
      <View style={{ ...styles.centeredView, paddingBottom: keyboardShown ? keyboardHeight : 0 }}>
        <View style={{ ...styles.modalView, height, backgroundColor: theme['c-content-background'] }} onStartShouldSetResponder={() => true}>
          {
            // 弹层自己的底：壁纸模式下这个面板原本的实白底变成了透明（`c-content-background`），
            // 不糊的话一整块内容就直接压在照片纹理上，每一行都要在图的明暗里找字。
            // 糊图铺满整屏、按窗口坐标对齐，所以面板里那一块的纹理与页面上的壁纸对得上。
            // 普通主题不插：那边本来就是实白底，多铺一层会改变观感。
            theme['is-wallpaper'] ? <GlassBackdrop style={{ borderRadius: 4 }} /> : null
          }
          <View style={{ ...styles.header, backgroundColor: theme['c-primary-light-100-alpha-100'] }}>
            {/* 这个键是"纸面白"，壁纸模式下被整族反转成了场色（白字那套是暗面、黑字那套是白面），
                而这里当字色用。所以壁纸模式下显式取那一支墨，否则就是同色底同色字。 */}
            <Text style={styles.title} size={13} color={theme['is-wallpaper'] ? theme['wallpaper-ink'] : theme['c-primary-light-1000']} numberOfLines={1}>{title}</Text>
            {closeBtnComponent}
          </View>
          {children}
        </View>
      </View>
    </Modal>
  )
})
