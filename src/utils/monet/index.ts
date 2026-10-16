import { getArgbPixels } from '@/utils/nativeModules/palette'
import { createCoverPalette } from './coverPalette'
import { buildCoverTexture } from './texture'

export { type CoverSurface } from './surface'
export { TEXTURE_OUT_HEIGHT, textureWidthFor } from './texture'

// 直接写 `export const getCoverSurface = palette.getCoverSurface` 会报
// @typescript-eslint/unbound-method（把对象方法当函数引用导出），所以每个导出都包一层箭头。
const palette = createCoverPalette(getArgbPixels, buildCoverTexture)

export const getCoverSurface = async(picUrl: string | null | undefined, fontColor: string) =>
  palette.getCoverSurface(picUrl, fontColor)

export const getCoverTexture = async(picUrl: string | null | undefined, fontColor: string, outWidth: number) =>
  palette.getCoverTexture(picUrl, fontColor, outWidth)

// 包一层箭头的原因同上面两条导出（@typescript-eslint/unbound-method）
export const getCoverAverageArgb = async(picUrl: string | null | undefined) =>
  palette.getCoverAverageArgb(picUrl)

export const clearCoverPaletteCache = () => {
  palette.clearCache()
}
