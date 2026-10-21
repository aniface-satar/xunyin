export const BACKOFF_MS = [1000, 5000, 30000]

export interface GuardStorage {
  get: () => Promise<string | null>
  set: (value: string) => Promise<void>
}

export type GuardResult = 'allow' | 'cooldown'

interface GuardState {
  fails: number
  blockedUntil: number
}

const emptyState = (): GuardState => ({ fails: 0, blockedUntil: 0 })

const asNumber = (value: unknown): number => typeof value == 'number' && Number.isFinite(value) ? value : 0

// storage 里可能是合法 JSON 但不是对象（'null' / '123' / '"abc"' / '[]'），
// 解引用会把 TypeError 抛给识曲流程；这里一律当脏数据处理。
const asRecord = (value: unknown): Record<string, unknown> => {
  return typeof value == 'object' && value != null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

// 这里刻意没有「每天 N 次」的计数闸门（2026-10-11 用户裁定取消）：
// 每日额度本质就是一种会过期的额度，与「永久免费」这条硬约束直接冲突。
// 顶住「用户量涨了不能崩」的是另外两道：连续失败的 BACKOFF_MS 退避，
// 以及运营侧的远端开关（remoteConfig）。所以本模块只剩时间型的冷却状态。
// 旧记录里残留的 day/count 字段被当作脏数据忽略，不需要迁移。
export const createGuard = (opts: { storage: GuardStorage, now: () => number }) => {
  const read = async(): Promise<GuardState> => {
    let raw: string | null = null
    try {
      raw = await opts.storage.get()
    } catch {
      return emptyState()
    }
    if (!raw) return emptyState()
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return emptyState()
    }
    const state = asRecord(parsed)
    return { fails: asNumber(state.fails), blockedUntil: asNumber(state.blockedUntil) }
  }

  // AsyncStorage 写失败（磁盘满、原生侧抛异常）不能打断识曲流程：
  // 静默降级为「本轮不记账」，读侧下一样会退回空状态而不是崩。
  const persist = async(state: GuardState): Promise<void> => {
    try {
      await opts.storage.set(JSON.stringify(state))
    } catch {}
  }

  return {
    async check(): Promise<GuardResult> {
      const state = await read()
      return state.blockedUntil > opts.now() ? 'cooldown' : 'allow'
    },
    async onSuccess(): Promise<void> {
      await persist(emptyState())
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
