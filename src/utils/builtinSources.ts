import type { BuiltinSourceDefinition } from '../config/builtinSources/catalog.ts'
import { findBuiltinSourceByUpdateUrl, REMOVED_BUILTIN_SOURCES } from '../config/builtinSources/catalog.ts'
import { parseScriptHeader } from '../core/userApiUpdate/resolveScript.ts'
import { compareVersions } from '../core/userApiUpdate/version.ts'

export interface BuiltinSeedWrite {
  id: string
  script: string
}

export interface BuiltinSeedPlan {
  list: LX.UserApi.UserApiInfo[]
  writes: BuiltinSeedWrite[]
  /** 这次从列表里下架的源：调用方要把盘上的脚本和备份一起删掉 */
  removedIds: string[]
  changed: boolean
}

export interface BuiltinSeedInput {
  existing: LX.UserApi.UserApiInfo[]
  storedScripts: Record<string, string | undefined>
  definitions: readonly BuiltinSourceDefinition[]
}

const createInfo = (definition: BuiltinSourceDefinition): LX.UserApi.UserApiInfo => ({
  id: definition.id,
  name: definition.name,
  description: definition.description,
  allowShowUpdateAlert: definition.kind == 'online',
  autoUpdate: definition.autoUpdate,
  author: definition.author,
  homepage: definition.homepage,
  version: definition.version,
  updateUrl: definition.updateUrl,
  scriptUpdateUrl: definition.scriptUpdateUrl,
  lastCheckAt: 0,
  verifyPending: false,
  builtin: definition.kind,
  ...(definition.kind == 'local'
    ? { builtinVersion: definition.version }
    : { builtinUpdateUrl: definition.updateUrl }),
})

const applyDefinitionScriptInfo = (info: LX.UserApi.UserApiInfo, definition: BuiltinSourceDefinition) => {
  info.name = definition.name
  info.description = definition.description
  info.author = definition.author
  info.homepage = definition.homepage
  info.version = definition.version
  info.scriptUpdateUrl = definition.scriptUpdateUrl
}

/**
 * 这个源的更新地址是不是用户自己填的。
 *
 * 本地内置源随包播种时 updateUrl 是空的，所以非空就说明用户点过「手动更新」并保存了地址；
 * 记过「取回别家脚本」的地址是旧版误存进来的，不算用户的东西，跟着源一起下架。
 */
const hasOwnUpdateUrl = (info: LX.UserApi.UserApiInfo): boolean => {
  const url = info.updateUrl ?? ''
  if (!url || info.updateUrlRejected == url) return false
  return findBuiltinSourceByUpdateUrl(url) == null
}

/** 把用户接手的下架源改成普通自定义源，保留脚本、地址和用户开关 */
const detachBuiltinInfo = (info: LX.UserApi.UserApiInfo): LX.UserApi.UserApiInfo => {
  const copy = { ...info }
  delete copy.builtin
  delete copy.builtinVersion
  delete copy.builtinUpdateUrl
  delete copy.updateUrlRejected
  return copy
}

/**
 * 本地源的脚本头部地址要一直留在列表里。
 *
 * 早期版本只在「盘上脚本和包内一致」时才同步，脚本被运行时更新过之后
 * scriptUpdateUrl 可能一直是空的，检查更新就只能报「没有可用的更新地址」。
 * 盘上的脚本自己写了地址就以它为准，它跟着这个源一起更新；没写再用目录的。
 * 已经有值的不动，避免把用户后来换上的脚本地址盖回去。
 */
const fillMissingScriptUpdateUrl = (
  info: LX.UserApi.UserApiInfo,
  storedScript: string | undefined,
  definition: BuiltinSourceDefinition,
): boolean => {
  if (info.scriptUpdateUrl) return false
  const headerUrl = storedScript ? parseScriptHeader(storedScript)?.updateUrl ?? '' : ''
  const url = headerUrl.length > 0 ? headerUrl : definition.scriptUpdateUrl
  if (!url) return false
  info.scriptUpdateUrl = url
  return true
}

