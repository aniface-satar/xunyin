import { useEffect, useState } from 'react'
import type { SettingScreenIds } from './Main'

export const setSettingDetailId = (id: SettingScreenIds | null) => {
  if (global.lx.settingDetailId == id) return
  global.lx.settingDetailId = id
  global.state_event.settingDetailIdUpdated(id)
}

export const useSettingDetailId = () => {
  const [id, setId] = useState(global.lx.settingDetailId)

  useEffect(() => {
    const update = (detailId: SettingScreenIds | null) => {
      setId(detailId)
    }

    global.state_event.on('settingDetailIdUpdated', update)
    return () => {
      global.state_event.off('settingDetailIdUpdated', update)
    }
  }, [])

  return id
}
