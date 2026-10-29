import { memo } from 'react'

import { View } from 'react-native'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'

export default memo(({ title, children, level = 1 }: {
  title: string
  children: React.ReactNode | React.ReactNode[]
  /**
   * 层级。1 = 一级分组（现状），2 = 挂在某个选项下面的子分组：缩进更深、标题更小更淡。
   * 外观设置里「纯色背景 → 主题颜色」这种嵌套靠它区分。
   */
  level?: 1 | 2
}) => {
  const theme = useTheme()
  const isSub = level > 1

  return (
    <View style={isSub ? styles.containerSub : styles.container}>
      <Text
        style={isSub ? styles.titleSub : styles.title}
        size={isSub ? 13 : undefined}
        color={isSub ? theme['c-450'] : undefined}
      >{title}</Text>
      {children}
    </View>
  )
})


const styles = createStyle({
  container: {
    paddingLeft: 25,
    marginBottom: 18,
  },
  containerSub: {
    paddingLeft: 14,
    marginBottom: 10,
  },
  title: {
    marginLeft: -10,
    marginBottom: 10,
    // lineHeight: 16,
  },
  titleSub: {
    marginBottom: 6,
  },
})
