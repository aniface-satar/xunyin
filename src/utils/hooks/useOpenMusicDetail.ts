import { useCallback } from 'react'

import { usePlayerOverlay } from '@/components/player/PlayerOverlay'
import { pop } from '@/navigation'
import commonState from '@/store/common/state'
import homeDetailActions from '@/store/homeDetail/action'
import type { HomeDetailPushRoute } from '@/store/homeDetail/state'

// 播控页（Home 内的全屏卡片或原生 PlayDetail）里跳专辑/歌手：先收起播放页，再压当前 tab 的详情栈
export const useOpenMusicDetail = () => {
  const overlay = usePlayerOverlay()

  return useCallback((route: HomeDetailPushRoute) => {
    if (overlay) {
      overlay.close()
    } else {
      const { componentIds } = commonState
      const playDetailId = componentIds.playDetail
      if (playDetailId && playDetailId != componentIds.home) void pop(playDetailId)
    }
    homeDetailActions.push(route)
  }, [overlay])
}
