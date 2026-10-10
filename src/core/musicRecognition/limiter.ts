export const BACKOFF_MS = [1000, 5000, 30000]

export interface GuardStorage {
  get: () => Promise<string | null>
  set: (value: string) => Promise<void>
}

export type GuardResult = 'allow' | 'daily' | 'cooldown'

interface GuardState {
  day: string
  count: number
  fails: number
  blockedUntil: number
}

// 按本地自然日计数的闸门。计数存储与时钟都走注入，
// 这样跨时区、跨日、退避序列都能在单测里确定性复现。
const localDay = (now: number): string => {
  const date = new Date(now)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const emptyState = (day: string): GuardState => ({ day, count: 0, fails: 0, blockedUntil: 0 })

const asNumber = (value: unknown): number => typeof value == 'number' && Number.isFinite(value) ? value : 0

// storage 里可能是合法 JSON 但不是对象（'null' / '123' / '"abc"' / '[]'），
// 解引用会把 TypeError 抛给识曲流程；这里一律当脏数据处理。
const asRecord = (value: unknown): Record<string, unknown> => {
  return typeof value == 'object' && value != null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

// 读出来的状态永远带上当天的 day：
// - 跨日只清 count（每日预算归零重来），时间型的 fails/blockedUntil 原样保留，
//   否则「昨晚被打爆」的冷却会被一次日历翻页白白抹掉。
// - 写侧（onAttempt/onSuccess/onFailure）因此不可能再把昨天的 day 留在盘上，
//   陈旧记录不会永久卡在旧的一天。
const normalize = (state: Record<string, unknown>, today: string): GuardState => {
  const sameDay = typeof state.day == 'string' && state.day == today
  return {
    day: today,
    count: sameDay ? asNumber(state.count) : 0,
    fails: asNumber(state.fails),
    blockedUntil: asNumber(state.blockedUntil),
  }
}

export const createGuard = (opts: { maxPerDay: number, storage: GuardStorage, now: () => number }) => {
  const read = async(): Promise<GuardState> => {
    const today = localDay(opts.now())
    let raw: string | null = null
    try {
      raw = await opts.storage.get()
    } catch {
      return emptyState(today)
    }
    if (!raw) return emptyState(today)
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return emptyState(today)
    }
    return normalize(asRecord(parsed), today)
  }

  // AsyncStorage 写失败（磁盘满、原生侧抛异常）不能打断识曲流程：
  // 静默降级为「本轮内存里已经算出的判定」，读侧下一样会退回空状态而不是崩。
  const persist = async(state: GuardState): Promise<void> => {
    try {
      await opts.storage.set(JSON.stringify(state))
    } catch {}
  }

  return {
    async check(): Promise<GuardResult> {
      const state = await read()
      // 这里不能再有「day 不是今天就放行」的短路：那会整体跳过冷却判定。
      if (state.count >= opts.maxPerDay) return 'daily'
      if (state.blockedUntil > opts.now()) return 'cooldown'
      return 'allow'
    },
    async onAttempt(): Promise<void> {
      const state = await read()
      if (state.count < opts.maxPerDay) state.count += 1
      // 已达上限也照样写回：count 冻结在上限不再累加，但 day 必须推进到当天。
      // 盘上的记录停在旧一天，等于给任何按 day 判定的读侧逻辑留一颗哑弹。
      await persist(state)
    },
    async onSuccess(): Promise<void> {
      const state = await read()
      state.fails = 0
      state.blockedUntil = 0
      await persist(state)
    },
    async onFailure(): Promise<void> {
      const state = await read()
      const wait = BACKOFF_MS[Math.min(state.fails, BACKOFF_MS.length - 1)]
      state.fails += 1
      state.blockedUntil = opts.now() + wait
      await persist(state)
    },
  }
}
