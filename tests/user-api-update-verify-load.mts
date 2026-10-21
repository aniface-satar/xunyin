import test from 'node:test'
import assert from 'node:assert/strict'
import { planUserApiInit } from '../src/core/userApiUpdate/verifyLoad.ts'

// 背景：自动更新换上新脚本后会自己加载验证一次（verify）。这次加载顶掉的可能是
// 正在初始化的当前源，它失败时后面还有一步回滚，所以不能按普通初始化结算。

test('验证加载失败不结算应用级初始化 —— 否则回滚也救不回来，整个源报 source init failed', () => {
  const plan = planUserApiInit({ verify: true, status: false, hasErrorMessage: true, settled: false })
  assert.equal(plan.settle, false)
})

test('验证加载成功可以结算 —— 它可能已经顶掉了还没报结果的首次加载，源得能就绪', () => {
  const plan = planUserApiInit({ verify: true, status: true, hasErrorMessage: false, settled: false })
  assert.equal(plan.settle, true)
})

test('验证加载失败不弹「音源初始化失败」—— 回滚会自己报「已退回更新前的版本」', () => {
  const plan = planUserApiInit({ verify: true, status: false, hasErrorMessage: true, settled: false })
  assert.equal(plan.alert, false)
})

test('普通加载失败照常结算并弹提示', () => {
  const plan = planUserApiInit({ verify: false, status: false, hasErrorMessage: true, settled: false })
  assert.deepEqual(plan, { settle: true, alert: true })
})

test('没有错误信息时普通失败也不弹空提示', () => {
  const plan = planUserApiInit({ verify: false, status: false, hasErrorMessage: false, settled: false })
  assert.equal(plan.alert, false)
  assert.equal(plan.settle, true, '结算与提示是两件事：失败仍要让取链接停下并报错')
})

test('已经结算过就不再结算第二次', () => {
  const settled = planUserApiInit({ verify: true, status: true, hasErrorMessage: false, settled: true })
  assert.equal(settled.settle, false)
  const again = planUserApiInit({ verify: false, status: false, hasErrorMessage: true, settled: true })
  assert.equal(again.settle, false)
})

test('验证加载成功不弹任何提示', () => {
  const plan = planUserApiInit({ verify: true, status: true, hasErrorMessage: false, settled: false })
  assert.equal(plan.alert, false)
})
