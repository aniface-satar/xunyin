import type { BuiltinSourceDefinition } from '../config/builtinSources/catalog.ts'
import { parseScriptHeader } from '../core/userApiUpdate/resolveScript.ts'
import { compareVersions } from '../core/userApiUpdate/version.ts'

export interface BuiltinSeedWrite {
  id: string
  script: string
}

export interface BuiltinSeedPlan {
  list: LX.UserApi.UserApiInfo[]
  writes: BuiltinSeedWrite[]
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
  ...(definition.kind == 'local' ? { builtinVersion: definition.version } : {}),
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
 * 把随包内置源补进源列表。
 *
 * 在线源可能已经被自动更新换成更新的脚本，只在脚本存储丢了（清数据、同步覆盖）时
 * 才拿包里的补回去。
 *
 * 本地源现在也能检查更新，所以不能每次启动都拿包里的脚本覆盖盘上的：
 * `builtinVersion` 记着这个应用包最后一次带进来的脚本版本，同一个应用包里
 * 盘上的差异只可能是用户检查更新换上的，要保留；应用升级后再按版本号决定，
 * 随包的更新就覆盖，用户已经更到更高版本的就留着。
 * 用户的开关、手填的更新地址、上次检查时间一律保留。
 */
export const planBuiltinSeed = ({ existing, storedScripts, definitions }: BuiltinSeedInput): BuiltinSeedPlan => {
  const list = existing.map(info => ({ ...info }))
  const writes: BuiltinSeedWrite[] = []
  let changed = false

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
      if (info.builtinVersion === definition.version) continue

      // 应用升级了：随包的脚本更新就覆盖，用户已经更到更高版本就保留
      const storedVersion = parseScriptHeader(storedScript)?.version ?? ''
      const compared = storedVersion ? compareVersions(definition.version, storedVersion) : null
      info.builtinVersion = definition.version
      if (compared == -1) {
        changed = true
        continue
      }
      writes.push({ id: definition.id, script: definition.script })
      applyDefinitionScriptInfo(info, definition)
      changed = true
      continue
    }

    if (storedScript) continue
    writes.push({ id: definition.id, script: definition.script })
    if (!info.name) info.name = definition.name
    if (!info.version) info.version = definition.version
    if (!info.scriptUpdateUrl) info.scriptUpdateUrl = definition.scriptUpdateUrl
    changed = true
  }

  return { list, writes, changed }
}

export const pickBuiltinSources = (list: LX.UserApi.UserApiInfo[], kind: 'online' | 'local'): LX.UserApi.UserApiInfo[] => {
  return list.filter(info => info.builtin == kind)
}
