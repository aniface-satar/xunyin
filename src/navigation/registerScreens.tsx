// @flow

import { type ComponentType } from 'react'
import { Navigation } from 'react-native-navigation'

import {
  Home,
  PlayDetail,
  SonglistDetail,
  LeaderboardDetail,
  MylistDetail,
  Comment,
  // Setting,
} from '@/screens'
import { Provider } from '@/store/Provider'

import {
  HOME_SCREEN,
  PLAY_DETAIL_SCREEN,
  SONGLIST_DETAIL_SCREEN,
  LEADERBOARD_DETAIL_SCREEN,
  MYLIST_DETAIL_SCREEN,
  COMMENT_SCREEN,
  VERSION_MODAL,
  NOTICE_MODAL,
  PACT_MODAL,
  SYNC_MODE_MODAL,
  // SETTING_SCREEN,
} from './screenNames'
import VersionModal from './components/VersionModal'
import NoticeModal from './components/NoticeModal'
import PactModal from './components/PactModal'
import SyncModeModal from './components/SyncModeModal'
import AlertHost from '@/components/common/AlertHost'

function WrappedComponent(Component: any, Host?: ComponentType) {
  return function inject(props: Record<string, any>) {
    const EnhancedComponent = () => (
      <Provider>
        <Component
          {...props}
        />
        {/* 全局提示 / 确认框的宿主：只挂在首页（栈根，推任何页面都不会卸载它）。
            它底层是 Dialog window，浮在 Activity 内容之上，别的页面与 Modal 之上都盖得住。 */}
        {Host ? <Host /> : null}
      </Provider>
    )

    return <EnhancedComponent />
  }
}

export default () => {
  Navigation.registerComponent(HOME_SCREEN, () => WrappedComponent(Home, AlertHost))
  Navigation.registerComponent(PLAY_DETAIL_SCREEN, () => WrappedComponent(PlayDetail))
  Navigation.registerComponent(SONGLIST_DETAIL_SCREEN, () => WrappedComponent(SonglistDetail))
  Navigation.registerComponent(LEADERBOARD_DETAIL_SCREEN, () => WrappedComponent(LeaderboardDetail))
  Navigation.registerComponent(MYLIST_DETAIL_SCREEN, () => WrappedComponent(MylistDetail))
  Navigation.registerComponent(COMMENT_SCREEN, () => WrappedComponent(Comment))
  Navigation.registerComponent(VERSION_MODAL, () => WrappedComponent(VersionModal))
  Navigation.registerComponent(NOTICE_MODAL, () => WrappedComponent(NoticeModal))
  Navigation.registerComponent(PACT_MODAL, () => WrappedComponent(PactModal))
  Navigation.registerComponent(SYNC_MODE_MODAL, () => WrappedComponent(SyncModeModal))
  // Navigation.registerComponent(SETTING_SCREEN, () => WrappedComponent(Setting))

  console.info('All screens have been registered...')
}
