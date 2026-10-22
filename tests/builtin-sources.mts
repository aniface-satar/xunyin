import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_SOURCES,
  BUILTIN_SOURCE_IDS,
  findBuiltinSource,
  findRemovedBuiltinSource,
  getBuiltinFallbackUpdateUrls,
  getBuiltinLocalUpdateUrls,
  hasBuiltinUpdateSource,
  isBuiltinAutoCheck,
} from '../src/config/builtinSources/catalog.ts'
import { pickAvailableUserApiId, pickBuiltinSources, planBuiltinSeed } from '../src/utils/builtinSources.ts'
import { isUserApiSource } from '../src/utils/userApiSource.ts'
import { pickCheckTargets, pickScheduledUpdateUrls } from '../src/core/userApiUpdate/schedule.ts'
import { planUpdate } from '../src/core/userApiUpdate/applyUpdate.ts'
import { checkScriptSyntax } from '../src/core/userApiUpdate/syntaxCheck.ts'

const SCRIPT = '/**\n * @name 测试源\n * @version v1.0.0\n */\nuserApi.register.action(() => {})\n'
const SCRIPT_V2 = '/**\n * @name 测试源新版\n * @version v1.1.0\n * @description 新版说明\n */\nuserApi.register.action(() => {})\n'

const definition = (key: string, kind: 'online' | 'local', overrides = {}) => ({
  id: `builtin_${key}`,
  key,
  kind,
  name: '测试源',
  version: 'v1.0.0',
  description: '',
  author: '',
  homepage: '',
  script: SCRIPT,
  updateUrl: '',
  legacyUpdateUrls: [],
  fallbackUpdateUrls: [],
  scriptUpdateUrl: '',
  autoUpdate: false,
  checkUpdateUrls: [],
  autoCheck: false,
  ...overrides,
})

const api = (id: string, overrides = {}) => ({
  id,
  name: id,
  description: '',
  allowShowUpdateAlert: false,
  autoUpdate: false,
  author: '',
  homepage: '',
  version: 'v1.0.0',
  updateUrl: 'https://mine.example/update',
  scriptUpdateUrl: '',
  lastCheckAt: 123,
  verifyPending: true,
  ...overrides,
})

test('内置目录：9 个源、id 稳定唯一、5 本地 + 4 在线', () => {
  assert.equal(BUILTIN_SOURCES.length, 9)
  assert.equal(new Set(BUILTIN_SOURCE_IDS).size, 9)
  const online = BUILTIN_SOURCES.filter(source => source.kind == 'online')
  const local = BUILTIN_SOURCES.filter(source => source.kind == 'local')
  assert.deepEqual(online.map(source => source.key), ['qdy', 'moxi_cloud', 'huanyin', '1010'])
  assert.deepEqual(local.map(source => source.key), ['hywmusic', 'xinghai', 'changqing', 'nianxin', 'animemusic'])
  for (const source of BUILTIN_SOURCES) {
    assert.ok(source.id.startsWith('builtin_'))
    assert.ok(source.name.length > 0, `${source.key} 应该有名字`)
    assert.ok(source.version.length > 0, `${source.key} 应该有版本号`)
  }
})

test('更新链路走不通的本地源已下架，名字留给老安装清理和提示', () => {
  const removed = [
    ['builtin_xigua', '西瓜聚合源'],
    ['builtin_yuxi', '屿溪-终章'],
    ['builtin_yuningxi', 'lx-玉宁熙-Pro'],
    ['builtin_juhe_cf', '聚合API接口 (CF)'],
  ] as const
  for (const [id, name] of removed) {
    assert.equal(findBuiltinSource(id), null, `${id} 不该再出现在内置目录里`)
    assert.equal(findRemovedBuiltinSource(id)?.name, name)
  }
  assert.equal(findRemovedBuiltinSource('builtin_hywmusic'), null, '还在目录里的源不能误判成下架')
})

