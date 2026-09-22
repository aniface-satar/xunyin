import { getSongListSetting, saveSongListSetting } from '@/utils/data'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { StyleSheet, View } from 'react-native'

// import List from './List/List'
import HeaderBar, { type HeaderBarProps, type HeaderBarType } from './HeaderBar'
import songlistState, { type Source, type InitState, type SortInfo } from '@/store/songlist/state'
import List, { type ListType } from './List'


interface SonglistInfo {
  source: InitState['sources'][number]
  sortId: SortInfo['id']
  tagId: string
}

export interface SongListProps {
  initialSource: Source
}

export interface SongListType {
  setSource: (source: Source) => void
}

export default forwardRef<SongListType, SongListProps>(({ initialSource }, ref) => {
  const headerBarRef = useRef<HeaderBarType>(null)
  const listRef = useRef<ListType>(null)
  const songlistInfo = useRef<SonglistInfo>({ source: initialSource, sortId: '5', tagId: '' })

  useEffect(() => {
    void getSongListSetting().then(info => {
      if (info.source == initialSource) {
        songlistInfo.current.source = info.source
        songlistInfo.current.sortId = info.sortId
        songlistInfo.current.tagId = info.tagId
      } else {
        const sortId = songlistState.sortList[initialSource]![0].id
        songlistInfo.current.source = initialSource
        songlistInfo.current.sortId = sortId
        songlistInfo.current.tagId = ''
        void saveSongListSetting({ source: initialSource, sortId, tagId: '', tagName: '' })
      }
      headerBarRef.current?.setSource(
        songlistInfo.current.source,
        songlistInfo.current.sortId,
        info.source == initialSource ? info.tagName : '',
        songlistInfo.current.tagId,
      )
      listRef.current?.loadList(
        songlistInfo.current.source,
        songlistInfo.current.sortId,
        songlistInfo.current.tagId,
      )
    })
  }, [initialSource])

  const handleSortChange: HeaderBarProps['onSortChange'] = (id) => {
    songlistInfo.current.sortId = id
    void saveSongListSetting({ sortId: id })
    listRef.current?.loadList(songlistInfo.current.source, id, songlistInfo.current.tagId)
  }

  const handleTagChange: HeaderBarProps['onTagChange'] = (name, id) => {
    songlistInfo.current.tagId = id
    void saveSongListSetting({ tagName: name, tagId: id })
    listRef.current?.loadList(songlistInfo.current.source, songlistInfo.current.sortId, id)
  }

  const handleSourceChange = useCallback((source: Source) => {
    songlistInfo.current.source = source
    songlistInfo.current.tagId = ''
    songlistInfo.current.sortId = songlistState.sortList[source]![0].id
    void saveSongListSetting({ sortId: songlistInfo.current.sortId, source, tagId: '', tagName: '' })
    headerBarRef.current?.setSource(source, songlistInfo.current.sortId, '', songlistInfo.current.tagId)
    listRef.current?.loadList(source, songlistInfo.current.sortId, songlistInfo.current.tagId)
  }, [])

  useImperativeHandle(ref, () => ({
    setSource: handleSourceChange,
  }), [handleSourceChange])

  return (
    <View style={styles.container}>
      <HeaderBar
        ref={headerBarRef}
        onSortChange={handleSortChange}
        onTagChange={handleTagChange}
      />
      <List ref={listRef} />
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    flex: 1,
  },
})
