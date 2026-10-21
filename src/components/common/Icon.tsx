import { createIconSet, createIconSetFromIcoMoon } from 'react-native-vector-icons'
import icoMoonConfig from '@/resources/fonts/selection.json'
import { FEATURE_ICON_FONT_FAMILY, FEATURE_ICON_FONT_FILE, featureIconGlyphs, type FeatureIconName } from '@/resources/fonts/featureIcons'
import { scaleSizeW } from '@/utils/pixelRatio'
import { memo, type ComponentProps } from 'react'
import { useTextShadow, useTheme } from '@/store/theme/hook'
import { StyleSheet, type StyleProp, type TextStyle } from 'react-native'

// import IconAntDesign from 'react-native-vector-icons/AntDesign'
// import IconEntypo from 'react-native-vector-icons/Entypo'
// import IconEvilIcons from 'react-native-vector-icons/EvilIcons'
// import IconFeather from 'react-native-vector-icons/Feather'
// import IconFontAwesome from 'react-native-vector-icons/FontAwesome'
// import IconFontAwesome5 from 'react-native-vector-icons/FontAwesome5'
// import IconFontisto from 'react-native-vector-icons/Fontisto'
// import IconFoundation from 'react-native-vector-icons/Foundation'
// import IconIonicons from 'react-native-vector-icons/Ionicons'
// import IconMaterialIcons from 'react-native-vector-icons/MaterialIcons'
// import IconMaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons'
// import IconOcticons from 'react-native-vector-icons/Octicons'
// import IconZocial from 'react-native-vector-icons/Zocial'
// import IconSimpleLineIcons from 'react-native-vector-icons/SimpleLineIcons'


const IcoMoon = createIconSetFromIcoMoon(icoMoonConfig)

// 入口图标单独一个字体，不往 icomoon.ttf 里塞字形：那要重建全站 53 枚图标，一处度量出错就全站跟着崩。
// 字形由 scripts/build-feature-icons.mjs 生成，度量与 icomoon 对齐，所以 22dp 下和「我喜欢 / 历史播放」同重量。
const FeatureIconSet = createIconSet(featureIconGlyphs, FEATURE_ICON_FONT_FAMILY, FEATURE_ICON_FONT_FILE)


// https://oblador.github.io/react-native-vector-icons/

type IconType = ReturnType<typeof createIconSetFromIcoMoon>

interface IconProps extends Omit<ComponentProps<IconType>, 'style'> {
  style?: StyleProp<TextStyle>
  rawSize?: number
}

interface FeatureIconProps extends Omit<IconProps, 'name'> {
  name: FeatureIconName
}

const makeIconComponent = <Props extends IconProps>(Set: IconType) => memo(({ size = 15, rawSize, color, style, ...props }: Props) => {
  const theme = useTheme()
  const textShadow = useTextShadow()
  const newStyle = textShadow ? StyleSheet.compose({
    textShadowColor: theme['c-primary-dark-300-alpha-800'],
    textShadowOffset: { width: 0.2, height: 0.2 },
    textShadowRadius: 2,
  }, style) : style
  return (
    <Set
      size={rawSize ?? scaleSizeW(size)}
      color={color ?? theme['c-font']}
      // @ts-expect-error
      style={newStyle}
      {...props}
    />
  )
})

export const Icon = makeIconComponent<IconProps>(IcoMoon)

export const FeatureIcon = makeIconComponent<FeatureIconProps>(FeatureIconSet)


export {
  // IconAntDesign,
  // IconEntypo,
  // IconEvilIcons,
  // IconFeather,
  // IconFontAwesome,
  // IconFontAwesome5,
  // IconFontisto,
  // IconFoundation,
  // IconIonicons,
  // IconMaterialIcons,
  // IconMaterialCommunityIcons,
  // IconOcticons,
  // IconZocial,
  // IconSimpleLineIcons,
}
