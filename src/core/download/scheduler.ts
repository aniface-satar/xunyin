import { toByteArray } from 'react-native-quick-base64'
import RNFS from 'react-native-fs'
import BackgroundTimer from 'react-native-background-timer'
import { AppState } from 'react-native'

import { getMusicUrl } from '@/core/music'
import { sizeFormate } from '@/utils/common'
import { log } from '@/utils/log'
import { downloadFile, moveFile, temporaryDirectoryPath, unlink } from '@/utils/fs'
import { isActive, toast } from '@/utils/tools'
import homeDetailState, { getHomeDetailTabId } from '@/store/homeDetail/state'
import commonState from '@/store/common/state'
import settingState from '@/store/setting/state'
import { addItem, load, updateItem } from '@/store/download/action'
import { state } from '@/store/download/state'
import { buildDownloadBaseName } from './name'
import { transferErrorKey, type DownloadErrorKey } from './errorKey'
import { MIN_HEAD_BYTES, sniffAudioFormat } from './format'
import { canPause, canResume, ownsTask, pausePatch, restartPatch } from './pausePlan'
import { inFlightProgress, transferDone } from './progress'
import { assignQualities, type QualityChoice } from './quality'
import { childWritePath } from './safPath'
import { withStageTimeout, type GuardStage, type TimerDriver } from './stageGuard'
import { withTransferWatchdog, type TransferWatchdog } from './transferGuard'
import { publishFile, resolveSaveDir, scanPublishedFile } from './target'
import { applyFileTags } from './tags'

const PROGRESS_INTERVAL = 500

interface ProgressEvent {
  contentLength: number
  bytesWritten: number
}

const isDownloadTask = (item: unknown): item is LX.Download.ListItem => {
  return !!item && typeof item === 'object' && 'id' in item && 'metadata' in item
}

const formatSpeed = (bytesPerSecond: number) => `${sizeFormate(bytesPerSecond)}/s`

const buildFileName = (musicInfo: LX.Music.MusicInfoOnline) => {
  return buildDownloadBaseName(settingState.setting['download.fileName'], musicInfo)
}

const createItem = (
  musicInfo: LX.Music.MusicInfoOnline,
  quality: LX.Quality,
): LX.Download.ListItem => ({
  id: musicInfo.id,
  isComplate: false,
  status: 'waiting',
  statusText: '',
  downloaded: 0,
  total: 0,
  progress: 0,
  speed: '',
  metadata: {
    musicInfo,
    url: null,
    quality,
    ext: 'mp3',
    fileName: buildFileName(musicInfo),
    filePath: '',
  },
})

const readHead = async(path: string) => {
  const head = await RNFS.read(path, MIN_HEAD_BYTES, 0, 'base64')
  return toByteArray(head)
}

// 下载页本身就在显示进度和错误，再弹一层提示只是吵
const notifyTask = (text: string) => {
  const stack = homeDetailState.stacks[getHomeDetailTabId(commonState.navActiveId, commonState.lastNavActiveId)]
  if (commonState.navActiveId != 'nav_setting' && stack.length && stack[stack.length - 1].type == 'download') return
  toast(text, 'long')
}

/** 在跑的任务对应的 RNFS jobId，暂停和看门狗都拿它去停请求 */
const runningJobs = new Map<string, number>()

/** 息屏之后普通计时器会被冻住，看门狗必须用后台计时器 */
const stageTimer: TimerDriver = {
  set: (callback, ms) => BackgroundTimer.setTimeout(callback, ms),
  clear: handle => { BackgroundTimer.clearTimeout(handle as number) },
}

const guardStage = async<T>(stage: GuardStage, run: Promise<T>) => withStageTimeout(run, stage, stageTimer)

const removeTempFile = async(path: string) => {
  await guardStage('cleanup', unlink(path).catch(() => {})).catch(() => {})
}

/**
 * 停掉一首歌正在跑的那条原生请求。
 * jobId 由看门狗传入：一轮下载被暂停、继续顶替之后，同一首歌名下会有新的 jobId，
 * 旧那一轮的看门狗晚一步醒来时只许停自己那条，不能把用户刚点的继续又掐掉。
 */
