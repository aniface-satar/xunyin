import test from 'node:test'
import assert from 'node:assert/strict'

import { getHeaderActions } from '../src/screens/Home/Vertical/headerActions.ts'

test('places settings to the right of search on the mine page', () => {
  assert.deepEqual(getHeaderActions('nav_love'), ['mylistSearch', 'settings'])
})

test('keeps the existing settings action on discover and search pages', () => {
  assert.deepEqual(getHeaderActions('nav_discover'), ['settings'])
  assert.deepEqual(getHeaderActions('nav_search'), ['settings'])
})
