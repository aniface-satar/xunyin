import test from 'node:test'
import assert from 'node:assert/strict'

import { shouldShowSearchType } from '../src/screens/Home/Views/Search/searchTypeVisibility.ts'

test('keeps search type tabs visible for an active search after tab reset', () => {
  assert.equal(shouldShowSearchType('hello'), true)
})

test('hides search type tabs when there is no search text', () => {
  assert.equal(shouldShowSearchType(''), false)
})
