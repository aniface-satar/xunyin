import test from 'node:test'
import assert from 'node:assert/strict'

import { coverLayerKey, resolveCoverBackdrop } from '../src/utils/monet/backdropGate.ts'
import { PROVISIONAL_BLUR_SURFACE, type CoverBackdropMode, type CoverSurface } from '../src/utils/monet/surface.ts'

// fieldTone 是必填项（前景墨色的闸门就核在它上面）：手搓夹具漏字段会被 tsc 拒掉，别把它当摆设删。
// mode/provisional 也是必填：决策表现在按"这一支是哪档给的"分岔，夹具漏了就等于测了一条不存在的路径。
// 分台那两个字段同样必填：决策表不管灯在哪一台，但字段缺了 tsc 先红 —— 这是"surface 形状只有一份"的哨兵。
const surfaceOf = (mode: CoverBackdropMode, provisional = false): CoverSurface => ({
  mode,
  provisional,
  base: 'rgb(240, 244, 249)',
  scrimAlpha: 0.55,
  browseScrimAlpha: 0.5,
  stageDimAlpha: 0.1,
  band: { lo: 72, hi: 100 },
  tint: { hue: 250, chroma: 12 },
  fieldTone: 95,
})
const SURFACE = surfaceOf('monet')
const BLUR_SURFACE = surfaceOf('blur')
const PIC = 'https://example.com/a.jpg'

test('开关开 + 主题无背景图 + 封面和配色都有：三个字段原样交出', () => {
  const s = resolveCoverBackdrop(true, false, PIC, SURFACE, 'monet')
  assert.equal(s.enabled, true)
  assert.equal(s.picUrl, PIC)
  assert.equal(s.surface, SURFACE)
})

test('开关关闭：enabled 为假，picUrl 与 surface 都不交出去', () => {
  const s = resolveCoverBackdrop(false, false, PIC, SURFACE, 'monet')
  assert.equal(s.enabled, false)
  assert.equal(s.picUrl, null)
  assert.equal(s.surface, null)
})

test('主题自带背景图时整条封面取色让路（开关开着也一样）', () => {
  const s = resolveCoverBackdrop(true, true, PIC, SURFACE, 'monet')
  assert.equal(s.enabled, false)
  assert.equal(s.picUrl, null)
  assert.equal(s.surface, null)
})

test('切到没有封面的歌：同一帧就把旧配色交回去，不刷一屏旧封面色', () => {
  const s = resolveCoverBackdrop(true, false, null, SURFACE, 'monet')
  assert.equal(s.enabled, true)
  assert.equal(s.picUrl, null)
  assert.equal(s.surface, null)
})

test('空串 pic 不算有封面', () => {
  const s = resolveCoverBackdrop(true, false, '', SURFACE, 'monet')
  assert.equal(s.picUrl, null)
  assert.equal(s.surface, null)
})

test('配色还没算出来、手里也没有旧层：surface 交 null，整层不渲染（有旧层可留时走下面那组宽限用例）', () => {
  const s = resolveCoverBackdrop(true, false, PIC, null, 'monet')
  assert.equal(s.enabled, true)
  assert.equal(s.surface, null)
})

// 这条钉的是"第一次取色发得出去"。picUrl 按设计要等色到手才交（切歌瞬间不能拿上一张的底色铺新一张），
// 而 store 曾经拿 picUrl 非空当取色触发条件 —— 两个条件凑在一起就是死锁：没色 → picUrl 为 null →
// 不请求 → 永远没色。真机上表现为"开关开着但整页纹丝不动"，且因为 picUrl 与 wantsSurface 语义不同，
// 必须各钉各的。
test('picUrl 与 wantsSurface 是两件事：色没到手时前者为 null，后者必须为真（否则请求永远发不出去）', () => {
  const first = resolveCoverBackdrop(true, false, PIC, null, 'monet')
  assert.equal(first.picUrl, null, '色还没到手，背景层不该开')
  assert.equal(first.wantsSurface, true, '该去取色 —— 这一格为假就是死锁')

  // 色到手：同一张封面，picUrl 交出、不再要色
  const ready = resolveCoverBackdrop(true, false, PIC, SURFACE, 'monet')
  assert.equal(ready.picUrl, PIC)
  assert.equal(ready.wantsSurface, false)

  // 三种"不该取色"的情形：开关关着 / 主题自带背景图让路 / 根本没有封面
  assert.equal(resolveCoverBackdrop(false, false, PIC, null, 'monet').wantsSurface, false)
  assert.equal(resolveCoverBackdrop(true, true, PIC, null, 'monet').wantsSurface, false)
  assert.equal(resolveCoverBackdrop(true, false, null, null, 'monet').wantsSurface, false)
  assert.equal(resolveCoverBackdrop(true, false, '', null, 'monet').wantsSurface, false)
})

