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
// 与原生 MAX_SECONDS 一致；桥接签名是 `start(int, …)`，所以这里也必须是整数秒。
const MAX_SECONDS = 10

export const isAudioRecordSupported = (): boolean => Platform.OS == 'android' && audioRecordModule != null

// 没有当前 Activity、部分 OEM ROM 上 request() 会直接 reject；本函数的签名承诺 boolean，
// 不能把异常抛给调用方（与 utils/tools.ts 的 requestStoragePermission 同一处理）。
export const requestRecordPermission = async(): Promise<boolean> => {
  if (Platform.OS != 'android') return false
  try {
    const status = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
    return status === PermissionsAndroid.RESULTS.GRANTED
  } catch {
    return false
  }
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
  // 原生签名是 start(int, …)，桥接处把 3.5 截断成 3：不加这道守卫就会真的录满 3 秒，
  // 再由下面的长度校验抛出一句像是设备坏了的话。这是调用方写错，不是设备问题。
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_SECONDS) {
    throw new Error(`recordPcm: seconds must be an integer within 1..${MAX_SECONDS}, got ${seconds}`)
  }
  const bytes = toByteArray(await audioRecordModule.start(seconds))
  // 设备做不到 48kHz 时，宁可在这里炸掉，也不能把错误采样率的音频当成 48kHz 交给
  // decimate —— 降采样比一旦错位，识曲只会安静地返回「没听到歌」。
  const expectedBytes = seconds * SAMPLE_RATE * 2
  if (bytes.length !== expectedBytes) {
    throw new Error(`recordPcm: captured ${bytes.length} bytes but ${seconds}s at ${SAMPLE_RATE}Hz mono PCM16 needs ${expectedBytes}`)
  }
  return { pcm: toInt16Array(bytes), sampleRate: SAMPLE_RATE }
}

export const cancelRecord = () => {
  audioRecordModule?.cancel()
}
