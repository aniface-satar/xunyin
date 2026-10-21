import { memo, useMemo } from 'react'
import { toast } from '@/utils/tools'
import { MUSIC_TOGGLE_MODE_LIST, MUSIC_TOGGLE_MODE } from '@/config/constant'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'
import Btn from './Btn'


export default memo(() => {
  const togglePlayMethod = useSettingValue('player.togglePlayMethod')
  const t = useI18n()

  const toggleNextPlayMode = () => {
    let index = MUSIC_TOGGLE_MODE_LIST.indexOf(togglePlayMethod)
    if (++index >= MUSIC_TOGGLE_MODE_LIST.length) index = 0
    const mode = MUSIC_TOGGLE_MODE_LIST[index]
    updateSetting({ 'player.togglePlayMethod': mode })
    let modeName: 'play_list_loop' | 'play_list_random' | 'play_list_order' | 'play_single_loop' | 'play_single'
    switch (mode) {
      case MUSIC_TOGGLE_MODE.listLoop:
        modeName = 'play_list_loop'
        break
      case MUSIC_TOGGLE_MODE.random:
        modeName = 'play_list_random'
        break
      case MUSIC_TOGGLE_MODE.list:
        modeName = 'play_list_order'
        break
      case MUSIC_TOGGLE_MODE.singleLoop:
        modeName = 'play_single_loop'
        break
      default:
        modeName = 'play_single'
        break
    }
    toast(t(modeName))
  }

  const playMode = useMemo(() => {
    switch (togglePlayMethod) {
      case MUSIC_TOGGLE_MODE.listLoop:
        return { icon: 'list-loop', labelKey: 'play_list_loop' } as const
      case MUSIC_TOGGLE_MODE.random:
        return { icon: 'list-random', labelKey: 'play_list_random' } as const
      case MUSIC_TOGGLE_MODE.list:
        return { icon: 'list-order', labelKey: 'play_list_order' } as const
      case MUSIC_TOGGLE_MODE.singleLoop:
        return { icon: 'single-loop', labelKey: 'play_single_loop' } as const
      default:
        return { icon: 'single', labelKey: 'play_single' } as const
    }
  }, [togglePlayMethod])

  return <Btn icon={playMode.icon} label={`${t('play_mode')}: ${t(playMode.labelKey)}`} onPress={toggleNextPlayMode} />
})
