import { memo } from 'react'

import { StyleSheet, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import CheckBox from '@/components/common/CheckBox'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'

type Tier = 'off' | 'head' | 'full'

const TIERS: readonly Tier[] = ['head', 'full', 'off']

const Item = ({ tier, name, active }: { tier: Tier, name: string, active: boolean }) => {
  return <CheckBox marginRight={8} check={active} label={name} onChange={() => { updateSetting({ 'player.preloadNextMusicAudio': tier }) }} need />
}

export default memo(() => {
  const t = useI18n()
  const tier = useSettingValue('player.preloadNextMusicAudio')

  return (
    <SubTitle title={t('setting_play_preload_next_audio')}>
      <View style={styles.list}>
        {
          TIERS.map(id => <Item key={id} tier={id} name={t(`setting_play_preload_next_audio_${id}`)} active={tier == id} />)
        }
      </View>
    </SubTitle>
  )
})

const styles = StyleSheet.create({
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
})
