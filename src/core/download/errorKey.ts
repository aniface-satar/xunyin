import { TransferStalledError } from './transferGuard.ts'

/** 下载失败时屏幕上那一句的 key：每一个都对应一种「用户下一步该做什么」 */
export type DownloadErrorKey =
  | 'download_not_audio'
  | 'download_not_audio_encrypted'
  | 'download_url_failed'
  | 'download_url_rejected'
  | 'download_network_failed'
  | 'download_temp_failed'
  | 'download_transfer_stalled'
  | 'download_publish_failed'
  | 'download_save_path_unauthorized'

/** RNFS 在安卓上把网络故障的原话塞进 message（`promise.reject(null, ex.getMessage())`），没有错误码可看 */
const NETWORK_ERROR_RE = /Unable to resolve host|Failed to connect|connect timed out|Connection reset|ECONNRESET|ETIMEDOUT|ENETUNREACH|SocketException|not a valid IP/i

/**
 * 传输这一步的三种失败各有各的解法，全说成「存不了临时文件」会让人去重启手机。
 * HTTP 状态与空响应是调度器自己抛的，网络原文来自原生层，剩下的才真是本机写文件的问题。
 */
export const transferErrorKey = (err: any): DownloadErrorKey => {
  if (err instanceof TransferStalledError) return 'download_transfer_stalled'
  const message = String(err?.message ?? '')
  if (/^(HTTP \d|empty response)/.test(message)) return 'download_url_rejected'
  if (NETWORK_ERROR_RE.test(message)) return 'download_network_failed'
  return 'download_temp_failed'
}
