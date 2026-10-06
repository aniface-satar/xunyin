import { NativeModules, Platform } from 'react-native'

const { VolumeBalancerModule, TrackPlayerModule } = NativeModules

export type VolumeBalancerLevel = 'low' | 'mid' | 'high'

const LEVEL_VALUES: Record<VolumeBalancerLevel, number> = { low: 0, mid: 1, high: 2 }

export interface VolumeBalancerResult {
  ok: boolean
  code: 'OK' | 'RELEASED' | 'UNAVAILABLE' | 'NO_SESSION' | 'UNSUPPORTED_SDK' | 'CREATE_FAILED' | 'NO_MBC' | 'CONFIGURE_FAILED'
}

// TrackPlayerModule.getAudioSessionId 来自 dependencies-patch.js 给 react-native-track-player
// 打的补丁；补丁没生效时功能整体退化为不可用，而不是抛异常。
const isAvailable = (): boolean => Platform.OS === 'android' &&
  VolumeBalancerModule != null &&
  typeof TrackPlayerModule?.getAudioSessionId === 'function'

export const applyVolumeBalancer = async(level: VolumeBalancerLevel): Promise<VolumeBalancerResult> => {
  if (!isAvailable()) return { ok: false, code: 'UNAVAILABLE' }
  const sessionId = await TrackPlayerModule.getAudioSessionId() as number
  return VolumeBalancerModule.apply(sessionId, LEVEL_VALUES[level])
}

export const releaseVolumeBalancer = async(): Promise<void> => {
  if (!isAvailable()) return
  await VolumeBalancerModule.release()
}
