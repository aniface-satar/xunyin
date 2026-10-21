import test from 'node:test'
import assert from 'node:assert/strict'
import { pickCheckTargets, shouldCheck, pickUpdateUrl, pickUpdateUrls, USER_API_UPDATE_CHECK_MODES } from '../src/core/userApiUpdate/schedule.ts'

const DAY = 24 * 60 * 60 * 1000

test('关掉时什么都不查，其它档都至少要有个能查的时机', () => {
  assert.equal(shouldCheck('off', 0, 1_000_000), false)
  for (const mode of USER_API_UPDATE_CHECK_MODES) {
    if (mode == 'off') continue
    assert.equal(shouldCheck(mode, 0, 1_000_000), true, `${mode} 档在从没查过时应当立刻查一次`)
  }
})

test('每次启动档：只要启动就查，不看上次时间', () => {
  assert.equal(shouldCheck('startup', Date.now() - 1000, Date.now()), true)
})

test('每天档：不满 24 小时不重复查，满了才查', () => {
  const now = 1_700_000_000_000
  assert.equal(shouldCheck('daily', now - 60 * 60 * 1000, now), false)
  assert.equal(shouldCheck('daily', now - DAY - 1, now), true)
})

test('每周档同理按 7 天算', () => {
  const now = 1_700_000_000_000
  assert.equal(shouldCheck('weekly', now - 6 * DAY, now), false)
  assert.equal(shouldCheck('weekly', now - 7 * DAY, now), true)
})

test('手机时间被改回过去时不能永久卡住检查', () => {
  const now = 1_700_000_000_000
  assert.equal(shouldCheck('daily', now + 30 * DAY, now), true, '时钟回拨要重新允许检查')
})

const api = (id: string, lastCheckAt = 0, updateUrl = `https://${id}.example/src.js`) => ({
  id,
  name: id,
  updateUrl,
  scriptUpdateUrl: '',
  lastCheckAt,
})

test('这一轮该查哪些源：有更新地址且到点的才查', () => {
  const now = 1_700_000_000_000
  const list = [api('a', now - 2 * DAY), api('b', now - 60 * 60 * 1000), api('c', now - 60 * 60 * 1000)]
  assert.deepEqual(pickCheckTargets(list, 'daily', now, true).map(target => target.id), ['a'])
})

test('每次启动档把这轮有更新地址的源都带上', () => {
  const now = 1_700_000_000_000
  const list = [api('a', now), api('b', 0), api('c', 0)]
  assert.deepEqual(pickCheckTargets(list, 'startup', now, true).map(target => target.id), ['a', 'b', 'c'])
})

test('没有更新地址的源不在后台空跑，只看脚本头部地址也算', () => {
  const now = 1_700_000_000_000
  const list = [
    api('a', 0, ''),
    { ...api('b', 0, ''), scriptUpdateUrl: 'https://head.example/src.js' },
    api('c', 0, ''),
  ]
  assert.deepEqual(pickCheckTargets(list, 'startup', now, true).map(target => target.id), ['b'])
})

test('总开关关掉时一个源都不查，检查频率关掉时同样', () => {
  const now = 1_700_000_000_000
  const list = [api('a', 0), api('b', 0)]
  assert.deepEqual(pickCheckTargets(list, 'startup', now, false), [])
  assert.deepEqual(pickCheckTargets(list, 'off', now, true), [])
})

test('用户自己填的更新地址优先于脚本这次报的 —— 手填就是为了让它说话不算', () => {
  assert.equal(pickUpdateUrl({ updateUrl: 'https://user.example/src.js', scriptUpdateUrl: '' }, 'https://event.example/x.js'), 'https://user.example/src.js')
})

