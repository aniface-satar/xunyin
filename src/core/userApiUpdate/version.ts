/**
 * 音源版本号的比较。
 *
 * @version 由作者自己填，没有统一规范：日期式、语义化、纯递增数字都常见。
 * 只在「两边都像版本号」时才给出结论；认不出的返回 null，
 * 调用方不能把它当成降级证据，否则一个写「beta」的作者会被永远卡住。
 */
export type VersionComparison = -1 | 0 | 1

const VERSION_RXP = /^\d+(?:[.\-_]\d+)*$/
const SEPARATOR_RXP = /[.\-_]/

const parseVersion = (version: string): { segments: number[], single: boolean } | null => {
  const text = version.trim().replace(/^v/i, '')
  if (!VERSION_RXP.test(text)) return null
  const segments = text.split(/[.\-_]/).map(Number)
  if (!segments.every(Number.isSafeInteger)) return null
  return { segments, single: !SEPARATOR_RXP.test(text) }
}

export const compareVersions = (a: string, b: string): VersionComparison | null => {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return null
  // 「20261020」和「2026.10.21」混在一起时分不清 2026 是年份还是第一个数，
  // 硬比会把合法升级判成降级；这种情况当作认不出，交给内容更新判断。
  if (left.single != right.single) return null
  const length = Math.max(left.segments.length, right.segments.length)
  for (let index = 0; index < length; index++) {
    const l = left.segments[index] ?? 0
    const r = right.segments[index] ?? 0
    if (l < r) return -1
    if (l > r) return 1
  }
  return 0
}
