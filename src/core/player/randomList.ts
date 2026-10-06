import playerState from '@/store/player/state'
import playerActions from '@/store/player/action'
import settingState from '@/store/setting/state'
import { state as dislikeState } from '@/store/dislikeList'
import { SPLIT_CHAR } from '@/config/constant'
import { getRandom } from '@/utils/common'
import { getList } from './playInfo'

type MusicItem = LX.Music.MusicInfo | LX.Download.ListItem

const shuffle = <T>(arr: T[]): T[] => {
  const result = [...arr]
  for (let i = result.length - 1; i > 0; i--) {
    const j = getRandom(0, i + 1)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

const isDislike = (musicInfo: LX.Music.MusicInfo): boolean => {
  const name = musicInfo.name?.replaceAll(SPLIT_CHAR.DISLIKE_NAME, SPLIT_CHAR.DISLIKE_NAME_ALIAS).toLocaleLowerCase().trim() ?? ''
  const singer = musicInfo.singer?.replaceAll(SPLIT_CHAR.DISLIKE_NAME, SPLIT_CHAR.DISLIKE_NAME_ALIAS).toLocaleLowerCase().trim() ?? ''
  const { names, musicNames, singerNames } = dislikeState.dislikeInfo

  return musicNames.has(name) || singerNames.has(singer) ||
    names.has(`${name}${SPLIT_CHAR.DISLIKE_NAME}${singer}`)
}

const findPlayableMusic = (list: MusicItem[], id: string): MusicItem | null => {
  const musicInfo = list.find(m => m.id == id)
  if (!musicInfo) return null
  if (!('progress' in musicInfo) && isDislike(musicInfo)) return null
  return musicInfo
}

/**
 * 当前在播放列表内生效的歌曲 id（播放“稍后播放”歌曲时取 playerPlayIndex 指向的歌曲）
 */
const getCurrentListMusicId = (): string | null => {
  const { playMusicInfo, playInfo } = playerState
  if (!playInfo.playerListId) return null
  if (playMusicInfo.isTempPlay) {
    return getList(playInfo.playerListId)[playInfo.playerPlayIndex]?.id ?? null
  }
  return playMusicInfo.musicInfo?.id ?? null
}

/**
 * 以 currentId 为首重新生成随机队列
 * @returns 是否生成成功（下载列表等场景失败，调用方回退旧随机逻辑）
 */
const generateRandomList = (currentId: string | null): boolean => {
  const listId = playerState.playInfo.playerListId
  if (!listId) {
    playerActions.setRandomList(null)
    return false
  }
  const list = getList(listId)
  if (!list.length) {
    playerActions.setRandomList(null)
    return false
  }
  const musicIds = shuffle(list.filter(m => !isDislike(m as LX.Music.MusicInfo)).map(m => m.id).filter(id => id != currentId))
  if (currentId) musicIds.unshift(currentId)
  playerActions.setRandomList({ listId, musicIds })
  return true
}

/**
 * 同步随机队列：切到随机模式、切歌单、当前歌曲不在队列内时重建；非随机模式或列表不可用时清空
 */
export const syncRandomList = () => {
  if (settingState.setting['player.togglePlayMethod'] != 'random') {
    if (playerState.randomList) playerActions.setRandomList(null)
    return
  }
  const listId = playerState.playInfo.playerListId
  const list = listId ? getList(listId) : []
  if (!listId || !list.length) {
    if (playerState.randomList) playerActions.setRandomList(null)
    return
  }
  const currentId = getCurrentListMusicId()
  const randomList = playerState.randomList
  if (randomList?.listId == listId && currentId != null && randomList.musicIds.includes(currentId)) return
  generateRandomList(currentId)
}

export const clearRandomList = () => {
  if (playerState.randomList) playerActions.setRandomList(null)
}

/**
 * 列表内歌曲增删后同步队列：移除已删除歌曲，新增歌曲插入当前歌曲之后的随机位置
 */
export const handleListMusicsUpdated = (listIds: string[]) => {
  const randomList = playerState.randomList
  if (!randomList || !listIds.includes(randomList.listId)) return
  const list = getList(randomList.listId)
  const idSet = new Set(list.map(m => m.id))
  const musicIds = randomList.musicIds.filter(id => idSet.has(id))
  const existIds = new Set(musicIds)
  const newIds = shuffle(list.filter(m => !existIds.has(m.id) && !isDislike(m as LX.Music.MusicInfo)).map(m => m.id))
  if (!newIds.length && musicIds.length == randomList.musicIds.length) return
  const currentId = getCurrentListMusicId()
  const currentIndex = currentId ? musicIds.indexOf(currentId) : -1
  for (const id of newIds) {
    musicIds.splice(getRandom(currentIndex + 1, musicIds.length + 1), 0, id)
  }
  playerActions.setRandomList({ listId: randomList.listId, musicIds })
}

/**
 * 按随机队列取下一曲，整轮放完后自动重新洗牌开启新一轮
 * @returns 返回 null 表示随机队列不可用或无可播歌曲，调用方回退旧随机逻辑
 */
export const getRandomQueueNext = (): LX.Player.PlayMusicInfo | null => {
  const randomList = playerState.randomList
  const listId = playerState.playInfo.playerListId
  if (!randomList || !listId || randomList.listId != listId) return null
  const list = getList(listId)
  if (!list.length) return null

  const currentId = getCurrentListMusicId()
  let musicIds = randomList.musicIds
  let currentIndex = currentId ? musicIds.indexOf(currentId) : -1
  if (currentIndex == -1 || currentIndex >= musicIds.length - 1) {
    // 当前歌曲不在队列内，或整轮已放完：以当前歌曲为首重新洗牌
    if (!generateRandomList(currentId)) return null
    musicIds = playerState.randomList!.musicIds
    currentIndex = 0
  }
  for (let i = currentIndex + 1; i < musicIds.length; i++) {
    const musicInfo = findPlayableMusic(list, musicIds[i])
    if (musicInfo) return { musicInfo, listId, isTempPlay: false }
  }
  return null
}

/**
 * 按随机队列取上一曲，队首时回绕到队尾
 * @returns 返回 null 表示随机队列不可用或无可播歌曲，调用方回退旧随机逻辑
 */
export const getRandomQueuePrev = (): LX.Player.PlayMusicInfo | null => {
  const randomList = playerState.randomList
  const listId = playerState.playInfo.playerListId
  if (!randomList || !listId || randomList.listId != listId) return null
  const list = getList(listId)
  if (!list.length) return null

  const currentId = getCurrentListMusicId()
  const musicIds = randomList.musicIds
  const currentIndex = currentId ? musicIds.indexOf(currentId) : -1
  if (currentIndex == -1) return null
  for (let i = currentIndex - 1; i >= 0; i--) {
    const musicInfo = findPlayableMusic(list, musicIds[i])
    if (musicInfo) return { musicInfo, listId, isTempPlay: false }
  }
  for (let i = musicIds.length - 1; i > currentIndex; i--) {
    const musicInfo = findPlayableMusic(list, musicIds[i])
    if (musicInfo) return { musicInfo, listId, isTempPlay: false }
  }
  return null
}