test('内置源和自定义源走同一条脚本加载/取链接链路', () => {
  for (const id of BUILTIN_SOURCE_IDS) {
    assert.equal(isUserApiSource(id), true, `${id} 必须按用户音源加载`)
  }
  assert.equal(isUserApiSource('user_api_custom'), true)
  assert.equal(isUserApiSource('kw'), false)
  assert.equal(isUserApiSource(''), false)
})

test('内置目录：在线源和本地源都有可检查的地址，来源可以是头部或目录', () => {
  const localWithHeader = ['hywmusic', 'changqing', 'nianxin']
  const localWithCatalog = ['xinghai', 'animemusic']
  for (const source of BUILTIN_SOURCES.filter(source => source.kind == 'online')) {
    assert.ok(source.updateUrl, `${source.key} 是在线源，应当有更新地址`)
    assert.equal(source.autoUpdate, true, `${source.key} 是在线源，应当自动检查更新`)
    assert.equal(source.checkUpdateUrls.length, 0, `${source.key} 是在线源，不走本地检查地址`)
  }
  for (const source of BUILTIN_SOURCES.filter(source => source.kind == 'local')) {
    assert.equal(source.updateUrl, '', `${source.key} 是本地源，不应带用户填的更新地址`)
    if (localWithHeader.includes(source.key)) {
      assert.ok(source.scriptUpdateUrl, `${source.key} 脚本头部有更新地址，应当保留下来`)
      assert.equal(source.checkUpdateUrls.length, 0, `${source.key} 有头部地址，不需要目录再补`)
      assert.equal(source.autoUpdate, true, `${source.key} 有更新地址，应当能自动检查更新`)
      assert.equal(source.autoCheck, true)
    } else if (localWithCatalog.includes(source.key)) {
      assert.equal(source.scriptUpdateUrl, '', `${source.key} 脚本头部没有更新地址`)
      assert.ok(source.checkUpdateUrls.length > 0, `${source.key} 应当由目录补上版本接口`)
      assert.equal(source.autoUpdate, true, `${source.key} 有目录检查地址，应当能自动检查更新`)
      assert.equal(source.autoCheck, true)
    } else {
      assert.fail(`${source.key} 没有可用的更新地址，不该继续留在内置目录里`)
    }
  }
})

test('目录补的检查地址会填上当前版本，在线源/自定义源不参与', () => {
  const xinghai = getBuiltinLocalUpdateUrls('builtin_xinghai', 'v3.2.13')
  assert.deepEqual(xinghai, [
    'https://zrcdy.dpdns.org/lx/versionh2.php?ver=v3.2.13',
    'https://yy.zddyr.top/lx/versionh2.php?ver=v3.2.13',
  ])
  // lx-animemusic：脚本按内置文件里的 md5 问作者接口，接口不需要版本号占位
  assert.deepEqual(getBuiltinLocalUpdateUrls('builtin_animemusic', '3.0.1'), [
    'https://animemusic.bzxhkj.com/v1/index.php/script/lxmusic?checkUpdate=f50246eabbc1a141f9e1c46bcc352010&key=',
  ])
  // 已下架的源在目录里查不到，自然也不会再补检查地址
  assert.deepEqual(getBuiltinLocalUpdateUrls('builtin_xigua', 'v1.40'), [])
  assert.deepEqual(getBuiltinLocalUpdateUrls('builtin_juhe_cf', '3'), [])
  assert.deepEqual(getBuiltinLocalUpdateUrls('builtin_qdy', '1'), [], '在线源不走本地检查地址')
  assert.deepEqual(getBuiltinLocalUpdateUrls('user_api_custom', '1'), [])
  // 版本没解析出来也要能查：接口自己会按缺省值处理
  assert.equal(getBuiltinLocalUpdateUrls('builtin_xinghai', '')[0], 'https://zrcdy.dpdns.org/lx/versionh2.php?ver=')

  assert.equal(hasBuiltinUpdateSource('builtin_xinghai'), true)
  assert.equal(hasBuiltinUpdateSource('builtin_hywmusic'), true)
  assert.equal(hasBuiltinUpdateSource('builtin_xigua'), false)
  assert.equal(hasBuiltinUpdateSource('user_api_custom'), false)
  assert.equal(isBuiltinAutoCheck('builtin_xinghai'), true)
  assert.equal(isBuiltinAutoCheck('builtin_xigua'), false)
  assert.equal(isBuiltinAutoCheck('builtin_qdy'), true)
})

