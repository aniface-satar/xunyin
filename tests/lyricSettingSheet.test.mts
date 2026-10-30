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
  // 底部留白改成"基础值 + 系统导航栏高度"之后不再走 styles.settings，用渲染处那段内边距当标记
  const contentIndex = componentSource.indexOf('paddingBottom: scaleSizeH(SETTINGS_BOTTOM_PADDING)')
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
