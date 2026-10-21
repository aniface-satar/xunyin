import test from 'node:test'
import assert from 'node:assert/strict'
import {
  planUpdate,
  applyUpdateScript,
  rollbackScript,
  type ScriptStore,
} from '../src/core/userApiUpdate/applyUpdate.ts'

const header = (name: string, version: string, extra = '') => `/**\n * @name ${name}\n * @version ${version}\n${extra} */\nuserApi.register.action(() => {})\n`
const OLD = header('HYWmusic_公益版', 'v1.0.3')
const NEW = header('HYWmusic_公益版', 'v1.2.0', ' * @updateUrl https://a.example/src.js\n')

const makeStore = (stored = OLD, backup: string | null = null): ScriptStore & { writes: string[], backups: string[], log: string[] } => {
  const state = { script: stored, backup }
  const writes: string[] = []
  const backups: string[] = []
  // 两次写盘分开记就看不出先后：备份必须先于覆盖，否则回滚拿到的是新脚本
  const log: string[] = []
  return {
    writes,
    backups,
    log,
    readScript: async() => state.script,
    writeScript: async(_id, script) => {
      writes.push(script)
      log.push('write')
      state.script = script
    },
    writeBackup: async(_id, script) => {
      backups.push(script)
      log.push('backup')
      state.backup = script
    },
    readBackup: async() => state.backup,
  }
}

const current = { id: 'user_api_1', name: 'HYWmusic_公益版', version: 'v1.0.3' }

test('取回的脚本和已存的一模一样时不算更新，也不写盘', async() => {
  const store = makeStore()
  const result = await applyUpdateScript(store, { ...current, script: OLD })
  assert.equal(result.status, 'unchanged')
  assert.equal(store.writes.length, 0)
  assert.equal(store.backups.length, 0)
})

test('脚本头部名字与当前源不一致时拒绝写入 —— 防止把 A 音源写进 B 音源', async() => {
  const store = makeStore()
  const result = await applyUpdateScript(store, { ...current, script: header('别人的音源', 'v9.9.9') })
  assert.equal(result.status, 'name_mismatch')
  assert.equal(store.writes.length, 0, '不一致时绝不能碰现有脚本')
})

test('内容里没有音源头部注释时拒绝写入', async() => {
  const store = makeStore()
  const result = await applyUpdateScript(store, { ...current, script: '<html><body>404</body></html>' })
  assert.equal(result.status, 'invalid_script')
  assert.equal(store.writes.length, 0)
})

// 解析器现在会跟着网页里的链接到处取内容，网盘/下载页随手就能返回几百兆的东西，
// 不挡住就会把一大坨写进存储；旧实现里也有 9MB 这条线，别在这一步退化了。
test('取回的内容大得离谱时不写盘', async() => {
  const store = makeStore()
  const result = await applyUpdateScript(store, { ...current, script: header('HYWmusic_公益版', 'v1.2.0') + 'x'.repeat(9_000_000) })
  assert.equal(result.status, 'too_large')
  assert.equal(store.writes.length, 0)
  assert.equal(store.backups.length, 0)
})

test('正常更新先备份旧脚本再写新的，顺序反了就没有回滚可用', async() => {
  const store = makeStore()
  const result = await applyUpdateScript(store, { ...current, script: NEW })
  assert.equal(result.status, 'updated')
  if (result.status != 'updated') return
  assert.equal(result.fromVersion, 'v1.0.3')
  assert.equal(result.toVersion, 'v1.2.0')
  assert.deepEqual(store.log, ['backup', 'write'], '必须先备份再覆盖')
  assert.deepEqual(store.backups, [OLD])
  assert.deepEqual(store.writes, [NEW])
})

test('更新地址里是更旧的版本：拒绝覆盖，且一个字节都不写', async() => {
  const store = makeStore(header('HYWmusic_公益版', '2026.10.20'))
  const result = await applyUpdateScript(store, { ...current, script: header('HYWmusic_公益版', '2026.10.18') })
  assert.equal(result.status, 'older')
  if (result.status != 'older') return
  assert.equal(result.fromVersion, '2026.10.20')
  assert.equal(result.toVersion, '2026.10.18')
  assert.equal(store.writes.length, 0)
  assert.equal(store.backups.length, 0)
})

