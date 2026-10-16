import { type ImageStyle, type TextStyle } from 'react-native'

import Text from '@/components/common/Text'
import { BrandLine } from './BrandLine'
import CoverImage from './CoverImage'
import { type CardTheme } from './cardTheme'

interface Props {
  name: string
  singer: string
  pic: string | null | undefined
  coverSize: number
  theme: CardTheme
  /** 原样透传给 CoverImage：图没解出来时预览页那两枚按钮该禁用（spec §8 探针 2） */
  onCoverReady?: (ready: boolean) => void
}

export default ({ name, singer, pic, coverSize, theme, onCoverReady }: Props) => {
  return (
    <>
      <CoverImage url={pic} onReady={onCoverReady} style={{ ...styles.cover, width: coverSize, height: coverSize }} />
      <Text numberOfLines={3} style={{ ...styles.title, color: theme.titleColor }}>{name}</Text>
      <Text numberOfLines={2} style={{ ...styles.singer, color: theme.subtitleColor }}>{singer}</Text>
      <BrandLine color={theme.subtitleColor} />
    </>
  )
}

// Step 0：与 BrandLine 同一判据 —— 原始 dp，不走 createStyle；字号一律经 style.fontSize 传给 common/Text
// （它的 size prop 走 setSpText，会被用户的字号设置缩放）。
const styles: { cover: ImageStyle, title: TextStyle, singer: TextStyle } = {
  cover: { borderRadius: 18 },
  title: { marginTop: 18, fontSize: 24, lineHeight: 30 },
  singer: { marginTop: 6, fontSize: 18 },
}
