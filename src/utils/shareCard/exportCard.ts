import type { RefObject } from 'react'
import type { View } from 'react-native'
import { captureRef } from 'react-native-view-shot'

import { APP_PROVIDER_NAME } from '@/config/constant'
import { shareImage } from '@/utils/nativeModules/utils'

export interface CapturedCard {
  /** Android 侧是 `file:///...`；剥掉前缀才是 shareImage 要的绝对路径 */
  uri: string
  path: string
}

/** view-shot 的 fileName 在安卓上要求至少 3 个字符 */
const safeFileName = (name: string) => {
  const cleaned = name.replace(/[^A-Za-z0-9_.-]/g, '_')
  return cleaned.length >= 3 ? cleaned : `lx_${cleaned}`
}

export const captureShareCard = async(ref: RefObject<View | null>, fileName: string): Promise<CapturedCard> => {
  const uri = await captureRef(ref, {
    format: 'png',
    quality: 1,
    result: 'tmpfile',
    fileName: safeFileName(fileName),
    // 不传 width/height：view-shot 是"按视图尺寸画 → createScaledBitmap"，
    // 传尺寸只会拿到放大后的糊图（spec §5）
  })
  return { uri, path: uri.replace(/^file:\/\//, '') }
}

export const shareCapturedCard = async(path: string, shareTitle: string, title: string, text: string) => {
  await shareImage(path, APP_PROVIDER_NAME, shareTitle, title, text)
}
