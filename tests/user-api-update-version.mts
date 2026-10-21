import test from 'node:test'
import assert from 'node:assert/strict'
import { compareVersions } from '../src/core/userApiUpdate/version.ts'

test('日期式版本按数值逐段比较，不是按字符串', () => {
  assert.equal(compareVersions('2026.10.18', '2026.10.20'), -1)
  assert.equal(compareVersions('2026.10.20', '2026.10.18'), 1)
  assert.equal(compareVersions('2026.10.20', '2026.10.20'), 0)
})

test('带 v 前缀与带前导零的段都按数值算', () => {
  assert.equal(compareVersions('v1.0.3', '1.2.0'), -1)
  assert.equal(compareVersions('v1.02', '1.2'), 0)
  assert.equal(compareVersions('V2.0', '1.9.9'), 1)
})

test('横线与下划线分隔也算版本号', () => {
  assert.equal(compareVersions('2026-10-20', '2026.10.19'), 1)
  assert.equal(compareVersions('2026_10_20', '2026-10-20'), 0)
})

test('段数不同时短的一边补零', () => {
  assert.equal(compareVersions('1.2', '1.2.0'), 0)
  assert.equal(compareVersions('1.2', '1.2.1'), -1)
  assert.equal(compareVersions('1.2.0.1', '1.2'), 1)
})

test('纯数字版本也能比，不能当日期硬截断', () => {
  assert.equal(compareVersions('20261019', '20261020'), -1)
  assert.equal(compareVersions('89', '90'), -1)
})

test('纯数字与带分隔符混用时分不清年份段，返回 null 而不是误判', () => {
  assert.equal(compareVersions('20261020', '2026.10.21'), null)
  assert.equal(compareVersions('1', '1.0'), null)
})

test('认不出的版本返回 null，不能拿它当降级证据', () => {
  assert.equal(compareVersions('', '1.0.0'), null)
  assert.equal(compareVersions('beta', 'alpha'), null)
  assert.equal(compareVersions('2026.10.20-beta', '2026.10.20'), null)
  assert.equal(compareVersions('v1.0.0', '最新版'), null)
})
