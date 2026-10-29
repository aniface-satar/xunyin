import { cardFileName } from './cardFileName.ts'

/**
 * 封面图落盘的文件名判据。除 cardFileName.ts 外不许有 import（规矩同 saveTarget.ts）：
 * node --test 走 ESM，从 saveCard.ts 那类带 store / react-native-fs 的模块 import 会直接载不动。
 */

/** 认得的图片后缀；其它一律按 jpg 落盘，别把 .flac / 无后缀的 URL 原样带给文件系统 */
const PIC_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])

/** 先砍查询串和锚点再取后缀：咪咕/企鹅的图床常在 URL 尾巴上挂参数 */
export const picFileExtension = (pic: string): string => {
  const urlPath = pic.split(/[?#]/)[0]
  const matched = /\.([A-Za-z0-9]+)$/.exec(urlPath)
  const ext = matched?.[1].toLowerCase() ?? ''
  return PIC_EXTENSIONS.has(ext) ? ext : 'jpg'
}

export const coverBaseName = (name: string, singer: string) => cardFileName(name, singer, 'cover')

export const coverFileName = (name: string, singer: string, pic: string) =>
  `${coverBaseName(name, singer)}.${picFileExtension(pic)}`
