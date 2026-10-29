/**
 * 自定义背景与「主题」之间的窄桥。
 *
 * `theme/themes/index.ts` 的 buildActiveThemeColors 是同步的、且被 core/theme 在最早期调用，
 * 那里不能去读 storage（异步），也不该把 customBg.ts 整条链（它会拉 core/common）拖进来 ——
 * 会绕成 themes → customBg → common → … 的循环。所以两边只共享这一个没有任何依赖的小模块：
 * customBg 在列表/开关变动时写进来，buildActiveThemeColors 在拼主题时同步读出去。
 */
export interface CustomBgSource {
  uri: string
  blur: number
  applyToPlayer: boolean
}

let source: CustomBgSource | null = null

export const setCustomBgSource = (next: CustomBgSource | null) => {
  source = next
}

export const getCustomBgSource = () => source
