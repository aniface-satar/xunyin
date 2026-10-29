import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// 这组不变式起于 2026-10-17 的一台真机症状：应用是浅色主题，两张分享卡还是黑底 ——
// PlayDetail/index.tsx 给整棵竖屏子树挂了 OnCoverThemeProvider，applyOnCoverTheme
// （src/utils/monet/onCoverTheme.ts:236）在封面取色生效时把 isDark 硬翻成 true，
// 而 ShareCard 当时靠 appTheme.isDark 选卡色 ⇒ 恒为黑卡。
//
// 2026-10-29 用户改口：卡色不再随应用深浅色变化，改由预览页底部「白底 / 黑底」自己选（默认白底）。
// 这一改让上文那条 bug 的成因彻底失效 —— 卡色源头从"环境主题"挪到了"用户这一次的选择"。
// 卡片是 RN 组件，node --test 起不来渲染，所以这里钉的仍是**源码里的接法**：
//   ① 卡色只有一条路：ShareCard 的 tone 入参 ← ShareCardModal 的 tone state（默认 light）；
//   ② 卡片层不许自己接 useTheme / 封面取色那一路，否则"用户选的白底"又会被环境覆盖；
//   ③ 被拍子树仍然挂在 SheetThemeProvider 里 —— 卡色已不读它，但 common/Text 的 base style 还读
//      （目前被卡内显式 color + noShadow 压掉），挂着这层就没有"某天新增的子组件吃到封面墨色"的路。
// 只钉 ShareCard 不钉整页：选项按钮与动作按钮是界面 chrome，走场上主题。

const MODAL = readFileSync(path.join(import.meta.dirname, '../src/components/ShareCard/ShareCardModal.tsx'), 'utf8')
const CARD_LAYER = readFileSync(path.join(import.meta.dirname, '../src/components/ShareCard/index.tsx'), 'utf8')

const INDEX_OF = (needle: string): number => {
  const index = MODAL.indexOf(needle)
  assert.ok(index >= 0, `ShareCardModal.tsx 里找不到 ${needle}，这个测试跟实现脱钩了`)
  return index
}

test('the captured card subtree is re-parented to the app theme', () => {
  const open = INDEX_OF('<SheetThemeProvider>')
  // 用正则收尾，避开注释里那枚 `<ShareCardModal/>`（`indexOf('<ShareCard')` 会先命中它）。
  const card = MODAL.search(/<ShareCard[\s/>]/)
  const close = MODAL.lastIndexOf('</SheetThemeProvider>')
  assert.ok(card >= 0, 'ShareCardModal.tsx 里找不到 <ShareCard')
  assert.ok(open < card, 'ShareCard 必须挂在 SheetThemeProvider 里面（卡色已不读它，但卡内 Text 的 base style 还读）')
  assert.ok(card < close, 'SheetThemeProvider 必须包住 ShareCard')
})

test('the card color comes from the tone switch, and only from it', () => {
  // ① 卡片层：选择器只认 tone 入参。
  assert.match(CARD_LAYER, /pickCardTheme\(tone\)/, '卡色必须由 tone 选，不许再读 appTheme.isDark')
  assert.ok(!/useTheme/.test(CARD_LAYER), '卡片层不许读主题 hook —— 卡色是产物参数，不是界面肤色')
  assert.ok(!/applyOnCoverTheme|useCoverSurface/.test(CARD_LAYER), '卡片层不许自己接封面取色那一路')

  // ② 弹窗层：默认白底，两个入口都不另起一套默认值。
  assert.match(MODAL, /const DEFAULT_TONE: CardTone = 'light'/, '默认必须是白底（2026-10-29 用户指定）')
  assert.match(MODAL, /useState<CardTone>\(DEFAULT_TONE\)/, 'tone 的初值只能来自 DEFAULT_TONE')
  assert.match(MODAL, /tone=\{tone\}/, '被拍的卡必须吃到用户选的那一档')
})
