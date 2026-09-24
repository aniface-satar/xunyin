import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const componentPath = path.join(rootPath, 'src/screens/Home/Views/Setting/settings/Theme/Theme.tsx')
const componentSource = readFileSync(componentPath, 'utf8')

test('shows the non-solid theme warning below the theme title', () => {
  const titleIndex = componentSource.indexOf("title={t('setting_basic_theme')}")
  const tipIndex = componentSource.indexOf("t('setting_basic_theme_non_solid_tip')")
  const listIndex = componentSource.indexOf('<View style={styles.list}>')

  assert.notEqual(titleIndex, -1)
  assert.notEqual(tipIndex, -1)
  assert.notEqual(listIndex, -1)
  assert.ok(titleIndex < tipIndex)
  assert.ok(tipIndex < listIndex)
})

test('provides translations for the non-solid theme warning', () => {
  const key = 'setting_basic_theme_non_solid_tip'
  const expected = {
    'zh-cn': '后面的非纯色主题有显示错误，不建议当前使用',
    'zh-tw': '後面的非純色主題有顯示錯誤，不建議當前使用',
    'en-us': 'The non-solid-color themes below may render incorrectly and are not recommended for now.',
  }

  for (const [locale, message] of Object.entries(expected)) {
    const translations = JSON.parse(readFileSync(path.join(rootPath, `src/lang/${locale}.json`), 'utf8'))
    assert.equal(translations[key], message)
  }
})