const stopJob = (id: string, jobId?: number) => {
  const currentJobId = runningJobs.get(id)
  if (currentJobId == null) return
  if (jobId != null && currentJobId !== jobId) return
  runningJobs.delete(id)
  RNFS.stopDownload(currentJobId)
}

/**
 * 每一轮下载的令牌：任务被认领时记下是谁领的。
 * 只认状态不行——被暂停或被顶替的那一轮在旧 await 里醒来时，状态可能已经被新一轮改回「下载中」，
 * 于是旧的一轮会以为自己还拥有这首歌，把新任务的进度、结果整个盖掉（甚至多发一个文件）。
 */
const taskRounds = new Map<string, number>()
let roundSeq = 0

const runTask = async(item: LX.Download.ListItem, round: number) => {
  const { id, metadata } = item
  const { musicInfo, quality } = metadata
  const isCurrentRun = () => ownsTask(state.list.find(listItem => listItem.id === id)?.status) && taskRounds.get(id) === round
  const update = (data: Partial<LX.Download.ListItem>) => {
    if (!isCurrentRun()) return false
    updateItem(id, data)
    return true
  }
  const errorUpdate = (i18nKey: DownloadErrorKey) => {
    const message = global.i18n.t(i18nKey)
    if (!update({
      status: 'error',
      statusText: message,
      speed: '',
    })) return
    notifyTask(global.i18n.t('download_task_failed', { name: musicInfo.name, msg: message }))
  }

  let url: string
  try {
    // 取链本身也可能不返回（脚本多源接力没有统一上限），整个队列只有这一个槽位，
    // 所以这一步也必须带看门狗，不能让它把后面所有歌都钉在「排队中」
    url = await guardStage('url', getMusicUrl({
      musicInfo,
      quality,
      isRefresh: true,
    }))
  } catch {
    errorUpdate('download_url_failed')
    return
  }

  if (!url) {
    errorUpdate('download_url_failed')
    return
  }

  // 排队中被按了暂停就不该再起请求；按了"继续"或换了音质重来也一样，这一轮已经不算数了
  if (!isCurrentRun()) return

  const tempPath = `${temporaryDirectoryPath}/download_${id}_${Date.now()}.tmp`
  let downloaded = 0
  let total = 0
  let lastUpdatedAt = Date.now()
  let sample = { time: Date.now(), downloaded: 0 }
  // 传输看门狗在 downloadFile 返回后才能建起来（要拿 jobId 停任务），进度事件不会比它早
  let transfer: TransferWatchdog<{ statusCode: number, bytesWritten: number }> | null = null

  const handleProgress = ({ contentLength, bytesWritten }: ProgressEvent) => {
    transfer?.bump()
    total = contentLength || total
    const now = Date.now()
    if (now - lastUpdatedAt < PROGRESS_INTERVAL) return

    const elapsed = now - sample.time
    const speed = elapsed > 0 && bytesWritten >= sample.downloaded
      ? formatSpeed((bytesWritten - sample.downloaded) * 1000 / elapsed)
      : ''
    lastUpdatedAt = now
    sample = { time: now, downloaded: bytesWritten }
    update({
      downloaded: bytesWritten,
      total,
      progress: inFlightProgress(bytesWritten, total),
      speed,
    })
  }

  let jobId: number | null = null
  try {
    const { jobId: startedJobId, promise } = downloadFile(url, tempPath, {
      connectionTimeout: 15_000,
      readTimeout: 30_000,
      progressInterval: PROGRESS_INTERVAL,
      progress: handleProgress,
    })
    jobId = startedJobId
    runningJobs.set(id, startedJobId)
    transfer = withTransferWatchdog(promise, {
      timer: stageTimer,
      onStall: () => { stopJob(id, startedJobId) },
      // 息屏那几分钟不该算卡死：冻住和解冻都是系统行为，不是这条连接坏了
      mayAbort: isActive,
    })
    const result = await transfer.promise
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new Error(`HTTP ${result.statusCode}`)
    }
    if (result.bytesWritten <= 0) {
      throw new Error('empty response')
    }
    const finished = transferDone(result.bytesWritten, total)
    downloaded = finished.downloaded
    total = finished.total
    update({
      downloaded,
      total,
      progress: finished.progress,
      speed: '',
      metadata: { ...metadata, url },
    })
  } catch (err: any) {
    await removeTempFile(tempPath)
    // 请求是暂停按钮自己停掉的，或者用户已经改了主意——这不是下载失败
    if (!isCurrentRun()) return
    // 屏幕上那句是给人看的结论，日志里这条是原生层的原话；只留前者查不动真凶
    log.error(`download transfer: ${musicInfo.name} - ${err?.message ?? err}`)
    errorUpdate(transferErrorKey(err))
    return
  } finally {
    // 只亲手摘掉这一轮自己登记的那张牌：中途被暂停/继续顶替过的话，
    // runningJobs 里躺着的是新任务的 jobId，删掉它新任务就再也停不下来了
    if (jobId != null && runningJobs.get(id) === jobId) runningJobs.delete(id)
  }

  // 字节到手了但用户已经改了主意（暂停、继续重来、换音质）或者把歌移出列表：
  // 这一轮不算数，临时文件也不留——继续本来就该是从头下，不是把这首歌在背后偷偷发布出去
  if (!isCurrentRun() || !state.list.some(listItem => listItem.id === id)) {
    await removeTempFile(tempPath)
    return
  }

  let ext: LX.Download.FileExt
  try {
    const format = sniffAudioFormat(await guardStage('head', readHead(tempPath)))
    if (!format) throw new Error('not audio')
    ext = format
  } catch {
    await removeTempFile(tempPath)
    // 无损音质取到的是完整体积却没有任何容器特征，就是被加密过的直链（腾讯的 .mflac 等）
    const encrypted = quality == 'flac' || quality == 'flac24bit'
    errorUpdate(encrypted ? 'download_not_audio_encrypted' : 'download_not_audio')
    return
  }

  // 原生层按后缀决定用 ID3 还是 Vorbis，所以先把 .tmp 换成真后缀再写标签
  const tagPath = `${temporaryDirectoryPath}/download_${id}_${Date.now()}.${ext}`
  let filePath = tempPath
  try {
    await guardStage('rename', moveFile(tempPath, tagPath))
    filePath = tagPath
  } catch {
    await removeTempFile(tagPath)
  }
  if (filePath == tagPath) {
    try {
      await guardStage('tags', applyFileTags(tagPath, musicInfo))
    } catch {
      // 标签是锦上添花：卡住或写坏都不该让整首歌报成下载失败
      log.error(`download tags: gave up on ${musicInfo.name}`)
    }
  }

  // 嗅探和写标签这段时间用户按了暂停或重来，歌虽然拿全了，但这一轮不该再往下写
  if (!isCurrentRun()) {
    await removeTempFile(filePath)
    return
  }

  const dir = await guardStage('save_dir', resolveSaveDir().catch(() => null))
  if (!dir) {
    await removeTempFile(filePath)
    errorUpdate('download_save_path_unauthorized')
    return
  }

  let fileName: string
  try {
    fileName = await guardStage('publish', publishFile(filePath, dir, metadata.fileName, ext))
  } catch {
    await removeTempFile(filePath)
    errorUpdate('download_publish_failed')
    return
  }

  await removeTempFile(filePath)
  scanPublishedFile(dir, fileName)

  if (!update({
    status: 'completed',
    isComplate: true,
    statusText: '',
    downloaded,
    total,
    progress: 1,
    speed: '',
    metadata: {
      ...metadata,
      url,
      ext,
      fileName,
      filePath: childWritePath(dir, fileName),
    },
  })) return
  notifyTask(global.i18n.t('download_task_completed', { name: musicInfo.name }))
}

