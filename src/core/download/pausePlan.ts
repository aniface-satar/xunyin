/** 暂停和继续都只是改列表项上的状态，具体怎么停请求、怎么重排队由调度器做 */
type TaskPatch = Partial<LX.Download.ListItem>
type TaskMetadata = LX.Download.ListItem['metadata']

/** 暂停后进度清零：继续是从头重下，留半条进度只会让人以为能接着下 */
export const pausePatch = (): TaskPatch => {
  return {
    status: 'pause',
    statusText: '',
    speed: '',
    downloaded: 0,
    total: 0,
    progress: 0,
  }
}

/**
 * 回到队列里从头重下。
 * 旧地址必须清掉（直链会过期），换音质重试时还要能把新的档位写进去。
 */
export const restartPatch = (metadata: TaskMetadata, changed: Partial<TaskMetadata> = {}): TaskPatch => {
  return {
    status: 'waiting',
    isComplate: false,
    statusText: '',
    downloaded: 0,
    total: 0,
    progress: 0,
    speed: '',
    metadata: {
      ...metadata,
      url: null,
      ...changed,
    },
  }
}

export const canPause = (status: LX.Download.DownloadTaskStatus) => status == 'run' || status == 'waiting'

export const canResume = (status: LX.Download.DownloadTaskStatus) => status == 'pause'

/**
 * 一次在跑的下载只在状态还是「下载中」时拥有这首歌。
 * 用户按了暂停、按了继续、或者换了音质重试，旧的那一轮（可能还卡在没有超时的原生写入里）就不许再把状态盖回去——
 * 否则它回头报一个失败，会把用户刚按下去的「继续」吃掉。
 */
export const ownsTask = (status?: LX.Download.DownloadTaskStatus) => status == 'run'
