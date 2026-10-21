/**
 * 读盘和点下载是两条独立的时间线：`load()` 慢的时候，用户可能已经把新任务加进列表了。
 * 那份内存列表是本次会话的真话（状态更新、刚取的直链都跟着走），不能被盘上的旧名单覆盖掉；
 * 但盘上那些内存里没有的历史任务（比如上次会话留下的）要补回来。
 */
export const mergeLoadedList = (inMemory: LX.Download.ListItem[], stored: LX.Download.ListItem[]) => {
  const existing = stored.filter(item => item?.id && item.metadata)
  const known = new Set(inMemory.map(item => item.id))
  return [...inMemory, ...existing.filter(item => !known.has(item.id))]
}
