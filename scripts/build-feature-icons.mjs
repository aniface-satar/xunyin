// 生成 feature-icons 字体：功能入口用的线性字形（个性电台 / 探索未知 / 听歌识曲 / 分享链接 / 歌词卡片）。
//
// 为什么要造字体：本项目没有 react-native-svg，PNG 又不会跟着主题变色，而现有图标全部来自
// icomoon 字体；入口图标要和「我喜欢 / 历史播放」同规格，就得走同一条路——线性字形 + 字体着色。
// 这里刻意不往 icomoon.ttf 里塞字形：那要重建全站 53 枚图标，一处度量出错就全站跟着崩。
//
// 轮廓取自 Material Design Icons（Apache-2.0，https://pictogrammers.com/library/mdi/ ），
// 度量对齐 icomoon.ttf 的实测值（unitsPerEm 1024 / ascent 960 / descent 64），
// 于是 24 栅格的 MDI 图形落在同一条基线上，22dp 下的视觉重量能和邻居对得齐。
//
// 跑法：npm run build:icons（改字形表后重跑；产物 feature-icons.ttf 与 featureIcons.ts 一起提交）
// 字形来源核对：npm i -D @mdi/js 后 node -e "console.log(require('@mdi/js').mdiRadio)"

import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { SVGIcons2SVGFontStream } from 'svgicons2svgfont'
import svg2ttf from 'svg2ttf'

const FONT_NAME = 'feature-icons'
const UNITS_PER_EM = 1024
const ASCENT = 960
const DESCENT = 64

// 码点从 U+E9C0 起：icomoon 实占 U+E900–U+E93x，留出整段余量避免撞车
const GLYPHS = [
  {
    name: 'radio-tower',
    code: 0xE9C0,
    source: 'mdiRadioTower',
    d: 'M12,10A2,2 0 0,1 14,12C14,12.5 13.82,12.94 13.53,13.29L16.7,22H14.57L12,14.93L9.43,22H7.3L10.47,13.29C10.18,12.94 10,12.5 10,12A2,2 0 0,1 12,10M12,8A4,4 0 0,0 8,12C8,12.5 8.1,13 8.28,13.46L7.4,15.86C6.53,14.81 6,13.47 6,12A6,6 0 0,1 12,6A6,6 0 0,1 18,12C18,13.47 17.47,14.81 16.6,15.86L15.72,13.46C15.9,13 16,12.5 16,12A4,4 0 0,0 12,8M12,4A8,8 0 0,0 4,12C4,14.36 5,16.5 6.64,17.94L5.92,19.94C3.54,18.11 2,15.23 2,12A10,10 0 0,1 12,2A10,10 0 0,1 22,12C22,15.23 20.46,18.11 18.08,19.94L17.36,17.94C19,16.5 20,14.36 20,12A8,8 0 0,0 12,4Z',
  },
  {
    name: 'compass-outline',
    code: 0xE9C1,
    source: 'mdiCompassOutline',
    d: 'M7,17L10.2,10.2L17,7L13.8,13.8L7,17M12,11.1A0.9,0.9 0 0,0 11.1,12A0.9,0.9 0 0,0 12,12.9A0.9,0.9 0 0,0 12.9,12A0.9,0.9 0 0,0 12,11.1M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4Z',
  },
  {
    name: 'ear-hearing',
    code: 0xE9C2,
    source: 'mdiEarHearing',
    d: 'M17,20C16.71,20 16.44,19.94 16.24,19.85C15.53,19.5 15.03,18.97 14.53,17.47C14,15.91 13.06,15.18 12.14,14.47C11.35,13.86 10.53,13.23 9.82,11.94C9.29,11 9,9.93 9,9C9,6.2 11.2,4 14,4C16.8,4 19,6.2 19,9H21C21,5.07 17.93,2 14,2C10.07,2 7,5.07 7,9C7,10.26 7.38,11.65 8.07,12.9C9,14.55 10.05,15.38 10.92,16.05C11.73,16.67 12.31,17.12 12.63,18.1C13.23,19.92 14,20.94 15.36,21.65C15.87,21.88 16.43,22 17,22A4,4 0 0,0 21,18H19A2,2 0 0,1 17,20M7.64,2.64L6.22,1.22C4.23,3.21 3,5.96 3,9C3,12.04 4.23,14.79 6.22,16.78L7.63,15.37C6,13.74 5,11.5 5,9C5,6.5 6,4.26 7.64,2.64M11.5,9A2.5,2.5 0 0,0 14,11.5A2.5,2.5 0 0,0 16.5,9A2.5,2.5 0 0,0 14,6.5A2.5,2.5 0 0,0 11.5,9Z',
  },
  {
    name: 'link-variant',
    code: 0xE9C3,
    source: 'mdiLinkVariant',
    d: 'M10.59,13.41C11,13.8 11,14.44 10.59,14.83C10.2,15.22 9.56,15.22 9.17,14.83C7.22,12.88 7.22,9.71 9.17,7.76V7.76L12.71,4.22C14.66,2.27 17.83,2.27 19.78,4.22C21.73,6.17 21.73,9.34 19.78,11.29L18.29,12.78C18.3,11.96 18.17,11.14 17.89,10.36L18.36,9.88C19.54,8.71 19.54,6.81 18.36,5.64C17.19,4.46 15.29,4.46 14.12,5.64L10.59,9.17C9.41,10.34 9.41,12.24 10.59,13.41M13.41,9.17C13.8,8.78 14.44,8.78 14.83,9.17C16.78,11.12 16.78,14.29 14.83,16.24V16.24L11.29,19.78C9.34,21.73 6.17,21.73 4.22,19.78C2.27,17.83 2.27,14.66 4.22,12.71L5.71,11.22C5.7,12.04 5.83,12.86 6.11,13.65L5.64,14.12C4.46,15.29 4.46,17.19 5.64,18.36C6.81,19.54 8.71,19.54 9.88,18.36L13.41,14.83C14.59,13.66 14.59,11.76 13.41,10.59C13,10.2 13,9.56 13.41,9.17Z',
  },
  {
    name: 'music-box-outline',
    code: 0xE9C4,
    source: 'mdiMusicBoxOutline',
    d: 'M16,9H13V14.5A2.5,2.5 0 0,1 10.5,17A2.5,2.5 0 0,1 8,14.5A2.5,2.5 0 0,1 10.5,12C11.07,12 11.58,12.19 12,12.5V7H16V9M19,3A2,2 0 0,1 21,5V19A2,2 0 0,1 19,21H5A2,2 0 0,1 3,19V5A2,2 0 0,1 5,3H19M5,5V19H19V5H5Z',
  },
]

