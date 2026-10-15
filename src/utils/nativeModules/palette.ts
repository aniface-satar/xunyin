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

export const prefetchCoverImage = async(url: string | null | undefined, headers: Record<string, string>): Promise<boolean> => {
  // file:// 是本地内嵌封面抽出来的文件，本来就不走网络，预热无意义
  if (Platform.OS !== 'android' || !url?.startsWith('http') || !PaletteModule?.prefetchImageWithHeaders) return false
  try {
    return await PaletteModule.prefetchImageWithHeaders(url, headers) === true
  } catch (e) {
    if (__DEV__) console.log('[palette] prefetchImageWithHeaders failed', url, e)
    return false
  }
}
