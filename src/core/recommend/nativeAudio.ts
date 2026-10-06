import { NativeModules, Platform } from 'react-native'

export interface DecodeResult {
  path: string
  samples: number
  sampleRate: number
}

interface DecodeModule {
  decode: (url: string, maxSeconds: number, headers: Record<string, string> | null) => Promise<DecodeResult>
}

interface TfliteRunResult {
  output: number[]
  inputShape?: string
  outputShape?: string
}

interface TfliteModule {
  load: (modelPath: string) => Promise<{ inputShape: string, outputShape: string }>
  run: (modelPath: string, input: number[], shape: number[]) => Promise<TfliteRunResult>
  release: () => Promise<null>
}

const decodeModule = (NativeModules.AudioFeatureDecode ?? null) as DecodeModule | null
const tfliteModule = (NativeModules.AudioFeatureTflite ?? null) as TfliteModule | null

/** 音频分析仅在 Android 可用（iOS 待补对应原生实现）；缺失时功能整体待命。 */
export const isNativeAudioAvailable = (): boolean =>
  Platform.OS == 'android' && decodeModule != null && tfliteModule != null

export const decodeToPcmFile = async(
  url: string,
  maxSeconds: number,
  headers?: Record<string, string> | null,
): Promise<DecodeResult> => {
  if (!decodeModule) return Promise.reject(new Error('native decode module unavailable'))
  return decodeModule.decode(url, maxSeconds, headers ?? null)
}

export const loadModel = async(modelPath: string): Promise<{ inputShape: string, outputShape: string }> => {
  if (!tfliteModule) return Promise.reject(new Error('native tflite module unavailable'))
  return tfliteModule.load(modelPath)
}

export const runModel = async(modelPath: string, input: number[], shape: number[]): Promise<TfliteRunResult> => {
  if (!tfliteModule) return Promise.reject(new Error('native tflite module unavailable'))
  return tfliteModule.run(modelPath, input, shape)
}

export const releaseModel = async(): Promise<null> => {
  if (!tfliteModule) return Promise.resolve(null)
  return tfliteModule.release()
}
