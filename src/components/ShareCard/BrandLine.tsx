import { Image, View, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native'

import Text from '@/components/common/Text'

// 与 src/components/common/LocateButton.tsx:7 同一写法：require + @/resources 别名，Metro 认。
// 不加 tintColor —— 这个字形自带品牌青，染色就不是 App 图标了。
// 这张 PNG 是抠过底的字形本体（218×204，只剩青色墨迹，唱片上的白色刻线/音符是透明）：
// 直接拿 ic_launcher_foreground 会在深色卡上露出一块白色圆角方片 —— 前景图的四角确实透明，
// 但墨迹外面那圈白方片是不透明的，spec §1 当年只量了画布四角，量不出这个问题。
// eslint-disable-next-line @typescript-eslint/no-var-requires -- tsc 这一侧只认 require：仓库里没有 `declare module '*.png'`，静态 import 会报"找不到模块"。
const glyph = require('@/resources/images/app-icon-glyph.png')

export const BrandLine = ({ color }: { color: string }) => {
  return (
    <View style={styles.row}>
      {/* 只剩青色墨迹的字形本体（唱片上的白色刻线是透明的，透出卡片底色），深卡亮卡共用同一张图 */}
      <Image source={glyph} style={styles.glyph} resizeMode="contain" />
      <Text allowFontScaling={false} style={[styles.word, { color }]}>Music</Text>
    </View>
  )
}

// 与 MusicCard / LyricCard 同一对补丁：allowFontScaling={false} 挡住系统字号（这一行按 16+20 记账，
// 胀 30% 就把落款顶出圆角卡），noShadow 挡住 common/Text 从 theme.fontShadow 铺上来的文字阴影。
const noShadow: TextStyle = {
  textShadowColor: 'transparent',
  textShadowRadius: 0,
  textShadowOffset: { width: 0, height: 0 },
}

// Step 0：分享图是产物，字号与用户在设置里调的 global.lx.fontSize 无关，所以这一层刻意不走 createStyle
// （那支会把每个数字乘上字号系数）。也不套 StyleSheet.create —— 那只是同一份对象的包装，
// 加了反而看不出"这里故意不换算"。数字与键与 brief 一致，只是用 RN 的样式类型标注住。
const styles: { row: ViewStyle, glyph: ImageStyle, word: TextStyle } = {
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  // 资源已裁到墨迹外框（218×204），contain 下框高就是字形高。13.1 = 17dp 字号的大写高度 12.09
  // 乘 1.08（圆形字标要比 M 略出头才等重），14 = 13.1 × 218/204。
  // 旧值 20×20 看着小是因为那 20dp 里外圈白方片占了 2/3，真正落到唱片上只剩约 9.4dp。
  glyph: { width: 14, height: 13.1, marginRight: 5 },
  word: { ...noShadow, fontSize: 17, letterSpacing: 0.2 },
}
