import { NativeModules, Platform } from 'react-native'

import type { CoverPixels } from '@/utils/monet/sourceColor'

const { PaletteModule } = NativeModules

export const getArgbPixels = async(url: string, maxSize = 128): Promise<CoverPixels | null> => {
  if (Platform.OS !== 'android' || !PaletteModule?.getArgbPixels) return null
  try {
    return await PaletteModule.getArgbPixels(url, maxSize) as CoverPixels | null
  } catch (e) {
    if (__DEV__) console.log('[palette] getArgbPixels failed', url, e)
    return null
  }
}
