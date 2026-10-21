// 动态背景的"决策 + 取色"状态收在这一个模块级 store 里。
//
// 为什么不再是每个组件各自 useState：前景色阶（onCoverTheme）和背景层（CoverBackdrop）
// 读的是同一支 surface。两处各存一份就会出现"背景已经换成莫奈底、字还是主题灰"（或反过来）
// 的中间帧 —— 那一帧恰好是可读性最差的瞬间。收成一份之后，两者在同一次 publish 里一起翻。
//
// 决策表本身仍在 backdropGate.ts（那张表能用 node --test 直接跑）；"这张封面问过没有"的账
// 在 attemptLedger.ts（同样能用 node --test 跑）。这个文件带原生桥依赖，单测加载不了，
// 所以不往里加任何判断，只加订阅、在途调度和两条定时器（自愈重试、宽限到期）。
// 两条定时器都不自己决定留哪一层：回调一律重新调 updateCoverBackdrop，让表按"当下"再判一次，
// 于是加在表里的判据不会在这里长出第二个版本。
import { resolveCoverBackdrop, COVER_BACKDROP_GRACE_MS, type CoverBackdropState, type CoverBackdropStale } from './backdropGate'
import { getCoverSurface } from './index'
import { ON_COVER_FONT_CSS, type CoverBackdropMode } from './surface'
import { createAttemptLedger } from './attemptLedger'

const IDLE: CoverBackdropState = { enabled: false, picUrl: null, surface: null, wantsSurface: false }

let state: CoverBackdropState = IDLE
const listeners = new Set<() => void>()
// 每条封面的取色尝试：在途不许并发第二条，失败/被丢弃过则隔 ATTEMPT_COOLDOWN_MS 可以再问。
// 取代老实现的 `requested: string | null`（"问过就算问过"）—— 那个闩把任何一次瞬时失败
// 变成"这首歌整场会话不再上色"，而用户唯一的出口是去设置里翻开关。见 attemptLedger.ts 头注释。
const attempts = createAttemptLedger()
// 在途代数：换歌、翻开关、清缓存都会 ++，晚到的旧结果据此丢弃
let generation = 0
// 最近一次投递的四条输入。取色结果是异步晚到的，回来时要用"当下"的输入重算一遍状态，
// 而不是拿旧 state 拼一份 —— 拼出来的那份会绕过决策表对 picUrl 的判定。
// algo 也要记下来：② 会在"还没有测量色"的时候就铺一层保守底，重试与宽限那两条定时器
// 回调时若按旧档位重算，表和 hook 就会对"屏上到底该不该有层"给出两个答案。
let inputs = { dynamicBg: false, hasThemeBgImage: false, pic: null as string | null, algo: 'monet' as CoverBackdropMode }
let retryTimer: ReturnType<typeof setTimeout> | null = null

const clearRetry = () => {
  if (retryTimer != null) clearTimeout(retryTimer)
  retryTimer = null
}

// 换到当前这首歌的时刻（ms）。宽限期从它起算，判据由表算，这里只管时钟。
let switchedAt = 0
let graceTimer: ReturnType<typeof setTimeout> | null = null

const clearGrace = () => {
  if (graceTimer != null) clearTimeout(graceTimer)
  graceTimer = null
}

export const getCoverBackdropState = () => state

export const subscribeCoverBackdrop = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const publish = (next: CoverBackdropState) => {
  // 判据是 isSame 而不是"引用相等"：resolveCoverBackdrop 每次都产出新的包装对象，比引用等于必刷。
  // 这在加了在途期限之后尤其要命 —— 同一个 url 可能被重问两次，同一条 promise 的两个 .then
  // 会各自 resolve 出一份字段完全相同的状态，那份多余的就是白刷一遍订阅子树。
  // isSame 里 surface 仍按引用比（同一份色不该判成变化），所以它比引用相等更严、不比逐字段更松。
  if (isSame(next, state)) return
  state = next
  for (const listener of listeners) listener()
}

const isSame = (a: CoverBackdropState, b: CoverBackdropState) =>
  a.enabled === b.enabled && a.picUrl === b.picUrl && a.surface === b.surface && a.wantsSurface === b.wantsSurface

/** 收尾一条尝试：先销账，再用"当下"的四条输入重跑一遍。
 *  成功时 wantsSurface 已经变假，这一跑只是把状态确认一遍；失败/被丢弃时它仍然是真，
 *  于是这里会替下一次尝试把定时器挂上 —— 自愈的入口就在这。 */
const settle = (picUrl: string) => {
  attempts.end(picUrl)
  if (inputs.pic === picUrl) updateCoverBackdrop(inputs.dynamicBg, inputs.hasThemeBgImage, picUrl, inputs.algo)
}

const request = (picUrl: string) => {
  attempts.begin(picUrl, Date.now())
  const my = generation
  void getCoverSurface(picUrl, ON_COVER_FONT_CSS).then(surface => {
    if (surface != null && my === generation && inputs.pic === picUrl && state.enabled) {
      // 三条守卫：还是当代、还是当前这首歌、功能还开着。
      // 判据用 inputs.pic 而不是 state.picUrl：后者可能是保守底那一格（② 在测量色到手之前就有 picUrl），
      // 也可能是上一首留着的层 —— 它说的不是"这次请求是为哪张封面发的"。
      publish(resolveCoverBackdrop(inputs.dynamicBg, inputs.hasThemeBgImage, picUrl, surface, inputs.algo))
    }
    settle(picUrl)
  }, () => {
    // 原生桥 reject 也要收尾：不销账的话这条 url 会永远停在"在途"，比老的 requested 闩更糟
    settle(picUrl)
  })
}

