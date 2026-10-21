import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, TouchableOpacity } from 'react-native'
import CheckBox from './Checkbox'

import { createStyle, tipDialog } from '@/utils/tools'
import { scaleSizeH, scaleSizeW } from '@/utils/pixelRatio'
import { useTheme } from '@/store/theme/hook'
import Text from '../Text'
import { Icon } from '../Icon'

export interface CheckBoxProps {
  check: boolean
  label?: string
  children?: React.ReactNode
  onChange: (check: boolean) => void
  disabled?: boolean
  need?: boolean
  size?: number
  marginRight?: number
  marginBottom?: number
  /** 多行标签时勾选框贴哪一边；默认居中 */
  align?: 'center' | 'start'

  helpTitle?: string
  helpDesc?: string
}

export default ({ check, label, children, onChange, helpTitle, helpDesc, disabled = false, need = false, marginRight = 0, marginBottom = 0, size = 1, align = 'center' }: CheckBoxProps) => {
  const theme = useTheme()
  const [isDisabled, setDisabled] = useState(false)
  const tintColors = {
    true: theme['c-primary'],
    false: theme['c-600'],
  }
  const disabledTintColors = {
    true: theme['c-primary-alpha-600'],
    false: theme['c-400'],
  }

  useEffect(() => {
    if (need) {
      if (check) {
        if (!isDisabled) setDisabled(true)
      } else {
        if (isDisabled) setDisabled(false)
      }
    } else {
      isDisabled && setDisabled(false)
    }
  }, [check, need, isDisabled])

  const handleLabelPress = useCallback(() => {
    if (isDisabled) return
    onChange?.(!check)
  }, [isDisabled, onChange, check])

  const helpComponent = useMemo(() => {
    const handleShowHelp = () => {
      void tipDialog({
        title: helpTitle ?? '',
        message: helpDesc,
        btnText: global.i18n.t('understand'),
      })
    }
    return (helpTitle ?? helpDesc) ? (
      <TouchableOpacity style={styles.helpBtn} onPress={handleShowHelp} accessibilityRole="button" accessibilityLabel={global.i18n.t('help')}>
        <Icon size={15 * size} name="help" />
      </TouchableOpacity>
    ) : null
  }, [helpTitle, helpDesc, size])


  const contentStyle = { ...styles.content, marginBottom: scaleSizeH(marginBottom), alignItems: align == 'start' ? 'flex-start' as const : 'center' as const }
  const labelStyle = { ...styles.label, marginRight: scaleSizeW(marginRight) }

  return (
    disabled
      ? (
          <View style={contentStyle}>
            <CheckBox status={check ? 'checked' : 'unchecked'} disabled={true} accessibilityLabel={label} tintColors={disabledTintColors} size={size} />
            <View style={labelStyle}>{label ? <Text style={styles.name} color={theme['c-500']} size={15 * size}>{label}</Text> : children}</View>
            {helpComponent}
          </View>
        )
      : (
          <View style={contentStyle}>
            <CheckBox status={check ? 'checked' : 'unchecked'} disabled={isDisabled} accessibilityLabel={label} onPress={handleLabelPress} tintColors={tintColors} size={size} />
            <TouchableOpacity style={labelStyle} activeOpacity={0.3} onPress={handleLabelPress}>
              {label ? <Text style={styles.name} size={15 * size}>{label}</Text> : children}
            </TouchableOpacity>
            {helpComponent}
          </View>
        )
  )
}

const styles = createStyle({
  content: {
    flexGrow: 0,
    flexShrink: 1,
    marginRight: 15,
    alignItems: 'center',
    flexDirection: 'row',
    // backgroundColor: 'rgba(0,0,0,0.2)',
  },
  checkbox: {
    flex: 0,
    // backgroundColor: 'rgba(0,0,0,0.2)',
  },
  label: {
    flexGrow: 0,
    flexShrink: 1,
    // marginRight: 15,
    // alignItems: 'center',
    // backgroundColor: 'rgba(0,0,0,0.2)',
    paddingRight: 3,
  },
  name: {
    marginTop: 2,
  },
  helpBtn: {
    // backgroundColor: 'rgba(0, 0, 0, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
})

