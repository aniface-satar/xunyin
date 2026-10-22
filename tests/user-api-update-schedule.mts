import test from 'node:test'
import assert from 'node:assert/strict'
import {
  pickCheckTargets,
  shouldCheck,
  pickUpdateUrl,
  pickUpdateUrls,
  pickScheduledUpdateUrls,
  planUpdateUrls,
  USER_API_UPDATE_CHECK_MODES,
} from '../src/core/userApiUpdate/schedule.ts'

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

test('在线内置源：主地址在前，目录备用线路单独放一档', () => {
  const plan = planUpdateUrls({
    id: 'builtin_qdy',
    builtin: 'online',
    updateUrl: 'https://fastly.jsdelivr.net/gh/pdone/lx-music-source@main/qdy/latest.js',
    scriptUpdateUrl: '',
  })
  assert.deepEqual(plan.primary, [
    'https://fastly.jsdelivr.net/gh/pdone/lx-music-source@main/qdy/latest.js',
    'https://gcore.jsdelivr.net/gh/pdone/lx-music-source@main/qdy/latest.js',
    'https://cdn.jsdelivr.net/gh/pdone/lx-music-source@main/qdy/latest.js',
  ])
  assert.deepEqual(plan.fallback, [
    'https://ghproxy.net/raw.githubusercontent.com/pdone/lx-music-source/main/qdy/latest.js',
    'https://raw.githubusercontent.com/pdone/lx-music-source/main/qdy/latest.js',
  ])
})

test('用户自己填的地址不挂目录的备用线路；手动更新只试用户这次填的那一个', () => {
  const userOwned = planUpdateUrls({
    id: 'builtin_qdy',
    builtin: 'online',
    updateUrl: 'https://mine.example/update',
    scriptUpdateUrl: '',
  })
  assert.deepEqual(userOwned, { primary: ['https://mine.example/update'], fallback: [] })

  const override = planUpdateUrls({
    id: 'builtin_qdy',
    builtin: 'online',
    updateUrl: 'https://mine.example/old',
    scriptUpdateUrl: '',
  }, undefined, { overrideUrl: 'https://mine.example/new' })
  assert.deepEqual(override, { primary: ['https://mine.example/new'], fallback: [] })
})

test('后台检查本地内置源只认脚本自带的地址', () => {
  const source = {
    id: 'builtin_xigua',
    builtin: 'local' as const,
    updateUrl: 'https://mine.example/wrong.js',
    scriptUpdateUrl: '',
  }
  assert.deepEqual(pickScheduledUpdateUrls(source), [])
  assert.deepEqual(pickScheduledUpdateUrls({ ...source, scriptUpdateUrl: 'https://head.example/src.js' }), [
    'https://head.example/src.js',
  ])
  const now = 1_700_000_000_000
  assert.deepEqual(pickCheckTargets([{ ...source, lastCheckAt: 0 }], 'startup', now, true), [])
})