/**
 * 在线内置源的更新地址跟着目录走。
 *
 * 只有盘上那个地址还是目录写的（当前地址、或上一版随包写入的旧地址）才换成新地址；
 * 用户自己改过、或者手动清空了，就不动 —— 不能因为换了条线路把人家的设置擦掉。
 * 老数据没有 builtinUpdateUrl 标记，只能靠 legacyUpdateUrls 认出「这是上一版随包写的」。
 *
 * @returns 有没有改动
 */
const migrateOnlineUpdateUrl = (info: LX.UserApi.UserApiInfo, definition: BuiltinSourceDefinition): boolean => {
  const current = info.updateUrl ?? ''
  const seeded = info.builtinUpdateUrl

  if (seeded != null) {
    // 用户改过（包括清空）：保留
    if (current != seeded) {
      // 已经跟上目录的新地址时，把标记一起修正
      if (current != definition.updateUrl) return false
      if (seeded == definition.updateUrl) return false
      info.builtinUpdateUrl = definition.updateUrl
      return true
    }
    if (current == definition.updateUrl) return false
    info.updateUrl = definition.updateUrl
    info.builtinUpdateUrl = definition.updateUrl
    return true
  }

  // 老数据：地址还是上一版随包写的，说明没人动过
  if (definition.legacyUpdateUrls.includes(current)) {
    info.updateUrl = definition.updateUrl
    info.builtinUpdateUrl = definition.updateUrl
    return true
  }
  if (current && current == definition.updateUrl) {
    info.builtinUpdateUrl = definition.updateUrl
    return true
  }
  // 认不准是不是用户改的：按用户的算，以后也不自动迁移
  return false
}

/**
 * 把随包内置源补进源列表。
 *
 * 在线源可能已经被自动更新换成更新的脚本，只在脚本存储丢了（清数据、同步覆盖）时
 * 才拿包里的补回去。
 *
 * 本地源现在也能检查更新，所以不能每次启动都拿包里的脚本覆盖盘上的：
 * `builtinVersion` 记着这个应用包最后一次带进来的脚本版本，同一个应用包里
 * 盘上的差异只可能是用户检查更新换上的，要保留；应用升级后再按版本号决定，
 * 随包的更新就覆盖，用户已经更到更高版本的就留着。
 * 在线源的更新地址会跟着目录换线路，但只换目录自己写进去的那个值；
 * 用户的开关、手改的更新地址、上次检查时间一律保留。
 */
