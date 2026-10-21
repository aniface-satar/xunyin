import { forwardRef, useImperativeHandle, useRef } from 'react'
import { View } from 'react-native'
import { createStyle } from '@/utils/tools'
import List, { type ListType } from './List'
import { type BoardItem } from '@/store/leaderboard/state'


export interface BoardsListProps {
  onBoundChange?: (listId: string) => void
  matrix?: boolean
  onBoardChange?: (item: BoardItem) => void
}
export interface BoardsListType {
  setList: (list: BoardItem[], activeId: string) => void
}

export default forwardRef<BoardsListType, BoardsListProps>(({ matrix = false, onBoundChange, onBoardChange }, ref) => {
  const listRef = useRef<ListType>(null)

  useImperativeHandle(ref, () => ({
    setList(list, listId) {
      listRef.current?.setList(list, listId)
    },
  }), [])

  return (
    <View style={styles.container}>
      <List
        ref={listRef}
        matrix={matrix}
        onBoundChange={onBoundChange}
        onBoardChange={onBoardChange} />
    </View>
  )
})


const styles = createStyle({
  container: {
    flexGrow: 1,
    flexShrink: 1,
  },
})
