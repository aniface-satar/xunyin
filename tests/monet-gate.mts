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

test('配色还没算出来（含取色失败）：surface 交 null，整层不渲染', () => {
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
