import { forwardRef, useImperativeHandle, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import List, { type ListType, type ListProps } from './List'
import ListMenu, { type ListMenuType, type Position } from './ListMenu'
import { type BoardItem } from '@/store/leaderboard/state'


export interface BoardsListProps {
  onBoundChange?: (listId: string) => void
  matrix?: boolean
  onBoardChange?: (item: BoardItem) => void
  onPlay: (listId: string) => void
  onCollect: (listId: string, name: string) => void
}
export interface BoardsListType {
  setList: (list: BoardItem[], activeId: string) => void
}

export default forwardRef<BoardsListType, BoardsListProps>(({ matrix = false, onBoundChange, onBoardChange, onPlay, onCollect }, ref) => {
  const listRef = useRef<ListType>(null)
  const listMenuRef = useRef<ListMenuType>(null)

  useImperativeHandle(ref, () => ({
    setList(list, listId) {
      listRef.current?.setList(list, listId)
    },
  }), [])

  const handleShowMenu: ListProps['onShowMenu'] = ({ listId, name, index }, position: Position) => {
    listMenuRef.current?.show({
      listId,
      index,
      name,
    }, position)
  }

  return (
    <View style={styles.container}>
      <List
        ref={listRef}
        matrix={matrix}
        onBoundChange={onBoundChange}
        onBoardChange={onBoardChange}
        onShowMenu={handleShowMenu} />
      <ListMenu
        ref={listMenuRef}
        onHideMenu={() => listRef.current?.hideMenu()}
        onPlay={({ listId }) => { onPlay(listId) }}
        onCollect={({ listId, name }) => { onCollect(listId, name) }}
      />
    </View>
  )
})


const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    flexShrink: 1,
  },
})
