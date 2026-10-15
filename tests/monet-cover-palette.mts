import test from 'node:test'
import assert from 'node:assert/strict'

import { NEGATIVE_TTL_MS, PIXEL_LIMIT, TEXTURE_LIMIT, createCoverPalette } from '../src/utils/monet/coverPalette.ts'
import { ON_COVER_FONT_CSS, SCRIM_MAX, SCRIM_MIN } from '../src/utils/monet/surface.ts'
import type { CoverPixels } from '../src/utils/monet/sourceColor.ts'
import { TEXTURE_OUT_HEIGHT, type TextureRequest } from '../src/utils/monet/texture.ts'
const GRAY = 0xFF808080
const RED = 0xFFCC2222
const LIGHT_FONT = 'rgb(33, 33, 33)'
const DARK_FONT = 'rgb(229, 229, 229)'
const TEXTURE = async() => 'data:image/png;base64,AAAA'
const pixels = (argb: number, n = 1000) => ({ pixels: new Array(n).fill(argb >>> 0), width: 40, height: Math.max(1, Math.round(n / 40)) })

test('正常路径：返回亮主题高 tone 底色 + 合法 scrim', async() => {
  const { getCoverSurface } = createCoverPalette(async() => pixels(RED), TEXTURE)
  const surface = await getCoverSurface('https://example.com/a.jpg', LIGHT_FONT)
  assert.ok(surface)
  assert.ok(surface!.scrimAlpha >= SCRIM_MIN && surface!.scrimAlpha <= SCRIM_MAX)
  assert.match(surface!.base, /^rgb\(\d+, \d+, \d+\)$/)
})

test('同一 URL 只取一次像素，暗/亮主题各自算色不互相污染', async() => {
  let calls = 0
  const { getCoverSurface } = createCoverPalette(async() => {
    calls += 1
    return pixels(RED)
  }, TEXTURE)
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
  }, TEXTURE)
  const [a, b, c] = await Promise.all([
    getCoverSurface('https://example.com/same.jpg', LIGHT_FONT),
    getCoverSurface('https://example.com/same.jpg', LIGHT_FONT),
    getCoverSurface('https://example.com/same.jpg', DARK_FONT),
  ])
  assert.equal(calls, 1)
  assert.ok(a && b && c)
})

test('取色失败（null 像素）→ 返回 null 且被缓存，窗口内不再反复重试', async() => {
  let calls = 0
  const { getCoverSurface } = createCoverPalette(async() => {
    calls += 1
    return null
  }, TEXTURE)
  assert.equal(await getCoverSurface('https://example.com/bad.jpg', LIGHT_FONT), null)
  assert.equal(await getCoverSurface('https://example.com/bad.jpg', LIGHT_FONT), null)
  assert.equal(calls, 1)
})

// 2026-10-15 真机缺陷：上面那条"失败也缓存"没有期限，于是原生一次瞬时超时（移动网络下很常见）
// 就让这首歌整场会话不上色，用户唯一的出口是去设置里翻"动态背景"开关。
// 现在失败只压一个冷却窗口：窗口内不重复问（第 4 条用例钉的仍是这件事），过窗后必须能自愈。
test('失败只在冷却窗口内压住，不永久封杀', async() => {
  let calls = 0
  let now = 0
  const { getCoverSurface } = createCoverPalette(async() => {
    calls += 1
    return null
  }, TEXTURE, () => now)
  assert.equal(await getCoverSurface('https://example.com/bad.jpg', LIGHT_FONT), null)
  now = NEGATIVE_TTL_MS - 1
  assert.equal(await getCoverSurface('https://example.com/bad.jpg', LIGHT_FONT), null)
  assert.equal(calls, 1)
})

