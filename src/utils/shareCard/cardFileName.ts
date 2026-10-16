/**
 * 分享图文件名的判据。本模块必须保持零 import（规矩同 src/core/lyricCopy.ts）：
 * node --test 不解析 tsconfig 里的 @/ 别名，而 saveCard.ts 顶层有 react-native-fs 与 store，
 * 从那里 import 会直接载不动。
 */
const MAX_BASE_NAME = 72

/** 文件名里的非法字符一律去掉：SAF 那边不会替你报错，只会写不出或者写歪。 */
export const cardFileName = (name: string, singer: string) => {
  // eslint-disable-next-line no-control-regex
  const clean = (value: string) => value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim()
  const title = clean(name)
  const artist = clean(singer)
  const joined = artist ? `${title} - ${artist}` : title
  return (joined || 'lyric-poster').slice(0, MAX_BASE_NAME)
}