const rootDir = path.join(import.meta.dirname, '..')
const outPaths = {
  ttf: path.join(rootDir, 'src/resources/fonts', `${FONT_NAME}.ttf`),
  android: path.join(rootDir, 'android/app/src/main/assets/fonts', `${FONT_NAME}.ttf`),
  glyphMap: path.join(rootDir, 'src/resources/fonts', 'featureIcons.ts'),
}

const iconSvg = d =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="${d}"/></svg>`

const buildSvgFont = async() => {
  const fontStream = new SVGIcons2SVGFontStream({
    fontName: FONT_NAME,
    fontId: FONT_NAME,
    fontHeight: UNITS_PER_EM,
    ascent: ASCENT,
    descent: DESCENT,
    // 不归一化：按 24 栅格原样缩放。归一化会让每枚图标各自撑满 em 框，三枚之间大小就不齐了
    normalize: false,
  })
  const chunks = []
  fontStream.on('data', chunk => chunks.push(String(chunk)))
  const ended = new Promise(resolve => fontStream.on('end', resolve))
  for (const glyph of GLYPHS) {
    const stream = Readable.from([iconSvg(glyph.d)])
    stream.metadata = { name: glyph.name, unicode: [String.fromCodePoint(glyph.code)] }
    fontStream.write(stream)
  }
  fontStream.end()
  await ended
  return chunks.join('')
}

const svgFont = await buildSvgFont()
const ttf = Buffer.from(svg2ttf(svgFont, {}).buffer)

writeFileSync(outPaths.ttf, ttf)
writeFileSync(outPaths.android, ttf)
writeFileSync(outPaths.glyphMap, `/* eslint-disable */
//! 此文件由 scripts/build-feature-icons.mjs 生成，请勿手改（改字形表后 npm run build:icons）
//! 字体：src/resources/fonts/${FONT_NAME}.ttf（同一份已同步到 android/app/src/main/assets/fonts/）

// FAMILY 给 createIconSet 用：Android 下字体名不带扩展名（icomoon 同样如此）
export const FEATURE_ICON_FONT_FAMILY = '${FONT_NAME}'
// FILE 给资产校验用（tests/feature-icons-font.mts）
export const FEATURE_ICON_FONT_FILE = '${FONT_NAME}.ttf'

export const featureIconGlyphs = {
${GLYPHS.map(g => `  '${g.name}': '\\u${g.code.toString(16)}',`).join('\n')}
} as const

export type FeatureIconName = keyof typeof featureIconGlyphs
`)

console.log(`生成 ${FONT_NAME}.ttf ${ttf.length} 字节：${GLYPHS.map(g => `${g.name}@U+${g.code.toString(16).toUpperCase()}`).join(' ')}`)
console.log(`写入 ${path.relative(rootDir, outPaths.ttf)}、${path.relative(rootDir, outPaths.android)}、${path.relative(rootDir, outPaths.glyphMap)}`)
console.log('字体内容校验由 tests/feature-icons-font.mts 负责（npm run test）')