test('过冷却窗口再要同一张封面：重新问原生，并且这次拿得到真色（自愈）', async() => {
  let calls = 0
  let now = 0
  const { getCoverSurface } = createCoverPalette(async() => {
    calls += 1
    // 第一次模拟瞬时失败，第二次网络恢复
    return calls === 1 ? null : pixels(RED)
  }, TEXTURE, () => now)
  assert.equal(await getCoverSurface('https://example.com/flaky.jpg', LIGHT_FONT), null)
  now = NEGATIVE_TTL_MS
  const healed = await getCoverSurface('https://example.com/flaky.jpg', LIGHT_FONT)
  assert.equal(calls, 2)
  assert.ok(healed, '网络恢复后必须能自己上色，不该等用户翻开关')
  assert.match(healed!.base, /^rgb\(\d+, \d+, \d+\)$/)
})

test('空 url / 非法字体色直接 null，不碰原生', async() => {
  let called = false
  const { getCoverSurface } = createCoverPalette(async() => {
    called = true
    return pixels(GRAY)
  }, TEXTURE)
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
  }, TEXTURE)
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
  }, TEXTURE)
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
  }, TEXTURE)
  await getCoverSurface('https://example.com/a.jpg', LIGHT_FONT)
  clearCache()
  await getCoverSurface('https://example.com/a.jpg', LIGHT_FONT)
  assert.equal(calls, 2)
})

test('配色层命中缓存时返回同一个对象（钉住读写 key 同源与缓存写入）', async() => {
  const { getCoverSurface } = createCoverPalette(async() => pixels(RED), TEXTURE)
  const a1 = await getCoverSurface('https://example.com/k.jpg', LIGHT_FONT)
  const a2 = await getCoverSurface('https://example.com/k.jpg', LIGHT_FONT)
  assert.ok(a1)
  assert.equal(a2, a1)
})

test('并发两次调用合并成同一个结果对象（钉住 pending 去重）', async() => {
  const { getCoverSurface } = createCoverPalette(async() => pixels(RED), TEXTURE)
  const [a, b] = await Promise.all([
    getCoverSurface('https://example.com/p.jpg', LIGHT_FONT),
    getCoverSurface('https://example.com/p.jpg', LIGHT_FONT),
  ])
  assert.ok(a)
  assert.equal(b, a)
})

test('clearCache 打在途请求上：旧判定不写回，下一次调用重新问原生', async() => {
  let release: (v: CoverPixels | null) => void = () => {}
  let autoFail = false
  let calls = 0
  const { getCoverSurface, clearCache } = createCoverPalette(() => {
    calls += 1
    if (autoFail) return Promise.resolve(null)
    return new Promise<CoverPixels | null>(resolve => { release = resolve })
  }, TEXTURE)
  const first = getCoverSurface('https://example.com/r.jpg', LIGHT_FONT)
  clearCache()
  release(null)
  assert.equal(await first, null)
  assert.equal(calls, 1)
  autoFail = true
  assert.equal(await getCoverSurface('https://example.com/r.jpg', LIGHT_FONT), null)
  assert.equal(calls, 2)
})

test('像素几何不自洽（长度 != 宽×高）当取色失败，并且失败照样进缓存', async() => {
  let calls = 0
  const { getCoverSurface } = createCoverPalette(async() => {
    calls += 1
    return { pixels: new Array(999).fill(0xFF808080), width: 40, height: 25 }
  }, TEXTURE)
  assert.equal(await getCoverSurface('https://example.com/skew.jpg', LIGHT_FONT), null)
  assert.equal(await getCoverSurface('https://example.com/skew.jpg', LIGHT_FONT), null)
  assert.equal(calls, 1)
})

test('宽或高小于 1 的像素当取色失败', async() => {
  let calls = 0
  const { getCoverSurface } = createCoverPalette(async() => {
    calls += 1
    return { pixels: [0xFF808080], width: 0, height: 0 }
  }, TEXTURE)
  assert.equal(await getCoverSurface('https://example.com/zero.jpg', LIGHT_FONT), null)
  assert.equal(await getCoverSurface('https://example.com/zero.jpg', LIGHT_FONT), null)
  assert.equal(calls, 1)
})

test('纹理按 url|font|outWidth 缓存：同一首歌重复要只生成一次', async() => {
  let builds = 0
  const { getCoverTexture } = createCoverPalette(async() => pixels(RED), async() => {
    builds += 1
    return 'data:image/png;base64,AAAA'
  })
  await getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 132)
  await getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 132)
  assert.equal(builds, 1)
})

