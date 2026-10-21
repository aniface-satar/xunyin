/**
 * 自定义排序的纯计算：目标下标、让位偏移与最终数组。
 * 单独放在这里，既能给拖拽层复用，也能脱离 React Native 直接跑单测。
 */
export const moveItemToIndex = <T>(list: readonly T[], from: number, to: number): T[] => {
  const next = [...list]
  if (from < 0 || from >= list.length) return next
  const [item] = next.splice(from, 1)
  next.splice(Math.min(Math.max(to, 0), next.length), 0, item)
  return next
}

/**
 * 浮动行顶部对应到列表里的最终下标。scrollDelta 是拖拽期间自动滚动滚过的距离，
 * 内容在手指下面移动，落点也要跟着变。
 */
export const getCustomSortTargetIndex = (fromIndex: number, dy: number, scrollDelta: number, itemHeight: number, length: number): number => {
  if (length <= 0 || itemHeight <= 0) return 0
  const contentY = fromIndex * itemHeight + dy + scrollDelta
  return Math.min(length - 1, Math.max(0, Math.round(contentY / itemHeight)))
}

/**
 * 其余行要让出的位移：往下拖时中间行上移，往上拖时中间行下移。
 */
export const getCustomSortOffset = (index: number, fromIndex: number, targetIndex: number, itemHeight: number): number => {
  if (targetIndex > fromIndex && index > fromIndex && index <= targetIndex) return -itemHeight
  if (targetIndex < fromIndex && index >= targetIndex && index < fromIndex) return itemHeight
  return 0
}
