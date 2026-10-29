import RNFS from 'react-native-fs'

import { downloadFile, existsFile, temporaryDirectoryPath, unlink } from '@/utils/fs'
import { coverBaseName, coverFileName, picFileExtension } from './coverFile'
import { saveImageToChosenFolder } from './saveCard'

const COVER_TEMP_DIR = `${temporaryDirectoryPath}/cover-save`

const isRemote = (pic: string) => /^https?:\/\//i.test(pic)

/** 本地封面两种形态：咪咕给的是裸绝对路径，本地曲目读出来的是 file:// URI */
const toLocalPath = (pic: string) => (pic.startsWith('file://') ? pic.slice('file://'.length) : pic)

/**
 * 保存当前歌曲的封面到分享卡使用的目录设置（shareCard.savePath）。
 * 远端封面先下到缓存目录再复制；返回落地的文件名，用户在目录选择器里取消返回 null。
 */
export const saveCover = async({ pic, name, singer }: {
  pic: string
  name: string
  singer: string
}): Promise<string | null> => {
  const downloaded = isRemote(pic)
  let sourcePath: string
  if (downloaded) {
    await RNFS.mkdir(COVER_TEMP_DIR).catch(() => {})
    sourcePath = `${COVER_TEMP_DIR}/${Date.now()}_${coverFileName(name, singer, pic)}`
    const result = await downloadFile(pic, sourcePath, {
      connectionTimeout: 10_000,
      readTimeout: 15_000,
    }).promise
    if (result.statusCode < 200 || result.statusCode >= 300) {
      void unlink(sourcePath).catch(() => {})
      throw new Error(`download cover failed: ${result.statusCode}`)
    }
  } else {
    sourcePath = toLocalPath(pic)
    if (!await existsFile(sourcePath).catch(() => false)) throw new Error('cover file not found')
  }

  try {
    return await saveImageToChosenFolder(sourcePath, coverBaseName(name, singer), picFileExtension(pic))
  } finally {
    if (downloaded) void unlink(sourcePath).catch(() => {})
  }
}