test('纹理生成器收到的是同一次配色的色阶带和固定高度', async() => {
  const seen: TextureRequest[] = []
  const { getCoverSurface, getCoverTexture } = createCoverPalette(async() => pixels(RED), async request => {
    seen.push(request)
    return 'data:image/png;base64,AAAA'
  })
  const surface = await getCoverSurface('https://example.com/a.jpg', LIGHT_FONT)
  await getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 132)
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0].band, surface!.band)
  assert.equal(seen[0].outWidth, 132)
  assert.equal(seen[0].outHeight, TEXTURE_OUT_HEIGHT)
  assert.equal(seen[0].source.width, 40)
})

test('并发要纹理只生成一次（in-flight 合并）', async() => {
  let builds = 0
  const { getCoverTexture } = createCoverPalette(async() => pixels(RED), async() => {
    builds += 1
    await new Promise(resolve => setTimeout(resolve, 10))
    return 'data:image/png;base64,AAAA'
  })
  const [a, b] = await Promise.all([
    getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 132),
    getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 132),
  ])
  assert.equal(builds, 1)
  assert.equal(a, b)
})

test('输出宽度不同就是两张图，不能复用（折叠屏展开、分屏）', async() => {
  let builds = 0
  const { getCoverTexture } = createCoverPalette(async() => pixels(RED), async() => {
    builds += 1
    return `data:image/png;base64,${builds}`
  })
  const wide = await getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 132)
  const narrow = await getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 100)
  assert.equal(builds, 2)
  assert.notEqual(wide, narrow)
})

// 两支都能算出色阶带的字色：带不同 → 纹理各自一张。
// 注意这里不能用 DARK_FONT（内置暗主题那支中灰字色）：它的带现在是 null，
// 纹理支会在闸门处直接不生成（这是纯色方案恢复后的既定行为，见 monet-surface 的"带塌了也不牵连纯色背景"）。
test('两种字色各自一张：带变了纹理就不能共用', async() => {
  let builds = 0
  const { getCoverTexture } = createCoverPalette(async() => pixels(RED), async() => {
    builds += 1
    return `data:image/png;base64,${builds}`
  })
  await getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 132)
  await getCoverTexture('https://example.com/a.jpg', ON_COVER_FONT_CSS, 132)
  assert.equal(builds, 2)
})

test('字色的带塌了（内置暗主题那支中灰墨）：纯色底照旧，纹理一支都不生成', async() => {
  let builds = 0
  let pixelsCalls = 0
  const { getCoverTexture, getCoverSurface } = createCoverPalette(async() => {
    pixelsCalls += 1
    return pixels(RED)
  }, async() => {
    builds += 1
    return 'data:image/png;base64,AAAA'
  })
  const surface = await getCoverSurface('https://example.com/a.jpg', DARK_FONT)
  assert.ok(surface != null && surface.band == null)
  assert.equal(await getCoverTexture('https://example.com/a.jpg', DARK_FONT, 132), null)
  assert.equal(builds, 0)
  // 像素按 url 只问原生一次：纹理支那一路命中 pixelCache（连 fetchPixels 都不该重跑，更不该重下封面）
  assert.equal(pixelsCalls, 1)
})

test('取色失败时绝不跑纹理生成', async() => {
  let builds = 0
  const { getCoverTexture } = createCoverPalette(async() => null, async() => {
    builds += 1
    return 'data:image/png;base64,AAAA'
  })
  assert.equal(await getCoverTexture('https://example.com/bad.jpg', LIGHT_FONT, 132), null)
  assert.equal(builds, 0)
})

test('非法输出宽度（屏幕尺寸还没量出来时的 0 / NaN）直接 null，不碰生成器', async() => {
  let builds = 0
  const { getCoverTexture } = createCoverPalette(async() => pixels(RED), async() => {
    builds += 1
    return 'data:image/png;base64,AAAA'
  })
  for (const w of [0, -1, NaN, 13.5, Infinity]) {
    assert.equal(await getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, w), null)
  }
  assert.equal(await getCoverTexture('', LIGHT_FONT, 132), null)
  assert.equal(await getCoverTexture('https://example.com/a.jpg', '#333', 132), null)
  assert.equal(builds, 0)
})