test('用户手动确认降级后可以换回旧版本，但仍先备份当前这份', async() => {
  const store = makeStore(header('HYWmusic_公益版', '2026.10.20'))
  const result = await applyUpdateScript(store, { ...current, script: header('HYWmusic_公益版', '2026.10.18') }, { allowDowngrade: true })
  assert.equal(result.status, 'updated')
  assert.deepEqual(store.log, ['backup', 'write'])
  assert.deepEqual(store.backups, [header('HYWmusic_公益版', '2026.10.20')])
})

test('同版本重新发布的新内容可以更新，不算降级', async() => {
  const store = makeStore(header('HYWmusic_公益版', '2026.10.20'))
  const result = await applyUpdateScript(store, { ...current, script: header('HYWmusic_公益版', '2026.10.20', ' * @author 补丁\n') })
  assert.equal(result.status, 'updated')
})

test('同版本但构建时间更晚：算正常更新，可以覆盖', async() => {
  const store = makeStore(header('HYWmusic_公益版', '2026.10.20', ' * 于 2026-10-20 13:00:02 生成\n'))
  const result = await applyUpdateScript(store, {
    ...current,
    script: header('HYWmusic_公益版', '2026.10.20', ' * 于 2026-10-20 19:00:02 生成\n'),
  })
  assert.equal(result.status, 'updated')
})

test('同版本但地址里是更早的构建：拒绝把 CDN 旧缓存写回去', async() => {
  const store = makeStore(header('HYWmusic_公益版', '2026.10.20', ' * 于 2026-10-20 19:00:02 生成\n'))
  const result = await applyUpdateScript(store, {
    ...current,
    script: header('HYWmusic_公益版', '2026.10.20', ' * 于 2026-10-20 13:00:02 生成\n'),
  })
  assert.equal(result.status, 'older')
  assert.equal(store.writes.length, 0)
  assert.equal(store.backups.length, 0)
})

test('版本号认不出时不能判降级，照旧允许更新', async() => {
  const store = makeStore(header('HYWmusic_公益版', 'beta'))
  const result = await applyUpdateScript(store, { ...current, script: header('HYWmusic_公益版', 'nightly') })
  assert.equal(result.status, 'updated')
})

test('头部没写名字的作者不拦（规范里 @name 不是强制的）', async() => {
  const store = makeStore()
  const result = await applyUpdateScript(store, { ...current, script: header('', 'v1.2.0') })
  assert.equal(result.status, 'updated')
})

test('名字只差大小写与空白视为同一个源', async() => {
  const store = makeStore()
  const result = await applyUpdateScript(store, { ...current, script: header('  hywmusic_公益版 ', 'v1.2.0') })
  assert.equal(result.status, 'updated')
})

test('更新后的脚本自带 @updateUrl 时一并交出去，供下次检查用', async() => {
  const plan = planUpdate({ currentName: current.name, storedScript: OLD, newScript: NEW })
  assert.equal(plan.action, 'write')
  assert.equal(plan.header?.updateUrl, 'https://a.example/src.js')
})

test('盘上那版还没被验证过时，备份要留住更早那份，不能被未验证的脚本顶掉', async() => {
  // 盘上是自动更新换进去、还没验证过的 NEW；备份是更早那份已知能用的 OLD
  const store = makeStore(NEW, OLD)
  const result = await applyUpdateScript(store, { ...current, script: header('HYWmusic_公益版', 'v1.3.0'), keepBackup: true })
  assert.equal(result.status, 'updated')
  assert.deepEqual(store.backups, [], '未验证的版本不能进备份')
  // 新脚本再起不来时，回滚要能退回 OLD 而不是退回那个没验证过的版本
  assert.equal(await rollbackScript(store, current.id), true)
  assert.equal(store.writes[store.writes.length - 1], OLD)
})

test('回滚就是把备份的旧脚本写回去', async() => {
  const store = makeStore()
  await applyUpdateScript(store, { ...current, script: NEW })
  assert.equal(await rollbackScript(store, current.id), true)
  assert.equal(store.writes[store.writes.length - 1], OLD)
})

test('没有备份时回滚明确失败，不写任何东西', async() => {
  const store = makeStore()
  assert.equal(await rollbackScript(store, current.id), false)
  assert.equal(store.writes.length, 0)
})

test('备份的旧脚本没有头部注释也要能还原 —— 保命路径不被格式卡', async() => {
  const store = makeStore(OLD, 'userApi.register.action(() => {})')
  assert.equal(await rollbackScript(store, current.id), true)
  assert.deepEqual(store.writes, ['userApi.register.action(() => {})'])
})