test('没手填时先用脚本这次报的，再用脚本头部里存的', () => {
  assert.equal(pickUpdateUrl({ updateUrl: '', scriptUpdateUrl: 'https://a.example/src.js' }, 'https://event.example/x.js'), 'https://event.example/x.js')
  assert.equal(pickUpdateUrl({ updateUrl: '', scriptUpdateUrl: 'https://a.example/src.js' }, ''), 'https://a.example/src.js')
  assert.equal(pickUpdateUrl({ updateUrl: '', scriptUpdateUrl: '' }, undefined), '')
})

test('只认 http(s) 的地址，坏地址当没有且不挡住后面能用的', () => {
  assert.equal(pickUpdateUrl({ updateUrl: 'javascript:alert(1)', scriptUpdateUrl: '' }, ''), '')
  assert.equal(pickUpdateUrl({ updateUrl: 'ftp://a.example/x.js', scriptUpdateUrl: '' }, ''), '')
  assert.equal(pickUpdateUrl({ updateUrl: 'ftp://a.example/x.js', scriptUpdateUrl: 'https://a.example/src.js' }, ''), 'https://a.example/src.js')
})

test('多个候选地址按 用户填的 > 脚本这次报的 > 头部存的 排，重复的只留一个', () => {
  assert.deepEqual(
    pickUpdateUrls({ updateUrl: 'https://user.example/src.js', scriptUpdateUrl: 'https://head.example/src.js' }, 'https://event.example/x.js'),
    ['https://user.example/src.js', 'https://event.example/x.js', 'https://head.example/src.js'],
  )
  assert.deepEqual(
    pickUpdateUrls({ updateUrl: 'https://same.example/src.js', scriptUpdateUrl: 'https://same.example/src.js' }, 'https://same.example/src.js'),
    ['https://same.example/src.js'],
  )
})

test('候选地址里坏地址直接跳过，不占失败名额', () => {
  assert.deepEqual(pickUpdateUrls({ updateUrl: '', scriptUpdateUrl: 'https://head.example/src.js' }, 'javascript:alert(1)'), ['https://head.example/src.js'])
  assert.deepEqual(pickUpdateUrls({ updateUrl: '', scriptUpdateUrl: '' }, undefined), [])
})

test('jsDelivr 地址补其它官方镜像，单个边缘缓存半截/过旧时还有别的节点可试', () => {
  assert.deepEqual(
    pickUpdateUrls({ updateUrl: 'https://fastly.jsdelivr.net/gh/u/r@main/x.js', scriptUpdateUrl: '' }),
    [
      'https://fastly.jsdelivr.net/gh/u/r@main/x.js',
      'https://gcore.jsdelivr.net/gh/u/r@main/x.js',
      'https://cdn.jsdelivr.net/gh/u/r@main/x.js',
    ],
  )
  // 用户填的就是另一个镜像时，它仍然排第一
  assert.deepEqual(
    pickUpdateUrls({ updateUrl: 'https://gcore.jsdelivr.net/gh/u/r@main/x.js?v=1', scriptUpdateUrl: '' }),
    [
      'https://gcore.jsdelivr.net/gh/u/r@main/x.js?v=1',
      'https://fastly.jsdelivr.net/gh/u/r@main/x.js?v=1',
      'https://cdn.jsdelivr.net/gh/u/r@main/x.js?v=1',
    ],
  )
  // 普通域名不扩，重复的镜像只留一次
  assert.deepEqual(
    pickUpdateUrls({
      updateUrl: 'https://fastly.jsdelivr.net/gh/u/r@main/x.js',
      scriptUpdateUrl: 'https://gcore.jsdelivr.net/gh/u/r@main/x.js',
    }),
    [
      'https://fastly.jsdelivr.net/gh/u/r@main/x.js',
      'https://gcore.jsdelivr.net/gh/u/r@main/x.js',
      'https://cdn.jsdelivr.net/gh/u/r@main/x.js',
    ],
  )
  assert.deepEqual(
    pickUpdateUrls({ updateUrl: 'https://example.com/x.js', scriptUpdateUrl: '' }),
    ['https://example.com/x.js'],
  )
})
