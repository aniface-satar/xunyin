import { useHorizontalMode } from '@/utils/hooks'
import Vertical from './Vertical'
import Horizontal from './Horizontal'
import { useBackHandler } from '@/utils/hooks/useBackHandler'
import { useCallback } from 'react'
// import { AppColors } from '@/theme'
import commonState from '@/store/common/state'
import { setNavActiveId } from '@/core/common'
import { setSettingDetailId, useSettingDetailId } from './detailId'

export type { SettingScreenIds } from './Main'

export default () => {
  const isHorizontalMode = useHorizontalMode()
  const detailId = useSettingDetailId()
  useBackHandler(useCallback(() => {
    if (commonState.navActiveId != 'nav_setting') return false
    // 设置内的子页面优先返回设置主页，与界面内 < 返回按钮的行为完全一致（该按钮不看浮层）。
    // 必须在下面的浮层判断之前处理：否则从设置里打开过播放详情页后 componentIds 仍带着
    // playDetail，会让返回键误判为"交给浮层处理"而 return false，最终 RNN 结束 Activity 退回桌面。
    if (detailId != null) {
      setSettingDetailId(null)
      return true
    }
    // 已在设置主页：评论页、歌单/榜单/我的列表详情页以原生方式推入并盖在设置之上时，
    // 返回键交给它们自己处理（overlay 形态的播放页有后注册的监听，会先于这里执行）
    const { home, playDetail, comment, leaderboardDetail, mylistDetail, songlistDetail } = commonState.componentIds
    if (comment != null) return false
    if (leaderboardDetail != null || mylistDetail != null || songlistDetail != null) return false
    if (playDetail != null && playDetail != home) return false
    // 回到进入设置前所在的导航页
    setNavActiveId(commonState.lastNavActiveId)
    return true
  }, [detailId]))

  return isHorizontalMode
    ? <Horizontal />
    : <Vertical />
}