const runQueue = async(epoch: number) => {
  for (;;) {
    // 被抢占/作废的那一轮只许收摊，不许再认领新任务
    if (epoch !== queueEpoch) return
    const waitingItem = state.list.find(item => item.status === 'waiting')
    if (!isDownloadTask(waitingItem)) return

    lastClaimAt = Date.now()
    const round = ++roundSeq
    taskRounds.set(waitingItem.id, round)
    updateItem(waitingItem.id, { status: 'run', statusText: '' })
    try {
      await runTask(waitingItem, round)
    } catch (err: any) {
      // 一首歌唱崩不该让整张列表陪着停在排队中
      log.error(`download queue: ${waitingItem.id} failed unexpectedly: ${err.message}`)
      const message = global.i18n.t('download_failed_unexpected')
      updateItem(waitingItem.id, { status: 'error', statusText: message, speed: '' })
      notifyTask(global.i18n.t('download_task_failed', { name: waitingItem.metadata.musicInfo.name, msg: message }))
    }
  }
}

let isQueueRunning = false
let lastQueueCrashAt = 0
/** 最近一次「有任务被认领」的时间：队列自称在跑却没动静时，靠它判断是不是该自愈 */
let lastClaimAt = 0
/** 队列那一轮的所有权代次：被抢占时 +1，旧的一轮在下一个检查点自己退出 */
let queueEpoch = 0

