import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

import { search } from '@/core/search/artist'
import ArtistGrid, { type ArtistGridProps, type ArtistGridType } from './ArtistGrid'
import searchArtistState, { type ArtistSearchItem, type Source } from '@/store/search/artist/state'
import homeDetailActions from '@/store/homeDetail/action'

export interface ArtistListType {
  loadList: (text: string, source: Source) => void
}

export default forwardRef<ArtistListType, {}>((props, ref) => {
  const listRef = useRef<ArtistGridType>(null)
  const searchInfoRef = useRef<{ text: string, source: Source }>({ text: '', source: 'kg' })
  const isUnmountedRef = useRef(false)
  useImperativeHandle(ref, () => ({
    async loadList(text, source) {
      listRef.current?.setList([], source == 'all')
      if (searchArtistState.searchText == text && searchArtistState.source == source && searchArtistState.listInfos[searchArtistState.source]!.list.length) {
        requestAnimationFrame(() => {
          listRef.current?.setList(searchArtistState.listInfos[searchArtistState.source]!.list, source == 'all')
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
            listRef.current?.setStatus(searchArtistState.maxPages[searchArtistState.source] == page ? 'end' : 'idle')
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

  const handleRefresh: ArtistGridProps['onRefresh'] = () => {
    const page = 1
    listRef.current?.setStatus('refreshing')
    search(searchInfoRef.current.text, page, searchInfoRef.current.source).then((list) => {
      if (isUnmountedRef.current) return
      listRef.current?.setList(list, searchInfoRef.current.source == 'all')
      listRef.current?.setStatus(searchArtistState.maxPages[searchArtistState.source] == page ? 'end' : 'idle')
    }).catch(() => {
      listRef.current?.setStatus('error')
    })
  }
  const handleLoadMore: ArtistGridProps['onLoadMore'] = () => {
    listRef.current?.setStatus('loading')
    const info = searchArtistState.listInfos[searchInfoRef.current.source]!
    const page = info.list.length ? info.page + 1 : 1
    search(searchInfoRef.current.text, page, searchInfoRef.current.source).then((list) => {
      if (isUnmountedRef.current) return
      listRef.current?.setList(list, searchInfoRef.current.source == 'all')
      listRef.current?.setStatus(searchArtistState.maxPages[searchArtistState.source] == page ? 'end' : 'idle')
    }).catch(() => {
      listRef.current?.setStatus('error')
    })
  }

  const handlePressItem = (item: ArtistSearchItem) => {
    homeDetailActions.push({ type: 'artist', info: item })
  }

  return <ArtistGrid
    ref={listRef}
    onRefresh={handleRefresh}
    onLoadMore={handleLoadMore}
    onPressItem={handlePressItem}
  />
})
