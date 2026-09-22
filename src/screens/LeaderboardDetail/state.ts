import { createContext, useContext } from 'react'
import { type BoardItem } from '@/store/leaderboard/state'

export interface LeaderboardInfo {
  source: LX.OnlineSource
  board: BoardItem
}

export const LeaderboardInfoContext = createContext<LeaderboardInfo>({
  source: 'kw',
  board: { id: '', name: '', bangid: '' },
})

export const useLeaderboardInfo = () => {
  return useContext(LeaderboardInfoContext)
}
