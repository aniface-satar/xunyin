import { joinSavePath } from '../../utils/savePath.ts'

/**
 * 分享图落盘的 SAF 路径判据。本文件除 savePath.ts 外不许有 import（规矩同 cardFileName.ts）：
 * node --test 走 ESM，相对 import 不带 .ts 扩展名会 ERR_MODULE_NOT_FOUND（实测），
 * 而带扩展名的写法 tsc 认——基座 @react-native/typescript-config 开了 allowImportingTsExtensions。
 *
 * 语义与下载那边（src/core/download/safPath.ts）一致，两份合一见 Task 11。
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

/** 保存目录两种形态：App 私有/公共裸路径，和系统文件夹选择器（SAF）给的 tree URI（可能带 /document/ 尾段） */
export const parseSaveDir = (dir: string): SaveDirRef => {
  const matched = TREE_URI_RXP.exec(dir)
  if (!matched) return { kind: 'plain', path: dir }
  const [, authority, treeSegment, documentSegment] = matched
  return {
    kind: 'tree',
    authority,
    treeSegment,
    parentDocId: documentSegment ? decodeSegment(documentSegment) : decodeSegment(treeSegment),
  }
}

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
 * 授权列表里有没有覆盖这个目录的树。只认"同一棵树"或"授权目录是所选目录的祖先"：
 * 拿着子目录的授权写父目录，系统那边直接拒绝。裸路径是 App 自己的目录，不需要 SAF 授权。
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

/**
 * 判断文件是否已存在时必须给完整的 document URI：原生层按最后一个斜杠拆目录和文件名，
 * 裸拼出来的 URI 少一层，exists 永远返回 false，同名不覆盖就会一路堆 (1)(2)(3)。
 */
export const childProbePath = (dir: string, name: string) => {
  const ref = parseSaveDir(dir)
  if (ref.kind == 'plain') return joinSavePath(ref.path, name)
  return `content://${ref.authority}/tree/${ref.treeSegment}/document/${encodeURIComponent(`${ref.parentDocId}/${name}`)}`
}

/** 媒体库扫描只认真实文件系统路径；还原不了（私有目录、认不出卷名）就返回 null，调用方跳过扫描 */
export const childRealPath = (dir: string, name: string) => {
  const ref = parseSaveDir(dir)
  if (ref.kind == 'plain') return /^(\/storage|\/sdcard)\//.test(ref.path) ? joinSavePath(ref.path, name) : null
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
