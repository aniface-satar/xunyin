import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { View } from 'react-native'

import { getLeaderboardSetting, saveLeaderboardSetting } from '@/utils/data'
import BoardsList, { type BoardsListType, type BoardsListProps } from '../BoardsList'
import { createStyle } from '@/utils/tools'
import { getBoardsList } from '@/core/leaderboard'
import { handleCollect, handlePlay } from '../listAction'
import boardState from '@/store/leaderboard/state'
import homeDetailActions from '@/store/homeDetail/action'

export interface VerticalType {
  setSource: (source: LX.OnlineSource) => void
}

export default forwardRef<VerticalType, {}>((props, ref) => {
  const isUnmountedRef = useRef(false)
  const boardsListRef = useRef<BoardsListType>(null)
  const boundInfo = useRef<{ source: LX.OnlineSource, id: string | null }>({ source: 'kw', id: null })

  const handleBoundChange = useCallback((source: LX.OnlineSource, id: string) => {
    void saveLeaderboardSetting({
      source,
      boardId: id,
    })
  }, [])

  const onBoardChange: BoardsListProps['onBoardChange'] = (item) => {
    boundInfo.current.id = item.id
    handleBoundChange(boundInfo.current.source, item.id)
    homeDetailActions.push({
      type: 'leaderboard',
      source: boundInfo.current.source,
      board: item,
    })
  }

  const onPlay: BoardsListProps['onPlay'] = (id) => {
    boundInfo.current.id = id
    void handlePlay(id, boardState.listDetailInfo.list)
  }

  const onCollect: BoardsListProps['onCollect'] = (id, name) => {
    boundInfo.current.id = id
    void handleCollect(id, name, boundInfo.current.source)
  }

  const setSource = useCallback((source: LX.OnlineSource) => {
    boundInfo.current.source = source
    void getBoardsList(source).then(list => {
      if (isUnmountedRef.current) return
      const board = list[0]
      if (!board) return
      boundInfo.current.id = board.id
      boardsListRef.current?.setList(list, board.id)
    })
  }, [])

  useImperativeHandle(ref, () => ({
    setSource,
  }), [setSource])

  useEffect(() => {
    isUnmountedRef.current = false
    void getLeaderboardSetting().then(({ source, boardId }) => {
      boundInfo.current.source = source
      boundInfo.current.id = boardId
      void getBoardsList(source).then(list => {
        if (isUnmountedRef.current) return
        const board = list.find(item => item.id == boardId) ?? list[0]
        if (!board) return
        boardsListRef.current?.setList(list, board.id)
      })
    })

    return () => {
      isUnmountedRef.current = true
    }
  }, [])

  return (
    <View style={styles.container}>
      <View style={styles.page}>
        <BoardsList
          ref={boardsListRef}
          matrix
          onBoardChange={onBoardChange}
          onPlay={onPlay}
          onCollect={onCollect}
        />
      </View>
    </View>
  )
})

const styles = createStyle({
  container: {
    width: '100%',
    flex: 1,
  },
  page: {
    flex: 1,
  },
})
