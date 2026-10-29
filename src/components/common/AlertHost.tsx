import { useCallback, useEffect, useRef, useState } from 'react'
import { View, ScrollView } from 'react-native'

import Dialog, { type DialogType } from './Dialog'
import Button from './Button'
import Text from './Text'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { ALERT_CANCEL, registerAlertHost, type AlertRequest } from './alertService'

/**
 * 全局提示 / 确认框的宿主，挂在首页根节点上（见 `navigation/registerScreens.tsx`）。
 *
 * 用 `Dialog` 而不是 `Modal` 裸搭：它已经把 `GlassBackdrop` 接好了 —— 壁纸模式下
 * 面板是一块磨砂玻璃（糊的是它背后那一帧页面），其它主题是原来的实底，两边都不用在这里判断。
 *
 * 为什么宿主放首页而不是每个页面各来一份：首页是整个栈的根，推播控页 / 详情页都不会
 * 卸载它，所以整条生命周期里只有这一份；而 `Dialog` 底层是 Android 的 Dialog window，
 * 它浮在 Activity 内容之上 —— 别的页面、别的 Modal 之上都能盖住。
 */
export default () => {
  const theme = useTheme()
  const dialogRef = useRef<DialogType>(null)
  const [request, setRequest] = useState<AlertRequest | null>(null)
  // 同一份对象也留一份在 ref 里：关闭动画期间 state 可能已经换人，
  // 结算必须认"当时那一个"，否则会把新框的 Promise 结错。
  const requestRef = useRef<AlertRequest | null>(null)

  useEffect(() => registerAlertHost((next) => {
    const prev = requestRef.current
    requestRef.current = next
    setRequest(next)
    // 上一个还没结算就被顶掉（连点两下）：按取消放行，别让它的调用方永远 await
    prev?.resolve(ALERT_CANCEL)
    dialogRef.current?.setVisible(true)
  }), [])

  const settle = useCallback((index: number) => {
    const current = requestRef.current
    if (current == null) return
    // 先清引用再关窗：关闭会触发 Dialog 的 onHide，那一路看到这里为空就不会重复结算
    requestRef.current = null
    dialogRef.current?.setVisible(false)
    current.resolve(index)
  }, [])

  // 点背景 / 返回键关掉：只有 cancelable 时 Dialog 才会把这两下转进来
  const handleHide = useCallback(() => {
    const current = requestRef.current
    if (current == null) return
    requestRef.current = null
    current.resolve(ALERT_CANCEL)
  }, [])

  const actions = request?.actions ?? []
  // 两个按钮并排（与原生 Alert 的观感一致），三个及以上改竖排 ——
  // 「不再提示 / 不同意 / 去同意」这种长词组并排放不下一行
  const isRow = actions.length <= 2

  return (
    <Dialog
      ref={dialogRef}
      title={request?.title ?? ''}
      closeBtn={false}
      bgHide={request?.cancelable ?? false}
      keyHide={request?.cancelable ?? false}
      onHide={handleHide}
    >
      {request == null
        ? null
        : (
            <>
              <View style={styles.content}>
                <ScrollView style={styles.scroll} keyboardShouldPersistTaps={'always'}>
                  <Text selectable style={styles.text}>{request.message}</Text>
                </ScrollView>
              </View>
              <View style={{ ...styles.btns, ...(isRow ? styles.btnsRow : null) }}>
                {actions.map((action, index) => (
                  <Button
                    key={`${index}_${action.text}`}
                    style={{ ...styles.btn, ...(isRow ? styles.btnRow : null), backgroundColor: theme['c-button-background'] }}
                    onPress={() => { settle(index) }}
                  >
                    <Text color={theme['c-button-font']}>{action.text}</Text>
                  </Button>
                ))}
              </View>
            </>
          )}
    </Dialog>
  )
}

const styles = createStyle({
  content: {
    flexShrink: 1,
    marginTop: 15,
    marginLeft: 15,
    marginRight: 15,
    marginBottom: 15,
  },
  scroll: {
    flexGrow: 0,
    maxHeight: 300,
  },
  text: {
    fontSize: 14,
    lineHeight: 20,
  },
  btns: {
    paddingBottom: 15,
    paddingLeft: 15,
    paddingRight: 15,
    rowGap: 10,
  },
  btnsRow: {
    flexDirection: 'row',
    columnGap: 10,
  },
  btn: {
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 12,
    paddingRight: 12,
    alignItems: 'center',
    borderRadius: 4,
  },
  // flex 只给并排用：竖排时 flex:1 会让每个按钮平分整块高度 ——
  // 三个按钮就是三条撑满的长条，正文被挤成 0 高（实机上"只剩标题和按钮"）。
  btnRow: {
    flex: 1,
  },
})
