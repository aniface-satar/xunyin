import test from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN_SOURCES, BUILTIN_SOURCE_IDS } from '../src/config/builtinSources/catalog.ts'
import { pickBuiltinSources, planBuiltinSeed } from '../src/utils/builtinSources.ts'
import { isUserApiSource } from '../src/utils/userApiSource.ts'
import { pickCheckTargets } from '../src/core/userApiUpdate/schedule.ts'
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
  scriptUpdateUrl: '',
  autoUpdate: false,
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

test('内置目录：11 个源、id 稳定唯一、8 本地 + 3 在线', () => {
  assert.equal(BUILTIN_SOURCES.length, 11)
  assert.equal(new Set(BUILTIN_SOURCE_IDS).size, 11)
  const online = BUILTIN_SOURCES.filter(source => source.kind == 'online')
  const local = BUILTIN_SOURCES.filter(source => source.kind == 'local')
  assert.deepEqual(online.map(source => source.key), ['qdy', 'moxi_cloud', 'huanyin'])
  assert.deepEqual(local.map(source => source.key), ['hywmusic', 'xinghai', 'changqing', 'nianxin', 'xigua', 'yuxi', 'yuningxi', 'juhe_cf'])
  for (const source of BUILTIN_SOURCES) {
    assert.ok(source.id.startsWith('builtin_'))
    assert.ok(source.name.length > 0, `${source.key} 应该有名字`)
    assert.ok(source.version.length > 0, `${source.key} 应该有版本号`)
  }
})

test('内置源和自定义源走同一条脚本加载/取链接链路', () => {
  for (const id of BUILTIN_SOURCE_IDS) {
    assert.equal(isUserApiSource(id), true, `${id} 必须按用户音源加载`)
  }
  assert.equal(isUserApiSource('user_api_custom'), true)
  assert.equal(isUserApiSource('kw'), false)
  assert.equal(isUserApiSource(''), false)
})

test('内置目录：在线源都有更新地址，本地源有脚本头部地址的也能检查更新', () => {
  const localWithUrl = ['hywmusic', 'changqing', 'nianxin']
  for (const source of BUILTIN_SOURCES.filter(source => source.kind == 'online')) {
    assert.ok(source.updateUrl, `${source.key} 是在线源，应当有更新地址`)
    assert.equal(source.autoUpdate, true, `${source.key} 是在线源，应当自动检查更新`)
  }
  for (const source of BUILTIN_SOURCES.filter(source => source.kind == 'local')) {
    assert.equal(source.updateUrl, '', `${source.key} 是本地源，不应带用户填的更新地址`)
    if (localWithUrl.includes(source.key)) {
      assert.ok(source.scriptUpdateUrl, `${source.key} 脚本头部有更新地址，应当保留下来`)
      assert.equal(source.autoUpdate, true, `${source.key} 有更新地址，应当能自动检查更新`)
    } else {
      assert.equal(source.scriptUpdateUrl, '', `${source.key} 脚本头部没有更新地址`)
      assert.equal(source.autoUpdate, false, `${source.key} 没有更新地址，不该进后台检查`)
    }
  }
})

test('播种后自动更新只查有更新地址的内置源，本地源同样可以进入检查', () => {
  const plan = planBuiltinSeed({ existing: [], storedScripts: {}, definitions: BUILTIN_SOURCES })
  const targets = pickCheckTargets(plan.list, 'startup', 1, true)
  assert.deepEqual(targets.map(api => api.id), [
    'builtin_hywmusic',
    'builtin_changqing',
    'builtin_nianxin',
    'builtin_qdy',
    'builtin_moxi_cloud',
    'builtin_huanyin',
  ])
  for (const api of plan.list.filter(item => item.builtin == 'local')) {
    if (api.scriptUpdateUrl) continue
    assert.equal(api.scriptUpdateUrl, '', `${api.id} 没有更新地址，不该进更新调度`)
  }
  assert.deepEqual(pickCheckTargets(plan.list, 'startup', 1, false), [], '总开关关掉后一个源都不查')
})

test('在线内置源过语法闸门，内容变化可更新，坏包被拒绝', () => {
  for (const source of BUILTIN_SOURCES.filter(item => item.kind == 'online')) {
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
