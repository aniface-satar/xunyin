import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// RN 组件没有测试渲染器，只能读源码盯住这条不能退回去的接线。
// 背景：歌单列表的行线走 borderBottom + BorderWidths.normal，不经过 createStyle 的尺寸换算；
// 面板原先写的是 height: 1，scaleSizeH 在 1260×2800 @3.5 这类高密度屏上会把它算成 0dp，
// 线上真机整条消失（用户只看到没有分隔线的更多菜单），所以这里钉死"复用歌单行线"的配方。
const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const componentPath = path.join(rootPath, 'src/screens/PlayDetail/Vertical/Player/components/MusicMoreSheet.tsx')
const source = readFileSync(componentPath, 'utf8')

test('the more sheet draws separators with the playlist row recipe', () => {
  assert.match(source, /separator: \{\s*borderBottomWidth: BorderWidths\.normal/)
  assert.doesNotMatch(source, /separator: \{\s*height:/)
})

test('the cover info and every option but the last are separated', () => {
  // 一处挂在封面信息与第一个选项之间，一处挂在选项之间；后者跳过最后一行
  const rendered = source.match(/styles\.separator, \{ borderBottomColor: theme\['c-border-background'\] \}/g) ?? []
  assert.equal(rendered.length, 2)
  assert.match(source, /index < ACTIONS\.length - 1/)
})
