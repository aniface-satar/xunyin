import test from 'node:test'
import assert from 'node:assert/strict'

import { createCoverPalette } from '../src/utils/monet/coverPalette.ts'
import type { CoverPixels } from '../src/utils/monet/sourceColor.ts'

// 2×2 全白
const white: CoverPixels = { width: 2, height: 2, pixels: [0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF] }
// 2×2 全黑
const black: CoverPixels = { width: 2, height: 2, pixels: [0xFF000000, 0xFF000000, 0xFF000000, 0xFF000000] }

const build = (pixels: CoverPixels | null, calls: string[]) => createCoverPalette(
  async(url: string) => { calls.push(url); return pixels },
  async() => null,
)

test('returns the average argb of the cover', async() => {
  const calls: string[] = []
  const palette = build(white, calls)
  const avg = await palette.getCoverAverageArgb('http://x/a.jpg')
  assert.equal(calls.length, 1)
  assert.equal(avg, 0xFFFFFFFF)
  assert.equal(avg! >>> 24, 255)
})

test('shares one native fetch with the surface branch', async() => {
  const calls: string[] = []
  const palette = build(white, calls)
  // 只传两个参数：HEAD 的签名就是 (picUrl, fontColor)。工作区那份 WIP 加了第三个可选参数（算法档位），
  // 传了它这笔提交单独 checkout 出来就是 TS2554。
  await palette.getCoverSurface('http://x/b.jpg', 'rgb(255, 255, 255)')
  await palette.getCoverAverageArgb('http://x/b.jpg')
  assert.equal(calls.length, 1, '像素层缓存要能被两个出口共用，否则同一张封面下载两遍')
})

test('the average branch does not need the font colour', async() => {
  const calls: string[] = []
  const palette = build(black, calls)
  const avg = await palette.getCoverAverageArgb('http://x/c.jpg')
  assert.equal(avg, 0xFF000000)
  assert.equal(calls.length, 1)
})

test('null url and null pixels both resolve to null', async() => {
  const calls: string[] = []
  const palette = build(null, calls)
  assert.equal(await palette.getCoverAverageArgb(null), null)
  assert.equal(await palette.getCoverAverageArgb(undefined), null)
  assert.equal(calls.length, 0, '空 url 不该问原生')
  assert.equal(await palette.getCoverAverageArgb('http://x/d.jpg'), null)
})

test('fully transparent cover resolves to null, not NaN', async() => {
  const transparent: CoverPixels = { width: 2, height: 2, pixels: [0, 0, 0, 0] }
  const palette = build(transparent, [])
  assert.equal(await palette.getCoverAverageArgb('http://x/e.png'), null)
})
