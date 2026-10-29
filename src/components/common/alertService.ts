import { Alert } from 'react-native'

/**
 * 全局提示 / 确认框的服务端。
 *
 * 为什么不是直接用 RN 的 `Alert.alert`：
 * 那个框由系统绘制，配色、圆角、背景全都不受应用控制；壁纸模式下它是唯一一块
 * 突兀的纯白/纯黑方块。这里改由应用自己的 `Dialog` 渲染 —— 它已经带着
 * `GlassBackdrop`，壁纸模式下就是同一张磨砂玻璃，与其它弹层是一个观感。
 *
 * 为什么是「宿主 + 服务」而不是每个调用点自己挂一个 Dialog：
 * `confirmDialog` / `tipDialog` 有 30 多处调用，都是 `await` 一个 Promise 的写法，
 * 调用点并不知道自己深处哪个 React 树里。所以把界面收在一个常驻宿主
 * （`AlertHost`，挂在首页根节点上，见 `navigation/registerScreens.tsx`）里，
 * 这里只负责排队、结算。
 *
 * 宿主还没挂上时（启动早期、根节点重建中）退回原生 Alert：宁可样式不一致，
 * 也不能让调用方永远 `await` 一个不会出现的框。
 */

/** 没做出选择就关掉了（点背景 / 返回键 / 被外部关闭） */
export const ALERT_CANCEL = -1

export interface AlertAction {
  text: string
}

export interface AlertOptions {
  title?: string
  message?: string
  actions: AlertAction[]
  /**
   * 允许点背景 / 返回键关掉（关掉按 `ALERT_CANCEL` 结算）。
   * 默认 false，与 Android 上原生 Alert 的默认行为一致。
   */
  cancelable?: boolean
}

export interface AlertRequest extends Required<Omit<AlertOptions, 'actions'>> {
  actions: AlertAction[]
  resolve: (index: number) => void
}

type AlertHost = (request: AlertRequest) => void

let host: AlertHost | null = null

/** 宿主挂载时登记自己；返回注销函数（组件卸载时用） */
export const registerAlertHost = (next: AlertHost) => {
  host = next
  return () => {
    if (host === next) host = null
  }
}

const showNativeAlert = async({ title, message, actions, cancelable }: Omit<AlertRequest, 'resolve'>) => {
  return new Promise<number>((resolve) => {
    let settled = false
    const settle = (index: number) => {
      if (settled) return
      settled = true
      resolve(index)
    }
    Alert.alert(
      title,
      message,
      actions.map((action, index) => ({
        text: action.text,
        onPress() {
          settle(index)
        },
      })),
      {
        cancelable,
        onDismiss() {
          settle(ALERT_CANCEL)
        },
      },
    )
  })
}

/**
 * 弹一个提示 / 确认框，resolve 出被点击按钮的下标；没选就关掉则为 `ALERT_CANCEL`。
 */
export const showAlert = async(options: AlertOptions): Promise<number> => {
  const request: Omit<AlertRequest, 'resolve'> = {
    title: options.title ?? '',
    message: options.message ?? '',
    actions: options.actions,
    cancelable: options.cancelable ?? false,
  }
  // 没有按钮就等于没有出口，直接当作"取消"，不要挂一个关不掉的框
  if (request.actions.length == 0) return ALERT_CANCEL
  if (host == null) return showNativeAlert(request)
  return new Promise<number>((resolve) => {
    host!({ ...request, resolve })
  })
}
