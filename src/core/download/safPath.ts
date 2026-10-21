import { joinSavePath } from '../../utils/savePath.ts'

/**
 * 保存目录有两种形态：App 私有目录的裸路径，和系统文件夹选择器（SAF）给的 URI。
 * SAF 的「目录 + 文件名」不能直接当文件系统路径用：
 * - 写文件时原生层按最后一个斜杠拆出目录和文件名，所以裸拼即可；
 * - 判断文件是否已存在时必须是完整的 document URI，多出来的尾段会让原生层解析失败、永远判成"不存在"；
 * - 媒体库扫描只认文件系统路径，所以要把 URI 里的 docId 反推回 /storage 下的真实路径。
 */
const TREE_URI_RXP = /^content:\/\/([^/]+)\/tree\/([^/]+)(?:\/document\/(.+))?$/

const PRIMARY_VOLUME_ROOT = '/storage/emulated/0'

export type SaveDirRef =
  | { kind: 'plain', path: string }
  | { kind: 'tree', authority: string, treeSegment: string, parentDocId: string }

const decodeSegment = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export const parseSaveDir = (dir: string): SaveDirRef => {
  const matched = TREE_URI_RXP.exec(dir)
  if (!matched) return { kind: 'plain', path: dir }
  const [, authority, treeSegment, documentSegment] = matched
  const treeDocId = decodeSegment(treeSegment)
  return {
    kind: 'tree',
    authority,
    treeSegment,
    parentDocId: documentSegment ? decodeSegment(documentSegment) : treeDocId,
  }
}

/** 交给原生层写文件的目标路径 */
export const childWritePath = (dir: string, name: string) => joinSavePath(dir, name)

/** docId 拆成 [卷名, 层级...]：primary:Music/LxMusic 的祖先是 primary: 和 primary:Music */
const docSegments = (docId: string) => {
  const index = docId.indexOf(':')
  const volume = index < 0 ? docId : docId.slice(0, index)
  const relative = index < 0 ? '' : docId.slice(index + 1)
  return [volume, ...relative.split('/').filter(Boolean)]
}

const isDocAncestor = (ancestor: string, docId: string) => {
  const short = docSegments(ancestor)
  const long = docSegments(docId)
  return short.length <= long.length && short.every((segment, index) => long[index] == segment)
}

/**
 * 授权列表里是否有覆盖这个目录的树。
 * 只有「授权目录 == 所选目录」或「授权目录是所选目录的祖先」才算：拿着子目录的授权写父目录会被系统拒绝。
 * 裸路径是 App 自己的目录，不需要 SAF 授权。
 */
export const isDirGranted = (persisted: string[], dir: string) => {
  const target = parseSaveDir(dir)
  if (target.kind == 'plain') return true
  return persisted.some((uri) => {
    const grant = parseSaveDir(uri)
    if (grant.kind != 'tree' || grant.authority != target.authority) return false
    return isDocAncestor(grant.parentDocId, target.parentDocId)
  })
}

/** 交给 exists/stat 判断的路径：SAF 目录要还原成完整的 document URI */
export const childProbePath = (dir: string, name: string) => {
  const ref = parseSaveDir(dir)
  if (ref.kind == 'plain') return joinSavePath(dir, name)
  return `content://${ref.authority}/tree/${ref.treeSegment}/document/${encodeURIComponent(`${ref.parentDocId}/${name}`)}`
}

/** 文件系统里的真实路径，只有主存储和可移除存储卷能还原；还原不了就跳过媒体扫描 */
export const childRealPath = (dir: string, name: string) => {
  const ref = parseSaveDir(dir)
  if (ref.kind == 'plain') return /^(\/storage|\/sdcard)\//.test(dir) ? joinSavePath(dir, name) : null
  const docId = `${ref.parentDocId}/${name}`
  const separatorIndex = docId.indexOf(':')
  if (separatorIndex < 0) return null
  const volume = docId.slice(0, separatorIndex)
  const relativePath = docId.slice(separatorIndex + 1)
  if (!relativePath) return null
  if (volume == 'primary') return `${PRIMARY_VOLUME_ROOT}/${relativePath}`
  if (/^[A-Za-z0-9-]{4,}$/.test(volume)) return `/storage/${volume}/${relativePath}`
  return null
}
