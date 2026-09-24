import { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'

import MusicList, { type MusicListType } from '@/screens/Home/Views/Leaderboard/MusicList'
import PageContent from '@/components/PageContent'
import StatusBar from '@/components/common/StatusBar'
import { setComponentId } from '@/core/common'
import { COMPONENT_IDS, NAV_SHEAR_NATIVE_IDS } from '@/config/constant'
import { saveLeaderboardSetting } from '@/utils/data'
import { createStyle } from '@/utils/tools'
import PlayerBar from '@/components/player/PlayerBar'
import BottomTabBar from '@/screens/Home/Vertical/BottomTabBar'
import { PlayerOverlayProvider } from '@/components/player/PlayerOverlay'
import { pop } from '@/navigation'
import Header from './Header'
import { LeaderboardInfoContext } from './state'

export default ({ componentId, source, board, embedded = false, onBack }: {
  componentId: string
  source: LX.OnlineSource
  board: {
    id: string
    name: string
    bangid: string
  }
  embedded?: boolean
  onBack?: () => void
}) => {
  const musicListRef = useRef<MusicListType>(null)
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false)

  const handleMultiSelectModeChange = useCallback((value: boolean) => {
    setIsMultiSelectMode(value)
  }, [])

  const handleToggleMultiSelect = useCallback(() => {
    if (isMultiSelectMode) musicListRef.current?.exitMultiSelect()
    else musicListRef.current?.showMultiSelect()
  }, [isMultiSelectMode])

  useEffect(() => {
    if (!embedded) setComponentId(COMPONENT_IDS.leaderboardDetail, componentId)
    void saveLeaderboardSetting({ source, boardId: board.id })
    musicListRef.current?.loadList(source, board.id)
  }, [board.id, componentId, embedded, source])

  if (embedded) {
    return (
      <LeaderboardInfoContext.Provider value={{ source, board }}>
        <View style={styles.content}>
          <Header componentId={componentId} onBack={onBack} isMultiSelectMode={isMultiSelectMode} onToggleMultiSelect={handleToggleMultiSelect} />
          <MusicList ref={musicListRef} checkHomePagerIdle={false} multiSelectStyle="mylist" onMultiSelectModeChange={handleMultiSelectModeChange} />
        </View>
      </LeaderboardInfoContext.Provider>
    )
  }

  return (
    <PlayerOverlayProvider>
      <PageContent>
        <StatusBar />
        <LeaderboardInfoContext.Provider value={{ source, board }}>
          <View nativeID={NAV_SHEAR_NATIVE_IDS.leaderboardDetail_content} style={styles.content} collapsable={false}>
            <Header componentId={componentId} isMultiSelectMode={isMultiSelectMode} onToggleMultiSelect={handleToggleMultiSelect} />
            <MusicList ref={musicListRef} checkHomePagerIdle={false} multiSelectStyle="mylist" onMultiSelectModeChange={handleMultiSelectModeChange} />
          </View>
        </LeaderboardInfoContext.Provider>
        <PlayerBar />
        <BottomTabBar onTabPress={() => { void pop(componentId) }} />
      </PageContent>
    </PlayerOverlayProvider>
  )
}

const styles = createStyle({
  content: {
    flex: 1,
  },
})
