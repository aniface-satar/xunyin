/**
 * 语种分桶与四级判定（spec §3.1）。本模块必须保持纯函数：
 * 不 import config、不 import storage、不 import musicSdk，否则 node --test 载不动。
 * 判定原则：宁缺毋滥——判不出就 unknown 走自由名额，绝不硬判 en。
 */

export type LangBucket = 'zh' | 'yue' | 'en' | 'ja' | 'ko' | 'other' | 'instr' | 'unknown'

export const LANG_BUCKETS: readonly LangBucket[] = ['zh', 'yue', 'en', 'ja', 'ko', 'other', 'instr', 'unknown']

/** 进语种配额统计的桶：instr 由每窗口上限单独管，unknown 不参与硬约束。 */
export const QUOTA_LANG_BUCKETS: readonly LangBucket[] = ['zh', 'yue', 'en', 'ja', 'ko', 'other']

/** kg 语种字段是中文词（实测 song_search_v2 与歌单内嵌 global.data 的 trans_param.language 同形）。 */
const KG_LANGUAGE_WORDS: Record<string, LangBucket> = {
  国语: 'zh',
  中文: 'zh',
  华语: 'zh',
  粤语: 'yue',
  英语: 'en',
  英文: 'en',
  日语: 'ja',
  韩语: 'ko',
  法语: 'other',
  德语: 'other',
  意大利语: 'other',
  西班牙语: 'other',
  俄语: 'other',
  泰语: 'other',
  越南语: 'other',
  拉丁语: 'other',
  小语种: 'other',
}

/** 只认表内的词；表外（如"自译解词"）返回 null 交回下一级，不做子串匹配。 */
export const mapKgLanguageWord = (word: string | null | undefined): LangBucket | null => {
  const key = typeof word == 'string' ? word.trim() : ''
  if (!key) return null
  return KG_LANGUAGE_WORDS[key] ?? null
}

/** tx 语种是数字码表（实测钉死，见 spec §3.1 码表行）。 */
const TX_LANGUAGE_CODES: Record<number, LangBucket> = {
  0: 'zh',
  1: 'yue',
  3: 'ja',
  4: 'ko',
  5: 'en',
  6: 'other',
  13: 'other',
  16: 'other',
  24: 'other',
}

/**
 * 只有本表列出的码可用：7=中英交替、8=自译解词、11=俄语、12=汉语、15=朝语
 * 实测与内容不符或语义混合，返回 null 让上层继续往下推。
 */
export const mapTxLanguageCode = (code: string | number | null | undefined): LangBucket | null => {
  // 空串/纯空白必须先拦：Number('') === 0，而 0 在码表里是 'zh'，
  // 否则"接口没给语种"会被当成最高可信度的 L1=中文。
  if (typeof code == 'string' && !code.trim()) return null
  const num = typeof code == 'string' ? Number(code) : code
  if (num == null || !Number.isInteger(num)) return null
  return TX_LANGUAGE_CODES[num] ?? null
}

/** 有逐曲语种字段（L1）的源：桶召回优先在它们身上花预算，抓回来的候选语种闭环最准。 */
export const hasTrackLangField = (source: string | undefined) => source == 'kg' || source == 'tx'

/** 按源分派：只有 kg/tx 有逐曲语种字段；其余源没有，落到 L2/L3/L4。 */
export const bucketFromLangField = (
  source: string | undefined,
  lang: string | number | null | undefined,
): LangBucket | null => {
  if (lang == null) return null
  if (source == 'tx') return mapTxLanguageCode(lang)
  if (source == 'kg') return mapKgLanguageWord(String(lang))
  return null
}

const HAN_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/g
const KANA_RE = /[\u3041-\u30ff\u31f0-\u31ff]/g
const HANGUL_RE = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g
const LATIN_RE = /[A-Za-z\u00c0-\u024f]/g
/** 其它有音节的文字：天城 / 希腊 / 西里尔 / 亚美尼亚 / 希伯来 / 阿拉伯 / 泰文 / 老挝-缅甸-高棉 */
/** \u0900 自己是组合符号（Devanagari 反 Virama），排在类首以免 no-misleading-character-class 误报；字符类内顺序不影响匹配 */
const OTHER_LETTER_RE = /[\u0900-\u097f\u0370-\u03ff\u0400-\u04ff\u0530-\u058f\u0590-\u05ff\u0600-\u06ff\u0e00-\u0fff]/g

const countMatches = (text: string, re: RegExp) => {
  const hits = text.match(re)
  return hits ? hits.length : 0
}