test('带算不出来（band 为 null）时纯色背景照旧交出，不被纹理支连坐', () => {
  const s = resolveCoverBackdrop(true, false, PIC, { ...SURFACE, band: null }, 'monet')
  assert.equal(s.surface?.band, null)
  assert.equal(s.surface?.base, SURFACE.base)
})

// 下面五条钉的是 spec §4.6 的过渡态。第 1、2 条是「晚到不要闪」这一半，第 2 条同时防死锁：
// 留住旧层不等于关掉取色请求 —— 否则就把 2026-10-15 晚修掉的「时有时无」重写一遍。
// 第 3 条钉「没有封面的歌不给宽限期」，第 4 条钉新色到手立即换，第 5 条钉无旧层可留时不造假。
// 这一整组都是 ① monet 的行为：② 一决定铺这张封面就有保守层可发，用不着留上一首（见 blur 那组）。
const OLD_PIC = 'https://example.com/old.jpg'
const STALE = { picUrl: OLD_PIC, surface: SURFACE }

test('新歌有封面、色还没到手、宽限期内：继续铺旧那一支（含它自己的 picUrl），不是闪回主题底', () => {
  const s = resolveCoverBackdrop(true, false, PIC, null, 'monet', STALE, true)
  assert.equal(s.enabled, true)
  assert.equal(s.picUrl, OLD_PIC, '屏上是"背景还没变过来"，不是整屏纯色')
  assert.equal(s.surface, SURFACE)
  assert.equal(s.wantsSurface, true, '留住旧层不等于关掉取色请求')
})

test('宽限期已过：旧层交回去，底下是主题底（晚到的色仍然会淡进来一次）', () => {
  const s = resolveCoverBackdrop(true, false, PIC, null, 'monet', STALE, false)
  assert.equal(s.picUrl, null)
  assert.equal(s.surface, null)
  assert.equal(s.wantsSurface, true, '过期不等于放弃 —— 冷却重试还要靠这一格为真')
})

test('新歌根本没有封面：不给宽限期，旧层同一帧交回去', () => {
  assert.equal(resolveCoverBackdrop(true, false, null, null, 'monet', STALE, true).picUrl, null)
  assert.equal(resolveCoverBackdrop(true, false, '', null, 'monet', STALE, true).picUrl, null)
})

test('新色到手就立刻换过来，宽限期不再有意义', () => {
  const s = resolveCoverBackdrop(true, false, PIC, SURFACE, 'monet', STALE, true)
  assert.equal(s.picUrl, PIC)
  assert.equal(s.surface, SURFACE)
  assert.equal(s.wantsSurface, false)
})

test('没有旧层可留时（首次进入/上一首本来就没上色）：宽限期不造假出任何层', () => {
  assert.equal(resolveCoverBackdrop(true, false, PIC, null, 'monet', null, true).picUrl, null)
  // 宽限期不许插到"开关关掉"前面：关功能（或被主题背景图让路）时哪怕留着旧层也得交回主题，走退场淡出。
  assert.equal(resolveCoverBackdrop(false, false, PIC, null, 'monet', STALE, true).picUrl, null)
  assert.equal(resolveCoverBackdrop(true, true, PIC, null, 'monet', STALE, true).picUrl, null)
})

// ②「动态取色」（重度模糊封面铺底，spec §10.2"切换加载最短"）：这一档手里没有测量色时
// 发的不是"什么都没有"，是一支全遮的保守底。下面这组钉的是它四条要命的地方。
test('blur 档：色还没到手也立刻铺保守底，并且仍然要继续要测量色', () => {
  const s = resolveCoverBackdrop(true, false, PIC, null, 'blur')
  assert.equal(s.enabled, true)
  assert.equal(s.picUrl, PIC, '②的铺底不等取色 —— 等它就是"切换加载最长"')
  assert.equal(s.surface, PROVISIONAL_BLUR_SURFACE)
  assert.equal(s.wantsSurface, true, '保守底只是占位，测量色到手要把它换掉')
})

test('blur 档：保守底每次交出的是同一个对象引用（store 的 isSame 按引用比色）', () => {
  const a = resolveCoverBackdrop(true, false, PIC, null, 'blur')
  const b = resolveCoverBackdrop(true, false, PIC, null, 'blur')
  assert.equal(a.surface, b.surface, '每帧造一份保守底等于让订阅子树白刷一遍')
  assert.equal(a.surface!.provisional, true)
})

// 这条是"保守底 + held"的合流点：保守底交出去之后 picUrl 已经非空，下一次 store 重算会把
// 那份 provisional 当 held 传回来。要是表在这里把它当成"有色了"，wantsSurface 会翻假、
// 测量请求再也不发，屏幕上永远停在一片深色 —— 也就是 §10.4-2 的"封面浮现"再也不会发生。
test('保守底被当成 held 传回来时：仍然发保守底、仍然要测量色（不许自己把自己判成完成）', () => {
  const s = resolveCoverBackdrop(true, false, PIC, PROVISIONAL_BLUR_SURFACE, 'blur')
  assert.equal(s.surface, PROVISIONAL_BLUR_SURFACE)
  assert.equal(s.wantsSurface, true)
  assert.equal(s.picUrl, PIC)
})