/** 该不该为这张封面去要一份色，以及要不到的话什么时候再试。
 *  与 publish 分家是有原因的：下面 updateCoverBackdrop 里 isSame 早退时，
 *  老实现把触发一起跳过了 —— 于是"手里没色、状态又没变"的那种情况永远不再开口。
 *  代价要说明白：老实现是"失败一次就整会话不再问"，现在换成"每过一个冷却窗口重问一次"。
 *  一张真坏的封面在被听的时候会被每 ~15s 问一次（一条几十 KB 的图请求，原生 4s 超时），
 *  这是"失败会自己好"必须付的；翻开关仍然是有用的手动出口 —— 它立刻清账，不等窗口。 */
const arm = (url: string | null, next: CoverBackdropState) => {
  clearRetry()
  if (url == null || !next.wantsSurface) return
  const now = Date.now()
  const verdict = attempts.want(url, now)
  if (verdict === 'request') {
    request(url)
    return
  }
  // 两种"现在不能问"都要挂表，判据分别是账本里那两条时间轴的剩余时间：
  // 'cooldown' —— 到点才有机会把"该取色却手里没色"重新决定一遍（自愈就靠这一次）。
  // 'in-flight' —— 不能只等那条请求收尾：它可能永不 settle（原生是单线程 executor，
  //   HttpURLConnection 的 4s 是每次 read 的超时不是总时长，慢速服务器能把这条线程占死），
  //   等它就等于把"永久闩"换个地方重写一遍。到在途期限时重新问一次：
  //   配色层按 url 合并 promise，这次重问只是读到同一条在途缓存，不会往原生队列里压第二条。
  const wait = verdict === 'in-flight' ? attempts.inflightLeft(url, now) : attempts.cooldownLeft(url, now)
  retryTimer = setTimeout(() => {
    retryTimer = null
    if (inputs.pic === url) updateCoverBackdrop(inputs.dynamicBg, inputs.hasThemeBgImage, url, inputs.algo)
  }, wait)
}

/**
 * 组件把四条输入（开关、主题是否自带背景图、当前封面、哪一档取色）交进来，这里负责发布结果并按需发一次取色。
 * algo 由调用方归一后再传（useCoverSurface 走 normalizeCoverAlgo）：这张表只认 'monet' | 'blur' 两个值，
 * 旧存储里的「native」之类的脏值不该在这张表里另长出一套解释。
 * 幂等：输入没变时不会 publish，所以 effect 里每次 render 都调也安全。
 */
export function updateCoverBackdrop(dynamicBg: boolean, hasThemeBgImage: boolean,
  pic: string | null | undefined, algo: CoverBackdropMode) {
  const url = pic ?? null
  if (url !== inputs.pic) switchedAt = Date.now()
  inputs = { dynamicBg, hasThemeBgImage, pic: url, algo }
  // 手里那份色只在该它属于这张封面时才交进去：换歌瞬间不交，决策表就把它判成"还没有色"，
  // 既不拿上一张的底色铺新一张，又立刻为新那张发一次取色。
  const held = url != null && url === state.picUrl ? state.surface : null
  // 与 held 相对的另一条读法：屏幕上正在铺的那一支（可能属于上一首），它是宽限期的素材。
  const stale: CoverBackdropStale | null = state.picUrl != null && state.surface != null
    ? { picUrl: state.picUrl, surface: state.surface }
    : null
  const now = Date.now()
  const next = resolveCoverBackdrop(dynamicBg, hasThemeBgImage, url, held, algo, stale, now - switchedAt < COVER_BACKDROP_GRACE_MS)
  if (!isSame(next, state)) publish(next)
  arm(url, next)
  // 铺着的还是别的那一首 → 到点必须自己再算一次，否则旧色会永远挂在新一首上（spec §4.6-4）。
  clearGrace()
  if (next.picUrl != null && next.picUrl !== url) {
    graceTimer = setTimeout(() => {
      graceTimer = null
      if (inputs.pic === url) updateCoverBackdrop(inputs.dynamicBg, inputs.hasThemeBgImage, url, inputs.algo)
    }, Math.max(0, COVER_BACKDROP_GRACE_MS - (now - switchedAt)))
  }
}

/** 「动态背景」开关翻动时的配套清理：与 clearCoverPaletteCache() 成对调用。 */
export function resetCoverBackdrop() {
  generation += 1
  clearRetry()
  clearGrace()
  switchedAt = 0
  attempts.reset()
  inputs = { dynamicBg: false, hasThemeBgImage: false, pic: null, algo: 'monet' }
  publish(IDLE)
}

/** 供 push 原生屏时同步取一次色（原生栏选项不走 context，只能在 push 那一刻读现成的值） */
export const peekCoverBackdrop = (): CoverBackdropState => state
