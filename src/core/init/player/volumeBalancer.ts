import { applyVolumeBalancer, releaseVolumeBalancer } from '@/utils/nativeModules/volumeBalancer'
import { toast } from '@/utils/tools'
import settingState from '@/store/setting/state'

export default () => {
  // 音效挂在播放器的 audio session 上，而 session 要等音频渲染器就绪才分配（换解码器时还可能重建），
  // 所以每次真正开始播放都对齐一次；原生在 session 未变时会复用已挂上的音效。
  let deviceUnsupported = false

  const apply = async(retry = 0) => {
    if (deviceUnsupported) return
    const setting = settingState.setting
    if (!setting['player.isEnableVolumeBalancer']) return

    const result = await applyVolumeBalancer(setting['player.volumeBalancerLevel'])
    console.log('[volumeBalancer]', result.code)
    if (result.ok) return
    // session 由音频渲染器就绪后才分配，换解码器时还会重建，所以稍后重试而不是等下一次播放
    if (result.code == 'NO_SESSION') {
      if (retry < 5) setTimeout(() => { void apply(retry + 1) }, 600)
      return
    }
    // UNAVAILABLE 是原生模块或取 session 的补丁缺失，不打扰用户
    if (result.code == 'UNAVAILABLE') return
    if (deviceUnsupported) return
    deviceUnsupported = true
    toast(global.i18n.t('setting_play_volume_balancer_failed'))
  }

  const handleConfigUpdated: typeof global.state_event.configUpdated = (keys) => {
    if (keys.includes('player.isEnableVolumeBalancer')) {
      deviceUnsupported = false
      if (!settingState.setting['player.isEnableVolumeBalancer']) void releaseVolumeBalancer()
      return
    }
    if (keys.includes('player.volumeBalancerLevel') && settingState.setting['player.isEnableVolumeBalancer']) void apply()
  }

  global.app_event.on('play', () => { void apply() })
  global.state_event.on('configUpdated', handleConfigUpdated)
}
