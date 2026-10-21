import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'

import Basic from './settings/Basic'
import Appearance from './settings/Appearance'
import Player from './settings/Player'
import LyricDesktop from './settings/LyricDesktop'
import Search from './settings/Search'
import Recommend from './settings/Recommend'
import List from './settings/List'
import Sync from './settings/Sync'
import Backup from './settings/Backup'
import Other from './settings/Other'
import Version from './settings/Version'
import About from './settings/About'

export const SETTING_SCREENS = [
  'basic',
  'appearance',
  'player',
  'lyric_desktop',
  'search',
  'recommend',
  'list',
  'sync',
  'backup',
  'other',
  'version',
  'about',
] as const

export type SettingScreenIds = typeof SETTING_SCREENS[number]

// interface MainProps {
//   onUpdateActiveId: (id: string) => void
// }
export interface MainType {
  setActiveId: (id: SettingScreenIds) => void
}

interface MainProps {
  activeId?: SettingScreenIds
}

const Main = forwardRef<MainType, MainProps>(({ activeId }, ref) => {
  const [id, setId] = useState(activeId ?? global.lx.settingActiveId)

  useImperativeHandle(ref, () => ({
    setActiveId(id) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setId(id)
        })
      })
    },
  }))

  useEffect(() => {
    if (activeId) setId(activeId)
  }, [activeId])

  const component = useMemo(() => {
    switch (id) {
      case 'player': return <Player />
      case 'appearance': return <Appearance />
      case 'lyric_desktop': return <LyricDesktop />
      case 'search': return <Search />
      case 'recommend': return <Recommend />
      case 'list': return <List />
      case 'sync': return <Sync />
      case 'backup': return <Backup />
      case 'other': return <Other />
      case 'version': return <Version />
      case 'about': return <About />
      case 'basic':
      default: return <Basic />
    }
  }, [id])

  return component
})


export default Main
