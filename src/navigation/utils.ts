import { Navigation } from 'react-native-navigation'
import {
  VERSION_MODAL,
  NOTICE_MODAL,
  PACT_MODAL,
  SYNC_MODE_MODAL,
} from './screenNames'
import themeState from '@/store/theme/state'
import { primeBackdropForPanel } from '@/utils/backdropSnapshot'


export const getStatusBarStyle = (isDark: boolean) => isDark ? 'light' : 'dark'

/**
 * 打开下面这几个窗口的统一入口（更新 / 公告 / 协议 / 同步模式）。
 *
 * 它们走的是 RNN 的 showOverlay，不是 RN Modal —— 跟页面同处一个 Activity 的 content。
 * 挂上之后再 captureScreen，拍到的画面里已经带着它们自己（黑色遮罩 + 面板），
 * 玻璃层糊出来就是"糊中糊"：面板底下透出自己那块暗轮廓，观感既不像毛玻璃，也像叠了两层。
 * 壁纸模式下先拍背后那一帧再挂，窗口第一帧拿到的就是它背后真实的页面。
 *
 * 普通主题不花这一趟：那边面板本来就是实底，没有毛玻璃。
 */
const showOverlayWithBackdrop = async(options: Parameters<typeof Navigation.showOverlay>[0]) => {
  if (themeState.theme['is-wallpaper']) await primeBackdropForPanel()
  return Navigation.showOverlay(options)
}

export const dismissOverlay = async(compId: string) => Navigation.dismissOverlay(compId)

export const pop = async(compId: string) => Navigation.pop(compId)
export const popToRoot = async(compId: string) => Navigation.popToRoot(compId)
export const popTo = async(compId: string) => Navigation.popTo(compId)

export const showPactModal = () => {
  const theme = themeState.theme

  void showOverlayWithBackdrop({
    component: {
      name: PACT_MODAL,
      options: {
        layout: {
          componentBackgroundColor: 'transparent',
        },
        overlay: {
          interceptTouchOutside: true,
        },
        statusBar: {
          drawBehind: true,
          visible: true,
          style: getStatusBarStyle(theme.isDark),
          backgroundColor: 'transparent',
        },
        navigationBar: {
          // visible: false,
          backgroundColor: theme['c-content-background'],
        },
        // animations: {

        //   showModal: {
        //     enter: {
        //       enabled: true,
        //       alpha: {
        //         from: 0,
        //         to: 1,
        //         duration: 300,
        //       },
        //     },
        //     exit: {
        //       enabled: true,
        //       alpha: {
        //         from: 1,
        //         to: 0,
        //         duration: 300,
        //       },
        //     },
        //   },
        // },
      },
    },
  })
}

export const showVersionModal = async() => {
  const theme = themeState.theme

  await showOverlayWithBackdrop({
    component: {
      name: VERSION_MODAL,
      options: {
        layout: {
          componentBackgroundColor: 'transparent',
        },
        overlay: {
          interceptTouchOutside: true,
        },
        statusBar: {
          drawBehind: true,
          visible: true,
          style: getStatusBarStyle(theme.isDark),
          backgroundColor: 'transparent',
        },
        navigationBar: {
          // visible: false,
          backgroundColor: theme['c-content-background'],
        },
      },
    },
  })
}

export const showNoticeModal = (text: string) => {
  const theme = themeState.theme

  void showOverlayWithBackdrop({
    component: {
      name: NOTICE_MODAL,
      passProps: { text },
      options: {
        layout: {
          componentBackgroundColor: 'transparent',
        },
        overlay: {
          interceptTouchOutside: true,
        },
        statusBar: {
          drawBehind: true,
          visible: true,
          style: getStatusBarStyle(theme.isDark),
          backgroundColor: 'transparent',
        },
        navigationBar: {
          backgroundColor: theme['c-content-background'],
        },
      },
    },
  })
}

export const showSyncModeModal = () => {
  const theme = themeState.theme

  void showOverlayWithBackdrop({
    component: {
      name: SYNC_MODE_MODAL,
      options: {
        layout: {
          componentBackgroundColor: 'transparent',
        },
        overlay: {
          interceptTouchOutside: true,
        },
        statusBar: {
          drawBehind: true,
          visible: true,
          style: getStatusBarStyle(theme.isDark),
          backgroundColor: 'transparent',
        },
        navigationBar: {
          // visible: false,
          backgroundColor: theme['c-content-background'],
        },
        // animations: {

        //   showModal: {
        //     enter: {
        //       enabled: true,
        //       alpha: {
        //         from: 0,
        //         to: 1,
        //         duration: 300,
        //       },
        //     },
        //     exit: {
        //       enabled: true,
        //       alpha: {
        //         from: 1,
        //         to: 0,
        //         duration: 300,
        //       },
        //     },
        //   },
        // },
      },
    },
  })
}

// export const showToast = (text) => {
//   Navigation.showOverlay({
//     component: {
//       name: TOAST_SCREEN,
//     },
//   })
// }
