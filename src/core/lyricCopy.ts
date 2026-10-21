/**
 * 歌词工具页（复制/海报）的核心逻辑。本模块必须保持零 import：
 * node --test 直接载它跑单测，一旦 import react-native 或 store 就载不动。
 */

export interface LyricCopyLine {
  text: string
  extendedLyrics?: string[] | null
}

const pushText = (out: string[], value: string | null | undefined) => {
  const text = value?.trim()
  if (!text) return
  out.push(text)
}

/** 这一行到底有没有字：纯音乐的空白行不该被选中，也不该被算进全选。 */
export const hasLyricText = (line: LyricCopyLine) => {
  if (line.text?.trim()) return true
  return (line.extendedLyrics ?? []).some(text => !!text?.trim())
}

const textedLineIndexes = (lines: readonly LyricCopyLine[]) => {
  const indexes: number[] = []
  lines.forEach((line, index) => {
    if (hasLyricText(line)) indexes.push(index)
  })
  return indexes
}

/** 全选 = 屏幕上所有带字的行。 */
export const selectAllLyricLines = (lines: readonly LyricCopyLine[]) => new Set(textedLineIndexes(lines))

/** 反选只在带字的行之间取补集，空白行永远不会被点亮。 */
export const invertLyricSelection = (lines: readonly LyricCopyLine[], selected: ReadonlySet<number>) =>
  new Set(textedLineIndexes(lines).filter(index => !selected.has(index)))

/**
 * 按选中的行号取出要复制的行，保持歌词本来的顺序；一行都没选就什么都不复制。
 */
export const pickLyricLineIndexes = (lines: readonly LyricCopyLine[], selected: ReadonlySet<number>) => {
  const indexes: number[] = []
  lines.forEach((line, index) => {
    if (selected.has(index)) indexes.push(index)
  })
  return indexes
}

/**
 * 按选中的行号取出要复制的行，保持歌词本来的顺序；一行都没选就什么都不复制。
 */
export const pickLyricLinesForCopy = (lines: readonly LyricCopyLine[], selected: ReadonlySet<number>) =>
  pickLyricLineIndexes(lines, selected).map(index => lines[index])

/**
 * 按屏幕上看到的顺序拼出可分享的纯文本：正文每行一句，译文/罗马音紧跟自己那一行，
 * 不带时间标签，也不带歌名歌手，空行（纯音乐段）丢弃。
 */
export const buildLyricCopyText = (lines: readonly LyricCopyLine[]) => {
  const body: string[] = []
  for (const line of lines) {
    pushText(body, line.text)
    for (const extended of line.extendedLyrics ?? []) pushText(body, extended)
  }
  return body.join('\n')
}

let lyricToolMode = false
const modeListeners = new Set<() => void>()

export const getLyricToolMode = () => lyricToolMode

export const setLyricToolMode = (value: boolean) => {
  if (lyricToolMode === value) return
  lyricToolMode = value
  for (const listener of modeListeners) listener()
}

export const subscribeLyricToolMode = (listener: () => void) => {
  modeListeners.add(listener)
  return () => {
    modeListeners.delete(listener)
  }
}