/** 还有没有等着的任务：循环退出/崩掉之后靠它决定要不要再拉一轮 */
const hasWaitingTask = () => state.list.some(item => item.status === 'waiting')

/** 有人排队、却没有任何任务在跑，而且好几秒没被认领：那一轮的 await 已经不回来了 */
const queueLooksStuck = () => {
  if (!hasWaitingTask()) return false
  if (state.list.some(item => item.status === 'run')) return false
  return Date.now() - lastClaimAt > 5_000
}

const launchQueue = () => {
  isQueueRunning = true
  const epoch = queueEpoch
  void runQueue(epoch).then(
    () => { finishQueueRun(epoch) },
    (err: any) => { handleQueueCrash(epoch, err) },
  )
}

const finishQueueRun = (epoch: number) => {
  // 已被作废的那一轮收尾时什么都不做，免得把新一轮的牌子摘了
  if (epoch !== queueEpoch) return
  isQueueRunning = false
  // 正常跑空、或者任务刚好在循环收尾那一瞬入队（错过一次唤醒），都把队列再拉起来。
  // 没有等待任务时这里是纯空转，不用额外条件判断
  if (hasWaitingTask()) launchQueue()
}

const handleQueueCrash = (epoch: number, err: any) => {
  if (epoch !== queueEpoch) return
  isQueueRunning = false
  log.error(`download queue crashed: ${err?.message ?? err}`)
  const crashAt = Date.now()
  const burst = crashAt - lastQueueCrashAt < 1_000
  lastQueueCrashAt = crashAt
  // 循环本身崩掉（不是某一首歌失败）时队列就死了：只要还有排队中的任务，把它拉起来。
  // 一秒内连崩两次说明是稳定故障，再拉只会原地空转，留给下一次入队或回前台来试
  if (!burst) finishQueueRun(epoch)
}

const startQueue = () => {
  if (isQueueRunning) {
    if (!queueLooksStuck()) return
    // 队列自称在跑，却好几秒没人被认领：作废那一轮，重新拉（旧的醒来会自己退出）
    log.error('download queue: reclaiming a round that stopped claiming tasks')
    queueEpoch += 1
    isQueueRunning = false
  }
  launchQueue()
}

const reportEnqueue = (added: string[], retried: string[], completed: string[], paused: string[], running: string[]) => {
  const t = global.i18n.t.bind(global.i18n)
  const parts: string[] = []
  if (added.length) {
    parts.push(added.length == 1
      ? t('download_added_one', { name: added[0] })
      : t('download_added_many', { count: added.length }))
  }
  if (retried.length) {
    parts.push(retried.length == 1
      ? t('download_retried_one', { name: retried[0] })
      : t('download_retried_many', { count: retried.length }))
  }
  if (completed.length) parts.push(t('download_skipped_completed', { count: completed.length }))
  if (paused.length) parts.push(t('download_skipped_paused', { count: paused.length }))
  if (running.length) parts.push(t('download_skipped_running', { count: running.length }))
  if (parts.length) toast(parts.join('；'), 'long')
}

