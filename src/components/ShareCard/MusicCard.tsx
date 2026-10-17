import { type ImageStyle, type TextStyle } from 'react-native'

import Text from '@/components/common/Text'
import { BrandLine } from './BrandLine'
import CoverImage from './CoverImage'
import { type CardTheme } from './cardTheme'
import { cardTextSizes } from './cardTypography'

interface Props {
  name: string
  singer: string
  pic: string | null | undefined
  coverSize: number
  /** 卡内文字那一列的可用宽度（原始 dp）：字号按"一行最多 26 个英文字母"从它算出来，见 cardTypography.ts */
  textWidth: number
  theme: CardTheme
  /** 原样透传给 CoverImage：图没解出来时预览页那两枚按钮该禁用（spec §8 探针 2） */
  onCoverReady?: (ready: boolean) => void
}

export default ({ name, singer, pic, coverSize, textWidth, theme, onCoverReady }: Props) => {
  const sizes = cardTextSizes(textWidth)
  return (
    <>
      <CoverImage url={pic} onReady={onCoverReady} style={{ ...styles.cover, width: coverSize, height: coverSize }} />
      <Text numberOfLines={3} allowFontScaling={false} style={{ ...styles.title, fontSize: sizes.title, lineHeight: sizes.titleLineHeight, color: theme.titleColor }}>{name}</Text>
      <Text numberOfLines={2} allowFontScaling={false} style={{ ...styles.singer, fontSize: sizes.singer, color: theme.subtitleColor }}>{singer}</Text>
      <BrandLine color={theme.subtitleColor} />
    </>
  )
}

// 卡内每一枚 Text 都要 allowFontScaling={false}：common/Text 把 ...props 摊在 RN Text 上（Text.tsx:49-52），
// 这个 prop 透得过去；不透的话安卓会按**系统**字号乘 fontSize/lineHeight，把文字块顶穿 index.tsx 的高度预算。
// noShadow 是同一类漏子的另一半：common/Text 把用户设的 theme.fontShadow 铺在 **base** style 上
// （Text.tsx:35-46），而导出图不是 App 界面（spec §3）。逐条覆盖回去就好，不必改 src/components/common/Text ——
// 那是全站共用的组件，改它不在本轮范围里。
const noShadow: TextStyle = {
  textShadowColor: 'transparent',
  textShadowRadius: 0,
  textShadowOffset: { width: 0, height: 0 },
}

// Step 0：与 BrandLine 同一判据 —— 原始 dp，不走 createStyle；字号一律经 style.fontSize 传给 common/Text
// （它的 size prop 走 setSpText，会被用户的字号设置缩放）。
// fontSize/lineHeight 不在这里：那两个数按"一行最多 26 个英文字母"从卡内文字宽度算（cardTypography.ts）。
const styles: { cover: ImageStyle, title: TextStyle, singer: TextStyle } = {
  cover: { borderRadius: 12 },
  title: { ...noShadow, marginTop: 18 },
  singer: { ...noShadow, marginTop: 6 },
}
