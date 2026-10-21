/* eslint-disable */
//! 此文件由 scripts/build-feature-icons.mjs 生成，请勿手改（改字形表后 npm run build:icons）
//! 字体：src/resources/fonts/feature-icons.ttf（同一份已同步到 android/app/src/main/assets/fonts/）

// FAMILY 给 createIconSet 用：Android 下字体名不带扩展名（icomoon 同样如此）
export const FEATURE_ICON_FONT_FAMILY = 'feature-icons'
// FILE 给资产校验用（tests/feature-icons-font.mts）
export const FEATURE_ICON_FONT_FILE = 'feature-icons.ttf'

export const featureIconGlyphs = {
  'radio-tower': '\ue9c0',
  'compass-outline': '\ue9c1',
  'ear-hearing': '\ue9c2',
  'link-variant': '\ue9c3',
  'music-box-outline': '\ue9c4',
} as const

export type FeatureIconName = keyof typeof featureIconGlyphs
