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

export const createGuard = (opts: { maxPerDay: number, storage: GuardStorage, now: () => number }) => {
  const read = async(): Promise<GuardState> => {
    let raw: string | null = null
    try {
      raw = await opts.storage.get()
    } catch {
      return emptyState(localDay(opts.now()))
    }
    if (!raw) return emptyState(localDay(opts.now()))
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return emptyState(localDay(opts.now()))
    }
    const state = parsed as Partial<GuardState>
    return {
      day: typeof state.day == 'string' ? state.day : localDay(opts.now()),
      count: typeof state.count == 'number' ? state.count : 0,
      fails: typeof state.fails == 'number' ? state.fails : 0,
      blockedUntil: typeof state.blockedUntil == 'number' ? state.blockedUntil : 0,
    }
  }

  return {
    async check(): Promise<GuardResult> {
      const state = await read()
      if (state.day != localDay(opts.now())) return 'allow'
      if (state.count >= opts.maxPerDay) return 'daily'
      if (state.blockedUntil > opts.now()) return 'cooldown'
      return 'allow'
    },
    async onAttempt(): Promise<void> {
      const state = await read()
      state.day = localDay(opts.now())
      if (state.count >= opts.maxPerDay) return
      state.count += 1
      await opts.storage.set(JSON.stringify(state))
    },
    async onSuccess(): Promise<void> {
      const state = await read()
      state.fails = 0
      state.blockedUntil = 0
      await opts.storage.set(JSON.stringify(state))
    },
    async onFailure(): Promise<void> {
      const state = await read()
      const wait = BACKOFF_MS[Math.min(state.fails, BACKOFF_MS.length - 1)]
      state.fails += 1
      state.blockedUntil = opts.now() + wait
      await opts.storage.set(JSON.stringify(state))
    },
  }
}
