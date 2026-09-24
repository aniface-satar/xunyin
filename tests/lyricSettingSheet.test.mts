import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const componentPath = path.join(rootPath, 'src/screens/PlayDetail/Vertical/components/LyricSettingSheet.tsx')
const componentSource = readFileSync(componentPath, 'utf8')

test('shows lyric player settings without a scroll container', () => {
  assert.doesNotMatch(componentSource, /\bScrollView\b/)
})

test('keeps every lyric player setting visible in the sheet content', () => {
  const settings = [
    'SettingLyricProgress',
    'SettingVolume',
    'SettingPlaybackRate',
    'SettingLrcFontSize\\b',
    'SettingLrcAlign',
  ]
  const contentIndex = componentSource.indexOf('<View style={styles.content}>')

  assert.notEqual(contentIndex, -1)
  for (const setting of settings) {
    const settingIndex = componentSource.slice(contentIndex).search(new RegExp(`<${setting}`))
    assert.notEqual(settingIndex, -1, `${setting} is rendered outside the sheet content`)
  }
})

test('uses compact settings so every option fits without scrolling', () => {
  const contentIndex = componentSource.indexOf('<View style={styles.settings}')
  const settings = [
    'SettingLyricProgress',
    'SettingVolume',
    'SettingPlaybackRate',
    'SettingLrcFontSize\\b',
    'SettingLrcAlign',
  ]

  assert.notEqual(contentIndex, -1)
  for (const setting of settings) {
    const settingIndex = componentSource.slice(contentIndex).search(new RegExp(`<${setting}`))
    const openingTagEnd = componentSource.indexOf('/>', contentIndex + settingIndex)
    const openingTag = componentSource.slice(contentIndex + settingIndex, openingTagEnd)
    assert.match(openingTag, /\bcompact\b/, `${setting} is not compact`)
  }
})
