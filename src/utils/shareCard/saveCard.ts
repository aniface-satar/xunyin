import RNFS from 'react-native-fs'

import { updateSetting } from '@/core/common'
import settingState from '@/store/setting/state'
import { copyFile, existsFile, getPersistedUriList, selectManagedFolder } from '@/utils/fs'
import { joinSavePath } from '@/utils/savePath'
import { childProbePath, childRealPath, isDirGranted } from './saveTarget'

const getDir = () => settingState.setting['shareCard.savePath']

const isUsableDir = async(dir: string) => {
  const persisted = await getPersistedUriList().catch(() => [])
  if (!isDirGranted(persisted, dir)) return false
  return existsFile(dir).catch(() => false)
}

/** 弹系统文件夹选择器并持久授权；用户取消或选的不是文件夹返回 null */
const pickDir = async() => {
  const dir = await selectManagedFolder(true).catch(() => null)
  if (!dir?.path || !dir.isDirectory) return null
  updateSetting({
    'shareCard.savePath': dir.path,
    'shareCard.savePathName': dir.name || dir.path,
  })
  return dir.path
}

/** 同名不覆盖：探测走 childProbePath（完整 document URI），写走裸拼，两者不能混 */
const uniqueName = async(dir: string, baseName: string, ext: string) => {
  let name = `${baseName}.${ext}`
  let index = 1
  while (await existsFile(childProbePath(dir, name)).catch(() => false)) {
    name = `${baseName} (${index}).${ext}`
    index++
  }
  return name
}

/**
 * 把导出的临时 PNG 落到用户选的目录（spec §5：海报不混进下载的音乐文件，所以是独立的 shareCard.savePath）。
 * 返回落地的文件名；用户没选位置就返回 null。SAF 写出来的图不会被系统立刻收进媒体库，补一次扫描，扫不到就算了。
 */
export const saveShareCard = async(tempPath: string, baseName: string): Promise<string | null> => {
  let dir = getDir()
  if (!dir || !await isUsableDir(dir)) dir = (await pickDir()) ?? ''
  if (!dir) return null
  const name = await uniqueName(dir, baseName, 'png')
  await copyFile(tempPath, joinSavePath(dir, name))
  const realPath = childRealPath(dir, name)
  if (realPath) void RNFS.scanFile(realPath).catch(() => {})
  return name
}
