import { createList, removeUserList, setTempList, updateUserList } from '@/core/list'
import { playList } from '@/core/player/player'
import { getListDetail, getListDetailAll } from '@/core/songlist'
import { LIST_IDS } from '@/config/constant'
import listState from '@/store/list/state'
import songlistState from '@/store/songlist/state'
import { toMD5, toast } from '@/utils/tools'
import { type ListDetailInfo, type ListInfoItem, type Source } from '@/store/songlist/state'

const getListId = (id: string, source: LX.OnlineSource) => `${source}__${id}`

// 入口信息（如“打开歌单”）可能只有 id，名称等需从已加载的歌单详情兜底，否则歌单播放历史会因名称为空被丢弃
const pickInfo = (...values: Array<string | undefined>): string | undefined => values.find(value => value)

export const isSameSourceList = (list: LX.List.UserListInfo, source: LX.OnlineSource, id: string) => {
  return list.source == source && (list.sourceListId == id || list.sourceListId == getListId(id, source))
}

export const handlePlay = async(id: string, source: Source, list?: LX.Music.MusicInfoOnline[], index = 0, listInfo?: Pick<ListInfoItem, 'name' | 'author' | 'img'>) => {
  const listId = getListId(id, source)
  const detailInfo = songlistState.listDetailInfo.info
  let isPlayingList = false
  let fetchedInfo: ListDetailInfo['info'] | undefined
  // console.log(list)
  if (!list?.length) {
    const detail = await getListDetail(id, source, 1)
    list = detail.list
    fetchedInfo = detail.info
  }
  const playlistMeta = {
    source,
    sourceListId: id,
    name: pickInfo(listInfo?.name, detailInfo.name, fetchedInfo?.name) ?? '',
    author: pickInfo(listInfo?.author, detailInfo.author, fetchedInfo?.author),
    img: pickInfo(listInfo?.img, detailInfo.img, fetchedInfo?.img),
  }
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

// 整张外部歌单当做一个新歌单存进自建列表；带 source/sourceListId，「更新歌单」同步（core/syncSourceList）才认它
export const handleImportAsList = async(source: Source, id: string, name: string) => {
  if (listState.userList.some(l => isSameSourceList(l, source, id))) {
    toast(global.i18n.t('songlist_add_to_mylist_exists'))
    return
  }
  const list = await getListDetailAll(source, id)
  if (!list.length) {
    toast(global.i18n.t('songlist_add_to_mylist_failed'))
    return
  }
  await createList({
    name,
    id: `userlist_${Date.now()}`,
    list,
    source,
    sourceListId: id,
  })
  toast(global.i18n.t('songlist_add_to_mylist_done'))
}
