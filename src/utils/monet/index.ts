import { getArgbPixels } from '@/utils/nativeModules/palette'
import { createCoverPalette } from './coverPalette'

export { type CoverSurface } from './surface'

// 直接写 `export const getCoverSurface = palette.getCoverSurface` 会报
// @typescript-eslint/unbound-method（把对象方法当函数引用导出），所以两个导出都包一层箭头。
const palette = createCoverPalette(getArgbPixels)

export const getCoverSurface = async(picUrl: string | null | undefined, fontColor: string) =>
  palette.getCoverSurface(picUrl, fontColor)

export const clearCoverPaletteCache = () => {
  palette.clearCache()
}
