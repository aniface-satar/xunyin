import { createList, setTempList } from '@/core/list'
import { playList } from '@/core/player/player'
import { getBoardsList, getListDetail, getListDetailAll } from '@/core/leaderboard'
import { LIST_IDS } from '@/config/constant'
import listState from '@/store/list/state'
import syncSourceList from '@/core/syncSourceList'
import { confirmDialog, toMD5, toast } from '@/utils/tools'


const getListId = (id: string) => `board__${id}`

export const handlePlay = async(id: string, list?: LX.Music.MusicInfoOnline[], index = 0, boardName?: string) => {
  let isPlayingList = false
  // console.log(list)
  const listId = getListId(id)
  const [source] = id.split('__') as [LX.OnlineSource]
  let boardTitle = boardName
  if (!boardTitle) {
    const board = await getBoardsList(source)
      .then(list => list.find(item => item.id == id))
      .catch(() => null)
    boardTitle = board?.name
  }
  const playlistMeta = {
    source,
    sourceListId: listId,
    name: boardTitle ?? '',
  }
  if (!list?.length) list = (await getListDetail(id, 1)).list
  if (list?.length) {
    await setTempList(listId, [...list], playlistMeta)
    void playList(LIST_IDS.TEMP, index)
    isPlayingList = true
  }
  const fullList = await getListDetailAll(id)
  if (!fullList.length) return
  if (isPlayingList) {
    if (listState.tempListMeta.id == listId) {
      await setTempList(listId, [...fullList], playlistMeta)
    }
  } else {
    await setTempList(listId, [...fullList], playlistMeta)
    void playList(LIST_IDS.TEMP, index)
  }
}

export const handleCollect = async(id: string, name: string, source: LX.OnlineSource) => {
  const listId = getListId(id)
  const targetList = listState.userList.find(l => l.sourceListId == listId)
  if (targetList) {
    const confirm = await confirmDialog({
      message: global.i18n.t('duplicate_list_tip', { name: targetList.name }),
      cancelButtonText: global.i18n.t('list_import_part_button_cancel'),
      confirmButtonText: global.i18n.t('confirm_button_text'),
    })
    if (!confirm) return
    void syncSourceList(targetList)
    return
  }

  const list = await getListDetailAll(id)
  await createList({
    name,
    id: `${source}_${toMD5(listId)}`,
    list,
    source,
    sourceListId: listId,
  })
  toast(global.i18n.t('collect_success'))
}
