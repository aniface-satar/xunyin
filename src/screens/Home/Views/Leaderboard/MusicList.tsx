import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import OnlineList, { type OnlineListType, type OnlineListProps } from '@/components/OnlineList'
import { clearListDetail, getListDetail, setListDetail, setListDetailInfo } from '@/core/leaderboard'
import boardState from '@/store/leaderboard/state'
import { handlePlay } from './listAction'
import { useLeaderboardInfo } from '@/screens/LeaderboardDetail/state'

export interface MusicListType {
  loadList: (source: LX.OnlineSource, listId: string) => void
  showMultiSelect: () => void
  exitMultiSelect: () => void
}

export interface MusicListProps {
  checkHomePagerIdle?: boolean
  multiSelectStyle?: OnlineListProps['multiSelectStyle']
  onMultiSelectModeChange?: OnlineListProps['onMultiSelectModeChange']
}

export default forwardRef<MusicListType, MusicListProps>(({ checkHomePagerIdle: checkHomePager = true, multiSelectStyle, onMultiSelectModeChange }, ref) => {
  const listRef = useRef<OnlineListType>(null)
  const isUnmountedRef = useRef(false)
  const { board } = useLeaderboardInfo()
  useImperativeHandle(ref, () => ({
    async loadList(source, id) {
      const listDetailInfo = boardState.listDetailInfo
      listRef.current?.setList([])
      if (listDetailInfo.id == id && listDetailInfo.source == source && listDetailInfo.list.length) {
        requestAnimationFrame(() => {
          listRef.current?.setList(listDetailInfo.list)
        })
      } else {
        listRef.current?.setStatus('loading')
        const page = 1
        setListDetailInfo(id)
        return getListDetail(id, page).then((listDetail) => {
          const result = setListDetail(listDetail, id, page)
          if (isUnmountedRef.current) return
          requestAnimationFrame(() => {
            listRef.current?.setList(result.list)
            listRef.current?.setStatus(boardState.listDetailInfo.maxPage <= page ? 'end' : 'idle')
          })
        }).catch(() => {
          if (boardState.listDetailInfo.list.length && page == 1) clearListDetail()
          listRef.current?.setStatus('error')
        })
      }
    },
    showMultiSelect() {
      listRef.current?.showMultiSelect()
    },
    exitMultiSelect() {
      listRef.current?.exitMultiSelect()
    },
  }), [])

  useEffect(() => {
    isUnmountedRef.current = false
    return () => {
      isUnmountedRef.current = true
    }
  }, [])


  const handlePlayList: OnlineListProps['onPlayList'] = (index) => {
    const listDetailInfo = boardState.listDetailInfo
    // console.log(boardState.listDetailInfo)
    void handlePlay(listDetailInfo.id, listDetailInfo.list, index, board.name)
  }
  const handleRefresh: OnlineListProps['onRefresh'] = () => {
    const page = 1
    listRef.current?.setStatus('refreshing')
    getListDetail(boardState.listDetailInfo.id, page, true).then((listDetail) => {
      const result = setListDetail(listDetail, boardState.listDetailInfo.id, page)
      if (isUnmountedRef.current) return
      listRef.current?.setList(result.list)
      listRef.current?.setStatus(boardState.listDetailInfo.maxPage <= page ? 'end' : 'idle')
    }).catch(() => {
      if (boardState.listDetailInfo.list.length && page == 1) clearListDetail()
      listRef.current?.setStatus('error')
    })
  }
  const handleLoadMore: OnlineListProps['onLoadMore'] = () => {
    listRef.current?.setStatus('loading')
    const page = boardState.listDetailInfo.list.length ? boardState.listDetailInfo.page + 1 : 1
    getListDetail(boardState.listDetailInfo.id, page).then((listDetail) => {
      const result = setListDetail(listDetail, boardState.listDetailInfo.id, page)
      if (isUnmountedRef.current) return
      listRef.current?.setList(result.list, true)
      listRef.current?.setStatus(boardState.listDetailInfo.maxPage <= page ? 'end' : 'idle')
    }).catch(() => {
      if (boardState.listDetailInfo.list.length && page == 1) clearListDetail()
      listRef.current?.setStatus('error')
    })
  }

  return <OnlineList
    ref={listRef}
    onPlayList={handlePlayList}
    onRefresh={handleRefresh}
    onLoadMore={handleLoadMore}
    checkHomePagerIdle={checkHomePager}
    rowType='medium'
    multiSelectStyle={multiSelectStyle}
    onMultiSelectModeChange={onMultiSelectModeChange}
   />
})
