import RNFS from 'react-native-fs'
import BackgroundTimer from 'react-native-background-timer'

import { getLyricInfo, getPicPath } from '@/core/music'
import { writeLyric, writeMetadata, writePic } from '@/utils/localMediaMetadata'
import { downloadFile, temporaryDirectoryPath, unlink } from '@/utils/fs'
import { log } from '@/utils/log'
import { buildTagContent, toLrcText } from './tagContent'

/** 封面和歌词都要再走一次网络，卡在这儿会让整个下载队列停住，所以给它们一个上限 */
const FETCH_TIMEOUT = 12_000

const tagPicDir = `${temporaryDirectoryPath}/download-tags`

const ensureTagPicDir = async() => {
  await RNFS.mkdir(tagPicDir)
  return tagPicDir
}

const withinTimeout = async<T>(promise: Promise<T>, fallback: T): Promise<T> => {
  return new Promise((resolve) => {
    let settled = false
    const done = (value: T) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const timer = BackgroundTimer.setTimeout(() => { done(fallback) }, FETCH_TIMEOUT)
    promise.then((value) => {
      BackgroundTimer.clearTimeout(timer)
      done(value)
    }, () => {
      BackgroundTimer.clearTimeout(timer)
      done(fallback)
    })
  })
}

/**
 * 取封面到本地文件。
 * 原生层是用 jaudiotagger 从文件里读二进制再嵌标签，给它 URL 它不会自己下载。
 */
const fetchCoverPic = async(musicInfo: LX.Music.MusicInfoOnline) => {
  const picUrl = await getPicPath({ musicInfo })
  if (!picUrl) return ''
  const picPath = `${await ensureTagPicDir()}/${musicInfo.id}.jpg`
  const result = await downloadFile(picUrl, picPath, {
    connectionTimeout: 10_000,
    readTimeout: 15_000,
  }).promise
  if (result.statusCode < 200 || result.statusCode >= 300) {
    void unlink(picPath).catch(() => {})
    return ''
  }
  return picPath
}

const writeTag = async(label: string, run: Promise<void>) => {
  try {
    await run
  } catch (err: any) {
    log.error(`download tags: write ${label} failed: ${err.message}`)
  }
}

/**
 * 给已经落地的音频文件补上歌名、歌手、专辑、封面和歌词。
 * 每一项都各写各的：缺封面不该让歌名也一起没有，取歌词失败也不该让这首歌变成"下载失败"。
 * 必须在改名成真实后缀之后、发布到保存目录之前调用——原生层按后缀决定用哪种标签格式。
 */
export const applyFileTags = async(filePath: string, musicInfo: LX.Music.MusicInfoOnline) => {
  const [picPath, lyric] = await Promise.all([
    withinTimeout(fetchCoverPic(musicInfo).catch(() => ''), ''),
    withinTimeout(getLyricInfo({ musicInfo }).then(info => toLrcText(info.lyric)).catch(() => ''), ''),
  ])

  await writeTag('metadata', writeMetadata(filePath, buildTagContent(musicInfo)))
  if (picPath) {
    await writeTag('pic', writePic(filePath, picPath))
    void unlink(picPath).catch(() => {})
  }
  if (lyric) await writeTag('lyric', writeLyric(filePath, lyric))
}
