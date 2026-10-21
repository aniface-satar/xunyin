/** 那一格留给"字节真的到手"：传输途中显示 100% 是个谎，而且它会和后面的写标签、搬家撞在一起 */
const IN_FLIGHT_CEILING = 0.99

/** 下载途中的进度：不知道总长就没有比例，负数不能把进度条拽反 */
export const inFlightProgress = (bytesWritten: number, contentLength: number) => {
  if (!(contentLength > 0) || !(bytesWritten > 0)) return 0
  return Math.min(IN_FLIGHT_CEILING, bytesWritten / contentLength)
}

/** 传完了：进度写满，总长按实到手的大小补齐（有些直链不给 Content-Length） */
export const transferDone = (bytesWritten: number, contentLength: number) => {
  const total = Math.max(bytesWritten, contentLength)
  return { downloaded: total, total, progress: 1 }
}

export const progressLabel = (progress: number) => {
  // 先归一到两位小数再取整，否则 0.99 * 100 在浮点上是 98.999…，进度条会自己退一格
  const percent = Number.parseFloat((Math.max(0, Math.min(1, progress)) * 100).toFixed(2))
  return `${Math.floor(percent)}%`
}

/** 歌已经拿到手、还在嗅探/写标签/搬进音乐文件夹 */
export const isSaving = (status: LX.Download.DownloadTaskStatus, progress: number) => status == 'run' && progress >= 1
