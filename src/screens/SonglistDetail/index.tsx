import { useEffect, useRef } from 'react'

import MusicList, { type MusicListType } from './MusicList'
import PageContent from '@/components/PageContent'
import StatusBar from '@/components/common/StatusBar'
import { setComponentId, removeComponentId } from '@/core/common'
import { COMPONENT_IDS } from '@/config/constant'
import { type ListInfoItem } from '@/store/songlist/state'
import PlayerBar from '@/components/player/PlayerBar'
import { PlayerOverlayProvider } from '@/components/player/PlayerOverlay'
import BottomTabBar from '@/screens/Home/Vertical/BottomTabBar'
import { pop } from '@/navigation'
import { ListInfoContext } from './state'


export default ({ componentId, info, embedded = false, onBack }: {
  componentId: string
  info: ListInfoItem
  embedded?: boolean
  onBack?: () => void
}) => {
  const musicListRef = useRef<MusicListType>(null)
  const isUnmountedRef = useRef(false)

  useEffect(() => {
    if (!embedded) setComponentId(COMPONENT_IDS.songlistDetail, componentId)

    isUnmountedRef.current = false

    musicListRef.current?.loadList(info.source, info.id)


    return () => {
      isUnmountedRef.current = true
      if (!embedded) removeComponentId(componentId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (embedded) {
    return (
      <ListInfoContext.Provider value={info}>
        <MusicList ref={musicListRef} componentId={componentId} onBack={onBack} />
      </ListInfoContext.Provider>
    )
  }


  return (
    <PlayerOverlayProvider>
      <PageContent>
        <StatusBar />
        <ListInfoContext.Provider value={info}>
          <MusicList ref={musicListRef} componentId={componentId} />
        </ListInfoContext.Provider>
        <PlayerBar />
        <BottomTabBar onTabPress={() => { void pop(componentId) }} />
      </PageContent>
    </PlayerOverlayProvider>
  )
}

// const styles = createStyle({
//   container: {
//     width: '100%',
//     flex: 1,
//     flexDirection: 'row',
//     borderTopWidth: BorderWidths.normal,
//   },
//   content: {
//     flex: 1,
//   },
// })