test('生成抛错当失败处理并缓存住，不再反复重算', async() => {
  let builds = 0
  const { getCoverTexture } = createCoverPalette(async() => pixels(RED), async() => {
    builds += 1
    throw new Error('encode failed')
  })
  assert.equal(await getCoverTexture('https://example.com/x.jpg', LIGHT_FONT, 132), null)
  assert.equal(await getCoverTexture('https://example.com/x.jpg', LIGHT_FONT, 132), null)
  assert.equal(builds, 1)
})

test('clearCache 之后纹理重新生成（翻开关是取色失败唯一的出口）', async() => {
  let builds = 0
  const { getCoverTexture, clearCache } = createCoverPalette(async() => pixels(RED), async() => {
    builds += 1
    return 'data:image/png;base64,AAAA'
  })
  await getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 132)
  clearCache()
  await getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 132)
  assert.equal(builds, 2)
})

test('clearCache 之后才到达的旧纹理结果不写回缓存（代数判据，和配色层同一套）', async() => {
  let builds = 0
  // 先把"晚到"的那个 promise 造好：生成器要等配色与像素两次 await 之后才被调用，
  // 若 release 在生成器里才赋值，同步调 release 时它还是空函数，用例会挂死。
  let release: (v: string) => void = () => {}
  const late = new Promise<string>(resolve => {
    release = resolve
  })
  const { getCoverTexture, clearCache } = createCoverPalette(async() => pixels(RED), async() => {
    builds += 1
    return builds === 1 ? late : 'data:image/png;base64,FRESH'
  })
  const inFlight = getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 132)
  clearCache()
  release('data:image/png;base64,LATE')
  await inFlight
  assert.equal(await getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 132), 'data:image/png;base64,FRESH')
  assert.equal(builds, 2)
})

// 误摘时第三次调用会开一条永不放行的生成，用例只会挂住；给超时让它红而不是卡死整个 npm test
test('clearCache 之后旧任务收尾不能把新一代的在途任务摘掉（否则第三次并发会再算一遍）', { timeout: 2000 }, async() => {
  let builds = 0
  const gates: ((v: string) => void)[] = []
  const { getCoverTexture, clearCache } = createCoverPalette(async() => pixels(RED), async() => {
    builds += 1
    return new Promise<string>(resolve => {
      gates.push(resolve)
    })
  })
  const waitBuilds = async(n: number) => {
    while (builds < n) await new Promise(resolve => setImmediate(resolve))
  }
  const old = getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 132)
  await waitBuilds(1)
  clearCache()
  const fresh = getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 132)
  await waitBuilds(2)
  gates[0]('data:image/png;base64,OLD')
  await old
  const joined = getCoverTexture('https://example.com/a.jpg', LIGHT_FONT, 132)
  gates[1]('data:image/png;base64,NEW')
  assert.equal(await fresh, 'data:image/png;base64,NEW')
  assert.equal(await joined, 'data:image/png;base64,NEW')
  assert.equal(builds, 2)
})

test('纹理层有自己更小的上限（一张 data URI 顶得上一条配色的几十倍）', async() => {
  let builds = 0
  const { getCoverTexture } = createCoverPalette(async() => pixels(GRAY), async() => {
    builds += 1
    return `data:image/png;base64,${builds}`
  })
  for (let i = 0; i < TEXTURE_LIMIT + 1; i++) await getCoverTexture(`https://example.com/${i}.jpg`, LIGHT_FONT, 132)
  assert.equal(builds, TEXTURE_LIMIT + 1)
  // 最早那条已被淘汰，重新要会再生成
  await getCoverTexture('https://example.com/0.jpg', LIGHT_FONT, 132)
  assert.equal(builds, TEXTURE_LIMIT + 2)
  // 最后一张还在
  await getCoverTexture(`https://example.com/${TEXTURE_LIMIT}.jpg`, LIGHT_FONT, 132)
  assert.equal(builds, TEXTURE_LIMIT + 2)
})
