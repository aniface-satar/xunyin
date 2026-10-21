import { useEffect } from 'react'
// import { View, StyleSheet } from 'react-native'
import { useHorizontalMode } from '@/utils/hooks'

import Vertical from './Vertical'
import Horizontal from './Horizontal'
import PageContent from '@/components/PageContent'
import StatusBar from '@/components/common/StatusBar'
import OnCoverThemeProvider from '@/components/player/OnCoverThemeProvider'
import CoverStageProvider from '@/components/player/CoverStageProvider'
import { setComponentId } from '@/core/common'
import { COMPONENT_IDS } from '@/config/constant'

export default ({ componentId }: { componentId: string }) => {
  const isHorizontalMode = useHorizontalMode()

  useEffect(() => {
    setComponentId(COMPONENT_IDS.playDetail, componentId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (isHorizontalMode) {
    return (
      <PageContent>
        <StatusBar />
        <Horizontal componentId={componentId} />
      </PageContent>
    )
  }

  // 只有竖屏这棵树挂 provider：铺底的 CoverBackdrop 只存在于 Vertical，横屏若也跟着换墨色，
  // 白字就落在主题原本的（可能是浅色的）背景上 —— 那是可读性的反面。
  // CoverStageProvider 必须在 OnCoverThemeProvider 外侧：墨阶按台取（见 CoverStageProvider）。
  return (
    <PageContent>
      <CoverStageProvider>
        <OnCoverThemeProvider>
          <StatusBar />
          <Vertical />
        </OnCoverThemeProvider>
      </CoverStageProvider>
    </PageContent>
  )
}
