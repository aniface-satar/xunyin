import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// 2026-10-17 真机症状：应用是浅色主题，音乐卡与歌词卡两张都还是黑底。
// 根因不在 cardTheme.ts（那张选票本身是对的，tests/share-card-theme.mts 钉着），
// 而在**它读到的 theme 不是应用那一份**：
//   PlayDetail/index.tsx:37 给整棵竖屏子树挂了 OnCoverThemeProvider，
//   applyOnCoverTheme（src/utils/monet/onCoverTheme.ts:236）在封面取色生效时把 isDark 硬翻成 true，
//   而两个分享卡入口（Vertical/components/Header.tsx、Vertical/Lyric.tsx）都在这棵子树里面。
// 于是 ShareCard 里 pickCardTheme(appTheme.isDark) 恒为 DARK —— 浅色模式也给你黑卡。
//
// 卡片是 RN 组件，node --test 起不来渲染，所以这里钉的是**源码里的挂法**：
// 被拍的那一层必须坐在"挂回应用主题"的 provider 里（SheetThemeProvider，仓库为同一类弹层造好的机制）。
// 只钉 ShareCard 不钉整页：动作按钮那排 chrome 走的是场上主题，本轮不动它。

const MODAL = readFileSync(path.join(import.meta.dirname, '../src/components/ShareCard/ShareCardModal.tsx'), 'utf8')

const INDEX_OF = (needle: string): number => {
  const index = MODAL.indexOf(needle)
  assert.ok(index >= 0, `ShareCardModal.tsx 里找不到 ${needle}，这个测试跟实现脱钩了`)
  return index
}

test('the captured card subtree is re-parented to the app theme', () => {
  const open = INDEX_OF('<SheetThemeProvider>')
  const card = INDEX_OF('<ShareCard')
  const close = INDEX_OF('</SheetThemeProvider>')
  assert.ok(open < card, 'ShareCard 必须挂在 SheetThemeProvider 里面，否则它读到的是播放页那层封面墨主题')
  assert.ok(card < close, 'SheetThemeProvider 必须包住 ShareCard')
})

test('the card layer does not read the ambient theme hook itself', () => {
  // 卡色只能有一个来路：provider 挂回来的那一份应用主题。
  // 这一条钉的是"别在 ShareCard 里另起一路 useTheme/封面主题"，两路就会有人漏掉 isDark 被动过。
  const cardLayer = readFileSync(path.join(import.meta.dirname, '../src/components/ShareCard/index.tsx'), 'utf8')
  assert.match(cardLayer, /pickCardTheme\(appTheme\.isDark\)/, '卡色必须由 appTheme.isDark 选')
  assert.ok(!/applyOnCoverTheme|useCoverSurface/.test(cardLayer), '卡片层不许自己接封面取色那一路')
})
