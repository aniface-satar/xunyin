import { LIST_IDS } from '@/config/constant'
import listState from '@/store/list/state'
import { savePlaylistHistory } from '@/utils/data'


const getMusicInfo = (musicInfo: LX.Player.PlayMusicInfo['musicInfo']) => {
  return 'progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo
}

const getCanonicalListId = (source: LX.OnlineSource, sourceListId: string) => {
  return sourceListId.startsWith('board__') ? sourceListId : `${source}__${sourceListId}`
}

const findUserList = (playbackListId: string) => {
  return listState.userList.find(list => {
    if (!list.source || !list.sourceListId) return false
    return getCanonicalListId(list.source, list.sourceListId) === playbackListId
  })
}

/**
 * 根据当前实际播放的列表同步歌单播放记录
 * @param playMusicInfo 当前播放信息
 */
export const addPlaylistHistoryFromPlayback = (playMusicInfo: LX.Player.PlayMusicInfo) => {
  let userList: LX.List.UserListInfo | undefined

  if (playMusicInfo.listId === LIST_IDS.TEMP) {
    const tempListId = listState.tempListMeta.id
    if (tempListId) {
      const tempPlaylist = listState.tempListMeta.playlist
      if (tempPlaylist) {
        void savePlaylistHistory({
          ...tempPlaylist,
          listId: getCanonicalListId(tempPlaylist.source, tempPlaylist.sourceListId),
        })
        return
      }
      userList = findUserList(tempListId)
    }
  } else if (playMusicInfo.listId && playMusicInfo.listId !== LIST_IDS.DEFAULT && playMusicInfo.listId !== LIST_IDS.LOVE) {
    userList = listState.userList.find(list => list.id === playMusicInfo.listId)
  }

  if (!userList?.source || !userList.sourceListId) return

  const musicInfo = getMusicInfo(playMusicInfo.musicInfo)
  void savePlaylistHistory({
    listId: getCanonicalListId(userList.source, userList.sourceListId),
    source: userList.source,
    sourceListId: userList.sourceListId,
    name: userList.name,
    img: musicInfo.meta.picUrl ?? undefined,
  })
}
