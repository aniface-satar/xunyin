import test from 'node:test'
import assert from 'node:assert/strict'

import { PIXEL_LIMIT, createCoverPalette } from '../src/utils/monet/coverPalette.ts'
const GRAY = 0xFF808080
const RED = 0xFFCC2222
const LIGHT_FONT = 'rgb(33, 33, 33)'
const DARK_FONT = 'rgb(229, 229, 229)'
const pixels = (argb: number, n = 1000) => new Array(n).fill(argb >>> 0)

test('正常路径：返回亮主题高 tone 底色 + 合法 scrim', async() => {
  const { getCoverSurface } = createCoverPalette(async() => pixels(RED))
  const surface = await getCoverSurface('https://example.com/a.jpg', LIGHT_FONT)
  assert.ok(surface)
  assert.ok(surface!.scrimAlpha >= 0.45 && surface!.scrimAlpha <= 0.9)
  assert.match(surface!.base, /^rgb\(\d+, \d+, \d+\)$/)
})

test('同一 URL 只取一次像素，暗/亮主题各自算色不互相污染', async() => {
  let calls = 0
  const { getCoverSurface } = createCoverPalette(async() => {
    calls += 1
    return pixels(RED)
  })
  const light = await getCoverSurface('https://example.com/a.jpg', LIGHT_FONT)
  const dark = await getCoverSurface('https://example.com/a.jpg', DARK_FONT)
  assert.equal(calls, 1)
  assert.notEqual(light!.base, dark!.base)
})

test('并发调用合并成一次网络取色', async() => {
  let calls = 0
  const { getCoverSurface } = createCoverPalette(async() => {
    calls += 1
    await new Promise(resolve => setTimeout(resolve, 10))
    return pixels(RED)
  })
  const [a, b, c] = await Promise.all([
    getCoverSurface('https://example.com/same.jpg', LIGHT_FONT),
    getCoverSurface('https://example.com/same.jpg', LIGHT_FONT),
    getCoverSurface('https://example.com/same.jpg', DARK_FONT),
  ])
  assert.equal(calls, 1)
  assert.ok(a && b && c)
})

test('取色失败（null 像素）→ 返回 null 且被缓存，不再反复重试', async() => {
  let calls = 0
  const { getCoverSurface } = createCoverPalette(async() => {
    calls += 1
    return null
  })
  assert.equal(await getCoverSurface('https://example.com/bad.jpg', LIGHT_FONT), null)
  assert.equal(await getCoverSurface('https://example.com/bad.jpg', LIGHT_FONT), null)
  assert.equal(calls, 1)
})

test('空 url / 非法字体色直接 null，不碰原生', async() => {
  let called = false
  const { getCoverSurface } = createCoverPalette(async() => {
    called = true
    return pixels(GRAY)
  })
  assert.equal(await getCoverSurface('', LIGHT_FONT), null)
  assert.equal(await getCoverSurface(null, LIGHT_FONT), null)
  assert.equal(await getCoverSurface('https://example.com/a.jpg', '#333'), null)
  assert.equal(called, false)
})

test('缓存有上限，超出后淘汰最早的 key', async() => {
  let calls = 0
  const { getCoverSurface } = createCoverPalette(async() => {
    calls += 1
    return pixels(GRAY)
  })
  for (let i = 0; i < 70; i++) await getCoverSurface(`https://example.com/${i}.jpg`, LIGHT_FONT)
  assert.equal(calls, 70)
  await getCoverSurface('https://example.com/0.jpg', LIGHT_FONT)
  assert.equal(calls, 71)
})

test('像素层按自己的 PIXEL_LIMIT 淘汰，不跟配色层共用 60', async() => {
  // 探测像素层必须换 font：同一 url + 同一 font 会先命中配色层（cache.has(key) 直接返回），
  // 根本走不到 fetchOnce，那样的话这条用例测的是配色层而不是像素层。换 DARK_FONT 后 surface key 变了、
  // pixel key 没变，才真正问的是"这张封面的像素还在不在缓存里"。
  // 若实现误用 CACHE_LIMIT(60)：21 条不触发淘汰，第二个 assert 就会红（calls 停在 21），所以这条是承重的。
  // fetcher 恒返回 null：失败条目同样占位（第 4 条用例钉的行为），顺带省掉真量化开销。
  let calls = 0
  const { getCoverSurface } = createCoverPalette(async() => {
    calls += 1
    return null
  })
  for (let i = 0; i < PIXEL_LIMIT + 1; i++) await getCoverSurface(`https://example.com/${i}.jpg`, LIGHT_FONT)
  assert.equal(calls, PIXEL_LIMIT + 1)
  await getCoverSurface('https://example.com/0.jpg', DARK_FONT)
  assert.equal(calls, PIXEL_LIMIT + 2)
  await getCoverSurface(`https://example.com/${PIXEL_LIMIT}.jpg`, DARK_FONT)
  assert.equal(calls, PIXEL_LIMIT + 2)
})

test('clearCache 后重新取色', async() => {
  let calls = 0
  const { getCoverSurface, clearCache } = createCoverPalette(async() => {
    calls += 1
    return pixels(GRAY)
  })
  await getCoverSurface('https://example.com/a.jpg', LIGHT_FONT)
  clearCache()
  await getCoverSurface('https://example.com/a.jpg', LIGHT_FONT)
  assert.equal(calls, 2)
})

test('配色层命中缓存时返回同一个对象（钉住读写 key 同源与缓存写入）', async() => {
  const { getCoverSurface } = createCoverPalette(async() => pixels(RED))
  const a1 = await getCoverSurface('https://example.com/k.jpg', LIGHT_FONT)
  const a2 = await getCoverSurface('https://example.com/k.jpg', LIGHT_FONT)
  assert.ok(a1)
  assert.equal(a2, a1)
})

test('并发两次调用合并成同一个结果对象（钉住 pending 去重）', async() => {
  const { getCoverSurface } = createCoverPalette(async() => pixels(RED))
  const [a, b] = await Promise.all([
    getCoverSurface('https://example.com/p.jpg', LIGHT_FONT),
    getCoverSurface('https://example.com/p.jpg', LIGHT_FONT),
  ])
  assert.ok(a)
  assert.equal(b, a)
})

test('clearCache 打在途请求上：旧判定不写回，下一次调用重新问原生', async() => {
  let release: (v: number[] | null) => void = () => {}
  let autoFail = false
  let calls = 0
  const { getCoverSurface, clearCache } = createCoverPalette(() => {
    calls += 1
    if (autoFail) return Promise.resolve(null)
    return new Promise<number[] | null>(resolve => { release = resolve })
  })
  const first = getCoverSurface('https://example.com/r.jpg', LIGHT_FONT)
  clearCache()
  release(null)
  assert.equal(await first, null)
  assert.equal(calls, 1)
  autoFail = true
  assert.equal(await getCoverSurface('https://example.com/r.jpg', LIGHT_FONT), null)
  assert.equal(calls, 2)
})