/** 只统计"有音节"的字符：数字、空白、中英标点、装饰性符号一律忽略。 */
export const countLangChars = (text: string) => {
  const han = countMatches(text, HAN_RE)
  const kana = countMatches(text, KANA_RE)
  const hangul = countMatches(text, HANGUL_RE)
  const latin = countMatches(text, LATIN_RE)
  const otherLetter = countMatches(text, OTHER_LETTER_RE)
  return { han, kana, hangul, latin, otherLetter, letters: han + kana + hangul + latin + otherLetter }
}

const JA_SHARE = 0.2
const KO_SHARE = 0.2
const ZH_SHARE = 0.5
const OTHER_SHARE = 0.3

/**
 * L4：曲名 + 歌手名合并的字面统计。按 spec §3.1 的边界，本层**不判 en**——
 * 拉丁占比高只可能是欧美原创，也可能是日本/韩国用英文歌名的原创，后者占比很高。
 */
export const bucketFromScript = (name: string, singer = ''): LangBucket | null => {
  const { han, kana, hangul, latin, otherLetter, letters } = countLangChars(`${name} ${singer}`)
  if (letters <= 0) return null
  if (kana / letters >= JA_SHARE) return 'ja'
  if (hangul / letters >= KO_SHARE) return 'ko'
  if (han / letters >= ZH_SHARE) return 'zh'
  if (otherLetter / letters >= OTHER_SHARE) return 'other'
  // 纯拉丁、或汉字/片假名不足以定型的混合标题：交回调用方落 unknown
  void latin
  return null
}

const INSTR_NAME_RE = /(纯音乐|伴奏|无人声|instrumental|\binst\b\.?|piano version)/i

/** 歌词里的粤语虚词。汉字统计本身分不开 zh/yue，这几个字是可靠的方言信号。 */
const YUE_MARKER_RE = /[嘅唔冇俾佢哋嚟咗乜嗰咪]/g
const YUE_MARKER_MIN = 2

/** 歌词元数据行（作词/作曲/LRC 头部），进统计前先剔除，否则 "C.Y.Kong" 会把拉丁占比抬高。 */
const LYRIC_META_RE = /^\s*(?:作词|作曲|编曲|制作人|录音|混音|母带|吉他|钢琴|和声|Lyric|Lyrics|Word|Music|Composed|Arranged|Produced|LRC版本)[为:：]/i
const LRC_TAG_RE = /\[[^\]]*\]/g

export const stripLyricNoise = (raw: string): string => {
  return raw
    .split('\n')
    .map(line => line.replace(LRC_TAG_RE, '').trim())
    .filter(line => line && !LYRIC_META_RE.test(line) && !/^[^\w\u4e00-\u9fff]+$/.test(line))
    .join(' ')
}

/**
 * L3 的喂入口：只看歌词正文。歌词拿不到返回 null（不是 instr）；
 * 正文为空只在曲名带显式纯音乐标记时判 instr——"无词=纯音乐"会误伤轻音乐。
 */
export const bucketFromLyric = (lyric: string | null | undefined, name = ''): LangBucket | null => {
  if (lyric == null) return null
  const body = stripLyricNoise(lyric)
  if (!body) return INSTR_NAME_RE.test(name) ? 'instr' : null
  if (countMatches(body, YUE_MARKER_RE) >= YUE_MARKER_MIN) return 'yue'
  const { han, kana, hangul, latin, otherLetter, letters } = countLangChars(body)
  if (letters <= 0) return null
  if (kana / letters >= JA_SHARE) return 'ja'
  if (hangul / letters >= KO_SHARE) return 'ko'
  if (han / letters >= ZH_SHARE) return 'zh'
  if (otherLetter / letters >= OTHER_SHARE) return 'other'
  // 歌词正文里拉丁占绝对多数判 en 是可靠的（spec §3.1 明确放开这一条）
  if (latin / letters >= 0.8) return 'en'
  return null
}

export type ArtistLangSource = 'lyric' | 'field' | 'relation'

/**
 * 强度：曲内语言表（歌词）< 接口语种字段 < MusicBrainz 关系链。
 * relation 是歌手级权威标签（mandopop/cantopop/j-pop 等），比单曲字段更能代表歌手整体。
 */
const ARTIST_LANG_STRENGTH: Record<ArtistLangSource, number> = {
  lyric: 1,
  field: 2,
  relation: 3,
}

export interface ArtistLangEntry {
  bucket: LangBucket
  hits: number
  strength: number
  updatedAt: number
}

export type ArtistLangTable = Record<string, ArtistLangEntry>

