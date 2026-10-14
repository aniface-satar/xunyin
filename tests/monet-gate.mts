import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveCoverBackdrop } from '../src/utils/monet/backdropGate.ts'

const SURFACE = { base: 'rgb(240, 244, 249)', scrimAlpha: 0.45, band: { lo: 72, hi: 100 } }
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

test('纹理跟着 surface 同一个闸门：active 为真才交出去，否则恒 null', () => {
  const on = resolveCoverBackdrop(true, false, PIC, SURFACE, 'data:image/png;base64,AAAA')
  assert.equal(on.texture, 'data:image/png;base64,AAAA')

  // 开关关 / 主题自带背景图 / 没封面 / 没配色：四种 inactive 都不许把纹理漏出去
  const cases: [boolean, boolean, string | null, typeof SURFACE | null][] = [
    [false, false, PIC, SURFACE],
    [true, true, PIC, SURFACE],
    [true, false, null, SURFACE],
    [true, false, PIC, null],
  ]
  for (const [dynamicBg, bgImage, pic, surface] of cases) {
    const s = resolveCoverBackdrop(dynamicBg, bgImage, pic, surface, 'data:image/png;base64,AAAA')
    assert.equal(s.texture, null, `dynamicBg=${dynamicBg} bgImage=${bgImage} pic=${pic} 漏了纹理`)
  }
})

test('不传第五个参数时 texture 为 null（旧调用点行为不变，横屏与旧用例都不受影响）', () => {
  assert.equal(resolveCoverBackdrop(true, false, PIC, SURFACE).texture, null)
})