export const enqueueDownloads = (
  musicInfos: LX.Music.MusicInfoOnline[],
  choice: QualityChoice,
) => {
  const added: string[] = []
  const retried: string[] = []
  const completed: string[] = []
  const paused: string[] = []
  const running: string[] = []

  try {
    const { assigned, skipped } = assignQualities(musicInfos, choice, source => global.lx.qualityList[source] ?? [])
    if (skipped.length) toast(global.i18n.t('download_quality_skipped'), 'long')

    assigned.forEach(({ musicInfo, quality }) => {
      const exist = state.list.find(item => item.id === musicInfo.id)
      if (!exist) {
        added.push(musicInfo.name)
        addItem(createItem(musicInfo, quality))
        return
      }
      // 失败过的歌重新点就是要再试一次：换个音质、换个时间都可能成，旧的地址和错误不能留着
      if (exist.status === 'error') {
        retried.push(musicInfo.name)
        updateItem(exist.id, restartPatch(exist.metadata, {
          quality,
          ext: 'mp3',
          fileName: buildFileName(musicInfo),
          filePath: '',
        }))
        return
      }
      if (exist.status === 'completed') {
        completed.push(musicInfo.name)
        return
      }
      // 暂停是用户按出来的，不是在下载；这里把他"又点了一次下载"归给暂停那条提示，真正继续要在下载页按"继续"
      if (exist.status === 'pause') {
        paused.push(musicInfo.name)
        return
      }
      running.push(musicInfo.name)
    })

    // 队列先踢起来，再报告：报告只是给用户看一眼的 toast，
    // 它万一出问题（比如系统禁了 toast）不许把「点击后开始下载」这件事一起带走
    startQueue()
  } catch (err: any) {
    log.error(`download enqueue failed: ${err?.message ?? err}`)
    // 入队本身出问题也不能让已经加进列表的歌停在排队中
    startQueue()
  }

  try {
    reportEnqueue(added, retried, completed, paused, running)
  } catch (err: any) {
    log.error(`download enqueue report failed: ${err?.message ?? err}`)
  }
}

/** 暂停一首在跑或排队的歌：先改状态再停请求，反过来会把这次暂停报成下载失败 */
export const pauseTask = (id: string) => {
  const item = state.list.find(listItem => listItem.id === id)
  if (!item || !canPause(item.status)) return
  updateItem(id, pausePatch())
  stopJob(id)
}

/** 继续一首暂停的歌：从头重下，所以旧地址和旧进度都不留 */
export const resumeTask = (id: string) => {
  const item = state.list.find(listItem => listItem.id === id)
  if (!item || !canResume(item.status)) return
  updateItem(id, restartPatch(item.metadata))
  startQueue()
}

export const pauseAll = () => {
  state.list.filter(item => canPause(item.status)).forEach(item => {
    pauseTask(item.id)
  })
}

export const resumeAll = () => {
  state.list.filter(item => canResume(item.status)).forEach(item => {
    updateItem(item.id, restartPatch(item.metadata))
  })
  startQueue()
}

let isAppStateBound = false

export const initDownload = async() => {
  await load()
  state.list.forEach(item => {
    if (item.status === 'run') {
      updateItem(item.id, { status: 'waiting', statusText: '' })
    }
  })
  startQueue()
  if (isAppStateBound) return
  isAppStateBound = true
  // 回到前台顺手拉一把：后台期间系统冻过线程、或队列因为连崩停过，
  // 用户看到的是一张「排队中」的列表，这里给它一次自愈的机会
  AppState.addEventListener('change', status => {
    if (status === 'active') startQueue()
  })
}