export const planBuiltinSeed = ({ existing, storedScripts, definitions }: BuiltinSeedInput): BuiltinSeedPlan => {
  const definitionIds = new Set(definitions.map(definition => definition.id))
  const removed = new Map(
    REMOVED_BUILTIN_SOURCES
      .filter(source => !definitionIds.has(source.id))
      .map(source => [source.id, source] as const),
  )
  const removedIds: string[] = []
  const list: LX.UserApi.UserApiInfo[] = []
  const writes: BuiltinSeedWrite[] = []
  let changed = false

  // 更新链路走不通的源已经从目录下架：老安装里随包播种的那份要一起清掉，
  // 否则它永远留在「本地音源」列表里，检查更新也只能报没有地址。
  // 用户自己填过更新地址的除外 —— 那是用户接手的源，只摘掉内置标记留在自定义源里。
  for (const info of existing) {
    // 只认还带着内置标记的条目：用户接手的源已经摘掉标记，下次启动不能再当内置源处理，
    // 否则每次都要重写列表，用户后来清空地址还会把整份脚本删掉
    if (!info.builtin || !removed.has(info.id)) {
      list.push({ ...info })
      continue
    }
    changed = true
    if (hasOwnUpdateUrl(info)) {
      list.push(detachBuiltinInfo(info))
      continue
    }
    removedIds.push(info.id)
  }

  // 旧版「手动更新先落址再预览」可能把别的内置源的地址存到这个源上（取回的一定是
  // 另一个音源的脚本，此前的西瓜聚合源就误存过落雪云的地址）。地址是用户字段不能替他删，
  // 但自动检查已经证明它没用：记下来，别让每次启动都白跑一次、日志里反复报错。
  // 名字相同的是用户自己又导入了一份同一个源，地址本来就能用，不算错配。
  for (const info of list) {
    const url = info.updateUrl ?? ''
    const owner = findBuiltinSourceByUpdateUrl(url)
    if (!owner || owner.id == info.id || owner.name == info.name || info.updateUrlRejected == url) continue
    info.updateUrlRejected = url
    changed = true
  }

  for (const definition of definitions) {
    const index = list.findIndex(info => info.id == definition.id)
    if (index < 0) {
      list.push(createInfo(definition))
      writes.push({ id: definition.id, script: definition.script })
      changed = true
      continue
    }

    const info = list[index]
    if (info.builtin != definition.kind) {
      info.builtin = definition.kind
      changed = true
    }

    const storedScript = storedScripts[definition.id]
    if (definition.kind == 'local') {
      if (storedScript === definition.script) {
        // 应用包和盘上的脚本一致：补上（或修正）这个应用包的版本标记
        if (info.builtinVersion !== definition.version) {
          info.builtinVersion = definition.version
          changed = true
        }
        if (info.scriptUpdateUrl !== definition.scriptUpdateUrl) {
          info.scriptUpdateUrl = definition.scriptUpdateUrl
          changed = true
        }
        continue
      }

      if (!storedScript) {
        writes.push({ id: definition.id, script: definition.script })
        applyDefinitionScriptInfo(info, definition)
        info.builtinVersion = definition.version
        changed = true
        continue
      }

      // 这个应用包已经处理过了，盘上的差异是运行时检查更新换上的脚本，保留
      if (info.builtinVersion === definition.version) {
        if (fillMissingScriptUpdateUrl(info, storedScript, definition)) changed = true
        continue
      }

      // 应用升级了：随包的脚本更新就覆盖，用户已经更到更高版本就保留
      const storedVersion = parseScriptHeader(storedScript)?.version ?? ''
      const compared = storedVersion ? compareVersions(definition.version, storedVersion) : null
      info.builtinVersion = definition.version
      if (compared == -1) {
        changed = true
        if (fillMissingScriptUpdateUrl(info, storedScript, definition)) changed = true
        continue
      }
      writes.push({ id: definition.id, script: definition.script })
      applyDefinitionScriptInfo(info, definition)
      changed = true
      continue
    }

    if (migrateOnlineUpdateUrl(info, definition)) changed = true

    if (storedScript) continue
    writes.push({ id: definition.id, script: definition.script })
    if (!info.name) info.name = definition.name
    if (!info.version) info.version = definition.version
    if (!info.scriptUpdateUrl) info.scriptUpdateUrl = definition.scriptUpdateUrl
    changed = true
  }

  return { list, writes, removedIds, changed }
}

export const pickBuiltinSources = (list: LX.UserApi.UserApiInfo[], kind: 'online' | 'local'): LX.UserApi.UserApiInfo[] => {
  return list.filter(info => info.builtin == kind)
}

/**
 * 当前音源被下架后改用哪个。
 *
 * 优先目录默认的内置源；它也不在列表里（用户把存储清了一半之类）就退到任一内置源，
 * 最后才是列表里的第一个源 —— 总比继续指向一个已经不存在的脚本要好。
 */
export const pickAvailableUserApiId = (
  list: readonly LX.UserApi.UserApiInfo[],
  preferredId: string,
): string => {
  if (list.some(info => info.id == preferredId)) return preferredId
  return list.find(info => info.builtin == 'online')?.id ??
    list.find(info => info.builtin)?.id ??
    list[0]?.id ??
    ''
}
