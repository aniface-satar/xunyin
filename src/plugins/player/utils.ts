import TrackPlayer, { Capability, Event, RatingType, RepeatMode, State } from 'react-native-track-player'
import BackgroundTimer from 'react-native-background-timer'
import { playMusic as handlePlayMusic } from './playList'
import { existsFile, moveFile, privateStorageDirectoryPath, temporaryDirectoryPath } from '@/utils/fs'
import { toast } from '@/utils/tools'
// import { PlayerMusicInfo } from '@/store/modules/player/playInfo'


export { useBufferProgress } from './hook'

const emptyIdRxp = /\/\/default$/
const tempIdRxp = /\/\/default$|\/\/default\/\/restorePlay$/
export const isEmpty = (trackId = global.lx.playerTrackId) => {
  // console.log(trackId)
  return !trackId || emptyIdRxp.test(trackId)
}
export const isTempId = (trackId = global.lx.playerTrackId) => !trackId || tempIdRxp.test(trackId)

// export const replacePlayTrack = async(newTrack, oldTrack) => {
//   console.log('replaceTrack')
//   await TrackPlayer.add(newTrack)
//   await TrackPlayer.skip(newTrack.id)
//   await TrackPlayer.remove(oldTrack.id)
// }

// let timeout
// let isFirstPlay = true
// const updateInfo = async track => {
//   if (isFirstPlay) {
//     // timeout = setTimeout(() => {
//     await delayUpdateMusicInfo(track)
//     isFirstPlay = false
//     // }, 500)
//   }
// }


// 解决快速切歌导致的通知栏歌曲信息与当前播放歌曲对不上的问题
// const debouncePlayMusicTools = {
//   prevPlayMusicPromise: Promise.resolve(),
//   trackInfo: {},
//   isDelayUpdate: false,
//   isDebounced: false,
//   delay: 1000,
//   delayTimer: null,
//   debounce(fn, delay = 100) {
//     let timer = null
//     let _tracks = null
//     let _time = null
//     return (tracks, time) => {
//       if (!this.isDebounced && _tracks != null) this.isDebounced = true
//       _tracks = tracks
//       _time = time
//       if (timer) {
//         BackgroundTimer.clearTimeout(timer)
//         timer = null
//       }
//       if (this.isDelayUpdate) {
//         if (this.updateDelayTimer) {
//           BackgroundTimer.clearTimeout(this.updateDelayTimer)
//           this.updateDelayTimer = null
//         }
//         timer = BackgroundTimer.setTimeout(() => {
//           timer = null
//           let tracks = _tracks
//           let time = _time
//           _tracks = null
//           _time = null
//           this.isDelayUpdate = false
//           fn(tracks, time)
//         }, delay)
//       } else {
//         this.isDelayUpdate = true
//         fn(tracks, time)
//         this.updateDelayTimer = BackgroundTimer.setTimeout(() => {
//           this.updateDelayTimer = null
//           this.isDelayUpdate = false
//         }, this.delay)
//       }
//     }
//   },
//   delayUpdateMusicInfo() {
//     if (this.delayTimer) BackgroundTimer.clearTimeout(this.delayTimer)
//     this.delayTimer = BackgroundTimer.setTimeout(() => {
//       this.delayTimer = null
//       if (this.trackInfo.tracks && this.trackInfo.tracks.length) delayUpdateMusicInfo(this.trackInfo.tracks[0])
//     }, this.delay)
//   },
//   init() {
//     return this.debounce((tracks, time) => {
//       tracks = [...tracks]
//       this.trackInfo.tracks = tracks
//       this.trackInfo.time = time
//       return this.prevPlayMusicPromise.then(() => {
//         // console.log('run')
//         if (this.trackInfo.tracks === tracks) {
//           this.prevPlayMusicPromise = handlePlayMusic(tracks, time).then(() => {
//             if (this.isDebounced) {
//               this.delayUpdateMusicInfo()
//               this.isDebounced = false
//             }
//           })
//         }
//       })
//     }, 200)
//   },
// }