test('在线源主线路走 jsDelivr，旧 ghproxy 地址留作迁移和兜底', () => {
  const qdy = findBuiltinSource('builtin_qdy')!
  const huanyin = findBuiltinSource('builtin_huanyin')!
  for (const source of [qdy, huanyin]) {
    assert.match(source.updateUrl, /^https:\/\/fastly\.jsdelivr\.net\//, `${source.key} 的主线路应当是 jsDelivr`)
    assert.equal(source.legacyUpdateUrls.length, 1, `${source.key} 要记得上一版随包写的是哪条地址`)
    assert.match(source.legacyUpdateUrls[0], /^https:\/\/ghproxy\.net\//)
    assert.ok(source.fallbackUpdateUrls.some(url => url.startsWith('https://raw.githubusercontent.com/')), `${source.key} 要有直连兜底`)
  }
  // 落雪云本来就走 jsDelivr，只需要一条直连备用
  assert.deepEqual(findBuiltinSource('builtin_moxi_cloud')!.fallbackUpdateUrls, [
    'https://raw.githubusercontent.com/moxi5445/lx-music-cloud/main/lx-cloud.js',
  ])
  // 1010 是当天新增的在线源：没有上一版地址，主线路 jsDelivr + 直连/ghproxy 备用
  const y1010 = findBuiltinSource('builtin_1010')!
  assert.match(y1010.updateUrl, /^https:\/\/fastly\.jsdelivr\.net\//)
  assert.equal(y1010.legacyUpdateUrls.length, 0)
  assert.ok(y1010.fallbackUpdateUrls.some(url => url.startsWith('https://raw.githubusercontent.com/')))
  // 本地源不配目录地址
  assert.deepEqual(findBuiltinSource('builtin_hywmusic')!.fallbackUpdateUrls, [])
})

test('备用线路只对目录自己写的地址生效，用户填的地址不拿去乱试', () => {
  const qdy = findBuiltinSource('builtin_qdy')!
  assert.deepEqual(getBuiltinFallbackUpdateUrls(qdy.id, qdy.updateUrl), qdy.fallbackUpdateUrls)
  assert.deepEqual(getBuiltinFallbackUpdateUrls(qdy.id, qdy.legacyUpdateUrls[0]), qdy.fallbackUpdateUrls)
  assert.deepEqual(getBuiltinFallbackUpdateUrls(qdy.id, 'https://mine.example/update'), [])
  assert.deepEqual(getBuiltinFallbackUpdateUrls(qdy.id, ''), [])
  assert.deepEqual(getBuiltinFallbackUpdateUrls('builtin_hywmusic', 'https://mine.example/update'), [])
  assert.deepEqual(getBuiltinFallbackUpdateUrls('user_api_custom', qdy.updateUrl), [])
})

test('老设备的在线源地址还停在上一版 ghproxy：启动时跟着目录迁到新线路', () => {
  const legacy = 'https://ghproxy.net/raw.githubusercontent.com/example/repo/main/a.js'
  const current = 'https://fastly.jsdelivr.net/gh/example/repo@main/a.js'
  const migrated = planBuiltinSeed({
    existing: [api('builtin_a', { builtin: 'online', updateUrl: legacy })],
    storedScripts: { builtin_a: SCRIPT_V2 },
    definitions: [definition('a', 'online', { updateUrl: current, legacyUpdateUrls: [legacy] })],
  })
  assert.equal(migrated.list[0].updateUrl, current)
  assert.equal(migrated.list[0].builtinUpdateUrl, current)
  assert.equal(migrated.changed, true)
  assert.equal(migrated.list[0].updateUrlRejected, undefined, '自己的旧地址不是错配')

  const userOwned = planBuiltinSeed({
    existing: [api('builtin_a', { builtin: 'online', updateUrl: 'https://mine.example/update' })],
    storedScripts: { builtin_a: SCRIPT_V2 },
    definitions: [definition('a', 'online', { updateUrl: current, legacyUpdateUrls: [legacy] })],
  })
  assert.equal(userOwned.list[0].updateUrl, 'https://mine.example/update', '用户改过的地址不能动')
  assert.equal(userOwned.list[0].builtinUpdateUrl, undefined)
  assert.equal(userOwned.changed, false)
})

test('地址已经跟目录一致时不重复迁移；用户手动清空后不会被塞回来', () => {
  const current = 'https://fastly.jsdelivr.net/gh/example/repo@main/a.js'
  const idempotent = planBuiltinSeed({
    existing: [api('builtin_a', { builtin: 'online', updateUrl: current, builtinUpdateUrl: current })],
    storedScripts: { builtin_a: SCRIPT_V2 },
    definitions: [definition('a', 'online', { updateUrl: current })],
  })
  assert.equal(idempotent.changed, false)
  assert.equal(idempotent.list[0].updateUrl, current)

  const cleared = planBuiltinSeed({
    existing: [api('builtin_a', { builtin: 'online', updateUrl: '', builtinUpdateUrl: current })],
    storedScripts: { builtin_a: SCRIPT_V2 },
    definitions: [definition('a', 'online', { updateUrl: current })],
  })
  assert.equal(cleared.list[0].updateUrl, '', '用户清空的地址不能被播种补回来')
  assert.equal(cleared.changed, false)
})

test('没有迁移标记但地址就是当前目录值：只补标记，不改地址', () => {
  const current = 'https://fastly.jsdelivr.net/gh/example/repo@main/a.js'
  const plan = planBuiltinSeed({
    existing: [api('builtin_a', { builtin: 'online', updateUrl: current })],
    storedScripts: { builtin_a: SCRIPT_V2 },
    definitions: [definition('a', 'online', { updateUrl: current })],
  })
  assert.equal(plan.list[0].updateUrl, current)
  assert.equal(plan.list[0].builtinUpdateUrl, current)
  assert.equal(plan.changed, true)
})

test('本地内置源后台只查脚本自带地址，手填的地址不参与自动检查', () => {
  const typedOnly = planBuiltinSeed({
    existing: [api('builtin_xigua', { builtin: 'local', updateUrl: 'https://mine.example/wrong.js' })],
    storedScripts: {},
    definitions: [definition('xigua', 'local', { script: SCRIPT_V2 })],
  })
  assert.equal(typedOnly.list[0].updateUrl, 'https://mine.example/wrong.js', '用户填的地址仍然留着')
  assert.deepEqual(pickCheckTargets(typedOnly.list, 'startup', 1, true), [], '后台不该反复去试这个地址')

  const withHeader = planBuiltinSeed({
    existing: [],
    storedScripts: {},
    definitions: [definition('local2', 'local', { scriptUpdateUrl: 'https://head.example/src.js' })],
  })
  assert.deepEqual(withHeader.list[0].scriptUpdateUrl, 'https://head.example/src.js')
  assert.deepEqual(pickCheckTargets(withHeader.list, 'startup', 1, true).map(item => item.id), ['builtin_local2'])
})

test('别的内置源的地址被误存过来：保留地址，但记下不再自动重试', () => {
  const moxi = findBuiltinSource('builtin_moxi_cloud')!
  const plan = planBuiltinSeed({
    existing: [
      api('builtin_xigua', { builtin: 'local', updateUrl: moxi.updateUrl }),
      api('user_api_custom', { updateUrl: moxi.updateUrl }),
    ],
    storedScripts: { builtin_xigua: SCRIPT_V2 },
    definitions: [definition('xigua', 'local', { script: SCRIPT_V2 })],
  })
  for (const info of plan.list) {
    assert.equal(info.updateUrl, moxi.updateUrl, '地址属于用户字段，不能替他删')
    assert.equal(info.updateUrlRejected, moxi.updateUrl, '自动检查不该再拿它白跑')
  }
  assert.equal(plan.changed, true)
  assert.deepEqual(pickCheckTargets(plan.list, 'startup', 1, true), [])

  // 用户自己又导入了一份同一个在线源：名字对得上，地址本来就能用，不该被挡
  const duplicate = planBuiltinSeed({
    existing: [api('user_api_moxi', { name: moxi.name, updateUrl: moxi.updateUrl })],
    storedScripts: {},
    definitions: [],
  })
  assert.equal(duplicate.list[0].updateUrlRejected, undefined)
  assert.equal(duplicate.changed, false)

  // 自己的地址（含上一版的旧地址）不算错配
  const qdy = findBuiltinSource('builtin_qdy')!
  const own = planBuiltinSeed({
    existing: [api(qdy.id, { builtin: 'online', updateUrl: qdy.legacyUpdateUrls[0] })],
    storedScripts: { [qdy.id]: SCRIPT_V2 },
    definitions: [qdy],
  })
  assert.equal(own.list[0].updateUrlRejected, undefined)
  assert.equal(own.list[0].updateUrl, qdy.updateUrl)
})

test('下架的本地内置源从老列表里清掉，留下的源不重写脚本', () => {
  const plan = planBuiltinSeed({
    existing: [
      api('user_api_custom'),
      api('builtin_xigua', { builtin: 'local', updateUrl: '' }),
      api('builtin_yuxi', { builtin: 'local', updateUrl: '' }),
      api('builtin_yuningxi', { builtin: 'local', updateUrl: '' }),
      api('builtin_hywmusic', { builtin: 'local', updateUrl: '' }),
    ],
    storedScripts: { builtin_hywmusic: SCRIPT },
    definitions: [definition('hywmusic', 'local', { script: SCRIPT })],
  })
  assert.deepEqual(plan.list.map(info => info.id), ['user_api_custom', 'builtin_hywmusic'])
  assert.deepEqual(plan.removedIds, ['builtin_xigua', 'builtin_yuxi', 'builtin_yuningxi'])
  assert.equal(plan.changed, true)
  assert.deepEqual(plan.writes, [])
})

test('用户给下架源填过更新地址：摘掉内置标记留在自定义源，地址和脚本都不丢', () => {
  const plan = planBuiltinSeed({
    existing: [
      api('builtin_xigua', {
        builtin: 'local',
        builtinVersion: 'v1.40',
        updateUrl: 'https://mine.example/xigua.js',
      }),
      api('builtin_yuxi', {
        builtin: 'local',
        updateUrl: 'https://mine.example/yuxi.js',
        updateUrlRejected: 'https://mine.example/yuxi.js',
      }),
    ],
    storedScripts: {},
    definitions: [],
  })
  assert.equal(plan.list.length, 1)
  const kept = plan.list[0]
  assert.equal(kept.id, 'builtin_xigua')
  assert.equal(kept.builtin, undefined)
  assert.equal(kept.builtinVersion, undefined)
  assert.equal(kept.updateUrl, 'https://mine.example/xigua.js')
  assert.deepEqual(plan.removedIds, ['builtin_yuxi'], '记过误存地址的不算用户接手')
  assert.equal(plan.changed, true)

  // 下次启动它已经是普通自定义源，不能再被下架逻辑碰一次
  const next = planBuiltinSeed({ existing: plan.list, storedScripts: {}, definitions: [] })
  assert.equal(next.changed, false)
  assert.deepEqual(next.removedIds, [])
  assert.equal(next.list[0].id, 'builtin_xigua')
})

test('当前源被下架后：优先默认内置源，默认源不在再退到其它内置源', () => {
  const list = [
    api('user_api_custom'),
    api('builtin_qdy', { builtin: 'online' }),
    api('builtin_hywmusic', { builtin: 'local' }),
  ]
  assert.equal(pickAvailableUserApiId(list, 'builtin_hywmusic'), 'builtin_hywmusic')
  assert.equal(pickAvailableUserApiId(list, 'builtin_nope'), 'builtin_qdy')
  assert.equal(pickAvailableUserApiId([api('user_api_custom')], 'builtin_nope'), 'user_api_custom')
  assert.equal(pickAvailableUserApiId([], 'builtin_nope'), '')
})

test('播种后自动更新只查有更新地址的内置源，本地源的目录接口同样进入检查', () => {
  const plan = planBuiltinSeed({ existing: [], storedScripts: {}, definitions: BUILTIN_SOURCES })
  const targets = pickCheckTargets(plan.list, 'startup', 1, true)
  assert.deepEqual(targets.map(api => api.id), [
    'builtin_hywmusic',
    'builtin_xinghai',
    'builtin_changqing',
    'builtin_nianxin',
    'builtin_qdy',
    'builtin_moxi_cloud',
    'builtin_huanyin',
    'builtin_1010',
    'builtin_animemusic',
  ])
  const xinghai = plan.list.find(item => item.id == 'builtin_xinghai')!
  assert.deepEqual(pickScheduledUpdateUrls(xinghai), [
    'https://zrcdy.dpdns.org/lx/versionh2.php?ver=v3.2.13',
    'https://yy.zddyr.top/lx/versionh2.php?ver=v3.2.13',
  ])
  for (const info of plan.list.filter(item => item.builtin == 'local')) {
    if (hasBuiltinUpdateSource(info.id)) continue
    assert.deepEqual(pickScheduledUpdateUrls(info), [], `${info.id} 没有更新地址，不该进更新调度`)
  }
  assert.deepEqual(pickCheckTargets(plan.list, 'startup', 1, false), [], '总开关关掉后一个源都不查')
})

test('内置源过语法闸门，内容变化可更新，坏包被拒绝', () => {
  for (const source of BUILTIN_SOURCES) {
    assert.equal(checkScriptSyntax(source.script).ok, true, `${source.key} 的包内脚本应能解析`)
    assert.equal(planUpdate({
      currentName: source.name,
      storedScript: source.script,
      newScript: source.script,
    }).action, 'unchanged')
    assert.equal(planUpdate({
      currentName: source.name,
      storedScript: source.script.replace(/@version[ \t]+[^\r\n]*/, '@version v0.0.1'),
      newScript: source.script,
    }).action, 'write', `${source.key} 从旧版本应当可以升上去`)
    const broken = planUpdate({
      currentName: source.name,
      storedScript: source.script,
      newScript: `${source.script}\nfunction (`,
    })
    assert.equal(broken.action, 'reject', `${source.key} 的坏包必须被拦下`)
    assert.equal(broken.reason, 'syntax_error')
  }
})

test('首次启动：自定义源不动，内置源按目录顺序追加并写入脚本', () => {
  const plan = planBuiltinSeed({
    existing: [api('user_api_custom')],
    storedScripts: {},
    definitions: [definition('a', 'online'), definition('b', 'local')],
  })
  assert.equal(plan.changed, true)
  assert.deepEqual(plan.list.map(info => info.id), ['user_api_custom', 'builtin_a', 'builtin_b'])
  assert.deepEqual(plan.writes, [
    { id: 'builtin_a', script: SCRIPT },
    { id: 'builtin_b', script: SCRIPT },
  ])
  const online = plan.list[1]
  assert.equal(online.builtin, 'online')
  assert.equal(online.allowShowUpdateAlert, true)
  assert.equal(online.lastCheckAt, 0)
  assert.equal(online.verifyPending, false)
  const local = plan.list[2]
  assert.equal(local.builtin, 'local')
  assert.equal(local.allowShowUpdateAlert, false)
  assert.equal(local.autoUpdate, false)
  assert.equal(local.updateUrl, '')
})

test('在线源已被自动更新换过脚本时，再启动不拿包里的旧脚本盖回去', () => {
  const stored = api('builtin_a', { builtin: 'online', name: '新版名字', version: 'v2.0.0' })
  const plan = planBuiltinSeed({
    existing: [stored],
    storedScripts: { builtin_a: SCRIPT_V2 },
    definitions: [definition('a', 'online')],
  })
  assert.equal(plan.changed, false)
  assert.deepEqual(plan.writes, [])
  assert.equal(plan.list[0].name, '新版名字')
  assert.equal(plan.list[0].version, 'v2.0.0')
})

test('本地源脚本换代：覆盖脚本和头部信息，但保留用户的开关与地址', () => {
  const stored = api('builtin_b', { builtin: 'local' })
  const plan = planBuiltinSeed({
    existing: [stored],
    storedScripts: { builtin_b: SCRIPT },
    definitions: [definition('b', 'local', {
      script: SCRIPT_V2,
      name: '测试源新版',
      version: 'v1.1.0',
      description: '新版说明',
    })],
  })
  assert.equal(plan.changed, true)
  assert.deepEqual(plan.writes, [{ id: 'builtin_b', script: SCRIPT_V2 }])
  const info = plan.list[0]
  assert.equal(info.name, '测试源新版')
  assert.equal(info.version, 'v1.1.0')
  assert.equal(info.description, '新版说明')
  assert.equal(info.allowShowUpdateAlert, false)
  assert.equal(info.autoUpdate, false)
  assert.equal(info.updateUrl, 'https://mine.example/update')
  assert.equal(info.lastCheckAt, 123)
})

test('本地源脚本和包里一致时不重复写脚本，只补应用包版本标记', () => {
  const plan = planBuiltinSeed({
    existing: [api('builtin_b', { builtin: 'local' })],
    storedScripts: { builtin_b: SCRIPT },
    definitions: [definition('b', 'local')],
  })
  assert.equal(plan.changed, true)
  assert.deepEqual(plan.writes, [])
  assert.equal(plan.list[0].builtinVersion, 'v1.0.0')
})

test('本地源运行时更新过：同一个应用包再启动不拿旧脚本盖回去', () => {
  const stored = api('builtin_b', {
    builtin: 'local',
    builtinVersion: 'v1.0.0',
    version: 'v1.1.0',
    scriptUpdateUrl: 'https://a.example/src.js',
  })
  const plan = planBuiltinSeed({
    existing: [stored],
    storedScripts: { builtin_b: SCRIPT_V2 },
    definitions: [definition('b', 'local')],
  })
  assert.equal(plan.changed, false)
  assert.deepEqual(plan.writes, [])
  assert.equal(plan.list[0].version, 'v1.1.0')
  assert.equal(plan.list[0].scriptUpdateUrl, 'https://a.example/src.js')
})

test('老数据没存下头部地址：本地源启动时补回来，盘上脚本自己的地址优先', () => {
  const fromDefinition = planBuiltinSeed({
    existing: [api('builtin_b', { builtin: 'local', builtinVersion: 'v1.0.0' })],
    storedScripts: { builtin_b: SCRIPT_V2 },
    definitions: [definition('b', 'local', { scriptUpdateUrl: 'https://head.example/src.js' })],
  })
  assert.equal(fromDefinition.list[0].scriptUpdateUrl, 'https://head.example/src.js')
  assert.equal(fromDefinition.changed, true)
  assert.deepEqual(fromDefinition.writes, [])

  const storedWithUrl = '/**\n * @name 测试源\n * @version v1.2.0\n * @update_url https://stored.example/src.js\n */\n'
  const fromStored = planBuiltinSeed({
    existing: [api('builtin_b', { builtin: 'local', builtinVersion: 'v1.0.0' })],
    storedScripts: { builtin_b: storedWithUrl },
    definitions: [definition('b', 'local', { scriptUpdateUrl: 'https://head.example/src.js' })],
  })
  assert.equal(fromStored.list[0].scriptUpdateUrl, 'https://stored.example/src.js', '盘上脚本自己的地址最准')

  const userOwned = planBuiltinSeed({
    existing: [api('builtin_b', {
      builtin: 'local',
      builtinVersion: 'v1.0.0',
      scriptUpdateUrl: 'https://mine.example/x.js',
    })],
    storedScripts: { builtin_b: SCRIPT_V2 },
    definitions: [definition('b', 'local', { scriptUpdateUrl: 'https://head.example/src.js' })],
  })
  assert.equal(userOwned.list[0].scriptUpdateUrl, 'https://mine.example/x.js', '已经有地址就不要覆盖')
  assert.equal(userOwned.changed, false)
})

test('应用升级带的本地脚本更新时仍覆盖；运行时更新版本更高则保留', () => {
  const newerBundle = planBuiltinSeed({
    existing: [api('builtin_b', {
      builtin: 'local',
      builtinVersion: 'v1.0.0',
      version: 'v1.0.0',
    })],
    storedScripts: { builtin_b: SCRIPT },
    definitions: [definition('b', 'local', {
      script: SCRIPT_V2,
      version: 'v1.1.0',
      name: '测试源新版',
    })],
  })
  assert.deepEqual(newerBundle.writes, [{ id: 'builtin_b', script: SCRIPT_V2 }])
  assert.equal(newerBundle.list[0].version, 'v1.1.0')

  const newerRuntime = planBuiltinSeed({
    existing: [api('builtin_b', {
      builtin: 'local',
      builtinVersion: 'v1.0.0',
      version: 'v2.0.0',
    })],
    storedScripts: { builtin_b: SCRIPT_V2 },
    definitions: [definition('b', 'local', { script: SCRIPT, version: 'v1.0.5' })],
  })
  assert.deepEqual(newerRuntime.writes, [])
  assert.equal(newerRuntime.list[0].version, 'v2.0.0')
  assert.equal(newerRuntime.list[0].builtinVersion, 'v1.0.5')
})

test('在线源脚本存储丢了：补回包里的脚本，用户设置仍保留', () => {
  const stored = api('builtin_a', { builtin: 'online' })
  const plan = planBuiltinSeed({
    existing: [stored],
    storedScripts: { builtin_a: '' },
    definitions: [definition('a', 'online')],
  })
  assert.equal(plan.changed, true)
  assert.deepEqual(plan.writes, [{ id: 'builtin_a', script: SCRIPT }])
  assert.equal(plan.list[0].updateUrl, 'https://mine.example/update')
  assert.equal(plan.list[0].autoUpdate, false)
})

test('管理页按标签取源，自定义源不混进来', () => {
  const list = [api('builtin_a', { builtin: 'online' }), api('builtin_b', { builtin: 'local' }), api('user_api_custom')]
  assert.deepEqual(pickBuiltinSources(list, 'online').map(info => info.id), ['builtin_a'])
  assert.deepEqual(pickBuiltinSources(list, 'local').map(info => info.id), ['builtin_b'])
})

test('老数据没有 builtin 标记时补上分类', () => {
  const plan = planBuiltinSeed({
    existing: [api('builtin_a')],
    storedScripts: { builtin_a: SCRIPT_V2 },
    definitions: [definition('a', 'online')],
  })
  assert.equal(plan.list[0].builtin, 'online')
  assert.equal(plan.changed, true)
  assert.deepEqual(plan.writes, [])
})
