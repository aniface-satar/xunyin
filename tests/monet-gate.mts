import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveCoverBackdrop } from '../src/utils/monet/backdropGate.ts'

// fieldTone 是必填项（前景墨色的闸门就核在它上面）：手搓夹具漏字段会被 tsc 拒掉，别把它当摆设删。
const SURFACE = { base: 'rgb(240, 244, 249)', scrimAlpha: 0.55, band: { lo: 72, hi: 100 }, tint: { hue: 250, chroma: 12 }, fieldTone: 95 }
const PIC = 'https://example.com/a.jpg'

test('开关开 + 主题无背景图 + 封面和配色都有：三个字段原样交出', () => {
  const s = resolveCoverBackdrop(true, false, PIC, SURFACE)
  assert.equal(s.enabled, true)
  assert.equal(s.picUrl, PIC)
  assert.equal(s.surface, SURFACE)
})

test('开关关闭：enabled 为假，picUrl 与 surface 都不交出去', () => {
  const s = resolveCoverBackdrop(false, false, PIC, SURFACE)
  assert.equal(s.enabled, false)
  assert.equal(s.picUrl, null)
  assert.equal(s.surface, null)
})

test('主题自带背景图时整条封面取色让路（开关开着也一样）', () => {
  const s = resolveCoverBackdrop(true, true, PIC, SURFACE)
  assert.equal(s.enabled, false)
  assert.equal(s.picUrl, null)
  assert.equal(s.surface, null)
})

test('切到没有封面的歌：同一帧就把旧配色交回去，不刷一屏旧封面色', () => {
  const s = resolveCoverBackdrop(true, false, null, SURFACE)
  assert.equal(s.enabled, true)
  assert.equal(s.picUrl, null)
  assert.equal(s.surface, null)
})

test('空串 pic 不算有封面', () => {
  const s = resolveCoverBackdrop(true, false, '', SURFACE)
  assert.equal(s.picUrl, null)
  assert.equal(s.surface, null)
})

test('配色还没算出来、手里也没有旧层：surface 交 null，整层不渲染（有旧层可留时走下面那组宽限用例）', () => {
  const s = resolveCoverBackdrop(true, false, PIC, null)
  assert.equal(s.enabled, true)
  assert.equal(s.surface, null)
})

// 这条钉的是"第一次取色发得出去"。picUrl 按设计要等色到手才交（切歌瞬间不能拿上一张的底色铺新一张），
// 而 store 曾经拿 picUrl 非空当取色触发条件 —— 两个条件凑在一起就是死锁：没色 → picUrl 为 null →
// 不请求 → 永远没色。真机上表现为"开关开着但整页纹丝不动"，且因为 picUrl 与 wantsSurface 语义不同，
// 必须各钉各的。
test('picUrl 与 wantsSurface 是两件事：色没到手时前者为 null，后者必须为真（否则请求永远发不出去）', () => {
  const first = resolveCoverBackdrop(true, false, PIC, null)
  assert.equal(first.picUrl, null, '色还没到手，背景层不该开')
  assert.equal(first.wantsSurface, true, '该去取色 —— 这一格为假就是死锁')

  // 色到手：同一张封面，picUrl 交出、不再要色
  const ready = resolveCoverBackdrop(true, false, PIC, SURFACE)
  assert.equal(ready.picUrl, PIC)
  assert.equal(ready.wantsSurface, false)

  // 三种"不该取色"的情形：开关关着 / 主题自带背景图让路 / 根本没有封面
  assert.equal(resolveCoverBackdrop(false, false, PIC, null).wantsSurface, false)
  assert.equal(resolveCoverBackdrop(true, true, PIC, null).wantsSurface, false)
  assert.equal(resolveCoverBackdrop(true, false, null, null).wantsSurface, false)
  assert.equal(resolveCoverBackdrop(true, false, '', null).wantsSurface, false)
})

test('带算不出来（band 为 null）时纯色背景照旧交出，不被纹理支连坐', () => {
  const s = resolveCoverBackdrop(true, false, PIC, { ...SURFACE, band: null })
  assert.equal(s.surface?.band, null)
  assert.equal(s.surface?.base, SURFACE.base)
})

// 下面五条钉的是 spec §4.6 的过渡态。第 1、2 条是「晚到不要闪」这一半，第 2 条同时防死锁：
// 留住旧层不等于关掉取色请求 —— 否则就把 2026-10-15 晚修掉的「时有时无」重写一遍。
// 第 3 条钉「没有封面的歌不给宽限期」，第 4 条钉新色到手立即换，第 5 条钉无旧层可留时不造假。
const OLD_PIC = 'https://example.com/old.jpg'
const STALE = { picUrl: OLD_PIC, surface: SURFACE }

test('新歌有封面、色还没到手、宽限期内：继续铺旧那一支（含它自己的 picUrl），不是闪回主题底', () => {
  const s = resolveCoverBackdrop(true, false, PIC, null, STALE, true)
  assert.equal(s.enabled, true)
  assert.equal(s.picUrl, OLD_PIC, '屏上是"背景还没变过来"，不是整屏纯色')
  assert.equal(s.surface, SURFACE)
})

test('宽限期已过：旧层交回去，底下是主题底（晚到的色仍然会淡进来一次）', () => {
  const s = resolveCoverBackdrop(true, false, PIC, null, STALE, false)
  assert.equal(s.picUrl, null)
  assert.equal(s.surface, null)
  assert.equal(s.wantsSurface, true, '过期不等于放弃 —— 冷却重试还要靠这一格为真')
})

test('新歌根本没有封面：不给宽限期，旧层同一帧交回去', () => {
  assert.equal(resolveCoverBackdrop(true, false, null, null, STALE, true).picUrl, null)
  assert.equal(resolveCoverBackdrop(true, false, '', null, STALE, true).picUrl, null)
})

test('新色到手就立刻换过来，宽限期不再有意义', () => {
  const s = resolveCoverBackdrop(true, false, PIC, SURFACE, STALE, true)
  assert.equal(s.picUrl, PIC)
  assert.equal(s.surface, SURFACE)
  assert.equal(s.wantsSurface, false)
})

test('没有旧层可留时（首次进入/上一首本来就没上色）：宽限期不造假出任何层', () => {
  assert.equal(resolveCoverBackdrop(true, false, PIC, null, null, true).picUrl, null)
})
