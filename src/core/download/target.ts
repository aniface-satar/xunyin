import RNFS from 'react-native-fs'

import { updateSetting } from '@/core/common'
import {
  copyFile,
  existsFile,
  getPersistedUriList,
  selectManagedFolder,
} from '@/utils/fs'
import settingState from '@/store/setting/state'
import { childProbePath, childRealPath, childWritePath, isDirGranted } from './safPath'

/** 用户选过文件夹、而且 SAF 授权还在 */
export const isSaveDirUsable = async(dir: string) => {
  const persisted = await getPersistedUriList().catch(() => [])
  if (!isDirGranted(persisted, dir)) return false
  return existsFile(dir).catch(() => false)
}

export const getSaveDir = () => settingState.setting['download.savePath']

export const getSaveDirName = () => {
  const dir = getSaveDir()
  if (!dir) return ''
  return settingState.setting['download.savePathName'] || dir
}

/** 弹系统文件夹选择器并记住授权；用户取消或选的不是文件夹时返回 null */
export const pickSaveDir = async() => {
  const dir = await selectManagedFolder(true).catch(() => null)
  if (!dir?.path || !dir.isDirectory) return null
  updateSetting({
    'download.savePath': dir.path,
    'download.savePathName': dir.name || dir.path,
  })
  return dir.path
}

/** 没有可用的保存位置就当场弹系统文件夹选择器；用户取消则返回 false */
export const ensureUsableSaveDir = async() => {
  const dir = getSaveDir()
  if (dir && await isSaveDirUsable(dir)) return true
  return (await pickSaveDir()) != null
}

/**
 * 本次可用的保存目录。
 * 没选过位置或授权失效都返回 null——悄悄存进用户看不见的私有目录，等于没有下载。
 * 入队前的 ensureUsableSaveDir 会先把系统音乐文件夹授权好，这里只负责兜住失效的情况。
 */
export const resolveSaveDir = async() => {
  const dir = getSaveDir()
  if (!dir) return null
  return await isSaveDirUsable(dir) ? dir : null
}

/** 同名不覆盖：在已存在的名字后面加 (1)(2)… */
export const uniqueChildName = async(dir: string, baseName: string, ext: string) => {
  let name = `${baseName}.${ext}`
  let index = 1
  while (await existsFile(childProbePath(dir, name)).catch(() => false)) {
    name = `${baseName} (${index}).${ext}`
    index++
  }
  return name
}

/** 把临时文件搬到保存目录，返回保存目录内的文件名 */
export const publishFile = async(tempPath: string, dir: string, baseName: string, ext: string) => {
  const name = await uniqueChildName(dir, baseName, ext)
  await copyFile(tempPath, childWritePath(dir, name))
  return name
}

/** SAF 写出来的文件不会被系统立刻收进媒体库，按真实路径补一次扫描；扫不到就算了 */
export const scanPublishedFile = (dir: string, name: string) => {
  const realPath = childRealPath(dir, name)
  if (!realPath) return
  void RNFS.scanFile(realPath).catch(() => {})
}
