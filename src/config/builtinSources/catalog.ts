import { parseScriptHeader } from '../../core/userApiUpdate/resolveScript.ts'
import { BUILTIN_SOURCE_SCRIPTS, type RawBuiltinSource } from './scripts.ts'

/**
 * 沿用社区对音源的说法：
 * - online：在线音源，通过更新地址拉取脚本导入
 * - local：本地音源，以 .js 文件形式导入
 *
 * 内置源都是打包进应用的 .js 脚本，按来源分成这两类只是沿用社区叫法。
 * 两类源都可以检查更新：作者在脚本头部写了 @updateUrl / @update_url 时，
 * 本地音源也能走同一套检查/更新流程；没有地址的源仍然只随应用更新。
 */
export type BuiltinSourceKind = 'online' | 'local'

export interface BuiltinSourceDefinition {
  id: string
  key: string
  kind: BuiltinSourceKind
  name: string
  version: string
  description: string
  author: string
  homepage: string
  script: string
  /** 目录里补的更新地址，写入用户可编辑的 updateUrl 初值 */
  updateUrl: string
  /** 脚本头部自带的更新地址 */
  scriptUpdateUrl: string
  autoUpdate: boolean
}

const parseDefinition = (raw: RawBuiltinSource): BuiltinSourceDefinition => {
  const header = parseScriptHeader(raw.script)
  if (!header?.name || !header.version) {
    throw new Error(`builtin source ${raw.key} has no valid script header`)
  }
  const online = raw.kind == 'online'
  const updateUrl = online ? raw.updateUrl ?? '' : ''
  return {
    id: `builtin_${raw.key}`,
    key: raw.key,
    kind: raw.kind,
    name: header.name,
    version: header.version,
    description: header.description,
    author: header.author,
    homepage: header.homepage,
    script: raw.script,
    updateUrl,
    // 不论在线还是本地，脚本头部自己声明的更新地址都留着：
    // 检查更新时会把它当成脚本自己报的地址来用
    scriptUpdateUrl: header.updateUrl,
    autoUpdate: raw.autoUpdate ?? (!!updateUrl || !!header.updateUrl),
  }
}

export const BUILTIN_SOURCES = BUILTIN_SOURCE_SCRIPTS.map(parseDefinition)

export const BUILTIN_SOURCE_IDS = BUILTIN_SOURCES.map(source => source.id)
