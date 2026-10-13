import { NativeModules, Platform } from 'react-native'

const { PaletteModule } = NativeModules

export const getArgbPixels = async(url: string, maxSize = 128): Promise<number[] | null> => {
  if (Platform.OS !== 'android' || !PaletteModule?.getArgbPixels) return null
  try {
    return await PaletteModule.getArgbPixels(url, maxSize) as number[]
  } catch (e) {
    if (__DEV__) console.log('[palette] getArgbPixels failed', url, e)
    return null
  }
}
