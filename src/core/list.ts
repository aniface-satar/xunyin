import { LIST_IDS } from '@/config/constant'
import listAction from '@/store/list/action'
import listState from '@/store/list/state'
import settingState from '@/store/setting/state'
import { fixNewMusicInfoQuality } from '@/utils'
import { getTempListMeta, saveListPrevSelectId, savePlaylistHistory, saveTempListMeta, stampMusicAddTimes } from '@/utils/data'
import { getListMusicSync } from '@/utils/listManage'
import { recommendationEngine } from '@/core/recommend'
import { recommendationConfig } from '@/core/recommend/config'

/**
 * 覆盖全部列表数据
 * @param data
 */
export const overwriteListFull = async(data: LX.List.ListActionDataOverwrite) => {
  await global.list_event.list_data_overwrite(data)
}


/**
 * 添加用户列表
 */
export const createUserList = async(position: number, listInfos: LX.List.UserListInfo[]) => {
  await global.list_event.list_create(position, listInfos)
}

/**
 * 移除用户列表及列表内歌曲
 */
export const removeUserList = async(ids: string[]) => {
  await global.list_event.list_remove(ids)
}

/**
 * 更新用户列表
 */
export const updateUserList = async(listInfos: LX.List.UserListInfo[]) => {
  await global.list_event.list_update(listInfos)
}

/**
 * 批量移动用户列表位置
 */
export const updateUserListPosition = async(position: number, ids: string[]) => {
  await global.list_event.list_update_position(position, ids)
}


/**
 * 批量添加歌曲到列表
 */
export const addListMusics = async(id: string, musicInfos: LX.Music.MusicInfo[], addMusicLocationType: LX.AddMusicLocationType) => {
  await global.list_event.list_music_add(id, musicInfos, addMusicLocationType)
  notifyMusicAddedToRecommend(id, musicInfos)
}

/**
 * 收藏/加入歌单都是显式正反馈；批量导入只更新画像，不逐首记反馈。
 * 收藏索引会在列表变化事件后自动重建，所以超限时无需通知引擎。
 */
const notifyMusicAddedToRecommend = (listId: string, musicInfos: LX.Music.MusicInfo[]) => {
  if (!musicInfos.length || musicInfos.length > recommendationConfig.ingest.maxTracksPerExplicitBatch) return
  const isLove = listId == LIST_IDS.LOVE
  if (!isLove && (listId == LIST_IDS.DEFAULT || listId == LIST_IDS.TEMP || listId.startsWith('download'))) return
  for (const musicInfo of musicInfos) {
    if (isLove) void recommendationEngine.onLiked(musicInfo)
    else void recommendationEngine.onAddedToPlaylist(musicInfo, listId)
  }
}

/**
 * 跨列表批量移动歌曲
 */
export const moveListMusics = async(fromId: string, toId: string, musicInfos: LX.Music.MusicInfo[], addMusicLocationType: LX.AddMusicLocationType) => {
  await global.list_event.list_music_move(fromId, toId, musicInfos, addMusicLocationType)
}

/**
 * 批量删除列表内歌曲
 */
export const removeListMusics = async(listId: string, ids: string[]) => {
  // 删除事件会同步改动内存列表，快照必须在之前取
  const snapshot = listId == LIST_IDS.LOVE && ids.length && ids.length <= recommendationConfig.ingest.maxTracksPerExplicitBatch
    ? getListMusicSync(listId)
    : null
  await global.list_event.list_music_remove(listId, ids)
  if (!snapshot) return
  for (const id of ids) {
    const musicInfo = snapshot.find(item => item.id == id)
    if (musicInfo) void recommendationEngine.onUnliked(musicInfo)
  }
}

/**
 * 批量更新列表内歌曲
 */
export const updateListMusics = async(infos: Array<{ id: string, musicInfo: LX.Music.MusicInfo }>) => {
  await global.list_event.list_music_update(infos)
}

/**
 * 批量移动列表内歌曲的位置
 */
export const updateListMusicPosition = async(listId: string, position: number, ids: string[]) => {
  await global.list_event.list_music_update_position(listId, position, ids)
}

/**
 * 覆盖列表内的歌曲
 */
