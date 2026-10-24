// 把 RN 侧 src/config/builtinSources/scripts.ts 里的内置音源脚本导出成原生 assets。
// 脚本本身是纯 JS，跑在 QuickJS 里不需要改动；换脚本后重跑：
//   node android-native/tools/export-builtin-sources.mjs
import { mkdir, writeFile, readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const outDir = resolve(repoRoot, 'android-native/app/src/main/assets/lx-sources')
const sourceUrl = pathToFileURL(resolve(repoRoot, 'src/config/builtinSources/scripts.ts')).href

const INFO_LINE_RXP = /^\s*(?:\/\/|\/\*|\*|\*\/)?\s*@([\w-]+)\s+(.*)$/

const matchHeaderComment = (content) => {
  const matched = /^\s*\/\*([\s\S]*?)\*\//.exec(content)
  return matched ? matched[1] : null
}

const parseHeader = (content) => {
  const comment = matchHeaderComment(content)
  const infos = {}
  if (comment == null) return infos
  for (const line of comment.split(/\r?\n/)) {
    const matched = INFO_LINE_RXP.exec(line)
    if (!matched) continue
    const key = matched[1].replace(/_/g, '').toLowerCase()
    infos[key] ||= matched[2].trim()
  }
  return infos
}

const { BUILTIN_SOURCE_SCRIPTS } = await import(sourceUrl)

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

const manifest = []
for (const raw of BUILTIN_SOURCE_SCRIPTS) {
  const header = parseHeader(raw.script)
  if (!header.name || !header.version) {
    throw new Error(`builtin source ${raw.key} has no valid script header`)
  }
  const scriptFile = `${raw.key}.js`
  await writeFile(join(outDir, scriptFile), raw.script, 'utf8')
  const scriptUpdateUrl = header.updateurl ?? ''
  manifest.push({
    id: `builtin_${raw.key}`,
    key: raw.key,
    kind: raw.kind,
    name: header.name,
    version: header.version,
    description: header.description ?? '',
    author: header.author ?? '',
    homepage: header.homepage ?? '',
    updateUrl: raw.updateUrl ?? scriptUpdateUrl,
    scriptUpdateUrl,
    legacyUpdateUrls: raw.legacyUpdateUrls ?? [],
    fallbackUpdateUrls: raw.fallbackUpdateUrls ?? [],
    checkUpdateUrls: raw.checkUpdateUrls ?? [],
    autoCheck: raw.autoCheck ?? !!(raw.updateUrl || scriptUpdateUrl || (raw.checkUpdateUrls?.length ?? 0)),
    scriptFile,
  })
}

await writeFile(join(outDir, 'manifest.json'), JSON.stringify({ sources: manifest }, null, 2), 'utf8')
const written = await readdir(outDir)
console.log(`exported ${manifest.length} sources -> ${outDir}`)
console.log(written.join(', '))
