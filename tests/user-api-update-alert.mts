import test from 'node:test'
import assert from 'node:assert/strict'
import { planUpdateAlert } from '../src/core/userApiUpdate/updateAlert.ts'

const api = (allowShowUpdateAlert: boolean, autoUpdate: boolean) => ({ allowShowUpdateAlert, autoUpdate })

test('没勾选更新弹窗：自动更新取不到地址时只轻提示，不弹窗口', () => {
  assert.deepEqual(
    planUpdateAlert(api(false, true), { status: 'failed', reason: 'resolve_failed', openUrl: 'https://x.test/a.js' }, 'https://x.test/a.js'),
    { type: 'toast', kind: 'failed' },
  )
})

test('没勾选更新弹窗：自动更新失败（脚本不合格）也只轻提示', () => {
  assert.deepEqual(
    planUpdateAlert(api(false, true), { status: 'failed', reason: 'rejected' }),
    { type: 'toast', kind: 'failed' },
  )
})

test('没勾选更新弹窗且关了自动更新：完全静默', () => {
  assert.deepEqual(planUpdateAlert(api(false, false), null, 'https://x.test/a.js'), { type: 'silent' })
})

test('没勾选更新弹窗不影响自动更新成功的轻提示', () => {
  assert.deepEqual(
    planUpdateAlert(api(false, true), { status: 'updated', name: 'x' }),
    { type: 'toast', kind: 'updated' },
  )
})

test('勾选了更新弹窗但没开自动更新：用脚本报的地址弹确认窗', () => {
  assert.deepEqual(
    planUpdateAlert(api(true, false), null, 'https://x.test/a.js'),
    { type: 'confirm', url: 'https://x.test/a.js' },
  )
})

test('勾选了更新弹窗、自动更新取不到地址：退回到确认窗', () => {
  assert.deepEqual(
    planUpdateAlert(api(true, true), { status: 'failed', reason: 'resolve_failed', openUrl: 'https://x.test/raw.js' }, 'https://x.test/page'),
    { type: 'confirm', url: 'https://x.test/raw.js' },
  )
})

test('取不到地址又没有可打开的链接时退回提示窗', () => {
  assert.deepEqual(
    planUpdateAlert(api(true, true), { status: 'failed', reason: 'resolve_failed' }),
    { type: 'tip' },
  )
})

test('勾选了更新弹窗时，自动更新成功只轻提示、无变化则静默', () => {
  assert.deepEqual(
    planUpdateAlert(api(true, true), { status: 'updated', name: 'x' }),
    { type: 'toast', kind: 'updated' },
  )
  assert.deepEqual(planUpdateAlert(api(true, true), { status: 'unchanged' }), { type: 'silent' })
})

test('脚本报了新版本、更新地址里却是旧版本：不弹窗也不报失败，安静跳过', () => {
  assert.deepEqual(planUpdateAlert(api(false, true), { status: 'older' }), { type: 'silent' })
  assert.deepEqual(planUpdateAlert(api(true, true), { status: 'older' }), { type: 'silent' })
})

test('勾选了更新弹窗时，自动更新失败但不涉及地址：照旧静默', () => {
  assert.deepEqual(
    planUpdateAlert(api(true, true), { status: 'failed', reason: 'rejected' }),
    { type: 'silent' },
  )
})
