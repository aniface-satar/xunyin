import initPlayer from './player'
import initPlayInfo from './playInfo'
import initPlayStatus from './playStatus'
import initPlayerEvent from './playerEvent'
import initWatchList from './watchList'
import initPlayProgress from './playProgress'
import initPreloadNextMusic from './preloadNextMusic'
import initWarmCurrentBackdrop from './warmCurrentBackdrop'
import initVolumeBalancer from './volumeBalancer'
import initLyric from './lyric'

export default async(setting: LX.AppSetting) => {
  await initPlayer(setting)
  await initLyric(setting)
  await initPlayInfo(setting)
  initPlayStatus()
  initPlayerEvent()
  initWatchList()
  initPlayProgress()
  initPreloadNextMusic()
  initWarmCurrentBackdrop()
  initVolumeBalancer()
}
