import { memo } from 'react'
import { View } from 'react-native'

import CheckBoxItem from '../../components/CheckBoxItem'
import SubTitle from '../../components/SubTitle'
import CheckBox from '@/components/common/CheckBox'
import { createStyle } from '@/utils/tools'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { normalizeCoverAlgo } from '@/utils/monet/coverPalette'
import { setPlayerBgAlgorithm, setPlayerBgMode, type PlayerBgMode } from '@/core/playerBg'

/**
 * 「播控页背景」这一级：三选一，选中哪个才展开它的子项（取色方式只在动态背景下面才有意义）。
 *
 * 三种落点共用两个旧布尔（见 core/playerBg.ts），所以这里不需要新增设置键，
 * 也不需要在播放页里加分支 —— 现有各层读到的还是它们原本就在读的那两个值。
 */
export default memo(() => {
  const t = useI18n()
  const dynamicBg = useSettingValue('theme.dynamicBg')
  const applyToPlayer = useSettingValue('theme.customBg.applyToPlayer')
  const customBgEnabled = useSettingValue('theme.customBg.enabled')
  const algorithm = normalizeCoverAlgo(useSettingValue('theme.dynamicBgAlgorithm'))

  const mode: PlayerBgMode = dynamicBg ? 'dynamic' : applyToPlayer ? 'custom' : 'white'

  return (
    <SubTitle title={t('setting_appearance_player_bg')}>
      <CheckBoxItem
        need
        marginBottom={6}
        check={mode == 'white'}
        label={t('setting_appearance_player_bg_white')}
        disabled={customBgEnabled}
        helpDesc={
          customBgEnabled
            ? t('setting_appearance_player_bg_white_locked')
            : t('setting_appearance_player_bg_white_tip')
        }
        onChange={() => { setPlayerBgMode('white') }}
      />

      <CheckBoxItem
        need
        marginBottom={6}
        check={mode == 'dynamic'}
        label={t('setting_appearance_player_bg_dynamic')}
        onChange={() => { setPlayerBgMode('dynamic') }}
      />
      {
        mode == 'dynamic'
          ? (
              <SubTitle level={2} title={t('setting_basic_theme_dynamic_bg_algorithm')}>
                <View style={styles.list}>
                  <CheckBox
                    need
                    marginBottom={3}
                    check={algorithm == 'monet'}
                    label={t('setting_basic_theme_dynamic_bg_algorithm_monet')}
                    onChange={() => { setPlayerBgAlgorithm('monet') }}
                  />
                  <CheckBox
                    need
                    marginBottom={3}
                    check={algorithm == 'blur'}
                    label={t('setting_basic_theme_dynamic_bg_algorithm_blur')}
                    onChange={() => { setPlayerBgAlgorithm('blur') }}
                  />
                </View>
              </SubTitle>
            )
          : null
      }

      <CheckBoxItem
        need
        check={mode == 'custom'}
        label={t('setting_appearance_player_bg_custom')}
        disabled={!customBgEnabled}
        helpDesc={customBgEnabled ? undefined : t('setting_appearance_player_bg_custom_locked')}
        onChange={() => { setPlayerBgMode('custom') }}
      />
    </SubTitle>
  )
})

const styles = createStyle({
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 6,
  },
})
