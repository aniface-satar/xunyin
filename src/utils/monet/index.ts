import { getArgbPixels } from '@/utils/nativeModules/palette'
import { createCoverPalette } from './coverPalette'

export { type CoverSurface } from './surface'

const palette = createCoverPalette(getArgbPixels)

export const getCoverSurface = palette.getCoverSurface
export const clearCoverPaletteCache = palette.clearCache
