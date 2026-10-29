// 内置本地音源 星海音乐源 的 id（config/builtinSources/scripts.ts 里的 key 是 xinghai）。
// 2026-10-22 实测选定的默认源：更新链路真机闭环跑通过（v3.2.13→v3.2.15 自动更新成功）、
// 版本接口有双域名备用、作者持续迭代、全平台多后端聚合播放。
export const DEFAULT_BUILTIN_API_SOURCE_ID = 'builtin_xinghai'

const defaultSetting: LX.AppSetting = {
  version: '2.2',
  'common.isAutoTheme': false,
  'common.langId': null,
  'common.apiSource': DEFAULT_BUILTIN_API_SOURCE_ID,
  'common.userApiUpdateCheck': 'daily',
  'common.userApiAllowShowUpdateAlert': false,
  'common.userApiAutoUpdate': true,
  'common.sourceNameType': 'alias',
  'common.shareType': 'system',
  'common.isAgreePact': false,
  'common.autoHidePlayBar': true,
  'common.drawerLayoutPosition': 'left',
  'common.allowProgressBarSeek': true,
  'common.showBackBtn': false,
  'common.showExitBtn': true,
  'common.useSystemFileSelector': true,
  'common.alwaysKeepStatusbarHeight': false,
  'player.startupAutoPlay': false,
  'player.startupPushPlayDetailScreen': false,
  'player.togglePlayMethod': 'listLoop',
  'player.playQuality': '128k',
  'player.isSavePlayTime': false,
  'player.volume': 1,
  'player.playbackRate': 1,
  'player.cacheSize': '1024',
  'player.preloadNextMusic': true,
  'player.preloadNextMusicAudio': 'head',
  'player.timeoutExit': '',
  'player.timeoutExitPlayed': true,
  'player.isAutoCleanPlayedList': false,
  'player.isHandleAudioFocus': true,
  'player.isEnableAudioOffload': true,
  'player.isEnableVolumeBalancer': false,
  'player.volumeBalancerLevel': 'mid',
  'player.isShowLyricTranslation': true,
  'player.isShowLyricRoma': false,
  'player.isShowNotificationImage': true,
  'player.isS2t': false,
  'player.isShowBluetoothLyric': false,
  'player.isShowBluetoothFullLyric': false,

  // 'playDetail.isZoomActiveLrc': false,
  // 'playDetail.isShowLyricProgressSetting': false,
  'playDetail.style.align': 'left',
  'playDetail.vertical.style.lrcFontSize': 210,
  'playDetail.horizontal.style.lrcFontSize': 220,
  'playDetail.isShowLyricProgressSetting': true,

  'desktopLyric.enable': false,
  'desktopLyric.isLock': false,
  'desktopLyric.width': 100,
  'desktopLyric.maxLineNum': 5,
  'desktopLyric.isSingleLine': false,
  'desktopLyric.showToggleAnima': true,
  'desktopLyric.position.x': 0,
  'desktopLyric.position.y': 0,
  'desktopLyric.textPosition.x': 'left',
  'desktopLyric.textPosition.y': 'top',
  'desktopLyric.style.fontSize': 180,
  'desktopLyric.style.opacity': 100,
  'desktopLyric.style.lyricUnplayColor': 'rgba(255, 255, 255, 1)',
  'desktopLyric.style.lyricPlayedColor': 'rgba(7, 197, 86, 1)',
  'desktopLyric.style.lyricShadowColor': 'rgba(0, 0, 0, 0.6)',

  'search.isShowHotSearch': false,
  'search.isShowHistorySearch': false,

  'list.isShowSource': true,
  'list.isShowAlbumName': false,
  'list.isShowInterval': true,
  'list.isSaveScrollLocation': true,
  'list.addMusicLocationType': 'top',

  'download.fileName': '歌名 - 歌手',
  'download.savePath': '',
  'download.savePathName': '',

  'shareCard.savePath': '',
  'shareCard.savePathName': '',

  'sync.enable': false,

  'list.isClickPlayList': false,
  // 'theme.id': 'blue_plus',
  'theme.id': 'cyan',
  'theme.lightId': 'cyan',
  'theme.darkId': 'black',
  'theme.hideBgDark': false,
  'theme.fontShadow': false,
  'theme.dynamicBg': true,
  'theme.dynamicBgAlgorithm': 'blur',
  'theme.customBg.enabled': false,
  'theme.customBg.applyToPlayer': true,
  'theme.customBg.activeId': '',
  'theme.customBg.veil': 0.55,
}


// 使用新年皮肤
if (new Date().getMonth() < 2) {
  defaultSetting['theme.id'] = 'happy_new_year'
  defaultSetting['desktopLyric.style.lyricPlayedColor'] = 'rgba(255, 18, 34, 1)'
}

export default defaultSetting