/**
 * 歌手语言表就地合并（表由 artistLanguageStore 持有，本函数不碰存储）：
 * 高强度直接覆盖；同强度用 hits 做计数器投票（反向票递减，减到负再换桶），
 * 低强度忽略。unknown 与 instr 都不入库（原因见函数体内的注释）。超容量淘汰 hits 最低、最旧的一条。
 */
export const updateArtistLangTable = (
  table: ArtistLangTable,
  artists: readonly string[],
  bucket: LangBucket | null,
  source: ArtistLangSource,
  limit = 500,
  now = Date.now(),
): void => {
  // instr 是"单首曲"的属性，不是歌手的：几首伴奏就把歌手钉成 instr，
  // 会让他的真唱曲目在 L3 拿到 instr，而 instr 不在配额桶里 => 整首逃出语种硬约束。
  if (!bucket || bucket == 'unknown' || bucket == 'instr') return
  const strength = ARTIST_LANG_STRENGTH[source]
  for (const rawKey of artists) {
    const key = typeof rawKey == 'string' ? rawKey.trim() : ''
    if (!key) continue
    const prev = table[key]
    // 表是从磁盘读回来的，编译器管不到单条目。缺 strength 会让上下两次比较同时 NaN-false，
    // 永远落在"同强度"分支、两个出口又都只 {...prev} 原样铺开——连一次 field 观测都救不回来；
    // 缺 hits 会把 NaN 一路写下去（存盘成 null），淘汰排序还把 NaN 当"跟谁都相等"，
    // 让正常的低 hits 条目被垃圾条目挤掉。就地补成数字：脏条目按"最弱证据"重生，
    // 两个音源强度都 > 0（lyric 1 / field 2），所以下一次观测必然覆盖它。
    if (prev) {
      if (!Number.isFinite(prev.hits)) prev.hits = 0
      if (!Number.isFinite(prev.strength)) prev.strength = 0
    }
    if (!prev) {
      table[key] = { bucket, hits: 1, strength, updatedAt: now }
      continue
    }
    if (strength > prev.strength) {
      table[key] = { bucket, hits: 1, strength, updatedAt: now }
      continue
    }
    if (strength < prev.strength) continue
    if (bucket == prev.bucket) {
      table[key] = { ...prev, hits: prev.hits + 1, updatedAt: now }
      continue
    }
    const hits = prev.hits - 1
    table[key] = hits < 0
      ? { bucket, hits: 1, strength, updatedAt: now }
      : { ...prev, hits, updatedAt: now }
  }
  const keys = Object.keys(table)
  if (keys.length <= limit) return
  keys.sort((a, b) => {
    if (table[a].hits != table[b].hits) return table[a].hits - table[b].hits
    return table[a].updatedAt - table[b].updatedAt
  })
  for (const key of keys.slice(0, keys.length - limit)) delete table[key]
}

export interface LangResolveInput {
  source?: string
  langField?: string | number | null
  name?: string
  singer?: string
  /** L2：候选来源语种桶的批次提示。 */
  langHint?: LangBucket | null
  /** L3 查表用的歌手键（归一化后的 artistKeys）。 */
  artistKeys?: readonly string[]
}

/**
 * 四级链：L1 接口逐曲字段 > L2 桶召回提示 > L3 歌手语言表 > L4 字面统计。
 * level=0 表示落到 unknown（走自由名额，不参与硬约束）。
 */
export const resolveLang = (
  input: LangResolveInput,
  table?: ArtistLangTable,
): { bucket: LangBucket, level: 1 | 2 | 3 | 4 | 0 } => {
  const l1 = bucketFromLangField(input.source, input.langField)
  if (l1) return { bucket: l1, level: 1 }
  if (input.langHint && input.langHint != 'unknown') return { bucket: input.langHint, level: 2 }
  if (table) {
    for (const artist of input.artistKeys ?? []) {
      // 表是从磁盘读回来的，编译器管不到单条目：缺 bucket、bucket 不是合法桶名、
      // 甚至整条目是个字符串都可能发生。不加这层形状校验，脏条目会返回
      // { bucket: undefined, level: 3 }——既短路了本还能救回来的 L4 字面统计，
      // 又把 "undefined" 投进 poolStats.byLang / langLevels 日志里。
      // 校验不过就当作"这个歌手没记录"，继续往下级走。
      const bucket = table[artist]?.bucket
      if (bucket && bucket != 'unknown' && LANG_BUCKETS.includes(bucket)) return { bucket, level: 3 }
    }
  }
  const l4 = bucketFromScript(input.name ?? '', input.singer ?? '')
  if (l4) return { bucket: l4, level: 4 }
  return { bucket: 'unknown', level: 0 }
}
