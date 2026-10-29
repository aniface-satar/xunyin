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

export const dismissOverlay = async(compId: string) => Navigation.dismissOverlay(compId)

export const pop = async(compId: string) => Navigation.pop(compId)
export const popToRoot = async(compId: string) => Navigation.popToRoot(compId)
export const popTo = async(compId: string) => Navigation.popTo(compId)

export const showPactModal = () => {
  const theme = themeState.theme

  void Navigation.showOverlay({
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

  // 先拍一张「背后的画面」再挂 overlay：这张窗口走的是 RNN 的 showOverlay，跟页面同处
  // 一个 Activity 的 content —— 挂上之后再 captureScreen，拍到的会包含它自己（黑色遮罩 + 窗口），
  // 玻璃面糊的就是"糊中糊"。先拍再挂，首帧拿到的就是它背后那一帧。
  if (theme['is-wallpaper']) await primeBackdropForPanel()

  await Navigation.showOverlay({
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

  void Navigation.showOverlay({
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

  void Navigation.showOverlay({
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
