import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// RN 组件没有测试渲染器，只能读源码盯住"浮窗自己挂糊底"这条接线不能退回去。
// 背景：壁纸模式把 `c-content-background` 换成透明，不糊的话一整块内容直接压在照片纹理上，
// 每行字都要在图的明暗里找 —— Dialog / Popup / 分享卡都这么糊，菜单浮窗与更新窗口跟着同一手。
const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (relPath: string) => readFileSync(path.join(rootPath, 'src', relPath), 'utf8')

const menuSource = readSrc('components/common/Menu.tsx')
const modalContentSource = readSrc('navigation/components/ModalContent.tsx')

test('菜单浮窗（歌曲条 ⋮ / 歌单条 ⋮ / 音源选择）铺自己的糊底', () => {
  assert.match(menuSource, /import GlassBackdrop from '\.\/GlassBackdrop'/)
  assert.match(menuSource, /theme\['is-wallpaper'\] \? <GlassBackdrop/)
})

test('「打开更新窗口」那个弹窗铺同一张糊底', () => {
  assert.match(modalContentSource, /import GlassBackdrop from '@\/components\/common\/GlassBackdrop'/)
  assert.match(modalContentSource, /theme\['is-wallpaper'\] \? <GlassBackdrop/)
})

test('糊底按各自的圆角裁掉溢出的那一圈', () => {
  assert.match(menuSource, /overflow: 'hidden'/)
  assert.match(modalContentSource, /overflow: 'hidden'/)
})