const playMusic = ((fn: (musicInfo: LX.Player.PlayMusic, url: string, time: number) => void, delay = 800) => {
  let delayTimer: number | null = null
  let isDelayRun = false
  let timer: number | null = null
  let _musicInfo: LX.Player.PlayMusic | null = null
  let _url = ''
  let _time = 0
  return (musicInfo: LX.Player.PlayMusic, url: string, time: number) => {
    _musicInfo = musicInfo
    _url = url
    _time = time
    if (timer) {
      BackgroundTimer.clearTimeout(timer)
      timer = null
    }
    if (isDelayRun) {
      if (delayTimer) {
        BackgroundTimer.clearTimeout(delayTimer)
        delayTimer = null
      }
      timer = BackgroundTimer.setTimeout(() => {
        timer = null
        let musicInfo = _musicInfo
        let url = _url
        let time = _time
        _musicInfo = null
        _url = ''
        _time = 0
        isDelayRun = false
        fn(musicInfo!, url, time)
      }, delay)
    } else {
      isDelayRun = true
      fn(musicInfo, url, time)
      delayTimer = BackgroundTimer.setTimeout(() => {
        delayTimer = null
        isDelayRun = false
      }, 500)
    }
  }
})((musicInfo, url, time) => {
  handlePlayMusic(musicInfo, url, time)
})

export const setResource = (musicInfo: LX.Player.PlayMusic, url: string, duration?: number) => {
  playMusic(musicInfo, url, duration ?? 0)
}

export const setPlay = async() => TrackPlayer.play()
export const getPosition = async() => TrackPlayer.getPosition()
export const getDuration = async() => TrackPlayer.getDuration()
export const setStop = async() => {
  await TrackPlayer.stop()
  if (!isEmpty()) await TrackPlayer.skipToNext()
}
export const setLoop = async(loop: boolean) => TrackPlayer.setRepeatMode(loop ? RepeatMode.Off : RepeatMode.Track)

export const setPause = async() => TrackPlayer.pause()
// export const skipToNext = () => TrackPlayer.skipToNext()
export const setCurrentTime = async(time: number) => TrackPlayer.seekTo(time)
export const setVolume = async(num: number) => TrackPlayer.setVolume(num)
export const setPlaybackRate = async(num: number) => TrackPlayer.setRate(num)
export interface NowPlayingTitles {
  title?: string
  artist?: string
  album?: string
  lyric?: string
}
export const updateNowPlayingTitles = async(titles: NowPlayingTitles) => {
  // console.log('set playing titles', titles)
  return TrackPlayer.updateNowPlayingTitles(titles)
}

export const resetPlay = async() => Promise.all([setPause(), setCurrentTime(0)])

export const isCached = async(url: string) => TrackPlayer.isCached(url)
export const getCacheSize = async() => TrackPlayer.getCacheSize()
export const clearCache = async() => TrackPlayer.clearCache()
export const migratePlayerCache = async() => {
  const newCachePath = privateStorageDirectoryPath + '/TrackPlayer'
  if (await existsFile(newCachePath)) return
  const oldCachePath = temporaryDirectoryPath + '/TrackPlayer'
  if (!await existsFile(oldCachePath)) return
  let timeout: number | null = BackgroundTimer.setTimeout(() => {
    timeout = null
    toast(global.i18n.t('player_cache_migrating'), 'long')
  }, 2_000)
  await moveFile(oldCachePath, newCachePath).finally(() => {
    if (timeout) BackgroundTimer.clearTimeout(timeout)
  })
}

export const destroy = async() => {
  if (global.lx.playerStatus.isIniting || !global.lx.playerStatus.isInitialized) return
  await TrackPlayer.destroy()
  global.lx.playerStatus.isInitialized = false
}

type PlayStatus = 'None' | 'Ready' | 'Playing' | 'Paused' | 'Stopped' | 'Buffering' | 'Connecting'

