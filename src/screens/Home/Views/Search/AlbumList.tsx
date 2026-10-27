import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

import { search } from '@/core/search/album'
import Songlist, { type SonglistProps, type SonglistType } from '@/screens/Home/Views/SongList/components/Songlist'
import searchAlbumState, { type Source } from '@/store/search/album/state'

export interface AlbumListType {
  loadList: (text: string, source: Source) => void
}

export default forwardRef<AlbumListType, {}>((props, ref) => {
  const listRef = useRef<SonglistType>(null)
  const searchInfoRef = useRef<{ text: string, source: Source }>({ text: '', source: 'kw' })
  const isUnmountedRef = useRef(false)
  useImperativeHandle(ref, () => ({
    async loadList(text, source) {
      listRef.current?.setList([], source == 'all')
      if (searchAlbumState.searchText == text && searchAlbumState.source == source && searchAlbumState.listInfos[searchAlbumState.source]!.list.length) {
        requestAnimationFrame(() => {
          listRef.current?.setList(searchAlbumState.listInfos[searchAlbumState.source]!.list, source == 'all')
        })
      } else {
        listRef.current?.setStatus('loading')
        const page = 1
        searchInfoRef.current.text = text
        searchInfoRef.current.source = source
        return search(text, page, source).then((list) => {
          if (isUnmountedRef.current) return
          requestAnimationFrame(() => {
            listRef.current?.setList(list, source == 'all')
            listRef.current?.setStatus(searchAlbumState.maxPages[searchAlbumState.source] == page ? 'end' : 'idle')
          })
        }).catch(() => {
          listRef.current?.setStatus('error')
        })
      }
    },
  }), [])

  useEffect(() => {
    isUnmountedRef.current = false
    return () => {
      isUnmountedRef.current = true
    }
  }, [])

  const handleRefresh: SonglistProps['onRefresh'] = () => {
    const page = 1
    listRef.current?.setStatus('refreshing')
    search(searchInfoRef.current.text, page, searchInfoRef.current.source).then((list) => {
      if (isUnmountedRef.current) return
      listRef.current?.setList(list, searchInfoRef.current.source == 'all')
      listRef.current?.setStatus(searchAlbumState.maxPages[searchAlbumState.source] == page ? 'end' : 'idle')
    }).catch(() => {
      listRef.current?.setStatus('error')
    })
  }
  const handleLoadMore: SonglistProps['onLoadMore'] = () => {
    listRef.current?.setStatus('loading')
    const info = searchAlbumState.listInfos[searchInfoRef.current.source]!
    const page = info.list.length ? info.page + 1 : 1
    search(searchInfoRef.current.text, page, searchInfoRef.current.source).then((list) => {
      if (isUnmountedRef.current) return
      listRef.current?.setList(list, searchInfoRef.current.source == 'all')
      listRef.current?.setStatus(searchAlbumState.maxPages[searchAlbumState.source] == page ? 'end' : 'idle')
    }).catch(() => {
      listRef.current?.setStatus('error')
    })
  }

  return <Songlist
    ref={listRef}
    onRefresh={handleRefresh}
    onLoadMore={handleLoadMore}
  />
})
