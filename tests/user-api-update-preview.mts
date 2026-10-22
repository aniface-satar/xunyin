import test from 'node:test'
import assert from 'node:assert/strict'
import { previewUpdate, previewDescriptor, pickBestPreview, type UserApiUpdatePreview } from '../src/core/userApiUpdate/preview.ts'

const header = (name: string, version: string, extra = '') => `/**\n * @name ${name}\n * @version ${version}\n${extra} */\nuserApi.register.action(() => {})\n`
const NAME = '落雪云更新音源(实测)'
const OLD = header(NAME, '2026.10.18')
const NEW = header(NAME, '2026.10.20')
const SAME_VERSION_NEW_BYTES = header(NAME, '2026.10.20', ' * @author 补丁\n')

const preview = (stored: string, script: string, url = 'https://a.test/lx.js') => previewUpdate({ name: NAME, storedScript: stored, script, url })

test('地址里是更高版本：给 available，并把脚本一起留着，确认后不用再取一次', () => {
  const result = preview(OLD, NEW)
  assert.equal(result.status, 'available')
  if (result.status != 'available') return
  assert.equal(result.comparison, 'newer')
  assert.equal(result.fromVersion, '2026.10.18')
  assert.equal(result.toVersion, '2026.10.20')
  assert.equal(result.script, NEW)
  assert.equal(result.url, 'https://a.test/lx.js')
})

test('内容一字不差：up_to_date，不制造一次多余的确认', () => {
  assert.deepEqual(preview(NEW, NEW), { status: 'up_to_date', name: NAME })
})

test('地址里是旧版本：单独给 older，手动更新要靠它弹降级确认', () => {
  const result = preview(NEW, OLD)
  assert.equal(result.status, 'older')
  if (result.status != 'older') return
  assert.equal(result.fromVersion, '2026.10.20')
  assert.equal(result.toVersion, '2026.10.18')
  assert.equal(result.script, OLD)
})

test('同版本不同内容算可更新，但不能撒谎说成新版本', () => {
  const result = preview(NEW, SAME_VERSION_NEW_BYTES)
  assert.equal(result.status, 'available')
  if (result.status != 'available') return
  assert.equal(result.comparison, 'same')
})

test('同版本号靠构建时间分新旧：新构建算 newer，旧构建判降级', () => {
  const oldBuild = header(NAME, '2026.10.20', ' * 于 2026-10-20 13:00:02 自动生成\n')
  const newBuild = header(NAME, '2026.10.20', ' * 于 2026-10-20 19:00:02 自动生成\n')
  const newer = preview(oldBuild, newBuild)
  assert.equal(newer.status, 'available')
  if (newer.status == 'available') assert.equal(newer.comparison, 'newer')
  assert.equal(preview(newBuild, oldBuild).status, 'older')
})

test('版本号认不出时不能判降级，仍给可更新让用户决定', () => {
  const result = preview(header(NAME, 'beta'), header(NAME, 'nightly'))
  assert.equal(result.status, 'available')
  if (result.status != 'available') return
  assert.equal(result.comparison, 'unknown')
})

test('不合格的脚本在预览阶段就失败，不进入确认流程', () => {
  const result = preview(OLD, '<html>404</html>')
  assert.equal(result.status, 'failed')
  if (result.status != 'failed') return
  assert.equal(result.reason, 'rejected')
})

test('名字对不上时标出是哪条闸门，日志里能说清是地址填错了', () => {
  const result = previewUpdate({
    name: '西瓜聚合源',
    storedScript: OLD,
    script: header('落雪云更新音源(实测)', '2026.10.20'),
    url: 'https://a.test/lx.js',
  })
  assert.equal(result.status, 'failed')
  if (result.status != 'failed') return
  assert.equal(result.reason, 'rejected')
  assert.equal(result.rejectReason, 'name_mismatch')
  assert.equal(result.url, 'https://a.test/lx.js')
})

test('同一个源报了多个地址：可更新压过已最新/更旧/失败，且在同为可更新时选版本高的', () => {
  const newer20 = preview(OLD, NEW, 'https://a.test/20.js')
  const newer21 = preview(OLD, header(NAME, '2026.10.21'), 'https://b.test/21.js')
  assert.deepEqual(pickBestPreview([
    { status: 'up_to_date', name: NAME },
    newer20,
    preview(NEW, OLD, 'https://c.test/old.js'),
    newer21,
  ]), newer21)
})

test('版本号相同时选构建时间更晚的镜像，不能被 CDN 旧缓存排前面带偏', () => {
  const stale = preview(OLD, header(NAME, '2026.10.20', ' * 于 2026-10-20 13:00:02 自动生成\n'), 'https://fastly.test/lx.js')
  const fresh = preview(OLD, header(NAME, '2026.10.20', ' * 于 2026-10-20 19:00:02 自动生成\n'), 'https://gcore.test/lx.js')
  assert.deepEqual(pickBestPreview([stale, fresh]), fresh)
  assert.deepEqual(pickBestPreview([fresh, stale]), fresh)
})

// 念心/长青这类源的更新地址是「版本 JSON + 网页」，网页里根本没有脚本。
// 当前版本不比描述里的旧时，检查更新必须说“已是最新”，不能报“地址里没有脚本”。
test('版本描述与当前同版或更旧：判为已最新', () => {
  const stored = header(NAME, '1.0.2')
  for (const version of ['1.0.2', '1.0.1']) {
    assert.deepEqual(previewDescriptor({
      name: NAME,
      storedScript: stored,
      descriptor: { version, url: 'https://doc.test/update' },
    }), { status: 'up_to_date', name: NAME })
  }
})

test('版本描述确实更新但只有网页：说清楚要手动打开，并把网页地址留下来', () => {
  const result = previewDescriptor({
    name: NAME,
    storedScript: header(NAME, '1.0.2'),
    descriptor: { version: '1.0.3', url: 'https://doc.test/update' },
  })
  assert.equal(result?.status, 'failed')
  if (result?.status != 'failed') return
  assert.match(result.message, /1\.0\.3/)
  assert.match(result.message, /手动/)
  assert.equal(result.openUrl, 'https://doc.test/update')
  assert.equal(result.versionPage, true, '地址本身是通的，手动更新可以记下来')
})

test('版本号格式认不出时不猜，交给调用方报普通失败', () => {
  assert.equal(previewDescriptor({
    name: NAME,
    storedScript: header(NAME, 'beta'),
    descriptor: { version: 'nightly', url: '' },
  }), null)
})

test('没有可更新时按 已最新 > 更旧 > 失败 的顺序取一个能说清楚的结论', () => {
  const upToDate: UserApiUpdatePreview = { status: 'up_to_date', name: NAME }
  const older = preview(NEW, OLD)
  const failed = preview(OLD, '<html>404</html>')
  assert.deepEqual(pickBestPreview([failed, older, upToDate]), upToDate)
  assert.deepEqual(pickBestPreview([failed, older]), older)
  assert.deepEqual(pickBestPreview([failed]), failed)
  assert.equal(pickBestPreview([]), null)
})
