import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const componentPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/components/OnlineList/MultipleModeBar.tsx',
)
const source = readFileSync(componentPath, 'utf8')
const branchStart = source.indexOf("multiSelectStyle == 'mylist'")
const branchEnd = source.indexOf('return (', source.indexOf('}', branchStart) + 1)
const mylistBranch = source.slice(branchStart, branchEnd)

test('omits cancel action from the mylist multi-select bar', () => {
  assert.doesNotMatch(mylistBranch, /list_select_cancel/)
})

test('uses the same fixed height as the mylist multi-select bar', () => {
  assert.match(source, /export const MULTI_SELECT_BAR_HEIGHT = 36\b/)
})