export const overwriteListMusics = async(listId: string, musicInfos: LX.Music.MusicInfo[]) => {
  await global.list_event.list_music_overwrite(listId, musicInfos)
}

/**
 * 覆盖列表内的歌曲
 */
export const clearListMusics = async(ids: string[]) => {
  await global.list_event.list_music_clear(ids)
}

/**
 * 覆盖单个列表
 * @param listInfo
 * @param musics
 */
export const overwriteList = async(listInfoFull: LX.List.MyDefaultListInfoFull | LX.List.MyLoveListInfoFull | LX.List.UserListInfoFull) => {
  let userListInfo
  switch (listInfoFull.id) {
    case LIST_IDS.DEFAULT:
    case LIST_IDS.LOVE:
      break

    default:
      userListInfo = listInfoFull as LX.List.UserListInfo
      await updateUserList([
        {
          name: userListInfo.name,
          id: userListInfo.id,
          source: userListInfo.source,
          sourceListId: userListInfo.sourceListId,
          locationUpdateTime: userListInfo.locationUpdateTime,
        },
      ])
      break
  }
  await overwriteListMusics(listInfoFull.id, listInfoFull.list.map(m => fixNewMusicInfoQuality(m)))
}
/**
 * 覆盖单个列表
 * @param listInfo
 * @param musics
 */
export const createList = async({ name, id = `userlist_${Date.now()}`, list = [], source, sourceListId, isLove, position = -1 }: {
  name?: string
  id?: string
  list?: LX.Music.MusicInfo[]
  source?: LX.OnlineSource
  sourceListId?: string
  isLove?: boolean
  position?: number
}) => {
  await createUserList(position < 0 ? listState.userList.length : position, [
    {
      id,
      name: name ?? 'list',
      source,
      sourceListId,
      isLove,
      locationUpdateTime: position < 0 ? null : Date.now(),
    },
  ])
  if (list) await addListMusics(id, list, settingState.setting['list.addMusicLocationType'])
}

/**
 * 设置当前激活的歌曲列表
 * @param id
 */
export const setActiveList = (id: string) => {
  if (listState.activeListId == id) return
  listAction.setActiveList(id)
  saveListPrevSelectId(id)
}

/**
 * 设置歌曲列表
 */
export const setUserList = (lists: LX.List.UserListInfo[]) => {
  listAction.setUserLists(lists)
}

export const initTempListMeta = async() => {
  const meta = await getTempListMeta()
  if (meta.id) listAction.setTempListMeta(meta)
}

/**
 * 设置临时列表内歌曲
 * @param id
 * @param list
 */
export const setTempList = async(
  id: string,
  list: LX.Music.MusicInfoOnline[],
  playlist?: LX.Player.TempPlaylistMeta,
) => {
  await overwriteListMusics(LIST_IDS.TEMP, list)
  const playlistMeta = playlist ?? (listState.tempListMeta.id == id ? listState.tempListMeta.playlist : undefined)
  listAction.setTempListMeta({ id, playlist: playlistMeta })
  await saveTempListMeta({ id, playlist: playlistMeta })
  if (playlistMeta) {
    void savePlaylistHistory({
      ...playlistMeta,
      listId: playlistMeta.sourceListId.startsWith('board__')
        ? playlistMeta.sourceListId
        : `${playlistMeta.source}__${playlistMeta.sourceListId}`,
    })
  }
}


export const setFetchingListStatus = (id: string, status: boolean) => {
  listAction.setFetchingListStatus(id, status)
}

let musicAddTimeTrackerInited = false
/**
 * 初始化歌曲添加时间记录（用于列表按添加时间排序）
 */
export const initMusicAddTimeTracker = () => {
  if (musicAddTimeTrackerInited) return
  musicAddTimeTrackerInited = true
  global.list_event.on('list_music_add', async(listId, musicInfos) => {
    await stampMusicAddTimes(listId, musicInfos.map(m => m.id))
  })
  // 移动歌曲时按目标列表记录添加时间
  global.list_event.on('list_music_move', async(_fromId, toId, musicInfos) => {
    await stampMusicAddTimes(toId, musicInfos.map(m => m.id))
  })
}


export { getUserLists, getListMusics } from '@/utils/listManage'
