import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// 2026-10-18 用户症状：②「封面模糊」下点全屏播控页头部的分享按钮，弹出来的「分享方式」面板
// 还是"半透明黑纱浮在糊图上"，与 App 里其他弹层不是一张脸。
// 根因是 ShareModeSheet 从落地起（01680db）就没进 SheetThemeProvider ——
// ② 把 c-content-background 映射成 0.32 的黑纱（src/utils/monet/onCoverTheme.ts 的 panel 墨色），
// 只有挂在 SheetThemeProvider 里的面板才拿到"用户主题原本的底"（应用浅色主题就是普通白底）。
//
// 弹层是 RN Modal，node --test 起不了渲染，所以这条不变式按**源码里的挂法**钉：
// 播控页上每一层"点按钮才出现"的面板，调用点都必须把组件包在 SheetThemeProvider 里。
// 表里是 §12.4 的五个挂载点加上分享这一层；以后谁再给播放页添弹层，同批把这里补一行。
// 与 tests/share-card-theme-source.mts 同族：那条钉被拍的卡，这条钉弹层。

const readSource = (relative: string) => readFileSync(path.join(import.meta.dirname, '..', relative), 'utf8')

const MOUNT_POINTS: Array<{ file: string, panels: string[] }> = [
  { file: 'src/screens/PlayDetail/Vertical/components/Header.tsx', panels: ['LyricSettingSheet', 'ShareModeSheet'] },
  { file: 'src/screens/PlayDetail/Vertical/components/MusicSummary.tsx', panels: ['MusicMoreSheet'] },
  { file: 'src/screens/PlayDetail/Vertical/Player/components/MusicInfo.tsx', panels: ['MusicMoreSheet'] },
  { file: 'src/screens/PlayDetail/Vertical/Player/components/ControlBtn.tsx', panels: ['PlaylistSheet'] },
  { file: 'src/screens/PlayDetail/Vertical/Player/components/MoreBtn/TimeoutExitBtn.tsx', panels: ['TimeoutExitEditModal'] },
]

test('every button-triggered panel on the cover player re-parents back to the app theme', () => {
  for (const { file, panels } of MOUNT_POINTS) {
    const source = readSource(file)
    const open = source.indexOf('<SheetThemeProvider>')
    const close = source.indexOf('</SheetThemeProvider>')
    assert.ok(open >= 0, `${file} 里没有 SheetThemeProvider`)
    assert.ok(close > open, `${file} 里 SheetThemeProvider 没有闭合`)
    for (const panel of panels) {
      // 用正则收尾，避开 useRef<ShareModeSheetType> 这类类型实参（它是 <Panel 的前缀）。
      const layer = source.search(new RegExp(`<${panel}[\\s/>]`))
      assert.ok(layer >= 0, `${file} 里找不到 <${panel}`)
      assert.ok(open < layer, `${panel} 必须挂在 SheetThemeProvider 里面（${file}），否则 ② 下它读的是黑纱面板`)
      assert.ok(layer < close, `SheetThemeProvider 必须包住 ${panel}（${file}）`)
    }
  }
})
