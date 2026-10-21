/**
 * 基于 lyswhut/lx-music-mobile 修改（Apache License 2.0）。
 * 启动流程完成初始化与深链处理后检查应用更新。
 * 原项目：https://github.com/lyswhut/lx-music-mobile
 */

import { initSetting, showPactModal } from '@/core/common'
import registerPlaybackService from '@/plugins/player/service'
import initTheme from './theme'
import initI18n from './i18n'
import initUserApi from './userApi'
import initPlayer from './player'
import dataInit from './dataInit'
import { initDownload } from '@/core/download/scheduler'
import initSync from './sync'
import { initDeeplink } from './deeplink'
import { checkUpdate } from '@/core/version'
import { setApiSource } from '@/core/apiSource'
import { runUserApiUpdateCheckOnStartup } from '@/core/userApiUpdate'
import { initMusicAddTimeTracker } from '@/core/list'
import commonActions from '@/store/common/action'
import settingState from '@/store/setting/state'
import { bootLog } from '@/utils/bootLog'
import { cheatTip } from '@/utils/tools'

let isFirstPush = true
const handlePushedHomeScreen = async() => {
  await cheatTip()
  if (settingState.setting['common.isAgreePact']) {
    if (isFirstPush) {
      isFirstPush = false
      void initDeeplink()
      void checkUpdate()
    }
  } else {
    if (isFirstPush) isFirstPush = false
    showPactModal()
  }
}

let isInited = false
export default async() => {
  if (isInited) return handlePushedHomeScreen
  bootLog('Initing...')
  commonActions.setFontSize(global.lx.fontSize)
  bootLog('Font size changed.')
  const setting = await initSetting()
  bootLog('Setting inited.')
  // console.log(setting)

  await initTheme(setting)
  bootLog('Theme inited.')
  await initI18n(setting)
  bootLog('I18n inited.')

  await initUserApi(setting)
  bootLog('User Api inited.')

  setApiSource(setting['common.apiSource'])
  bootLog('Api inited.')

  // 更新检查要等音源真的初始化完再动手，所以放在 setApiSource 之后
  // （它内部会等 apiInitPromise，占位 promise 不算数）
  void runUserApiUpdateCheckOnStartup()

  registerPlaybackService()
  bootLog('Playback Service Registered.')
  await initPlayer(setting)
  bootLog('Player inited.')
  await dataInit(setting)
  bootLog('Data inited.')
  void initDownload()
  initMusicAddTimeTracker()

  void initSync(setting)
  bootLog('Sync inited.')

  // syncSetting()

  isInited ||= true

  return handlePushedHomeScreen
}