test('本地内置源：目录补的版本接口参与手动和后台检查，{version} 会填好', () => {
  const xinghai = {
    id: 'builtin_xinghai',
    builtin: 'local' as const,
    updateUrl: '',
    scriptUpdateUrl: '',
    version: 'v3.2.13',
  }
  const urls = [
    'https://zrcdy.dpdns.org/lx/versionh2.php?ver=v3.2.13',
    'https://yy.zddyr.top/lx/versionh2.php?ver=v3.2.13',
  ]
  assert.deepEqual(planUpdateUrls(xinghai).primary, urls)
  assert.deepEqual(pickScheduledUpdateUrls(xinghai), urls)

  // 用户手填的地址仍然排第一；后台不碰它，但目录接口照常查
  const withUserUrl = { ...xinghai, updateUrl: 'https://mine.example/x.js' }
  assert.deepEqual(planUpdateUrls(withUserUrl).primary, ['https://mine.example/x.js', ...urls])
  assert.deepEqual(pickScheduledUpdateUrls(withUserUrl), urls)

  // 头部地址排在目录接口前面
  assert.deepEqual(planUpdateUrls({ ...xinghai, scriptUpdateUrl: 'https://head.example/v.json' }).primary, [
    'https://head.example/v.json',
    ...urls,
  ])

  assert.deepEqual(planUpdateUrls({
    id: 'builtin_animemusic',
    builtin: 'local',
    updateUrl: '',
    scriptUpdateUrl: '',
    version: '3.0.1',
  }).primary, [
    'https://animemusic.bzxhkj.com/v1/index.php/script/lxmusic?checkUpdate=f50246eabbc1a141f9e1c46bcc352010&key=',
  ])

  // 目录没给接口的源还是空，不能凭空编一个地址
  assert.deepEqual(planUpdateUrls({
    id: 'builtin_xigua',
    builtin: 'local',
    updateUrl: '',
    scriptUpdateUrl: '',
    version: 'v1.40',
  }), { primary: [], fallback: [] })

  // 被拒绝的那条地址只挡自己，另一个域名的同名接口还能继续用
  assert.deepEqual(pickScheduledUpdateUrls({ ...xinghai, updateUrlRejected: urls[0] }), [urls[1]])
})

test('自动检查不再重试已证明取回别家脚本的地址；手动检查与换地址照常', () => {
  const bad = 'https://fastly.jsdelivr.net/gh/moxi5445/lx-music-cloud@main/lx-cloud.js'
  const source = {
    id: 'user_api_x',
    updateUrl: bad,
    scriptUpdateUrl: '',
    updateUrlRejected: bad,
  }
  assert.deepEqual(pickScheduledUpdateUrls(source), [])
  assert.deepEqual(pickCheckTargets([{ ...source, lastCheckAt: 0 }], 'startup', 1, true), [])
  assert.equal(planUpdateUrls(source).primary[0], bad, '手动检查仍要试它，让用户看到真实原因')

  // 报错来自哪个镜像都算同一组，不能换个域名接着撞
  assert.deepEqual(pickScheduledUpdateUrls({ ...source, updateUrlRejected: bad.replace('fastly', 'gcore') }), [])

  // 只挡这条地址，不挡源：脚本头部还有一条好地址时照常查
  assert.deepEqual(pickScheduledUpdateUrls({ ...source, scriptUpdateUrl: 'https://head.example/src.js' }), [
    'https://head.example/src.js',
  ])

  // 换了地址就重新判断，旧结论不影响新地址
  assert.deepEqual(pickScheduledUpdateUrls({ ...source, updateUrl: 'https://new.example/x.js' }), [
    'https://new.example/x.js',
  ])
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

test('GitHub raw 地址补 jsDelivr 镜像：国内基本连不上 raw，同一份内容挂在 jsDelivr 上', () => {
  assert.deepEqual(
    pickUpdateUrls({ updateUrl: 'https://raw.githubusercontent.com/moxi5445/lx-music-cloud/main/lx-cloud.js', scriptUpdateUrl: '' }),
    [
      'https://raw.githubusercontent.com/moxi5445/lx-music-cloud/main/lx-cloud.js',
      'https://fastly.jsdelivr.net/gh/moxi5445/lx-music-cloud@main/lx-cloud.js',
      'https://gcore.jsdelivr.net/gh/moxi5445/lx-music-cloud@main/lx-cloud.js',
      'https://cdn.jsdelivr.net/gh/moxi5445/lx-music-cloud@main/lx-cloud.js',
    ],
  )
  // 镜像组要认得 raw 和 jsDelivr 是同一份内容：拉黑其中一条，其它条也不再试
  assert.deepEqual(
    planUpdateUrls({
      id: 'builtin_moxi_cloud',
      builtin: 'local',
      scriptUpdateUrl: 'https://raw.githubusercontent.com/moxi5445/lx-music-cloud/main/lx-cloud.js',
      updateUrlRejected: 'https://gcore.jsdelivr.net/gh/moxi5445/lx-music-cloud@main/lx-cloud.js',
    }, undefined, { scheduled: true }).primary,
    [],
  )
})
