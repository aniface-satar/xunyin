import { NativeModules, PermissionsAndroid, Platform } from 'react-native'
import { toByteArray } from 'react-native-quick-base64'

interface MusicAudioRecordModule {
  start: (seconds: number) => Promise<string>
  cancel: () => void
}

const audioRecordModule = (NativeModules.MusicAudioRecord ?? null) as MusicAudioRecordModule | null

// 原生侧只承诺「48kHz 单声道 PCM16」，它没有能力回报实际采样率，所以采样率在这里
// 是一个需要被长度验证的假设，不是一个可以直接相信的数字。
const SAMPLE_RATE = 48000

export const isAudioRecordSupported = (): boolean => Platform.OS == 'android' && audioRecordModule != null

export const requestRecordPermission = async(): Promise<boolean> => {
  if (Platform.OS != 'android') return false
  const status = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
  return status === PermissionsAndroid.RESULTS.GRANTED
}

// 显式拷进新 buffer：toByteArray 返回的 Uint8Array 可能带非零 byteOffset，
// 直接拿它的 .buffer 构造 Int16Array 会抛 RangeError。
const toInt16Array = (bytes: Uint8Array): Int16Array => {
  const buffer = new ArrayBuffer(bytes.length)
  new Uint8Array(buffer).set(bytes)
  return new Int16Array(buffer)
}

export const recordPcm = async(seconds: number): Promise<{ pcm: Int16Array, sampleRate: 48000 }> => {
  if (!audioRecordModule) throw new Error('audio record module is not available')
  const bytes = toByteArray(await audioRecordModule.start(seconds))
  // 设备做不到 48kHz 时，宁可在这里炸掉，也不能把错误采样率的音频当成 48kHz 交给
  // decimateTo8k —— 降采样比一旦错位，识曲只会安静地返回「没听到歌」。
  const expectedBytes = seconds * SAMPLE_RATE * 2
  if (bytes.length !== expectedBytes) {
    throw new Error(`recordPcm: captured ${bytes.length} bytes but ${seconds}s at ${SAMPLE_RATE}Hz mono PCM16 needs ${expectedBytes}`)
  }
  return { pcm: toInt16Array(bytes), sampleRate: SAMPLE_RATE }
}

export const cancelRecord = () => {
  audioRecordModule?.cancel()
}