export const onStateChange = async(listener: (state: PlayStatus) => void) => {
  const sub = TrackPlayer.addEventListener(Event.PlaybackState, state => {
    let _state: PlayStatus
    switch (state) {
      case State.Ready:
        _state = 'Ready'
        break
      case State.Playing:
        _state = 'Playing'
        break
      case State.Paused:
        _state = 'Paused'
        break
      case State.Stopped:
        _state = 'Stopped'
        break
      case State.Buffering:
        _state = 'Buffering'
        break
      case State.Connecting:
        _state = 'Connecting'
        break
      case State.None:
      default:
        _state = 'None'
        break
    }
    listener(_state)
  })

  return () => {
    sub.remove()
  }
}

/**
 * Subscription player state chuange event
 * @param options state change event
 * @returns remove event function
 */
// export const playState = callback => TrackPlayer.addEventListener('playback-state', callback)

export const updateOptions = async(options = {
  // Whether the player should stop running when the app is closed on Android
  // stopWithApp: true,

  ratingType: RatingType.Heart,
  like: true,
  likeOptions: {
    isActive: false,
    title: '喜欢',
    activeTitle: '取消喜欢',
  },
  likeIcon: { uri: 'ic_notification_like' },
  likeLikedIcon: { uri: 'ic_notification_liked' },

  // 荣耀灵动胶囊「媒体胶囊接入」要求系统按钮为 上一曲 / 播放暂停 / 下一曲，
  // 按钮文案取自通知 action 的 title；这里跟随应用语言下发（中文即 上一曲/播放/暂停/下一曲）。
  previousTitle: global.i18n.t('play_prev'),
  playTitle: global.i18n.t('play'),
  pauseTitle: global.i18n.t('pause'),
  nextTitle: global.i18n.t('play_next'),

  capabilities: [
    Capability.Play,
    Capability.Pause,
    Capability.Stop,
    Capability.SeekTo,
    Capability.SkipToNext,
    Capability.SkipToPrevious,
    Capability.SetRating,
  ],

  notificationCapabilities: [
    Capability.Play,
    Capability.Pause,
    Capability.SkipToNext,
    Capability.SkipToPrevious,
  ],

  // 喜欢按钮以独立 action 的形式提供（不占用 compact 名额），
  // 这样 ColorOS 流体云 / 灵动胶囊展开态的音乐卡片上才会同时出现
  // 「上一首 / 播放暂停 / 下一首」三个默认按键以及「喜欢」按键。
  likeInCompact: false,

  // An array of capabilities that will show up when the notification is in the compact form on Android.
  // 胶囊/收起态只保留系统默认的三个播放按键，顺序与系统一致：上一首、播放/暂停、下一首。
  compactCapabilities: [
    Capability.SkipToPrevious,
    Capability.Play,
    Capability.Pause,
    Capability.SkipToNext,
  ],

  // Icons for the notification on Android (if you don't like the default ones)
  // playIcon: require('./play-icon.png'),
  // pauseIcon: require('./pause-icon.png'),
  // stopIcon: require('./stop-icon.png'),
  // previousIcon: require('./previous-icon.png'),
  // nextIcon: require('./next-icon.png'),
  // Use a monochrome Xunyin waveform instead of the track-player default.
  icon: { uri: 'ic_xunyin_notification' },
}) => {
  return TrackPlayer.updateOptions(options)
}

// export const setMaxCache = async size => {
//   // const currentTrack = await TrackPlayer.getCurrentTrack()
//   // if (!currentTrack) return
//   // console.log(currentTrack)
//   // const currentTime = await TrackPlayer.getPosition()
//   // const state = await TrackPlayer.getState()
//   // await stop()
//   // await TrackPlayer.destroy()
//   // await TrackPlayer.setupPlayer({ maxCacheSize: size * 1024, maxBuffer: 1000, waitForBuffer: true })
//   // await updateOptions()
//   // await TrackPlayer.seekTo(currentTime)
//   // switch (state) {
//   //   case TrackPlayer.STATE_PLAYING:
//   //   case TrackPlayer.STATE_BUFFERING:
//   //     await TrackPlayer.play()
//   //     break
//   //   default:
//   //     break
//   // }
// }

// export {
//   useProgress,
// }

export { updateMetaData, initTrackInfo } from './playList'
