import { forwardRef, useImperativeHandle, useState } from 'react'
import { FlatList } from 'react-native'

import { createStyle } from '@/utils/tools'
import { type Position } from './ListMenu'
import ListItem, { type ListItemProps } from './ListItem'
import { type BoardItem } from '@/store/leaderboard/state'

export interface ListProps {
  matrix?: boolean
  onBoundChange?: (listId: string) => void
  onBoardChange?: (item: BoardItem) => void
  onShowMenu: (info: { listId: string, name: string, index: number }, position: Position) => void
}
export interface ListType {
  setList: (list: BoardItem[], activeId: string) => void
  hideMenu: () => void
}

export default forwardRef<ListType, ListProps>(({ matrix = false, onBoundChange, onBoardChange, onShowMenu }, ref) => {
  const [activeId, setActiveId] = useState('')
  const [longPressIndex, setLongPressIndex] = useState(-1)
  const [list, setList] = useState<BoardItem[]>([])

  useImperativeHandle(ref, () => ({
    setList(list, activeId) {
      setList(list)
      setActiveId(matrix ? '' : activeId)
    },
    hideMenu() {
      setLongPressIndex(-1)
    },
  }), [matrix])

  const handleBoundChange = (item: BoardItem) => {
    if (!matrix) setActiveId(item.id)
    if (onBoardChange) {
      onBoardChange(item)
      return
    }
    onBoundChange?.(item.id)
  }

  const handleShowMenu: ListItemProps['onShowMenu'] = (listId, name, index, position: Position) => {
    setLongPressIndex(index)
    onShowMenu({ listId, name, index }, position)
  }

  return (
    <FlatList
      key={matrix ? 'matrix' : 'list'}
      data={list}
      numColumns={matrix ? 2 : 1}
      columnWrapperStyle={matrix ? styles.matrixRow : undefined}
      contentContainerStyle={matrix ? styles.matrixContent : styles.listContent}
      style={styles.scrollView}
      keyboardShouldPersistTaps={'always'}
      keyExtractor={item => item.id}
      renderItem={({ item, index }) => (
        <ListItem
          item={item}
          index={index}
          longPressIndex={longPressIndex}
          activeId={activeId}
          matrix={matrix}
          onShowMenu={handleShowMenu}
          onBoundChange={handleBoundChange}
        />
      )}
    />
  )
})


const styles = createStyle({
  scrollView: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 10,
  },
  matrixContent: {
    paddingLeft: 8,
    paddingRight: 8,
    paddingTop: 10,
    paddingBottom: 10,
  },
  matrixRow: {
    justifyContent: 'space-between',
  },
})