test('blur 档不留在上一首的封面上：宽限期里有旧层也发这一首的保守底', () => {
  const s = resolveCoverBackdrop(true, false, PIC, null, 'blur', STALE, true)
  assert.equal(s.picUrl, PIC, '②停在上一首那张照片上就是 §10.4-4 判不过')
  assert.equal(s.surface, PROVISIONAL_BLUR_SURFACE)
  assert.equal(s.wantsSurface, true)
})

test('blur 档的测量色到手：换成真那一支，不再要色', () => {
  const s = resolveCoverBackdrop(true, false, PIC, BLUR_SURFACE, 'blur')
  assert.equal(s.surface, BLUR_SURFACE)
  assert.equal(s.wantsSurface, false)
})

test('没有封面的歌 / 开关关掉：blur 也不许发保守底（那片深色也是背景层）', () => {
  assert.equal(resolveCoverBackdrop(true, false, null, null, 'blur').picUrl, null)
  assert.equal(resolveCoverBackdrop(true, false, '', null, 'blur').surface, null)
  assert.equal(resolveCoverBackdrop(false, false, PIC, null, 'blur').surface, null)
  assert.equal(resolveCoverBackdrop(true, true, PIC, null, 'blur').surface, null)
})

// 层的身份必须跟着档走：切档走的是 clearCoverPaletteCache() + resetCoverBackdrop()，
// 正常路径下手里不会有别档的色。这条判据是防住"设置被别处改了却没 reset"那一类漏 ——
// 那样屏幕上会出现"② 的档铺着①的染色底"，而两档的锚点与透出量本来就不是一套。
test('别档交出的色不许铺在本档上', () => {
  const monetOnBlur = resolveCoverBackdrop(true, false, PIC, SURFACE, 'blur')
  assert.equal(monetOnBlur.surface, PROVISIONAL_BLUR_SURFACE, 'blur 档不许直接铺 monet 那一支')
  assert.equal(monetOnBlur.wantsSurface, true)

  const blurOnMonet = resolveCoverBackdrop(true, false, PIC, BLUR_SURFACE, 'monet')
  assert.equal(blurOnMonet.surface, null, 'monet 档等不到自己的色就不铺（宽限期另有用例）')
  assert.equal(blurOnMonet.wantsSurface, true)
})

// 上面那条管 held，这条管宽限期里那支旧的：同一道 mode 判据两处都要生效，
// 否则"屏上还留着别档的一层"会变成宽限期专门替它开后门。
test('宽限期留住的那一支也必须是本档给的', () => {
  const s = resolveCoverBackdrop(true, false, PIC, null, 'monet', { picUrl: OLD_PIC, surface: BLUR_SURFACE }, true)
  assert.equal(s.picUrl, null)
  assert.equal(s.surface, null)
  assert.equal(s.wantsSurface, true, '不铺别档的色不等于放弃取色')
})

// 层的身份住在这里而不是组件里，为的就是下面这三条能 node --test（spec §10.3 最后一条）。
// 保守支与测量支是同一张封面的两层：共用一个 key 时保守支先占槽，测量色到了只会把一支
// 已经淡完的旧层重新标记为 show —— 屏幕上永远停在灰底，而且没有任何报错。
test('coverLayerKey：测量支就用封面 url 当身份', () => {
  assert.equal(coverLayerKey(PIC, SURFACE), PIC)
  assert.equal(coverLayerKey(PIC, BLUR_SURFACE), PIC)
})

test('coverLayerKey：同一张封面的保守支必须另占一个槽', () => {
  const provisional = coverLayerKey(PIC, PROVISIONAL_BLUR_SURFACE)
  assert.notEqual(provisional, PIC, '撞了就是测量色再也换不上去')
  assert.ok(provisional.startsWith(PIC), `身份里得带着这张封面（${provisional}）`)
})

test('coverLayerKey：两档的测量支共用封面 url 身份（切档先撤后叠，不靠原地变色）', () => {
  // 切档走的是 clearCoverPaletteCache() + resetCoverBackdrop()：那份状态先把 picUrl 交回 null，
  // 组件让所有槽走退场，再由新档的层重新叠上来。所以同一 url 的两档测量色共用一个身份是刻意的，
  // 不是漏判 —— 组件里没有"读到新 surface 就原地改色"那条路，也不该有。
  assert.equal(coverLayerKey(PIC, SURFACE), coverLayerKey(PIC, BLUR_SURFACE))
  assert.equal(coverLayerKey(OLD_PIC, SURFACE), OLD_PIC)
})

