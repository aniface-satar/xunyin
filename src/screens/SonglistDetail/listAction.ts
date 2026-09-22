import { createList, removeUserList, setTempList, updateUserList } from '@/core/list'
import { playList } from '@/core/player/player'
import { getListDetail, getListDetailAll } from '@/core/songlist'
import { LIST_IDS } from '@/config/constant'
import listState from '@/store/list/state'
import songlistState from '@/store/songlist/state'
import { toMD5, toast } from '@/utils/tools'
import { type ListInfoItem, type Source } from '@/store/songlist/state'

const getListId = (id: string, source: LX.OnlineSource) => `${source}__${id}`

export const isSameSourceList = (list: LX.List.UserListInfo, source: LX.OnlineSource, id: string) => {
  return list.source == source && (list.sourceListId == id || list.sourceListId == getListId(id, source))
}

export const handlePlay = async(id: string, source: Source, list?: LX.Music.MusicInfoOnline[], index = 0, listInfo?: Pick<ListInfoItem, 'name' | 'author' | 'img'>) => {
  const listId = getListId(id, source)
  const detailInfo = songlistState.listDetailInfo.info
  const playlistMeta = {
    source,
    sourceListId: id,
    name: listInfo?.name ?? detailInfo.name ?? '',
    author: listInfo?.author ?? detailInfo.author,
    img: listInfo?.img ?? detailInfo.img,
  }
  let isPlayingList = false
  // console.log(list)
  if (!list?.length) list = (await getListDetail(id, source, 1)).list
  if (list?.length) {
    await setTempList(listId, [...list], playlistMeta)
    void playList(LIST_IDS.TEMP, index)
    isPlayingList = true
  }
  const fullList = await getListDetailAll(source, id)
  if (!fullList.length) return
  if (isPlayingList) {
    if (listState.tempListMeta.id == listId) {
      await setTempList(listId, [...fullList])
    }
  } else {
    await setTempList(listId, [...fullList], playlistMeta)
    void playList(LIST_IDS.TEMP, index)
  }
}

export const handleCollect = async(id: string, source: Source, name: string) => {
  const listId = getListId(id, source)

  const likedList = listState.userList.find(l => isSameSourceList(l, source, id) && l.isLove)
  if (likedList) {
    await removeUserList([likedList.id])
    toast(global.i18n.t('love_playlist_removed'))
    return
  }

  const targetList = listState.userList.find(l => isSameSourceList(l, source, id))
  if (targetList) {
    await updateUserList([{ ...targetList, isLove: true }])
    toast(global.i18n.t('collect_success'))
    return
  }

  const list = await getListDetailAll(source, id)
  await createList({
    name,
    id: `${source}_${toMD5(listId)}`,
    list,
    source,
    sourceListId: id,
    isLove: true,
  })
  toast(global.i18n.t('collect_success'))
}
