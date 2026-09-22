import { forwardRef, useImperativeHandle, useRef } from 'react'
import { View } from 'react-native'

import BoardsList, { type BoardsListType, type BoardsListProps } from '../BoardsList'
import { BorderWidths } from '@/theme'
import { createStyle } from '@/utils/tools'
import { handleCollect, handlePlay } from '../listAction'
import boardState from '@/store/leaderboard/state'
import { useTheme } from '@/store/theme/hook'
import { getBoardsList } from '@/core/leaderboard'

export interface LeftBarProps {
  onChangeList: (source: LX.OnlineSource, id: string) => void
}

export interface LeftBarType {
  setBound: (source: LX.OnlineSource, id: string) => void
  setSource: (source: LX.OnlineSource) => void
}

export default forwardRef<LeftBarType, LeftBarProps>(({ onChangeList }, ref) => {
  const theme = useTheme()
  const boardsListRef = useRef<BoardsListType>(null)
  const boundInfo = useRef<{ source: LX.OnlineSource, id: string | null }>({ source: 'kw', id: null })
  useImperativeHandle(ref, () => ({
    setBound(source, listId) {
      boundInfo.current = { source, id: listId }
      void getBoardsList(source).then(list => {
        boardsListRef.current?.setList(list, listId)
      })
    },
    setSource(source) {
      boundInfo.current.source = source
      void getBoardsList(source).then(list => {
        const board = list[0]
        if (!board) return
        boundInfo.current.id = board.id
        boardsListRef.current?.setList(list, board.id)
        onChangeList(source, board.id)
      })
    },
  }), [onChangeList])


  const onBoundChange: BoardsListProps['onBoundChange'] = (id) => {
    boundInfo.current.id = id
    onChangeList(boundInfo.current.source, id)
  }
  const onPlay: BoardsListProps['onPlay'] = (id) => {
    boundInfo.current.id = id
    void handlePlay(id, boardState.listDetailInfo.list)
  }
  const onCollect: BoardsListProps['onCollect'] = (id, name) => {
    boundInfo.current.id = id
    void handleCollect(id, name, boundInfo.current.source)
  }

  return (
    <View style={{ ...styles.container, borderRightColor: theme['c-list-header-border-bottom'] }}>
      <BoardsList
        ref={boardsListRef}
        onBoundChange={onBoundChange}
        onPlay={onPlay}
        onCollect={onCollect}
      />
    </View>
  )
})

const styles = createStyle({
  container: {
    flexDirection: 'column',
    width: '26%',
    maxWidth: 180,
    minWidth: 110,
    flexGrow: 0,
    flexShrink: 0,
    borderRightWidth: BorderWidths.normal,
  },
})
