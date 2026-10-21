import type { I18n } from '@/lang/i18n'
import type { UserApiUpdateCheckMode } from '@/core/userApiUpdate/schedule'

declare global {
  namespace LX {
  type AddMusicLocationType = 'top' | 'bottom'
  interface AppSetting {
    version: string
    /**
       * 是否跟随系统切换亮暗主题
       */
    'common.isAutoTheme': boolean

    /**
       * 语言id
       */
    'common.langId': I18n['locale'] | null

    /**
       * api id
       */
    'common.apiSource': string

    /**
       * 音源自动检查更新的频率，由用户选择
       */
    'common.userApiUpdateCheck': UserApiUpdateCheckMode

    /**
       * 所有音源（自定义源、内置源）发现新版本时是否允许弹窗提醒
       */
    'common.userApiAllowShowUpdateAlert': boolean

    /**
       * 所有音源（自定义源、内置源）是否自动检查并更新
       */
    'common.userApiAutoUpdate': boolean

    /**
       * 音源名称类型，原名、别名
       */
    'common.sourceNameType': 'alias' | 'real'

    /**
       * 歌曲分享方式
       */
    'common.shareType': 'system' | 'clipboard'

    /**
       * 是否同意软件协议
       */
    'common.isAgreePact': boolean

    /**
       * 是否在键盘弹出时隐藏播放栏
       */
    'common.autoHidePlayBar': boolean

    /**
       * 抽屉组件弹出方向
       */
    'common.drawerLayoutPosition': 'left' | 'right'

    /**
       * 允许通过底栏进度条调整进度
       */
    'common.allowProgressBarSeek': boolean

    /**
       * 是否显示返回按钮
       */
    'common.showBackBtn': boolean

    /**
       * 是否显示退出按钮
       */
    'common.showExitBtn': boolean

    /**
       * 使用系统文件选择器
       */
    'common.useSystemFileSelector': boolean

    /**
     * 总是保留状态栏高度
     */
    'common.alwaysKeepStatusbarHeight': boolean

    /**
       * 主题id
       */
    'theme.id': string

    /**
       * 亮色主题id
       */
    'theme.lightId': string

    /**
       * 暗色主题id
       */
    'theme.darkId': string

    /**
       * 隐藏黑色主题背景
       */
    'theme.hideBgDark': boolean

    /**
       * 字体阴影
       */
    'theme.fontShadow': boolean

    /**
       * 播放页动态背景（跟随封面莫奈取色）
       */
    'theme.dynamicBg': boolean

    /**
       * 动态背景的取色算法：
       * monet = 官方 Material Color Utilities 链路（一块染色底 + 少量封面透出）
       * blur = 重度模糊的封面图本身固定铺底（默认）
       * 旧存档里存着的 'native'（已删除的安卓原生取色）会归到 monet，老用户升级后看到的与之前一致。
       */
    'theme.dynamicBgAlgorithm': 'monet' | 'blur'

    /**
       * 启动时自动播放歌曲
       */
    'player.startupAutoPlay': boolean

    /**
       * 启动后打开歌曲详细界面
       */
    'player.startupPushPlayDetailScreen': boolean

    /**
       * 切歌模式
       */
    'player.togglePlayMethod': 'listLoop' | 'random' | 'list' | 'singleLoop' | 'none'

    /**
       * 优先播放的音质
       */
    'player.playQuality': LX.Quality

    /**
       * 启动软件时是否恢复上次播放进度
       */
    'player.isSavePlayTime': boolean

    /**
       * 音量大小
       */
    'player.volume': number

    /**
       * 播放速率
       */
    'player.playbackRate': number

    /**
       * 缓存大小设置 unit MiB
       */
    'player.cacheSize': string

    /**
       * 切歌前是否提前准备下一首的封面、歌词、配色与音频
       */
    'player.preloadNextMusic': boolean

    /**
       * 下一首音频字节的预热档位：off 不下、head 只下开头、full 整首
       */
    'player.preloadNextMusicAudio': 'off' | 'head' | 'full'

    /**
       * 定时暂停播放-倒计时时间
       */
    'player.timeoutExit': string

    /**
       * 定时暂停播放-是否等待歌曲播放完毕再暂停
       */
    'player.timeoutExitPlayed': boolean

    /**
       * 点击相同列表内的歌曲切歌时是否清空已播放列表（随机模式下列表内所有歌曲会重新参与随机）
       */
    'player.isAutoCleanPlayedList': boolean

    /**
       * 其他应用播放声音时是否自动暂停
       */
    'player.isHandleAudioFocus': boolean

    /**
       * 是否启用音频卸载功能（这可以节省耗电量，没有播放异常问题不建议关闭）
       */
    'player.isEnableAudioOffload': boolean

    /**
       * 是否启用音量均衡（缩小不同歌曲之间的音量差异，依赖系统音频音效，
       * 启用时会自动关闭音频卸载，且需要重启应用后生效）
       */
    'player.isEnableVolumeBalancer': boolean

    /**
       * 音量均衡的强度档位
       */
    'player.volumeBalancerLevel': 'low' | 'mid' | 'high'

    /**
       * 是否显示歌词翻译
       */
    'player.isShowLyricTranslation': boolean

    /**
       * 是否显示歌词罗马音
       */
    'player.isShowLyricRoma': boolean

    /**
       * 是否在通知栏显示歌曲图片
       */
    'player.isShowNotificationImage': boolean

    /**
       * 是否将歌词从简体转换为繁体
       */
    'player.isS2t': boolean

    /**
       * 是否启用蓝牙歌词
       */
    'player.isShowBluetoothLyric': boolean

    /**
       * 是否启用蓝牙完整歌词
       */
    'player.isShowBluetoothFullLyric': boolean

    /**
       * 播放详情页-是否缩放当前播放的歌词行
       */
    // 'playDetail.isZoomActiveLrc': boolean

    /**
       * 播放详情页-是否允许通过歌词调整播放进度
       */
    // 'playDetail.isShowLyricProgressSetting': boolean

    /**
       * 播放详情页-歌词对齐方式
       */
    'playDetail.style.align': 'center' | 'left' | 'right'

    /**
       * 竖屏歌词字体大小
       */
    'playDetail.vertical.style.lrcFontSize': number

    /**
       * 横屏歌词字体大小
       */
    'playDetail.horizontal.style.lrcFontSize': number

    /**
       * 播放详情页-是否允许通过歌词调整播放进度
       */
    'playDetail.isShowLyricProgressSetting': boolean

    /**
       * 是否启用桌面歌词
       */
    'desktopLyric.enable': boolean

    /**
       * 是否锁定桌面歌词
       */
    'desktopLyric.isLock': boolean

    /**
       * 桌面歌词窗口宽度
       */
    'desktopLyric.width': number

    /**
       * 桌面歌词最大行数
       */
    'desktopLyric.maxLineNum': number

    /**
       * 桌面歌词是否使用单行显示
       */
    'desktopLyric.isSingleLine': boolean

    /**
       * 桌面歌词是否启用歌词切换动画
       */
    'desktopLyric.showToggleAnima': boolean

    /**
       * 桌面歌词窗口x坐标
       */
    'desktopLyric.position.x': number

    /**
       * 桌面歌词窗口y坐标
       */
    'desktopLyric.position.y': number

    /**
       * 歌词水平对齐方式
       */
    'desktopLyric.textPosition.x': 'left' | 'center' | 'right'

    /**
       * 歌词垂直对齐方式
       */
    'desktopLyric.textPosition.y': 'top' | 'center' | 'bottom'

    /**
       * 桌面歌词字体大小
       */
    'desktopLyric.style.fontSize': number

    /**
       * 桌面歌词字体透明度
       */
    'desktopLyric.style.opacity': number

    /**
       * 桌面歌词未播放字体颜色
       */
    'desktopLyric.style.lyricUnplayColor': string

    /**
        * 桌面歌词已播放字体颜色
        */
    'desktopLyric.style.lyricPlayedColor': string

    /**
        * 桌面歌词字体阴影颜色
        */
    'desktopLyric.style.lyricShadowColor': string

    /**
       * 是否显示热门搜索
       */
    'search.isShowHotSearch': boolean

    /**
       * 是否显示搜索历史
       */
    'search.isShowHistorySearch': boolean

    /**
       * 是否显示歌曲来源（仅对我的列表有效）
       */
    'list.isShowSource': boolean

    /**
       * 是否显示歌曲专辑名
       */
    'list.isShowAlbumName': boolean

    /**
       * 是否显示歌曲时长
       */
    'list.isShowInterval': boolean

    /**
       * 是否自动恢复列表滚动位置（仅对我的列表有效）
       */
    'list.isSaveScrollLocation': boolean

    /**
       * 添加歌曲到我的列表时的方式
       */
    'list.addMusicLocationType': AddMusicLocationType

    /**
       * 文件命名方式
       */
    'download.fileName': '歌名 - 歌手' | '歌手 - 歌名' | '歌名'

    /**
     * 下载保存位置（系统文件夹选择器返回的位置）
     */
    'download.savePath': string

    /**
     * 下载保存位置的展示名称
     */
    'download.savePathName': string

    /**
     * 分享图/歌词海报的保存位置（系统文件夹选择器返回的位置）
     */
    'shareCard.savePath': string

    /**
     * 分享图保存位置的展示名称
     */
    'shareCard.savePathName': string

    /**
       * 是否启用同步
       */
    'sync.enable': boolean
  }
  }
}
