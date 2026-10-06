/**
 * 中文分词封装（segmentit，纯 JS 可在 Hermes 运行）。
 * 模块加载与词典实例化分离：词典构建约 200ms，首次调用才实例化。
 * 用途：从歌名切出风格词与版本标记（DJ版/Live/翻唱/伴奏等），供词面级学习与搜索关键词生成。
 */

import * as segmentitModule from 'segmentit'

interface SegmenterInstance {
  doSegment: (text: string, options?: { simple?: boolean }) => string[]
}

interface SegmentitModule {
  Segment?: new () => SegmenterInstance
  useDefault?: (segment: SegmenterInstance) => SegmenterInstance
  default?: {
    Segment?: new () => SegmenterInstance
    useDefault?: (segment: SegmenterInstance) => SegmenterInstance
  }
}

let segmenter: SegmenterInstance | null = null

const ensureSegmenter = (): SegmenterInstance => {
  if (!segmenter) {
    // node ESM 把 CJS 导出全收进 default，Metro/babel interop 则两者都可能有，双取兼容
    const mod = segmentitModule as SegmentitModule
    const SegmentCtor = mod.Segment ?? mod.default?.Segment
    const applyDefaultDicts = mod.useDefault ?? mod.default?.useDefault
    if (!SegmentCtor || !applyDefaultDicts) throw new Error('segmentit module unavailable')
    segmenter = applyDefaultDicts(new SegmentCtor())
  }
  return segmenter
}

const STOP_TOKENS = new Set([
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '和', '与', '跟', '对', '被', '把',
  '吧', '吗', '呢', '啊', '呀', '哦', '嘛', '么', '啦', '哟', '喔', '嗯',
  '一个', '一些', '这个', '那个', '什么', '怎么', '没有', '不是',
  'feat', 'the', 'and', 'of', 'a', 'an', 'by', 'from', 'version', 'ver',
])

/** 歌名 → 降噪 token 列表：去掉单字、纯数字、停用词，小写化，去重，最多 12 个。 */
export const tokenizeTrackName = (name: string | undefined | null): string[] => {
  if (!name) return []
  const trimmed = name.trim()
  if (!trimmed) return []
  let words: string[]
  try {
    words = ensureSegmenter().doSegment(trimmed, { simple: true })
  } catch {
    words = trimmed.split(/\s+/)
  }
  const tokens: string[] = []
  for (const raw of words) {
    const token = raw.toLowerCase().trim()
    if (!token) continue
    if (/^\d+$/.test(token)) continue
    // 单字/单字母信息量低，直接过滤
    if (token.length < 2) continue
    if (STOP_TOKENS.has(token)) continue
    if (!tokens.includes(token)) tokens.push(token)
    if (tokens.length >= 12) break
  }
  return tokens
}
